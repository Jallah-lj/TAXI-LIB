import * as THREE from 'three';
import { currentCitizenTaskStep, type CitizenTask, type CitizenTaskObject, type CitizenTaskStep } from '../../shared/tasks';
import { getLocation } from '../../shared/world';
import type { ActorCollisionWorld } from '../systems/actor-collision';

/** The current server-backed task step as a visible, disposable world objective. */
export class TaskObjectives {
  readonly group = new THREE.Group();
  private key = '';
  private exterior = true;
  private elapsed = 0;
  private prop = new THREE.Group();
  private ringMaterial?: THREE.MeshBasicMaterial;
  private beamMaterial?: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'Active citizen task objective';
    this.group.visible = false;
    scene.add(this.group);
  }

  setTask(task: CitizenTask | null) {
    const key = task?.status === 'active' ? `${task.id}:${task.stepIndex}` : '';
    if (key === this.key) return;
    this.clear();
    this.key = key;
    const step = currentCitizenTaskStep(task);
    if (!step) { this.group.visible = false; return; }

    this.group.position.set(step.x, 0.14, step.z);
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: '#69e0bd', transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.38, 36), this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(1.12, 36), new THREE.MeshBasicMaterial({
      color: '#69e0bd', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
    }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.025;
    this.beamMaterial = new THREE.MeshBasicMaterial({ color: '#69e0bd', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 1.05, 4.5, 20, 1, true), this.beamMaterial);
    beam.position.y = 2.25;
    this.prop = this.createProp(step.object);
    const label = this.createLabel(step);
    this.group.add(ring, inner, beam, this.prop, label);
    this.group.visible = this.exterior;
  }

  setExteriorVisible(visible: boolean) {
    this.exterior = visible;
    this.group.visible = visible && Boolean(this.key);
  }

  addCollisionObstacles(world: ActorCollisionWorld) {
    if (this.group.visible) world.addObject(this.group.uuid, this.group.position, 0.72);
  }

  update(dt: number, reducedMotion = false) {
    if (!this.group.visible) return;
    if (reducedMotion) {
      this.prop.position.y = 0;
      if (this.ringMaterial) this.ringMaterial.opacity = 0.78;
      if (this.beamMaterial) this.beamMaterial.opacity = 0.12;
      return;
    }
    this.elapsed += dt;
    this.prop.rotation.y += dt * 0.45;
    this.prop.position.y = Math.sin(this.elapsed * 2.2) * 0.045;
    if (this.ringMaterial) this.ringMaterial.opacity = 0.68 + Math.sin(this.elapsed * 3) * 0.13;
    if (this.beamMaterial) this.beamMaterial.opacity = 0.1 + Math.sin(this.elapsed * 2) * 0.025;
  }

  private createLabel(step: CitizenTaskStep) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(8, 25, 23, .94)';
    context.strokeStyle = '#75e4bf';
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(8, 8, 1008, 284, 28);
    context.fill();
    context.stroke();
    context.textBaseline = 'middle';
    context.fillStyle = '#8ce9c9';
    context.font = '700 27px Arial, sans-serif';
    context.fillText('CURRENT OBJECTIVE', 42, 52);
    context.fillStyle = '#f4f3e9';
    context.font = '600 40px Arial, sans-serif';
    context.fillText(step.label, 42, 130, 940);
    const action = step.action === 'collect' ? 'COLLECT' : step.action === 'clean' ? 'CLEAN UP'
      : step.action === 'inspect' ? 'INSPECT' : step.action === 'repair' ? 'REPAIR' : step.id === 'stock-stall' ? 'STOCK' : 'DELIVER';
    context.fillStyle = '#f0c55e';
    context.font = '700 32px Arial, sans-serif';
    context.fillText(`PRESS E  ·  ${action}`, 42, 205);
    context.fillStyle = '#a5b9b0';
    context.font = '500 24px Arial, sans-serif';
    context.fillText(getLocation(step.locationId).name.toUpperCase(), 42, 258, 940);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const label = new THREE.Sprite(material);
    label.name = 'Current task objective instruction';
    label.center.set(0.5, 0);
    label.position.y = 1.2;
    label.scale.set(5.4, 1.58, 1);
    label.renderOrder = 24;
    return label;
  }

  private createProp(object: CitizenTaskObject) {
    const group = new THREE.Group();
    const add = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, emissive = '#000000') => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.22, roughness: 0.78 }));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    if (object === 'crate') {
      add(new THREE.BoxGeometry(1, 0.65, 0.76), '#9b7448', 0, 0.43, 0);
      add(new THREE.BoxGeometry(1.04, 0.09, 0.8), '#b48b57', 0, 0.78, 0);
      for (const x of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.075, 0.69, 0.79), '#4b4638', x, 0.44, 0);
    } else if (object === 'supplies') {
      add(new THREE.BoxGeometry(0.88, 0.62, 0.68), '#e4e4d9', 0, 0.42, 0);
      add(new THREE.BoxGeometry(0.36, 0.11, 0.025), '#2d8274', 0, 0.44, 0.352, '#2d8274');
      add(new THREE.BoxGeometry(0.11, 0.36, 0.025), '#2d8274', 0, 0.44, 0.353, '#2d8274');
    } else if (object === 'clipboard') {
      add(new THREE.BoxGeometry(0.76, 0.09, 1), '#725b3d', 0, 0.42, 0);
      add(new THREE.BoxGeometry(0.66, 0.035, 0.84), '#eee9d9', 0, 0.49, 0.03);
      add(new THREE.BoxGeometry(0.28, 0.07, 0.16), '#3f504c', 0, 0.53, -0.39);
      for (const z of [-0.18, 0.02, 0.22]) add(new THREE.BoxGeometry(0.4, 0.02, 0.035), '#6b8c80', 0, 0.515, z);
    } else if (object === 'drain') {
      add(new THREE.BoxGeometry(1.25, 0.13, 0.9), '#35443f', 0, 0.12, 0);
      for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) add(new THREE.BoxGeometry(0.08, 0.06, 0.76), '#81918a', x, 0.22, 0);
      add(new THREE.DodecahedronGeometry(0.25, 0), '#63734c', 0.48, 0.28, 0.25);
    } else if (object === 'barrier') {
      add(new THREE.BoxGeometry(1.5, 0.32, 0.22), '#d67a36', 0, 0.68, 0);
      for (const x of [-0.52, 0, 0.52]) add(new THREE.BoxGeometry(0.22, 0.34, 0.24), '#eee4cc', x, 0.68, 0);
      for (const x of [-0.58, 0.58]) add(new THREE.BoxGeometry(0.14, 0.85, 0.14), '#4b514a', x, 0.43, 0);
    } else if (object === 'litter') {
      const bag = add(new THREE.DodecahedronGeometry(0.43, 0), '#34584b', 0, 0.44, 0);
      bag.scale.set(0.86, 1.15, 0.82);
      add(new THREE.CylinderGeometry(0.08, 0.12, 0.18, 7), '#29473e', 0, 0.89, 0);
      add(new THREE.BoxGeometry(0.32, 0.035, 0.22), '#d6d0b9', 0.55, 0.08, 0.15);
      add(new THREE.BoxGeometry(0.22, 0.04, 0.3), '#b8c9bd', -0.48, 0.07, -0.22);
    } else {
      add(new THREE.BoxGeometry(0.94, 0.44, 0.58), '#c97937', 0, 0.35, 0);
      add(new THREE.BoxGeometry(0.42, 0.07, 0.09), '#303b3b', 0, 0.75, 0);
      for (const x of [-0.18, 0.18]) add(new THREE.BoxGeometry(0.07, 0.22, 0.09), '#303b3b', x, 0.64, 0);
      add(new THREE.BoxGeometry(0.98, 0.06, 0.61), '#e0a24f', 0, 0.56, 0);
    }
    return group;
  }

  private clear() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
        return;
      }
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      entries.forEach((material) => materials.add(material));
    });
    this.group.clear();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.prop = new THREE.Group();
    this.ringMaterial = undefined;
    this.beamMaterial = undefined;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
