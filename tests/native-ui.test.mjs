import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createContinuousEditor } from '../public/explorer/continuous-edit.js';
import { createNativeEditor } from '../public/explorer/native-edit.js';
import { validateNativeResponse } from '../public/explorer/native-response-validation.js';
import { createAnchorLayer } from '../public/explorer/anchor-layer.js';
import { hasPaperComparison, invalidatePreviewChecks, paperComparisonPair, paperPreset, providerLabel, stateLabel } from '../public/explorer/edit-state.js';
import { escapeHtml, snapshotCounts, validateSnapshot } from '../public/explorer/data-utils.js';
import { readGLB } from './helpers/read-glb.mjs';

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const text = async (path) => readFile(new URL(path, root), 'utf8');
const script = await text('public/explorer/inspector.js');
const html = await text('public/explorer/index.html');
const syntax = ts.createSourceFile('inspector.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = (source, name) => {
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return new Map(tree.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(tree)]));
};
const functions = declarations(script, 'inspector.js');
const uiHelpers = declarations(await text('tests/continuous-ui.test.mjs'), 'ui-test.js');
const geometryHelpers = declarations(await text('tests/native-edit.test.mjs'), 'native-test.js');

// Reuse the existing fake browser surface, then install a real textured GLB and
// native response dataset. Every control event still calls the shipped code.
async function fixture(id = 'paper-gpt-5-6-sol-spiny-lobster') {
  const helper = vm.createContext({ assert, THREE, vm, functions, syntax, html, structuredClone, URL,
    createContinuousEditor, createAnchorLayer, hasPaperComparison, invalidatePreviewChecks,
    paperComparisonPair, paperPreset, providerLabel, stateLabel, escapeHtml, snapshotCounts });
  vm.runInContext(uiHelpers.get('element'), helper);
  vm.runInContext(uiHelpers.get('fixture'), helper);
  const f = helper.fixture();
  f.editor.dispose(); f.anchors.dispose();
  const path = `public/explorer/data/${id}`;
  const snapshot = await json(`${path}/edits/default/snapshot.json`);
  const response = await json(`${path}/native/native-edit.json`);
  const bytes = await readFile(new URL(`${path}/native/native-edit.bin`, root));
  const buffer = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const truth = await json(`tests/fixtures/native/${id}/validation.json`);
  const truthBytes = await readFile(new URL(`tests/fixtures/native/${id}/validation.bin`, root));
  const truthBuffer = new Float32Array(truthBytes.buffer, truthBytes.byteOffset, truthBytes.length / 4);
  const glbBytes = await readFile(new URL(`${path}/edits/default/model.glb`, root));
  const { root: model } = readGLB(glbBytes);
  const editor = createNativeEditor({ model, runtime: snapshot.runtime, provenance: snapshot.provenance, response, buffer });
  const anchors = createAnchorLayer(new THREE.Scene(), (point) => editor.runtimePointToWorld(point));
  const c = f.context;
  c.continuousEditor = editor; c.currentModel = model; c.modelAnchors = anchors;
  c.activeSnapshot = snapshot; c.activeExample.title = 'Spiny Lobster';
  c.schema = snapshot.schema;
  c.structureData = { views: { anchors: structuredClone(snapshot.runtime), parts: structuredClone(snapshot.runtime) } };
  c.graphState.selected = null; c.graphState.query = ''; c.graphState.anchorMode = 'shared';
  c.editTargetId = snapshot.runtime.roots[0];
  c.updateEditControls(); c.updateModelAnchors();
  const check = vm.createContext({ assert, THREE });
  vm.runInContext(geometryHelpers.get('assertNativeGeometry'), check);
  const real = { id, model, editor, snapshot, response, buffer, truth, truthBuffer };
  return { ...f, ...real, anchors, makeElement: helper.element, glbBytes,
    check: (sample) => check.assertNativeGeometry(real, sample) };
}

