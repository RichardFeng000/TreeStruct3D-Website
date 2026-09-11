import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { assetUrl, validateSnapshot, snapshotCounts } from '../public/explorer/data-utils.js';

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
  const context = vm.createContext({
    THREE, currentModel, schema: { adapter: 'generic' },
    displayOptions: { isolate: false, wireframe: false, grid: true },
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
    'applyPreviewPartHighlight', 'applyDisplayOptions', 'buildTree3DRealPart',
  ]) vm.runInContext(functions.get(name), context);
  return { context, parent, child };
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
    assert.ok(snapshot.provenance.mesh_bbox_max_error_after_translation < 0.000001);
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
  const { context, parent, child } = fixture();
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
  assert.equal(child.material, originalChild);
  assert.equal(parent.material, originalParent);
  assert.equal(parent.material.visible, true);
  assert.equal(child.material.visible, true);
  context.displayOptions.wireframe = false;
  context.applyDisplayOptions();
  assert.equal(child.material.wireframe, false);
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

test('invalid authored anchors never appear as shared in the real-part view', async () => {
  const example = catalog.models.find((model) => model.id === 'method-chameleon');
  const { runtime } = JSON.parse(await readFile(new URL(`data/${example.snapshot}`, root), 'utf8'));
  assert.equal(snapshotCounts(runtime).shared, 0);
  const positions = new Map(runtime.nodes.map((node, index) => [node.id, new THREE.Vector3(index, -index, 0)]));
  const layout = { positions, edges: runtime.edges, nodeById: new Map(runtime.nodes.map((node) => [node.id, node])), roots: new Set(runtime.roots), outgoing: new Map() };
  const context = vm.createContext({
    THREE, graphState: { tree3dShowRealParts: true, tree3dShowShared: true, tree3dShowIssues: false },
    tree3dLastView: null, tree3dLastLayout: null, tree3dRoot: new THREE.Group(), tree3dInteractiveObjects: [],
    tree3dContentBox: new THREE.Box3(), tree3dControlNote: {}, tree3dLevelGap: 3.75,
    clearTree3DScene() {}, tree3dSourceView: () => runtime,
    computeTree3DPyramidLayout: () => layout, applyTree3DCompactLayout: (_, value) => value,
    addTree3DLevelGuide() {}, tree3dNodeRole: () => 'Leaf Child',
    buildTree3DRealPart: () => new THREE.Group(), isCoffeeTablePublicationTree: () => false,
    truncateNodeLabel: (label) => label,
    addTree3DLabel: () => new THREE.Object3D(), addTree3DLine() {}, addTree3DArrow() {},
    tree3dPairKey: (a, b) => `${a}:${b}`,
    tree3dAuthoredAnchorPairs: () => [{ parent: [0,0,0], child: [0,0,0] }],
    authoredAnchorStats: () => null, updateTree3DSelectionStatus() {}, applyTree3DSelectionAppearance() {},
    resizeTree3D() {}, fitTree3D() {},
  });
  vm.runInContext(functions.get('isDirectedAnchorEdge'), context);
  vm.runInContext(functions.get('anchorEdgeMatches'), context);
  vm.runInContext(functions.get('renderTree3D'), context);
  context.renderTree3D();
  assert.match(context.tree3dControlNote.textContent, /Shared relations 0\/0/);
  assert.equal(context.tree3dInteractiveObjects.filter((object) => object.userData.tree3dHit?.kind === 'anchor').length, 0);
});

test('all DOM references exist and no local backend actions are published', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  for (const match of script.matchAll(/document.getElementById\('([^']+)'\)/g)) assert.ok(ids.has(match[1]), match[1]);
  assert.doesNotMatch(script, /\/api\/|fetch\([^)]*method:\s*['"]POST/);
  assert.doesNotMatch(html, /Generate Model|Failed Case|Auto Update/);
});
