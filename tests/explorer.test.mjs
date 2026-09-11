import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { assetUrl, validateSnapshot, snapshotCounts } from '../public/explorer/data-utils.js';
import { displayAnchorPairs, anchorDisplayVerified, isAnchorDisplayEdge } from '../public/explorer/anchor-display.js';
import { createAnchorLayer } from '../public/explorer/anchor-layer.js';

const root = new URL('../public/explorer/', import.meta.url);
const script = await readFile(new URL('inspector.js', root), 'utf8');
const html = await readFile(new URL('index.html', root), 'utf8');
const catalog = JSON.parse(await readFile(new URL('data/manifest.json', root), 'utf8'));
const syntax = ts.createSourceFile('inspector.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(syntax.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(syntax)]));

function fixture() {
  const parent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x224466 }));
  parent.name = 'body';
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x668822 }));
  child.name = 'arm';
  child.userData.stage7_part_id = 'arm';
  parent.add(child);
  const currentModel = new THREE.Group();
  currentModel.add(parent);
  const runtime = { nodes: [{ id: 'body' }, { id: 'arm' }], edges: [{ parent: 'body', child: 'arm', parent_child_known: true,
    declared_directions: [{ parent: 'body', child: 'arm', parent_anchor_world: [0, 0, 0], child_anchor_world: [0.1, 0, 0] }] }] };
  const anchors = createAnchorLayer(new THREE.Scene(), (point) => new THREE.Vector3(...point));
  const context = vm.createContext({
    THREE, currentModel, schema: { adapter: 'generic' },
    displayAnchorPairs,
    runtimePointToPreview: (point) => new THREE.Vector3(...point),
    displayOptions: { isolate: false, wireframe: false, grid: true, anchors: true },
    modelAnchors: anchors, structureData: { views: { anchors: runtime } },
    grid: { visible: true }, controlsHost: { querySelectorAll: () => [] },
    previewHighlightRequest: null,
    previewAnchorOverlay: new THREE.Group(),
    previewSelection: { hidden: true, classList: { toggle() {}, remove() {} } },
    previewSelectionLabel: { textContent: '' },
    isCoffeeTablePublicationTree: () => false,
    tree3dInteractiveObjects: [], tree3dRoot: new THREE.Group(),
  });
  for (const name of [
    'normalizedPreviewName', 'previewNodeAliases', 'previewMeshNames',
    'previewMeshMatchScore', 'matchingPreviewMeshes', 'previewMaterialClone',
    'clearPreviewAnchorOverlay', 'clearPreviewPartHighlight',
    'addPreviewAnchorSphere', 'addPreviewAnchorLine', 'showPreviewAnchorOverlay',
    'applyPreviewPartHighlight', 'applyDisplayOptions', 'updateModelAnchors', 'buildTree3DRealPart',
  ]) vm.runInContext(functions.get(name), context);
  context.updateModelAnchors();
  return { context, parent, child, anchors, runtime };
}

test('all example snapshots reference the same actual GLB meshes and saved checks', async () => {
  for (const example of catalog.models) {
    const snapshot = validateSnapshot(JSON.parse(await readFile(new URL(`data/${example.snapshot}`, root), 'utf8')));
    const glb = await readFile(new URL(`data/${example.glb}`, root));
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    assert.equal(glb.readUInt32LE(4), 2);
    assert.equal(glb.readUInt32LE(8), glb.length);
    const document = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
    const meshNames = new Set(document.nodes.filter((node) => node.mesh !== undefined).map((node) => node.name));
    assert.deepEqual(meshNames, new Set(snapshot.runtime.nodes.map((node) => node.id)), example.id);
    assert.equal(createHash('sha256').update(glb).digest('hex'), snapshot.provenance.glb_sha256);
    assert.equal(snapshotCounts(snapshot.runtime).shared, example.shared_anchors);
    assert.equal(snapshotCounts(snapshot.runtime).parts, example.parts);
    // GLB positions are float32; use the same scene-relative precision bound
    // for the larger paper examples as for the independent vertex check.
    assert.ok(snapshot.provenance.mesh_bbox_max_error_after_translation <= Math.max(1e-6, (snapshot.runtime.scene_extent || 1) * 2e-6));
    assert.doesNotMatch(JSON.stringify(snapshot), /\/Users\/|\/home\/|Bearer |api_key/i);
  }
});

