import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { validateNativeResponse } from '../public/explorer/native-response-validation.js';
import { createNativeEditor } from '../public/explorer/native-edit.js';
import { readGLB } from './helpers/read-glb.mjs';

const base = new URL('../public/explorer/data/paper-gpt-5-6-sol-spiny-lobster/native/', import.meta.url);
const response = JSON.parse(await readFile(new URL('native-edit.json', base), 'utf8'));
const bytes = await readFile(new URL('native-edit.bin', base));
const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
const clone = () => structuredClone(response);

test('native response validation accepts the real complete dataset and rejects a truncated tail before editing', () => {
  assert.equal(validateNativeResponse(response, floats), response);
  const baseEnd = Math.max(...response.parts.map((part) => part.positions.offset + part.positions.count));
  assert.ok(baseEnd < floats.length);
  assert.throws(() => validateNativeResponse(response, floats.subarray(0, baseEnd)), /geometry buffer/);
  const nonfinite = floats.slice();
  nonfinite[nonfinite.length - 1] = NaN;
  assert.throws(() => validateNativeResponse(response, nonfinite), /nonfinite geometry/);
});

test('native response validation rejects unusable control, geometry and anchor descriptors', () => {
  const changes = [
    (data) => { data.version = 2; },
    (data) => { data.coordinate_system = 'gltf_y_up'; },
    (data) => { data.compression = 'unknown'; },
    (data) => { data.parts[1].id = data.parts[0].id; },
    (data) => { data.parts[0].positions.count -= 1; },
    (data) => { data.controls[0].samples = []; },
    (data) => { data.controls[0].samples[0].parts[0].id = 'missing-part'; },
    (data) => { data.controls[0].samples[0].parts[0].delta.count -= 3; },
    (data) => { data.controls[0].samples[0].anchors.count -= 1; },
    (data) => { data.anchors[0].parent_world[1] = Infinity; },
    (data) => { data.anchors[0].child = 'missing-part'; },
  ];
  for (const modify of changes) {
    const data = clone(); modify(data);
    assert.throws(() => validateNativeResponse(data, floats), /Invalid native edit data/);
  }
});

test('mixed response descriptors are validated before their first use', () => {
  const data = clone();
  const knots = [0.4, 1, 1.6];
  data.interactions = [{ ids: data.controls.slice(0, 2).map((control) => control.id), knots: [knots, knots],
    samples: knots.flatMap((a) => knots.map((b) => ({ scales: [a, b], parts: [] }))) }];
  assert.equal(validateNativeResponse(data, floats), data);
  data.interactions[0].samples.pop();
  assert.throws(() => validateNativeResponse(data, floats), /missing a knot combination/);
  delete data.interactions;
  data.extra_geometry = { weights: { offset: floats.length, count: 3 } };
  assert.throws(() => validateNativeResponse(data, floats), /geometry buffer/);
});

function smallResponse() {
  return {
    version: 1, coordinate_system: 'blender_z_up',
    parts: [{ id: 'part', positions: { offset: 0, count: 9 } }],
    controls: ['shape', 'parent'].map((id) => ({ id, samples: [0.4, 1, 1.6].map((scale) => ({ scale, parts: [] })) })),
    anchors: [],
  };
}

function proceduralFixture() {
  const response = smallResponse();
  const weights = { offset: 9, count: 84 * 3 };
  const indices = { offset: 9 + weights.count, count: 121 * 121 };
  const buffer = new Float32Array(indices.offset + indices.count);
  for (let row = 0; row < 3; row += 1) buffer[weights.offset + row * 84] = 1;
  response.procedural = [{ type: 'chameleon_limb', id: 'part', torso_control: 'parent', limb_control: 'shape',
    side: 'left', is_hind: false, coarse_count: 84, vertex_count: 3, weights, snap_indices: indices,
    snap_scales: { min: 0.4, step: 0.01, count: 121 } }];
  return { response, buffer };
}

function replacementFixture() {
  const response = smallResponse();
  const buffer = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, ...Array(3).fill([0, 0, 1]).flat(), 0, 1, 2, 0]);
  response.replacements = [{ id: 'part', control: 'shape', material_names: ['bark'],
    samples: Array.from({ length: 121 }, (_unused, i) => ({ scale: (40 + i) / 100,
      positions: { offset: 0, count: 9 }, normals: { offset: 9, count: 9 },
      triangles: { offset: 18, count: 3 }, materials: { offset: 21, count: 1 } })),
    translation_controls: [{ id: 'parent', samples: [0.4, 1, 1.6].map((scale) => ({ scale, delta: [0, 0, scale - 1] })) }],
  }];
  return { response, buffer };
}

test('procedural validation rejects unsupported generators, invalid references, dimensions, weights and snap choices', () => {
  const valid = proceduralFixture();
  assert.equal(validateNativeResponse(valid.response, valid.buffer), valid.response);
  const invalid = [
    (r) => { r.procedural[0].type = 'unknown_generator'; },
    (r) => { r.procedural[0].id = 'missing'; },
    (r) => { r.procedural[0].limb_control = 'missing'; },
    (r) => { r.procedural[0].side = 'both'; },
    (r) => { r.procedural[0].is_hind = 'false'; },
    (r) => { r.procedural[0].coarse_count = 83; },
    (r) => { r.procedural[0].vertex_count = 4; },
    (r) => { r.procedural[0].weights.count -= 1; },
    (r) => { r.procedural[0].snap_scales.step = 0.1; },
    (r) => { r.procedural[0].snap_indices.count -= 1; },
    (r, b) => { b[r.procedural[0].snap_indices.offset] = 0.5; },
    (r, b) => { b[r.procedural[0].snap_indices.offset] = 84; },
    (r, b) => { b[r.procedural[0].weights.offset] = 0; },
    (r, b) => { b[r.procedural[0].weights.offset] = -1; },
  ];
  for (const mutate of invalid) {
    const { response, buffer } = proceduralFixture(); mutate(response, buffer);
    assert.throws(() => validateNativeResponse(response, buffer), /Invalid native edit data/);
  }
});

