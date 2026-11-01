import * as THREE from 'three';
import { District } from './world/district';
import { WeatherSystem } from './systems/weather';
import { NPCSystem } from './systems/npc-system';
import { TrafficSystem } from './systems/traffic-system';
import { Controls, conversationInput } from './systems/controls';
import { LocalController } from './systems/local-controller';
import { RemotePlayers } from './systems/remote-players';
import { RealtimeClient } from './realtime';
import { GameMap } from './systems/map';
import { AudioSystem } from './systems/audio';
import { ActorCollisionWorld } from './systems/actor-collision';
import { CharacterEntity } from './entities/character';
import { getSimulationState, type SimulationState } from '../shared/simulation';
import { distance2D, getLocation, WORLD_LOCATIONS, type Point2 } from '../shared/world';
import { routeBetween } from '../shared/navigation';
import type { MovementState } from '../shared/protocol';
import { healthyHealth, type PlayerHealthState } from '../shared/health';
import type { PlayerProperty, TaxiTrip, Wallet, WorldBootstrap } from '../shared/types';
import { PROPERTY_CATALOG, type PropertyCatalogEntry } from '../shared/catalog';
import type { HomeRoomId } from '../shared/homes';
import { HomeInterior } from './world/home-interior';
import { TaskObjectives } from './world/task-objectives';
import { CivicIncidentWorld } from './world/civic-incidents';
import {
  CIVIC_INTERACTION_RADIUS, CIVIC_REPORT_SITES, CIVIC_SERVICE_POINTS,
  type CivicIncident, type CivicPanelTarget, type PlayerSafetyState,
} from '../shared/civic';
import { CITIZEN_TASK_INTERACTION_RADIUS, citizenTaskRoutePoint, currentCitizenTaskStep, type CitizenTask } from '../shared/tasks';
import {
  defaultClientSettings, exposureForBrightness, getRenderPixelRatio, QUALITY_PROFILES,
  type ClientSettings, type GraphicsSettings,
} from './settings';

export interface HomeHUDState {
  propertyId: string;
  name: string;
  level: number;
  currentRoomId: HomeRoomId;
  lightsOn: boolean;
  rooms: { id: HomeRoomId; name: string; description: string }[];
}

export interface CitizenTaskInteraction {
  taskId: string;
  stepId: string;
  position: [number, number];
}

interface ActiveInterior {
  property: PlayerProperty;
  listing: PropertyCatalogEntry;
  interior: HomeInterior;
}

export interface HUDState {
  speedKmh: number;
  fuelPercent: number;
  conditionPercent: number;
  mode: 'walking' | 'driving';
  position: Point2;
  heading: number;
  simulation: SimulationState;
  onlineCount: number;
  areaName: string;
  destinationName: string | null;
  destinationDistance: number | null;
  vehicleName: string;
  /** Live on-foot distance used by contextual guidance; zero while driving. */
  vehicleDistance: number;
  lightsOn: boolean;
  health: PlayerHealthState;
}

