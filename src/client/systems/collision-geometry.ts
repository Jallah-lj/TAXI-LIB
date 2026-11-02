export interface PlanePoint { x: number; z: number }
export interface BoxCollider { minX: number; maxX: number; minZ: number; maxZ: number }
export interface OrientedFootprint extends PlanePoint {
  heading: number;
  halfWidth: number;
  halfLength: number;
}

export function orientedCorners(box: OrientedFootprint): PlanePoint[] {
  const rightX = Math.cos(box.heading);
  const rightZ = -Math.sin(box.heading);
  const forwardX = Math.sin(box.heading);
  const forwardZ = Math.cos(box.heading);
  const corners: PlanePoint[] = [];
  for (const [side, front] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    corners.push({
      x: box.x + rightX * box.halfWidth * side + forwardX * box.halfLength * front,
      z: box.z + rightZ * box.halfWidth * side + forwardZ * box.halfLength * front,
    });
  }
  return corners;
}

function aabbCorners(box: BoxCollider): PlanePoint[] {
  return [
    { x: box.minX, z: box.minZ }, { x: box.maxX, z: box.minZ },
    { x: box.maxX, z: box.maxZ }, { x: box.minX, z: box.maxZ },
  ];
}

function axes(corners: PlanePoint[]) {
  return [0, 1].map((index) => {
    const first = corners[index]!;
    const second = corners[(index + 1) % corners.length]!;
    const x = second.x - first.x;
    const z = second.z - first.z;
    const length = Math.hypot(x, z) || 1;
    return { x: -z / length, z: x / length };
  });
}

function separatedOnAxis(first: PlanePoint[], second: PlanePoint[], axis: PlanePoint) {
  let firstMin = Infinity;
  let firstMax = -Infinity;
  let secondMin = Infinity;
  let secondMax = -Infinity;
  for (const point of first) {
    const projection = point.x * axis.x + point.z * axis.z;
    firstMin = Math.min(firstMin, projection); firstMax = Math.max(firstMax, projection);
  }
  for (const point of second) {
    const projection = point.x * axis.x + point.z * axis.z;
    secondMin = Math.min(secondMin, projection); secondMax = Math.max(secondMax, projection);
  }
  return firstMax <= secondMin || secondMax <= firstMin;
}

function polygonsIntersect(first: PlanePoint[], second: PlanePoint[]) {
  for (const axis of [...axes(first), ...axes(second)]) {
    if (separatedOnAxis(first, second, axis)) return false;
  }
  return true;
}

export function orientedBoxesIntersect(first: OrientedFootprint, second: OrientedFootprint) {
  return polygonsIntersect(orientedCorners(first), orientedCorners(second));
}

export function orientedBoxIntersectsAABB(oriented: OrientedFootprint, box: BoxCollider) {
  return polygonsIntersect(orientedCorners(oriented), aabbCorners(box));
}

export function circleIntersectsOrientedBox(x: number, z: number, radius: number, box: OrientedFootprint) {
  const dx = x - box.x;
  const dz = z - box.z;
  const localX = dx * Math.cos(box.heading) - dz * Math.sin(box.heading);
  const localZ = dx * Math.sin(box.heading) + dz * Math.cos(box.heading);
  const closestX = Math.max(-box.halfWidth, Math.min(box.halfWidth, localX));
  const closestZ = Math.max(-box.halfLength, Math.min(box.halfLength, localZ));
  return (localX - closestX) ** 2 + (localZ - closestZ) ** 2 < radius * radius;
}