test('replacement validation checks every exact state, triangle vertex/material index and parent translation', () => {
  const valid = replacementFixture();
  assert.equal(validateNativeResponse(valid.response, valid.buffer), valid.response);
  const invalid = [
    (r) => { r.replacements[0].id = 'missing'; },
    (r) => { r.replacements[0].control = 'missing'; },
    (r) => { r.replacements[0].material_names = ['bark', 'bark']; },
    (r) => { r.replacements[0].samples.pop(); },
    (r) => { r.replacements[0].samples[1].scale = 0.401; },
    (r) => { r.replacements[0].samples[1].scale = 0.4; },
    (r) => { r.replacements[0].samples[0].normals.count = 6; },
    (r) => { r.replacements[0].samples[0].triangles.count = 2; },
    (r) => { r.replacements[0].samples[0].materials.count = 2; },
    (_r, b) => { b[18] = 3; },
    (_r, b) => { b[18] = -1; },
    (_r, b) => { b[18] = 0.5; },
    (_r, b) => { b[21] = 1; },
    (r) => { r.replacements[0].translation_controls[0].id = 'missing'; },
    (r) => { r.replacements[0].translation_controls[0].samples[0].delta = [0, 0]; },
    (r) => { r.replacements[0].translation_controls[0].samples.pop(); },
  ];
  for (const mutate of invalid) {
    const { response, buffer } = replacementFixture(); mutate(response, buffer);
    assert.throws(() => validateNativeResponse(response, buffer), /Invalid native edit data/);
  }
});

test('ratio validation rejects unsupported ranges, duplicate ratios and unusable residuals', () => {
  const make = () => {
    const response = smallResponse();
    response.ratio_interactions = [{ numerator_control: 'shape', denominator_control: 'parent',
      samples: [0.25, 1, 4].map((ratio) => ({ ratio, parts: [{ id: 'part', delta: { offset: 0, count: 9 } }] })) }];
    return response;
  };
  const buffer = new Float32Array(9);
  const valid = make(); assert.equal(validateNativeResponse(valid, buffer), valid);
  for (const mutate of [
    (r) => { r.ratio_interactions[0].denominator_control = 'missing'; },
    (r) => { r.ratio_interactions[0].denominator_control = 'shape'; },
    (r) => { r.ratio_interactions[0].samples[0].ratio = 0.4; },
    (r) => { r.ratio_interactions[0].samples[2].ratio = 1.6; },
    (r) => { r.ratio_interactions[0].samples[1].ratio = 0.25; },
    (r) => { r.ratio_interactions[0].samples[0].parts[0].delta.count = 6; },
    (r) => { r.ratio_interactions.push(structuredClone(r.ratio_interactions[0])); },
    (r) => { r.ratio_interactions = {}; },
  ]) {
    const response = make(); mutate(response);
    assert.throws(() => validateNativeResponse(response, buffer), /Invalid native edit data/);
  }
});

test('the actual Chameleon procedural fields and compressed Hollow Tree replacement pass semantic validation', async () => {
  for (const id of ['paper-gemini-3-5-flash-chameleon', 'paper-gpt-5-5-hollow-tree']) {
    const base = new URL(`../public/explorer/data/${id}/native/`, import.meta.url);
    const response = JSON.parse(await readFile(new URL('native-edit.json', base), 'utf8'));
    const raw = await readFile(new URL(response.binary, base));
    const bytes = response.compression === 'gzip' ? gunzipSync(raw) : raw;
    const buffer = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    assert.equal(validateNativeResponse(response, buffer), response);
  }
});

test('invalid extension data and failed native vertex binding leave every original model resource intact', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../edits/default/snapshot.json', base), 'utf8'));
  const glb = await readFile(new URL('../edits/default/model.glb', base));
  const cases = [
    { response: { ...response, procedural: [{ id: response.parts[0].id, type: 'unsupported' }] }, buffer: floats },
    { response: { ...response, replacements: [{ id: response.parts[0].id, control: response.controls[0].id, samples: [] }] }, buffer: floats },
    { response: { ...response, ratio_interactions: [{ numerator_control: 'missing', denominator_control: 'missing', samples: [] }] }, buffer: floats },
  ];
  const wrongGeometry = floats.slice();
  const part = response.parts[0].positions;
  for (let i = part.offset; i < part.offset + part.count; i += 3) wrongGeometry[i] += 1000;
  cases.push({ response, buffer: wrongGeometry });
  for (const data of cases) {
    const { root: model } = readGLB(glb);
    const originals = [];
    let disposals = 0;
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      originals.push({ mesh, geometry: mesh.geometry, material: mesh.material });
      mesh.geometry.addEventListener('dispose', () => { disposals += 1; });
    });
    assert.throws(() => createNativeEditor({ model, runtime: snapshot.runtime, provenance: snapshot.provenance, ...data }), /Invalid native edit data|Native geometry does not match/);
    for (const original of originals) {
      assert.equal(original.mesh.geometry, original.geometry);
      assert.equal(original.mesh.material, original.material);
    }
    assert.equal(disposals, 0);
  }
});
