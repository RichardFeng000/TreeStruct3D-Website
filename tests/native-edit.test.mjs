import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createNativeEditor } from '../public/explorer/native-edit.js';
import { readGLB } from './helpers/read-glb.mjs';

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const binary = async (path, compressed = false) => {
  const raw = await readFile(new URL(path, root));
  const bytes = compressed ? gunzipSync(raw) : raw;
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
};

async function loadCase(id) {
  const base = `public/explorer/data/${id}`;
  const response = await json(`${base}/native/native-edit.json`);
  const snapshot = await json(response.baseline ? `${base}/native/${response.baseline.snapshot}` : `${base}/edits/default/snapshot.json`);
  const buffer = await binary(`${base}/native/${response.binary}`, response.compression === 'gzip');
  const truth = await json(`tests/fixtures/native/${id}/validation.json`);
  const truthBuffer = await binary(`tests/fixtures/native/${id}/validation.bin`);
  const glb = response.baseline ? `${base}/native/${response.baseline.glb}` : `${base}/edits/default/model.glb`;
  const { root: model } = readGLB(await readFile(new URL(glb, root)));
  const editor = createNativeEditor({ model, runtime: snapshot.runtime, provenance: snapshot.provenance, response, buffer });
  return { id, model, editor, snapshot, response, buffer, truth, truthBuffer };
}

// Compare the final rendered mesh positions to independently executed Blender
// holdouts. This does not assume identical vertex order in either exporter.
function assertNativeGeometry(fixture, sample) {
  const { model, snapshot, truthBuffer } = fixture;
  const tolerance = Math.max(1e-5, snapshot.runtime.scene_extent * 1e-4);
  const translation = snapshot.provenance.runtime_to_glb_translation;
  const maps = new Map();
  for (const part of sample.parts) {
    const values = truthBuffer.subarray(part.positions.offset, part.positions.offset + part.positions.count);
    const map = new Map();
    for (let i = 0; i < values.length; i += 3) {
      const cell = [0, 1, 2].map((axis) => Math.floor(values[i + axis] / tolerance)).join(',');
      if (!map.has(cell)) map.set(cell, []);
      map.get(cell).push(values.subarray(i, i + 3));
    }
    maps.set(THREE.PropertyBinding.sanitizeNodeName(part.id), map);
  }
  model.updateWorldMatrix(true, true);
  const rootInverse = model.matrixWorld.clone().invert();
  let vertices = 0, maximumError = 0;
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let owner = mesh;
    while (owner && !maps.has(owner.name)) owner = owner.parent;
    assert.ok(owner, `${fixture.id}: missing part identity`);
    const map = maps.get(owner.name);
    const positions = mesh.geometry.getAttribute('position');
    const transform = rootInverse.clone().multiply(mesh.matrixWorld);
    const vector = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      vector.fromBufferAttribute(positions, i).applyMatrix4(transform);
      const point = [vector.x - translation[0], -(vector.z - translation[2]), vector.y - translation[1]];
      const cell = point.map((value) => Math.floor(value / tolerance));
      let distance = Infinity;
      for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
        for (const candidate of map.get([cell[0] + x, cell[1] + y, cell[2] + z].join(',')) || []) {
          distance = Math.min(distance, Math.hypot(...point.map((value, axis) => value - candidate[axis])));
        }
      }
      assert.ok(distance <= tolerance, `${fixture.id}/${sample.id}/${owner.name}: vertex ${i} differs from Blender by ${distance}, tolerance ${tolerance}`);
      maximumError = Math.max(maximumError, distance);
      vertices += 1;
    }
  });
  return { vertices, maximumError };
}

test('Spiny Lobster browser geometry matches native Blender single and simultaneous parameter rebuilds', async () => {
  const fixture = await loadCase('paper-gpt-5-6-sol-spiny-lobster');
  const { editor, truth, snapshot, buffer, response } = fixture;
  assert.equal(truth.source_sha256, snapshot.provenance.source_sha256);
  assert.equal(createHash('sha256').update(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)).digest('hex'), response.binary_sha256);
  const original = JSON.stringify(snapshot);
  let count = 0, maximumError = 0;
  for (const sample of truth.samples) {
    editor.resetAll();
    const edits = Object.fromEntries(editor.parts.map((part) => [part.id, sample.params[part.parameter_id] || 1]));
    editor.setScales(edits);
    const result = assertNativeGeometry(fixture, sample);
    count += result.vertices;
    maximumError = Math.max(maximumError, result.maximumError);
    const runtime = editor.getRuntime();
    assert.equal(runtime.validation_status, 'not_run');
    assert.ok(runtime.edges.every((edge) => edge.shared_anchor === false && edge.anchor_gap === null));
    for (const anchor of sample.anchors || []) {
      const declarations = runtime.edges.flatMap((edge) => edge.declared_directions || []).filter((item) => item.parent === anchor.parent && item.child === anchor.child && item.parent_anchor_world);
      assert.ok(declarations.some((item) => Math.hypot(...item.parent_anchor_world.map((value, axis) => value - anchor.parent_world[axis])) < 1e-5
        && Math.hypot(...item.child_anchor_world.map((value, axis) => value - anchor.child_world[axis])) < 1e-5), `${sample.id}: native anchor pair`);
    }
  }
  assert.equal(truth.samples.length, 14);
  assert.ok(count > 50000);
  assert.ok(maximumError < 1e-5, `Spiny Lobster maximum error: ${maximumError}`);
  editor.resetAll();
  assert.deepEqual(editor.getRuntime(), snapshot.runtime);
  assert.equal(JSON.stringify(snapshot), original);
  editor.dispose();
});

const catalog = await json('public/explorer/data/manifest.json');
for (const example of catalog.models) {
  test(`${example.title} (${example.provider}) rendered vertices agree with independent native holdouts`, async () => {
    const fixture = await loadCase(example.id);
    const { editor, truth, snapshot } = fixture;
    assert.equal(truth.source_sha256, snapshot.provenance.source_sha256);
    assert.ok(truth.samples.some((sample) => Object.keys(sample.params).length > 1), 'Multi-parameter native holdouts are required');
    for (const sample of truth.samples) {
      editor.resetAll();
      editor.setScales(Object.fromEntries(editor.parts.map((part) => [part.id, sample.params[part.parameter_id] || 1])));
      assertNativeGeometry(fixture, sample);
    }
    editor.resetAll();
    assert.deepEqual(editor.getRuntime(), snapshot.runtime);
    editor.dispose();
    fixture.model.traverse((mesh) => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
  });
}
