// Paper renders remain discrete; browser geometry edits are continuous.
export function providerKey(example) {
  return String(example.provider_id || example.source || example.provider || 'examples');
}

export function providerLabel(example) {
  return String(example.provider_label || example.provider || example.source_label || example.source || 'Examples');
}

export function savedScales(example) {
  const scales = example.edit_demo?.scales;
  return Array.isArray(scales)
    ? [...new Set(scales.map(Number).filter((scale) => Number.isFinite(scale) && scale > 0))].sort((a, b) => a - b)
    : [0.4, 1, 1.6];
}

export function savedVariant(example, side = 'parent', scale = 1) {
  const variants = example.edit_demo?.variants;
  if (!Array.isArray(variants)) {
    return Number(scale) === 1 ? { ...example, id: 'default', side: 'default', scale: 1 } : null;
  }
  return variants.find((variant) => Number(scale) === 1
    ? variant.id === 'default' || variant.side === 'default'
    : variant.side === side && Number(variant.scale) === Number(scale)) || null;
}

export function editRole(example, side) {
  const role = example.edit_demo?.[side];
  const ids = [...new Set([...(Array.isArray(role?.ids) ? role.ids : []), role?.id].filter(Boolean).map(String))];
  return { ids, label: String(role?.label || ids.join(', ') || side) };
}

export function stateLabel(variant) {
  if (!variant || variant.id === 'default' || Number(variant.scale) === 1) return 'Original · 1×';
  return `${variant.side === 'parent' ? 'Parent' : 'Child'} · ${Number(variant.scale).toFixed(1)}×`;
}

function renderStates(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.states) ? value.states : [];
}

function renderStateId(state) {
  return String(state.id || state.state || '')
    .replace(/^(parent|child)_/, '$1-')
    .replace(/(\d)p(\d)/, '$1.$2');
}

export function hasPaperComparison(example) {
  const comparison = example?.comparison || example?.metadata?.comparison;
  const paper = example?.paper_renders || example?.metadata?.paper_renders;
  return renderStates(comparison).length > 0 && renderStates(paper).length > 0;
}

export function paperComparisonPair(example, variantId) {
  const comparison = example?.comparison || example?.metadata?.comparison;
  const paper = example?.paper_renders || example?.metadata?.paper_renders;
  const baseline = renderStates(comparison).find((state) => renderStateId(state) === variantId);
  const method = renderStates(paper).find((state) => renderStateId(state) === variantId);
  if (!baseline?.image || !method?.image) return null;
  return { baseline: baseline.image, method: method.image, baselineLabel: comparison?.label || '3DCodeBench' };
}

export function paperPreset(id) {
  if (id === 'default') return { id, side: 'default', scale: 1 };
  const match = /^(parent|child)-(0\.4|1\.6)$/.exec(id);
  return match ? { id, side: match[1], scale: Number(match[2]) } : null;
}

export function invalidatePreviewChecks(runtime) {
  runtime.preview_only = true;
  runtime.validation_status = 'not_run';
  runtime.parameter_invariance = null;
  for (const edge of runtime.edges || []) {
    edge.parent_child_known = Boolean(edge.parent_child_known || edge.directed_verified);
    Object.assign(edge, {
      preview_only: true, validation_status: 'not_run', directed_verified: false,
      shared_anchor: false, contact: null, geometric_anchor_aligned: null,
      shared_anchor_evidence: null, authored_anchor_valid: null,
      authored_anchor_count: null, authored_anchor_valid_count: null, authored_anchor_all_valid: null,
      child_anchor_vertex_gap: null, parent_anchor_vertex_gap: null,
      parameter_invariance: null, parameter_invariance_failed: null,
      anchor_method: 'browser_geometry_transform',
      evidence: 'Browser geometry preview; Blender checks have not been rerun.',
    });
    for (const declaration of edge.declared_directions || []) {
      declaration.authored_anchor_valid = null;
      declaration.authored_anchor_all_valid = null;
    }
  }
  return runtime;
}
