import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterAppearance } from '../../shared/types';
import { loadCharacterTemplate, type CharacterModelKind } from '../assets/model-library';
import { makeNameSprite, makeNameTexture } from '../world/materials';
import type { HealthCondition } from '../../shared/health';
import { cloneMeshMaterials, disposeModelInstance, normalizeModel } from './model-utils';
import { ProceduralCharacter } from './procedural-character';
import { characterMotionForSpeed, type CharacterMotion } from './character-motion';

const SKIN_TINTS = ['#c9a18d', '#d8b39e', '#e6c3ae', '#f0d2bd', '#ba907c', '#ffdfca'];
const TOP_TINTS = ['#d5a637', '#39746b', '#b95c4b', '#e3ded0', '#41668a', '#724d78'];
const BOTTOM_TINTS = ['#273b44', '#554a3c', '#313b32', '#6b6257'];

export class CharacterEntity {
  readonly group = new THREE.Group();
  readonly nameSprite?: THREE.Sprite;
  private fallback?: ProceduralCharacter;
  private mixer?: THREE.AnimationMixer;
  private model?: THREE.Group;
  private readonly actions = new Map<CharacterMotion, THREE.AnimationAction>();
  private currentMotion: CharacterMotion = 'idle';
  private waveTime = 0;
  private waveArm?: THREE.Object3D;
  private waveForearm?: THREE.Object3D;
  private waveHand?: THREE.Object3D;
  private disposed = false;
  private condition: HealthCondition = 'healthy';
  private readonly modelKind: CharacterModelKind;

  constructor(readonly appearance: CharacterAppearance, private readonly name?: string, private readonly subtitle?: string) {
    this.fallback = new ProceduralCharacter(appearance);
    this.group.add(this.fallback.group);
    if (name) {
      this.nameSprite = makeNameSprite(name, '#f5f0e6', subtitle);
      this.nameSprite.position.y = 2.1;
      this.group.add(this.nameSprite);
    }
    this.modelKind = appearance.hair === 1 || appearance.hair === 3 ? 'female' : 'male';
    void loadCharacterTemplate(this.modelKind).then((template) => this.installModel(template)).catch((error: unknown) => {
      console.warn(`Using procedural ${this.modelKind} citizen fallback:`, error);
    });
  }

  private installModel(template: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    if (this.disposed || !this.fallback) return;
    const content = cloneSkeleton(template.scene) as THREE.Group;
    cloneMeshMaterials(content);
    const normalized = normalizeModel(content, { height: this.modelKind === 'female' ? 1.68 : 1.78 });
    const model = normalized.root;
    model.name = 'Realistic citizen';
    this.customizeMaterials(model, normalized.size.y);

    this.mixer = new THREE.AnimationMixer(model);
    for (const motion of ['idle', 'walk', 'sprint'] as const) {
      const clip = template.animations.find((candidate) => candidate.name.toLowerCase() === motion);
      if (clip) this.actions.set(motion, this.mixer.clipAction(clip));
    }
    if (this.actions.size !== 3) throw new Error('Citizen locomotion animation could not be initialized.');
    this.actions.get('idle')!.play();
    this.waveArm = model.getObjectByName('upperarm_r');
    this.waveForearm = model.getObjectByName('lowerarm_r');
    this.waveHand = model.getObjectByName('hand_r');

    this.group.remove(this.fallback.group);
    this.fallback.dispose();
    this.fallback = undefined;
    this.model = model;
    this.group.add(model);
    this.applyConditionPose();
  }