test('data paths work under both portfolio and repository mirror mounts', () => {
  for (const path of ['treeStruct3D', 'TreeStruct3D-Website']) {
    const data = new URL(`https://example.com/${path}/explorer/data/`);
    assert.equal(assetUrl('method-monitor/model.glb', data), `${data}method-monitor/model.glb`);
    for (const invalid of ['../../other', '/api/render', 'https://other.example/file', '..\\other']) {
      assert.throws(() => assetUrl(invalid, data));
    }
  }
});

test('incomplete data and dangling relation endpoints produce a useful error', () => {
  assert.throws(() => validateSnapshot({}), /missing/);
  assert.throws(() => validateSnapshot({ schema: {}, structure: { views: {} }, runtime: {
    nodes: [{ id: 'body' }], edges: [{ parent: 'body', child: 'missing' }],
  } }), /invalid part relationship/);
});

test('a parent mesh match excludes descendants and supports semantic identity', () => {
  const { context, parent, child } = fixture();
  assert.deepEqual(Array.from(context.matchingPreviewMeshes({ id: 'body', label: 'body' }, {})), [parent]);
  assert.deepEqual(Array.from(context.matchingPreviewMeshes({ id: 'arm', label: 'arm' }, {})), [child]);
  child.name = 'GeneratedMesh_001';
  assert.deepEqual(Array.from(context.matchingPreviewMeshes({ id: 'arm', label: 'arm' }, {})), [child]);
  assert.equal(context.matchingPreviewMeshes({ id: 'missing', label: 'missing' }, {}).length, 0);
});

test('highlight, isolate, wireframe, and clear restore the real model materials', () => {
  const { context, parent, child, anchors } = fixture();
  const anchorPair = anchors.group.children[0];
  const originalParent = parent.material;
  const originalChild = child.material;
  context.previewHighlightRequest = { nodes: [{ id: 'arm', label: 'arm' }], view: {}, label: 'arm' };
  context.applyPreviewPartHighlight();
  assert.notEqual(child.material, originalChild);
  assert.equal(parent.material.opacity, 0.18);
  context.displayOptions.isolate = true;
  context.displayOptions.wireframe = true;
  context.applyDisplayOptions();
  assert.equal(parent.material.visible, false);
  assert.equal(child.material.visible, true);
  assert.equal(child.material.wireframe, true);
  context.clearPreviewPartHighlight();
  assert.equal(anchors.group.children[0], anchorPair, 'clearing highlighting keeps reusable anchor resources');
  assert.equal(anchors.group.visible, false, 'anchors must be hidden after highlighting is cleared');
  assert.equal(child.material, originalChild);
  assert.equal(parent.material, originalParent);
  assert.equal(parent.material.visible, true);
  assert.equal(child.material.visible, true);
  context.displayOptions.wireframe = false;
  context.applyDisplayOptions();
  assert.equal(child.material.wireframe, false);
});

