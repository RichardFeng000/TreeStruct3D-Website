import * as THREE from './vendor/three.module.min.js';

const MIN_SCALE = 0.4;
const MAX_SCALE = 1.6;
const EPSILON = 1e-10;
const validPoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const copy = (value) => structuredClone(value);
const compareIds = (first, second) => first < second ? -1 : first > second ? 1 : 0;

function identityNames(mesh) {
  return [mesh.name, mesh.userData.codex_semantic_node_id, ...(mesh.userData.explorerPartAliases || [])].filter(Boolean);
}

function geometryBounds(mesh, matrix) {
  const box = new THREE.Box3();
  const positions = mesh.geometry?.getAttribute('position');
  const point = new THREE.Vector3();
  if (positions) for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
    box.expandByPoint(point);
  }
  return box;
}

function chooseForest(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const candidates = [];
  edges.forEach((edge, index) => {
    for (const declaration of edge.declared_directions || []) {
      const priority = declaration.source === 'final_parent' ? 0 : declaration.source === 'parent_assignment' ? 1 : null;
      if (priority !== null) candidates.push({ parent: declaration.parent, child: declaration.child, edge, priority, index });
    }
    if (['DIRECTED', 'DIRECTED_CODE'].includes(edge.relation) && (edge.parent_child_known || edge.directed_verified)) {
      candidates.push({ parent: edge.parent, child: edge.child, edge, priority: 2, index });
    }
  });
  candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const incoming = new Map();
  for (const candidate of candidates) {
    const { parent, child } = candidate;
    if (!ids.has(parent) || !ids.has(child) || parent === child || incoming.has(child)) continue;
    let ancestor = parent;
    const visited = new Set();
    while (incoming.has(ancestor) && ancestor !== child && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = incoming.get(ancestor).parent;
    }
    if (ancestor !== child) incoming.set(child, candidate);
  }
  return incoming;
}

function clearValidation(edge) {
  edge.preview_only = true;
  edge.validation_status = 'not_run';
  edge.shared_anchor = false;
  edge.contact = null;
  edge.authored_anchor_valid = null;
  edge.authored_anchor_all_valid = null;
  edge.authored_anchor_valid_count = null;
  edge.geometric_anchor_aligned = null;
  edge.shared_anchor_evidence = null;
  edge.anchor_gap = null;
  edge.aabb_gap = null;
  edge.child_anchor_vertex_gap = null;
  edge.parent_anchor_vertex_gap = null;
  edge.directed_verified = false;
  edge.anchor_estimated = true;
  edge.anchor_method = 'browser_preview_saved_attachment';
  edge.evidence = 'Browser geometry preview. Attachment validation has not been run.';
  delete edge.parameter_invariance;
  delete edge.parameter_invariance_failed;
  for (const declaration of edge.declared_directions || []) {
    declaration.preview_only = true;
    declaration.validation_status = 'not_run';
    declaration.authored_anchor_valid = null;
    declaration.authored_anchor_gap = null;
    declaration.child_anchor_vertex_gap = null;
    declaration.parent_anchor_vertex_gap = null;
  }
}

/**
 * Preview independent instance scales using saved meshes and attachment points.
 * This does not execute native PART_PARAMS, reconstruct surfaces, or validate
 * contact. A multipart rigid mesh uses one representative attachment pair;
 * its other attachment points are not guaranteed to remain aligned.
 */
