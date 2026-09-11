import assert from 'node:assert/strict';
import test from 'node:test';
import { displayAnchorPairs, hasDisplayAnchors, anchorDisplayVerified, isAnchorDisplayEdge } from '../public/explorer/anchor-display.js';

function authoredEdge() {
  return {
    parent: 'body', child: 'leg', shared_anchor: false, authored_anchor_valid: false,
    declared_directions: [{ parent: 'body', child: 'leg', parent_anchor_world: [1, 2, 3], child_anchor_world: [1, 2.2, 3], authored_anchor_valid: false }],
    anchor_a: [9, 9, 9], anchor_b: [8, 8, 8],
  };
}

test('unverified authored anchors remain visible and are never marked verified', () => {
  const edge = authoredEdge();
  assert.deepEqual(displayAnchorPairs(edge), [{ parent: [1, 2, 3], child: [1, 2.2, 3], parentId: 'body', childId: 'leg', kind: 'authored' }]);
  assert.equal(hasDisplayAnchors(edge), true);
  assert.equal(anchorDisplayVerified(edge), false);
});

test('preview coordinates remain visible even after validation flags are cleared', () => {
  const edge = { ...authoredEdge(), preview_only: true, validation_status: 'not_run', contact: null, authored_anchor_valid: null, shared_anchor: false };
  assert.equal(displayAnchorPairs(edge).length, 1);
  assert.equal(anchorDisplayVerified(edge), false);
  assert.equal(anchorDisplayVerified({ ...edge, shared_anchor: true }), false);
  assert.equal(anchorDisplayVerified({ ...edge, preview_only: false, shared_anchor: true }), false);
});

test('distinct authored pairs are retained, exact duplicates removed, and source objects unchanged', () => {
  const edge = authoredEdge();
  edge.declared_directions.push(structuredClone(edge.declared_directions[0]));
  edge.declared_directions.push({ parent: 'body', child: 'leg', parent_anchor_world: [-1, 2, 3], child_anchor_world: [-1, 2.2, 3] });
  const original = structuredClone(edge);
  const pairs = displayAnchorPairs(edge);
  assert.equal(pairs.length, 2);
  pairs[0].parent[0] = 999;
  assert.deepEqual(edge, original);
});

test('estimated endpoints follow canonical probe ordering rather than parent-child direction', () => {
  const edge = { parent: 'pedestal_arm', child: 'base_stand', anchor_a: [1, 0, 0], anchor_b: [2, 0, 0] };
  assert.deepEqual(displayAnchorPairs(edge), [{ parent: [2, 0, 0], child: [1, 0, 0], parentId: 'pedestal_arm', childId: 'base_stand', kind: 'estimated' }]);
  assert.deepEqual(displayAnchorPairs({ ...edge, parent: 'base_stand', child: 'pedestal_arm' })[0].parent, [1, 0, 0]);
});

test('nonfinite or incomplete pairs are filtered without hiding valid fallback coordinates', () => {
  const edge = authoredEdge();
  edge.declared_directions[0].parent_anchor_world = [Number.NaN, 2, 3];
  assert.equal(displayAnchorPairs(edge)[0].kind, 'estimated');
  edge.anchor_b = [0, Number.POSITIVE_INFINITY, 0];
  assert.deepEqual(displayAnchorPairs(edge), []);
  assert.equal(hasDisplayAnchors(edge), false);
  assert.deepEqual(displayAnchorPairs({ ...edge, anchor_b: [0, 0] }), []);
  assert.deepEqual(displayAnchorPairs({ ...edge, anchor_b: ['0', 0, 0] }), []);
  assert.deepEqual(displayAnchorPairs(null), []);
});

test('verified styling requires the exact saved shared-anchor boolean and no preview state', () => {
  assert.equal(anchorDisplayVerified({ shared_anchor: true }), true);
  assert.equal(anchorDisplayVerified({ shared_anchor: 1 }), false);
  assert.equal(anchorDisplayVerified({ shared_anchor: true, preview_only: true }), false);
  assert.equal(anchorDisplayVerified(null), false);
});

test('default anchor display excludes undirected estimated contact clouds', () => {
  const contact = { parent: 'body', child: 'leaf', relation: 'COUPLED', contact: true, anchor_a: [0, 0, 0], anchor_b: [0.1, 0, 0] };
  assert.equal(hasDisplayAnchors(contact), true);
  assert.equal(isAnchorDisplayEdge(contact), false);
  assert.equal(isAnchorDisplayEdge({ ...contact, relation: 'UNDIRECTED_CONTACT' }), false);
  assert.equal(isAnchorDisplayEdge({ ...contact, parent_child_known: true }), true);
  assert.equal(isAnchorDisplayEdge({ ...contact, directed_verified: true }), true);
  assert.equal(isAnchorDisplayEdge({ ...contact, shared_anchor: true }), true);
  assert.equal(isAnchorDisplayEdge(authoredEdge()), true);
});

test('explicit saved Blender parent declarations qualify estimated coordinates during preview', () => {
  const edge = { parent: 'body', child: 'leaf', preview_only: true, shared_anchor: false, anchor_a: [0, 0, 0], anchor_b: [0.1, 0, 0], declared_directions: [{ parent: 'body', child: 'leaf', source: 'final_parent' }] };
  assert.equal(isAnchorDisplayEdge(edge), true);
  assert.equal(isAnchorDisplayEdge({ ...edge, anchor_b: null }), false);
  assert.equal(isAnchorDisplayEdge({ ...edge, declared_directions: [{ parent: 'unrelated', child: 'leaf', source: 'final_parent' }] }), false);
});
