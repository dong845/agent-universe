// A robot's click target hits only while the robot is shown (D25 review: three's raycaster ignores
// `visible`, so a robot that had left could still be clicked at its last spot).
import * as THREE from "three";

export function visibleRaycast(owner: () => THREE.Object3D | null, mesh: THREE.Mesh) {
  return (rc: THREE.Raycaster, hits: THREE.Intersection[]) => {
    if (!owner()?.visible) return;
    THREE.Mesh.prototype.raycast.call(mesh, rc, hits);
  };
}
