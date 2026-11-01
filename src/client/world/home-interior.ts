import * as THREE from 'three';
import type { PlayerProperty } from '../../shared/types';
import type { PropertyCatalogEntry } from '../../shared/catalog';
import { HOME_ENTRY_LOCAL, homeOrigin, homeRoomAt, homeRooms, type HomeRoomId, type HomeRoomDefinition } from '../../shared/homes';
import { CollisionWorld } from '../systems/collision';

/** A furnished, walkable local interior instance for one server-owned property. */
export class HomeInterior {
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  readonly rooms: readonly HomeRoomDefinition[];
  readonly origin: { x: number; z: number };
  private readonly roomLights: THREE.PointLight[] = [];
  private readonly bulbMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly levelTwo = new THREE.Group();
  private readonly levelThree = new THREE.Group();
  private lights = true;

  constructor(readonly property: PlayerProperty, readonly listing: PropertyCatalogEntry, private readonly scene: THREE.Scene) {
    this.origin = homeOrigin(listing);
    this.rooms = homeRooms(listing.id);
    this.group.name = `${listing.name} interior`;
    this.group.position.set(this.origin.x, 0.14, this.origin.z);
    this.buildArchitecture();
    this.buildLivingRoom();
    this.buildKitchen();
    this.buildBedroom();
    this.buildBathroom();
    this.buildUpgradeFurnishings();
    this.group.add(this.levelTwo, this.levelThree);
    this.setLevel(property.level);
    this.setLights(true);
    scene.add(this.group);
  }

