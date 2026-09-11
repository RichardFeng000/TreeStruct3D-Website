import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';

const site = new URL('../', import.meta.url);
const explorer = new URL('public/explorer/', site);
const data = new URL('data/', explorer);
const json = async (url) => JSON.parse(await readFile(url, 'utf8'));
const catalog = await json(new URL('manifest.json', data));
const index = await json(new URL('paper-demos/paper-render-index.json', explorer));
const paper = await json(new URL('docs/paper-demo-cases.json', site));
const expectedStates = ['default', 'parent-0.4', 'parent-1.6', 'child-0.4', 'child-1.6'];
const providers = ['GPT-5.5', 'GPT-5.6 Sol', 'Gemini 3.1 Pro', 'Gemini 3.5 Flash'];
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sorted = (items) => [...items].sort((a, b) => String(a).localeCompare(String(b)));

function localAsset(base, relative) {
  assert.equal(typeof relative, 'string');
  assert.doesNotMatch(relative, /(^\/|\\|(^|\/)\.\.($|\/)|^[a-z]+:)/i);
  const url = new URL(relative, base);
  assert.ok(url.href.startsWith(base.href), relative);
  return url;
}

function caseSource(example) {
  const source = index.cases.find((item) => item.id === example.id);
  assert.ok(source, `Unknown case ${example.id}`);
  return source;
}

function parseGlb(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  let document;
  let binary;
  let offset = 12;
  while (offset < buffer.length) {
    const size = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    assert.ok(offset + size + 8 <= buffer.length);
    const chunk = buffer.subarray(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += size + 8;
  }
  assert.equal(offset, buffer.length);
  assert.ok(document && binary);
  return { document, binary };
}

// Recompute bounds from the GLB's vertex buffers with Three.js transforms.
// This checks the exported geometry itself, not only the baker's stored summary.
function exportedMeshes({ document, binary }) {
  const meshes = new Map();
  function visit(nodeIndex, parentMatrix) {
    const node = document.nodes[nodeIndex];
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
        );
    const world = parentMatrix.clone().multiply(local);
    if (node.mesh !== undefined) {
      const extras = node.extras || {};
      const id = extras.codex_semantic_node_id || node.name;
      assert.ok(id && !meshes.has(id), `Duplicate mesh identity: ${id}`);
      const bounds = new THREE.Box3();
      for (const primitive of document.meshes[node.mesh].primitives) {
        const accessor = document.accessors[primitive.attributes.POSITION];
        assert.equal(accessor.componentType, 5126);
        assert.equal(accessor.type, 'VEC3');
        assert.equal(accessor.sparse, undefined);
        const view = document.bufferViews[accessor.bufferView];
        const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        const stride = view.byteStride || 12;
        for (let vertex = 0; vertex < accessor.count; vertex += 1) {
          const at = start + vertex * stride;
          const point = new THREE.Vector3(binary.readFloatLE(at), binary.readFloatLE(at + 4), binary.readFloatLE(at + 8));
          bounds.expandByPoint(point.applyMatrix4(world));
        }
      }
      meshes.set(id, {
        mesh_index: node.mesh,
        part_id: extras.treestruct3d_part_id || extras.stage7_part_id || id,
        bbox_min: bounds.min.toArray(),
        bbox_max: bounds.max.toArray(),
      });
    }
    for (const child of node.children || []) visit(child, world);
  }
  for (const node of document.scenes[document.scene || 0].nodes) visit(node, new THREE.Matrix4());
  return meshes;
}

