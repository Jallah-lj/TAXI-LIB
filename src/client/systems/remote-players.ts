import * as THREE from 'three';
import { CharacterEntity } from '../entities/character';
import { VehicleEntity } from '../entities/vehicle';
import type { MovementState } from '../../shared/protocol';
import type { PlayerProfile } from '../../shared/types';
import type { ActorCollisionWorld } from './actor-collision';
import type { PlayerHealthState } from '../../shared/health';
import type { NearbyCitizen } from '../social';

interface Remote {
  profile: PlayerProfile;
  character: CharacterEntity;
  vehicle: VehicleEntity;
  target: MovementState;
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private suppressed = false;

  constructor(private readonly scene: THREE.Scene) {}

  addProfile(profile: PlayerProfile) {
    if (this.remotes.has(profile.id)) return;
    const character = new CharacterEntity(profile.appearance, profile.displayName);
    const vehicle = new VehicleEntity('#d6a636', true, profile.displayName);
    character.group.visible = false;
    vehicle.group.visible = false;
    this.scene.add(character.group, vehicle.group);
    this.remotes.set(profile.id, {
      profile, character, vehicle,
      target: { playerId: profile.id, position: [0, 0, 0], heading: 0, speed: 0, mode: 'walking', sequence: 0, sentAt: Date.now() },
    });
  }

  apply(state: MovementState & { profile?: PlayerProfile }, snap = false) {
    if (state.profile) this.addProfile(state.profile);
    const remote = this.remotes.get(state.playerId);
    if (!remote) return;
    const first = snap || (!remote.character.group.visible && !remote.vehicle.group.visible);
    remote.target = state;
    const active = state.mode === 'driving' ? remote.vehicle.group : remote.character.group;
    remote.vehicle.setLights(state.mode === 'driving' && state.lightsOn === true);
    active.visible = !this.suppressed && !state.interiorPropertyId;
    (state.mode === 'driving' ? remote.character.group : remote.vehicle.group).visible = false;
    if (first) {
      active.position.fromArray(state.position);
      active.rotation.y = state.heading;
    }
  }

  setSuppressed(suppressed: boolean) {
    this.suppressed = suppressed;
    for (const remote of this.remotes.values()) this.apply(remote.target);
  }

  update(dt: number, observerPosition?: THREE.Vector3) {
    for (const remote of this.remotes.values()) {
      if (observerPosition) remote.character.updateNameplate(observerPosition);
      const state = remote.target;
      const active = state.mode === 'driving' ? remote.vehicle.group : remote.character.group;
      const target = new THREE.Vector3().fromArray(state.position);
      active.position.lerp(target, 1 - Math.exp(-dt * 12));
      const difference = Math.atan2(Math.sin(state.heading - active.rotation.y), Math.cos(state.heading - active.rotation.y));
      active.rotation.y += difference * (1 - Math.exp(-dt * 12));
      if (state.mode === 'driving') remote.vehicle.update(dt, state.speed);
      else remote.character.update(dt, state.speed);
    }
  }

  applyHealth(playerId: string, health: PlayerHealthState) {
    this.remotes.get(playerId)?.character.setCondition(health.condition);
  }

  emote(playerId: string) { this.remotes.get(playerId)?.character.wave(); }

  remove(playerId: string) {
    const remote = this.remotes.get(playerId);
    if (!remote) return;
    this.scene.remove(remote.character.group, remote.vehicle.group);
    remote.character.dispose();
    remote.vehicle.dispose();
    this.remotes.delete(playerId);
  }

  addCollisionObstacles(world: ActorCollisionWorld) {
    for (const remote of this.remotes.values()) {
      const state = remote.target;
      if (state.interiorPropertyId) continue;
      if (state.mode === 'driving') {
        if (remote.vehicle.group.visible) world.addVehicle(`remote:${remote.profile.id}:vehicle`, remote.vehicle.group.position, remote.vehicle.group.rotation.y, remote.vehicle.collisionBounds.halfWidth, remote.vehicle.collisionBounds.halfLength);
      } else if (remote.character.group.visible) world.addPerson(`remote:${remote.profile.id}:person`, remote.character.group.position);
    }
  }

  positions() {
    return [...this.remotes.values()].filter((remote) => remote.target && !remote.target.interiorPropertyId).map((remote) => ({
      id: remote.profile.id, name: remote.profile.displayName, x: remote.target.position[0], z: remote.target.position[2],
    }));
  }

  list(): NearbyCitizen[] {
    return [...this.remotes.values()].map((remote) => ({
      id: remote.profile.id,
      displayName: remote.profile.displayName,
      handle: remote.profile.handle,
      mode: remote.target.mode,
      insideHome: Boolean(remote.target.interiorPropertyId),
    }));
  }

  get count() { return this.remotes.size; }
}