interface GameCallbacks {
  onHUD: (state: HUDState) => void;
  onPrompt: (text: string | null) => void;
  onTripAction: (action: 'pickup' | 'complete' | null) => void;
  onTripRequest: () => void;
  onTaskRequest: (interaction: CitizenTaskInteraction) => void;
  onCivicTarget: (target: CivicPanelTarget) => void;
  onCivicIncidents: (incidents: CivicIncident[]) => void;
  onSafety: (safety: PlayerSafetyState, wallet: Wallet, notice: string) => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onConnection: (connected: boolean) => void;
  onChat: (message: { displayName: string; text: string; sentAt: string }) => void;
  onHome: (home: HomeHUDState | null) => void;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2500);
  private readonly district: District;
  private readonly taskObjectives: TaskObjectives;
  private readonly civicWorld: CivicIncidentWorld;
  private readonly weather: WeatherSystem;
  private readonly npcs: NPCSystem;
  private readonly traffic: TrafficSystem;
  private readonly remotes: RemotePlayers;
  private readonly controls: Controls;
  private readonly map: GameMap;
  private readonly actorCollisions = new ActorCollisionWorld();
  private readonly realtime: RealtimeClient;
  readonly audio = new AudioSystem();
  private local?: LocalController;
  private bootstrap?: WorldBootstrap;
  private trip: TaxiTrip | null = null;
  private task: CitizenTask | null = null;
  private civicIncidents: CivicIncident[] = [];
  private civicWaypoint: (Point2 & { key: string; locationId: string }) | null = null;
  private waypointId: string | null = null;
  private route: Point2[] = [];
  private routeLine?: THREE.Line;
  private marker = new THREE.Group();
  private passenger?: CharacterEntity;
  private simulation = getSimulationState();
  private serverOffset = 0;
  private entered = false;
  private firstPerson = false;
  private sequence = 0;
  private networkAccumulator = 0;
  private hudAccumulator = 0;
  private routeAccumulator = 0;
  private lastTime = performance.now();
  private connected = false;
  private currentTripAction: 'pickup' | 'complete' | null = null;
  private activeInterior?: ActiveInterior;
  private exteriorCameraDistance?: number;
  private graphicsSettings = defaultClientSettings().graphics;
  private graphicsApplied = false;
  private conversationActive = false;
  private playerHealth = healthyHealth('local');

  constructor(private readonly canvas: HTMLCanvasElement, minimap: HTMLCanvasElement, fullmap: HTMLCanvasElement, private readonly callbacks: GameCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.65, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.district = new District(this.scene);
    this.taskObjectives = new TaskObjectives(this.scene);
    this.civicWorld = new CivicIncidentWorld(this.scene);
    this.weather = new WeatherSystem(this.scene, this.camera);
    this.npcs = new NPCSystem(this.scene);
    this.traffic = new TrafficSystem(this.scene);
    this.remotes = new RemotePlayers(this.scene);
    this.map = new GameMap(minimap, fullmap);
    this.map.onWaypoint = (id) => this.setWaypoint(id);
    this.controls = new Controls(canvas, (action) => this.controlAction(action));
    this.controls.enabled = false;
    this.realtime = new RealtimeClient({
      onOpen: () => { this.connected = true; this.callbacks.onConnection(true); },
      onClose: () => { this.connected = false; this.callbacks.onConnection(false); },
      onWelcome: () => { this.sequence = 0; },
      onSnapshot: (players) => players.forEach((player) => this.remotes.apply(player)),
      onProfile: (profile) => this.remotes.addProfile(profile),
      onState: (state) => this.remotes.apply(state),
      onLeave: (id) => this.remotes.remove(id),
      onChat: (message) => this.callbacks.onChat(message),
      onEmote: (id) => this.remotes.emote(id),
      onSimulation: (simulation) => { this.simulation = simulation; this.serverOffset = simulation.serverTime - Date.now(); },
      onCivicIncidents: (incidents) => { this.setCivicIncidents(incidents); this.callbacks.onCivicIncidents(incidents); },
      onPlayerHealth: (playerId, health, state) => this.applyPlayerHealth(playerId, health, state),
      onSafety: (safety, wallet, notice) => this.callbacks.onSafety(safety, wallet, notice),
      onError: (message) => this.callbacks.onToast(message, 'error'),
    });
    this.buildMarker();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop((time) => this.update(time));
  }

  async enter(bootstrap: WorldBootstrap) {
    this.bootstrap = bootstrap;
    this.simulation = bootstrap.simulation;
    this.serverOffset = bootstrap.simulation.serverTime - Date.now();
    const vehicle = bootstrap.vehicles.find((entry) => entry.id === bootstrap.selectedVehicleId) ?? bootstrap.vehicles[0];
    if (!vehicle) throw new Error('No vehicle is assigned to this account.');
    this.playerHealth = healthyHealth(bootstrap.player.id);
    this.local = new LocalController(bootstrap.player, vehicle, this.scene, (actorId, speed) => this.handlePedestrianImpact(actorId, speed));
    if (this.local.character.nameSprite) this.local.character.nameSprite.visible = false;
    if (this.local.vehicle.nameSprite) this.local.vehicle.nameSprite.visible = false;
    this.entered = true;
    this.controls.enabled = true;
    this.setTrip(bootstrap.activeTrip);
    this.setTask(bootstrap.activeTask);
    this.setCivicIncidents(bootstrap.civic.incidents);
    void this.realtime.connect();
    await this.audio.start();
    this.callbacks.onToast(`Welcome to the coastal district, ${bootstrap.player.displayName}. Your ${vehicle.model.name} is ready.`, 'success');
  }

  private handlePedestrianImpact(actorId: string, speed: number) {
    const outcome = this.npcs.applyVehicleImpact(actorId, speed, Date.now() + this.serverOffset);
    if (!outcome) return;
    this.callbacks.onToast(
      outcome.condition === 'dead' ? `${outcome.name} died in the collision.` : `${outcome.name} was injured and needs time to recover.`,
      outcome.condition === 'dead' ? 'error' : 'info',
    );
  }

  private applyPlayerHealth(playerId: string, health: PlayerHealthState, state?: MovementState) {
    if (this.local?.profile.id === playerId) {
      const previous = this.playerHealth.condition;
      this.playerHealth = health;
      if (state && previous === 'dead' && health.condition === 'healthy') this.local.respawn();
      else this.local.setHealthCondition(health.condition);
      if (health.condition === 'injured' && previous !== 'injured') this.callbacks.onToast('You were injured. Movement is reduced while you recover.', 'info');
      if (health.condition === 'dead' && previous !== 'dead') this.callbacks.onToast('You died in the collision. Respawning at the taxi rank shortly.', 'error');
      if (health.condition === 'healthy' && previous === 'injured') this.callbacks.onToast('You have recovered.', 'success');
      if (health.condition === 'healthy' && previous === 'dead') this.callbacks.onToast('You have respawned at the taxi rank.', 'success');
      this.updateHUD();
      return;
    }
    if (state) this.remotes.apply(state, true);
    this.remotes.applyHealth(playerId, health);
  }

  setConversationActive(active: boolean) {
    this.conversationActive = active;
    if (active) {
      this.controls.clear();
      this.local?.stopForConversation();
    }
  }

  private buildMarker() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.5, 5.1, 40), new THREE.MeshBasicMaterial({ color: '#edbd4e', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.13;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(4.4, 40), new THREE.MeshBasicMaterial({ color: '#edbd4e', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.12;
    this.marker.add(ring, inner);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  controlAction(action: 'interact' | 'camera' | 'trip' | 'emote' | 'lights') {
    if (!this.local || !this.entered) return;
    if (action === 'interact') {
      if (this.playerHealth.condition === 'dead') {
        this.callbacks.onToast('You are being respawned. Please wait.', 'info');
        return;
      }
      if (this.activeInterior) {
        if (this.activeInterior.interior.nearExit(this.local.position)) this.exitProperty();
        else this.callbacks.onToast('Return to the front door or use Leave home in the room navigator.', 'info');
        return;
      }
      const taskInteraction = this.nearbyTaskInteraction();
      if (taskInteraction) {
        this.callbacks.onTaskRequest(taskInteraction);
        return;
      }
      const civicInteraction = this.nearbyCivicInteraction();
      if (civicInteraction) {
        this.callbacks.onCivicTarget(civicInteraction.target);
        return;
      }
      const property = this.nearbyOwnedProperty();
      if (property) {
        this.enterOwnedProperty(property);
        return;
      }
      const message = this.local.interact(this.district.collision, this.actorCollisions);
      if (message) this.callbacks.onToast(message, 'info');
    }
    if (action === 'camera') this.firstPerson = !this.firstPerson;
    if (action === 'trip' && this.currentTripAction) this.callbacks.onTripRequest();
    if (action === 'emote') { this.local.wave(); this.realtime.emote(); }
    if (action === 'lights') {
      if (this.activeInterior) {
        const on = this.activeInterior.interior.toggleLights();
        this.callbacks.onToast(`Home lights ${on ? 'on' : 'off'}.`, 'info');
        return;
      }
      if (this.local.mode !== 'driving') {
        this.callbacks.onToast('Enter your vehicle to operate its headlights.', 'info');
        return;
      }
      const on = this.local.toggleLights();
      this.callbacks.onToast(`Headlights ${on ? 'on' : 'off'}.`, 'info');
    }
  }

  toggleLights() { this.controlAction('lights'); }

  get isDriving() { return this.local?.mode === 'driving'; }
  get isInsideHome() { return Boolean(this.activeInterior); }

  accessProperty(propertyId: string): 'entered' | 'waypoint' {
    if (!this.local || !this.entered) throw new Error('Enter the district before accessing your home.');
    if (this.activeInterior?.property.id === propertyId) return 'entered';
    if (this.activeInterior) throw new Error('Leave your current home before accessing another property.');
    const property = this.ownedProperty(propertyId);
    if (this.trip) throw new Error('Finish or cancel your active trip before entering your home.');
    if (this.local.mode === 'driving') throw new Error('Park and exit your vehicle before entering your home.');
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === property.listingId);
    if (!listing) throw new Error('This property layout is unavailable.');
    const entrance = getLocation(listing.locationId);
    if (distance2D({ x: this.local.position.x, z: this.local.position.z }, entrance) > 4.5) {
      this.setWaypoint(listing.locationId);
      this.callbacks.onToast(`Directions set for ${listing.name}. At the front door, press E to enter.`, 'info');
      return 'waypoint';
    }
    this.enterOwnedProperty(property);
    return 'entered';
  }

  private ownedProperty(propertyId: string) {
    const property = this.bootstrap?.properties.find((entry) => entry.id === propertyId);
    if (!property) throw new Error('You do not own that property.');
    return property;
  }

  private nearbyOwnedProperty() {
    if (!this.local || !this.bootstrap || this.local.mode !== 'walking' || this.trip || this.playerHealth.condition === 'dead') return undefined;
    return this.bootstrap.properties.find((property) => {
      const listing = PROPERTY_CATALOG.find((entry) => entry.id === property.listingId);
      return listing && distance2D({ x: this.local!.position.x, z: this.local!.position.z }, getLocation(listing.locationId)) <= 4.5;
    });
  }

  private enterOwnedProperty(property: PlayerProperty) {
    if (!this.local || this.activeInterior) return;
    if (this.trip || this.local.mode !== 'walking') throw new Error('You must be on foot without an active trip to enter a home.');
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === property.listingId);
    if (!listing) throw new Error('This property layout is unavailable.');
    const interior = new HomeInterior({ ...property }, listing, this.scene);
    this.activeInterior = { property: { ...property }, listing, interior };
    this.local.enterHome(property.id, interior.entryPosition);
    this.exteriorCameraDistance = this.controls.cameraDistance;
    this.controls.cameraDistance = Math.min(4.2, this.controls.cameraDistance);
    this.setExteriorVisible(false);
    this.weather.setInterior(true);
    this.marker.visible = false;
    if (this.routeLine) this.routeLine.visible = false;
    this.callbacks.onToast(`Welcome to ${listing.name}. Use the room navigator or walk through your home.`, 'success');
    this.updateHUD();
  }

  exitProperty() {
    if (!this.local || !this.activeInterior) return;
    const name = this.activeInterior.listing.name;
    this.local.exitHome();
    this.activeInterior.interior.dispose();
    this.activeInterior = undefined;
    this.setExteriorVisible(true);
    this.weather.setInterior(false);
    if (this.exteriorCameraDistance !== undefined) this.controls.cameraDistance = this.exteriorCameraDistance;
    this.exteriorCameraDistance = undefined;
    this.routeAccumulator = 10;
    this.callbacks.onHome(null);
    this.callbacks.onToast(`You left ${name}.`, 'info');
  }

  visitHomeRoom(roomId: HomeRoomId) {
    if (!this.local || !this.activeInterior) return;
    const room = this.activeInterior.interior.rooms.find((entry) => entry.id === roomId);
    if (!room) return;
    const spawn = this.activeInterior.interior.roomSpawn(roomId);
    const centerX = room.bounds ? this.activeInterior.interior.origin.x + (room.bounds.minX + room.bounds.maxX) / 2 : spawn.x;
    const centerZ = room.bounds ? this.activeInterior.interior.origin.z + (room.bounds.minZ + room.bounds.maxZ) / 2 : spawn.z - 3;
    const heading = Math.atan2(centerX - spawn.x, centerZ - spawn.z);
    this.local.visitHomeRoom(spawn, heading);
    this.controls.cameraYaw = heading + Math.PI;
    this.callbacks.onToast(`${room.name} · ${room.description}`, 'info');
    this.updateHUD();
  }

  toggleHomeLights() {
    if (!this.activeInterior) return;
    const on = this.activeInterior.interior.toggleLights();
    this.callbacks.onToast(`Home lights ${on ? 'on' : 'off'}.`, 'info');
    this.updateHUD();
  }

  private setExteriorVisible(visible: boolean) {
    this.taskObjectives.setExteriorVisible(visible);
    this.civicWorld.group.visible = visible;
    this.district.group.visible = visible;
    this.npcs.setVisible(visible);
    this.traffic.setVisible(visible);
    this.remotes.setSuppressed(!visible);
    if (this.local) this.local.vehicle.group.visible = visible;
  }

  applyLifestyle(state: Pick<WorldBootstrap, 'vehicles' | 'selectedVehicleId' | 'properties'>) {
    if (this.bootstrap) {
      this.bootstrap.vehicles = state.vehicles;
      this.bootstrap.selectedVehicleId = state.selectedVehicleId;
      this.bootstrap.properties = state.properties;
    }
    if (this.activeInterior) {
      const property = state.properties.find((entry) => entry.id === this.activeInterior!.property.id);
      if (property) {
        this.activeInterior.property = { ...property };
        this.activeInterior.interior.setLevel(property.level);
      }
    }
    if (!this.local) return;
    const vehicle = state.vehicles.find((entry) => entry.id === state.selectedVehicleId) ?? state.vehicles[0];
    if (!vehicle) return;
    this.local.applyVehicle(vehicle);
    if (this.local.vehicle.nameSprite) this.local.vehicle.nameSprite.visible = false;
  }

  setTask(task: CitizenTask | null) {
    this.task = task;
    this.civicWaypoint = null;
    this.taskObjectives.setTask(task);
    if (!this.trip) {
      this.waypointId = currentCitizenTaskStep(task)?.locationId ?? null;
      this.routeAccumulator = 10;
    }
  }

  setCivicIncidents(incidents: CivicIncident[]) {
    if (this.civicWaypoint) {
      const targeted = incidents.find((incident) => incident.id === this.civicWaypoint!.key);
      if (targeted?.status === 'resolved') {
        this.civicWaypoint = null;
        if (!this.task) this.waypointId = null;
        this.routeAccumulator = 10;
      }
    }
    this.civicIncidents = incidents;
    this.civicWorld.setIncidents(incidents);
    this.npcs.setIncidents(incidents);
  }

  private nearbyTaskInteraction(): CitizenTaskInteraction | null {
    if (!this.local || this.local.mode !== 'walking' || this.activeInterior || this.playerHealth.condition === 'dead') return null;
    const step = currentCitizenTaskStep(this.task);
    if (!step || !this.task) return null;
    if (distance2D({ x: this.local.position.x, z: this.local.position.z }, step) > CITIZEN_TASK_INTERACTION_RADIUS) return null;
    return { taskId: this.task.id, stepId: step.id, position: [this.local.position.x, this.local.position.z] };
  }

  private nearbyCivicInteraction(): { target: CivicPanelTarget; prompt: string } | null {
    if (!this.local || this.local.mode !== 'walking' || this.activeInterior || this.playerHealth.condition === 'dead') return null;
    const position = { x: this.local.position.x, z: this.local.position.z };
    const incident = this.civicIncidents.filter((entry) => entry.status !== 'resolved')
      .find((entry) => distance2D(position, entry) <= CIVIC_INTERACTION_RADIUS);
    if (incident) return { target: { section: 'incidents', incidentId: incident.id }, prompt: `View ${incident.title} in Civic app` };
    const service = CIVIC_SERVICE_POINTS.find((entry) => distance2D(position, entry) <= CIVIC_INTERACTION_RADIUS);
    if (service) return { target: { section: service.section, departmentId: service.departmentId }, prompt: `Open ${service.label}` };
    const activeSites = new Set(this.civicIncidents.filter((entry) => entry.status !== 'resolved').map((entry) => entry.siteId));
    const site = CIVIC_REPORT_SITES.find((entry) => !activeSites.has(entry.id) && distance2D(position, entry) <= CIVIC_INTERACTION_RADIUS);
    if (site) return { target: { section: 'incidents', siteId: site.id }, prompt: `Report ${site.title} in Civic app` };
    const worker = this.npcs.nearestCivicWorker(this.local.character.group.position);
    if (worker) return {
      target: { section: worker.departmentId === 'community-safety' ? 'safety' : 'services', departmentId: worker.departmentId },
      prompt: `Speak with ${worker.name} · ${worker.role}`,
    };
    return null;
  }

  setTrip(trip: TaxiTrip | null) {
    this.trip = trip;
    this.civicWaypoint = null;
    this.currentTripAction = null;
    if (this.passenger) {
      this.scene.remove(this.passenger.group);
      this.passenger.dispose();
      this.passenger = undefined;
    }
    if (trip) {
      this.waypointId = trip.status === 'accepted' ? trip.pickupLocationId : trip.destinationLocationId;
      if (trip.status === 'accepted') {
        const pickup = getLocation(trip.pickupLocationId);
        this.passenger = new CharacterEntity({ skin: 3, hair: 1, top: 2, bottom: 0 }, trip.passengerName);
        this.passenger.group.position.set(pickup.x - 2, 0.14, pickup.z + 1.5);
        this.scene.add(this.passenger.group);
      }
    } else this.waypointId = null;
    this.routeAccumulator = 10;
  }

  setWaypoint(locationId: string | null) {
    if (this.trip) {
      this.callbacks.onToast('Your active passenger route takes priority. Cancel the trip to choose another waypoint.', 'info');
      return;
    }
    this.civicWaypoint = null;
    this.waypointId = locationId;
    this.routeAccumulator = 10;
    if (locationId) this.callbacks.onToast(`Waypoint set: ${getLocation(locationId).name}.`, 'info');
  }

  setCivicWaypoint(detail: { key: string; locationId: string; x: number; z: number; label: string }) {
    if (this.trip) {
      this.callbacks.onToast('Your active passenger route takes priority. Cancel the trip to choose another waypoint.', 'info');
      return;
    }
    getLocation(detail.locationId);
    this.civicWaypoint = { key: detail.key, locationId: detail.locationId, x: detail.x, z: detail.z };
    this.waypointId = detail.locationId;
    this.routeAccumulator = 10;
    this.callbacks.onToast(`Exact civic directions set: ${detail.label}.`, 'info');
  }

  setControlsEnabled(enabled: boolean) {
    this.controls.enabled = enabled && this.entered;
    if (!enabled) this.controls.clear();
  }

  applyClientSettings(settings: ClientSettings) {
    this.setGraphicsSettings(settings.graphics);
    this.audio.setVolume(settings.volume);
  }

  setGraphicsSettings(settings: GraphicsSettings) {
    const previous = this.graphicsSettings;
    this.graphicsSettings = { ...settings };
    const applyRendererState = !this.graphicsApplied || previous.quality !== settings.quality
      || previous.renderScale !== settings.renderScale || previous.shadows !== settings.shadows;
    if (!applyRendererState) return;
    this.graphicsApplied = true;
    const profile = QUALITY_PROFILES[settings.quality];
    this.renderer.setPixelRatio(getRenderPixelRatio(settings, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.weather.sun.castShadow = settings.shadows;
    if (this.weather.sun.shadow.mapSize.x !== profile.shadowMapSize) {
      this.weather.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.weather.sun.shadow.map?.dispose();
      this.weather.sun.shadow.map = null;
    }
    this.weather.setRainFraction(profile.rainFraction);
    this.resize();
  }

  chat(text: string) { this.realtime.chat(text); }

  private rebuildActorCollisions() {
    this.actorCollisions.clear();
    if (this.activeInterior) return;
    if (this.local) {
      if (this.local.mode === 'walking') this.actorCollisions.addPerson(this.local.personCollisionId, this.local.character.group.position, 0.32);
      if (this.local.vehicle.group.visible) {
        const bounds = this.local.vehicle.collisionBounds;
        this.actorCollisions.addVehicle(this.local.vehicleCollisionId, this.local.vehicle.group.position, this.local.vehicle.group.rotation.y, bounds.halfWidth, bounds.halfLength);
      }
    }
    this.traffic.addCollisionObstacles(this.actorCollisions);
    this.remotes.addCollisionObstacles(this.actorCollisions);
    this.npcs.addCollisionObstacles(this.actorCollisions);
    this.taskObjectives.addCollisionObstacles(this.actorCollisions);
    this.civicWorld.addCollisionObstacles(this.actorCollisions);
    if (this.passenger?.group.visible) this.actorCollisions.addPerson(this.passenger.group.uuid, this.passenger.group.position);
  }

  private update(time: number) {
    const dt = Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.simulation = getSimulationState(Date.now() + this.serverOffset);
    const focus = this.local?.position ?? new THREE.Vector3(0, 0, 0);
    this.district.update(this.simulation, focus);
    this.weather.update(dt, this.simulation, focus);
    const targetExposure = exposureForBrightness(this.weather.exposure, this.graphicsSettings.brightness);
    if (this.graphicsSettings.reducedMotion) this.renderer.toneMappingExposure = targetExposure;
    else this.renderer.toneMappingExposure += (targetExposure - this.renderer.toneMappingExposure) * (1 - Math.exp(-dt * 2.4));
    this.remotes.update(dt, focus);
    this.rebuildActorCollisions();
    this.npcs.update(dt, this.simulation, focus, this.local?.speed ?? 0, this.district.collision, this.actorCollisions);
    this.traffic.update(dt, this.simulation, focus, this.district.collision, this.actorCollisions, (actorId, speed) => this.handlePedestrianImpact(actorId, speed));
    this.taskObjectives.update(dt, this.graphicsSettings.reducedMotion);
    this.civicWorld.update(dt, this.graphicsSettings.reducedMotion, focus);
    if (this.passenger) this.passenger.update(dt, 0);
    if (!this.graphicsSettings.reducedMotion) this.marker.rotation.y += dt * 0.35;

    if (this.entered && this.local) this.updatePlaying(dt);
    else this.updateCinematic(time);
    this.audio.update(this.local?.speed ?? 0, this.local?.mode === 'driving', this.simulation, Math.abs(focus.x + 170));
    this.audio.updateSirens(this.activeInterior ? [] : this.traffic.policePositions(), focus, this.controls.cameraYaw);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCinematic(time: number) {
    const angle = this.graphicsSettings.reducedMotion ? 0.6 : time * 0.000025 + 0.6;
    this.camera.position.set(-80 + Math.sin(angle) * 90, 32 + Math.sin(angle * 0.7) * 6, 35 + Math.cos(angle) * 105);
    this.camera.lookAt(-35, 5, 20);
  }

  private updatePlaying(dt: number) {
    const local = this.local!;
    const input = conversationInput(this.conversationActive, this.controls.frame());
    local.update(dt, input, this.controls.cameraYaw, this.simulation.rainIntensity, this.activeInterior?.interior.collision ?? this.district.collision, this.actorCollisions);
    const interior = this.activeInterior;
    if (interior && local.position.z > interior.interior.origin.z + 6.2 && Math.abs(local.position.x - interior.interior.origin.x) < 1.2) this.exitProperty();
    this.updateCamera(dt);
    this.networkAccumulator += dt;
    this.hudAccumulator += dt;
    this.routeAccumulator += dt;

    if (this.networkAccumulator >= 0.1 && this.connected) {
      this.networkAccumulator = 0;
      const state = local.movementState(++this.sequence);
      this.realtime.sendState({
        position: state.position, heading: state.heading, speed: state.speed, mode: state.mode,
        ...(state.vehicleId ? { vehicleId: state.vehicleId } : {}),
        ...(state.lightsOn === undefined ? {} : { lightsOn: state.lightsOn }),
        ...(state.interiorPropertyId ? { interiorPropertyId: state.interiorPropertyId } : {}),
      });
    }
    if (this.routeAccumulator >= 0.8) { this.routeAccumulator = 0; this.updateRoute(); }
    if (this.hudAccumulator >= 0.1) { this.hudAccumulator = 0; this.updateHUD(); }
    this.updateInteractions();
  }

  private updateCamera(dt: number) {
    const local = this.local!;
    const position = local.position;
    if (local.mode === 'driving' && !this.controls.orbiting) {
      const difference = Math.atan2(Math.sin(local.heading - this.controls.cameraYaw), Math.cos(local.heading - this.controls.cameraYaw));
      this.controls.cameraYaw += difference * Math.min(1, dt * 1.5);
    }
    const heading = this.firstPerson ? local.heading : this.controls.cameraYaw;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    let desired: THREE.Vector3;
    let target: THREE.Vector3;
    if (this.firstPerson) {
      desired = position.clone().add(new THREE.Vector3(0, local.mode === 'driving' ? 1.48 : 1.72, 0)).add(forward.clone().multiplyScalar(0.15));
      target = desired.clone().add(forward.multiplyScalar(12)).add(new THREE.Vector3(0, -0.15, 0));
      this.camera.position.copy(desired);
    } else {
      const distance = this.activeInterior ? Math.min(3.8, this.controls.cameraDistance) : local.mode === 'driving' ? this.controls.cameraDistance + 2.5 : this.controls.cameraDistance;
      desired = position.clone().add(new THREE.Vector3(0, 2.2 + Math.sin(this.controls.cameraPitch) * distance, 0)).add(forward.clone().multiplyScalar(-Math.cos(this.controls.cameraPitch) * distance));
      target = position.clone().add(new THREE.Vector3(0, local.mode === 'driving' ? 1.05 : 1.3, 0)).add(forward.clone().multiplyScalar(1.2));
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 7));
    }
    this.camera.lookAt(target);
  }

  private destinationId() {
    if (this.trip) return this.trip.status === 'accepted' ? this.trip.pickupLocationId : this.trip.destinationLocationId;
    return this.waypointId;
  }

  private routeDestination(destinationId: string): Point2 {
    const step = citizenTaskRoutePoint(this.task, destinationId);
    if (!this.trip && step) return step;
    if (!this.trip && this.civicWaypoint?.locationId === destinationId) return this.civicWaypoint;
    return getLocation(destinationId);
  }

  private updateRoute() {
    if (this.activeInterior) {
      this.route = [];
      this.marker.visible = false;
      if (this.routeLine) this.routeLine.visible = false;
      return;
    }
    const destinationId = this.destinationId();
    if (!destinationId || !this.local) {
      this.route = [];
      this.marker.visible = false;
      if (this.routeLine) this.routeLine.visible = false;
      return;
    }
    const destination = this.routeDestination(destinationId);
    this.route = routeBetween({ x: this.local.position.x, z: this.local.position.z }, destination);
    const points = this.route.map((point) => new THREE.Vector3(point.x, 0.16, point.z));
    if (!this.routeLine) {
      this.routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#edbd4e', transparent: true, opacity: 0.82, depthTest: true }));
      this.routeLine.renderOrder = 4;
      this.scene.add(this.routeLine);
    }
    this.routeLine.geometry.dispose();
    this.routeLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.routeLine.visible = true;
    this.marker.visible = true;
    this.marker.position.set(destination.x, 0, destination.z);
  }

  private updateInteractions() {
    const local = this.local!;
    if (this.activeInterior) {
      this.callbacks.onPrompt(this.activeInterior.interior.nearExit(local.position) ? `Exit ${this.activeInterior.listing.name}` : null);
      if (this.currentTripAction) {
        this.currentTripAction = null;
        this.callbacks.onTripAction(null);
      }
      return;
    }
    if (this.playerHealth.condition === 'dead') {
      this.callbacks.onPrompt('Respawning at the taxi rank…');
      return;
    }
    if (local.mode === 'walking') {
      const taskInteraction = this.nearbyTaskInteraction();
      const taskStep = taskInteraction ? currentCitizenTaskStep(this.task) : null;
      const currentStep = currentCitizenTaskStep(this.task);
      const nearTask = currentStep && distance2D({ x: local.position.x, z: local.position.z }, currentStep) <= 14;
      const civicInteraction = this.nearbyCivicInteraction();
      const property = this.nearbyOwnedProperty();
      const listing = property ? PROPERTY_CATALOG.find((entry) => entry.id === property.listingId) : undefined;
      const distance = local.character.group.position.distanceTo(local.vehicle.group.position);
      this.callbacks.onPrompt(taskStep ? taskStep.label : civicInteraction ? civicInteraction.prompt : nearTask ? 'Walk to the glowing objective sign' : listing ? `Enter ${listing.name}` : distance < 4.2 ? `Enter ${local.vehicleData.model.name}` : null);
    } else this.callbacks.onPrompt(Math.abs(local.speed) < 1.8 ? 'Exit vehicle' : null);

    let action: 'pickup' | 'complete' | null = null;
    if (this.trip && local.mode === 'driving' && Math.abs(local.speed) <= 2.5) {
      const locationId = this.trip.status === 'accepted' ? this.trip.pickupLocationId : this.trip.status === 'active' ? this.trip.destinationLocationId : null;
      if (locationId && distance2D({ x: local.position.x, z: local.position.z }, getLocation(locationId)) <= 13) {
        action = this.trip.status === 'accepted' ? 'pickup' : 'complete';
      }
    }
    if (action !== this.currentTripAction) {
      this.currentTripAction = action;
      this.callbacks.onTripAction(action);
    }
  }

  private updateHUD() {
    const local = this.local!;
    const active = this.activeInterior;
    const network = local.movementState(this.sequence);
    const position = active ? { x: network.position[0], z: network.position[2] } : { x: local.position.x, z: local.position.z };
    const destinationId = active ? null : this.destinationId();
    const destination = destinationId ? getLocation(destinationId) : null;
    const nearby = WORLD_LOCATIONS.reduce((best, location) => distance2D(position, location) < distance2D(position, best) ? location : best, WORLD_LOCATIONS[0]!);
    const room = active?.interior.roomAt(local.position);
    this.callbacks.onHome(active && room ? {
      propertyId: active.property.id, name: active.listing.name, level: active.property.level,
      currentRoomId: room.id, lightsOn: active.interior.lightsOn,
      rooms: active.interior.rooms.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })),
    } : null);
    this.callbacks.onHUD({
      speedKmh: local.mode === 'driving' ? Math.abs(local.speed) * 3.6 : 0,
      fuelPercent: local.fuelPercent, conditionPercent: local.conditionPercent, mode: local.mode,
      position, heading: local.heading, simulation: this.simulation, onlineCount: this.remotes.count + (this.connected ? 1 : 0),
      areaName: active && room ? `${active.listing.name} · ${room.name}` : distance2D(position, nearby) < 45 ? nearby.name : 'Sinkor Coastal District',
      destinationName: destination?.name ?? null, destinationDistance: destination ? distance2D(position, this.routeDestination(destination.id)) : null,
      vehicleName: local.vehicleData.model.name,
      vehicleDistance: local.mode === 'walking' ? local.character.group.position.distanceTo(local.vehicle.group.position) : 0,
      lightsOn: local.lightsOn, health: this.playerHealth,
    });
    this.map.update({ player: position, heading: local.heading, route: active ? [] : this.route, waypointId: destinationId, remotes: this.remotes.positions() });
  }

  private resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
