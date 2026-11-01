import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { CitizenTaskService } from '../src/server/services/citizen-task-service';
import { CivicService } from '../src/server/services/civic-service';
import { CIVIC_REPORT_SITES, getCivicReportSite, validateCivicCatalog } from '../src/shared/civic';
import { getCitizenTaskDefinition, validateCitizenTaskCatalog, type CitizenTaskStep } from '../src/shared/tasks';
import type { Point2 } from '../src/shared/world';

function walkTo(presence: PresenceService, playerId: string, target: Point2, startSequence = 100) {
  let state = presence.recent(playerId);
  if (!state) throw new Error('No walking presence');
  let sequence = startSequence;
  while (Math.hypot(state.position[0] - target.x, state.position[2] - target.z) > 0.2) {
    const dx = target.x - state.position[0];
    const dz = target.z - state.position[2];
    const distance = Math.hypot(dx, dz);
    const step = Math.min(1.5, distance);
    const next: [number, number, number] = [state.position[0] + dx / distance * step, 0.14, state.position[2] + dz / distance * step];
    const accepted = presence.update(playerId, { position: next, heading: Math.atan2(dx, dz), speed: 0, mode: 'walking', sequence: ++sequence }, new Set());
    if (!accepted) throw new Error('Walking movement was rejected');
    state = accepted;
  }
  return sequence;
}

describe('authoritative civic operations', () => {
  let database: Database;
  let players: PlayerService;
  let presence: PresenceService;
  let tasks: CitizenTaskService;
  let civic: CivicService;
  let playerId: string;
  let secondPlayerId: string;

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    const auth = new AuthService(database);
    players = new PlayerService(database, auth);
    presence = new PresenceService();
    tasks = new CitizenTaskService(database, players, presence);
    civic = new CivicService(database, players, presence);
    tasks.bootstrap();
    civic.bootstrap();
    playerId = (await auth.register('civic_worker', 'correct-horse', 'Civic Worker')).userId;
    secondPlayerId = (await auth.register('second_civic', 'correct-horse', 'Second Civic')).userId;
    presence.join(auth.profile(playerId));
    presence.join(auth.profile(secondPlayerId));
  });

  afterEach(() => database.close());

  it('keeps civic sites, workers and incident task definitions consistent', () => {
    expect(validateCivicCatalog()).toEqual([]);
    expect(validateCitizenTaskCatalog()).toEqual([]);
    expect(civic.incidents()).toHaveLength(4);
    for (const site of CIVIC_REPORT_SITES) {
      const definition = getCitizenTaskDefinition(site.templateId);
      expect(definition.incidentKind).toBe(site.kind);
      expect(definition.steps[0]).toMatchObject({ x: site.x, z: site.z, locationId: site.locationId });
    }
  });

  it('reports nearby issues, claims exclusively, releases on cancel and resolves with one reward', () => {
    const site = getCivicReportSite('beach-obstruction')!;
    expect(() => civic.report(playerId, site.id, randomUUID())).toThrow(/Walk to the civic issue/);
    const sequence = walkTo(presence, playerId, site);
    const requestId = randomUUID();
    const reported = civic.report(playerId, site.id, requestId);
    const incident = reported.incidents.find((entry) => entry.siteId === site.id && entry.status === 'open')!;
    expect(incident.reportedBy).toBe('Civic Worker');
    expect(reported.duplicate).toBe(false);
    expect(civic.report(playerId, site.id, requestId).duplicate).toBe(true);
    expect(civic.incidents().filter((entry) => entry.siteId === site.id)).toHaveLength(1);

    const accepted = tasks.accept(playerId, incident.templateId, randomUUID(), incident.id);
    const taskId = accepted.task!.id;
    expect(accepted.activeTask).toMatchObject({ incidentId: incident.id, stepIndex: 0 });
    expect(civic.incidents().find((entry) => entry.id === incident.id)?.status).toBe('assigned');
    expect(() => tasks.accept(secondPlayerId, incident.templateId, randomUUID(), incident.id)).toThrow(/already assigned or resolved/);

    tasks.cancel(playerId, taskId, randomUUID());
    expect(civic.incidents().find((entry) => entry.id === incident.id)?.status).toBe('open');
    expect(players.wallet(playerId).balanceLrd).toBe(12500);

    const reclaimed = tasks.accept(playerId, incident.templateId, randomUUID(), incident.id);
    const step = getCitizenTaskDefinition(incident.templateId).steps[0] as CitizenTaskStep;
    walkTo(presence, playerId, step, sequence + 100);
    const completionRequest = randomUUID();
    const completed = tasks.advance(playerId, reclaimed.task!.id, step.id, [step.x, step.z], completionRequest);
    expect(completed).toMatchObject({ activeTask: null, task: { status: 'completed' }, wallet: { balanceLrd: 12700 } });
    expect(civic.incidents().find((entry) => entry.id === incident.id)?.status).toBe('resolved');
    expect(tasks.advance(playerId, reclaimed.task!.id, step.id, [step.x, step.z], completionRequest).duplicate).toBe(true);
    expect(players.wallet(playerId).balanceLrd).toBe(12700);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'citizen_task')).toHaveLength(1);
  });

  it('plays the municipal market inspection through three live objectives and pays once', () => {
    const definition = getCitizenTaskDefinition('market-standards-inspection');
    const accepted = tasks.accept(playerId, definition.id, randomUUID());
    const taskId = accepted.task!.id;
    let sequence = 500;
    let completionRequest = '';
    for (const step of definition.steps) {
      sequence = walkTo(presence, playerId, step, sequence);
      completionRequest = randomUUID();
      const result = tasks.advance(playerId, taskId, step.id, [step.x, step.z], completionRequest);
      expect(result.duplicate).toBe(false);
    }
    const completed = tasks.state(playerId);
    expect(completed.activeTask).toBeNull();
    expect(completed.taskStats).toEqual({ completed: 1, earnedLrd: 550 });
    expect(players.wallet(playerId).balanceLrd).toBe(13050);
    const finalStep = definition.steps.at(-1)!;
    expect(tasks.advance(playerId, taskId, finalStep.id, [finalStep.x, finalStep.z], completionRequest).duplicate).toBe(true);
    expect(players.wallet(playerId).balanceLrd).toBe(13050);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'citizen_task')).toHaveLength(1);
  });

  it('requires an open incident for incident-only templates', () => {
    expect(() => tasks.accept(playerId, 'civic-market-litter-response', randomUUID())).toThrow(/open civic incident/);
  });
});
