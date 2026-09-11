import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createContinuousEditor } from '../public/explorer/continuous-edit.js';

const near = (actual, expected, tolerance = 1e-8) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < tolerance, `${actual} != ${expected}`));
};
const blender = ([x, y, z], translation = [0, 0, 0]) => [x - translation[0], -(z - translation[2]), y - translation[1]];

function meshBounds(mesh, root) {
  root.updateWorldMatrix(true, true);
  const matrix = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const positions = mesh.geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) box.expandByPoint(point.fromBufferAttribute(positions, index).applyMatrix4(matrix));
  return box;
}

function nodeFor(mesh, root, translation = [0, 0, 0], id = mesh.name) {
  const box = meshBounds(mesh, root);
  const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld.clone().invert().multiply(mesh.matrixWorld));
  const min = blender([box.min.x, box.min.y, box.max.z], translation);
  const max = blender([box.max.x, box.max.y, box.min.z], translation);
  return { id, label: id, part_id: mesh.userData.stage7_part_id || id, center: min.map((value, axis) => (value + max[axis]) / 2), origin: blender(origin.toArray(), translation), bbox_min: min, bbox_max: max, dimensions: min.map((value, axis) => max[axis] - value) };
}

function edgeFor(parent, child, anchor, translation = [0, 0, 0], childAnchor = anchor) {
  const p = blender(anchor, translation), c = blender(childAnchor, translation);
  return { parent, child, relation: 'DIRECTED', parent_child_known: true, directed_verified: true, shared_anchor: true, contact: true, authored_anchor_valid: true, authored_anchor_all_valid: true, geometric_anchor_aligned: true, anchor_a: p, anchor_b: c, declared_directions: [
    { parent, child, source: 'final_parent' },
    { parent, child, source: 'attachment_call:authored_anchor', parent_anchor_world: p, child_anchor_world: c, authored_anchor_valid: true },
  ] };
}

function chainFixture(rootTransform = false) {
  const root = new THREE.Group();
  if (rootTransform) {
    root.position.set(4, -3, 6);
    root.rotation.set(0.2, -0.4, 0.35);
    root.scale.set(1.8, 0.7, 1.2);
  }
  const parent = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
  parent.name = 'body'; child.name = 'arm'; leaf.name = 'finger';
  root.add(parent); parent.add(child); child.add(leaf);
  parent.position.set(0, 1, 0); child.position.set(2, 0, 0); leaf.position.set(1, 0, 0);
  root.updateWorldMatrix(true, true);
  const translation = rootTransform ? [2, -1, 3] : [0, 0, 0];
  const nodes = [parent, child, leaf].map((mesh) => nodeFor(mesh, root, translation));
  const runtime = { nodes, edges: [edgeFor('body', 'arm', [1, 1, 0], translation), edgeFor('arm', 'finger', [2.5, 1, 0], translation)], roots: ['body'], summary: { shared_anchor_edges: 2 }, parameter_invariance: { results: [{ passed: true }] } };
  const editor = createContinuousEditor(root, runtime, { runtime_to_glb_translation: translation });
  return { root, parent, child, leaf, runtime, translation, editor };
}

test('parent edits move descendants without inheriting size; layered child edits move the next attachment', () => {
  const { root, parent, child, leaf, editor } = chainFixture();
  editor.setScale('body', 0.6);
  near(meshBounds(parent, root).getSize(new THREE.Vector3()).toArray(), [1.2, 1.2, 1.2]);
  near(meshBounds(child, root).getSize(new THREE.Vector3()).toArray(), [1, 1, 1]);
  near(meshBounds(child, root).getCenter(new THREE.Vector3()).toArray(), [1.6, 1, 0]);
  near(meshBounds(leaf, root).getCenter(new THREE.Vector3()).toArray(), [2.6, 1, 0]);
  editor.setScale('arm', 1.4);
  near(meshBounds(child, root).getSize(new THREE.Vector3()).toArray(), [1.4, 1.4, 1.4]);
  near(meshBounds(child, root).getCenter(new THREE.Vector3()).toArray(), [2, 1, 0]);
  near(meshBounds(leaf, root).getSize(new THREE.Vector3()).toArray(), [0.5, 0.5, 0.5]);
  near(meshBounds(leaf, root).getCenter(new THREE.Vector3()).toArray(), [3.2, 1, 0]);
  editor.resetPart('body');
  assert.equal(editor.getScale('arm'), 1.4);
  near(meshBounds(child, root).getCenter(new THREE.Vector3()).toArray(), [2.4, 1, 0]);
});

test('repeated adjustments always derive from the baseline and reset preserves original resources and hierarchy', () => {
  const { root, parent, child, leaf, editor, runtime } = chainFixture();
  const before = [parent, child, leaf].map((mesh) => ({ matrix: mesh.matrixWorld.clone(), geometry: mesh.geometry, material: mesh.material, data: Array.from(mesh.geometry.attributes.position.array), parent: mesh.parent }));
  editor.setScale('arm', 0.6);
  const once = child.matrixWorld.clone();
  for (let index = 0; index < 25; index += 1) { editor.setScale('arm', 1.4); editor.setScale('arm', 0.6); }
  near(child.matrixWorld.elements, once.elements);
  editor.resetAll();
  assert.equal(editor.changed, false);
  assert.deepEqual(editor.getRuntime(), runtime);
  [parent, child, leaf].forEach((mesh, index) => {
    near(mesh.matrixWorld.elements, before[index].matrix.elements);
    assert.equal(mesh.parent, before[index].parent);
    assert.equal(mesh.geometry, before[index].geometry);
    assert.equal(mesh.material, before[index].material);
    assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), before[index].data);
  });
  assert.equal(root.children.length, 1);
});

