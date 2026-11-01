import * as THREE from 'three';

export interface VehicleWheelRig {
  wheels: THREE.Object3D[];
  frontWheelPivots: THREE.Group[];
  radius: number;
}

/** Adds independent steering pivots while preserving each source wheel's world transform. */
export function rigVehicleWheels(model: THREE.Group): VehicleWheelRig {
  model.updateMatrixWorld(true);
  const inverseModel = model.matrixWorld.clone().invert();
  const sourceWheels: THREE.Object3D[] = [];
  model.traverse((object) => {
    if (/^wheel_(?:LF|LB|RF|RB)$/i.test(object.name)) sourceWheels.push(object);
  });
  const wheels: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Group[] = [];
  let radiusTotal = 0;
  for (const wheel of sourceWheels) {
    if (!wheel.parent) continue;
    const position = wheel.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseModel);
    // normalizeModel grounds the vehicle, so the wheel center's height is the
    // rolling radius. Some source wheel groups also contain suspension/brake
    // geometry, which makes their full bounding box taller than the tire.
    radiusTotal += Math.max(0.05, position.y);
    const pivot = new THREE.Group();
    pivot.name = `${wheel.name}_steering`;
    wheel.parent.add(pivot);
    pivot.position.copy(wheel.position);
    pivot.quaternion.copy(wheel.quaternion);
    pivot.scale.copy(wheel.scale);
    wheel.position.set(0, 0, 0);
    wheel.quaternion.identity();
    wheel.scale.set(1, 1, 1);
    pivot.add(wheel);
    wheels.push(wheel);
    // The source names use its original coordinate system. After normalization
    // +Z is forward, so model Z is the reliable front-wheel classifier.
    if (position.z > 0) frontWheelPivots.push(pivot);
  }
  return { wheels, frontWheelPivots, radius: sourceWheels.length ? Math.max(0.2, radiusTotal / sourceWheels.length) : 0.34 };
}
