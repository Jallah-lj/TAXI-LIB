import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_EDGES, ROAD_NODES, ROAD_WIDTH, getLocation, type Point2 } from '../../shared/world';
import { PROPERTY_CATALOG } from '../../shared/catalog';
import { getDistrictLighting } from '../../shared/lighting';
import { homeOrigin } from '../../shared/homes';
import type { SimulationState } from '../../shared/simulation';
import { CollisionWorld } from '../systems/collision';
import { asphaltTexture, corrugatedTexture, grassTexture, makeTextTexture, plasterTexture, sandTexture, waterTexture } from './materials';
import { TrafficSignals } from './traffic-signals';

interface BuildingOptions {
  x: number; z: number; width: number; depth: number; height: number; color: string;
  rotation?: number; label?: string; subtitle?: string; shop?: boolean; tank?: boolean;
}

export class District {
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  private readonly roadMaterial = new THREE.MeshStandardMaterial({ map: asphaltTexture, color: '#a6a6a0', roughness: 0.88, metalness: 0.03 });
  private readonly roadLineMaterial = new THREE.MeshStandardMaterial({ color: '#e5d8ab', emissive: '#a89b74', emissiveIntensity: 0, roughness: 0.8 });
  private readonly lampMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly windowMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly lampPositions: Point2[] = [];
  private readonly nightLights: THREE.PointLight[] = [];
  private readonly trafficSignals: TrafficSignals;
  private lastLightRefresh = -Infinity;
  private randomSeed = 74193;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'Sinkor coastal district';
    this.scene.add(this.group);
    this.buildGround();
    this.buildRoads();
    this.buildLandmarks();
    this.buildNeighborhoods();
    this.buildStreetFurniture();
    this.buildCoastline();
    this.trafficSignals = new TrafficSignals(this.group, this.collision);
    for (let index = 0; index < 6; index += 1) {
      const light = new THREE.PointLight('#ffd696', 0, 29, 2);
      light.visible = false;
      light.castShadow = false;
      this.nightLights.push(light);
      this.group.add(light);
    }
  }

  private random() {
    this.randomSeed = this.randomSeed * 16807 % 2147483647;
    return (this.randomSeed - 1) / 2147483646;
  }

  private buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshStandardMaterial({ map: grassTexture, color: '#9ca285', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(35, -0.09, 0);
    ground.receiveShadow = true;
    this.group.add(ground);

    const sand = new THREE.Mesh(new THREE.PlaneGeometry(35, 500), new THREE.MeshStandardMaterial({ map: sandTexture, color: '#d6c89f', roughness: 0.96 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(-158, -0.025, 0);
    sand.receiveShadow = true;
    this.group.add(sand);

    const water = new THREE.Mesh(new THREE.PlaneGeometry(310, 600), new THREE.MeshPhysicalMaterial({
      map: waterTexture, color: '#6ea6a5', roughness: 0.25, metalness: 0.18, transparent: true, opacity: 0.94,
    }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(-327, -0.16, 0);
    water.receiveShadow = true;
    this.group.add(water);

    const foam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 500), new THREE.MeshBasicMaterial({ color: '#d5e3d5', transparent: true, opacity: 0.42 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(-175.1, -0.07, 0);
    this.group.add(foam);
  }

  private buildRoads() {
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: '#b8b2a3', roughness: 0.94, map: plasterTexture });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: '#8d8d80', roughness: 1 });
    const dashGeometry = new THREE.BoxGeometry(0.14, 0.025, 4.2);
    const dashes: THREE.Matrix4[] = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (const edge of ROAD_EDGES) {
      const from = ROAD_NODES.find((node) => node.id === edge.from)!;
      const to = ROAD_NODES.find((node) => node.id === edge.to)!;
      const horizontal = from.z === to.z;
      const length = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.z - from.z);
      const x = (from.x + to.x) / 2;
      const z = (from.z + to.z) / 2;
      const road = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : ROAD_WIDTH, 0.08, horizontal ? ROAD_WIDTH : length), this.roadMaterial);
      road.position.set(x, 0, z);
      road.receiveShadow = true;
      this.group.add(road);

      for (const side of [-1, 1]) {
        const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 3.2, 0.16, horizontal ? 3.2 : length), sidewalkMaterial);
        sidewalk.position.set(horizontal ? x : x + side * (ROAD_WIDTH / 2 + 1.6), 0.055, horizontal ? z + side * (ROAD_WIDTH / 2 + 1.6) : z);
        sidewalk.receiveShadow = true;
        this.group.add(sidewalk);
        const curb = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 0.22, 0.24, horizontal ? 0.22 : length), curbMaterial);
        curb.position.set(horizontal ? x : x + side * (ROAD_WIDTH / 2 + 0.1), 0.07, horizontal ? z + side * (ROAD_WIDTH / 2 + 0.1) : z);
        this.group.add(curb);
      }

      for (let offset = -length / 2 + 8; offset < length / 2 - 5; offset += 11) {
        const position = new THREE.Vector3(horizontal ? x + offset : x, 0.065, horizontal ? z : z + offset);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), horizontal ? Math.PI / 2 : 0);
        matrix.compose(position, quaternion, scale);
        dashes.push(matrix.clone());
      }
    }
    const markings = new THREE.InstancedMesh(dashGeometry, this.roadLineMaterial, dashes.length);
    dashes.forEach((transform, index) => markings.setMatrixAt(index, transform));
    markings.receiveShadow = true;
    this.group.add(markings);

    for (const z of [-120, 0, 120]) {
      for (const x of [-120, 0, 120, 240]) {
        if (!ROAD_NODES.some((node) => node.x === x && node.z === z)) continue;
        for (let stripe = -3; stripe <= 3; stripe += 1) {
          const crossing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.025, 4.5), this.roadLineMaterial);
          crossing.position.set(x + stripe * 2, 0.068, z + 11.5);
          this.group.add(crossing);
        }
      }
    }
  }

  private buildLandmarks() {
    this.building({ x: -62, z: -47, width: 47, depth: 25, height: 7.5, color: '#b99a70', rotation: Math.PI / 2, label: 'Sinkor Market', subtitle: 'Produce • Provisions • Goods', shop: true });
    this.building({ x: -72, z: 62, width: 34, depth: 27, height: 20, color: '#d4c6a7', rotation: -Math.PI / 2, label: 'Oceanview Hotel', subtitle: 'Fictional coastal guest house', tank: true });
    this.building({ x: 62, z: -62, width: 39, depth: 27, height: 9, color: '#d7d7c7', rotation: Math.PI / 2, label: 'Community Clinic', subtitle: 'Neighborhood care • Game location', shop: true });
    this.building({ x: 62, z: 63, width: 38, depth: 29, height: 7, color: '#8c9a8a', rotation: Math.PI / 2, label: 'Cooperative Garage', subtitle: 'Kendeja Transport Co-op', shop: true });
    this.buildMarket();
    this.buildPropertyHomes();
    this.buildTaxiStand();
    this.buildGarageYard();
    this.buildCivicCampus();
  }

  private buildNeighborhoods() {
    const palettes = ['#c6b18e', '#a9b5a1', '#c99177', '#d2c7ae', '#9faeb1', '#c0a58e', '#d2b773'];
    const centers: [number, number][] = [];
    for (const x of [-62, 62, 180]) {
      for (const z of [-62, 62]) {
        if ((x === -62 && z === -62) || (x === -62 && z === 62) || (x === 62 && Math.abs(z) === 62) || (x === 180 && z === 62)) continue;
        centers.push([x, z]);
      }
      centers.push([x, -156], [x, 156]);
    }

    for (const [x, z] of centers) {
      const verticalBlock = Math.abs(z) > 100;
      const count = verticalBlock ? 2 : 3;
      for (let index = 0; index < count; index += 1) {
        const offset = (index - (count - 1) / 2) * (verticalBlock ? 29 : 25);
        const bx = verticalBlock ? x + offset : x - 27 + index * 27;
        const bz = verticalBlock ? z : z + (index % 2 ? 18 : -14);
        if (Math.abs(bx) < 23 || Math.abs(bx - 120) < 23 || Math.abs(bx - 240) < 20 || Math.abs(bx + 120) < 20) continue;
        if (Math.abs(bz) < 22 || Math.abs(bz - 120) < 22 || Math.abs(bz + 120) < 22) continue;
        const width = 17 + this.random() * 7;
        const depth = 17 + this.random() * 8;
        const height = 5.5 + Math.floor(this.random() * 3) * 3.1;
        this.building({
          x: bx, z: bz, width, depth, height, color: palettes[Math.floor(this.random() * palettes.length)]!,
          rotation: this.random() > 0.5 ? 0 : Math.PI, shop: this.random() > 0.72,
          label: this.random() > 0.78 ? ['Neighborhood Shop', 'Kola House', 'Palm Guesthouse'][Math.floor(this.random() * 3)] : undefined,
          tank: this.random() > 0.75,
        });
      }
    }
  }

  private building(options: BuildingOptions) {
    const { x, z, width, depth, height, rotation = 0 } = options;
    const building = new THREE.Group();
    building.position.set(x, 0.13, z);
    building.rotation.y = rotation;
    const wall = new THREE.MeshStandardMaterial({ map: plasterTexture, color: options.color, roughness: 0.91 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wall);
    body.position.y = height / 2;
    body.castShadow = true; body.receiveShadow = true;
    building.add(body);

    const foundation = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.5, depth + 0.3), new THREE.MeshStandardMaterial({ color: '#6f7269', roughness: 1 }));
    foundation.position.y = 0.25;
    building.add(foundation);

    const roofMaterial = new THREE.MeshStandardMaterial({ map: corrugatedTexture, color: this.random() > 0.45 ? '#9c6954' : '#8d9690', roughness: 0.72, metalness: 0.22 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.25, depth + 1.2), roofMaterial);
    roof.position.y = height + 0.13;
    roof.rotation.z = (this.random() - 0.5) * 0.035;
    roof.castShadow = true;
    building.add(roof);

    const windowGeometries: THREE.BufferGeometry[] = [];
    const floors = Math.max(1, Math.floor(height / 3.2));
    const columns = Math.max(2, Math.floor(width / 5));
    for (let floor = 0; floor < floors; floor += 1) {
      for (let column = 0; column < columns; column += 1) {
        for (const side of [-1, 1]) {
          const geometry = new THREE.BoxGeometry(1.25, 1.25, 0.09);
          geometry.translate(-width / 2 + (column + 0.5) * width / columns, 2 + floor * 3.05, side * (depth / 2 + 0.055));
          windowGeometries.push(geometry);
        }
      }
    }
    const merged = mergeGeometries(windowGeometries);
    if (merged) {
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: '#29434a', emissive: '#ffd28a', emissiveIntensity: 0, roughness: 0.25, metalness: 0.32,
      });
      windowMaterial.userData.nightScale = 0.55 + (Math.abs(Math.round(x * 3 + z * 5)) % 45) / 100;
      this.windowMaterials.push(windowMaterial);
      const windows = new THREE.Mesh(merged, windowMaterial);
      building.add(windows);
    }

    const door = new THREE.Mesh(new THREE.BoxGeometry(1.65, 2.5, 0.13), new THREE.MeshStandardMaterial({ color: '#35524d', roughness: 0.75 }));
    door.position.set(0, 1.25, depth / 2 + 0.08);
    building.add(door);
    if (options.shop) {
      const awning = new THREE.Mesh(new THREE.BoxGeometry(Math.min(width * 0.65, 15), 0.18, 2.2), new THREE.MeshStandardMaterial({ color: '#d5b04b', roughness: 0.8 }));
      awning.position.set(0, 2.9, depth / 2 + 1);
      awning.rotation.x = -0.13;
      building.add(awning);
    }
    if (options.label) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width * 0.78, 15), 2.3), new THREE.MeshStandardMaterial({
        map: makeTextTexture(options.label, { subtitle: options.subtitle, background: '#23443f' }), roughness: 0.75,
      }));
      sign.position.set(0, Math.min(height - 1.1, 4.7), depth / 2 + 0.13);
      building.add(sign);
    }
    if (options.tank) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2, 12), new THREE.MeshStandardMaterial({ color: '#404f4c', roughness: 0.65 }));
      tank.position.set(width * 0.25, height + 1.25, 0);
      building.add(tank);
    }
    this.group.add(building);
    const swap = Math.abs(Math.sin(rotation)) > 0.5;
    this.collision.add(x, z, swap ? depth : width, swap ? width : depth);
  }

  private buildPropertyHomes() {
    for (const property of PROPERTY_CATALOG) {
      const origin = homeOrigin(property);
      const coastal = property.id === 'coastal-cottage';
      this.building({
        x: origin.x, z: origin.z, width: 14, depth: 12, height: coastal ? 5.8 : 4.8,
        color: coastal ? '#c7d1c2' : '#d2bd96', label: property.name,
        subtitle: 'Private residence • Citizen property', tank: coastal,
      });
      const entrance = getLocation(property.locationId);
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.05, 32),
        new THREE.MeshStandardMaterial({ color: '#e4b74e', emissive: '#b78326', emissiveIntensity: 0.5, roughness: 0.7, side: THREE.DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(entrance.x, 0.17, entrance.z);
      this.group.add(marker);
      const path = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.4), new THREE.MeshStandardMaterial({ color: '#aaa493', roughness: 0.95 }));
      path.position.set(entrance.x, 0.11, entrance.z - 0.55);
      this.group.add(path);
    }
  }

  private buildMarket() {
    const stallColors = ['#c65e47', '#d8ad43', '#46766a', '#667f9a'];
    for (let index = 0; index < 7; index += 1) {
      const x = -96 + (index % 4) * 19;
      const z = -82 - Math.floor(index / 4) * 19;
      const stall = new THREE.Group();
      stall.position.set(x, 0.12, z);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(8.2, 2.2, 4), new THREE.MeshStandardMaterial({ color: stallColors[index % 4], roughness: 0.85, side: THREE.DoubleSide }));
      roof.position.y = 3.8; roof.rotation.y = Math.PI / 4; roof.scale.z = 0.72;
      stall.add(roof);
      for (const px of [-4.8, 4.8]) for (const pz of [-3.2, 3.2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.5, 6), new THREE.MeshStandardMaterial({ color: '#6f5a3c' }));
        post.position.set(px, 1.75, pz); stall.add(post);
      }
      const counter = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.25, 2.2), new THREE.MeshStandardMaterial({ color: '#856847', roughness: 0.95 }));
      counter.position.set(0, 1, 0); stall.add(counter);
      for (let item = 0; item < 14; item += 1) {
        const produce = new THREE.Mesh(new THREE.SphereGeometry(0.18 + this.random() * 0.1, 6, 5), new THREE.MeshStandardMaterial({ color: ['#789345', '#bf713d', '#d2b248'][index % 3], roughness: 1 }));
        produce.position.set(-3.5 + (item % 7) * 1.05, 1.28, -0.45 + Math.floor(item / 7) * 0.9);
        stall.add(produce);
      }
      this.group.add(stall);
      this.collision.add(x, z, 8.7, 2.4);
      for (const px of [-4.8, 4.8]) for (const pz of [-3.2, 3.2]) this.collision.add(x + px, z + pz, 0.25, 0.25);
    }
  }

  private buildTaxiStand() {
    const shelter = new THREE.Group();
    shelter.position.set(-14, 0.12, 43);
    const metal = new THREE.MeshStandardMaterial({ color: '#31544e', roughness: 0.6, metalness: 0.35 });
    for (const x of [-3.6, 3.6]) for (const z of [-1.5, 1.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), metal);
      post.position.set(x, 1.6, z); shelter.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.2, 4.2), new THREE.MeshStandardMaterial({ map: corrugatedTexture, color: '#d0b35f', roughness: 0.7 }));
    roof.position.y = 3.25; shelter.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.18, 0.7), new THREE.MeshStandardMaterial({ color: '#795c3d' }));
    bench.position.set(0, 0.75, 0); shelter.add(bench);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.3), new THREE.MeshStandardMaterial({ map: makeTextTexture('12th Street Taxi', { subtitle: 'Community transport', background: '#244a43' }) }));
    sign.position.set(0, 2.45, 2.14); shelter.add(sign);
    this.group.add(shelter);
    this.collision.add(-14, 43, 5.5, 0.7);
    for (const x of [-17.6, -10.4]) for (const z of [41.5, 44.5]) this.collision.add(x, z, 0.25, 0.25);

    const welcome = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.1), new THREE.MeshStandardMaterial({ map: makeTextTexture('SINKOR', { subtitle: 'Fictional coastal district • Monrovia', background: '#183d39', color: '#f4e8cd' }) }));
    welcome.position.set(14, 3.6, 110);
    welcome.rotation.y = Math.PI;
    this.group.add(welcome);
    for (const x of [9, 19]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 5, 8), metal);
      pole.position.set(x, 2.5, 110); this.group.add(pole);
      this.collision.add(x, 110, 0.3, 0.3);
    }
  }

  private buildGarageYard() {
    for (let index = 0; index < 5; index += 1) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.16, 8, 16), new THREE.MeshStandardMaterial({ color: '#202421', roughness: 1 }));
      tire.position.set(34 + (index % 2) * 0.3, 0.55 + Math.floor(index / 2) * 0.28, 78);
      tire.rotation.x = Math.PI / 2;
      this.group.add(tire);
    }
    this.collision.add(34.15, 78, 1.5, 1.3);
  }

  private buildCivicCampus() {
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(100, 0.08, 55), new THREE.MeshStandardMaterial({ color: '#9c9b8d', roughness: 0.96, map: plasterTexture }));
    plaza.position.set(186, 0.01, 80); plaza.receiveShadow = true; this.group.add(plaza);
    const approach = new THREE.Mesh(new THREE.BoxGeometry(28, 0.09, 4), new THREE.MeshStandardMaterial({ color: '#b8b2a3', roughness: 0.94 }));
    approach.position.set(136, 0.04, 80); this.group.add(approach);
    this.building({ x: 165, z: 62, width: 42, depth: 24, height: 8.5, color: '#d3c8aa', label: 'Municipal Services', subtitle: 'Fictional public works • Sanitation • Market standards', shop: true, tank: true });
    this.building({ x: 207, z: 62, width: 28, depth: 24, height: 7.2, color: '#aebdb8', label: 'District Safety', subtitle: 'Fictional community police & road safety', shop: true });
    const deskMaterial = new THREE.MeshStandardMaterial({ color: '#47645b', roughness: 0.78 });
    for (const [x, label] of [[165, 'PUBLIC SERVICES'], [207, 'SAFETY SERVICES']] as const) {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 1.2), deskMaterial);
      desk.position.set(x, 0.65, 78.2); desk.castShadow = true; this.group.add(desk);
      this.collision.add(x, 78.2, 4.2, 1.2);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.65), new THREE.MeshStandardMaterial({ map: makeTextTexture(label, { width: 512, height: 96, background: '#173d37', color: '#f3d076' }), side: THREE.DoubleSide }));
      sign.position.set(x, 0.77, 78.82); this.group.add(sign);
      const marker = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.9, 32), new THREE.MeshBasicMaterial({ color: '#e7bd55', transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.set(x, 0.15, 80); this.group.add(marker);
    }
    this.safetySign(14, 56, '30 km/h', 'Taxi-stand safety zone');
    this.safetySign(-10, -64, '25 km/h', 'Market safety zone');
  }

  private safetySign(x: number, z: number, title: string, subtitle: string) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), new THREE.MeshStandardMaterial({ color: '#42544f', roughness: 0.7, metalness: 0.25 }));
    pole.position.set(x, 1.7, z); this.group.add(pole);
    this.collision.add(x, z, 0.25, 0.25);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.8), new THREE.MeshStandardMaterial({ map: makeTextTexture(title, { subtitle, background: '#244a43', color: '#f2ce68' }), side: THREE.DoubleSide, roughness: 0.75 }));
    sign.position.set(x, 3.15, z); this.group.add(sign);
  }

  private buildStreetFurniture() {
    for (const x of [-120, 0, 120, 240]) {
      for (let z = -168; z <= 168; z += 48) {
        if (x === 240 && Math.abs(z) > 120) continue;
        this.streetLight(x + 11.8, z);
      }
    }
    for (const [x, z] of [[-140, -85], [-140, -25], [-140, 42], [-140, 118], [-95, 140], [-35, 135], [32, -135], [98, 140], [150, 25], [214, -35], [-95, -135], [190, 145]] as [number, number][]) {
      this.palm(x, z, 6.5 + this.random() * 3);
    }
  }

  private streetLight(x: number, z: number) {
    this.lampPositions.push({ x, z });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: '#454d49', roughness: 0.65, metalness: 0.45 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 6.2, 8), poleMaterial);
    pole.position.set(x, 3.1, z);
    this.group.add(pole);
    this.collision.add(x, z, 0.28, 0.28);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), poleMaterial);
    arm.position.set(x - 0.68, 6.1, z); this.group.add(arm);
    const material = new THREE.MeshStandardMaterial({ color: '#d9d4b8', emissive: '#f1c76a', emissiveIntensity: 0 });
    this.lampMaterials.push(material);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.13, 0.3), material);
    lamp.position.set(x - 1.35, 6.03, z); this.group.add(lamp);
  }

  private palm(x: number, z: number, height: number) {
    const palm = new THREE.Group();
    palm.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, height, 8), new THREE.MeshStandardMaterial({ color: '#80684a', roughness: 1 }));
    trunk.position.y = height / 2; trunk.rotation.z = (this.random() - 0.5) * 0.12; trunk.castShadow = true;
    palm.add(trunk);
    const leafMaterial = new THREE.MeshStandardMaterial({ color: '#386b4b', roughness: 0.9, side: THREE.DoubleSide });
    for (let index = 0; index < 7; index += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.65, 4.5, 4), leafMaterial);
      const angle = index / 7 * Math.PI * 2;
      leaf.position.set(Math.sin(angle) * 1.45, height - 0.15, Math.cos(angle) * 1.45);
      leaf.rotation.z = Math.PI / 2.6;
      leaf.rotation.y = angle;
      leaf.scale.set(0.5, 1, 0.18);
      palm.add(leaf);
    }
    this.group.add(palm);
    this.collision.add(x, z, 0.6, 0.6);
  }

  private buildCoastline() {
    for (let index = 0; index < 18; index += 1) {
      const size = 0.5 + this.random() * 0.7;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), new THREE.MeshStandardMaterial({ color: '#7d8074', roughness: 1 }));
      rock.position.set(-169 + this.random() * 4, 0.1, -210 + index * 25 + this.random() * 8);
      rock.scale.y = 0.55;
      this.group.add(rock);
      this.collision.add(rock.position.x, rock.position.z, size * 2, size * 2);
    }
    for (const z of [-150, -60, 70, 165]) this.palm(-151, z, 7 + this.random() * 2);
  }

  update(simulation: SimulationState, focus: THREE.Vector3) {
    this.trafficSignals.update(simulation.serverTime);
    waterTexture.offset.y = (simulation.serverTime / 1000 * 0.004) % 1;
    waterTexture.offset.x = Math.sin(simulation.serverTime / 1000 * 0.08) * 0.02;
    const profile = getDistrictLighting(simulation);
    for (const material of this.lampMaterials) material.emissiveIntensity = profile.lampEmissive;
    for (const material of this.windowMaterials) {
      material.emissiveIntensity = profile.windowEmissive * Number(material.userData.nightScale ?? 1);
    }
    this.roadLineMaterial.emissiveIntensity = profile.nightFactor * 0.22;

    if (profile.nightFactor > 0.02 && simulation.serverTime - this.lastLightRefresh > 450) {
      this.lastLightRefresh = simulation.serverTime;
      const nearest = [...this.lampPositions].sort((a, b) => {
        const distanceA = (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2;
        const distanceB = (b.x - focus.x) ** 2 + (b.z - focus.z) ** 2;
        return distanceA - distanceB;
      });
      this.nightLights.forEach((light, index) => {
        const lamp = nearest[index];
        if (lamp) light.position.set(lamp.x - 1.35, 5.85, lamp.z);
      });
    }
    for (const light of this.nightLights) {
      light.visible = profile.nightFactor > 0.02;
      light.intensity = profile.streetlightIntensity;
    }

    this.roadMaterial.roughness = 0.88 - simulation.rainIntensity * 0.58;
    this.roadMaterial.metalness = 0.03 + simulation.rainIntensity * 0.23;
    this.roadMaterial.color.setRGB(0.65 - simulation.rainIntensity * 0.17, 0.65 - simulation.rainIntensity * 0.17, 0.63 - simulation.rainIntensity * 0.15);
  }
}
