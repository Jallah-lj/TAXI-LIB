import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SimulationState } from '../../shared/simulation';
import { getDistrictLighting } from '../../shared/lighting';

const DAY_FOG = new THREE.Color('#b5c9bd');
const NIGHT_FOG = new THREE.Color('#1a303c');
const RAIN_FOG = new THREE.Color('#82918a');
const DAY_BACKGROUND = new THREE.Color('#9ab9b5');
const NIGHT_BACKGROUND = new THREE.Color('#0b1c2c');
const DAY_HEMISPHERE = new THREE.Color('#b8d8dc');
const NIGHT_HEMISPHERE = new THREE.Color('#89a8c2');
const DAY_GROUND = new THREE.Color('#526044');
const NIGHT_GROUND = new THREE.Color('#263c3a');
const MOON_OFFSET = new THREE.Vector3(-310, 390, -520);
const MOON_LIGHT_OFFSET = new THREE.Vector3(-90, 125, -70);

export class WeatherSystem {
  readonly sun = new THREE.DirectionalLight('#ffe4b0', 3.2);
  readonly hemisphere = new THREE.HemisphereLight('#b8d8dc', '#526044', 1.5);
  readonly moonLight = new THREE.DirectionalLight('#aacbea', 0);
  private readonly characterFill = new THREE.DirectionalLight('#d5e0ea', 0);
  exposure = 1.05;
  private readonly sky = new Sky();
  private readonly rain: THREE.Points;
  private readonly rainPositions: Float32Array;
  private readonly stars: THREE.Points;
  private readonly moonDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private interior = false;
  private activeRainCount = 1700;

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    this.sky.scale.setScalar(5000);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity!.value = 7;
    uniforms.rayleigh!.value = 1.7;
    uniforms.mieCoefficient!.value = 0.006;
    uniforms.mieDirectionalG!.value = 0.82;
    scene.add(this.sky);
    scene.fog = new THREE.FogExp2('#b5c9bd', 0.00145);
    scene.background = new THREE.Color('#9ab9b5');
    this.sun.position.set(-80, 140, 65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -115; this.sun.shadow.camera.right = 115;
    this.sun.shadow.camera.top = 115; this.sun.shadow.camera.bottom = -115;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 360;
    this.sun.shadow.bias = -0.00025;
    this.moonLight.castShadow = false;
    // Camera-side fill prevents backlit faces becoming silhouettes; no additional shadow pass is needed.
    this.characterFill.castShadow = false;
    scene.add(this.sun, this.hemisphere, this.moonLight, this.moonLight.target, this.characterFill, this.characterFill.target);

    const count = 1700;
    this.rainPositions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) this.resetDrop(index, true);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#c4d7d5', size: 0.075, transparent: true, opacity: 0.62, depthWrite: false }));
    this.rain.visible = false;
    scene.add(this.rain);

