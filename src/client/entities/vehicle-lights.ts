import * as THREE from 'three';

/** Two real forward spotlights plus emissive headlamp materials for a vehicle. */
export class VehicleHeadlights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.SpotLight[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private on = false;

  configure(size: THREE.Vector3) {
    this.group.clear();
    this.lights.length = 0;
    for (const side of [-1, 1]) {
      const x = side * size.x * 0.3;
      const light = new THREE.SpotLight('#fff0c2', 95, 46, Math.PI / 7, 0.55, 1.35);
      light.position.set(x, Math.min(0.86, size.y * 0.55), size.z * 0.5 - 0.12);
      light.castShadow = false;
      const target = new THREE.Object3D();
      target.position.set(x, 0.08, size.z * 0.5 + 17);
      light.target = target;
      this.group.add(light, target);
      this.lights.push(light);
    }
    this.set(this.on);
  }

  collectMaterials(model: THREE.Object3D) {
    this.materials.length = 0;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial && material.name.toLowerCase().includes('headlight')) {
          material.emissive.set('#fff0c2');
          this.materials.push(material);
        }
      }
    });
    this.set(this.on);
  }

  set(on: boolean) {
    this.on = on;
    this.group.visible = on;
    for (const light of this.lights) light.visible = on;
    for (const material of this.materials) material.emissiveIntensity = on ? 3.2 : 0.28;
  }

  get enabled() { return this.on; }

  dispose() {
    this.group.clear();
    this.lights.length = 0;
    this.materials.length = 0;
  }
}
