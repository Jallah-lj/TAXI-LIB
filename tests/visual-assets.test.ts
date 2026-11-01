import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { characterMotionForSpeed } from '../src/client/entities/character-motion';
import { rigVehicleWheels } from '../src/client/entities/vehicle-wheels';
import { VehicleHeadlights } from '../src/client/entities/vehicle-lights';

const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, 'public/assets');
const manifest = JSON.parse(readFileSync(resolve(assetRoot, 'asset-manifest.json'), 'utf8')) as {
  license: string;
  outputs: Record<string, { bytes: number; sha256: string }>;
};

function readGlb(relative: string) {
  const bytes = readFileSync(resolve(assetRoot, relative));
  expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  return { bytes, document };
}

describe('bundled visual assets', () => {
  it('matches the reviewed local byte counts and SHA-256 manifest', () => {
    expect(manifest.license).toBe('CC0-1.0');
    expect(Object.keys(manifest.outputs)).toHaveLength(5);
    for (const [relative, expected] of Object.entries(manifest.outputs)) {
      const bytes = readFileSync(resolve(assetRoot, relative));
      expect(bytes.length, relative).toBe(expected.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), relative).toBe(expected.sha256);
    }
  });

  it.each(['characters/citizen-male.glb', 'characters/citizen-female.glb'])('%s is clothed, rigged, textured and animated', (relative) => {
    const { document } = readGlb(relative);
    const materialNames = new Set(document.materials.map((material: { name?: string }) => material.name));
    for (const required of ['Skin', 'Top', 'Hair', 'Shoes']) expect(materialNames.has(required)).toBe(true);
    expect(document.skins[0].joints).toHaveLength(53);
    const clips = new Set(document.animations.map((animation: { name: string }) => animation.name));
    for (const required of ['idle', 'walk', 'sprint']) expect(clips.has(required)).toBe(true);
    const skin = document.materials.find((material: { name: string }) => material.name === 'Skin');
    const texture = document.textures[skin.pbrMetallicRoughness.baseColorTexture.index];
    const source = texture.source ?? texture.extensions.EXT_texture_webp.source;
    expect(document.images[source].name).toContain('darkskinned');
    expect(document.images[source].bufferView).toBeTypeOf('number');
    expect(document.buffers.every((buffer: { uri?: string }) => buffer.uri === undefined)).toBe(true);
  });

  it.each(['vehicles/sedan.glb', 'vehicles/hatchback.glb', 'vehicles/minibus.glb'])('%s retains paint and four separate wheels', (relative) => {
    const { document } = readGlb(relative);
    expect(document.materials.some((material: { name?: string }) => material.name === 'Paint')).toBe(true);
    const wheels = document.nodes.filter((node: { name?: string }) => /^wheel_(?:LF|LB|RF|RB)$/i.test(node.name ?? ''));
    expect(wheels).toHaveLength(4);
    expect(document.meshes.length).toBeGreaterThan(10);
    expect(document.buffers.every((buffer: { uri?: string }) => buffer.uri === undefined)).toBe(true);
  });
});

describe('citizen locomotion selection', () => {
  it('uses idle, walk and sprint at the existing gameplay speeds', () => {
    expect(characterMotionForSpeed(0)).toBe('idle');
    expect(characterMotionForSpeed(-0.1)).toBe('idle');
    expect(characterMotionForSpeed(3.6)).toBe('walk');
    expect(characterMotionForSpeed(6.4)).toBe('sprint');
  });
});

describe('vehicle wheel rig', () => {
  it('preserves wheel placement and identifies two front wheels by model forward Z', () => {
    const model = new THREE.Group();
    const before = new Map<string, THREE.Vector3>();
    for (const [name, x, z] of [['wheel_LF', -0.8, 1.3], ['wheel_RF', 0.8, 1.3], ['wheel_LB', -0.8, -1.3], ['wheel_RB', 0.8, -1.3]] as const) {
      const wheel = new THREE.Group();
      wheel.name = name;
      wheel.position.set(x, 0.35, z);
      wheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.7), new THREE.MeshBasicMaterial()));
      model.add(wheel);
      before.set(name, wheel.position.clone());
    }
    const rig = rigVehicleWheels(model);
    model.updateMatrixWorld(true);
    expect(rig.wheels).toHaveLength(4);
    expect(rig.frontWheelPivots).toHaveLength(2);
    expect(rig.radius).toBeCloseTo(0.35);
    for (const wheel of rig.wheels) {
      const world = wheel.getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(before.get(wheel.name)!.x);
      expect(world.y).toBeCloseTo(0.35);
      expect(world.z).toBeCloseTo(before.get(wheel.name)!.z);
    }
    expect(rig.frontWheelPivots.every((pivot) => pivot.position.z > 0)).toBe(true);
  });
});

describe('vehicle headlights', () => {
  it('controls two real forward spotlights and emissive headlamp materials', () => {
    const rig = new VehicleHeadlights();
    rig.configure(new THREE.Vector3(2.05, 1.45, 4.55));
    const model = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ name: 'HeadlightGlass' });
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    rig.collectMaterials(model);

    const lights = rig.group.children.filter((child): child is THREE.SpotLight => child instanceof THREE.SpotLight);
    expect(lights).toHaveLength(2);
    expect(rig.enabled).toBe(false);
    expect(rig.group.visible).toBe(false);
    expect(lights.every((light) => !light.visible && light.target.position.z > light.position.z)).toBe(true);
    expect(material.emissiveIntensity).toBeCloseTo(0.28);

    rig.set(true);
    expect(rig.enabled).toBe(true);
    expect(rig.group.visible).toBe(true);
    expect(lights.every((light) => light.visible && light.intensity > 0 && light.distance === 46)).toBe(true);
    expect(material.emissiveIntensity).toBeCloseTo(3.2);

    rig.set(false);
    expect(lights.every((light) => !light.visible)).toBe(true);
    rig.dispose();
    expect(rig.group.children).toHaveLength(0);
  });
});
