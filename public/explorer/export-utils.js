import { Color, Vector2 } from './vendor/three.module.min.js';

// toBlob snapshots the rendered canvas immediately. Restore the live view in
// the same task, before the user can rotate it or switch models during encoding.
export function captureTransparentPng(renderer, scene, camera, canvas) {
  const size = renderer.getSize(new Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const aspect = camera.aspect;
  const background = scene.background;
  const clearColor = renderer.getClearColor(new Color()).clone();
  const clearAlpha = renderer.getClearAlpha();
  const scale = Math.min(2, 3840 / Math.max(size.x, size.y, 1));
  const width = Math.max(1, Math.round(size.x * scale));
  const height = Math.max(1, Math.round(size.y * scale));
  return new Promise((resolve, reject) => {
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scene.background = null;
      renderer.setClearColor(0, 0);
      renderer.render(scene, camera);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')), 'image/png');
    } catch (error) {
      reject(error);
    } finally {
      scene.background = background;
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  });
}
