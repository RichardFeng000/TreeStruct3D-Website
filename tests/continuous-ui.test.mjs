import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { createContinuousEditor } from '../public/explorer/continuous-edit.js';
import { createAnchorLayer } from '../public/explorer/anchor-layer.js';
import { hasPaperComparison, invalidatePreviewChecks, paperComparisonPair, paperPreset, providerLabel, stateLabel } from '../public/explorer/edit-state.js';
import { escapeHtml, snapshotCounts } from '../public/explorer/data-utils.js';

// Execute the shipped handlers and coordinator, with the real geometry editor.
// Only browser drawing, DOM containers, frame scheduling, and image transport are replaced.
const script = await readFile(new URL('../public/explorer/inspector.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/explorer/index.html', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('inspector.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(syntax.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(syntax)]));

function element(value = '', tagName = 'div') {
  const handlers = new Map(), attributes = new Map(), classes = new Set();
  return {
    value, tagName: tagName.toUpperCase(), children: [], dataset: {}, textContent: '', hidden: false, parentElement: null,
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
    setAttribute(name, text) { attributes.set(name, text); },
    getAttribute(name) { return attributes.get(name); },
    replaceChildren(...children) { for (const child of this.children) if (typeof child === 'object') child.parentElement = null; this.children = []; this.append(...children); },
    append(...children) { for (const child of children) if (typeof child === 'object') child.parentElement = this; this.children.push(...children); },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    querySelectorAll() { return []; },
    matches(selector) {
      return selector.split(',').some((part) => {
        const data = part.trim().match(/^\[data-([a-z-]+)\]$/);
        if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()));
        return this.tagName === part.trim().toUpperCase();
      });
    },
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; },
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; },
    addEventListener(name, callback) { handlers.set(name, callback); },
    emit(name, event = {}) { return handlers.get(name)?.({ target: this, ...event }); },
  };
}

