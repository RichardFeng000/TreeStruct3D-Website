try {
  await import('./inspector.js');
} catch (error) {
  const status = document.getElementById('viewer-status');
  status.className = 'viewer-status error';
  status.textContent = 'The 3D viewer could not start. Enable WebGL in a current browser, then reload this page.';
  document.getElementById('graph-status').textContent = '3D viewer unavailable';
  document.getElementById('loading').classList.remove('visible');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload viewer';
  retry.addEventListener('click', () => location.reload());
  document.getElementById('controls').append(retry);
  console.error('TreeStruct3D viewer initialization failed:', error);
}
