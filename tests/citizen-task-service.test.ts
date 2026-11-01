import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { CitizenTaskService } from '../src/server/services/citizen-task-service';
import { getCitizenTaskDefinition, type CitizenTaskStep } from '../src/shared/tasks';

function walkTo(presence: PresenceService, playerId: string, target: CitizenTaskStep, startSequence: number) {
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

describe('authoritative citizen tasks', () => {
  let database: Database;
  let players: PlayerService;
  let presence: PresenceService;
  let tasks: CitizenTaskService;
  let playerId: string;

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    const auth = new AuthService(database);
    players = new PlayerService(database, auth);
    presence = new PresenceService();
    tasks = new CitizenTaskService(database, players, presence);
    playerId = (await auth.register('citizen_tasks', 'correct-horse', 'Citizen Tasks')).userId;
    presence.join(auth.profile(playerId));
  });

  afterEach(() => database.close());

  it('validates each live on-foot objective and pays the final reward exactly once', () => {
    const definition = getCitizenTaskDefinition('market-restock');
    const accepted = tasks.accept(playerId, definition.id, randomUUID());
    const taskId = accepted.task!.id;
    const first = definition.steps[0]!;
    expect(() => tasks.advance(playerId, taskId, first.id, [first.x, first.z], randomUUID())).toThrow(/live position does not match/);

    let sequence = walkTo(presence, playerId, first, 100);
    const firstRequest = randomUUID();
    const progressed = tasks.advance(playerId, taskId, first.id, [first.x, first.z], firstRequest);
    expect(progressed).toMatchObject({ duplicate: false, activeTask: { stepIndex: 1 }, wallet: { balanceLrd: 12500 } });
    expect(tasks.advance(playerId, taskId, first.id, [first.x, first.z], firstRequest).duplicate).toBe(true);
    expect(players.wallet(playerId).balanceLrd).toBe(12500);

    const final = definition.steps[1]!;
    sequence = walkTo(presence, playerId, final, sequence + 100);
    const finalRequest = randomUUID();
    const completed = tasks.advance(playerId, taskId, final.id, [final.x, final.z], finalRequest);
    expect(completed).toMatchObject({
      duplicate: false, activeTask: null, task: { status: 'completed', stepIndex: 2 },
      taskStats: { completed: 1, earnedLrd: 650 }, wallet: { balanceLrd: 13150 },
    });
    const replay = tasks.advance(playerId, taskId, final.id, [final.x, final.z], finalRequest);
    expect(replay.duplicate).toBe(true);
    expect(replay.wallet.balanceLrd).toBe(13150);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'citizen_task')).toHaveLength(1);
    expect(players.wallet(playerId).balanceLrd).toBe(13150);
  });
});