test('model anchors follow only the highlighted part, while relation selection uses a single temporary pair overlay', () => {
  const { context, parent, child, anchors, runtime } = fixture();
  const pair = anchors.group.children[0];
  const parentPoint = pair.getObjectByName('parent-anchor');
  const childPoint = pair.getObjectByName('child-anchor');
  assert.equal(anchors.group.visible, false, 'loading a model without any highlight shows no anchor points');
  assert.equal(context.previewAnchorOverlay.visible, false);
  assert.equal(context.displayOptions.isolate, false);

  context.previewHighlightRequest = { nodes: [runtime.nodes[1]], view: runtime, label: 'Arm' };
  context.applyPreviewPartHighlight();
  assert.equal(anchors.group.visible, true);
  assert.equal(parentPoint.visible, false);
  assert.equal(childPoint.visible, true, 'only the highlighted arm endpoint is shown, even without isolation');
  assert.equal(pair.getObjectByName('anchor-pair-segment').visible, false);
  assert.equal(parent.material.visible, true);
  assert.equal(child.material.visible, true);

  context.previewHighlightRequest = { nodes: [runtime.nodes[0]], view: runtime, label: 'Body' };
  context.applyPreviewPartHighlight();
  assert.equal(anchors.group.children[0], pair);
  assert.equal(parentPoint.visible, true);
  assert.equal(childPoint.visible, false, 'switching the highlight replaces the visible endpoint');

  context.previewHighlightRequest = { nodes: runtime.nodes, view: runtime, label: 'Body to arm', edge: runtime.edges[0] };
  context.applyPreviewPartHighlight();
  assert.equal(anchors.group.visible, false, 'relation highlighting must not double-render the model anchor layer');
  assert.equal(context.previewAnchorOverlay.visible, true);
  assert.equal(context.previewAnchorOverlay.children.filter((object) => object.isMesh).length, 2);
  context.displayOptions.anchors = false;
  context.applyDisplayOptions();
  assert.equal(anchors.group.visible, false);
  assert.equal(context.previewAnchorOverlay.visible, false);
  context.displayOptions.anchors = true;
  context.applyDisplayOptions();
  assert.equal(context.previewAnchorOverlay.visible, true);
  context.clearPreviewPartHighlight();
  assert.equal(anchors.group.visible, false);
  assert.equal(context.previewAnchorOverlay.visible, false);
  assert.equal(context.previewAnchorOverlay.children.length, 0);
});

test('unmatched part and relation requests leave original white materials and show neither anchors nor a highlight claim', () => {
  for (const relation of [false, true]) {
    const { context, parent, child, anchors, runtime } = fixture();
    parent.material.color.setHex(0xffffff); child.material.color.setHex(0xffffff);
    const originalParent = parent.material, originalChild = child.material;
    context.previewHighlightRequest = { nodes: [runtime.nodes[0]], view: runtime, label: 'Body' };
    context.applyPreviewPartHighlight();
    assert.notEqual(parent.material, originalParent, 'start with a real highlight that must be removed');

    parent.name = 'unmapped_surface_a'; child.name = 'unmapped_surface_b';
    delete child.userData.stage7_part_id;
    assert.ok(runtime.nodes.every((node) => context.matchingPreviewMeshes(node, runtime).length === 0));
    context.previewHighlightRequest = {
      nodes: relation ? runtime.nodes : [runtime.nodes[0]], view: runtime,
      label: relation ? 'Unmapped relation' : 'Unmapped body', edge: relation ? runtime.edges[0] : null,
    };
    context.applyPreviewPartHighlight();
    context.updateModelAnchors();
    assert.equal(parent.material, originalParent);
    assert.equal(child.material, originalChild);
    assert.equal(parent.material.color.getHex(), 0xffffff);
    assert.equal(child.material.color.getHex(), 0xffffff);
    assert.notEqual(parent.userData.playgroundHighlighted, true);
    assert.notEqual(child.userData.playgroundHighlighted, true);
    assert.equal(anchors.group.visible, false);
    assert.equal(context.previewAnchorOverlay.visible, false);
    assert.equal(context.previewAnchorOverlay.children.length, 0, 'unmatched relation coordinates must not create a temporary overlay');
    assert.match(context.previewSelectionLabel.textContent, /No separate mesh found/);
    assert.doesNotMatch(context.previewSelectionLabel.textContent, /Highlighted:|Shared anchor:|Anchor pair:/);
    anchors.dispose();
  }
});