test('paper catalog contains four five-case provider groups in paper order', () => {
  assert.equal(catalog.models.length, 20);
  assert.equal(new Set(catalog.models.map((entry) => entry.id)).size, 20);
  assert.deepEqual([...new Set(catalog.models.map((entry) => entry.provider))], providers);
  assert.deepEqual(sorted(catalog.models.map((entry) => entry.id)), sorted(index.cases.map((entry) => entry.id)));
  for (const provider of providers) {
    const models = catalog.models.filter((entry) => entry.provider === provider);
    const expected = index.cases.filter((entry) => entry.provider === provider);
    assert.equal(models.length, 5, provider);
    assert.deepEqual(models.map((entry) => entry.id), expected.map((entry) => entry.id), provider);
    assert.equal(models.filter((entry) => entry.comparison).length, 1, provider);
    assert.ok(models[0].comparison, `${provider}: the main-paper case provides the comparison`);
    for (const entry of models) {
      const source = caseSource(entry);
      const authority = paper.cases.find((item) => item.provider === provider && item.case === source.case);
      assert.ok(authority);
      assert.equal(entry.source, source.provider_slug);
      assert.equal(source.source_script, authority.source_script);
      assert.deepEqual(entry.edit_demo.parent.ids, authority.parent_ids);
      assert.deepEqual(entry.edit_demo.child.ids, authority.child_ids);
      assert.equal(entry.edit_demo.mode, 'precomputed_native_rebuild');
      assert.deepEqual(entry.edit_demo.variants.map((variant) => variant.id), expectedStates);
      assert.equal(entry.directory, entry.id);
      const base = entry.edit_demo.variants[0];
      for (const field of ['glb', 'snapshot', 'mesh_map', 'provenance', 'bytes']) assert.equal(entry[field], base[field]);
    }
  }
});

test('all 100 saved parameter states identify the intended source and native edit', async () => {
  let checked = 0;
  for (const entry of catalog.models) {
    const source = caseSource(entry);
    const metadata = await json(localAsset(data, `${entry.id}/edits/edit-demo.json`));
    assert.equal(metadata.id, entry.id);
    assert.equal(metadata.provider, entry.provider);
    assert.deepEqual(metadata.variants, entry.edit_demo.variants);
    const initial = await json(localAsset(data, entry.snapshot));
    const defaultNodes = new Map(initial.runtime.nodes.map((node) => [node.id, node]));
    for (const variant of entry.edit_demo.variants) {
      const prefix = `${entry.id}/edits/${variant.id}/`;
      for (const field of ['glb', 'snapshot', 'provenance', 'mesh_map']) assert.ok(variant[field].startsWith(prefix), variant[field]);
      const snapshot = await json(localAsset(data, variant.snapshot));
      const provenance = await json(localAsset(data, variant.provenance));
      assert.deepEqual(snapshot.provenance, provenance);
      assert.equal(provenance.source_file, source.source_script);
      assert.equal(provenance.source_sha256, initial.provenance.source_sha256);
      assert.equal(provenance.execution, 'full_source_from_empty_scene');
      assert.equal(provenance.parameter_mode, 'native_rebuild');
      assert.equal(provenance.native_part_params, true);
      assert.equal(provenance.edit.id, variant.id);
      assert.equal(provenance.edit.side, variant.side);
      assert.equal(provenance.edit.scale, variant.scale);
      assert.deepEqual(provenance.edit.paper_parent_ids, source.parent_ids);
      assert.deepEqual(provenance.edit.paper_child_ids, source.child_ids);
      const partIds = variant.side === 'default' ? [] : source[`${variant.side}_ids`];
      assert.deepEqual(provenance.edit.part_ids, partIds);
      const params = Object.fromEntries(partIds.map((id) => [`part_param|${id}|scale`, variant.scale]));
      assert.deepEqual(provenance.params, params);
      assert.deepEqual(provenance.edit.params, params);
      assert.deepEqual(snapshot.runtime.native_part_params.scale_overrides, Object.fromEntries(partIds.map((id) => [id, variant.scale])));
      for (const id of [...source.parent_ids, ...source.child_ids]) {
        const control = snapshot.schema.controls.find((item) => item.id === `part_param|${id}|scale`);
        assert.ok(control, `${entry.id}/${variant.id}: missing scale control for ${id}`);
        assert.equal(control.value, partIds.includes(id) ? variant.scale : 1);
      }
      for (const id of partIds) {
        const matching = snapshot.runtime.nodes.filter((node) => (node.part_id || node.id) === id);
        assert.ok(matching.length, `${entry.id}/${variant.id}: no runtime instances for ${id}`);
        assert.ok(matching.some((node) => node.dimensions.some((value, axis) => Math.abs(value - defaultNodes.get(node.id).dimensions[axis]) > 1e-5)), `${entry.id}/${variant.id}: geometry did not change for ${id}`);
      }
      assert.equal(provenance.edit.geometry_changed, partIds.length > 0);
      assert.doesNotMatch(JSON.stringify(snapshot), /\/Users\/|\/home\/|Bearer |api_key/i);
      checked += 1;
    }
  }
  assert.equal(checked, 100);
});