export function createContinuousEditor(model, baselineRuntime, provenance = {}) {
  if (model?.model) {
    ({ model, runtime: baselineRuntime, provenance = {} } = model);
  }
  if (!model?.isObject3D || !baselineRuntime?.nodes?.length) throw new TypeError('A model and saved runtime nodes are required.');
  const baseline = copy(baselineRuntime);
  const translation = new THREE.Vector3(...(validPoint(provenance.runtime_to_glb_translation) ? provenance.runtime_to_glb_translation : [0, 0, 0]));
  const toRoot = (point) => new THREE.Vector3(point[0], point[2], -point[1]).add(translation);
  const toRuntime = (point) => {
    const value = point.clone().sub(translation);
    return [value.x, -value.z, value.y];
  };
  model.updateWorldMatrix(true, true);
  const rootInverse = model.matrixWorld.clone().invert();
  const records = new Map();
  const nodes = new Map(baseline.nodes.map((node) => [node.id, { node, meshes: [], scale: 1, box: new THREE.Box3(), transform: new THREE.Matrix4() }]));
  const sanitizedIds = new Map();
  for (const node of baseline.nodes) {
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(node.id);
    const ids = sanitizedIds.get(sanitized) || [];
    ids.push(node.id);
    sanitizedIds.set(sanitized, ids);
  }
  function ownIdentity(object) {
    const names = identityNames(object);
    let id = names.find((name) => nodes.has(name));
    if (!id) {
      for (const name of names) {
        const matches = sanitizedIds.get(name);
        if (matches?.length === 1) { [id] = matches; break; }
      }
    }
    if (!id) {
      const partId = object.userData.treestruct3d_part_id || object.userData.stage7_part_id;
      const matches = baseline.nodes.filter((node) => (node.part_id || node.id) === partId);
      if (matches.length === 1) id = matches[0].id;
    }
    return id;
  }
  model.traverse((object) => {
    if (object === model) return;
    records.set(object, {
      matrix: object.matrix.clone(), rootMatrix: rootInverse.clone().multiply(object.matrixWorld),
      position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
      autoUpdate: object.matrixAutoUpdate,
    });
    if (!object.isMesh) return;
    let id = ownIdentity(object);
    // A glTF loader sanitizes punctuation in node names. Resolve instances
    // before shared semantic IDs. Multi-material primitives inherit identity
    // from their nearest named node group, never from a more distant parent.
    for (let ancestor = object.parent; !id && ancestor && ancestor !== model; ancestor = ancestor.parent) {
      id = ownIdentity(ancestor);
    }
    if (id) {
      records.get(object).nodeId = id;
      const state = nodes.get(id);
      state.meshes.push(object);
      state.box.union(geometryBounds(object, records.get(object).rootMatrix));
    }
  });
  for (const state of nodes.values()) {
    if (state.box.isEmpty()) {
      for (const point of [state.node.bbox_min, state.node.bbox_max]) if (validPoint(point)) state.box.expandByPoint(toRoot(point));
    }
    state.center = state.box.isEmpty() ? toRoot(state.node.center || [0, 0, 0]) : state.box.getCenter(new THREE.Vector3());
  }
  const incoming = chooseForest(baseline.nodes, baseline.edges || []);

  function anchors(edge, parent, child) {
    const declarations = (edge.declared_directions || []).filter((item) => item.parent === parent && item.child === child && validPoint(item.parent_anchor_world) && validPoint(item.child_anchor_world));
    declarations.sort((a, b) => Number(b.authored_anchor_valid === true) - Number(a.authored_anchor_valid === true));
    if (declarations.length) {
      return { parent: toRoot(declarations[0].parent_anchor_world), child: toRoot(declarations[0].child_anchor_world), mode: 'saved_authored_pair', count: declarations.length };
    }
    const parentBox = nodes.get(parent).box;
    const childBox = nodes.get(child).box;
    if (validPoint(edge.anchor_a) && validPoint(edge.anchor_b)) {
      const first = toRoot(edge.anchor_a), second = toRoot(edge.anchor_b);
      const forward = parentBox.distanceToPoint(first) + childBox.distanceToPoint(second);
      const reverse = parentBox.distanceToPoint(second) + childBox.distanceToPoint(first);
      const firstIsParent = Math.abs(forward - reverse) < EPSILON ? compareIds(parent, child) <= 0 : forward < reverse;
      return { parent: (firstIsParent ? first : second), child: (firstIsParent ? second : first), mode: 'saved_estimated_pair', count: 1 };
    }
    const parentPoint = parentBox.clampPoint(nodes.get(child).center, new THREE.Vector3());
    const childPoint = childBox.clampPoint(parentPoint, new THREE.Vector3());
    return { parent: parentPoint, child: childPoint, mode: 'estimated_bounds_pair', count: 1 };
  }
  for (const relation of incoming.values()) relation.anchors = anchors(relation.edge, relation.parent, relation.child);
  const parts = baseline.nodes.filter((node) => nodes.get(node.id).meshes.length).map((node) => ({
    id: node.id, label: node.label || node.id, part_id: node.part_id || node.id,
  }));
  let changed = false;
  let disposed = false;
  let runtimeCache = null;

  function restore() {
    for (const [object, record] of records) {
      object.position.copy(record.position);
      object.quaternion.copy(record.quaternion);
      object.scale.copy(record.scale);
      object.matrix.copy(record.matrix);
      object.matrixAutoUpdate = record.autoUpdate;
    }
    model.updateWorldMatrix(true, true);
  }

  function apply() {
    changed = [...nodes.values()].some((state) => Math.abs(state.scale - 1) > EPSILON);
    runtimeCache = null;
    if (!changed) {
      for (const state of nodes.values()) state.transform.identity();
      restore();
      return;
    }
    const resolved = new Set();
    function resolve(id) {
      if (resolved.has(id)) return;
      const state = nodes.get(id);
      const relation = incoming.get(id);
      let pivot = state.center;
      const offset = new THREE.Vector3();
      if (relation) {
        resolve(relation.parent);
        pivot = relation.anchors.child;
        // Follow the parent's point displacement while preserving any saved
        // baseline gap. Previewing does not silently repair broken examples.
        offset.copy(relation.anchors.parent).applyMatrix4(nodes.get(relation.parent).transform).sub(relation.anchors.parent);
      }
      state.transform.makeTranslation(offset.x + pivot.x * (1 - state.scale), offset.y + pivot.y * (1 - state.scale), offset.z + pivot.z * (1 - state.scale));
      state.transform.multiply(new THREE.Matrix4().makeScale(state.scale, state.scale, state.scale));
      resolved.add(id);
    }
    for (const id of nodes.keys()) resolve(id);
    function visit(object, parentRoot) {
      const record = records.get(object);
      if (!record) return;
      const targetRoot = record.nodeId
        ? nodes.get(record.nodeId).transform.clone().multiply(record.rootMatrix)
        : parentRoot.clone().multiply(record.matrix);
      object.matrix.copy(parentRoot.clone().invert().multiply(targetRoot));
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.matrixAutoUpdate = false;
      for (const child of object.children) visit(child, targetRoot);
    }
    for (const child of model.children) visit(child, new THREE.Matrix4());
    model.updateWorldMatrix(true, true);
  }

  const transformedPoint = (point, id) => validPoint(point) && nodes.has(id) ? toRuntime(toRoot(point).applyMatrix4(nodes.get(id).transform)) : point;

  function getRuntime() {
    if (!changed) return copy(baseline);
    if (runtimeCache) return copy(runtimeCache);
    const runtime = copy(baseline);
    const total = new THREE.Box3();
    runtime.nodes = runtime.nodes.map((node) => {
      const state = nodes.get(node.id);
      const box = state.box.clone().applyMatrix4(state.transform);
      total.union(box);
      const min = toRuntime(new THREE.Vector3(box.min.x, box.min.y, box.max.z));
      const max = toRuntime(new THREE.Vector3(box.max.x, box.max.y, box.min.z));
      return { ...node, origin: transformedPoint(node.origin, node.id), center: min.map((value, axis) => (value + max[axis]) / 2), bbox_min: min, bbox_max: max, dimensions: min.map((value, axis) => max[axis] - value), preview_scale: state.scale, preview_only: true };
    });
    for (const edge of runtime.edges) {
      // blender_probe stores A/B in Python-sorted instance-ID order; its
      // browser converter changes parent/child direction without swapping A/B.
      const pairIds = [edge.parent, edge.child].sort(compareIds);
      edge.anchor_a = transformedPoint(edge.anchor_a, pairIds[0]);
      edge.anchor_b = transformedPoint(edge.anchor_b, pairIds[1]);
      for (const declaration of edge.declared_directions || []) {
        declaration.parent_anchor_world = transformedPoint(declaration.parent_anchor_world, declaration.parent);
        declaration.child_anchor_world = transformedPoint(declaration.child_anchor_world, declaration.child);
      }
      clearValidation(edge);
      if (!['DIRECTED', 'DIRECTED_CODE'].includes(edge.relation)) edge.relation = 'PREVIEW';
    }
    const min = toRuntime(new THREE.Vector3(total.min.x, total.min.y, total.max.z));
    const max = toRuntime(new THREE.Vector3(total.max.x, total.max.y, total.min.z));
    runtime.source_bounds = { min, max };
    runtime.scene_extent = Math.max(...min.map((value, axis) => max[axis] - value));
    runtime.preview_only = true;
    runtime.validation_status = 'not_run';
    runtime.preview_coordinate_system = 'blender_z_up_with_provenance';
    runtime.preview_note = 'Browser preview scales saved meshes around one representative attachment point. It does not rebuild Blender geometry or verify contact; multiple attachment points may separate.';
    runtime.preview_scales = Object.fromEntries([...nodes].map(([id, state]) => [id, state.scale]));
    runtime.summary = { nodes: runtime.nodes.length, edges: runtime.edges.length, directed_edges: runtime.edges.filter((edge) => edge.parent_child_known).length, shared_anchor_edges: 0, estimated_anchor_edges: runtime.edges.length, geometric_anchor_candidates: 0, unverified_anchor_candidates: 0, misaligned_anchor_edges: 0 };
    delete runtime.parameter_invariance;
    runtimeCache = runtime;
    return copy(runtime);
  }

  function assertPart(id) {
    if (disposed) throw new Error('This preview editor has been disposed.');
    const state = nodes.get(id);
    if (!state?.meshes.length) throw new RangeError(`No editable mesh for part: ${id}`);
    return state;
  }

  return {
    parts,
    get changed() { return changed; },
    hasEdits: () => changed,
    getScale(id) { return assertPart(id).scale; },
    setScale(id, value) {
      const state = assertPart(id);
      if (!Number.isFinite(Number(value))) throw new TypeError('Scale must be finite.');
      const scale = THREE.MathUtils.clamp(Number(value), MIN_SCALE, MAX_SCALE);
      state.scale = Math.abs(scale - 1) < EPSILON ? 1 : scale;
      apply();
      return state.scale;
    },
    resetPart(id) { assertPart(id).scale = 1; apply(); },
    resetAll() { for (const state of nodes.values()) state.scale = 1; apply(); },
    getRuntime,
    runtimePointToWorld(point) {
      if (!validPoint(point)) return null;
      model.updateWorldMatrix(true, false);
      return toRoot(point).applyMatrix4(model.matrixWorld);
    },
    dispose() {
      for (const state of nodes.values()) { state.scale = 1; state.transform.identity(); }
      changed = false;
      restore();
      disposed = true;
      runtimeCache = null;
    },
  };
}
