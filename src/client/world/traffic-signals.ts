import * as THREE from 'three';
import { SIGNALIZED_INTERSECTIONS, trafficSignalLamp, type TrafficAxis, type TrafficLamp } from '../../shared/traffic';
import type { CollisionWorld } from '../systems/collision';

interface SignalHead {
  intersectionId: string;
  axis: TrafficAxis;
  lamps: Record<TrafficLamp, THREE.MeshStandardMaterial>;
  active?: TrafficLamp;
}

const LAMP_COLORS: Record<TrafficLamp, { active: string; inactive: string }> = {
  red: { active: '#ff3d36', inactive: '#3d1818' },
  yellow: { active: '#ffc94d', inactive: '#3d3218' },
  green: { active: '#4fe28e', inactive: '#173d28' },
};

/** Physical signal poles and emissive heads driven by the same cycle used by traffic AI. */
export class TrafficSignals {
  private readonly heads: SignalHead[] = [];

  constructor(private readonly group: THREE.Group, collision: CollisionWorld) {
    const poleGeometry = new THREE.CylinderGeometry(0.09, 0.13, 4.8, 8);
    const headGeometry = new THREE.BoxGeometry(0.58, 1.2, 0.3);
    const bulbGeometry = new THREE.CircleGeometry(0.17, 16);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: '#3e4a47', roughness: 0.62, metalness: 0.42 });
    const headMaterial = new THREE.MeshStandardMaterial({ color: '#161e1e', roughness: 0.72, metalness: 0.18 });

    for (const intersection of SIGNALIZED_INTERSECTIONS) {
      const approaches: { dx: number; dz: number; rotation: number; axis: TrafficAxis }[] = [
        { dx: 11, dz: 11, rotation: -Math.PI / 2, axis: 'horizontal' },
        { dx: -11, dz: -11, rotation: Math.PI / 2, axis: 'horizontal' },
        { dx: 11, dz: -11, rotation: 0, axis: 'vertical' },
        { dx: -11, dz: 11, rotation: Math.PI, axis: 'vertical' },
      ];
      for (const approach of approaches) {
        const assembly = new THREE.Group();
        assembly.position.set(intersection.x + approach.dx, 0.12, intersection.z + approach.dz);
        assembly.rotation.y = approach.rotation;
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = 2.4;
        pole.castShadow = true;
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 4.85;
        head.castShadow = true;
        assembly.add(pole, head);
        const lamps = {} as Record<TrafficLamp, THREE.MeshStandardMaterial>;
        (['red', 'yellow', 'green'] as const).forEach((lamp, index) => {
          const material = new THREE.MeshStandardMaterial({
            color: LAMP_COLORS[lamp].inactive, emissive: LAMP_COLORS[lamp].active, emissiveIntensity: 0.02, roughness: 0.38,
          });
          const bulb = new THREE.Mesh(bulbGeometry, material);
          bulb.position.set(0, 5.23 - index * 0.38, 0.17);
          assembly.add(bulb);
          lamps[lamp] = material;
        });
        this.group.add(assembly);
        this.heads.push({ intersectionId: intersection.id, axis: approach.axis, lamps });
        collision.add(assembly.position.x, assembly.position.z, 0.32, 0.32);
      }
    }
  }

  update(serverTime: number) {
    for (const head of this.heads) {
      const active = trafficSignalLamp(head.axis, serverTime, head.intersectionId);
      if (head.active === active) continue;
      head.active = active;
      for (const lamp of ['red', 'yellow', 'green'] as const) {
        const material = head.lamps[lamp];
        const enabled = active === lamp;
        material.color.set(enabled ? LAMP_COLORS[lamp].active : LAMP_COLORS[lamp].inactive);
        material.emissiveIntensity = enabled ? 3.1 : 0.02;
      }
    }
  }
}