test('real native UI number/range events match Blender at 0.63 and 1.37 while preserving view and selected-only anchors', async () => {
  const f = await fixture(), c = f.context;
  const id = 'cephalothorax_shell';
  assert.equal(f.anchors.group.visible, false);
  f.click(id, 'select');
  assert.equal(f.anchors.group.visible, true);
  const visibleEndpoints = () => f.anchors.group.children.flatMap((pair) => pair.children.filter((child) => child.visible && child.userData.anchorEndpoint));
  assert.ok(visibleEndpoints().length);
  assert.ok(visibleEndpoints().every((point) => point.userData.anchorEndpoint.partId === id));
  for (const value of ['0', '0.', '0.6', '0.63']) {
    f.input(id, 'number', value); f.flushFrame();
    assert.equal(f.row(id).number.value, value, 'native graph refresh must preserve an in-progress decimal');
  }
  f.change(id, 'number');
  assert.equal(f.editor.getScale(id), 0.63);
  assert.ok(f.check(f.truth.samples.find((sample) => sample.id === `${id}-0.63`)).maximumError < 1e-5);
  const firstAnchor = visibleEndpoints()[0];
  const firstPosition = firstAnchor.position.clone();
  f.input(id, 'range', 1.37); f.flushFrame(); f.change(id, 'range');
  assert.equal(f.editor.getScale(id), 1.37);
  assert.ok(f.check(f.truth.samples.find((sample) => sample.id === `${id}-1.37`)).maximumError < 1e-5);
  assert.ok(firstAnchor.position.distanceTo(firstPosition) > 0.01, 'visible native endpoint follows the actual parameter rebuild');
  assert.equal(c.graphState.selected, id);
  assert.equal(c.graphState.anchorMode, 'shared');
  assert.deepEqual(c.camera.position.toArray(), [9, 5, 7]);
  assert.deepEqual(c.tree3dCamera.position.toArray(), [3, 8, 4]);
  assert.equal(c.structureData.views.anchors.validation_status, 'not_run');
  assert.ok(c.structureData.views.anchors.edges.every((edge) => edge.shared_anchor === false));
  c.displayOptions.anchors = false; c.applyDisplayOptions();
  f.input(id, 'number', 0.63); f.flushFrame();
  assert.equal(f.anchors.group.visible, false, 'editing cannot re-enable an explicitly hidden anchor layer');
  c.displayOptions.anchors = true; c.applyDisplayOptions();
  c.clearPreviewPartHighlight();
  assert.equal(f.anchors.group.visible, false);
  assert.equal(f.networkRequests.length, 0);
  assert.ok(f.statuses.every((status) => status.kind !== 'error'));
  f.editor.dispose(); f.anchors.dispose();
});

test('native UI batches real multi-part edits and resets without changing the independent paper preset', async () => {
  const f = await fixture(), c = f.context;
  const sample = f.truth.samples.find((item) => item.id === 'multi-0');
  c.comparisonPreset.value = 'child-0.4';
  for (const [id, value] of Object.entries(sample.params)) f.input(id, 'range', value);
  assert.equal(f.frames.size, 1);
  f.flushFrame();
  assert.ok(f.check(sample).maximumError < 1e-5);
  c.comparisonToggle.emit('click');
  assert.equal(f.imageRequests.length, 2);
  assert.ok(f.imageRequests.every((image) => image.url.includes('child-0.4')));
  for (const image of f.imageRequests) image.onload();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(c.comparisonPreset.value, 'child-0.4');
  for (const [id, value] of Object.entries(sample.params)) assert.equal(f.editor.getScale(id), value);
  f.click('cephalothorax_shell', 'reset');
  assert.equal(f.editor.getScale('cephalothorax_shell'), 1);
  assert.equal(f.editor.getScale('long_antenna'), 1.37);
  c.editResetAll.emit('click');
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.editor.getRuntime(), f.snapshot.runtime);
  assert.equal(c.comparisonPreset.value, 'child-0.4');
  f.editor.dispose(); f.anchors.dispose();
});

