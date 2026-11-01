import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import { DomainError } from '../domain-error.js';
import type { PlayerService } from './player-service.js';
import type { PresenceService } from './presence-service.js';
import {
  CITIZEN_TASK_INTERACTION_RADIUS, getCitizenTaskDefinition, validateCitizenTaskCatalog,
  type CitizenTask, type CitizenTaskStatus, type CitizenTaskStep,
} from '../../shared/tasks.js';
import { distance2D, isInWorld } from '../../shared/world.js';
import type { CitizenTaskMutationResult, CitizenTaskState } from '../../shared/types.js';

interface CitizenTaskRow {
  id: string;
  template_id: string;
  civic_incident_id: string | null;
  status: CitizenTaskStatus;
  step_index: number;
  reward_lrd: number;
  accepted_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface TaskRequestRow { user_id: string; kind: string; target: string }

export class CitizenTaskService {
  constructor(
    private readonly database: Database,
    private readonly players: PlayerService,
    private readonly presence: Pick<PresenceService, 'recent'>,
  ) {}

  bootstrap() {
    const issues = validateCitizenTaskCatalog();
    if (issues.length) throw new Error(`Invalid citizen task catalog: ${issues.join('; ')}`);
  }

  state(userId: string): CitizenTaskState {
    const active = this.database.connection.prepare("SELECT * FROM citizen_tasks WHERE owner_id = ? AND status = 'active'").get(userId) as CitizenTaskRow | undefined;
    const stats = this.database.connection.prepare("SELECT COUNT(*) AS completed, COALESCE(SUM(reward_lrd), 0) AS earned_lrd FROM citizen_tasks WHERE owner_id = ? AND status = 'completed'").get(userId) as { completed: number; earned_lrd: number };
    return {
      activeTask: active ? this.mapTask(active) : null,
      taskStats: { completed: Number(stats.completed), earnedLrd: Number(stats.earned_lrd) },
    };
  }

  accept(userId: string, templateId: string, requestId: string, incidentId?: string): CitizenTaskMutationResult {
    const definition = getCitizenTaskDefinition(templateId);
    if (definition.incidentKind && !incidentId) throw new DomainError(409, 'Accept this work from an open civic incident.', 'civic_incident_required');
    if (!definition.incidentKind && incidentId) throw new DomainError(400, 'This citizen task is not linked to a civic incident.', 'invalid_civic_incident');
    const requestTarget = incidentId ? `${templateId}:${incidentId}` : templateId;
    let duplicate = false;
    let taskId = '';
    this.database.transaction(() => {
      if (this.replay(requestId, userId, 'task.accept', requestTarget)) { duplicate = true; return; }
      const active = this.database.connection.prepare("SELECT id FROM citizen_tasks WHERE owner_id = ? AND status = 'active'").get(userId);
      if (active) throw new DomainError(409, 'Finish or cancel your current citizen task first.', 'task_already_open');
      const trip = this.database.connection.prepare("SELECT id FROM taxi_trips WHERE driver_id = ? AND status IN ('accepted', 'active')").get(userId);
      if (trip) throw new DomainError(409, 'Finish or cancel your active taxi trip before accepting a citizen task.', 'trip_already_open');
      const now = new Date().toISOString();
      taskId = randomUUID();
      this.database.connection.prepare(`INSERT INTO citizen_tasks
        (id, owner_id, template_id, civic_incident_id, status, step_index, reward_lrd, accepted_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, NULL)`).run(taskId, userId, templateId, incidentId ?? null, definition.rewardLrd, now, now);
      if (incidentId) {
        const claimed = this.database.connection.prepare(`UPDATE civic_incidents SET status = 'assigned', assigned_task_id = ?
          WHERE id = ? AND template_id = ? AND status = 'open'`).run(taskId, incidentId, templateId);
        if (claimed.changes !== 1) throw new DomainError(409, 'This civic incident is already assigned or resolved.', 'civic_incident_unavailable');
      }
      this.recordRequest(requestId, userId, 'task.accept', requestTarget, now);
      this.database.audit(userId, 'citizen_task.accepted', { taskId, templateId, incidentId, requestId });
    });
    const task = taskId ? this.task(userId, taskId) : this.state(userId).activeTask;
    return this.result(userId, task, duplicate);
  }

