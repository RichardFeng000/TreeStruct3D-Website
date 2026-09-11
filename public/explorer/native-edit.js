import * as THREE from './vendor/three.module.min.js';
import { invalidatePreviewChecks } from './edit-state.js';
import { createChameleonLimb } from './native-chameleon.js';
import { validateNativeResponse } from './native-response-validation.js';
import { createNativeReplacement } from './native-replacement.js';

const point3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const copy = (value) => structuredClone(value);

// The native source can have several meshes driven by one PART_PARAMS entry.
// Their geometry changes together, just as it does when Blender runs the source.
export function createNativeEditor({ model, runtime: baselineRuntime, provenance = {}, response, buffer }) {
  if (!response?.parts?.length || !response?.controls?.length) throw new Error('Native edit data is incomplete.');
  const floats = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
  validateNativeResponse(response, floats);
  const baseline = copy(baselineRuntime);
  const translation = new THREE.Vector3(...(provenance.runtime_to_glb_translation || [0, 0, 0]));
  const toRoot = (point) => new THREE.Vector3(point[0], point[2], -point[1]).add(translation);
  const fromRoot = (point) => {
    const value = point.clone().sub(translation);
    return [value.x, -value.z, value.y];
  };
  const field = (descriptor) => {
    if (!descriptor || !Number.isInteger(descriptor.offset) || !Number.isInteger(descriptor.count)
      || descriptor.offset < 0 || descriptor.count < 0 || descriptor.offset + descriptor.count > floats.length) {
      throw new Error('Invalid native geometry buffer.');
    }
    return floats.subarray(descriptor.offset, descriptor.offset + descriptor.count);
  };
  const states = new Map(response.parts.map((part) => {
    const positions = field(part.positions);
    return [part.id, { ...part, base: positions, current: positions.slice(), meshes: [], box: new THREE.Box3() }];
  }));
  const controls = new Map(response.controls.map((control) => [control.id, {
    ...control, scale: 1, samples: [...control.samples].sort((a, b) => a.scale - b.scale),
  }]));
  const ratios = (response.ratio_interactions || []).map((item) => ({
    ...item, samples: item.samples.map((sample) => ({ ...sample, scale: sample.ratio })).sort((a, b) => a.scale - b.scale),
  }));
  const pillowHeight = (frame, mattress, pillow) => {
    const u = Math.abs(1 - (1.16 / 7.54) * pillow / (frame * mattress));
    return mattress * (0.62 + 0.055 * Math.max(0, 0.75 * (1 - u * u)) - 0.045 * Math.max(0.5, u) ** 4);
  };
  const runtimeNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const controlForPart = new Map();
  for (const [id, state] of states) {
    const partId = runtimeNodes.get(id)?.part_id || state.part_id || id;
    const control = controls.get(partId) || controls.get(state.part_id) || controls.get(id);
    if (control) controlForPart.set(id, control);
  }
  const names = new Map();
  for (const id of states.keys()) {
    names.set(id, id);
    names.set(THREE.PropertyBinding.sanitizeNodeName(id), id);
  }
  const records = [];
  model.updateWorldMatrix(true, true);
  const rootInverse = model.matrixWorld.clone().invert();
  const extent = baseline.scene_extent || 1;
  const bindingTolerance = Math.max(2e-5, extent * 8e-6);

  // glTF duplicates source vertices at UV/material/normal seams. Bind by native
  // position, rather than assuming the exporter retains Blender vertex order.
  function spatialIndex(state) {
    if (state.lookup) return state.lookup;
    const lookup = new Map();
    for (let i = 0; i < state.base.length; i += 3) {
      const key = [0, 1, 2].map((axis) => Math.floor(state.base[i + axis] / bindingTolerance)).join(',');
      if (!lookup.has(key)) lookup.set(key, []);
      lookup.get(key).push(i);
    }
    state.lookup = lookup;
    return lookup;
  }
  function bindPoint(state, point, strict = false) {
    const lookup = spatialIndex(state);
    const cell = point.map((value) => Math.floor(value / bindingTolerance));
    let best = -1, distance = Infinity;
    const consider = (i) => {
      const d = point.reduce((sum, value, axis) => sum + (value - state.base[i + axis]) ** 2, 0);
      if (d < distance) { best = i; distance = d; }
    };
    for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
      for (const i of lookup.get([cell[0] + x, cell[1] + y, cell[2] + z].join(',')) || []) consider(i);
    }
    if (best < 0 && !strict) for (let i = 0; i < state.base.length; i += 3) consider(i);
    if (best < 0 || (strict && distance > bindingTolerance ** 2 * 3)) {
      throw new Error(`Native geometry does not match the saved model (${state.id}).`);
    }
    return best;
  }
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let id;
    for (let object = mesh; object && object !== model; object = object.parent) {
      id = names.get(object.userData.codex_semantic_node_id) || names.get(object.name);
      if (id) break;
    }
    if (!id) throw new Error(`Unmapped native model mesh: ${mesh.name}`);
    const state = states.get(id);
    const original = mesh.geometry;
    const rootMatrix = rootInverse.clone().multiply(mesh.matrixWorld);
    const rootToLocal = rootMatrix.clone().invert();
    const position = original.getAttribute('position');
    const mapping = new Uint32Array(position.count);
    const vector = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vector.fromBufferAttribute(position, i).applyMatrix4(rootMatrix);
      mapping[i] = bindPoint(state, fromRoot(vector), true);
    }
    const record = { mesh, original, mapping, rootMatrix, rootToLocal, state };
    records.push(record);
    state.meshes.push(record);
  });
  const parts = baseline.nodes.filter((node) => states.get(node.id)?.meshes.length && controlForPart.has(node.id)).map((node) => ({
    id: node.id, label: node.label || node.id, part_id: node.part_id || node.id,
    parameter_id: controlForPart.get(node.id).id,
  }));
  if (parts.length !== baseline.nodes.length) throw new Error('Some native parts have no parameter control.');
  const procedural = (response.procedural || []).map((item) => {
    if (item.type !== 'chameleon_limb') throw new Error('Unknown native procedural geometry.');
    return { ...item, evaluate: createChameleonLimb(item, field) };
  });
  const normalGroups = new Map();
  for (const record of records) {
    record.normalToRoot = new THREE.Matrix3().getNormalMatrix(record.rootMatrix);
    record.normalFromRoot = record.normalToRoot.clone().invert();
    const normals = record.original.getAttribute('normal');
    if (!normals) continue;
    const normal = new THREE.Vector3();
    for (let i = 0; i < normals.count; i += 1) {
      normal.fromBufferAttribute(normals, i).applyMatrix3(record.normalToRoot).normalize();
      const key = `${record.state.id}:${record.mapping[i]}:${normal.toArray().map((value) => Math.round(value * 10000)).join(',')}`;
      if (!normalGroups.has(key)) normalGroups.set(key, []);
      normalGroups.get(key).push({ record, index: i });
    }
  }
  const replacements = (response.replacements || []).map((item) => createNativeReplacement(item, states.get(item.id), field, toRoot));
  // All data and vertex bindings are checked before changing the loaded model.
  for (const record of records) record.mesh.geometry = record.original.clone();

  let changed = false, disposed = false, runtimeCache = null;
  const anchorBase = response.anchors || [];
  let currentAnchors = copy(anchorBase);
  const pointBindings = new Map();
  function displaced(point, id) {
    if (!point3(point) || !states.has(id)) return point;
    const key = `${id}:${point.join(',')}`;
    const state = states.get(id);
    if (!pointBindings.has(key)) pointBindings.set(key, bindPoint(state, point));
    const offset = pointBindings.get(key);
    return point.map((value, axis) => value + state.current[offset + axis] - state.base[offset + axis]);
  }
  function brackets(samples, scale) {
    let upper = samples.findIndex((sample) => sample.scale >= scale - 1e-10);
    if (upper < 0) upper = samples.length - 1;
    const lower = Math.max(0, upper - (samples[upper].scale > scale + 1e-10 ? 1 : 0));
    const a = samples[lower], b = samples[upper];
    const t = a === b ? 0 : (scale - a.scale) / (b.scale - a.scale);
    return a === b ? [[a, 1]] : [[a, 1 - t], [b, t]];
  }
  function addResponse(sample, weight) {
    if (!weight || !sample) return;
    for (const part of sample.parts || []) {
      const target = states.get(part.id)?.current;
      const delta = field(part.delta);
      if (!target || target.length !== delta.length) throw new Error('Native response topology mismatch.');
      for (let i = 0; i < target.length; i += 1) target[i] += weight * delta[i];
    }
    if (sample.anchors) {
      const delta = field(sample.anchors);
      if (delta.length !== currentAnchors.length * 6) throw new Error('Native anchor response mismatch.');
      currentAnchors.forEach((anchor, index) => {
        for (const [key, offset] of [['parent_world', 0], ['child_world', 3]]) {
          anchor[key] = anchor[key].map((value, axis) => value + weight * delta[index * 6 + offset + axis]);
        }
      });
    }
  }
  function apply() {
    changed = [...controls.values()].some((control) => control.scale !== 1);
    runtimeCache = null;
    for (const state of states.values()) state.current.set(state.base);
    currentAnchors = copy(anchorBase);
    if (changed) for (const control of controls.values()) {
      if (control.scale === 1) continue;
      for (const [sample, weight] of brackets(control.samples, control.scale)) addResponse(sample, weight);
    }
    // Mixed response fields retain dependencies such as bed width = frame ×
    // mattress × blanket. They are residuals after all lower-order fields.
    if (changed) for (const interaction of response.interactions || []) {
      const scales = interaction.ids.map((id) => controls.get(id).scale);
      if (scales.includes(1)) continue;
      const choices = interaction.knots.map((knots, axis) => brackets(knots.map((scale) => ({ scale })), scales[axis]));
      function visit(axis, values, weight) {
        if (axis === choices.length) {
          const sample = interaction.samples.find((item) => item.scales.every((value, index) => Math.abs(value - values[index]) < 1e-9));
          if (!sample) throw new Error('Missing native mixed-parameter response.');
          addResponse(sample, weight);
          return;
        }
        for (const [knot, fraction] of choices[axis]) visit(axis + 1, [...values, knot.scale], weight * fraction);
      }
      visit(0, [], 1);
    }
    // For a homogeneous native shape F(u,v), the interaction left after
    // single-parameter responses is v·D(u/v) − D(u) − v·D(1/v).
    // Constant geometry and independent parent offsets cancel in this form.
    if (changed) for (const interaction of ratios) {
      const numerator = controls.get(interaction.numerator_control).scale;
      const denominator = controls.get(interaction.denominator_control).scale;
      if (numerator === 1 || denominator === 1) continue;
      for (const [ratio, factor] of [[numerator / denominator, denominator], [numerator, -1], [1 / denominator, -denominator]]) {
        for (const [sample, weight] of brackets(interaction.samples, ratio)) addResponse(sample, factor * weight);
      }
    }
    if (changed) for (const item of response.scalar_fields || []) {
      if (item.type !== 'bed_pillow_height') throw new Error('Unknown native scalar geometry rule.');
      const scale = (key) => controls.get(item.controls[key]).scale;
      const delta = pillowHeight(scale('frame'), scale('mattress'), scale('pillow')) - pillowHeight(1, 1, 1);
      for (const part of item.parts) {
        const weights = field(part.weights), positions = states.get(part.id).current;
        for (let i = 0; i < weights.length; i += 1) positions[i * 3 + part.axis] += weights[i] * delta;
      }
      for (const index of item.anchor_indices || []) {
        currentAnchors[index].parent_world[2] += delta;
        currentAnchors[index].child_world[2] += delta;
      }
    }
    if (changed) for (const item of procedural) {
      states.get(item.id).current.set(item.evaluate(controls.get(item.torso_control).scale, controls.get(item.limb_control).scale));
    }
    for (const render of replacements) render((id) => controls.get(id).scale, changed);
    const vector = new THREE.Vector3();
    for (const record of records) {
      if (changed && record.replacement) continue;
      const state = record.state;
      const positions = record.mesh.geometry.getAttribute('position');
      if (!changed) {
        positions.array.set(record.original.getAttribute('position').array);
        const normal = record.original.getAttribute('normal');
        if (normal) record.mesh.geometry.getAttribute('normal').array.set(normal.array);
      } else {
        for (let i = 0; i < positions.count; i += 1) {
          const offset = record.mapping[i];
          vector.copy(toRoot(state.current.subarray(offset, offset + 3))).applyMatrix4(record.rootToLocal);
          positions.setXYZ(i, vector.x, vector.y, vector.z);
        }
        record.mesh.geometry.computeVertexNormals();
      }
      positions.needsUpdate = true;
      if (record.mesh.geometry.getAttribute('normal')) record.mesh.geometry.getAttribute('normal').needsUpdate = true;
      record.mesh.geometry.computeBoundingBox();
      record.mesh.geometry.computeBoundingSphere();
    }
    // Preserve the source's smooth/flat boundaries while sharing normals
    // across the new UV seams introduced by procedural material baking.
    if (changed) {
      const sum = new THREE.Vector3(), normal = new THREE.Vector3();
      for (const members of normalGroups.values()) {
        if (members[0].record.replacement) continue;
        if (members.length < 2) continue;
        sum.set(0, 0, 0);
        for (const { record, index } of members) {
          normal.fromBufferAttribute(record.mesh.geometry.getAttribute('normal'), index).applyMatrix3(record.normalToRoot).normalize();
          sum.add(normal);
        }
        sum.normalize();
        for (const { record, index } of members) {
          normal.copy(sum).applyMatrix3(record.normalFromRoot).normalize();
          record.mesh.geometry.getAttribute('normal').setXYZ(index, normal.x, normal.y, normal.z);
        }
      }
    }
  }
  function getRuntime() {
    if (!changed) return copy(baseline);
    if (runtimeCache) return copy(runtimeCache);
    const runtime = copy(baseline);
    const total = new THREE.Box3();
    for (const node of runtime.nodes) {
      const state = states.get(node.id);
      const box = new THREE.Box3();
      for (const record of state.meshes) box.union(record.mesh.geometry.boundingBox.clone().applyMatrix4(record.rootMatrix));
      total.union(box);
      node.bbox_min = fromRoot(new THREE.Vector3(box.min.x, box.min.y, box.max.z));
      node.bbox_max = fromRoot(new THREE.Vector3(box.max.x, box.max.y, box.min.z));
      node.dimensions = node.bbox_min.map((value, axis) => node.bbox_max[axis] - value);
      node.center = node.bbox_min.map((value, axis) => (node.bbox_max[axis] + value) / 2);
      node.origin = displaced(node.origin, node.id);
      node.preview_scale = controlForPart.get(node.id).scale;
      node.preview_only = true;
    }
    for (const edge of runtime.edges) {
      const pair = [edge.parent, edge.child].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      edge.anchor_a = displaced(edge.anchor_a, pair[0]);
      edge.anchor_b = displaced(edge.anchor_b, pair[1]);
      for (const declaration of edge.declared_directions || []) {
        const candidates = anchorBase.map((anchor, index) => ({ anchor, index })).filter(({ anchor }) => anchor.parent === declaration.parent && anchor.child === declaration.child);
        const point = declaration.parent_anchor_world;
        if (point3(point) && candidates.length) {
          candidates.sort((a, b) => a.anchor.parent_world.reduce((sum, value, axis) => sum + (value - point[axis]) ** 2, 0) - b.anchor.parent_world.reduce((sum, value, axis) => sum + (value - point[axis]) ** 2, 0));
          const current = currentAnchors[candidates[0].index];
          declaration.parent_anchor_world = [...current.parent_world];
          declaration.child_anchor_world = [...current.child_world];
        } else {
          declaration.parent_anchor_world = displaced(declaration.parent_anchor_world, declaration.parent);
          declaration.child_anchor_world = displaced(declaration.child_anchor_world, declaration.child);
        }
      }
    }
    runtime.source_bounds = {
      min: fromRoot(new THREE.Vector3(total.min.x, total.min.y, total.max.z)),
      max: fromRoot(new THREE.Vector3(total.max.x, total.max.y, total.min.z)),
    };
    runtime.scene_extent = Math.max(...total.getSize(new THREE.Vector3()).toArray());
    runtime.preview_scales = Object.fromEntries(parts.map((part) => [part.id, controlForPart.get(part.id).scale]));
    runtime.preview_method = 'native_blender_response';
    runtime.preview_note = 'Geometry follows sampled native Blender parameter rebuilds. Live attachment checks have not been rerun.';
    invalidatePreviewChecks(runtime);
    for (const edge of runtime.edges) {
      edge.anchor_gap = edge.aabb_gap = null;
      edge.anchor_method = 'sampled_native_blender_parameters';
      for (const declaration of edge.declared_directions || []) {
        declaration.preview_only = true;
        declaration.validation_status = 'not_run';
        declaration.authored_anchor_gap = null;
        declaration.parent_anchor_vertex_gap = declaration.child_anchor_vertex_gap = null;
      }
    }
    runtime.summary = {
      nodes: runtime.nodes.length, edges: runtime.edges.length,
      directed_edges: runtime.edges.filter((edge) => edge.parent_child_known).length,
      shared_anchor_edges: 0, estimated_anchor_edges: runtime.edges.length,
      geometric_anchor_candidates: 0, unverified_anchor_candidates: 0, misaligned_anchor_edges: 0,
    };
    runtimeCache = runtime;
    return copy(runtime);
  }
  function controlFor(id) {
    if (disposed) throw new Error('This native editor has been disposed.');
    const control = controlForPart.get(id);
    if (!control) throw new RangeError(`No native parameter for part: ${id}`);
    return control;
  }
  return {
    parts, native: true,
    get changed() { return changed; },
    hasEdits: () => changed,
    getScale(id) { return controlFor(id).scale; },
    setScale(id, value) {
      if (!Number.isFinite(Number(value))) throw new TypeError('Scale must be finite.');
      const control = controlFor(id);
      control.scale = Math.round(THREE.MathUtils.clamp(Number(value), 0.4, 1.6) * 100) / 100;
      apply();
      return control.scale;
    },
    setScales(values) {
      const updates = Object.entries(values).map(([id, value]) => {
        if (!Number.isFinite(Number(value))) throw new TypeError('Scale must be finite.');
        return [controlFor(id), Math.round(THREE.MathUtils.clamp(Number(value), 0.4, 1.6) * 100) / 100];
      });
      for (const [control, scale] of updates) control.scale = scale;
      apply();
    },
    resetPart(id) { controlFor(id).scale = 1; apply(); },
    resetAll() { for (const control of controls.values()) control.scale = 1; apply(); },
    getRuntime,
    runtimePointToWorld(point) {
      if (!point3(point)) return null;
      model.updateWorldMatrix(true, false);
      return toRoot(point).applyMatrix4(model.matrixWorld);
    },
    dispose() {
      if (disposed) return;
      for (const record of records) { record.mesh.geometry.dispose(); record.mesh.geometry = record.original; }
      disposed = true;
    },
  };
}
