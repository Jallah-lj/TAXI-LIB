import * as THREE from 'three';
import { CharacterEntity } from '../entities/character';
import { VehicleEntity } from '../entities/vehicle';
import type { PlayerProfile, PlayerVehicle } from '../../shared/types';
import type { MovementState } from '../../shared/protocol';
import type { InputFrame } from './controls';
import type { CollisionWorld } from './collision';
import type { ActorCollisionWorld } from './actor-collision';
import { isOnRoad, PLAYER_SPAWN, TAXI_SPAWN } from '../../shared/world';
import type { HealthCondition } from '../../shared/health';

export class LocalController {
  readonly character: CharacterEntity;
  vehicle: VehicleEntity;
  mode: 'walking' | 'driving' = 'walking';
  speed = 0;
  steering = 0;
  lightsOn = false;
  fuelPercent: number;
  conditionPercent: number;
  private walkSpeed = 0;
  private collisionCooldown = 0;
  private healthCondition: HealthCondition = 'healthy';
  private exteriorPose?: { position: THREE.Vector3; heading: number };
  interiorPropertyId: string | null = null;

  constructor(
    readonly profile: PlayerProfile,
    public vehicleData: PlayerVehicle,
    private readonly scene: THREE.Scene,
    private readonly onPedestrianImpact: (actorId: string, speed: number) => void = () => undefined,
  ) {
    this.character = new CharacterEntity(profile.appearance, profile.displayName);
    this.character.group.position.set(PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z);
    this.vehicle = VehicleEntity.fromPlayerVehicle(vehicleData, profile.displayName);
    this.vehicle.group.position.set(TAXI_SPAWN.x, 0.08, TAXI_SPAWN.z);
    this.vehicle.group.rotation.y = TAXI_SPAWN.heading;
    this.fuelPercent = vehicleData.fuelPercent;
    this.conditionPercent = vehicleData.conditionPercent;
    scene.add(this.character.group, this.vehicle.group);
  }

  update(dt: number, input: InputFrame, cameraYaw: number, rainIntensity: number, collision: CollisionWorld, actors?: ActorCollisionWorld) {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    if (this.mode === 'walking') this.updateWalking(dt, input, cameraYaw, collision, actors);
    else this.updateDriving(dt, input, rainIntensity, collision, actors);
  }

  private updateWalking(dt: number, input: InputFrame, cameraYaw: number, collision: CollisionWorld, actors?: ActorCollisionWorld) {
    const length = Math.hypot(input.forward, input.right);
    const mobility = this.healthCondition === 'dead' ? 0 : this.healthCondition === 'injured' ? 0.45 : 1;
    const targetSpeed = length > 0.05 ? (input.run ? 6.4 : 3.6) * mobility : 0;
    this.walkSpeed += (targetSpeed - this.walkSpeed) * Math.min(1, dt * 10);
    const position = this.character.group.position;
    const startX = position.x;
    const startZ = position.z;
    if (length > 0.05) {
      const forward = input.forward / Math.max(1, length);
      const right = input.right / Math.max(1, length);
      const dx = (Math.sin(cameraYaw) * forward + Math.cos(cameraYaw) * right) * this.walkSpeed * dt;
      const dz = (Math.cos(cameraYaw) * forward - Math.sin(cameraYaw) * right) * this.walkSpeed * dt;
      const nextX = position.x + dx;
      if (!collision.blocked(nextX, position.z, 0.32) && !actors?.blockedPerson(nextX, position.z, 0.32, this.personCollisionId, { x: position.x, z: position.z })) position.x = nextX;
      const nextZ = position.z + dz;
      if (!collision.blocked(position.x, nextZ, 0.32) && !actors?.blockedPerson(position.x, nextZ, 0.32, this.personCollisionId, { x: position.x, z: position.z })) position.z = nextZ;
      const movedX = position.x - startX;
      const movedZ = position.z - startZ;
      if (Math.hypot(movedX, movedZ) > 0.0001) {
        const desired = Math.atan2(movedX, movedZ);
        const difference = Math.atan2(Math.sin(desired - this.character.group.rotation.y), Math.cos(desired - this.character.group.rotation.y));
        this.character.group.rotation.y += difference * Math.min(1, dt * 12);
      }
    }
    const actualSpeed = Math.hypot(position.x - startX, position.z - startZ) / dt;
    this.walkSpeed = actualSpeed > 0.0001 ? Math.min(this.walkSpeed, actualSpeed) : 0;
    this.character.update(dt, this.walkSpeed);
    this.vehicle.update(dt, 0, this.steering);
  }