  advance(userId: string, taskId: string, stepId: string, position: [number, number], requestId: string): CitizenTaskMutationResult {
    const target = `${taskId}:${stepId}`;
    let duplicate = false;
    this.database.transaction(() => {
      if (this.replay(requestId, userId, 'task.advance', target)) { duplicate = true; return; }
      const row = this.database.connection.prepare("SELECT * FROM citizen_tasks WHERE id = ? AND owner_id = ? AND status = 'active'").get(taskId, userId) as CitizenTaskRow | undefined;
      if (!row) throw new DomainError(409, 'This citizen task is not active.', 'invalid_task_state');
      const definition = getCitizenTaskDefinition(row.template_id);
      const step = definition.steps[row.step_index];
      if (!step) throw new DomainError(500, 'The saved task step is unavailable. Cancel this task and accept it again.', 'task_definition_changed');
      if (step.id !== stepId) throw new DomainError(409, 'Complete the current marked objective first.', 'wrong_task_step');
      this.validateInteraction(userId, step, position);
      const now = new Date().toISOString();
      const finalStep = row.step_index === definition.steps.length - 1;
      if (finalStep) {
        const changed = this.database.connection.prepare(`UPDATE citizen_tasks SET status = 'completed', step_index = step_index + 1,
          completed_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'active' AND step_index = ?`)
          .run(now, now, taskId, userId, row.step_index);
        if (changed.changes !== 1) throw new DomainError(409, 'Task state changed; no reward was paid.', 'invalid_task_state');
        if (row.civic_incident_id) {
          const resolved = this.database.connection.prepare(`UPDATE civic_incidents SET status = 'resolved', resolved_at = ?
            WHERE id = ? AND assigned_task_id = ? AND status = 'assigned'`).run(now, row.civic_incident_id, taskId);
          if (resolved.changes !== 1) throw new DomainError(409, 'The linked civic incident is no longer assigned to this task.', 'civic_incident_state');
        }
        this.credit(userId, row.reward_lrd, taskId, definition.title, now);
        this.database.audit(userId, 'citizen_task.completed_paid', { taskId, templateId: row.template_id, rewardLrd: row.reward_lrd, requestId });
      } else {
        const changed = this.database.connection.prepare(`UPDATE citizen_tasks SET step_index = step_index + 1, updated_at = ?
          WHERE id = ? AND owner_id = ? AND status = 'active' AND step_index = ?`).run(now, taskId, userId, row.step_index);
        if (changed.changes !== 1) throw new DomainError(409, 'Task state changed; please retry.', 'invalid_task_state');
        this.database.audit(userId, 'citizen_task.step_completed', { taskId, stepId, nextStepIndex: row.step_index + 1, requestId });
      }
      this.recordRequest(requestId, userId, 'task.advance', target, now);
    });
    return this.result(userId, this.task(userId, taskId), duplicate);
  }

  cancel(userId: string, taskId: string, requestId: string): CitizenTaskMutationResult {
    let duplicate = false;
    this.database.transaction(() => {
      if (this.replay(requestId, userId, 'task.cancel', taskId)) { duplicate = true; return; }
      const row = this.database.connection.prepare('SELECT * FROM citizen_tasks WHERE id = ? AND owner_id = ?').get(taskId, userId) as CitizenTaskRow | undefined;
      if (!row) throw new DomainError(404, 'Citizen task not found.', 'task_not_found');
      if (row.status === 'completed') throw new DomainError(409, 'A completed citizen task cannot be cancelled.', 'invalid_task_state');
      const now = new Date().toISOString();
      if (row.status === 'cancelled') duplicate = true;
      else {
        const changed = this.database.connection.prepare("UPDATE citizen_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'active'")
          .run(now, taskId, userId);
        if (changed.changes !== 1) throw new DomainError(409, 'Task state changed; please refresh.', 'invalid_task_state');
        if (row.civic_incident_id) {
          this.database.connection.prepare(`UPDATE civic_incidents SET status = 'open', assigned_task_id = NULL
            WHERE id = ? AND assigned_task_id = ? AND status = 'assigned'`).run(row.civic_incident_id, taskId);
        }
        this.database.audit(userId, 'citizen_task.cancelled', { taskId, requestId });
      }
      this.recordRequest(requestId, userId, 'task.cancel', taskId, now);
    });
    return this.result(userId, this.task(userId, taskId), duplicate);
  }