function fixture() {
  const model = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  const arm = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  body.name = 'body'; arm.name = 'arm'; arm.position.x = 2;
  model.add(body, arm);
  const runtime = {
    roots: ['body'],
    nodes: [
      { id: 'body', label: 'Body', origin: [0, 0, 0], center: [0, 0, 0], bbox_min: [-1, -1, -1], bbox_max: [1, 1, 1], dimensions: [2, 2, 2] },
      { id: 'arm', label: 'Arm', origin: [2, 0, 0], center: [2, 0, 0], bbox_min: [1.5, -0.5, -0.5], bbox_max: [2.5, 0.5, 0.5], dimensions: [1, 1, 1] },
    ],
    edges: [{ parent: 'body', child: 'arm', relation: 'DIRECTED', parent_child_known: true, directed_verified: true,
      shared_anchor: true, contact: true, geometric_anchor_aligned: true, anchor_a: [1, 0, 0], anchor_b: [1, 0, 0], anchor_gap: 0 }],
  };
  const editor = createContinuousEditor(model, runtime);
  const anchors = createAnchorLayer(new THREE.Scene(), (point) => editor.runtimePointToWorld(point));
  const stateIds = ['default', 'parent-0.4', 'parent-1.6', 'child-0.4', 'child-1.6'];
  const example = {
    title: 'Two-part model',
    comparison: { label: '3DCodeBench', note: 'Original paper protocol.', states: stateIds.map((id) => ({ id, image: `paper/baseline-${id}.png` })) },
    paper_renders: { states: stateIds.map((id) => ({ id, image: `paper/method-${id}.png` })) },
  };
  const frames = new Map(), imageRequests = [], networkRequests = [], statuses = [];
  let frameId = 0, graphRenders = 0;
  const elements = Object.fromEntries(['editPanel', 'editParts', 'editResetAll', 'editState',
    'comparisonPreset', 'comparisonToggle', 'comparisonPanel', 'comparisonImages', 'comparisonStatus', 'viewerPanel', 'graphStatus', 'graphDetail', 'graphSearch', 'controlsHost', 'panelTitle', 'previewSelection', 'previewSelectionLabel']
    .map((name) => [name, element()]));
  elements.comparisonPreset.value = 'default';
  const byId = { 'comparison-state': element(), 'comparison-note': element() };
  const camera = new THREE.PerspectiveCamera(), treeCamera = new THREE.PerspectiveCamera();
  camera.position.set(9, 5, 7); treeCamera.position.set(3, 8, 4);
  const context = vm.createContext({
    ...elements, THREE, structuredClone, Map, Set,
    document: { activeElement: null, createElement: (tagName) => element('', tagName), getElementById: (id) => byId[id] },
    activeExample: example, activeSnapshot: { runtime }, pendingExample: null, activeVariant: { id: 'default', scale: 1, bytes: 1024, glb: 'default.glb', provenance: 'provenance.json' },
    currentModel: model, modelAnchors: anchors, continuousEditor: editor, editTargetId: 'body', editRows: new Map(), previewFrame: null, queuedScales: new Map(),
    structureData: { views: { anchors: structuredClone(runtime), parts: structuredClone(runtime) } },
    graphState: { view: 'tree3d', selected: 'body', selectedEdge: null, anchorFocusNode: null, anchorMode: 'shared', query: 'body', collapsed: new Set(), scale: 1.3, tx: 12, ty: 23 },
    camera, tree3dCamera: treeCamera, orbit: { target: new THREE.Vector3(1, 2, 3), update() {} }, tree3dOrbit: { target: new THREE.Vector3(4, 5, 6), update() {} },
    previewHighlightRequest: null, previewAnchorOverlay: new THREE.Group(), schema: { adapter: 'generic' }, grid: { visible: true }, comparisonVisible: false, comparisonVersion: 0,
    hasPaperComparison, invalidatePreviewChecks, paperComparisonPair, paperPreset, providerLabel, stateLabel, escapeHtml, snapshotCounts,
    dataRoot: new URL('https://example.test/treeStruct3D/explorer/data/'),
    explorerRoot: new URL('https://example.test/treeStruct3D/explorer/'), assetUrl: (path, root) => new URL(path, root).href,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    Image: class {
      set src(url) { this.url = url; imageRequests.push(this); }
    },
    displayName: (name) => name, displayOptions: { wireframe: false, isolate: false, grid: true, anchors: true }, updateGraphLegend() {}, updateGraphTransform() {},
    restorePinnedTreeSelection() {}, restorePinnedPreviewSelection() {},
    partNodeIsVisible: () => true,
    setStatus(message, kind) { statuses.push({ message, kind }); },
    loadSavedState(...args) { networkRequests.push(args); }, fetch(...args) { networkRequests.push(args); },
  });
  context.graphView = () => context.structureData.views[context.graphState.view === 'tree3d' ? 'anchors' : context.graphState.view];
  context.renderGraph = () => {
    graphRenders += 1;
    if (context.simulateGraphFit) {
      camera.position.set(0, 0, 10); treeCamera.position.set(0, 0, 10);
      context.orbit.target.set(0, 0, 0); context.tree3dOrbit.target.set(0, 0, 0);
    }
  };
  for (const name of ['anchorEdgeKey', 'isDirectedAnchorEdge', 'updateEditControls', 'setEditTarget', 'queueContinuousScale', 'applyContinuousPreview',
    'normalizedPreviewName', 'previewNodeAliases', 'previewMeshNames', 'previewMeshMatchScore', 'matchingPreviewMeshes', 'previewMaterialClone',
    'clearPreviewAnchorOverlay', 'clearPreviewPartHighlight', 'applyPreviewPartHighlight', 'applyDisplayOptions', 'highlightPreviewGraphNode', 'highlightPreviewGraphNodes',
    'captureEditView', 'restoreEditView', 'buildControls', 'updateModelAnchors', 'resetAllEdits', 'selectGraphNode', 'selectObservedPart', 'setComparisonMode', 'resetPaperComparison', 'updatePaperComparison']) {
    assert.ok(functions.has(name), `Shipped function ${name} must exist`);
    vm.runInContext(functions.get(name), context);
  }
  for (const node of syntax.statements) {
    const source = node.getText(syntax);
    if (/^(editParts|editResetAll|comparisonToggle|comparisonPreset)\.addEventListener\(/.test(source)) vm.runInContext(source, context);
  }
  context.updateEditControls();
  context.updateModelAnchors();
  return {
    context, editor, anchors, body, arm, runtime, frames, imageRequests, networkRequests, statuses, byId,
    graphRenders: () => graphRenders,
    flushFrame() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); },
    row: (id) => context.editRows.get(id),
    input(id, kind, value) {
      const control = context.editRows.get(id)[kind];
      if (context.document.activeElement !== control) {
        context.document.activeElement = control;
        context.editParts.emit('focusin', { target: control });
      }
      control.value = String(value);
      context.editParts.emit('input', { target: control });
    },
    change(id, kind) { context.editParts.emit('change', { target: context.editRows.get(id)[kind] }); },
    click(id, kind) { context.editParts.emit('click', { target: context.editRows.get(id)[kind] }); },
  };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const width = (mesh) => { mesh.updateWorldMatrix(true, false); return new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x; };