  private updateDriving(dt: number, input: InputFrame, rainIntensity: number, collision: CollisionWorld, actors?: ActorCollisionWorld) {
    const spec = this.vehicleData.model;
    const position = this.vehicle.group.position;
    const offroad = !isOnRoad({ x: position.x, z: position.z });
    const grip = spec.grip * (1 - rainIntensity * 0.28) * (offroad ? 0.72 : 1);
    const maxSpeed = spec.maxSpeed * (offroad ? 0.46 : 1) * (this.fuelPercent <= 0 ? 0 : 1);
    if (input.forward > 0.05) {
      if (this.speed < -0.4) this.speed += spec.braking * input.forward * dt;
      else this.speed += spec.acceleration * input.forward * grip * dt;
    } else if (input.forward < -0.05) {
      if (this.speed > 0.4) this.speed -= spec.braking * -input.forward * dt;
      else this.speed -= spec.acceleration * 0.62 * -input.forward * grip * dt;
    } else {
      const drag = (offroad ? 4.2 : 1.25) + Math.abs(this.speed) * 0.035;
      this.speed = Math.abs(this.speed) <= drag * dt ? 0 : this.speed - Math.sign(this.speed) * drag * dt;
    }
    if (input.brake) {
      const amount = spec.braking * 1.35 * (1 - rainIntensity * 0.2) * dt;
      this.speed = Math.abs(this.speed) <= amount ? 0 : this.speed - Math.sign(this.speed) * amount;
    }
    this.speed = Math.max(-7, Math.min(maxSpeed, this.speed));
    this.steering += (input.right - this.steering) * Math.min(1, dt * 8);
    if (Math.abs(this.speed) > 0.15) {
      const steerAuthority = Math.min(1, Math.abs(this.speed) / 4) * (1 - Math.min(0.55, Math.abs(this.speed) / 70));
      this.vehicle.group.rotation.y += this.steering * spec.steering * grip * steerAuthority * Math.sign(this.speed) * dt;
    }
    const heading = this.vehicle.group.rotation.y;
    const dx = Math.sin(heading) * this.speed * dt;
    const dz = Math.cos(heading) * this.speed * dt;
    const nextX = position.x + dx;
    const nextZ = position.z + dz;
    const bounds = this.vehicle.collisionBounds;
    const staticBlocked = collision.blockedVehicle(nextX, nextZ, heading, bounds.halfWidth, bounds.halfLength);
    const actorContact = actors?.vehicleContact(
      { x: nextX, z: nextZ, heading, ...bounds }, this.vehicleCollisionId, 0.02,
      { x: position.x, z: position.z, heading, ...bounds },
    );
    const actorBlocked = actorContact !== null && actorContact !== undefined;
    if (!staticBlocked && !actorBlocked) {
      position.x = nextX; position.z = nextZ;
    } else {
      if (!staticBlocked && actorContact?.kind === 'person') this.onPedestrianImpact(actorContact.id, Math.abs(this.speed));
      if (staticBlocked && Math.abs(this.speed) > 5 && this.collisionCooldown <= 0) {
        this.conditionPercent = Math.max(12, this.conditionPercent - Math.abs(this.speed) * 0.12);
        this.collisionCooldown = 0.5;
      }
      this.speed = 0;
    }
    this.fuelPercent = Math.max(0, this.fuelPercent - Math.abs(this.speed) * dt * 0.00055);
    this.vehicle.update(dt, this.speed, this.steering);
    this.character.update(dt, 0);
  }

  interact(collision?: CollisionWorld, actors?: ActorCollisionWorld): string | null {
    if (this.healthCondition === 'dead') return 'You are being respawned. Please wait.';
    if (this.interiorPropertyId) return null;
    if (this.mode === 'walking') {
      const distance = this.character.group.position.distanceTo(this.vehicle.group.position);
      if (distance <= 4.2) {
        this.mode = 'driving';
        this.character.group.visible = false;
        return `You are now driving the ${this.vehicleData.model.name}.`;
      }
      return null;
    }
    if (Math.abs(this.speed) > 1.8) return 'Slow down before leaving the vehicle.';
    const heading = this.vehicle.group.rotation.y;
    const exit = this.vehicle.group.position.clone();
    exit.x += Math.cos(heading) * -2;
    exit.z += Math.sin(heading) * 2;
    if (collision?.blocked(exit.x, exit.z, 0.32) || actors?.blockedPerson(exit.x, exit.z, 0.32, this.personCollisionId)) {
      return 'The driver-side door is blocked. Reposition the vehicle before exiting.';
    }
    this.character.group.position.set(exit.x, 0.14, exit.z);
    this.character.group.rotation.y = heading;
    this.character.group.visible = true;
    this.mode = 'walking';
    this.walkSpeed = 0;
    return null;
  }

