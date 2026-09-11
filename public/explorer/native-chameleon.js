import * as THREE from './vendor/three.module.min.js';

// The paper's Chameleon builds rings/toes, snaps the nearest coarse vertex,
// then applies Blender subdivision. Replaying that small original generator
// avoids interpolating across discrete changes in the vertex chosen by snap.
// Subdivision weights and snap choices are captured from the native program.
export function createChameleonLimb(descriptor, readField) {
  const weights = readField(descriptor.weights);
  const indices = readField(descriptor.snap_indices);
  const rows = [];
  for (let row = 0; row < descriptor.vertex_count; row += 1) {
    const entries = [];
    for (let col = 0; col < descriptor.coarse_count; col += 1) {
      const weight = weights[row * descriptor.coarse_count + col];
      if (weight) entries.push([col * 3, weight]);
    }
    rows.push(entries);
  }
  const up = new THREE.Vector3(0, 0, 1);
  const sign = descriptor.side === 'left' ? -1 : 1;
  const output = new Float32Array(descriptor.vertex_count * 3);
  const coarse = new Float64Array(descriptor.coarse_count * 3);
  return (torsoScale, limbScale) => {
    const drop = 0.81 * torsoScale;
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(sign * 0.45, descriptor.is_hind ? 0.1 : -0.1, -drop * 0.25),
      new THREE.Vector3(sign * 0.6, descriptor.is_hind ? 0.05 : -0.05, -drop * 0.65),
      new THREE.Vector3(sign * 0.5, 0, -drop),
    ];
    const radii = [0.38, 0.32, 0.28, 0.22];
    let cursor = 0;
    const push = (point) => { coarse[cursor++] = point.x; coarse[cursor++] = point.y; coarse[cursor++] = point.z; };
    for (let i = 0; i < points.length; i += 1) {
      const direction = (i < 3 ? points[i + 1].clone().sub(points[i]) : points[i].clone().sub(points[i - 1])).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
      for (let j = 0; j < 12; j += 1) {
        const angle = 2 * Math.PI * j / 12;
        push(new THREE.Vector3(Math.cos(angle) * radii[i] * limbScale, Math.sin(angle) * radii[i] * limbScale, 0).applyQuaternion(quaternion).add(points[i]));
      }
    }
    for (const offset of [[sign * 0.35, 0.2, 0], [sign * 0.38, -0.15, 0], [-sign * 0.25, 0.05, 0]]) {
      const direction = new THREE.Vector3(...offset).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
      const start = points[3].clone().addScaledVector(direction, 0.02);
      const end = points[3].clone().add(new THREE.Vector3(...offset).multiplyScalar(limbScale));
      for (let j = 0; j < 6; j += 1) {
        const angle = 2 * Math.PI * j / 6;
        const x = Math.cos(angle) * 0.12 * limbScale, y = Math.sin(angle) * 0.12 * limbScale;
        push(new THREE.Vector3(x, y, 0).applyQuaternion(quaternion).add(start));
        push(new THREE.Vector3(x * 0.4, y * 0.4, 0).applyQuaternion(quaternion).add(end));
      }
    }
    if (cursor !== coarse.length) throw new Error('Chameleon coarse geometry schema mismatch.');
    const grid = descriptor.snap_scales;
    const row = Math.round((torsoScale - grid.min) / grid.step);
    const col = Math.round((limbScale - grid.min) / grid.step);
    const snap = indices[row * grid.count + col];
    if (!Number.isInteger(snap) || snap < 0 || snap >= descriptor.coarse_count) throw new Error('Missing native snap choice.');
    coarse.fill(0, snap * 3, snap * 3 + 3);
    const translation = [sign * 1.3 * (descriptor.is_hind ? 0.38 : 0.4) * torsoScale, (descriptor.is_hind ? -1 : 1) * 3.2 * 0.23 * torsoScale, drop];
    rows.forEach((entries, index) => {
      for (let axis = 0; axis < 3; axis += 1) {
        let value = translation[axis];
        for (const [offset, weight] of entries) value += coarse[offset + axis] * weight;
        output[index * 3 + axis] = value;
      }
    });
    return output;
  };
}