test('runtime conversion respects root transforms and exported coordinate translation', () => {
  const { root, child, editor, runtime, translation } = chainFixture(true);
  const point = runtime.edges[0].declared_directions[1].parent_anchor_world;
  near(editor.runtimePointToWorld(point).toArray(), new THREE.Vector3(1, 1, 0).applyMatrix4(root.matrixWorld).toArray());
  editor.setScale('arm', 0.63);
  const updated = editor.getRuntime().nodes.find((node) => node.id === 'arm');
  const measured = nodeFor(child, root, translation);
  near(updated.bbox_min, measured.bbox_min);
  near(updated.bbox_max, measured.bbox_max);
  near(updated.origin, measured.origin);
});

test('preview invalidates saved validation flags and returns isolated runtime snapshots', () => {
  const { editor, runtime } = chainFixture();
  editor.setScale('body', 1.37);
  const preview = editor.getRuntime();
  assert.equal(preview.preview_only, true);
  assert.equal(preview.validation_status, 'not_run');
  assert.equal(preview.parameter_invariance, undefined);
  for (const edge of preview.edges) {
    assert.equal(edge.shared_anchor, false);
    assert.equal(edge.contact, null);
    assert.equal(edge.authored_anchor_valid, null);
    assert.equal(edge.authored_anchor_all_valid, null);
    assert.equal(edge.validation_status, 'not_run');
    assert.equal(edge.parent_child_known, true);
    assert.ok(edge.declared_directions.every((entry) => entry.authored_anchor_valid !== true));
  }
  preview.nodes[0].bbox_min[0] = 999;
  assert.notEqual(editor.getRuntime().nodes[0].bbox_min[0], 999);
  assert.equal(runtime.edges[0].shared_anchor, true);
});

test('duplicate semantic IDs remain independently editable, including glTF sanitized names', () => {
  const root = new THREE.Group();
  const meshes = ['body', 'leg', 'leg.001'].map((id, index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = THREE.PropertyBinding.sanitizeNodeName(id);
    mesh.userData.stage7_part_id = index ? 'leg' : 'body';
    mesh.position.x = index * 2;
    root.add(mesh);
    return mesh;
  });
  const runtime = { nodes: meshes.map((mesh, index) => nodeFor(mesh, root, [0, 0, 0], ['body', 'leg', 'leg.001'][index])), edges: [edgeFor('body', 'leg', [1, 0, 0]), edgeFor('body', 'leg.001', [3, 0, 0])] };
  const editor = createContinuousEditor({ model: root, runtime });
  assert.equal(editor.parts.length, 3);
  editor.setScale('leg.001', 1.37);
  near(meshBounds(meshes[1], root).getSize(new THREE.Vector3()).toArray(), [1, 1, 1]);
  near(meshBounds(meshes[2], root).getSize(new THREE.Vector3()).toArray(), [1.37, 1.37, 1.37]);
  assert.equal(editor.getScale('leg'), 1);
});

test('cycles and coupled contacts do not become inherited transform loops; bounds are clamped', () => {
  const { root, runtime } = chainFixture();
  runtime.edges.push(edgeFor('finger', 'body', [0, 1, 0]));
  runtime.edges.push({ parent: 'body', child: 'finger', relation: 'COUPLED', parent_child_known: false });
  const editor = createContinuousEditor(root, runtime);
  assert.equal(editor.setScale('body', 4), 1.6);
  assert.equal(editor.setScale('body', 0.1), 0.4);
  assert.throws(() => editor.setScale('body', Number.NaN));
  assert.throws(() => editor.setScale('missing', 1.2));
  assert.ok(editor.getRuntime().nodes.every((node) => node.dimensions.every(Number.isFinite)));
});

test('independent root rotation and nonuniform part scale preserve affine geometry and reset exactly', () => {
  const { root, parent, child, leaf, runtime, translation } = chainFixture(true);
  parent.rotation.set(0.2, 0.4, -0.3);
  parent.scale.set(1.2, 0.8, 1.5);
  child.rotation.set(-0.1, 0.35, 0.4);
  child.scale.set(0.8, 1.3, 0.9);
  runtime.nodes = [parent, child, leaf].map((mesh) => nodeFor(mesh, root, translation));
  const before = meshBounds(child, root).getSize(new THREE.Vector3());
  const original = child.matrixWorld.clone();
  const editor = createContinuousEditor(root, runtime, { runtime_to_glb_translation: translation });
  editor.setScale('body', 0.63);
  near(meshBounds(child, root).getSize(new THREE.Vector3()).toArray(), before.toArray());
  editor.setScale('arm', 1.37);
  near(meshBounds(child, root).getSize(new THREE.Vector3()).toArray(), before.clone().multiplyScalar(1.37).toArray());
  editor.resetAll();
  near(child.matrixWorld.elements, original.elements);
});