  private customizeMaterials(model: THREE.Group, height: number) {
    const skinTint = new THREE.Color(SKIN_TINTS[this.appearance.skin] ?? SKIN_TINTS[2]!);
    const topTint = new THREE.Color(TOP_TINTS[this.appearance.top] ?? TOP_TINTS[0]!).lerp(new THREE.Color('#ffffff'), 0.12);
    const bottomTint = new THREE.Color(BOTTOM_TINTS[this.appearance.bottom] ?? BOTTOM_TINTS[0]!).lerp(new THREE.Color('#ffffff'), 0.12);
    const headWrap = this.appearance.hair === 3;

    model.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.name === 'Skin') {
          material.color.copy(skinTint);
          material.roughness = 0.72;
          // A low textured fill retains facial detail in unlit streets; it is not a flat skin glow.
          material.emissive.copy(skinTint);
          material.emissiveMap = material.map;
          material.emissiveIntensity = material.map ? 0.48 : 0.075;
          material.needsUpdate = true;
        } else if (material.name === 'Top') {
          material.color.set('#ffffff');
          material.roughness = 0.82;
          material.emissive.set('#b8c7d4');
          material.emissiveMap = material.map;
          material.emissiveIntensity = material.map ? 0.07 : 0.018;
          this.colorOutfit(model, object, material, topTint, bottomTint, height * 0.52);
        } else if (material.name === 'Eyes') {
          material.color.set('#ffffff');
          material.roughness = 0.42;
          material.emissive.set('#d8e0e5');
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.2;
          material.needsUpdate = true;
        } else if (material.name === 'Brows') {
          material.color.set('#34271f');
          material.roughness = 0.9;
          material.emissive.set('#6a5040');
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.12;
          material.needsUpdate = true;
        } else if (material.name === 'Human.eyelashes01') {
          material.roughness = 0.9;
          material.emissive.set('#4a352b');
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.06;
          material.needsUpdate = true;
        } else if (material.name === 'Hair') {
          material.color.set('#211c19');
          material.roughness = 0.9;
          material.emissive.copy(material.color);
          material.emissiveIntensity = 0.035;
        } else if (material.name === 'Shoes') {
          material.color.set('#343735');
          material.roughness = 0.86;
          material.emissive.copy(material.color);
          material.emissiveIntensity = 0.018;
        }
      }
      if (materials.some((material) => material.name === 'Hair')) object.visible = !headWrap;
    });

    if (headWrap) {
      const geometry = new THREE.SphereGeometry(height * 0.068, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
      const wrap = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#a95039', emissive: '#a95039', emissiveIntensity: 0.035, roughness: 0.92 }));
      wrap.userData.taxiLibOwnsGeometry = true;
      wrap.position.set(0, height * 0.935, -height * 0.005);
      wrap.scale.set(0.9, 0.78, 1.02);
      wrap.castShadow = true;
      model.add(wrap);
      const head = model.getObjectByName('head');
      if (head) {
        model.updateMatrixWorld(true);
        head.attach(wrap);
      }
    }
  }

  private colorOutfit(model: THREE.Group, mesh: THREE.SkinnedMesh, material: THREE.MeshStandardMaterial, top: THREE.Color, bottom: THREE.Color, waist: number) {
    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;
    mesh.userData.taxiLibOwnsGeometry = true;
    const positions = geometry.getAttribute('position');
    const skinIndices = geometry.getAttribute('skinIndex');
    const skinWeights = geometry.getAttribute('skinWeight');
    const colors = new Float32Array(positions.count * 3);
    const vertex = new THREE.Vector3();
    model.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(mesh.matrixWorld);
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(toModel);
      let lowerBody = vertex.y < waist;
      if (skinIndices && skinWeights) {
        const weights = [skinWeights.getX(index), skinWeights.getY(index), skinWeights.getZ(index), skinWeights.getW(index)];
        const indices = [skinIndices.getX(index), skinIndices.getY(index), skinIndices.getZ(index), skinIndices.getW(index)];
        let dominant = 0;
        for (let slot = 1; slot < 4; slot += 1) if (weights[slot]! > weights[dominant]!) dominant = slot;
        const bone = mesh.skeleton.bones[Math.round(indices[dominant]!)]?.name ?? '';
        if (/thigh|calf|foot|ball/.test(bone)) lowerBody = true;
        else if (/spine|clavicle|arm|hand|neck|head/.test(bone)) lowerBody = false;
      }
      const color = lowerBody ? bottom : top;
      color.toArray(colors, index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
    material.needsUpdate = true;
  }

  private setMotion(motion: CharacterMotion) {
    if (motion === this.currentMotion) return;
    const next = this.actions.get(motion);
    const previous = this.actions.get(this.currentMotion);
    if (!next) return;
    next.reset().fadeIn(0.18).play();
    previous?.fadeOut(0.18);
    this.currentMotion = motion;
  }

  update(dt: number, speed: number) {
    if (this.condition !== 'healthy') {
      this.fallback?.update(dt, 0);
      if (this.mixer) { this.setMotion('idle'); this.mixer.update(dt); }
      return;
    }
    if (this.fallback) {
      this.fallback.update(dt, speed);
      this.waveTime = Math.max(0, this.waveTime - dt);
      return;
    }
    if (!this.mixer || !this.model) return;
    const motion = characterMotionForSpeed(speed);
    this.setMotion(motion);
    const action = this.actions.get(motion);
    if (action && motion !== 'idle') action.timeScale = THREE.MathUtils.clamp(Math.abs(speed) / (motion === 'sprint' ? 6 : 2.4), 0.65, 1.5);
    this.mixer.update(dt);
    if (this.waveTime > 0) {
      this.waveTime = Math.max(0, this.waveTime - dt);
      const elapsed = 2.2 - this.waveTime;
      const envelope = Math.min(1, elapsed * 5, this.waveTime * 3);
      if (this.waveArm) this.waveArm.rotation.z -= envelope * 1.05;
      if (this.waveForearm) this.waveForearm.rotation.z -= envelope * 0.38;
      if (this.waveHand) this.waveHand.rotation.y += Math.sin(elapsed * 13) * envelope * 0.55;
    }
  }

  setCondition(condition: HealthCondition) {
    if (this.condition === condition) return;
    this.condition = condition;
    this.waveTime = 0;
    this.applyConditionPose();
    if (this.nameSprite && this.name) {
      const subtitle = condition === 'injured' ? 'Injured · recovering' : condition === 'dead' ? 'Passed away' : this.subtitle;
      const color = condition === 'dead' ? '#ffb4a8' : condition === 'injured' ? '#ffe0a3' : '#f5f0e6';
      const previous = this.nameSprite.material.map;
      this.nameSprite.material.map = makeNameTexture(this.name, color, subtitle);
      this.nameSprite.material.needsUpdate = true;
      previous?.dispose();
    }
  }

  get healthCondition() { return this.condition; }

  updateNameplate(observerPosition: THREE.Vector3) {
    if (!this.nameSprite) return;
    const distance = this.group.position.distanceTo(observerPosition);
    const scale = THREE.MathUtils.clamp(distance / 9, 0.45, 1.35);
    this.nameSprite.scale.set(2.75 * scale, 0.69 * scale, 1);
  }

  private applyConditionPose() {
    const visual = this.fallback?.group ?? this.model;
    if (visual) {
      visual.rotation.z = this.condition === 'dead' ? -Math.PI / 2 : this.condition === 'injured' ? -1.15 : 0;
      visual.position.y = this.condition === 'healthy' ? 0 : 0.22;
    }
    if (this.nameSprite) this.nameSprite.position.y = this.condition === 'healthy' ? 2.1 : 0.85;
  }

  wave() {
    if (this.condition !== 'healthy') return;
    this.waveTime = 2.2;
    this.fallback?.wave();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.fallback?.dispose();
    if (this.model) disposeModelInstance(this.model);
    if (this.nameSprite) {
      this.nameSprite.material.map?.dispose();
      this.nameSprite.material.dispose();
    }
  }
}
