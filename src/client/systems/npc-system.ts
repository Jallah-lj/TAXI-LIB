import * as THREE from 'three';
import { CharacterEntity } from '../entities/character';
import type { CharacterAppearance } from '../../shared/types';
import type { SimulationState } from '../../shared/simulation';
import { CIVIC_WORKERS, civicWorkerDuty, type CivicIncident, type CivicWorkerDefinition } from '../../shared/civic';
import type { CollisionWorld } from './collision';
import type { ActorCollisionWorld } from './actor-collision';
import { conditionAfterImpact, INJURY_RECOVERY_MS, RESPAWN_MS, type HealthCondition } from '../../shared/health';

interface NPC {
  entity: CharacterEntity;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  direction: number;
  speed: number;
  phase: number;
  shelter: THREE.Vector3;
  condition: HealthCondition;
  recoverAt: number;
}

interface CivicNPC {
  definition: CivicWorkerDefinition;
  entity: CharacterEntity;
  route: THREE.Vector3[];
  targetIndex: number;
  wait: number;
  condition: HealthCondition;
  recoverAt: number;
}

const paths: [number, number, number, number][] = [
  [-14, -95, -14, -25], [14, -105, 14, -22], [-105, -12, -25, -12], [24, 12, 103, 12],
  [-108, 25, -108, 102], [108, -100, 108, -25], [108, 25, 108, 104], [135, 12, 220, 12],
  [-95, -132, -25, -132], [25, 132, 100, 132], [135, -108, 220, -108], [-104, 108, -25, 108],
  [-15, 25, -15, 90], [18, 22, 18, 90], [-90, -20, -30, -20], [130, -12, 210, -12],
];

export class NPCSystem {
  readonly group = new THREE.Group();
  private readonly npcs: NPC[] = [];
  private readonly civicNpcs: CivicNPC[] = [];
  private incidents: CivicIncident[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    paths.forEach(([fx, fz, tx, tz], index) => {
      const appearance: CharacterAppearance = { skin: index % 6, hair: index % 4, top: index % 6, bottom: index % 4 };
      const entity = new CharacterEntity(appearance);
      const from = new THREE.Vector3(fx, 0.14, fz);
      const to = new THREE.Vector3(tx, 0.14, tz);
      entity.group.position.copy(from);
      this.group.add(entity.group);
      this.npcs.push({
        entity, from, to, progress: (index * 0.173) % 1, direction: index % 2 ? 1 : -1,
        speed: 0.65 + (index % 4) * 0.12, phase: index, shelter: from.clone(), condition: 'healthy', recoverAt: 0,
      });
    });
    for (let index = 0; index < 5; index += 1) {
      const entity = new CharacterEntity({ skin: (index + 2) % 6, hair: index % 4, top: (index + 3) % 6, bottom: index % 4 });
      entity.group.position.set(-88 + index * 15, 0.14, -82 - (index % 2) * 19);
      entity.group.rotation.y = index % 2 ? Math.PI : 0;
      this.group.add(entity.group);
      this.npcs.push({ entity, from: entity.group.position.clone(), to: entity.group.position.clone(), progress: 0, direction: 0, speed: 0, phase: index, shelter: entity.group.position.clone(), condition: 'healthy', recoverAt: 0 });
    }
    this.buildCivicWorkers();
  }

  private buildCivicWorkers() {
    CIVIC_WORKERS.forEach((definition, index) => {
      const entity = new CharacterEntity(definition.appearance, definition.name, definition.role);
      const route = definition.route.map((point) => new THREE.Vector3(point.x, 0.14, point.z));
      entity.group.position.copy(route[0]!);
      this.group.add(entity.group);
      this.civicNpcs.push({ definition, entity, route, targetIndex: (index + 1) % route.length, wait: (index % 3) * 0.8, condition: 'healthy', recoverAt: 0 });
    });
  }

  setVisible(visible: boolean) { this.group.visible = visible; }

  applyVehicleImpact(actorId: string, speed: number, serverTime: number) {
    const npc = [...this.npcs, ...this.civicNpcs].find((entry) => entry.entity.group.uuid === actorId);
    if (!npc) return null;
    const condition = conditionAfterImpact(speed, npc.condition);
    if (!condition) return null;
    npc.condition = condition;
    npc.recoverAt = serverTime + (condition === 'injured' ? INJURY_RECOVERY_MS : RESPAWN_MS);
    npc.entity.setCondition(condition);
    const name = 'definition' in npc ? npc.definition.name : 'A citizen';
    return { name, condition };
  }

  private updateCondition(npc: NPC | CivicNPC, dt: number, serverTime: number) {
    if (npc.condition === 'healthy') return false;
    if (serverTime >= npc.recoverAt) {
      npc.condition = 'healthy';
      npc.recoverAt = 0;
      npc.entity.setCondition('healthy');
      return false;
    }
    npc.entity.group.visible = true;
    npc.entity.update(dt, 0);
    return true;
  }

  addCollisionObstacles(world: ActorCollisionWorld) {
    if (!this.group.visible) return;
    for (const npc of [...this.npcs, ...this.civicNpcs]) {
      if (npc.entity.group.visible) world.addPerson(npc.entity.group.uuid, npc.entity.group.position);
    }
  }

  setIncidents(incidents: CivicIncident[]) { this.incidents = incidents.filter((incident) => incident.status !== 'resolved'); }

