import * as THREE from 'three';
import type { CivicIncident } from '../../shared/civic';
import type { ActorCollisionWorld } from '../systems/actor-collision';

interface IncidentVisual {
  group: THREE.Group;
  status: CivicIncident['status'];
  ring: THREE.MeshBasicMaterial;
  label: THREE.Sprite;
}

export class CivicIncidentWorld {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, IncidentVisual>();
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'Shared civic incidents';
    scene.add(this.group);
  }

  setIncidents(incidents: CivicIncident[]) {
    const active = incidents.filter((incident) => incident.status !== 'resolved');
    const activeIds = new Set(active.map((incident) => incident.id));
    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id) && visual.status === active.find((incident) => incident.id === id)?.status) continue;
      this.group.remove(visual.group);
      this.dispose(visual.group);
      this.visuals.delete(id);
    }
    for (const incident of active) {
      if (this.visuals.has(incident.id)) continue;
      const group = new THREE.Group();
      group.position.set(incident.x, 0.14, incident.z);
      const color = incident.status === 'assigned' ? '#75b9df' : '#edc15b';
      const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.3, 32), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      const label = this.createLabel(incident);
      group.add(ring, this.createProp(incident), label);
      this.group.add(group);
      this.visuals.set(incident.id, { group, status: incident.status, ring: ringMaterial, label });
    }
  }

  addCollisionObstacles(world: ActorCollisionWorld) {
    if (!this.group.visible) return;
    for (const [id, visual] of this.visuals) world.addObject(`civic:${id}`, visual.group.position, 0.78);
  }

  update(dt: number, reducedMotion = false, focus?: THREE.Vector3) {
    for (const visual of this.visuals.values()) {
      const distance = focus ? visual.group.position.distanceTo(focus) : 12;
      // Keep the card out of the worker's nameplate throughout the E interaction radius.
      visual.label.visible = distance > 4.35 && distance < 24;
    }
    if (reducedMotion) {
      for (const visual of this.visuals.values()) visual.ring.opacity = 0.82;
      return;
    }
    this.elapsed += dt;
    for (const visual of this.visuals.values()) visual.ring.opacity = 0.7 + Math.sin(this.elapsed * 2.4) * 0.14;
  }

  private createProp(incident: CivicIncident) {
    const group = new THREE.Group();
    if (incident.kind === 'litter') {
      const colors = ['#7c8b56', '#a07145', '#d1c29a'];
      for (let index = 0; index < 8; index += 1) {
        const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + (index % 3) * 0.045, 0), new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: 1 }));
        mesh.position.set(Math.sin(index * 2.1) * 0.62, 0.16, Math.cos(index * 1.7) * 0.55);
        mesh.rotation.set(index * 0.3, index, 0);
        group.add(mesh);
      }
    } else if (incident.kind === 'drain') {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.85), new THREE.MeshStandardMaterial({ color: '#36423f', roughness: 0.88, metalness: 0.35 }));
      frame.position.y = 0.06;
      group.add(frame);
      for (let index = -2; index <= 2; index += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.72), new THREE.MeshStandardMaterial({ color: '#82918a', roughness: 0.7, metalness: 0.45 }));
        bar.position.set(index * 0.22, 0.14, 0);
        group.add(bar);
      }
    } else if (incident.kind === 'streetlight') {
      const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.42), new THREE.MeshStandardMaterial({ color: '#4e625d', roughness: 0.68, metalness: 0.28 }));
      cabinet.position.y = 0.43;
      const warning = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.23, 0.025), new THREE.MeshBasicMaterial({ color: '#e5b94f' }));
      warning.position.set(0, 0.55, 0.225);
      group.add(cabinet, warning);
    } else {
      for (let index = -1; index <= 1; index += 1) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.78, 12), new THREE.MeshStandardMaterial({ color: '#d77a35', roughness: 0.82 }));
        cone.position.set(index * 0.58, 0.39, 0);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.12, 12), new THREE.MeshBasicMaterial({ color: '#eee5cc' }));
        stripe.position.set(index * 0.58, 0.4, 0);
        group.add(cone, stripe);
      }
    }
    return group;
  }

  private createLabel(incident: CivicIncident) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 220;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(12, 29, 28, .93)';
    context.strokeStyle = incident.status === 'assigned' ? '#75b9df' : '#edc15b';
    context.lineWidth = 4;
    context.beginPath(); context.roundRect(6, 6, 756, 208, 24); context.fill(); context.stroke();
    context.textBaseline = 'middle';
    context.fillStyle = incident.status === 'assigned' ? '#8bc9e9' : '#f0ca6b';
    context.font = '700 26px Arial, sans-serif';
    context.fillText(incident.status === 'assigned' ? 'CIVIC WORK ASSIGNED' : 'OPEN CIVIC ISSUE', 34, 46);
    context.fillStyle = '#f3f1e8'; context.font = '600 34px Arial, sans-serif';
    context.fillText(incident.title, 34, 112, 700);
    context.fillStyle = '#b0c2b9'; context.font = '600 23px Arial, sans-serif';
    context.fillText('E  ·  VIEW IN CIVIC APP', 34, 174);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false }));
    label.center.set(0.5, 0); label.position.y = 1.05; label.scale.set(3.2, 0.92, 1); label.renderOrder = 22;
    return label;
  }

  private dispose(group: THREE.Group) {
    group.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose(); object.material.dispose(); return;
      }
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}