test('linked native controls coalesce the last input and reset in one animation frame', () => {
  const context = vm.createContext({ editTargetId: 'left', previewFrame: null, queuedScales: new Map(),
    continuousEditor: { parts: [{ id: 'left', parameter_id: 'leg' }, { id: 'right', parameter_id: 'leg' }, { id: 'body', parameter_id: 'body' }] },
    requestAnimationFrame: () => 1, applyContinuousPreview() {} });
  vm.runInContext(functions.get('queueContinuousScale'), context);
  context.queueContinuousScale(0.63, 'left');
  context.queueContinuousScale(1.37, 'right');
  context.queueContinuousScale(0.8, 'body');
  context.queueContinuousScale(1, 'left');
  assert.deepEqual([...context.queuedScales], [['body', 0.8], ['left', 1]], 'reset/latest input must supersede any alias of the same source parameter');
});

test('real shared native parameter rows agree after repeated alias edits and resetting another instance', async () => {
  const f = await fixture('paper-gemini-3-1-pro-bed-frame'), c = f.context;
  const shared = f.editor.parts.find((part) => f.editor.parts.some((other) => other.id !== part.id && other.parameter_id === part.parameter_id));
  assert.ok(shared, 'This real source has several observed instances driven by one parameter');
  const aliases = f.editor.parts.filter((part) => part.parameter_id === shared.parameter_id);
  const [a, b] = aliases;
  f.input(a.id, 'range', 0.63); f.input(b.id, 'number', 1.37); f.input(a.id, 'range', 0.8);
  f.flushFrame();
  for (const part of aliases) assert.equal(f.editor.getScale(part.id), 0.8);
  f.input(a.id, 'range', 0.63); f.input(b.id, 'range', 1.37);
  f.click(a.id, 'reset');
  assert.equal(f.frames.size, 0);
  for (const part of aliases) {
    assert.equal(f.editor.getScale(part.id), 1);
    assert.equal(f.row(part.id).range.value, '1');
  }
  assert.ok(f.statuses.every((status) => status.kind !== 'error'));
  c.clearPreviewPartHighlight();
  assert.equal(f.anchors.group.visible, false);
  f.editor.dispose(); f.anchors.dispose();
});

