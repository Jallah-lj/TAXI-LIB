import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { VehicleEntity } from '../entities/vehicle';
import type { VehicleCatalogEntry, VehiclePaintFinish } from '../../shared/catalog';
import {
  exposureForBrightness, getRenderPixelRatio, QUALITY_PROFILES, type GraphicsSettings,
} from '../settings';

export type ShowroomView = 'front' | 'side' | 'rear';
export type ShowroomSceneStatus = 'loading' | 'ready';

interface CameraTransition {
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
}

/** A single-vehicle studio. No fleet models are created for inventory cards. */
export class ShowroomScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private readonly reflector: Reflector;
  private keyLight?: THREE.SpotLight;
  private readonly studioGeometries = new Set<THREE.BufferGeometry>();
  private readonly studioMaterials = new Set<THREE.Material>();
  private vehicle?: VehicleEntity;
  private generation = 0;
  private frameId = 0;
  private lastTime = performance.now();
  private transition?: CameraTransition;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onStatus: (status: ShowroomSceneStatus) => void,
    private graphicsSettings: GraphicsSettings,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(getRenderPixelRatio(this.graphicsSettings, window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = exposureForBrightness(1.08, this.graphicsSettings.brightness);
    this.renderer.shadowMap.enabled = this.graphicsSettings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#080d11');
    this.scene.fog = new THREE.Fog('#080d11', 15, 34);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.72;
    room.dispose();
    pmrem.dispose();

    this.camera.position.set(6.1, 2.75, 7.25);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.88, 0);
    this.controls.enableDamping = !this.graphicsSettings.reducedMotion;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.1;
    this.controls.maxDistance = 14;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.72;
    this.controls.addEventListener('start', () => { this.transition = undefined; });
    this.controls.update();

    this.buildLighting();
    this.buildArchitecture();
    const reflectionSize = QUALITY_PROFILES[this.graphicsSettings.quality].reflectionSize;
    this.reflector = new Reflector(new THREE.CircleGeometry(3.08, 72), {
      clipBias: 0.003,
      textureWidth: reflectionSize,
      textureHeight: reflectionSize,
      color: 0x56616a,
      multisample: 0,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = 0.112;
    this.scene.add(this.reflector);

    const glaze = this.studioMesh(
      new THREE.CircleGeometry(3.075, 72),
      new THREE.MeshPhysicalMaterial({ color: '#151d22', roughness: 0.34, metalness: 0.28, transparent: true, opacity: 0.36, depthWrite: false }),
    );
    glaze.rotation.x = -Math.PI / 2;
    glaze.position.y = 0.118;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frameId = requestAnimationFrame((time) => this.update(time));
  }

  private studioMesh<T extends THREE.BufferGeometry, M extends THREE.Material>(geometry: T, material: M) {
    this.studioGeometries.add(geometry);
    this.studioMaterials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    return mesh;
  }

  private buildLighting() {
    const hemisphere = new THREE.HemisphereLight('#c8deed', '#12100e', 1.25);
    this.scene.add(hemisphere);
    const key = new THREE.SpotLight('#fff1d8', 150, 24, Math.PI / 5.5, 0.48, 1.4);
    this.keyLight = key;
    key.position.set(3.8, 6.8, 4.4);
    key.target.position.set(0, 0.5, 0);
    key.castShadow = this.graphicsSettings.shadows;
    const shadowSize = QUALITY_PROFILES[this.graphicsSettings.quality].showroomShadowMapSize;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.00035;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 18;
    const fill = new THREE.SpotLight('#9fc8e5', 92, 22, Math.PI / 4.5, 0.65, 1.5);
    fill.position.set(-5, 4.2, 1.5);
    fill.target.position.set(0, 0.8, 0);
    const rim = new THREE.SpotLight('#d8e8ff', 120, 22, Math.PI / 5, 0.55, 1.5);
    rim.position.set(1.5, 4.8, -5.5);
    rim.target.position.set(0, 0.9, 0);
    this.scene.add(key, key.target, fill, fill.target, rim, rim.target);
  }

  private buildArchitecture() {
    const floor = this.studioMesh(
      new THREE.CircleGeometry(18, 96),
      new THREE.MeshStandardMaterial({ color: '#0c1216', roughness: 0.58, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.035;
    floor.receiveShadow = true;

    const platform = this.studioMesh(
      new THREE.CylinderGeometry(3.2, 3.28, 0.15, 96),
      new THREE.MeshPhysicalMaterial({ color: '#151b1f', roughness: 0.3, metalness: 0.5, clearcoat: 0.4 }),
    );
    platform.position.y = 0.035;
    platform.receiveShadow = true;

    const trim = this.studioMesh(
      new THREE.TorusGeometry(3.15, 0.018, 8, 96),
      new THREE.MeshStandardMaterial({ color: '#d5b878', emissive: '#b78b42', emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.7 }),
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.12;

    for (const radius of [5.8, 9.5]) {
      const line = this.studioMesh(
        new THREE.RingGeometry(radius, radius + 0.018, 96),
        new THREE.MeshBasicMaterial({ color: '#283138', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      line.rotation.x = -Math.PI / 2;
      line.position.y = -0.025;
    }

    for (const x of [-3.4, 0, 3.4]) {
      const fixture = this.studioMesh(
        new THREE.BoxGeometry(1.65, 0.035, 0.12),
        new THREE.MeshBasicMaterial({ color: '#e6dbbd' }),
      );
      fixture.position.set(x, 5.4, -1.4);
      fixture.rotation.x = 0.15;
    }
  }

  async setVehicle(listing: VehicleCatalogEntry, color: string, finish: VehiclePaintFinish) {
    const generation = ++this.generation;
    this.onStatus('loading');
    this.removeVehicle();
    const vehicle = new VehicleEntity(color, listing.taxi, undefined, listing.visual === 'minibus', listing.visual, 'LR • SHOWROOM', finish);
    this.vehicle = vehicle;
    vehicle.group.position.y = 0.13;
    vehicle.group.scale.setScalar(0.965);
    this.scene.add(vehicle.group);
    await vehicle.ready;
    if (this.disposed || generation !== this.generation || this.vehicle !== vehicle) return;
    this.onStatus('ready');
    this.setView('front');
  }

  setAppearance(color: string, finish: VehiclePaintFinish) {
    this.vehicle?.setAppearance(color, finish);
  }

  setLights(on: boolean) {
    this.vehicle?.setLights(on);
  }

  setGraphicsSettings(settings: GraphicsSettings) {
    this.graphicsSettings = { ...settings };
    const profile = QUALITY_PROFILES[settings.quality];
    this.renderer.setPixelRatio(getRenderPixelRatio(settings, window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMappingExposure = exposureForBrightness(1.08, settings.brightness);
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.controls.enableDamping = !settings.reducedMotion;
    if (settings.reducedMotion) this.transition = undefined;
    if (this.keyLight) {
      this.keyLight.castShadow = settings.shadows;
      if (this.keyLight.shadow.mapSize.x !== profile.showroomShadowMapSize) {
        this.keyLight.shadow.mapSize.set(profile.showroomShadowMapSize, profile.showroomShadowMapSize);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
      }
    }
    const reflectionTarget = this.reflector.getRenderTarget();
    if (reflectionTarget.width !== profile.reflectionSize) reflectionTarget.setSize(profile.reflectionSize, profile.reflectionSize);
    this.resize();
  }

  setView(view: ShowroomView) {
    const positions: Record<ShowroomView, [number, number, number]> = {
      front: [6.1, 2.75, 7.25],
      side: [8.4, 2.1, 0.15],
      rear: [-5.6, 2.65, -7.0],
    };
    const destination = new THREE.Vector3(...positions[view]);
    // Tall, narrow stages have a smaller horizontal field of view. Back off
    // just enough to keep both bumpers visible, especially in profile view.
    const framingFactor = Math.max(1, 0.95 / Math.max(0.55, this.camera.aspect));
    destination.x *= framingFactor;
    destination.z *= framingFactor;
    if (this.graphicsSettings.reducedMotion) {
      this.transition = undefined;
      this.camera.position.copy(destination);
      this.controls.update();
      return;
    }
    this.transition = {
      from: this.camera.position.clone(),
      to: destination,
      startedAt: performance.now(),
    };
  }

  private removeVehicle() {
    if (!this.vehicle) return;
    this.scene.remove(this.vehicle.group);
    this.vehicle.dispose();
    this.vehicle = undefined;
  }

  private resize() {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private update(time: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;
    if (this.transition) {
      const progress = Math.min(1, (time - this.transition.startedAt) / 720);
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(this.transition.from, this.transition.to, eased);
      if (progress >= 1) this.transition = undefined;
    }
    if (this.vehicle) {
      const scale = this.graphicsSettings.reducedMotion ? 1 : THREE.MathUtils.damp(this.vehicle.group.scale.x, 1, 7, dt);
      this.vehicle.group.scale.setScalar(scale);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame((next) => this.update(next));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.removeVehicle();
    this.reflector.geometry.dispose();
    this.reflector.dispose();
    this.studioGeometries.forEach((geometry) => geometry.dispose());
    this.studioMaterials.forEach((material) => material.dispose());
    this.environmentTarget.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.dispose();
  }
}
