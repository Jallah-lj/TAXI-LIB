import * as THREE from 'three';

export interface NormalizedModel {
  root: THREE.Group;
  size: THREE.Vector3;
}

/** Uniformly scales an asset to meters, centers it, and puts its soles/wheels at y=0. */
export function normalizeModel(content: THREE.Object3D, target: { height?: number; length?: number }): NormalizedModel {
  content.updateMatrixWorld(true);
  const initial = new THREE.Box3().setFromObject(content);
  if (initial.isEmpty()) throw new Error('Cannot normalize an empty model.');
  const initialSize = initial.getSize(new THREE.Vector3());
  const scale = target.height !== undefined ? target.height / initialSize.y : target.length !== undefined ? target.length / initialSize.z : 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Model has invalid dimensions.');
  content.scale.multiplyScalar(scale);
  content.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(content);
  const center = scaled.getCenter(new THREE.Vector3());
  content.position.x -= center.x;
  content.position.y -= scaled.min.y;
  content.position.z -= center.z;

  const root = new THREE.Group();
  root.add(content);
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { root, size };
}

export function cloneMeshMaterials(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });
}

/** Disposes per-entity resources without disposing cached geometry or textures. */
export function disposeModelInstance(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const ownedGeometry = new Set<THREE.BufferGeometry>();
  const ownedTextures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.taxiLibOwnsGeometry === true) ownedGeometry.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach((material) => {
      materials.add(material);
      if (material.userData.taxiLibOwnsTexture === true && material instanceof THREE.MeshStandardMaterial) {
        if (material.map) ownedTextures.add(material.map);
      }
      if (material.userData.taxiLibOwnsTexture === true && material instanceof THREE.MeshBasicMaterial) {
        if (material.map) ownedTextures.add(material.map);
      }
    });
  });
  ownedGeometry.forEach((geometry) => geometry.dispose());
  ownedTextures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}
