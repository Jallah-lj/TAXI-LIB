import { describe, expect, it } from 'vitest';
import { routeBetween, routeDistance } from '../src/shared/navigation';
import { distance2D, getLocation, ROAD_EDGES, ROAD_NODES, WORLD_LOCATIONS } from '../src/shared/world';
import { quoteFare } from '../src/shared/simulation';
import { citizenTaskRoutePoint, type CitizenTask } from '../src/shared/tasks';

 describe('road navigation', () => {
  it('uses the actual connected road graph for every destination pair', () => {
    for (const pickup of WORLD_LOCATIONS) {
      for (const destination of WORLD_LOCATIONS) {
        if (pickup.id === destination.id) continue;
        const route = routeBetween(pickup, destination);
        expect(route.length).toBeGreaterThan(1);
        expect(route[0]).toEqual({ x: pickup.x, z: pickup.z });
        expect(route.at(-1)).toEqual({ x: destination.x, z: destination.z });
        expect(routeDistance(pickup, destination)).toBeGreaterThanOrEqual(distance2D(pickup, destination));
      }
    }
  });

  it('has reciprocal, finite road edges with real endpoints', () => {
    for (const edge of ROAD_EDGES) {
      const from = ROAD_NODES.find((node) => node.id === edge.from);
      const to = ROAD_NODES.find((node) => node.id === edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      expect(distance2D(from!, to!)).toBeGreaterThan(0);
    }
  });

  it('routes a market trip to a valid destination', () => {
    expect(getLocation('sinkor-market').name).toBe('Sinkor Market');
    expect(routeDistance(getLocation('taxi-stand'), getLocation('sinkor-market'))).toBeGreaterThan(100);
  });

  it('routes active citizen work to the exact object rather than the location center', () => {
    const task: CitizenTask = {
      id: 'task-route', templateId: 'market-restock', incidentId: null, status: 'active', stepIndex: 0, rewardLrd: 650,
      acceptedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), completedAt: null,
    };
    const collection = citizenTaskRoutePoint(task, 'cooperative-garage')!;
    expect(collection).toMatchObject({ id: 'collect-provisions', x: 102, z: 82 });
    expect(collection).not.toMatchObject({ x: getLocation('cooperative-garage').x });
    expect(routeBetween(getLocation('taxi-stand'), collection).at(-1)).toEqual({ x: 102, z: 82 });
    task.stepIndex = 1;
    expect(citizenTaskRoutePoint(task, 'sinkor-market')).toMatchObject({ id: 'stock-stall', x: -20, z: -82 });
    expect(citizenTaskRoutePoint(task, 'taxi-stand')).toBeNull();
    task.status = 'completed';
    expect(citizenTaskRoutePoint(task, 'sinkor-market')).toBeNull();
  });
});

describe('simulation fares', () => {
  it('charges a bounded rain premium without client input', () => {
    const clear = quoteFare(500, 0);
    const rain = quoteFare(500, 1);
    expect(clear).toBeGreaterThan(250);
    expect(rain).toBeGreaterThan(clear);
    expect(rain / clear).toBeLessThan(1.2);
  });
});
