import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadVehicleTemplate, type VehicleModelKind } from '../assets/model-library';
import { makeNameSprite, makeTextTexture } from '../world/materials';
import type { PlayerVehicle } from '../../shared/types';
import { VEHICLE_CATALOG, type VehiclePaintFinish } from '../../shared/catalog';
import { applyVehicleAppearance } from './vehicle-appearance';
import { cloneMeshMaterials, disposeModelInstance, normalizeModel } from './model-utils';
import { ProceduralVehicle } from './procedural-vehicle';
import { ModernVehicle } from './modern-vehicle';
import { rigVehicleWheels } from './vehicle-wheels';
import { VehicleHeadlights } from './vehicle-lights';

export class VehicleEntity {
  readonly group = new THREE.Group();
  readonly nameSprite?: THREE.Sprite;
  private fallback?: ProceduralVehicle | ModernVehicle;
  private model?: THREE.Group;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly frontWheelPivots: THREE.Group[] = [];
  private wheelRadius = 0.34;
  private wheelSpin = 0;
  private disposed = false;
  private readonly lightRig = new VehicleHeadlights();
  readonly ready: Promise<void>;

  constructor(
    public color = '#e9ad32',
    readonly taxi = true,
    name?: string,
    readonly minibus = false,
    readonly modelKind: VehicleModelKind = minibus ? 'minibus' : 'sedan',
    readonly plate = 'LR • TAXI',
    private finish: VehiclePaintFinish = 'gloss',
  ) {
    const modern = modelKind === 'modern-sedan' || modelKind === 'modern-suv';
    const fallback: ProceduralVehicle | ModernVehicle = modern
      ? new ModernVehicle(color, modelKind, taxi)
      : new ProceduralVehicle(color, taxi, undefined, minibus);
    this.fallback = fallback;
    this.group.add(fallback.group);
    applyVehicleAppearance(fallback.group, color, finish);
    const size = fallback instanceof ModernVehicle
      ? fallback.size
      : new THREE.Vector3(minibus ? 2.05 : 1.85, minibus ? 2.2 : 1.5, minibus ? 5.3 : 4.25);
    this.lightRig.configure(size);
    this.group.add(this.lightRig.group);
    if (name) {
      this.nameSprite = makeNameSprite(name, '#f2c55d');
      this.nameSprite.position.y = fallback instanceof ModernVehicle ? size.y + (taxi ? 0.85 : 0.55) : minibus ? 2.9 : 2.4;
      this.group.add(this.nameSprite);
    }
    if (fallback instanceof ModernVehicle) {
      this.lightRig.collectMaterials(fallback.group);
      this.addAccessories(fallback.group, size);
      this.ready = Promise.resolve();
    } else {
      this.ready = loadVehicleTemplate(modelKind).then((template) => this.installModel(template)).catch((error: unknown) => {
        // The procedural vehicle remains fully playable if a detailed asset is unavailable.
        console.warn(`Using procedural ${modelKind} fallback:`, error);
      });
    }
  }

  private installModel(template: THREE.Group) {
    if (this.disposed || !this.fallback) return;
    const content = cloneSkeleton(template) as THREE.Group;
    cloneMeshMaterials(content);
    const targetLength = this.modelKind === 'minibus' ? 5.3 : this.modelKind === 'hatchback' ? 4.25 : 4.55;
    const normalized = normalizeModel(content, { length: targetLength });
    const model = normalized.root;
    model.name = `Realistic ${this.modelKind}`;
    this.customizePaint(model);
    const wheelRig = rigVehicleWheels(model);
    this.wheels.push(...wheelRig.wheels);
    this.frontWheelPivots.push(...wheelRig.frontWheelPivots);
    this.wheelRadius = wheelRig.radius;
    if (this.wheels.length !== 4 || this.frontWheelPivots.length !== 2) throw new Error(`${this.modelKind} does not expose a usable four-wheel rig.`);
    this.addAccessories(model, normalized.size);

    this.group.remove(this.fallback.group);
    this.fallback.dispose();
    this.fallback = undefined;
    this.model = model;
    this.group.add(model);
    if (this.nameSprite) this.nameSprite.position.y = normalized.size.y + (this.taxi ? 0.85 : 0.55);
    this.lightRig.configure(normalized.size);
    this.lightRig.collectMaterials(model);
  }