async function completeImages(images) {
  for (const image of images) image.onload();
  await Promise.resolve();
  await Promise.resolve();
}

test('every part has a persistent visible row and different rows can queue edits without selecting a part first', () => {
  assert.match(html, /<ul\b[^>]*\bid="edit-parts"[^>]*>/);
  assert.doesNotMatch(html, /\bid="edit-target"/);
  const f = fixture(), c = f.context;
  const bodyRow = f.row('body'), armRow = f.row('arm');
  assert.equal(c.editRows.size, f.runtime.nodes.length);
  assert.equal(c.editParts.children.length, f.runtime.nodes.length);
  for (const record of [bodyRow, armRow]) {
    assert.equal(record.row.hidden, false);
    assert.equal(c.editParts.contains(record.number), true);
    assert.equal(c.editParts.contains(record.range), true);
    assert.equal(record.number.disabled, false);
    assert.equal(record.range.disabled, false);
  }
  assert.equal(c.editTargetId, 'body');
  armRow.range.value = '1.37';
  c.editParts.emit('input', { target: armRow.range });
  assert.equal(c.queuedScales.get('arm'), 1.37, 'input must capture its value before selecting and refreshing another row');
  f.input('arm', 'number', 1.37);
  f.input('body', 'range', 0.63);
  f.input('arm', 'number', 1.4);
  assert.equal(f.frames.size, 1, 'independent rows coalesce into the same animation frame');
  assert.equal(bodyRow.range.value, '0.63', 'focusing another row must keep the queued scale visible');
  f.flushFrame();
  near(width(f.body), 1.26); near(width(f.arm), 1.4);
  assert.equal(f.editor.getScale('body'), 0.63);
  assert.equal(f.editor.getScale('arm'), 1.4);
  assert.equal(f.row('body'), bodyRow);
  assert.equal(f.row('arm'), armRow);
  c.selectGraphNode('body');
  assert.equal(c.editTargetId, 'body', 'selection in the structure view highlights the corresponding existing row');
  assert.equal(bodyRow.select.getAttribute('aria-pressed'), 'true');
  assert.equal(armRow.select.getAttribute('aria-pressed'), 'false');
  assert.equal(armRow.number.value, '1.4', 'selection cannot overwrite the focused input in another row');
  assert.equal(f.editor.getScale('arm'), 1.4);
  assert.equal(f.networkRequests.length, 0);
});

