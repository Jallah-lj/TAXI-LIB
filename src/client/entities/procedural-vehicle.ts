import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeNameSprite, makeTextTexture } from '../world/materials';

export class ProceduralVehicle {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly frontWheelPivots: THREE.Group[] = [];
  private wheelSpin = 0;
  readonly nameSprite?: THREE.Sprite;

  constructor(readonly color = '#e9ad32', readonly taxi = true, name?: string, readonly minibus = false) {
    const paint = new THREE.MeshPhysicalMaterial({ name: 'Paint', color, roughness: 0.24, metalness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    const darkPaint = new THREE.MeshStandardMaterial({ name: 'PaintSecondary', color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.34, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#18343a', roughness: 0.16, metalness: 0.5 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#181b1a', roughness: 0.95 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#b8b7ac', roughness: 0.3, metalness: 0.75 });
    const light = new THREE.MeshStandardMaterial({ color: '#f6e8b5', emissive: '#d5b865', emissiveIntensity: 0.25 });
    const redLight = new THREE.MeshStandardMaterial({ color: '#9d2e26', emissive: '#5d100c', emissiveIntensity: 0.2 });
    const length = minibus ? 5.3 : 4.25;
    const width = minibus ? 2.05 : 1.85;

    const chassis = new THREE.Mesh(new RoundedBoxGeometry(width, 0.48, length, 4, 0.12), paint);
    chassis.position.y = 0.66;
    this.group.add(chassis);
    const lower = new THREE.Mesh(new RoundedBoxGeometry(width * 0.97, 0.22, length * 0.96, 3, 0.07), darkPaint);
    lower.position.y = 0.43;
    this.group.add(lower);

    if (minibus) {
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.88, 1.45, 3.95, 3, 0.12), paint);
      cabin.position.set(0, 1.37, -0.25);
      this.group.add(cabin);
      for (const side of [-1, 1]) {
        for (let index = 0; index < 4; index += 1) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.63, 0.72), glass);
          window.position.set(side * 0.955, 1.57, -1.45 + index * 0.9);
          this.group.add(window);
        }
      }
    } else {
      const hood = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.25, 1.18, 3, 0.08), paint);
      hood.position.set(0, 0.97, 1.33);
      this.group.add(hood);
      const trunk = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.25, 0.88, 3, 0.08), paint);
      trunk.position.set(0, 0.96, -1.52);
      this.group.add(trunk);
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.82, 1.95, 3, 0.16), paint);
      cabin.position.set(0, 1.25, -0.16);
      this.group.add(cabin);
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.57, 0.035), glass);
      windshield.position.set(0, 1.35, 0.826);
      windshield.rotation.x = -0.17;
      this.group.add(windshield);
      const rearWindow = windshield.clone();
      rearWindow.position.z = -1.145;
      rearWindow.rotation.x = 0.17;
      this.group.add(rearWindow);
      for (const side of [-1, 1]) {
        for (const z of [-0.62, 0.33]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.51, 0.78), glass);
          window.position.set(side * 0.797, 1.37, z);
          this.group.add(window);
        }
        const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.12, 0.27, 2, 0.04), darkPaint);
        mirror.position.set(side * 1.01, 1.19, 0.55);
        this.group.add(mirror);
      }
    }

    for (const side of [-1, 1]) {
      for (const z of [length * 0.32, -length * 0.32]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * width * 0.51, 0.45, z);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.24, 16), rubber);
        wheel.rotation.z = Math.PI / 2;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.252, 10), chrome);
        hub.rotation.z = Math.PI / 2;
        wheel.add(hub);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheels.push(wheel);
        if (z > 0) this.frontWheelPivots.push(pivot);
      }
    }

    for (const x of [-0.58, 0.58]) {
      const headlamp = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.18, 0.06, 2, 0.03), light);
      headlamp.position.set(x, 0.82, length / 2 + 0.015);
      this.group.add(headlamp);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.06), redLight);
      tail.position.set(x, 0.82, -length / 2 - 0.015);
      this.group.add(tail);
    }
    for (const z of [length / 2 + 0.07, -length / 2 - 0.07]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.87, 0.1, 0.11), chrome);
      bumper.position.set(0, 0.48, z);
      this.group.add(bumper);
    }

    if (taxi) {
      const signMaterial = new THREE.MeshStandardMaterial({ map: makeTextTexture('TAXI', { width: 256, height: 96, background: '#edbc45', color: '#17302f' }), roughness: 0.55 });
      const sign = new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.29, 0.28, 2, 0.04), signMaterial);
      sign.position.set(0, minibus ? 2.23 : 1.82, -0.12);
      this.group.add(sign);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.018, 0.09, length * 0.75), new THREE.MeshStandardMaterial({ color: '#263c38' }));
      stripe.position.y = 0.72;
      this.group.add(stripe);
    }

    const plateMaterial = new THREE.MeshBasicMaterial({ map: makeTextTexture('LR • TAXI', { width: 256, height: 80, background: '#eee9d9', color: '#203634' }) });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.18), plateMaterial);
    plate.position.set(0, 0.61, -length / 2 - 0.13);
    plate.rotation.y = Math.PI;
    this.group.add(plate);

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    if (name) {
      this.nameSprite = makeNameSprite(name, '#f2c55d');
      this.nameSprite.position.y = minibus ? 2.9 : 2.4;
      this.group.add(this.nameSprite);
    }
  }

  update(dt: number, speed: number, steering = 0) {
    this.wheelSpin += speed * dt / 0.37;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = steering * 0.42;
  }

  dispose() {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
          material.dispose();
        }
      }
    });
    if (this.nameSprite) {
      this.nameSprite.material.map?.dispose();
      this.nameSprite.material.dispose();
    }
  }
}
