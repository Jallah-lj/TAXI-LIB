import * as THREE from 'three';
import type { CharacterAppearance } from '../../shared/types';
import { makeNameSprite } from '../world/materials';

const SKINS = ['#5b3427', '#704431', '#81523b', '#936249', '#4b2b22', '#a87555'];
const TOPS = ['#d5a637', '#39746b', '#b95c4b', '#e3ded0', '#41668a', '#724d78'];
const BOTTOMS = ['#273b44', '#554a3c', '#313b32', '#6b6257'];

export class ProceduralCharacter {
  readonly group = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private walkPhase = 0;
  private waveTime = 0;
  readonly nameSprite?: THREE.Sprite;

  constructor(readonly appearance: CharacterAppearance, name?: string) {
    const skin = new THREE.MeshStandardMaterial({ color: SKINS[appearance.skin] ?? SKINS[2], emissive: SKINS[appearance.skin] ?? SKINS[2], emissiveIntensity: 0.07, roughness: 0.88 });
    const top = new THREE.MeshStandardMaterial({ color: TOPS[appearance.top] ?? TOPS[0], emissive: TOPS[appearance.top] ?? TOPS[0], emissiveIntensity: 0.04, roughness: 0.82 });
    const bottom = new THREE.MeshStandardMaterial({ color: BOTTOMS[appearance.bottom] ?? BOTTOMS[0], emissive: BOTTOMS[appearance.bottom] ?? BOTTOMS[0], emissiveIntensity: 0.028, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#242726', emissive: '#242726', emissiveIntensity: 0.018, roughness: 0.95 });
    const hair = new THREE.MeshStandardMaterial({ color: '#211c19', emissive: '#211c19', emissiveIntensity: 0.025, roughness: 1 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.46, 4, 8), top);
    torso.position.y = 1.18;
    torso.scale.set(1.05, 1, 0.72);
    this.group.add(torso);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 8), skin);
    neck.position.y = 1.61;
    this.group.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 10), skin);
    head.position.y = 1.83;
    head.scale.set(0.9, 1.08, 0.95);
    this.group.add(head);

    if (appearance.hair === 0 || appearance.hair === 2) {
      const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
      hairMesh.position.y = appearance.hair === 2 ? 1.91 : 1.87;
      hairMesh.scale.set(0.94, appearance.hair === 2 ? 1.3 : 0.75, 0.98);
      this.group.add(hairMesh);
    } else if (appearance.hair === 1) {
      for (let index = 0; index < 8; index += 1) {
        const braid = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.22, 3, 5), hair);
        const angle = index / 8 * Math.PI * 2;
        braid.position.set(Math.sin(angle) * 0.16, 1.84, Math.cos(angle) * 0.16);
        braid.rotation.z = Math.sin(angle) * 0.25;
        this.group.add(braid);
      }
    } else {
      const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: '#b55f45' }));
      wrap.position.y = 1.9;
      this.group.add(wrap);
    }

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#171918' });
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 5, 4), eyeMaterial);
      eye.position.set(x, 1.86, 0.19);
      this.group.add(eye);
    }

    const buildArm = (arm: THREE.Group, x: number) => {
      arm.position.set(x, 1.43, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.18, 3, 6), top);
      sleeve.position.y = -0.14;
      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 3, 6), skin);
      forearm.position.y = -0.43;
      arm.add(sleeve, forearm);
      this.group.add(arm);
    };
    buildArm(this.leftArm, -0.32);
    buildArm(this.rightArm, 0.32);

    const buildLeg = (leg: THREE.Group, x: number) => {
      leg.position.set(x, 0.92, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.52, 3, 6), bottom);
      limb.position.y = -0.35;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.31), shoe);
      foot.position.set(0, -0.72, 0.07);
      leg.add(limb, foot);
      this.group.add(leg);
    };
    buildLeg(this.leftLeg, -0.13);
    buildLeg(this.rightLeg, 0.13);

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    if (name) {
      this.nameSprite = makeNameSprite(name);
      this.nameSprite.position.y = 2.35;
      this.group.add(this.nameSprite);
    }
  }

  update(dt: number, speed: number) {
    const movement = Math.min(1, Math.abs(speed) / 3);
    this.walkPhase += dt * (4 + Math.abs(speed) * 1.3);
    const swing = Math.sin(this.walkPhase) * 0.65 * movement;
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;
    if (this.waveTime > 0) {
      this.waveTime -= dt;
      this.rightArm.rotation.z = -2.5;
      this.rightArm.rotation.x = Math.sin(this.waveTime * 12) * 0.45;
    } else this.rightArm.rotation.z = 0;
  }

  wave() { this.waveTime = 2.2; }

  dispose() {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