test('actual range events resize geometry on animation frames and only rebuild the graph on commit', () => {
  const f = fixture(), c = f.context;
  const row = f.row('body');
  const anchorPair = f.anchors.group.children[0];
  assert.equal(f.anchors.group.visible, false, 'the default model has no highlighted anchor points');
  f.click('body', 'select');
  assert.equal(f.anchors.group.visible, true);
  assert.equal(anchorPair.getObjectByName('parent-anchor').visible, true);
  assert.equal(anchorPair.getObjectByName('child-anchor').visible, false);
  for (const [attribute, value] of [['min', '0.4'], ['max', '1.6'], ['step', '0.01']]) assert.equal(String(row.range[attribute] ?? row.range.getAttribute(attribute)), value);
  c.simulateGraphFit = true;
  f.input('body', 'range', 0.8); f.input('body', 'range', 0.6);
  assert.equal(f.frames.size, 1, 'rapid inputs share one scheduled frame');
  assert.equal(f.editor.getScale('body'), 1, 'geometry stays unchanged before the scheduled frame');
  f.flushFrame();
  assert.equal(f.editor.getScale('body'), 0.6);
  near(width(f.body), 1.2);
  assert.equal(row.number.value, '0.60');
  assert.equal(c.structureData.views.anchors.validation_status, 'not_run');
  assert.equal(c.structureData.views.anchors.edges[0].shared_anchor, false);
  assert.equal(c.graphState.anchorMode, 'shared', 'anchor-coordinate display remains selected when validation is cleared');
  assert.equal(f.anchors.group.children[0], anchorPair);
  assert.equal(f.anchors.group.visible, true);
  assert.equal(anchorPair.visible, true);
  near(anchorPair.getObjectByName('parent-anchor').position.x, 0.6);
  const initialRenders = f.graphRenders();
  f.input('body', 'range', 1.4); f.flushFrame();
  near(width(f.body), 2.8);
  near(anchorPair.getObjectByName('parent-anchor').position.x, 1.4);
  assert.equal(f.graphRenders(), initialRenders, 'continued dragging must not rebuild the graph');
  f.change('body', 'range');
  assert.equal(f.graphRenders(), initialRenders + 1);
  assert.deepEqual(c.camera.position.toArray(), [9, 5, 7]);
  assert.deepEqual(c.orbit.target.toArray(), [1, 2, 3]);
  assert.deepEqual(c.tree3dCamera.position.toArray(), [3, 8, 4]);
  assert.deepEqual(c.tree3dOrbit.target.toArray(), [4, 5, 6]);
  assert.equal(c.graphState.view, 'tree3d');
  assert.equal(c.graphState.query, 'body');
  assert.equal(f.networkRequests.length, 0, 'continuous input must not reload saved GLBs');
  assert.ok(f.statuses.every((status) => status.kind !== 'error'));
  c.clearPreviewPartHighlight();
  assert.equal(f.anchors.group.visible, false, 'clearing a resized part also hides its updated anchor');
});

test('actual number-input events accept 1.37 and synchronize the range without rounding to paper presets', () => {
  const f = fixture(), c = f.context;
  const row = f.row('body');
  f.input('body', 'number', '1.37');
  f.flushFrame();
  assert.equal(f.editor.getScale('body'), 1.37);
  near(width(f.body), 2.74);
  assert.equal(row.range.value, '1.37');
  assert.equal(row.range.getAttribute('aria-valuetext'), '1.37 times');
  assert.equal(row.number.value, '1.37', 'the focused input retains the typed value');
  f.change('body', 'number');
  assert.equal(f.frames.size, 0, 'change commits and cancels its pending animation callback');
  f.input('body', 'number', ''); f.flushFrame();
  assert.equal(f.editor.getScale('body'), 1.37, 'an incomplete numeric entry cannot corrupt the geometry');
  f.change('body', 'number');
  assert.equal(row.number.value, '1.37');
  f.input('body', 'number', '1.8');
  f.change('body', 'number');
  assert.equal(f.editor.getScale('body'), 1.6, 'committed out-of-range values are clamped');
  assert.equal(c.comparisonPreset.value, 'default');
  assert.equal(f.imageRequests.length, 0);
  assert.equal(f.networkRequests.length, 0);
});

