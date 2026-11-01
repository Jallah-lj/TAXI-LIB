import * as THREE from 'three';
import type { VehiclePaintFinish } from '../../shared/catalog';

const FINISH_STYLE: Record<VehiclePaintFinish, { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number }> = {
  gloss: { roughness: 0.24, metalness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 },
  metallic: { roughness: 0.3, metalness: 0.74, clearcoat: 0.68, clearcoatRoughness: 0.18 },
  matte: { roughness: 0.72, metalness: 0.06, clearcoat: 0, clearcoatRoughness: 0.7 },
};

/** Applies only visual paint properties. Handling statistics are deliberately untouched. */
export function applyVehicleAppearance(root: THREE.Object3D, color: string, finish: VehiclePaintFinish) {
  const style = FINISH_STYLE[finish];
  const secondaryColor = new THREE.Color(color).multiplyScalar(0.55);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const role = material.name.toLowerCase();
      if (role !== 'paint' && role !== 'paintsecondary') continue;
      material.color.copy(role === 'paint' ? new THREE.Color(color) : secondaryColor);
      material.roughness = Math.min(0.9, style.roughness + (role === 'paintsecondary' ? 0.1 : 0));
      material.metalness = style.metalness;
      if (material.map) {
        // The bundled paint maps are uniform source tints; removing them makes
        // the authoritative palette color deterministic across every model.
        material.map = null;
        material.needsUpdate = true;
      }
      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.clearcoat = style.clearcoat;
        material.clearcoatRoughness = style.clearcoatRoughness;
      }
    }
  });
}