test('retaining a selection request after clearing real material highlights cannot keep either anchor layer visible', () => {
  for (const relation of [false, true]) {
    const { context, parent, child, anchors, runtime } = fixture();
    const originalParent = parent.material, originalChild = child.material;
    const request = { nodes: relation ? runtime.nodes : [runtime.nodes[0]], view: runtime, label: 'Body', edge: relation ? runtime.edges[0] : null };
    context.previewHighlightRequest = request;
    context.applyPreviewPartHighlight();
    assert.equal(parent.userData.playgroundHighlighted, true);
    assert.equal(relation ? context.previewAnchorOverlay.visible : anchors.group.visible, true);
    context.clearPreviewPartHighlight(false);
    assert.equal(context.previewHighlightRequest, request, 'exercise the internal clear path that deliberately keeps the request');
    assert.equal(parent.material, originalParent);
    assert.equal(child.material, originalChild);
    assert.equal(parent.userData.playgroundHighlighted, undefined);
    assert.equal(child.userData.playgroundHighlighted, undefined);
    assert.ok(context.matchingPreviewMeshes(runtime.nodes[0], runtime).length > 0, 'mesh identity still matches; only the real highlight was removed');
    context.updateModelAnchors();
    assert.equal(anchors.group.visible, false);
    assert.equal(context.previewAnchorOverlay.visible, false);
    assert.equal(context.previewAnchorOverlay.children.length, 0);
    assert.equal(context.previewSelection.hidden, true);
    anchors.dispose();
  }
});

test('real-part hierarchy uses original colors even while the preview is isolated', () => {
  const { context, parent, child } = fixture();
  const originalColor = parent.material.color.getHex();
  context.previewHighlightRequest = { nodes: [{ id: 'arm', label: 'arm' }], view: {}, label: 'arm' };
  context.applyPreviewPartHighlight();
  context.displayOptions.isolate = true;
  context.displayOptions.wireframe = true;
  context.applyDisplayOptions();
  assert.equal(parent.material.visible, false);
  const part = context.buildTree3DRealPart({ id: 'body', label: 'body' }, new THREE.Vector3(), 'Root Parent', {});
  const material = part.children[0].material;
  assert.equal(material.color.getHex(), originalColor);
  assert.equal(material.visible, true);
  assert.equal(material.wireframe, false);
  assert.ok(child.material.visible);
});

test('unverified authored anchors appear in both hierarchy views without becoming verified shared anchors', async () => {
  // Keep this known-invalid fixture independent of the public case selection.
  const { runtime } = JSON.parse(await readFile(new URL('data/method-chameleon/snapshot.json', root), 'utf8'));
  assert.equal(snapshotCounts(runtime).shared, 0);
  for (const realParts of [true, false]) for (const preview of [false, true]) {
  const view = structuredClone(runtime);
  if (preview) {
    view.preview_only = true;
    for (const edge of view.edges) { edge.preview_only = true; edge.validation_status = 'not_run'; }
  }
  const positions = new Map(view.nodes.map((node, index) => [node.id, new THREE.Vector3(index, -index, 0)]));
  const layout = { positions, edges: view.edges, nodeById: new Map(view.nodes.map((node) => [node.id, node])), roots: new Set(view.roots), outgoing: new Map() };
  const labels = [];
  const context = vm.createContext({
    THREE, displayAnchorPairs, anchorDisplayVerified, isAnchorDisplayEdge,
    graphState: { tree3dShowRealParts: realParts, tree3dShowShared: true },
    tree3dLastView: null, tree3dLastLayout: null, tree3dRoot: new THREE.Group(), tree3dInteractiveObjects: [],
    tree3dContentBox: new THREE.Box3(), tree3dControlNote: {}, tree3dLevelGap: 3.75,
    clearTree3DScene() {}, tree3dSourceView: () => view,
    computeTree3DPyramidLayout: () => layout, applyTree3DCompactLayout: (_, value) => value,
    addTree3DLevelGuide() {}, tree3dNodeRole: () => 'Leaf Child',
    buildTree3DRealPart: () => new THREE.Group(), isCoffeeTablePublicationTree: () => false,
    truncateNodeLabel: (label) => label,
    addTree3DLabel: (text) => { labels.push(text); return new THREE.Object3D(); }, addTree3DLine() {}, addTree3DArrow() {}, addTree3DExportShaft() {},
    tree3dPairKey: (a, b) => `${a}:${b}`,
    tree3dDisplayedAnchor: (_group, point) => new THREE.Vector3(...point),
    authoredAnchorStats: () => null, updateTree3DSelectionStatus() {}, applyTree3DSelectionAppearance() {},
    resizeTree3D() {}, fitTree3D() {},
  });
  for (const name of ['isDirectedAnchorEdge', 'anchorEdgeMatches', 'tree3dAuthoredAnchorPairs', 'compactSharedAnchorCoordinate', 'renderTree3D']) vm.runInContext(functions.get(name), context);
  context.renderTree3D();
  const markers = context.tree3dInteractiveObjects.filter((object) => object.isMesh && object.userData.tree3dHit?.kind === 'anchor');
  assert.ok(markers.length >= view.edges.length, 'each visible authored relation needs an anchor marker even with zero verified pairs');
  assert.ok(markers.every((object) => !anchorDisplayVerified(object.userData.tree3dHit.edge)));
  assert.ok(markers.every((object) => object.material.color.getHex() === 0xffc107), 'unverified markers must not inherit verified green');
  assert.match(context.tree3dControlNote.textContent, /Anchors 12\/12/);
  assert.doesNotMatch(labels.join(' '), /verified|proven|confirmed/i);
  assert.equal(snapshotCounts(view).shared, 0);
  if (preview) assert.match(context.tree3dControlNote.textContent, /checks not rerun/);
  }
});

