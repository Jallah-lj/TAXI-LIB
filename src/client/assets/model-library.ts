import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type CharacterModelKind = 'male' | 'female';
export type VehicleModelKind = 'sedan' | 'hatchback' | 'minibus' | 'modern-sedan' | 'modern-suv';

export interface CharacterTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const characterCache = new Map<CharacterModelKind, Promise<CharacterTemplate>>();
const vehicleCache = new Map<VehicleModelKind, Promise<THREE.Group>>();

function cached<T>(cache: Map<T, Promise<THREE.Group>>, key: T, url: string) {
  let promise = cache.get(key);
  if (!promise) {
    promise = loader.loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
    cache.set(key, promise);
  }
  return promise;
}

export function loadVehicleTemplate(kind: VehicleModelKind) {
  return cached(vehicleCache, kind, `/assets/vehicles/${kind}.glb`);
}

export function loadCharacterTemplate(kind: CharacterModelKind): Promise<CharacterTemplate> {
  let promise = characterCache.get(kind);
  if (!promise) {
    promise = loader.loadAsync(`/assets/characters/citizen-${kind}.glb`).then((gltf) => {
      const required = ['idle', 'walk', 'sprint'];
      const clips = new Map(gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]));
      if (required.some((name) => !clips.has(name))) throw new Error(`${kind} citizen is missing locomotion clips.`);
      gltf.scene.updateMatrixWorld(true);
      return { scene: gltf.scene, animations: gltf.animations };
    });
    characterCache.set(kind, promise);
  }
  return promise;
}