  private validateInteraction(userId: string, step: CitizenTaskStep, position: [number, number]) {
    const reported = { x: position[0], z: position[1] };
    if (!isInWorld(reported)) throw new DomainError(400, 'The reported objective position is outside the district.', 'invalid_position');
    const state = this.presence.recent(userId);
    if (!state) throw new DomainError(409, 'Realtime walking position is unavailable. Reconnect and approach the objective again.', 'position_stale');
    if (state.mode !== 'walking' || state.interiorPropertyId) {
      throw new DomainError(409, 'Citizen task objectives must be completed outside and on foot.', 'on_foot_required');
    }
    if (Math.abs(state.speed) > 3.5) throw new DomainError(409, 'Stop moving before completing this objective.', 'task_moving');
    if (distance2D(reported, step) > CITIZEN_TASK_INTERACTION_RADIUS) {
      throw new DomainError(409, 'Walk to the marked objective before interacting.', 'wrong_location');
    }
    const authoritative = { x: state.position[0], z: state.position[2] };
    if (distance2D(authoritative, step) > CITIZEN_TASK_INTERACTION_RADIUS + 1.1 || distance2D(authoritative, reported) > 4) {
      throw new DomainError(409, 'Your live position does not match the objective. Move closer and try again.', 'position_mismatch');
    }
  }

  private credit(userId: string, amount: number, taskId: string, title: string, now: string) {
    const changed = this.database.connection.prepare('UPDATE player_wallets SET balance_lrd = balance_lrd + ?, updated_at = ? WHERE user_id = ?').run(amount, now, userId);
    if (changed.changes !== 1) throw new DomainError(500, 'Wallet update failed; the task reward was not recorded.', 'wallet_error');
    const wallet = this.database.connection.prepare('SELECT balance_lrd FROM player_wallets WHERE user_id = ?').get(userId) as { balance_lrd: number };
    this.database.connection.prepare(`INSERT INTO ledger_transactions
      (id, user_id, amount_lrd, balance_after_lrd, kind, reference, description, created_at)
      VALUES (?, ?, ?, ?, 'citizen_task', ?, ?, ?)`)
      .run(randomUUID(), userId, amount, wallet.balance_lrd, `citizen-task:${taskId}`, `${title} · Community reward`, now);
  }

  private replay(requestId: string, userId: string, kind: string, target: string): boolean {
    const previous = this.database.connection.prepare('SELECT user_id, kind, target FROM citizen_task_requests WHERE request_id = ?').get(requestId) as TaskRequestRow | undefined;
    if (!previous) return false;
    if (previous.user_id !== userId || previous.kind !== kind || previous.target !== target) {
      throw new DomainError(409, 'That request identifier was already used for another task operation.', 'request_reused');
    }
    return true;
  }

  private recordRequest(requestId: string, userId: string, kind: string, target: string, now: string) {
    this.database.connection.prepare('INSERT INTO citizen_task_requests (request_id, user_id, kind, target, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(requestId, userId, kind, target, now);
  }

  private task(userId: string, taskId: string): CitizenTask | null {
    const row = this.database.connection.prepare('SELECT * FROM citizen_tasks WHERE id = ? AND owner_id = ?').get(taskId, userId) as CitizenTaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  private result(userId: string, task: CitizenTask | null, duplicate: boolean): CitizenTaskMutationResult {
    return { ...this.state(userId), task, wallet: this.players.wallet(userId), duplicate };
  }

  private mapTask(row: CitizenTaskRow): CitizenTask {
    return {
      id: row.id, templateId: row.template_id, incidentId: row.civic_incident_id, status: row.status, stepIndex: Number(row.step_index), rewardLrd: Number(row.reward_lrd),
      acceptedAt: row.accepted_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    };
  }
}
