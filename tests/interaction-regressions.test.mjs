import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from '../public/explorer/vendor/three.module.min.js';

const script = await readFile(new URL('../public/explorer/inspector.js', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('inspector.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(syntax.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(syntax)]));

function include(context, ...names) {
  for (const name of names) vm.runInContext(functions.get(name), context);
}

function element() {
  const handlers = new Map();
  const attributes = new Set();
  return {
    handlers,
    hasAttribute(name) { return attributes.has(name); },
    toggleAttribute(name, force = !attributes.has(name)) {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return attributes.has(name);
    },
    addEventListener(name, callback) { handlers.set(name, callback); },
    emit(name, options = {}) {
      return handlers.get(name)?.({ pointerId: 1, clientX: 10, clientY: 10, button: 0, isPrimary: true, ...options });
    },
  };
}

test('orbit drags, return-to-origin drags, multi-touch and cancelled gestures never select a part', () => {
  const context = vm.createContext({});
  include(context, 'bindSelectionClick');
  const canvas = element();
  let clicks = 0;
  context.bindSelectionClick(canvas, () => { clicks += 1; });

  canvas.emit('pointerdown');
  canvas.emit('pointermove', { clientX: 90 });
  canvas.emit('pointerup');
  assert.equal(clicks, 0, 'moving back to the starting point is still a drag');

  canvas.emit('pointerdown');
  canvas.emit('pointerdown', { pointerId: 2, isPrimary: false });
  canvas.emit('pointerup', { pointerId: 2, isPrimary: false });
  canvas.emit('pointerup');
  assert.equal(clicks, 0, 'a pinch gesture must not select its last touch target');

  canvas.emit('pointerdown');
  canvas.emit('pointercancel');
  canvas.emit('pointerup');
  canvas.emit('pointerdown', { button: 2 });
  canvas.emit('pointerup', { button: 2 });
  assert.equal(clicks, 0);

  canvas.emit('pointerdown');
  canvas.emit('pointermove', { clientX: 12 });
  canvas.emit('pointerup', { clientX: 12 });
  assert.equal(clicks, 1, 'a deliberate click tolerates small pointer movement');
});

test('moving while orbiting cannot replace the fixed part highlight', () => {
  let hovers = 0;
  const context = vm.createContext({
    pickTree3DObject: () => ({}),
    applyTree3DHover: () => { hovers += 1; },
  });
  include(context, 'updateTree3DPointer');
  context.updateTree3DPointer({ buttons: 1 });
  assert.equal(hovers, 0);
  context.updateTree3DPointer({ buttons: 0 });
  assert.equal(hovers, 1);
});

function selectionFixture(viewName = 'anchors') {
  const nodes = [{ id: 'body', label: 'Body' }, { id: 'arm', label: 'Arm' }];
  const edge = { parent: 'body', child: 'arm', relation: 'DIRECTED', shared_anchor: true, parent_child_known: true };
  const view = { nodes, edges: [edge] };
  const highlighted = [];
  let clears = 0;
  const context = vm.createContext({
    graphState: { view: viewName, selected: null, selectedEdge: null, anchorFocusNode: null },
    graphView: () => view,
    highlightPreviewGraphNodes: (parts, _view, _label, relation) => highlighted.push({ ids: parts.map((part) => part.id), relation }),
    highlightPreviewGraphNode: (node) => highlighted.push({ ids: [node.id] }),
    clearPreviewPartHighlight: () => { clears += 1; },
    isStrictAnchorEdge: () => true,
    showAnchorEdgeDetail() {}, renderGraph() {}, graphDetail: {},
    tree3dInteractiveObjects: [], tree3dSelection: null, tree3dHoveredObject: {}, tree3dTooltip: {},
    buildTree3DLineageSelection: (_hit, key) => ({ key }),
    applyTree3DSelectionAppearance() {}, updateTree3DSelectionStatus() {},
  });
  include(context, 'anchorEdgeKey', 'highlightAnchorEdge', 'selectAnchorEdge', 'restorePinnedPreviewSelection', 'restorePinnedTreeSelection', 'clearTree3DHover');
  return { context, edge, view, highlighted, clears: () => clears };
}

test('leaving a temporary anchor hover restores the clicked relation or part', () => {
  const { context, edge, highlighted } = selectionFixture();
  context.selectAnchorEdge(context.anchorEdgeKey(edge));
  highlighted.length = 0;
  context.restorePinnedPreviewSelection();
  assert.deepEqual(Array.from(highlighted[0].ids), ['body', 'arm']);
  assert.equal(highlighted[0].relation, edge);
  context.clearTree3DHover();
  assert.equal(highlighted.at(-1).relation, edge, 'leaving the hidden 3D canvas must preserve a 2D selection');

  context.graphState.selectedEdge = null;
  context.graphState.selected = 'arm';
  context.restorePinnedPreviewSelection();
  assert.deepEqual(highlighted.at(-1).ids, ['arm']);
});

test('clicking a 3D relation pins it across pointer leave and clicking a part clears the old relation', () => {
  const { context, edge, view, highlighted } = selectionFixture('tree3d');
  const hitObject = { userData: { tree3dHit: { kind: 'anchor', edge, view }, tree3dHitKey: 'anchor:body:arm' } };
  context.tree3dInteractiveObjects = [hitObject];
  context.tree3dCanvas = {};
  context.pickTree3DObject = () => hitObject;
  context.bindSelectionClick = (_canvas, callback) => { context.click = callback; };
  context.selectObservedPart = () => assert.fail('a relation is not a part');
  context.clearSelection = () => assert.fail('a relation is a valid selection');
  const clickRegistration = syntax.statements.find((node) => node.getText(syntax).startsWith('bindSelectionClick(tree3dCanvas,'));
  vm.runInContext(clickRegistration.getText(syntax), context);
  context.click({});
  assert.equal(context.graphState.selectedEdge, context.anchorEdgeKey(edge));
  context.clearTree3DHover();
  assert.equal(context.tree3dSelection.key, 'anchor:body:arm');
  assert.equal(highlighted.at(-1).relation, edge);

  include(context, 'selectGraphNode');
  context.selectGraphNode('arm');
  assert.equal(context.graphState.selected, 'arm');
  assert.equal(context.graphState.selectedEdge, null);
  assert.deepEqual(highlighted.at(-1).ids, ['arm']);
});

test('3D visibility filters preserve an orbited camera and restore the fixed selection', () => {
  for (const [controlName, stateName] of [
    ['tree3dShowShared', 'tree3dShowShared'],
    ['tree3dShowRealParts', 'tree3dShowRealParts'],
  ]) {
    const view = {};
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(9, 7, 3);
    const target = new THREE.Vector3(1, 2, 3);
    let restores = 0;
    const control = element();
    control.checked = true;
    const context = vm.createContext({
      [controlName]: control,
      graphState: { view: 'tree3d', [stateName]: false },
      clearTree3DHover() {}, graphSvg: element(), tree3dStage: {}, anchorRelations: {},
      updateGraphLegend() {}, tree3dLastView: view, tree3dSourceView: () => view,
      tree3dCamera: camera, tree3dOrbit: { target, update() {} },
      renderTree3D() { camera.position.set(0, 0, 10); target.set(0, 0, 0); },
      restorePinnedTreeSelection() { restores += 1; },
    });
    include(context, 'renderGraph');
    const listener = syntax.statements.find((node) => node.getText(syntax).startsWith(`${controlName}.addEventListener('change'`));
    vm.runInContext(listener.getText(syntax), context);
    control.emit('change');
    assert.equal(context.graphState[stateName], true);
    assert.deepEqual(camera.position.toArray(), [9, 7, 3]);
    assert.deepEqual(target.toArray(), [1, 2, 3]);
    assert.equal(restores, 1);
  }
});

test('switching between 3D and 2D toggles the actual SVG hidden attribute', () => {
  const graphSvg = element();
  const tree3dStage = {};
  const view = {};
  const context = vm.createContext({
    graphState: { view: 'tree3d' }, graphSvg, tree3dStage, anchorRelations: {},
    updateGraphLegend() {}, tree3dLastView: view, tree3dSourceView: () => view,
    tree3dCamera: new THREE.PerspectiveCamera(), tree3dOrbit: { target: new THREE.Vector3(), update() {} },
    renderTree3D() {}, restorePinnedTreeSelection() {},
    graphView: () => null, graphEdges: { replaceChildren() {} },
    graphNodes: { replaceChildren() {}, append() {} }, graphStatus: {},
    makeSvg: () => ({}), updateGraphTransform() {},
  });
  include(context, 'renderGraph');
  context.renderGraph();
  assert.equal(graphSvg.hasAttribute('hidden'), true, 'SVG requires an attribute; assigning .hidden does not hide it');
  assert.equal(tree3dStage.hidden, false);

  context.graphState.view = 'parts';
  context.renderGraph();
  assert.equal(graphSvg.hasAttribute('hidden'), false, 'the part tree must be visible after returning to 2D');
  assert.equal(tree3dStage.hidden, true);
});

test('Retry refetches an invalid catalog instead of silently selecting a nonexistent model', async () => {
  for (const invalid of [null, {}, { models: [] }, { models: [{}] }]) {
    let requests = 0;
    let loaded = 0;
    const controls = [];
    const context = vm.createContext({
      catalog: { models: [] },
      readExampleJson: async () => {
        requests += 1;
        return requests === 1 ? invalid : { models: [{ id: 'monitor', source: 'treestruct3d' }] };
      },
      setLoading() {}, setStatus() {}, graphStatus: {},
      sourceSelect: { value: '', replaceChildren() {}, append() {} }, modelSelect: { value: '' },
      controlsHost: { replaceChildren() { controls.length = 0; }, append(button) { controls.push(button); } },
      document: { createElement: () => element() },
      readRememberedSelection: () => null,
      loadModelsForSource: async () => { loaded += 1; },
      selectModel: () => assert.fail('an invalid catalog must be refetched'),
    });
    include(context, 'showExampleError', 'initialize');
    await context.initialize();
    assert.equal(context.catalog, null);
    assert.equal(controls.length, 1);
    await controls[0].emit('click');
    assert.equal(requests, 2);
    assert.equal(loaded, 1);
    assert.equal(context.sourceSelect.value, 'treestruct3d');
  }
});

test('switching models preserves an available view and falls back to the readable part tree', () => {
  for (const [preferred, expected] of [['parts', 'parts'], ['tree3d', 'tree3d'], ['anchors', 'anchors'], ['calls', 'parts']]) {
    const partView = { nodes: [{ id: 'body' }], edges: [], roots: ['body'] };
    const data = { views: { parts: partView, anchors: partView, definitions: { nodes: [], edges: [] }, calls: { nodes: [], edges: [] } } };
    let opened;
    const context = vm.createContext({
      graphState: { view: preferred, query: 'old query', selected: 'previous-model', collapsed: new Set(['previous-model']) },
      structureData: null, tree3dSelection: {}, tree3dLastLayout: {}, graphSearch: { value: 'old query' },
      clearPreviewPartHighlight() {}, tree3dSourceView: () => partView,
      setGraphView: (name) => { opened = name; },
    });
    include(context, 'initializeGraph');
    context.initializeGraph(data);
    assert.equal(opened, expected);
    assert.equal(context.graphState.selected, null);
    assert.equal(context.graphSearch.value, '');
    assert.equal(context.graphState.collapsed.size, 0);
  }
});
