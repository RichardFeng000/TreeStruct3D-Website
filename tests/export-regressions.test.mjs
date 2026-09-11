import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../public/explorer/vendor/three.module.min.js';
import { captureTransparentPng } from '../public/explorer/export-utils.js';

function fixture({ renderError, encodingError } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8f9fa);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x225588, opacity: 0.75, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0x33aa66, roughness: 0.6 }),
  ];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
  // This flag previously triggered an unrelated orange publication palette.
  mesh.userData.tree3dPublicationSurface = true;
  scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(46, 1.6, 0.03, 400);
  camera.position.set(3, 4, 7);
  camera.lookAt(0, 1, 0);
  const state = {
    size: new THREE.Vector2(1600, 900),
    pixelRatio: 2,
    clearColor: new THREE.Color(0xabcdef),
    clearAlpha: 0.4,
  };
  const original = {
    background: scene.background,
    projection: camera.projectionMatrix.clone(),
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    materialValues: materials.map((material) => material.toJSON()),
  };
  const renders = [];
  const renderer = {
    getSize(target) { return target.copy(state.size); },
    getPixelRatio() { return state.pixelRatio; },
    getClearColor(target) { return target.copy(state.clearColor); },
    getClearAlpha() { return state.clearAlpha; },
    setSize(width, height) { state.size.set(width, height); },
    setPixelRatio(value) { state.pixelRatio = value; },
    setClearColor(value, alpha) { state.clearColor.set(value); state.clearAlpha = alpha; },
    render(renderedScene, renderedCamera) {
      renders.push({
        size: state.size.clone(),
        pixelRatio: state.pixelRatio,
        clearColor: state.clearColor.getHex(),
        clearAlpha: state.clearAlpha,
        background: renderedScene.background,
        aspect: renderedCamera.aspect,
        materials: materials.map((material) => material.toJSON()),
      });
      if (renderError) throw renderError;
    },
  };
  let encodeCallback;
  let encodingType;
  const canvas = {
    toBlob(callback, type) {
      if (encodingError) throw encodingError;
      encodeCallback = callback;
      encodingType = type;
    },
  };
  function assertRestored() {
    assert.deepEqual(state.size.toArray(), [1600, 900]);
    assert.equal(state.pixelRatio, 2);
    assert.equal(state.clearColor.getHex(), 0xabcdef);
    assert.equal(state.clearAlpha, 0.4);
    assert.equal(scene.background, original.background);
    assert.equal(camera.aspect, 1.6);
    assert.deepEqual(camera.projectionMatrix.elements, original.projection.elements);
    assert.deepEqual(camera.position, original.position);
    assert.deepEqual(camera.quaternion.toArray(), original.quaternion.toArray());
    assert.equal(mesh.material, materials);
    assert.deepEqual(materials.map((material) => material.toJSON()), original.materialValues);
  }
  return {
    renderer, scene, camera, canvas, state, renders, original, assertRestored,
    get encodingType() { return encodingType; },
    finishEncoding(blob) { assert.equal(typeof encodeCallback, 'function'); encodeCallback(blob); },
  };
}

test('PNG capture preserves model colors and restores the live renderer before encoding completes', async () => {
  const f = fixture();
  const capture = captureTransparentPng(f.renderer, f.scene, f.camera, f.canvas);
  f.assertRestored();
  assert.equal(f.encodingType, 'image/png');
  assert.equal(f.renders.length, 1);
  assert.deepEqual(f.renders[0].size.toArray(), [3200, 1800]);
  assert.equal(f.renders[0].pixelRatio, 1);
  assert.equal(f.renders[0].clearColor, 0);
  assert.equal(f.renders[0].clearAlpha, 0);
  assert.equal(f.renders[0].background, null);
  assert.equal(f.renders[0].aspect, 3200 / 1800);
  assert.deepEqual(f.renders[0].materials, f.original.materialValues);

  let settled = false;
  const observed = capture.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'encoding is still pending after the live view has been restored');

  // A subsequent interaction must survive the late encoding callback.
  f.camera.aspect = 2.1;
  f.camera.updateProjectionMatrix();
  f.renderer.setSize(1000, 500);
  const blob = new Blob(['saved image'], { type: 'image/png' });
  f.finishEncoding(blob);
  assert.equal(await capture, blob);
  await observed;
  assert.equal(f.camera.aspect, 2.1);
  assert.deepEqual(f.state.size.toArray(), [1000, 500]);
});

for (const failure of ['renderError', 'encodingError']) {
  test(`PNG capture restores the live view when ${failure === 'renderError' ? 'rendering' : 'toBlob'} throws`, async () => {
    const error = new Error(`${failure} fixture`);
    const f = fixture({ [failure]: error });
    const capture = captureTransparentPng(f.renderer, f.scene, f.camera, f.canvas);
    const rejected = assert.rejects(capture, (actual) => actual === error);
    f.assertRestored();
    await rejected;
    f.assertRestored();
  });
}

test('PNG capture reports a null blob and keeps the live view restored', async () => {
  const f = fixture();
  const capture = captureTransparentPng(f.renderer, f.scene, f.camera, f.canvas);
  f.assertRestored();
  const rejected = assert.rejects(capture, /could not encode the image/);
  f.finishEncoding(null);
  await rejected;
  f.assertRestored();
});