  private material(color: string, roughness = 0.82, metalness = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  private box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Group = this.group, collide = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide && parent === this.group) this.collision.add(this.origin.x + x, this.origin.z + z, width, depth);
    return mesh;
  }

  private wall(x: number, z: number, width: number, depth: number, material: THREE.Material) {
    return this.box(width, 2.75, depth, material, x, 1.375, z, this.group, true);
  }

  private buildArchitecture() {
    const coastal = this.listing.id === 'coastal-cottage';
    const wall = this.material(coastal ? '#e5e1d4' : '#ded8c9', 0.94);
    const trim = this.material('#f3efe4', 0.75);
    const floor = this.material(coastal ? '#b89d79' : '#a98c68', 0.88);
    const tile = this.material('#b9c7c3', 0.72);
    this.box(14, 0.12, 12, floor, 0, -0.02, 0);
    this.box(5.8, 0.035, 5.8, tile, 4, 0.055, -3);
    this.box(1.8, 0.04, 11.7, this.material('#c5b99f', 0.9), 0, 0.06, 0);

    this.wall(0, -6, 14, 0.18, wall);
    this.wall(-7, 0, 0.18, 12, wall);
    this.wall(7, 0, 0.18, 12, wall);
    this.wall(-3.9, 6, 6.2, 0.18, wall);
    this.wall(3.9, 6, 6.2, 0.18, wall);
    for (const x of [-1, 1]) {
      this.wall(x, -5, 0.12, 2, wall);
      this.wall(x, -0.25, 0.12, 3.5, wall);
      this.wall(x, 4.9, 0.12, 2.2, wall);
    }
    this.wall(-4, 0, 6, 0.12, wall);
    this.wall(4, 0, 6, 0.12, wall);

    // Baseboards and an open front-door frame make the interior read clearly from the room cameras.
    this.box(14, 0.12, 0.08, trim, 0, 0.12, -5.88);
    this.box(0.08, 0.12, 12, trim, -6.88, 0.12, 0);
    this.box(0.08, 0.12, 12, trim, 6.88, 0.12, 0);
    this.box(0.12, 2.65, 0.2, trim, -0.84, 1.33, 5.9);
    this.box(0.12, 2.65, 0.2, trim, 0.84, 1.33, 5.9);
    this.box(1.8, 0.12, 0.2, trim, 0, 2.61, 5.9);

    for (const [x, z] of [[-4, 3], [4, 3], [-4, -3], [4, -3]] as const) this.addRoomLight(x, z);
    const ambient = new THREE.AmbientLight('#fff1d6', 0.42);
    this.group.add(ambient);
  }

  private addRoomLight(x: number, z: number) {
    const light = new THREE.PointLight('#ffdca0', 32, 9, 1.6);
    light.position.set(x, 2.45, z);
    light.castShadow = false;
    const bulbMaterial = this.material('#fff1c7', 0.35);
    bulbMaterial.emissive.set('#ffd68a');
    this.bulbMaterials.push(bulbMaterial);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), bulbMaterial);
    bulb.position.copy(light.position);
    this.group.add(light, bulb);
    this.roomLights.push(light);
  }

  private buildLivingRoom() {
    const coastal = this.listing.id === 'coastal-cottage';
    const fabric = this.material(coastal ? '#6f8f91' : '#78866f', 0.96);
    const wood = this.material('#71533b', 0.86);
    const dark = this.material('#202b2c', 0.48, 0.12);
    this.box(3.2, 0.025, 2.5, this.material(coastal ? '#b8c8bd' : '#bda77b', 1), -4, 0.08, 2.8);
    this.box(3.1, 0.58, 0.9, fabric, -4.2, 0.42, 4.75, this.group, true);
    this.box(3.1, 0.85, 0.22, fabric, -4.2, 0.86, 5.08);
    this.box(0.22, 0.72, 1.05, fabric, -5.72, 0.62, 4.7);
    this.box(0.22, 0.72, 1.05, fabric, -2.68, 0.62, 4.7);
    this.box(1.55, 0.34, 0.78, wood, -4, 0.28, 2.95, this.group, true);
    this.box(2.1, 0.48, 0.42, wood, -4, 0.34, 0.38, this.group, true);
    this.box(1.65, 1, 0.09, dark, -4, 1.2, 0.2);
    this.box(0.5, 0.06, 0.32, this.material('#d4c8a4'), -2.25, 0.72, 4.6);
    this.addPlant(-6.25, 1.05);
  }

  private buildKitchen() {
    const cabinet = this.material(this.listing.id === 'coastal-cottage' ? '#82918a' : '#8a8069', 0.8);
    const counter = this.material('#d7d4c9', 0.42);
    const metal = this.material('#9aa7a5', 0.28, 0.65);
    this.box(1.05, 0.82, 4.8, cabinet, 6.25, 0.48, 2.8, this.group, true);
    this.box(1.12, 0.09, 4.9, counter, 6.22, 0.94, 2.8);
    this.box(0.75, 0.035, 1.1, metal, 5.64, 0.995, 2.2);
    this.box(0.85, 1.85, 1.05, metal, 6.15, 1.02, 5.15, this.group, true);
    this.box(0.08, 0.65, 0.05, this.material('#354846'), 5.69, 1.25, 4.82);
    for (const x of [2.55, 4.05]) for (const z of [1.85, 3.15]) this.box(0.09, 0.7, 0.09, this.material('#66503c'), x, 0.4, z);
    this.box(1.85, 0.12, 1.5, this.material('#8b6c4d'), 3.3, 0.78, 2.5, this.group, true);
    this.box(0.65, 0.75, 0.65, this.material('#6f857b'), 2.05, 0.43, 1.25, this.group, true);
    this.box(0.65, 0.75, 0.65, this.material('#6f857b'), 4.55, 0.43, 3.75, this.group, true);
    for (let index = 0; index < 4; index += 1) this.box(0.34, 0.035, 0.34, counter, 5.62, 1.01, 3.25 + index * 0.37);
  }

  private buildBedroom() {
    const wood = this.material('#6f513b', 0.88);
    const linen = this.material(this.listing.id === 'coastal-cottage' ? '#d7e2dc' : '#e2d7bd', 0.98);
    this.box(2.55, 0.38, 3.1, wood, -4.65, 0.3, -4.15, this.group, true);
    this.box(2.4, 0.3, 2.95, linen, -4.65, 0.59, -4.12);
    this.box(2.55, 1.25, 0.16, wood, -4.65, 0.85, -5.65);
    this.box(0.9, 0.16, 0.58, this.material('#f4efe2'), -5.25, 0.8, -5.05);
    this.box(0.9, 0.16, 0.58, this.material('#f4efe2'), -4.05, 0.8, -5.05);
    this.box(1, 2.05, 1.8, this.material('#80715b'), -6.25, 1.08, -1.35, this.group, true);
    this.box(0.65, 0.55, 0.65, wood, -2.65, 0.34, -5.1, this.group, true);
    this.box(1.7, 0.025, 1.2, this.material('#a89270'), -2.6, 0.08, -2.1);
  }

  private buildBathroom() {
    const white = this.material('#e8e9e2', 0.4);
    const chrome = this.material('#a7b4b2', 0.22, 0.72);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#b7d3d0', transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.05 });
    this.box(2.15, 0.12, 2.25, this.material('#98aaa7', 0.55), 5.55, 0.12, -4.55, this.group, true);
    this.box(0.06, 2.05, 2.2, glass, 4.5, 1.12, -4.55);
    this.box(0.06, 2.05, 2.2, glass, 5.55, 1.12, -3.47);
    const shower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 8), chrome);
    shower.position.set(6.35, 1.35, -5.25);
    this.group.add(shower);
    this.box(0.75, 0.5, 1.05, white, 2.05, 0.38, -4.95, this.group, true);
    const toiletTank = this.box(0.72, 0.8, 0.32, white, 2.05, 0.72, -5.52);
    toiletTank.castShadow = true;
    this.box(1.15, 0.78, 0.65, white, 5.9, 0.51, -1.1, this.group, true);
    this.box(1.25, 0.09, 0.72, chrome, 5.88, 0.95, -1.1);
    this.box(1.05, 1.05, 0.06, this.material('#8ca7a6', 0.12, 0.5), 5.88, 1.65, -0.75);
  }

  private buildUpgradeFurnishings() {
    const wood = this.material('#684e39', 0.85);
    // Level two adds a furnished reading/workspace corner.
    this.box(1.5, 0.12, 0.65, wood, -2.15, 0.78, 4.75, this.levelTwo);
    this.box(0.09, 0.75, 0.09, wood, -2.75, 0.4, 4.75, this.levelTwo);
    this.box(0.09, 0.75, 0.09, wood, -1.55, 0.4, 4.75, this.levelTwo);
    this.box(0.72, 0.06, 0.45, this.material('#344b4a', 0.4), -2.15, 0.89, 4.72, this.levelTwo);
    // Level three adds ceiling fans and additional warm decor.
    for (const [x, z] of [[-4, 2.8], [-4, -3]] as const) {
      const fan = new THREE.Group();
      fan.position.set(x, 2.58, z);
      const metal = this.material('#52615c', 0.45, 0.35);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 12), metal);
      fan.add(hub);
      for (let index = 0; index < 4; index += 1) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.035, 0.16), metal);
        blade.rotation.y = index * Math.PI / 2;
        fan.add(blade);
      }
      this.levelThree.add(fan);
    }
  }

  private addPlant(x: number, z: number) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.19, 0.45, 12), this.material('#9a6b4b'));
    pot.position.set(x, 0.3, z);
    this.group.add(pot);
    for (let index = 0; index < 6; index += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 5), this.material('#4e7455', 0.95));
      leaf.position.set(x + Math.sin(index) * 0.18, 0.85, z + Math.cos(index) * 0.18);
      leaf.rotation.z = (index - 3) * 0.12;
      this.group.add(leaf);
    }
  }

  setLevel(level: number) {
    this.property.level = level;
    this.levelTwo.visible = level >= 2;
    this.levelThree.visible = level >= 3;
  }

  setLights(on: boolean) {
    this.lights = on;
    for (const light of this.roomLights) light.visible = on;
    for (const material of this.bulbMaterials) material.emissiveIntensity = on ? 2.4 : 0;
  }

  toggleLights() { this.setLights(!this.lights); return this.lights; }
  get lightsOn() { return this.lights; }

  roomAt(position: THREE.Vector3) {
    return homeRoomAt(this.listing.id, { x: position.x - this.origin.x, z: position.z - this.origin.z });
  }

  roomSpawn(roomId: HomeRoomId) {
    const room = this.rooms.find((entry) => entry.id === roomId) ?? this.rooms[0]!;
    return new THREE.Vector3(this.origin.x + room.spawn.x, 0.14, this.origin.z + room.spawn.z);
  }

  get entryPosition() { return new THREE.Vector3(this.origin.x + HOME_ENTRY_LOCAL.x, 0.14, this.origin.z + HOME_ENTRY_LOCAL.z); }

  nearExit(position: THREE.Vector3) { return position.distanceTo(this.entryPosition) <= 1.65; }

  dispose() {
    this.scene.remove(this.group);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.collision.colliders.length = 0;
  }
}