  private customizePaint(model: THREE.Group) {
    applyVehicleAppearance(model, this.color, this.finish);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name.toLowerCase().includes('glass'))) object.castShadow = false;
    });
  }

  setAppearance(color: string, finish: VehiclePaintFinish) {
    this.color = color;
    this.finish = finish;
    if (this.fallback) applyVehicleAppearance(this.fallback.group, color, finish);
    if (this.model) applyVehicleAppearance(this.model, color, finish);
  }

  private ownMesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.taxiLibOwnsGeometry = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private addAccessories(model: THREE.Group, size: THREE.Vector3) {
    const accessories = new THREE.Group();
    accessories.name = 'Taxi accessories';
    if (this.taxi) {
      const sign = new THREE.Group();
      sign.position.set(0, size.y + 0.13, -0.12);
      const body = this.ownMesh(
        new RoundedBoxGeometry(0.72, 0.25, 0.27, 3, 0.035),
        new THREE.MeshStandardMaterial({ color: '#edbc45', roughness: 0.5 }),
      );
      sign.add(body);
      const texture = makeTextTexture('TAXI', { width: 256, height: 96, background: '#edbc45', color: '#17302f' });
      for (const side of [-1, 1]) {
        const labelMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 });
        labelMaterial.userData.taxiLibOwnsTexture = true;
        const label = this.ownMesh(new THREE.PlaneGeometry(0.57, 0.16), labelMaterial);
        label.position.z = side * 0.137;
        if (side < 0) label.rotation.y = Math.PI;
        sign.add(label);
      }
      accessories.add(sign);
    }

    for (const side of [-1, 1]) {
      const plateTexture = makeTextTexture(this.plate, { width: 320, height: 88, background: '#eee9d9', color: '#203634' });
      const plateMaterial = new THREE.MeshBasicMaterial({ map: plateTexture, side: THREE.DoubleSide });
      plateMaterial.userData.taxiLibOwnsTexture = true;
      const plate = this.ownMesh(new THREE.PlaneGeometry(0.58, 0.18), plateMaterial);
      plate.position.set(0, this.minibus ? 0.67 : 0.5, side * (size.z * 0.5 + 0.018));
      if (side < 0) plate.rotation.y = Math.PI;
      accessories.add(plate);
    }
    model.add(accessories);
  }

  setLights(on: boolean) { this.lightRig.set(on); }

  get collisionBounds() {
    return {
      halfWidth: this.minibus ? 1.15 : this.modelKind === 'modern-suv' ? 1.1 : 1.02,
      halfLength: this.minibus ? 2.78 : this.modelKind === 'modern-sedan' || this.modelKind === 'modern-suv' ? 2.48 : this.modelKind === 'hatchback' ? 2.25 : 2.4,
    };
  }

  update(dt: number, speed: number, steering = 0) {
    if (this.fallback) {
      this.fallback.update(dt, speed, steering);
      return;
    }
    if (!this.model) return;
    this.wheelSpin += speed * dt / this.wheelRadius;
    for (const wheel of this.wheels) wheel.rotation.z = -this.wheelSpin;
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = steering * 0.42;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fallback?.dispose();
    this.lightRig.dispose();
    if (this.model) disposeModelInstance(this.model);
    if (this.nameSprite) {
      this.nameSprite.material.map?.dispose();
      this.nameSprite.material.dispose();
    }
  }

  static fromPlayerVehicle(vehicle: PlayerVehicle, name?: string) {
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === vehicle.modelId);
    const visual = listing?.visual ?? 'sedan';
    const minibus = visual === 'minibus';
    return new VehicleEntity(vehicle.color, vehicle.taxi, name, minibus, visual, vehicle.plate, vehicle.finish);
  }
}
