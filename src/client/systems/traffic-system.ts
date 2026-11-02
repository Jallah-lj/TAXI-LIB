import * as THREE from 'three';
import { VehicleEntity } from '../entities/vehicle';
import { PoliceVehicleRig } from '../entities/police-vehicle';
import { signalAtWaypoint, signalLimitedSpeed, trafficSignalLamp, type TrafficAxis } from '../../shared/traffic';
import type { SimulationState } from '../../shared/simulation';
import type { Point2 } from '../../shared/world';
import type { CollisionWorld } from './collision';
import type { ActorCollisionWorld } from './actor-collision';

interface TrafficCar {
  id: string;
  entity: VehicleEntity;
  points: THREE.Vector3[];
  target: number;
  speed: number;
  currentSpeed: number;
  waitingForGreen: boolean;
  police?: PoliceVehicleRig;
}

/** Convert road-center rectangles to corner points four metres into the right-hand lane. */
const rectangle = (x1: number, z1: number, x2: number, z2: number) => [
  new THREE.Vector3(x1 + 4, 0.08, z1 + 4), new THREE.Vector3(x2 - 4, 0.08, z1 + 4),
  new THREE.Vector3(x2 - 4, 0.08, z2 - 4), new THREE.Vector3(x1 + 4, 0.08, z2 - 4),
];

const westernLoop = rectangle(-120, -120, 120, 120);
const easternLoop = rectangle(0, -120, 240, 120);
const centralLoop = rectangle(0, 0, 120, 120);
const marketLoop = rectangle(-120, 0, 0, 120);

export class TrafficSystem {
  readonly group = new THREE.Group();
  private readonly cars: TrafficCar[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const colors = ['#657b72', '#a65f4e', '#d4c5a4', '#536c7e', '#8b765d', '#c28e37', '#44716b', '#b86750', '#d0b875', '#68738c', '#7e6654', '#a88c42'];
    const routes = [westernLoop, easternLoop, centralLoop, westernLoop, marketLoop, easternLoop, westernLoop, easternLoop, easternLoop, centralLoop, marketLoop, marketLoop];
    const starts = [0, 1, 2, 3, 1, 2, 1, 0, 3, 1, 0, 2];
    for (let index = 0; index < 12; index += 1) {
      const minibus = index === 4 || index === 10;
      const modelKind = minibus ? 'minibus' : index % 2 === 1 ? 'hatchback' : 'sedan';
      const entity = new VehicleEntity(colors[index]!, index === 5, undefined, minibus, modelKind);
      this.addCar(`traffic:${index}`, entity, routes[index]!, starts[index]!, 5.5 + index * 0.35);
    }
    this.addPolice(0, centralLoop, 0, 6.6);
    this.addPolice(1, westernLoop, 2, 7.1);
  }

  private addCar(id: string, entity: VehicleEntity, points: THREE.Vector3[], start: number, speed: number, police?: PoliceVehicleRig) {
    entity.group.position.copy(points[start]!);
    this.group.add(entity.group);
    this.cars.push({ id, entity, points, target: (start + 1) % points.length, speed, currentSpeed: 0, waitingForGreen: false, ...(police ? { police } : {}) });
  }

  private addPolice(index: number, route: THREE.Vector3[], start: number, speed: number) {
    const entity = new VehicleEntity('#e3e8e4', false, 'Community police', false, 'sedan', 'LR • SAFETY');
    const rig = new PoliceVehicleRig(index * 0.5);
    entity.group.add(rig.group);
    this.addCar(`police:${index}`, entity, route, start, speed, rig);
  }

  setVisible(visible: boolean) { this.group.visible = visible; }

  addCollisionObstacles(world: ActorCollisionWorld) {
    if (!this.group.visible) return;
    for (const car of this.cars) {
      world.addVehicle(car.id, car.entity.group.position, car.entity.group.rotation.y, car.entity.collisionBounds.halfWidth, car.entity.collisionBounds.halfLength);
    }
  }

  policePositions(): Point2[] {
    if (!this.group.visible) return [];
    return this.cars.filter((car) => car.police).map((car) => ({ x: car.entity.group.position.x, z: car.entity.group.position.z }));
  }

  update(
    dt: number, simulation: SimulationState, playerPosition: THREE.Vector3, collision: CollisionWorld, actors: ActorCollisionWorld,
    onPedestrianImpact: (actorId: string, speed: number) => void = () => undefined,
  ) {
    const hour = simulation.timeOfDaySeconds / 3600;
    const headlights = hour < 6.5 || hour > 18;
    for (const car of this.cars) {
      car.entity.setLights(headlights);
      car.police?.update(simulation.serverTime / 1000);
      const target = car.points[car.target]!;
      const position = car.entity.group.position;
      const delta = target.clone().sub(position);
      const distance = delta.length();
      if (distance < 2) {
        car.target = (car.target + 1) % car.points.length;
        car.waitingForGreen = false;
        continue;
      }
      const desiredHeading = Math.atan2(delta.x, delta.z);
      let difference = desiredHeading - car.entity.group.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      car.entity.group.rotation.y += difference * Math.min(1, dt * 3.2);

      const nearPlayer = position.distanceTo(playerPosition) < 9;
      let desiredSpeed = nearPlayer ? 0 : car.speed * (1 - simulation.rainIntensity * 0.2);
      const intersection = signalAtWaypoint(target.x, target.z);
      const axis: TrafficAxis = Math.abs(delta.x) > Math.abs(delta.z) ? 'horizontal' : 'vertical';
      if (intersection) {
        const lamp = trafficSignalLamp(axis, simulation.serverTime, intersection.id);
        if (car.waitingForGreen && lamp === 'green') car.waitingForGreen = false;
        if (!car.waitingForGreen && lamp !== 'green' && distance <= 11.35 && distance >= 8) car.waitingForGreen = true;
        desiredSpeed = car.waitingForGreen ? 0 : Math.min(desiredSpeed, signalLimitedSpeed(axis, simulation.serverTime, intersection.id, distance, desiredSpeed));
      }
      if (car.waitingForGreen) car.currentSpeed = 0;
      else car.currentSpeed += (desiredSpeed - car.currentSpeed) * Math.min(1, dt * (desiredSpeed < car.currentSpeed ? 5.5 : 2.5));

      const heading = car.entity.group.rotation.y;
      const nextX = position.x + Math.sin(heading) * car.currentSpeed * dt;
      const nextZ = position.z + Math.cos(heading) * car.currentSpeed * dt;
      const bounds = car.entity.collisionBounds;
      const staticBlocked = collision.blockedVehicle(nextX, nextZ, heading, bounds.halfWidth, bounds.halfLength);
      const actorContact = actors.vehicleContact(
        { x: nextX, z: nextZ, heading, ...bounds }, car.id, 0.3,
        { x: position.x, z: position.z, heading, ...bounds },
      );
      if (!staticBlocked && !actorContact && !car.waitingForGreen) {
        position.x = nextX;
        position.z = nextZ;
      } else if (!car.waitingForGreen) {
        if (!staticBlocked && actorContact?.kind === 'person') onPedestrianImpact(actorContact.id, Math.abs(car.currentSpeed));
        car.currentSpeed = 0;
      }
      car.entity.update(dt, car.currentSpeed);
    }
  }
}
