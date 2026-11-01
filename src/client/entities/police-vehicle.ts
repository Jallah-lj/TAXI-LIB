import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeTextTexture } from '../world/materials';

/** Original community-patrol accessories; no emergency pursuit or weapons behavior is implied. */
export class PoliceVehicleRig {
  readonly group = new THREE.Group();
  private readonly redMaterial = new THREE.MeshStandardMaterial({ color: '#a8212c', emissive: '#ff2638', emissiveIntensity: 0.3, roughness: 0.28 });
  private readonly blueMaterial = new THREE.MeshStandardMaterial({ color: '#184c9c', emissive: '#287cff', emissiveIntensity: 0.3, roughness: 0.28 });
  private readonly redLight = new THREE.PointLight('#ff3040', 0, 8, 2);
  private readonly blueLight = new THREE.PointLight('#3284ff', 0, 8, 2);
  private readonly phase: number;

  constructor(phase = 0) {
    this.phase = phase;
    this.group.name = 'Community police lightbar and markings';
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(1.16, 0.09, 0.3, 2, 0.025),
      new THREE.MeshStandardMaterial({ color: '#202b2e', roughness: 0.5, metalness: 0.45 }),
    );
    base.position.y = 1.82;
    const red = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.15, 0.25, 2, 0.025), this.redMaterial);
    red.position.set(-0.29, 1.92, 0);
    const blue = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.15, 0.25, 2, 0.025), this.blueMaterial);
    blue.position.set(0.29, 1.92, 0);
    this.redLight.position.set(-0.3, 2.02, 0);
    this.blueLight.position.set(0.3, 2.02, 0);
    this.redLight.castShadow = false;
    this.blueLight.castShadow = false;
    this.group.add(base, red, blue, this.redLight, this.blueLight);

    const texture = makeTextTexture('POLICE', { width: 512, height: 128, background: '#e6ebe7', color: '#173c4d', subtitle: 'COMMUNITY SAFETY' });
    const decalMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.32), decalMaterial);
      decal.position.set(side * 1.025, 0.94, -0.15);
      decal.rotation.y = side * Math.PI / 2;
      this.group.add(decal);
    }
  }

  update(timeSeconds: number) {
    const redActive = Math.floor(timeSeconds * 4 + this.phase) % 2 === 0;
    this.redMaterial.emissiveIntensity = redActive ? 4.2 : 0.18;
    this.blueMaterial.emissiveIntensity = redActive ? 0.18 : 4.2;
    this.redLight.intensity = redActive ? 9 : 0;
    this.blueLight.intensity = redActive ? 0 : 9;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        if (material instanceof THREE.MeshBasicMaterial && material.map) textures.add(material.map);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    this.group.clear();
  }
}