test('native loading rejects corrupt cached data, Retry refetches it, and late responses cannot replace a newer case', async () => {
  const f = await fixture(), c = f.context;
  let bad = true, binaryRequests = 0, retry;
  const disposed = [];
  Object.assign(c, {
    sourceSelect: f.makeElement(), modelSelect: f.makeElement(), graphEdges: f.makeElement(),
    graphNodes: f.makeElement(), anchorRelations: f.makeElement(),
    scene: new THREE.Scene(), generationVersion: 0, pendingViewState: null,
    nativeResponseCache: new Map(), snapshotCache: new Map([['snapshot.json', f.snapshot]]),
    createNativeEditor, createContinuousEditor, validateNativeResponse, validateSnapshot, Float32Array,
    updateModelNavigationButtons() {}, clearTree3DScene() {}, setLoading() {},
    fitCamera() {}, updateGraphTabs() {}, rememberSelection() {}, providerKey: () => 'test-provider',
    showExampleError(error, callback) { retry = callback; c.setStatus(error.message, 'error'); },
    disposeObject(model) { disposed.push(model); },
    installGLB(gltf) { c.currentModel = gltf.scene; c.scene.add(gltf.scene); },
    initializeGraph(structure) { c.structureData = structure; },
    loader: { async loadAsync() { return { scene: readGLB(f.glbBytes).root }; } },
    async fetch(url) {
      if (String(url).endsWith('native.json')) return { ok: true, json: async () => structuredClone(f.response) };
      if (String(url).endsWith('native.bin')) {
        binaryRequests += 1;
        const values = bad ? f.buffer.subarray(0, Math.max(...f.response.parts.map((part) => part.positions.offset + part.positions.count))) : f.buffer;
        return { ok: true, arrayBuffer: async () => values.slice().buffer };
      }
      if (String(url).endsWith('mesh.json')) return { ok: true, json: async () => [] };
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  for (const name of ['readExampleJson', 'readNativeResponse', 'loadSavedState']) vm.runInContext(functions.get(name), c);
  const example = { ...c.activeExample, id: 'native-load-test', native_edit: { response: 'native.json', buffer: 'native.bin' } };
  const variant = { id: 'default', scale: 1, glb: 'model.glb', snapshot: 'snapshot.json', mesh_map: 'mesh.json' };
  f.click('cephalothorax_shell', 'select');
  assert.equal(f.anchors.group.visible, true);
  const pending = c.loadSavedState(example, variant);
  assert.equal(c.currentModel, null, 'the old model is removed before the new label can become active');
  assert.equal(c.activeExample, null);
  assert.equal(f.anchors.group.visible, false);
  await pending;
  assert.equal(c.currentModel, null);
  assert.equal(c.activeExample, null);
  assert.equal(c.continuousEditor, null);
  assert.equal(c.nativeResponseCache.size, 0, 'invalid HTTP 200 native data must not survive in the cache');
  assert.equal(c.editState.dataset.state, 'error');
  assert.equal(disposed.length, 2, 'the previous model and the rejected arriving GLB are disposed');
  assert.equal(typeof retry, 'function');
  bad = false;
  await retry();
  assert.equal(binaryRequests, 2, 'Retry obtains fresh bytes instead of the rejected cached buffer');
  assert.equal(c.activeExample.id, example.id);
  assert.ok(c.currentModel && c.continuousEditor.native);
  assert.equal(c.editState.dataset.state, 'ready');
  assert.equal(f.anchors.group.visible, false);
  const fetchReady = c.fetch;
  let finishSlow;
  c.fetch = async (url) => String(url).endsWith('slow-native.bin')
    ? { ok: true, arrayBuffer: () => new Promise((resolve) => { finishSlow = resolve; }) }
    : fetchReady(url);
  const slow = { ...example, id: 'slow-case', title: 'Slow case', native_edit: { response: 'slow-native.json', buffer: 'slow-native.bin' } };
  const slowRequest = c.loadSavedState(slow, variant);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(typeof finishSlow, 'function');
  const newer = { ...example, id: 'newer-case', title: 'Newer case' };
  await c.loadSavedState(newer, variant);
  const visibleModel = c.currentModel;
  assert.equal(c.activeExample.id, newer.id);
  finishSlow(f.buffer.slice().buffer);
  await slowRequest;
  assert.equal(c.currentModel, visibleModel);
  assert.equal(c.activeExample.id, newer.id);
  assert.equal(c.panelTitle.textContent, 'Newer case');
  assert.ok(!disposed.includes(visibleModel), 'only the obsolete arriving GLB is disposed');
  c.continuousEditor.dispose(); f.anchors.dispose();
});

test('the shipped native reader decompresses gzip, validates decoded floats and caches only a successful decoded response', async () => {
  const path = 'public/explorer/data/paper-gpt-5-6-sol-spiny-lobster/native/';
  const header = { ...await json(`${path}native-edit.json`), compression: 'gzip', binary: 'native-edit.bin.gz' };
  const original = await readFile(new URL(`${path}native-edit.bin`, root));
  const compressed = gzipSync(original);
  let corrupt = true, alreadyDecoded = false, jsonRequests = 0, bufferRequests = 0, validations = 0;
  const context = vm.createContext({ Blob, Response, DecompressionStream, Float32Array,
    nativeResponseCache: new Map(), dataRoot: new URL('https://example.test/treeStruct3D/explorer/data/'),
    assetUrl: (path, root) => new URL(path, root).href,
    async readExampleJson() { jsonRequests += 1; return structuredClone(header); },
    async fetch() {
      bufferRequests += 1;
      const bytes = corrupt ? compressed.subarray(0, Math.floor(compressed.length / 2)) : alreadyDecoded ? original : compressed;
      return new Response(bytes, { status: 200, headers: alreadyDecoded ? { 'Content-Encoding': 'gzip' } : {} });
    },
    validateNativeResponse(response, floats) {
      validations += 1;
      return validateNativeResponse(response, floats);
    },
  });
  vm.runInContext(functions.get('readNativeResponse'), context);
  const example = { native_edit: { response: 'example/native-edit.json', buffer: 'example/native-edit.bin.gz' } };
  await assert.rejects(context.readNativeResponse(example));
  assert.equal(context.nativeResponseCache.size, 0, 'a gzip transport failure must not poison Retry');
  assert.equal(validations, 0, 'truncated compressed bytes never reach the float validator');
  corrupt = false;
  const [first, concurrent] = await Promise.all([context.readNativeResponse(example), context.readNativeResponse(example)]);
  assert.equal(first, concurrent, 'concurrent loads share the decoded response');
  assert.deepEqual(Buffer.from(first.buffer), original, 'the editor receives exact decompressed native bytes');
  assert.equal(first.response.compression, 'gzip');
  assert.equal(validations, 1, 'decoded values are validated before the request enters the successful cache');
  assert.equal(await context.readNativeResponse(example), first);
  assert.equal(jsonRequests, 2);
  assert.equal(bufferRequests, 2);
  context.nativeResponseCache.clear();
  alreadyDecoded = true;
  const decodedByHttp = await context.readNativeResponse(example);
  assert.deepEqual(Buffer.from(decodedByHttp.buffer), original, 'HTTP Content-Encoding bodies already decoded by fetch are not decompressed twice');
  assert.equal(validations, 2, 'already decoded bytes are validated too');
  assert.equal(await context.readNativeResponse(example), decodedByHttp);
  assert.equal(jsonRequests, 3);
  assert.equal(bufferRequests, 3);
});

test('all twenty advertised native cases resolve their response, compression and baseline assets without a generic fallback', async () => {
  const catalog = await json('public/explorer/data/manifest.json');
  const data = new URL('public/explorer/data/', root);
  assert.equal(catalog.models.length, 20);
  assert.match(catalog.description, /native Blender parameter response/i);
  const asset = async (relative) => {
    assert.equal(typeof relative, 'string');
    assert.doesNotMatch(relative, /(^\/|\\|(^|\/)\.\.($|\/)|^[a-z]+:)/i);
    const url = new URL(relative, data);
    assert.ok(url.href.startsWith(data.href));
    assert.ok((await stat(url)).isFile(), relative);
    return url;
  };
  let compressed = 0;
  for (const entry of catalog.models) {
    assert.ok(entry.native_edit, `${entry.id}: every selected case must use the native loading branch`);
    const responseUrl = await asset(entry.native_edit.response);
    const bufferUrl = await asset(entry.native_edit.buffer);
    const header = JSON.parse(await readFile(responseUrl, 'utf8'));
    assert.equal(new URL(header.binary, responseUrl).href, bufferUrl.href, `${entry.id}: response and binary belong together`);
    assert.ok(header.parts.length && header.controls.length, entry.id);
    if (header.compression === 'gzip') {
      compressed += 1;
      assert.match(entry.native_edit.buffer, /\.bin\.gz$/);
    } else {
      assert.equal(header.compression, undefined);
      assert.match(entry.native_edit.buffer, /\.bin$/);
    }
    if (header.baseline) {
      assert.ok(entry.native_edit.baseline, `${entry.id}: the advertised model must use its matching native baseline`);
      for (const key of ['glb', 'snapshot', 'mesh_map', 'provenance']) {
        const url = await asset(entry.native_edit.baseline[key]);
        assert.equal(url.href, new URL(header.baseline[key], responseUrl).href);
      }
    } else {
      for (const key of ['glb', 'snapshot', 'mesh_map', 'provenance']) await asset(entry[key]);
    }
  }
  assert.ok(compressed >= 1, 'the catalog exercises the compressed native data path');
});