    const starPositions = new Float32Array(450 * 3);
    for (let index = 0; index < 450; index += 1) {
      const angle = index * 2.39996;
      const radius = 600 + (index % 7) * 80;
      starPositions[index * 3] = Math.sin(angle) * radius;
      starPositions[index * 3 + 1] = 180 + (index % 13) * 35;
      starPositions[index * 3 + 2] = Math.cos(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: '#e8e5d5', size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    scene.add(this.stars);

    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(17, 40), new THREE.MeshBasicMaterial({
      color: '#dce9ef', transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    this.moonDisc.visible = false;
    scene.add(this.moonDisc);
  }

  private resetDrop(index: number, initial = false) {
    this.rainPositions[index * 3] = (Math.random() - 0.5) * 80;
    this.rainPositions[index * 3 + 1] = initial ? Math.random() * 38 : 30 + Math.random() * 8;
    this.rainPositions[index * 3 + 2] = (Math.random() - 0.5) * 80;
  }

  setInterior(interior: boolean) { this.interior = interior; }

  setRainFraction(fraction: number) {
    const total = this.rainPositions.length / 3;
    this.activeRainCount = Math.round(total * Math.max(0, Math.min(1, fraction)));
    this.rain.geometry.setDrawRange(0, this.activeRainCount);
  }

  update(dt: number, simulation: SimulationState, focus: THREE.Vector3) {
    if (this.interior) {
      this.exposure = 0.98;
      this.sky.visible = false;
      this.rain.visible = false;
      this.stars.visible = false;
      this.moonDisc.visible = false;
      this.sun.intensity = 0.12;
      this.moonLight.intensity = 0;
      this.characterFill.intensity = 0;
      this.hemisphere.intensity = 0.48;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set('#202624');
        this.scene.fog.density = 0.002;
      }
      if (this.scene.background instanceof THREE.Color) this.scene.background.set('#202624');
      return;
    }

    const profile = getDistrictLighting(simulation);
    this.exposure = profile.exposure;
    const hour = simulation.timeOfDaySeconds / 3600;
    const sunAngle = (hour - 6) / 12 * Math.PI;
    const elevation = Math.sin(sunAngle) * 62;
    const sunPosition = new THREE.Vector3(Math.cos(sunAngle) * 180, Math.sin(sunAngle) * 180, 75);
    this.sky.visible = elevation > -9;
    this.sky.material.uniforms.sunPosition!.value.copy(sunPosition);
    this.sun.position.copy(focus).add(sunPosition.clone().normalize().multiplyScalar(150));
    this.sun.target.position.copy(focus);
    if (!this.sun.target.parent) this.scene.add(this.sun.target);
    this.sun.intensity = profile.sunIntensity;
    this.sun.color.set((hour > 16.5 && hour < 19) || (hour > 5 && hour < 7.5) ? '#ffc078' : '#ffe5ba');
    this.moonLight.position.copy(focus).add(MOON_LIGHT_OFFSET);
    this.moonLight.target.position.copy(focus);
    this.moonLight.intensity = profile.moonIntensity;
    this.characterFill.position.copy(this.camera.position);
    this.characterFill.target.position.set(focus.x, focus.y + 1.05, focus.z);
    this.characterFill.intensity = profile.nightFactor * Math.max(0.42, 0.55 - simulation.rainIntensity * 0.1);
    this.hemisphere.intensity = profile.hemisphereIntensity;
    this.hemisphere.color.copy(NIGHT_HEMISPHERE).lerp(DAY_HEMISPHERE, profile.daylight);
    this.hemisphere.groundColor.copy(NIGHT_GROUND).lerp(DAY_GROUND, profile.daylight);

    const starMaterial = this.stars.material as THREE.PointsMaterial;
    starMaterial.opacity = profile.starOpacity;
    this.stars.visible = profile.starOpacity > 0.025;
    this.stars.position.set(focus.x, 0, focus.z);
    this.moonDisc.visible = profile.moonOpacity > 0.025 && elevation < 8;
    this.moonDisc.material.opacity = profile.moonOpacity;
    this.moonDisc.position.copy(focus).add(MOON_OFFSET);
    this.moonDisc.lookAt(this.camera.position);

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, profile.daylight).lerp(RAIN_FOG, simulation.rainIntensity * 0.65);
      this.scene.fog.density = profile.fogDensity;
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(NIGHT_BACKGROUND).lerp(DAY_BACKGROUND, profile.daylight).lerp(RAIN_FOG, simulation.rainIntensity * 0.35);
    }

    this.rain.visible = simulation.rainIntensity > 0.03;
    if (this.rain.visible) {
      this.rain.position.set(focus.x, 0, focus.z);
      (this.rain.material as THREE.PointsMaterial).opacity = 0.25 + simulation.rainIntensity * 0.5;
      for (let index = 0; index < this.activeRainCount; index += 1) {
        this.rainPositions[index * 3 + 1]! -= dt * (23 + simulation.rainIntensity * 24);
        this.rainPositions[index * 3]! -= dt * 2.8;
        if (this.rainPositions[index * 3 + 1]! < 0) this.resetDrop(index);
      }
      this.rain.geometry.attributes.position!.needsUpdate = true;
    }
  }
}
