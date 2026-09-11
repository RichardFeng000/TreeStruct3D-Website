import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createAnchorLayer } from '../public/explorer/anchor-layer.js';

const node = (id) => ({ id, bbox_min: [-1, -1, -1], bbox_max: [1, 1, 1] });
const toWorld = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const authored = (parent = [1, 0, 0], child = [1.1, 0, 0]) => ({
  parent: 'body', child: 'arm', shared_anchor: false, contact: false, authored_anchor_valid: false,
  declared_directions: [{ parent: 'body', child: 'arm', source: 'attachment_call:authored_anchor', parent_anchor_world: parent, child_anchor_world: child }],
});
const runtimeFor = (edge = authored()) => ({ nodes: [node('body'), node('arm')], edges: [edge] });
const members = (pair) => Object.fromEntries(pair.children.map((object) => [object.name, object]));

test('unverified and preview anchors remain visible in an independent layer without green verification styling', () => {
  const scene = new THREE.Scene(), selection = new THREE.Group();
  scene.add(selection);
  const layer = createAnchorLayer(scene, toWorld);
  const runtime = runtimeFor();
  const original = structuredClone(runtime);
  layer.update(runtime);
  const pair = layer.group.children[0], objects = members(pair);
  assert.equal(layer.group.userData.pointCount, 2);
  assert.equal(objects['parent-anchor'].material.color.getHex(), 0xffc107);
  assert.equal(objects['child-anchor'].material.color.getHex(), 0x00acc1);
  assert.equal(pair.userData.anchorPair.verified, false);
  assert.deepEqual(objects['parent-anchor'].position.toArray(), [1, 0, -0]);
  selection.clear(); scene.remove(selection);
  assert.equal(layer.group.parent, scene, 'clearing selection cannot remove the independent anchor layer');
  runtime.edges[0].preview_only = true; runtime.edges[0].validation_status = 'not_run'; runtime.edges[0].shared_anchor = true;
  layer.update(runtime);
  assert.equal(layer.group.children[0], pair);
  assert.equal(layer.group.userData.pointCount, 2);
  assert.equal(pair.userData.anchorPair.verified, false);
  assert.equal(runtime.edges[0].contact, original.edges[0].contact, 'displaying an anchor cannot repair contact evidence');
  layer.dispose();
});

test('dragging updates positions and the existing line buffer while preserving all graphics resources', () => {
  const layer = createAnchorLayer(new THREE.Scene(), toWorld), runtime = runtimeFor();
  layer.update(runtime);
  const pair = layer.group.children[0], objects = members(pair);
  const parent = objects['parent-anchor'], child = objects['child-anchor'], line = objects['anchor-pair-segment'];
  const resources = [parent.geometry, parent.material, child.geometry, child.material, line.geometry, line.material, line.geometry.attributes.position.array];
  for (let index = 0; index < 30; index += 1) {
    runtime.edges[0].declared_directions[0].parent_anchor_world = [1 + index / 100, 2, 3];
    runtime.edges[0].declared_directions[0].child_anchor_world = [1.2 + index / 100, 2, 3];
    layer.update(runtime);
  }
  assert.equal(layer.group.children[0], pair);
  assert.deepEqual([parent.geometry, parent.material, child.geometry, child.material, line.geometry, line.material, line.geometry.attributes.position.array], resources);
  assert.deepEqual(parent.position.toArray(), [1.29, 3, -2]);
  assert.deepEqual(child.position.toArray(), [1.49, 3, -2]);
  assert.ok(Math.abs(line.geometry.attributes.position.getX(0) - 1.29) < 1e-6);
  assert.equal(line.geometry.attributes.position.getY(1), 3);
  assert.equal(line.frustumCulled, false, 'a moving segment cannot be culled using stale bounds');
  layer.dispose();
});

test('default display excludes contact clouds but retains authored, verified, and explicitly directed pairs', () => {
  const estimated = { parent: 'body', child: 'arm', anchor_a: [0, 0, 0], anchor_b: [1, 0, 0] };
  const runtime = runtimeFor();
  runtime.edges = [
    ...Array.from({ length: 1072 }, () => ({ ...estimated, relation: 'COUPLED', shared_anchor: false })),
    authored(), { ...estimated, shared_anchor: true }, { ...estimated, parent_child_known: true },
    { ...estimated, declared_directions: [{ parent: 'body', child: 'arm', source: 'final_parent' }] },
    { parent: 'body', child: 'arm', parent_child_known: true },
  ];
  const before = structuredClone(runtime);
  const layer = createAnchorLayer(new THREE.Scene(), toWorld);
  layer.update(runtime);
  assert.equal(layer.group.children.length, 4);
  assert.deepEqual(runtime, before);
  assert.equal(layer.group.children.filter((pair) => pair.userData.anchorPair.verified).length, 1);
  assert.ok(layer.group.children.every((pair) => members(pair)['parent-anchor'].material.color.getHex() === 0xffc107));
  layer.dispose();
});

test('isolation shows only the selected part endpoint, and coincident pairs collapse to a single visible point', () => {
  const layer = createAnchorLayer(new THREE.Scene(), toWorld), runtime = runtimeFor(authored([1, 2, 3], [1, 2, 3]));
  layer.update(runtime);
  const pair = layer.group.children[0], objects = members(pair);
  assert.equal(layer.group.userData.pointCount, 1);
  assert.equal(objects['parent-anchor'].visible, true);
  assert.equal(objects['child-anchor'].visible, false);
  assert.equal(objects['anchor-pair-segment'].visible, false);
  layer.update(runtime, { partIds: new Set(['arm']) });
  assert.equal(objects['parent-anchor'].visible, false);
  assert.equal(objects['child-anchor'].visible, true);
  assert.equal(layer.group.userData.pointCount, 1);
  layer.update(runtime, { partIds: [] });
  assert.equal(pair.visible, false);
  assert.equal(layer.group.userData.pointCount, 0);
  layer.update(runtime, { visible: false });
  assert.equal(layer.group.visible, false);
  layer.setVisible(true);
  assert.equal(layer.group.visible, true);
  assert.equal(layer.group.children[0], pair);
  layer.dispose();
});

test('obsolete pairs and disposal release owned resources exactly once without touching scene meshes', () => {
  const scene = new THREE.Scene(), model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(model);
  let modelDisposals = 0;
  model.geometry.addEventListener('dispose', () => { modelDisposals += 1; });
  const layer = createAnchorLayer(scene, toWorld), runtime = runtimeFor();
  layer.update(runtime);
  const objects = members(layer.group.children[0]);
  let lineDisposals = 0, sphereDisposals = 0;
  objects['anchor-pair-segment'].geometry.addEventListener('dispose', () => { lineDisposals += 1; });
  objects['parent-anchor'].geometry.addEventListener('dispose', () => { sphereDisposals += 1; });
  layer.update({ nodes: runtime.nodes, edges: [] });
  assert.equal(layer.group.children.length, 0);
  assert.equal(lineDisposals, 1);
  assert.equal(sphereDisposals, 0, 'shared sphere geometry remains reusable until the layer is disposed');
  layer.dispose(); layer.dispose(); layer.update(runtime);
  assert.equal(sphereDisposals, 1);
  assert.equal(lineDisposals, 1);
  assert.equal(layer.group.parent, null);
  assert.equal(model.parent, scene);
  assert.equal(modelDisposals, 0);
});