  enterHome(propertyId: string, spawn: THREE.Vector3) {
    if (this.mode !== 'walking' || this.interiorPropertyId) throw new Error('You must be outside and on foot to enter a home.');
    this.exteriorPose = { position: this.character.group.position.clone(), heading: this.character.group.rotation.y };
    this.interiorPropertyId = propertyId;
    this.character.group.position.copy(spawn);
    this.character.group.rotation.y = Math.PI;
    this.character.group.visible = true;
    this.walkSpeed = 0;
  }

  visitHomeRoom(spawn: THREE.Vector3, heading?: number) {
    if (!this.interiorPropertyId) return;
    this.character.group.position.copy(spawn);
    if (heading !== undefined) this.character.group.rotation.y = heading;
    this.walkSpeed = 0;
  }

  exitHome() {
    if (!this.interiorPropertyId || !this.exteriorPose) return;
    this.character.group.position.copy(this.exteriorPose.position);
    this.character.group.rotation.y = this.exteriorPose.heading;
    this.interiorPropertyId = null;
    this.exteriorPose = undefined;
    this.walkSpeed = 0;
  }

  toggleLights() {
    this.lightsOn = !this.lightsOn;
    this.vehicle.setLights(this.lightsOn);
    return this.lightsOn;
  }

  applyVehicle(vehicle: PlayerVehicle) {
    if (vehicle.id === this.vehicleData.id && vehicle.modelId === this.vehicleData.modelId) {
      this.vehicleData = vehicle;
      return;
    }
    if (this.mode === 'driving') throw new Error('Exit your current vehicle before selecting another.');
    const position = this.vehicle.group.position.clone();
    const heading = this.vehicle.group.rotation.y;
    this.scene.remove(this.vehicle.group);
    this.vehicle.dispose();
    this.vehicleData = vehicle;
    this.vehicle = VehicleEntity.fromPlayerVehicle(vehicle, this.profile.displayName);
    if (this.vehicle.nameSprite) this.vehicle.nameSprite.visible = false;
    this.vehicle.group.position.copy(position);
    this.vehicle.group.rotation.y = heading;
    this.vehicle.setLights(this.lightsOn);
    this.fuelPercent = vehicle.fuelPercent;
    this.conditionPercent = vehicle.conditionPercent;
    this.scene.add(this.vehicle.group);
  }

  get personCollisionId() { return `player:${this.profile.id}:person`; }
  get vehicleCollisionId() { return `player:${this.vehicleData.id}:vehicle`; }

  stopForConversation() {
    if (this.mode === 'walking') this.walkSpeed = 0;
  }

  setHealthCondition(condition: HealthCondition) {
    this.healthCondition = condition;
    this.character.setCondition(condition);
    if (condition !== 'healthy') this.walkSpeed = 0;
    if (condition === 'dead') this.speed = 0;
  }

  respawn() {
    this.mode = 'walking';
    this.speed = 0;
    this.steering = 0;
    this.walkSpeed = 0;
    this.interiorPropertyId = null;
    this.exteriorPose = undefined;
    this.character.group.visible = true;
    this.character.group.position.set(PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z);
    this.character.group.rotation.set(0, 0, 0);
    this.setHealthCondition('healthy');
  }

  get position() {
    return this.mode === 'driving' ? this.vehicle.group.position : this.character.group.position;
  }

  get heading() {
    return this.mode === 'driving' ? this.vehicle.group.rotation.y : this.character.group.rotation.y;
  }

  movementState(sequence: number): MovementState {
    const networkPosition = this.interiorPropertyId && this.exteriorPose ? this.exteriorPose.position : this.position;
    const networkHeading = this.interiorPropertyId && this.exteriorPose ? this.exteriorPose.heading : this.heading;
    const heading = Math.atan2(Math.sin(networkHeading), Math.cos(networkHeading));
    return {
      playerId: this.profile.id, position: [networkPosition.x, networkPosition.y, networkPosition.z], heading,
      speed: this.interiorPropertyId ? 0 : this.mode === 'driving' ? this.speed : this.walkSpeed, mode: this.mode,
      ...(this.mode === 'driving' ? { vehicleId: this.vehicleData.id, lightsOn: this.lightsOn } : {}),
      ...(this.interiorPropertyId ? { interiorPropertyId: this.interiorPropertyId } : {}), sequence, sentAt: Date.now(),
    };
  }

  wave() { this.character.wave(); }
}