test('all 100 GLBs match their snapshots, mesh maps, hashes, and geometry bounds', async () => {
  let checked = 0;
  for (const entry of catalog.models) {
    for (const variant of entry.edit_demo.variants) {
      const glb = await readFile(localAsset(data, variant.glb));
      const snapshot = await json(localAsset(data, variant.snapshot));
      const meshMap = await json(localAsset(data, variant.mesh_map));
      assert.equal(glb.length, variant.bytes);
      assert.equal(sha256(glb), snapshot.provenance.glb_sha256);
      const actual = exportedMeshes(parseGlb(glb));
      assert.deepEqual(sorted(actual.keys()), sorted(snapshot.runtime.nodes.map((node) => node.id)), `${entry.id}/${variant.id}`);
      assert.deepEqual(sorted(actual.keys()), sorted(meshMap.map((mesh) => mesh.id)));
      const translation = snapshot.provenance.runtime_to_glb_translation;
      assert.equal(translation.length, 3);
      const tolerance = Math.max(1e-6, (snapshot.runtime.scene_extent || 1) * 2e-6);
      for (const node of snapshot.runtime.nodes) {
        const mesh = actual.get(node.id);
        const mapped = meshMap.find((item) => item.id === node.id);
        assert.equal(mesh.part_id, node.part_id || node.id);
        assert.equal(mesh.mesh_index, mapped.mesh_index);
        const low = node.bbox_min;
        const high = node.bbox_max;
        const expected = [[low[0], low[2], -high[1]], [high[0], high[2], -low[1]]];
        for (const [side, field] of ['bbox_min', 'bbox_max'].entries()) {
          for (let axis = 0; axis < 3; axis += 1) {
            assert.ok(Math.abs(mesh[field][axis] - mapped[field][axis]) <= tolerance, `${variant.glb}: mesh map mismatch ${node.id}`);
            assert.ok(Math.abs(mesh[field][axis] - expected[side][axis] - translation[axis]) <= tolerance, `${variant.glb}: runtime geometry mismatch ${node.id}`);
          }
        }
      }
      checked += 1;
    }
  }
  assert.equal(checked, 100);
});

test('all 120 paper PNGs preserve the recorded bytes and are connected to the correct case and state', async () => {
  let count = 0;
  let total = 0;
  const images = new Set();
  for (const entry of catalog.models) {
    const source = caseSource(entry);
    for (const [method, field] of [['tree', 'paper_renders'], ['baseline', 'comparison']]) {
      if (!source[method]) {
        assert.equal(entry[field], undefined);
        continue;
      }
      assert.deepEqual(entry[field].states.map((state) => state.id), expectedStates);
      for (const state of entry[field].states) {
        const original = source[method].states.find((item) => item.id === state.id);
        assert.ok(original);
        assert.equal(state.image, original.image);
        assert.ok(state.image.startsWith(`paper-demos/${entry.id}/${method}/`));
        assert.ok(!images.has(state.image));
        images.add(state.image);
        const bytes = await readFile(localAsset(explorer, state.image));
        assert.equal(sha256(bytes), original.sha256, state.image);
        assert.equal(bytes.length, original.bytes);
        assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
        assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
        assert.equal(bytes.readUInt32BE(16), state.width);
        assert.equal(bytes.readUInt32BE(20), state.height);
        assert.equal(state.width, original.width);
        assert.equal(state.height, original.height);
        count += 1;
        total += bytes.length;
      }
    }
  }
  assert.equal(count, 120);
  assert.equal(total, index.total_render_bytes);
});
