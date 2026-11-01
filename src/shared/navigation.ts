import { ROAD_EDGES, ROAD_NODES, distance2D, type Point2 } from './world.js';

interface QueueEntry { id: string; cost: number }

const adjacency = new Map<string, { id: string; cost: number }[]>();
for (const node of ROAD_NODES) adjacency.set(node.id, []);
for (const edge of ROAD_EDGES) {
  const from = ROAD_NODES.find((node) => node.id === edge.from);
  const to = ROAD_NODES.find((node) => node.id === edge.to);
  if (!from || !to) continue;
  const cost = distance2D(from, to);
  adjacency.get(edge.from)?.push({ id: edge.to, cost });
  adjacency.get(edge.to)?.push({ id: edge.from, cost });
}

function nearestNode(point: Point2) {
  return ROAD_NODES.reduce((best, node) => distance2D(point, node) < distance2D(point, best) ? node : best);
}

function shortestNodePath(startId: string, endId: string): string[] {
  const costs = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, string>();
  const queue: QueueEntry[] = [{ id: startId, cost: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    if (current.id === endId) break;
    visited.add(current.id);
    for (const neighbor of adjacency.get(current.id) ?? []) {
      const nextCost = current.cost + neighbor.cost;
      if (nextCost < (costs.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
        costs.set(neighbor.id, nextCost);
        previous.set(neighbor.id, current.id);
        queue.push({ id: neighbor.id, cost: nextCost });
      }
    }
  }

  if (startId !== endId && !previous.has(endId)) return [startId];
  const path = [endId];
  let cursor = endId;
  while (cursor !== startId) {
    const parent = previous.get(cursor);
    if (!parent) return [startId];
    path.unshift(parent);
    cursor = parent;
  }
  return path;
}

export function routeBetween(start: Point2, end: Point2): Point2[] {
  const startNode = nearestNode(start);
  const endNode = nearestNode(end);
  const nodePath = shortestNodePath(startNode.id, endNode.id);
  const points: Point2[] = [{ x: start.x, z: start.z }];
  for (const id of nodePath) {
    const node = ROAD_NODES.find((entry) => entry.id === id);
    if (node) points.push({ x: node.x, z: node.z });
  }
  points.push({ x: end.x, z: end.z });
  return points.filter((point, index) => index === 0 || distance2D(point, points[index - 1]!) > 0.5);
}

export function routeDistance(start: Point2, end: Point2): number {
  const route = routeBetween(start, end);
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += distance2D(route[index - 1]!, route[index]!);
  }
  return total;
}