test('unverified 2D anchor lanes remain interactive without proven labels or verified styling', async () => {
  const { runtime } = JSON.parse(await readFile(new URL('data/method-chameleon/snapshot.json', root), 'utf8'));
  const svg = (tag, attributes = {}) => ({
    tag, attributes: { ...attributes }, children: [], textContent: '',
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  });
  for (const preview of [false, true]) {
    const view = structuredClone(runtime);
    if (preview) for (const edge of view.edges) { edge.preview_only = true; edge.validation_status = 'not_run'; }
    const context = vm.createContext({
      displayAnchorPairs, anchorDisplayVerified, isAnchorDisplayEdge,
      graphState: { view: 'anchors', anchorMode: 'shared', query: '', selected: null, selectedEdge: null, anchorFocusNode: null },
      graphNodes: svg('g'), graphEdges: svg('g'), anchorRelations: {}, graphStatus: {},
      makeSvg: svg, truncateNodeLabel: (value) => value, updateGraphTransform() {},
    });
    for (const name of ['anchorEdgeKey', 'isDirectedAnchorEdge', 'isStrictAnchorEdge', 'anchorEdgeMatches', 'formatGraphNumber',
      'authoredAnchorStats', 'authoredAnchorSummary', 'runtimeRelationLabel', 'renderSharedAnchorLanes']) vm.runInContext(functions.get(name), context);
    assert.ok(view.edges.every((edge) => context.anchorEdgeMatches(edge)), 'coordinate visibility must not require verification');
    context.renderSharedAnchorLanes(view, view);
    const centers = context.graphNodes.children.filter((node) => node.attributes['data-anchor-edge']);
    assert.equal(centers.length, 12);
    for (const center of centers) {
      assert.match(center.attributes.class, /\bunverified\b/);
      assert.doesNotMatch(center.attributes.class, /\bconfirmed\b/);
      assert.equal(center.attributes.role, 'button');
      assert.equal(center.attributes.tabindex, '0');
      const title = center.children.find((node) => node.attributes.class === 'anchor-lane-center-title').textContent;
      assert.doesNotMatch(title, /verified|proven|confirmed/i);
      const meta = center.children.find((node) => node.attributes.class === 'anchor-lane-center-meta').textContent;
      assert.match(meta, preview ? /Checks not rerun/ : /not verified as shared/);
    }
    const connectors = context.graphEdges.children.filter((node) => node.attributes.class?.split(' ').includes('anchor-lane-connector'));
    assert.ok(connectors.length > 0);
    assert.ok(connectors.every((node) => node.attributes.class.includes('unverified') && !node.attributes['marker-end']));
  }
});

test('all DOM references exist and no local backend actions are published', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  for (const match of script.matchAll(/document.getElementById\('([^']+)'\)/g)) assert.ok(ids.has(match[1]), match[1]);
  assert.doesNotMatch(script, /\/api\/|fetch\([^)]*method:\s*['"]POST/);
  assert.doesNotMatch(html, /Generate Model|Failed Case|Auto Update/);
});
