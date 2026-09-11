import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

const data = new URL('../public/explorer/data/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, data), 'utf8'));
const catalog = await json('manifest.json');

function parseGlb(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  return { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) };
}

function imageBytes(gltf, image) {
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.uri, undefined, 'Published GLBs embed their textures');
  const view = gltf.document.bufferViews[image.bufferView];
  return gltf.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
}

test('all twenty defaults preserve material export provenance and valid embedded texture coordinates', async () => {
  let textured = 0;
  for (const entry of catalog.models) {
    const bytes = await readFile(new URL(entry.glb, data));
    const gltf = parseGlb(bytes);
    const snapshot = await json(entry.snapshot);
    const provenance = await json(entry.provenance);
    const report = provenance.material_export;
    assert.ok(report, `${entry.id}: material export report`);
    assert.equal(report.geometry_unchanged, true);
    assert.equal(report.source_sha256, provenance.source_sha256);
    assert.equal(provenance.glb_sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(snapshot.provenance, provenance);
    assert.equal(entry.bytes, bytes.length);
    assert.equal(report.image_count, (gltf.document.images || []).length);
    assert.equal(report.lighting_baked, false);
    const textures = gltf.document.textures || [];
    for (const mesh of gltf.document.meshes) {
      for (const primitive of mesh.primitives) {
        const material = gltf.document.materials[primitive.material];
        const texture = material?.pbrMetallicRoughness?.baseColorTexture;
        if (!texture) continue;
        const coordinate = texture.extensions?.KHR_texture_transform?.texCoord ?? texture.texCoord ?? 0;
        const accessor = gltf.document.accessors[primitive.attributes[`TEXCOORD_${coordinate}`]];
        assert.ok(accessor, `${entry.id}: baked texture has matching UVs`);
        assert.equal(accessor.type, 'VEC2');
        assert.equal(accessor.count, gltf.document.accessors[primitive.attributes.POSITION].count);
        assert.ok(gltf.document.images[textures[texture.index].source]);
      }
    }
    for (const image of gltf.document.images || []) {
      const png = imageBytes(gltf, image);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(png.readUInt32BE(16) >= 256);
      assert.ok(png.readUInt32BE(20) >= 256);
    }
    if (report.image_count) textured += 1;
  }
  assert.ok(textured >= 8, 'Procedural material examples must retain their baked textures');
});

// Decode actual embedded PNG pixels so an empty/white/flat bake cannot pass
// merely by containing a texture descriptor and a plausible byte count.
function pngRgb(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 8);
  assert.equal(png[25], 2);
  assert.equal(png[28], 0);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return distances[0] <= distances[1] && distances[0] <= distances[2] ? a : distances[1] <= distances[2] ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x += 1) {
      const at = y * stride + x;
      const a = x >= 3 ? pixels[at - 3] : 0;
      const b = y ? pixels[at - stride] : 0;
      const c = y && x >= 3 ? pixels[at - stride - 3] : 0;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[at] = (encoded[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return pixels;
}

test('Spiny Lobster carries the source orange-red procedural variation instead of default white', async () => {
  const entry = catalog.models.find((item) => item.id === 'paper-gpt-5-6-sol-spiny-lobster');
  const gltf = parseGlb(await readFile(new URL(entry.glb, data)));
  assert.equal(gltf.document.images.length, 5);
  for (const material of gltf.document.materials) assert.ok(material.pbrMetallicRoughness.baseColorTexture);
  const pixels = pngRgb(imageBytes(gltf, gltf.document.images[0]));
  const colors = new Set();
  let visible = 0;
  let orangeRed = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const [r, g, b] = pixels.subarray(i, i + 3);
    if (r + g + b < 8) continue;
    visible += 1;
    if (r > g * 1.2 && g > b) orangeRed += 1;
    colors.add(`${r},${g},${b}`);
  }
  assert.ok(visible > pixels.length / 12, 'Baked UV islands contain colored surface pixels');
  assert.ok(orangeRed / visible > 0.98, 'The actual bake retains the source orange/red palette');
  assert.ok(colors.size > 100, 'The procedural noise has spatial color variation');
});
