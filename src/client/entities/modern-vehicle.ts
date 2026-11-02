import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ModernVehicleKind = 'modern-sedan' | 'modern-suv';

interface LoftSection {
  z: number;
  halfWidth: number;
  bottom: number;
  top: number;
}

/** Closed, bevel-like body loft. Sections run from the rear to the front of the vehicle. */
function loftGeometry(sections: readonly LoftSection[]) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const ringSize = 12;
  for (const section of sections) {
    const { z, halfWidth: w, bottom: b, top: t } = section;
    const ring = [
      [-w * 0.78, b], [w * 0.78, b], [w * 0.96, b + 0.05], [w, b + 0.16],
      [w, t - 0.18], [w * 0.96, t - 0.06], [w * 0.78, t], [-w * 0.78, t],
      [-w * 0.96, t - 0.06], [-w, t - 0.18], [-w, b + 0.16], [-w * 0.96, b + 0.05],
    ];
    for (const [x, y] of ring) vertices.push(x!, y!, z);
  }
  for (let section = 0; section < sections.length - 1; section += 1) {
    for (let index = 0; index < ringSize; index += 1) {
      const next = (index + 1) % ringSize;
      const a = section * ringSize + index;
      const b = section * ringSize + next;
      const c = (section + 1) * ringSize + next;
      const d = (section + 1) * ringSize + index;
      indices.push(a, b, d, b, c, d);
    }
  }
  const rearCenter = vertices.length / 3;
  const rear = sections[0]!;
  vertices.push(0, (rear.bottom + rear.top) / 2, rear.z);
  const frontCenter = vertices.length / 3;
  const front = sections.at(-1)!;
  vertices.push(0, (front.bottom + front.top) / 2, front.z);
  for (let index = 0; index < ringSize; index += 1) {
    const next = (index + 1) % ringSize;
    indices.push(rearCenter, next, index);
    const offset = (sections.length - 1) * ringSize;
    indices.push(frontCenter, offset + index, offset + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function cylinderGeometry(radius: number, width: number, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, segments);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

/**
 * Original modern vehicle geometry used directly in gameplay, not only in the showroom.
 * Forward is +Z, matching the existing vehicle controller and headlight rig.
 */
export class ModernVehicle {
  readonly group = new THREE.Group();
  readonly size: THREE.Vector3;
  private readonly wheels: THREE.Group[] = [];
  private readonly frontWheelPivots: THREE.Group[] = [];
  private readonly wheelRadius: number;
  private wheelSpin = 0;

  constructor(readonly color: string, readonly kind: ModernVehicleKind, readonly taxi = false) {
    const suv = kind === 'modern-suv';
    const length = suv ? 4.72 : 4.68;
    const width = suv ? 2.02 : 1.94;
    const roofHeight = suv ? 1.94 : 1.58;
    this.wheelRadius = suv ? 0.42 : 0.38;
    this.size = new THREE.Vector3(width, roofHeight, length);
    this.group.name = suv ? 'Modern urban SUV' : 'Modern sport sedan';

    const paint = new THREE.MeshPhysicalMaterial({ name: 'Paint', color, roughness: 0.24, metalness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    const darkPaint = new THREE.MeshStandardMaterial({ name: 'PaintSecondary', color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.34, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ name: 'Glass', color: '#183641', roughness: 0.08, metalness: 0.08, transparent: true, opacity: 0.82, clearcoat: 0.75, clearcoatRoughness: 0.08 });
    const graphite = new THREE.MeshStandardMaterial({ color: '#172022', roughness: 0.58, metalness: 0.32 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#111514', roughness: 0.96 });
    const alloy = new THREE.MeshStandardMaterial({ color: '#aeb9ba', roughness: 0.24, metalness: 0.86 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#d4d9d5', roughness: 0.2, metalness: 0.9 });
    const headlight = new THREE.MeshStandardMaterial({ name: 'HeadlightLED', color: '#e9f5ef', emissive: '#d8f1ef', emissiveIntensity: 0.28, roughness: 0.22 });
    const tailLight = new THREE.MeshStandardMaterial({ color: '#b62e35', emissive: '#8f101d', emissiveIntensity: 0.65, roughness: 0.28 });
    const upholstery = new THREE.MeshStandardMaterial({ color: '#252b2b', roughness: 0.88, metalness: 0.02 });

    const bodySections: LoftSection[] = suv ? [
      { z: -2.36, halfWidth: 0.78, bottom: 0.47, top: 0.86 },
      { z: -2.12, halfWidth: 0.98, bottom: 0.45, top: 1.11 },
      { z: -1.35, halfWidth: 1.01, bottom: 0.44, top: 1.17 },
      { z: 0.4, halfWidth: 1.01, bottom: 0.44, top: 1.16 },
      { z: 1.45, halfWidth: 0.98, bottom: 0.45, top: 1.08 },
      { z: 2.12, halfWidth: 0.9, bottom: 0.47, top: 0.91 },
      { z: 2.36, halfWidth: 0.75, bottom: 0.49, top: 0.76 },
    ] : [
      { z: -2.34, halfWidth: 0.73, bottom: 0.4, top: 0.7 },
      { z: -2.08, halfWidth: 0.94, bottom: 0.39, top: 0.91 },
      { z: -1.35, halfWidth: 0.97, bottom: 0.38, top: 1.0 },
      { z: 0.35, halfWidth: 0.97, bottom: 0.38, top: 1.01 },
      { z: 1.35, halfWidth: 0.94, bottom: 0.39, top: 0.91 },
      { z: 2.08, halfWidth: 0.86, bottom: 0.41, top: 0.75 },
      { z: 2.34, halfWidth: 0.69, bottom: 0.43, top: 0.63 },
    ];
    this.mesh(loftGeometry(bodySections), paint);

    const cabinSections: LoftSection[] = suv ? [
      { z: -1.72, halfWidth: 0.68, bottom: 1.03, top: 1.27 },
      { z: -1.38, halfWidth: 0.82, bottom: 1.06, top: 1.77 },
      { z: -0.65, halfWidth: 0.84, bottom: 1.08, top: 1.87 },
      { z: 0.55, halfWidth: 0.81, bottom: 1.07, top: 1.82 },
      { z: 1.15, halfWidth: 0.68, bottom: 1.02, top: 1.32 },
    ] : [
      { z: -1.46, halfWidth: 0.62, bottom: 0.91, top: 1.04 },
      { z: -1.05, halfWidth: 0.77, bottom: 0.94, top: 1.43 },
      { z: -0.42, halfWidth: 0.79, bottom: 0.96, top: 1.52 },
      { z: 0.35, halfWidth: 0.75, bottom: 0.95, top: 1.46 },
      { z: 1.02, halfWidth: 0.62, bottom: 0.9, top: 1.08 },
    ];
    const cabin = this.mesh(loftGeometry(cabinSections), glass);
    cabin.castShadow = false;

    // A restrained visible cabin gives the glazing depth without pretending
    // that the source models support a separate interior inspection mode.
    const seatBase = suv ? 1.05 : 0.91;
    for (const side of [-1, 1]) {
      this.rounded(0.46, 0.13, 0.5, upholstery, side * 0.38, seatBase, -0.12, 0.045);
      const seatBack = this.rounded(0.46, 0.5, 0.13, upholstery, side * 0.38, seatBase + 0.27, -0.39, 0.045);
      seatBack.rotation.x = -0.12;
      this.rounded(0.28, 0.18, 0.12, upholstery, side * 0.38, seatBase + 0.57, -0.43, 0.04);
    }
    this.rounded(1.25, 0.16, 0.44, upholstery, 0, seatBase + 0.02, -0.91, 0.05);
    this.rounded(width * 0.68, 0.18, 0.3, graphite, 0, seatBase + 0.18, 0.62, 0.04);
    const steering = this.mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), graphite);
    steering.position.set(-0.39, seatBase + 0.36, 0.43);
    steering.rotation.x = -0.28;

    const roof = this.rounded(width * (suv ? 0.67 : 0.63), 0.075, suv ? 1.9 : 1.18, paint, 0, roofHeight - 0.025, suv ? -0.35 : -0.3, 0.035);
    roof.castShadow = true;
    this.rounded(width * 0.96, 0.18, length * 0.79, graphite, 0, suv ? 0.47 : 0.4, 0, 0.055);
    this.rounded(width * 0.58, suv ? 0.28 : 0.22, 0.075, graphite, 0, suv ? 0.69 : 0.61, length / 2 + 0.025, 0.025);
    this.rounded(width * 0.68, 0.075, 0.08, chrome, 0, suv ? 0.51 : 0.46, length / 2 + 0.045, 0.018);

    for (const side of [-1, 1]) {
      const lampX = side * width * 0.29;
      this.rounded(width * 0.25, 0.085, 0.065, headlight, lampX, suv ? 0.94 : 0.82, length / 2 + 0.065, 0.022);
      this.rounded(0.26, 0.1, 0.28, darkPaint, side * (width / 2 + 0.035), suv ? 1.29 : 1.12, 0.62, 0.035);
      this.rounded(0.04, suv ? 0.66 : 0.46, 0.065, graphite, side * width * 0.405, suv ? 1.42 : 1.2, -0.35, 0.012);
      for (const z of [-0.55, 0.35]) {
        this.rounded(0.035, 0.055, 0.28, chrome, side * (width / 2 + 0.012), suv ? 1.07 : 0.96, z, 0.012);
        this.rounded(0.018, suv ? 0.5 : 0.38, 0.022, graphite, side * (width / 2 + 0.009), suv ? 0.77 : 0.67, z + 0.24, 0.005);
      }
      this.rounded(0.035, 0.055, length * 0.48, graphite, side * (width / 2 + 0.005), suv ? 0.5 : 0.43, -0.05, 0.01);
    }
    for (const side of [-1, 1]) {
      const wiper = this.rounded(0.46, 0.018, 0.026, graphite, side * 0.28, suv ? 1.12 : 0.99, suv ? 1.14 : 1.01, 0.006);
      wiper.rotation.y = side * 0.12;
    }
    for (let index = -3; index <= 3; index += 1) {
      this.rounded(0.026, suv ? 0.19 : 0.14, 0.025, chrome, index * width * 0.07, suv ? 0.69 : 0.61, length / 2 + 0.07, 0.006);
    }
    this.rounded(width * 0.65, 0.065, 0.055, tailLight, 0, suv ? 0.96 : 0.8, -length / 2 - 0.045, 0.018);

    if (suv) {
      for (const side of [-1, 1]) this.rounded(0.055, 0.09, 2.05, graphite, side * 0.58, 1.95, -0.35, 0.02);
      this.rounded(width * 0.88, 0.12, 0.24, graphite, 0, 0.5, 2.25, 0.03);
    } else {
      this.rounded(1.18, 0.055, 0.24, darkPaint, 0, 1.0, -1.91, 0.02);
    }

    for (const side of [-1, 1]) {
      for (const axle of [-1, 1]) {
        const front = axle > 0;
        const arch = this.mesh(new THREE.TorusGeometry(this.wheelRadius * 1.13, 0.035, 8, 28, Math.PI), graphite);
        arch.position.set(side * (width / 2 + 0.008), this.wheelRadius + (suv ? 0.09 : 0.065), axle * length * 0.32);
        arch.rotation.y = Math.PI / 2;
        const pivot = new THREE.Group();
        pivot.name = `${front ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}-steering`;
        pivot.position.set(side * width * 0.49, this.wheelRadius + (suv ? 0.09 : 0.065), axle * length * 0.32);
        const wheel = this.createWheel(this.wheelRadius, rubber, alloy, graphite, `${front ? 'F' : 'R'}${side < 0 ? 'L' : 'R'}`);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheels.push(wheel);
        if (front) this.frontWheelPivots.push(pivot);
      }
    }

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = object.material !== glass;
        object.receiveShadow = true;
      }
    });
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const mesh = new THREE.Mesh(geometry, material);
    this.group.add(mesh);
    return mesh;
  }

  private rounded(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, radius: number) {
    const mesh = this.mesh(new RoundedBoxGeometry(width, height, depth, 3, Math.min(radius, width / 3, height / 3, depth / 3)), material);
    mesh.position.set(x, y, z);
    return mesh;
  }

  private createWheel(radius: number, rubber: THREE.Material, alloy: THREE.Material, graphite: THREE.Material, name: string) {
    const wheel = new THREE.Group();
    wheel.name = `modern-wheel-${name}`;
    wheel.add(new THREE.Mesh(cylinderGeometry(radius, 0.28), rubber));
    wheel.add(new THREE.Mesh(cylinderGeometry(radius * 0.68, 0.292, 20), graphite));
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(cylinderGeometry(radius * 0.2, 0.025, 16), alloy);
      rim.position.x = side * 0.157;
      wheel.add(rim);
      for (let index = 0; index < 6; index += 1) {
        const angle = index * Math.PI / 3;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.025, radius * 0.11, radius * 0.57), alloy);
        spoke.position.set(side * 0.155, Math.sin(angle) * radius * 0.27, Math.cos(angle) * radius * 0.27);
        spoke.rotation.x = angle;
        wheel.add(spoke);
      }
    }
    return wheel;
  }

  update(dt: number, speed: number, steering = 0) {
    this.wheelSpin += speed * dt / this.wheelRadius;
    for (const wheel of this.wheels) wheel.rotation.x = -this.wheelSpin;
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = steering * 0.42;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    const textures = new Set<THREE.Texture>();
    materials.forEach((material) => {
      if (material.userData.taxiLibOwnsTexture && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) && material.map) textures.add(material.map);
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    this.group.clear();
  }
}