test('part selection retains independent edits, reset part preserves others, and reset all cancels queued input', () => {
  const f = fixture(), c = f.context;
  const bodyRow = f.row('body'), armRow = f.row('arm');
  f.input('body', 'range', 0.6);
  f.click('arm', 'select'); // Change parts before the preceding frame has fired.
  f.flushFrame();
  assert.equal(f.editor.getScale('body'), 0.6);
  assert.equal(c.editTargetId, 'arm');
  assert.equal(armRow.range.value, '1');
  f.input('arm', 'number', 1.37); f.flushFrame();
  near(width(f.body), 1.2); near(width(f.arm), 1.37);
  f.click('body', 'select');
  assert.equal(c.graphState.selected, 'body');
  assert.equal(bodyRow.select.getAttribute('aria-pressed'), 'true');
  assert.equal(bodyRow.number.value, '0.60');
  f.click('body', 'reset');
  assert.equal(f.editor.getScale('body'), 1);
  assert.equal(f.editor.getScale('arm'), 1.37);
  assert.equal(c.structureData.views.anchors.preview_only, true, 'another changed part keeps checks invalidated');
  f.input('arm', 'range', 0.63);
  assert.equal(f.frames.size, 1);
  c.editResetAll.emit('click');
  f.flushFrame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.editor.hasEdits(), false);
  near(width(f.body), 2); near(width(f.arm), 1);
  assert.equal(bodyRow.number.value, '1.00');
  assert.equal(armRow.number.value, '1.00');
  assert.equal(c.structureData.views.anchors.edges[0].shared_anchor, true);
  assert.equal(c.structureData.views.anchors.edges[0].contact, true);
  assert.equal(c.graphState.anchorMode, 'shared', 'reset keeps the anchor-coordinate display selected');
  assert.match(c.editState.textContent, /Original geometry/);
  assert.equal(f.networkRequests.length, 0);
});

test('incremental decimal input survives the first preview graph and sidebar refresh while the field has focus', () => {
  for (const sequence of [['0', '0.', '0.6', '0.63'], ['1.', '1.3', '1.37']]) {
    const f = fixture(), c = f.context;
    const row = f.row('body');
    c.simulateGraphFit = true;
    let expected = 1;
    for (const typed of sequence) {
      f.input('body', 'number', typed);
      f.flushFrame();
      if (Number(typed) >= 0.4 && Number(typed) <= 1.6) expected = Number(typed);
      assert.equal(row.number.value, typed, `refresh must not replace the focused entry ${typed}`);
      assert.equal(f.row('body'), row, 'preview refresh must preserve the existing row and its focused input');
      assert.equal(c.document.activeElement, row.number);
      assert.equal(f.editor.getScale('body'), expected);
      assert.equal(c.editTargetId, 'body');
      assert.deepEqual(c.camera.position.toArray(), [9, 5, 7]);
    }
    assert.match(c.controlsHost.innerHTML, /Not rerun/, 'the actual sidebar builder ran during the first edit');
    f.change('body', 'number');
    assert.equal(row.number.value, expected.toFixed(2));
    assert.equal(row.range.value, String(expected));
    near(width(f.body), expected * 2);
    assert.ok(f.statuses.every((status) => status.kind !== 'error'));
  }
});

test('paper comparison requests exact independent presets and late images cannot replace a newer selection', async () => {
  const f = fixture(), c = f.context;
  f.input('body', 'number', 1.37); f.flushFrame();
  c.comparisonToggle.emit('click');
  assert.equal(c.comparisonVisible, true);
  assert.equal(f.imageRequests.length, 2);
  assert.ok(f.imageRequests.every((image) => image.url.endsWith('-default.png')));
  const oldImages = f.imageRequests.slice();
  c.comparisonPreset.value = 'child-0.4'; c.comparisonPreset.emit('change');
  assert.equal(f.imageRequests.length, 4);
  const newImages = f.imageRequests.slice(2);
  assert.ok(newImages.every((image) => image.url.endsWith('-child-0.4.png')));
  assert.match(f.byId['comparison-state'].textContent, /Child · 0.4×/);
  f.input('body', 'number', 1.23); f.flushFrame();
  assert.equal(f.editor.getScale('body'), 1.23);
  assert.equal(c.comparisonPreset.value, 'child-0.4');
  assert.equal(f.imageRequests.length, 4, 'continuous geometry changes do not request a nearest paper image');
  await completeImages(newImages);
  assert.equal(c.comparisonImages.children.length, 2);
  assert.equal(c.comparisonImages.children[0].children[1], newImages[0]);
  await completeImages(oldImages);
  assert.equal(c.comparisonImages.children[0].children[1], newImages[0], 'late old image pairs must be ignored');
  c.comparisonToggle.emit('click');
  assert.equal(c.comparisonVisible, false);
  assert.equal(f.editor.getScale('body'), 1.23);
  assert.equal(f.networkRequests.length, 0);
});