  nearestCivicWorker(position: THREE.Vector3, radius = 3.2) {
    let nearest: CivicWorkerDefinition | null = null;
    let nearestDistance = radius;
    for (const npc of this.civicNpcs) {
      if (!npc.entity.group.visible || npc.condition !== 'healthy') continue;
      const distance = npc.entity.group.position.distanceTo(position);
      if (distance < nearestDistance) { nearest = npc.definition; nearestDistance = distance; }
    }
    return nearest;
  }

  update(dt: number, simulation: SimulationState, playerPosition: THREE.Vector3, playerSpeed: number, collision: CollisionWorld, actors: ActorCollisionWorld) {
    const hour = simulation.timeOfDaySeconds / 3600;
    const late = hour < 5.5 || hour > 22;
    for (const npc of this.npcs) {
      npc.entity.updateNameplate(playerPosition);
      if (this.updateCondition(npc, dt, simulation.serverTime)) continue;
      const shouldShelter = late && npc.speed > 0 && npc.phase % 3 !== 0;
      npc.entity.group.visible = !shouldShelter;
      if (shouldShelter) continue;
      if (npc.direction === 0) { npc.entity.update(dt, 0); continue; }
      const distanceToPlayer = npc.entity.group.position.distanceTo(playerPosition);
      const reacting = distanceToPlayer < 5 && Math.abs(playerSpeed) > 3;
      const rainSlowdown = 1 - simulation.rainIntensity * 0.28;
      const previous = npc.entity.group.position.clone();
      if (!reacting) npc.progress += npc.direction * npc.speed * rainSlowdown * dt / npc.from.distanceTo(npc.to);
      if (npc.progress >= 1 || npc.progress <= 0) {
        npc.progress = Math.max(0, Math.min(1, npc.progress));
        npc.direction *= -1;
      }
      const desired = new THREE.Vector3().lerpVectors(npc.from, npc.to, npc.progress);
      const blocked = collision.blocked(desired.x, desired.z, 0.32)
        || actors.blockedPerson(desired.x, desired.z, 0.32, npc.entity.group.uuid, previous);
      let moving = false;
      if (!blocked) {
        npc.entity.group.position.copy(desired);
        moving = npc.entity.group.position.distanceTo(previous) > 0.0001;
      } else if (!reacting) {
        npc.direction *= -1;
      }
      const target = npc.direction > 0 ? npc.to : npc.from;
      const delta = target.clone().sub(npc.entity.group.position);
      npc.entity.group.rotation.y = Math.atan2(delta.x, delta.z);
      npc.entity.update(dt, moving ? npc.speed * 3 : 0);
    }
    for (const npc of this.civicNpcs) this.updateCivicWorker(npc, dt, simulation, playerPosition, playerSpeed, collision, actors);
  }

  private updateCivicWorker(npc: CivicNPC, dt: number, simulation: SimulationState, playerPosition: THREE.Vector3, playerSpeed: number, collision: CollisionWorld, actors: ActorCollisionWorld) {
    npc.entity.updateNameplate(playerPosition);
    if (this.updateCondition(npc, dt, simulation.serverTime)) return;
    const hour = simulation.timeOfDaySeconds / 3600;
    const duty = civicWorkerDuty(npc.definition, hour, simulation.rainIntensity);
    npc.entity.group.visible = duty !== 'off-duty';
    if (duty === 'off-duty') return;
    const position = npc.entity.group.position;
    const playerDistance = position.distanceTo(playerPosition);
    if (npc.entity.nameSprite) npc.entity.nameSprite.visible = playerDistance < 24;
    const reacting = playerDistance < 5 && Math.abs(playerSpeed) > 3;
    const response = duty === 'patrolling' ? this.responseFor(npc.definition, position) : null;
    const target = duty === 'sheltering'
      ? new THREE.Vector3(npc.definition.shelter.x, 0.14, npc.definition.shelter.z)
      : response ? new THREE.Vector3(response.x, 0.14, response.z) : npc.route[npc.targetIndex]!;
    const delta = target.clone().sub(position);
    delta.y = 0;
    const distance = delta.length();
    let moving = false;
    if (distance > 0.55) {
      const speed = npc.definition.speed * (1 - simulation.rainIntensity * 0.2);
      if (!reacting) {
        const step = Math.min(distance, speed * dt);
        const next = position.clone().addScaledVector(delta.clone().normalize(), step);
        if (!collision.blocked(next.x, next.z, 0.32) && !actors.blockedPerson(next.x, next.z, 0.32, npc.entity.group.uuid, position)) {
          position.copy(next);
          npc.entity.group.rotation.y = Math.atan2(delta.x, delta.z);
          moving = step > 0.001;
        }
      }
      npc.wait = 0;
    } else if (!response && duty === 'patrolling') {
      npc.wait += dt;
      if (npc.wait >= 2.8 + (npc.targetIndex % 3)) {
        npc.targetIndex = (npc.targetIndex + 1) % npc.route.length;
        npc.wait = 0;
      }
    }
    npc.entity.update(dt, moving ? npc.definition.speed * 3 : 0);
  }

  private responseFor(definition: CivicWorkerDefinition, position: THREE.Vector3) {
    let nearest: CivicIncident | null = null;
    let nearestDistance = 38;
    for (const incident of this.incidents) {
      if (incident.departmentId !== definition.departmentId) continue;
      const distance = Math.hypot(position.x - incident.x, position.z - incident.z);
      if (distance < nearestDistance) { nearest = incident; nearestDistance = distance; }
    }
    return nearest;
  }
}
