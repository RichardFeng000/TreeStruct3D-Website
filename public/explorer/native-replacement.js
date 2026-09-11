import * as THREE from './vendor/three.module.min.js';

// Some native programs change topology when a scale crosses a branch in their
// generator. Those parts use the exact saved .01 state, including triangles
// and material assignments, rather than a morph between incompatible meshes.
export function createNativeReplacement(descriptor, state, field, toRoot) {
  const samples = new Map(descriptor.samples.map((sample) => [Math.round(sample.scale * 100), sample]));
  for (const record of state.meshes) {
    record.replacement = true;
    record.materialSlot = descriptor.material_names?.indexOf(record.mesh.material.name) ?? state.meshes.indexOf(record);
    if (record.materialSlot < 0) throw new Error(`Missing native replacement material: ${record.mesh.material.name}`);
  }
  return (scaleFor, changed) => {
    if (!changed) {
      for (const record of state.meshes) {
        if (!record.dynamicGeometry) continue;
        record.mesh.geometry.dispose();
        record.mesh.geometry = record.original.clone();
        record.dynamicGeometry = null;
      }
      return;
    }
    const key = Math.round(scaleFor(descriptor.control) * 100);
    const sample = samples.get(key);
    if (!sample) throw new Error('The exact native topology for this scale is missing.');
    const positions = field(sample.positions), normals = field(sample.normals);
    const indices = field(sample.triangles), materials = field(sample.materials);
    const delta = [0, 0, 0];
    for (const control of descriptor.translation_controls || []) {
      const scale = scaleFor(control.id);
      const sorted = [...control.samples].sort((a, b) => a.scale - b.scale);
      let upper = sorted.findIndex((item) => item.scale >= scale);
      if (upper < 0) upper = sorted.length - 1;
      const b = sorted[upper], a = sorted[Math.max(0, upper - 1)];
      const t = a === b ? 0 : (scale - a.scale) / (b.scale - a.scale);
      for (let axis = 0; axis < 3; axis += 1) delta[axis] += a.delta[axis] * (1 - t) + b.delta[axis] * t;
    }
    const vector = new THREE.Vector3();
    for (const record of state.meshes) {
      if (record.dynamicGeometry !== key) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals.length), 3));
        const ownIndices = [];
        for (let i = 0; i < materials.length; i += 1) if (materials[i] === record.materialSlot) ownIndices.push(indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]);
        geometry.setIndex(ownIndices);
        record.mesh.geometry.dispose();
        record.mesh.geometry = geometry;
        record.dynamicGeometry = key;
      }
      const geometry = record.mesh.geometry;
      const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
      for (let i = 0; i < positions.length; i += 3) {
        vector.copy(toRoot([positions[i] + delta[0], positions[i + 1] + delta[1], positions[i + 2] + delta[2]])).applyMatrix4(record.rootToLocal);
        pos.setXYZ(i / 3, vector.x, vector.y, vector.z);
        vector.set(normals[i], normals[i + 2], -normals[i + 1]).applyMatrix3(record.normalFromRoot).normalize();
        normal.setXYZ(i / 3, vector.x, vector.y, vector.z);
      }
      pos.needsUpdate = normal.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  };
}
