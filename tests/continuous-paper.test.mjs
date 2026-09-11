import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createContinuousEditor } from '../public/explorer/continuous-edit.js';

const data = new URL('../public/explorer/data/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, data), 'utf8'));
const catalog = await json('manifest.json');

// Reconstruct the actual exported vertex buffers and node transforms without
// browser image decoding. Materials do not affect these geometric assertions.
function readScene(bytes) {
  const jsonSize = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize));
  const binary = bytes.subarray(20 + jsonSize + 8);
  const objects = document.nodes.map((node) => {
    const pieces = (document.meshes?.[node.mesh]?.primitives || []).map((primitive) => {
      const accessor = document.accessors[primitive.attributes.POSITION];
      const view = document.bufferViews[accessor.bufferView];
      const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
      const positions = new Float32Array(accessor.count * 3);
      for (let i = 0; i < accessor.count; i += 1) {
        for (let axis = 0; axis < 3; axis += 1) positions[i * 3 + axis] = binary.readFloatLE(offset + i * (view.byteStride || 12) + axis * 4);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    });
    const object = pieces.length === 1 ? pieces[0] : new THREE.Group();
    if (pieces.length > 1) object.add(...pieces);
    object.name = node.name || '';
    object.userData = { ...node.extras };
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      object.position.fromArray(node.translation || [0, 0, 0]);
      object.quaternion.fromArray(node.rotation || [0, 0, 0, 1]);
      object.scale.fromArray(node.scale || [1, 1, 1]);
    }
    return object;
  });
  document.nodes.forEach((node, index) => (node.children || []).forEach((child) => objects[index].add(objects[child])));
  const root = new THREE.Group();
  document.scenes[document.scene || 0].nodes.forEach((index) => root.add(objects[index]));
  root.updateMatrixWorld(true);
  return root;
}

function partDimensions(root, id, nodeIds) {
  const object = root.getObjectByName(id);
  assert.ok(object, id);
  const box = new THREE.Box3();
  function visit(part) {
    if (part !== object && nodeIds.has(part.name)) return;
    if (part.isMesh) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld));
    }
    part.children.forEach(visit);
  }
  visit(object);
  return box.getSize(new THREE.Vector3()).toArray();
}

test('every observed part in all twenty real paper GLBs can be continuously resized and exactly reset', async () => {
  let parts = 0;
  for (const example of catalog.models) {
    const snapshot = await json(example.snapshot);
    const unchanged = JSON.stringify(snapshot);
    const root = readScene(await readFile(new URL(example.glb, data)));
    const ids = new Set(snapshot.runtime.nodes.map((node) => node.id));
    const baseline = new Map([...ids].map((id) => [id, partDimensions(root, id, ids)]));
    const editor = createContinuousEditor(root, snapshot.runtime, snapshot.provenance);
    assert.deepEqual(new Set(editor.parts.map((part) => part.id)), ids, example.id);
    for (const part of editor.parts) {
      for (const scale of [0.63, 1.37]) {
        editor.setScale(part.id, scale);
        assert.equal(editor.getScale(part.id), scale);
        root.updateMatrixWorld(true);
        const dimensions = partDimensions(root, part.id, ids);
        dimensions.forEach((value, axis) => assert.ok(Math.abs(value - baseline.get(part.id)[axis] * scale) < 1e-4, `${example.id}/${part.id}/${scale}: own mesh size`));
      }
      editor.resetPart(part.id);
      parts += 1;
    }
    // Independent edits remain combined instead of silently clearing the first.
    const [first, second] = editor.parts;
    editor.setScale(first.id, 0.63);
    editor.setScale(second.id, 1.37);
    assert.equal(editor.getScale(first.id), 0.63);
    assert.equal(editor.getScale(second.id), 1.37);
    const preview = editor.getRuntime();
    assert.equal(preview.preview_only, true);
    assert.equal(preview.validation_status, 'not_run');
    for (const edge of preview.edges) {
      assert.notEqual(edge.shared_anchor, true);
      assert.notEqual(edge.contact, true);
      assert.notEqual(edge.authored_anchor_valid, true);
    }
    editor.resetAll();
    assert.equal(editor.hasEdits(), false);
    assert.deepEqual(editor.getRuntime(), snapshot.runtime);
    root.updateMatrixWorld(true);
    for (const id of ids) partDimensions(root, id, ids).forEach((value, axis) => assert.ok(Math.abs(value - baseline.get(id)[axis]) < 1e-8, `${example.id}/${id}: reset drift`));
    assert.equal(JSON.stringify(snapshot), unchanged, 'Saved checks must remain immutable');
    root.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  }
  assert.ok(parts > 200, `Expected the full paper part set, got ${parts}`);
});
