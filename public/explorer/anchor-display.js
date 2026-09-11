const finitePoint = (value) => Array.isArray(value)
  && value.length === 3
  && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));

const validId = (value) => typeof value === 'string' && value.length > 0;

/** Display saved or preview anchor coordinates independently of validation. */
export function displayAnchorPairs(edge) {
  if (!edge || !validId(edge.parent) || !validId(edge.child) || edge.parent === edge.child) return [];
  const pairs = [];
  const seen = new Set();
  for (const declaration of edge.declared_directions || []) {
    if (!finitePoint(declaration?.parent_anchor_world) || !finitePoint(declaration?.child_anchor_world)) continue;
    const parentId = declaration.parent || edge.parent;
    const childId = declaration.child || edge.child;
    if (!validId(parentId) || !validId(childId) || parentId === childId) continue;
    if (![edge.parent, edge.child].includes(parentId) || ![edge.parent, edge.child].includes(childId)) continue;
    const parent = [...declaration.parent_anchor_world];
    const child = [...declaration.child_anchor_world];
    const key = JSON.stringify([parentId, childId, parent, child]);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ parent, child, parentId, childId, kind: 'authored' });
  }
  if (pairs.length) return pairs;
  if (!finitePoint(edge.anchor_a) || !finitePoint(edge.anchor_b)) return [];
  // The Blender probe creates A/B in Python's sorted instance-ID order.
  // Its browser converter sets parent/child direction without swapping A/B.
  const parentIsA = edge.parent < edge.child;
  return [{
    parent: [...(parentIsA ? edge.anchor_a : edge.anchor_b)],
    child: [...(parentIsA ? edge.anchor_b : edge.anchor_a)],
    parentId: edge.parent,
    childId: edge.child,
    kind: 'estimated',
  }];
}

export function hasDisplayAnchors(edge) {
  return displayAnchorPairs(edge).length > 0;
}

/** Only saved verification may use the verified visual treatment. */
export function anchorDisplayVerified(edge) {
  return Boolean(edge && edge.preview_only !== true
    && edge.validation_status !== 'not_run' && edge.shared_anchor === true);
}

/** Keep undirected nearest-surface contact clouds out of the default display. */
export function isAnchorDisplayEdge(edge) {
  const pairs = displayAnchorPairs(edge);
  if (!pairs.length) return false;
  if (pairs.some((pair) => pair.kind === 'authored') || anchorDisplayVerified(edge)
    || edge.parent_child_known === true || edge.directed_verified === true) return true;
  return (edge.declared_directions || []).some((declaration) =>
    ['final_parent', 'parent_assignment'].includes(declaration.source)
    && declaration.parent !== declaration.child
    && [edge.parent, edge.child].includes(declaration.parent)
    && [edge.parent, edge.child].includes(declaration.child));
}
