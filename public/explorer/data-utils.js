export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function assetUrl(relative, root) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\\')) {
    throw new Error('Invalid example asset path.');
  }
  const url = new URL(relative, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
    throw new Error('Example assets must stay in the published data directory.');
  }
  return url.href;
}

export function validateSnapshot(snapshot) {
  const runtime = snapshot?.runtime;
  if (!snapshot?.schema || !snapshot?.structure?.views || !Array.isArray(runtime?.nodes) || !runtime.nodes.length || !Array.isArray(runtime.edges)) {
    throw new Error('This example is missing its saved structure data.');
  }
  const ids = new Set(runtime.nodes.map((node) => node.id));
  if (ids.size !== runtime.nodes.length || runtime.edges.some((edge) => !ids.has(edge.parent) || !ids.has(edge.child))) {
    throw new Error('The saved structure contains an invalid part relationship.');
  }
  return snapshot;
}

export function displayName(value) {
  return String(value).replace(/_seed0$/i, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function snapshotCounts(runtime) {
  return {
    parts: runtime.nodes.length,
    shared: runtime.edges.filter((edge) => edge.shared_anchor === true).length,
    relations: runtime.edges.length,
    broken: runtime.edges.filter((edge) => edge.relation === 'BROKEN_ATTACHMENT' || edge.relation === 'MISALIGNED_ANCHOR').length,
  };
}
