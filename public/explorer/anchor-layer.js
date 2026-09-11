import * as THREE from './vendor/three.module.min.js';
import { displayAnchorPairs, anchorDisplayVerified, isAnchorDisplayEdge } from './anchor-display.js';

const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const finiteVector = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);

/** Persistent geometry annotations, independent of part-selection highlighting. */
export function createAnchorLayer(scene, pointToWorld) {
  const group = new THREE.Group();
  group.name = 'model-attachment-anchors';
  scene.add(group);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const parentMaterial = new THREE.MeshBasicMaterial({ color: 0xffc107, depthTest: false, depthWrite: false, toneMapped: false });
  const childMaterial = new THREE.MeshBasicMaterial({ color: 0x00acc1, depthTest: false, depthWrite: false, toneMapped: false });
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x607d9b, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false });
  const records = new Map();
  const bounds = new THREE.Box3(), extent = new THREE.Vector3();
  let disposed = false;

  function worldPoint(point) {
    if (!finitePoint(point)) return null;
    const world = pointToWorld(point);
    return finiteVector(world) ? world : null;
  }

  function makePair(key) {
    const pairGroup = new THREE.Group();
    pairGroup.name = 'attachment-anchor-pair';
    const parent = new THREE.Mesh(sphere, parentMaterial);
    const child = new THREE.Mesh(sphere, childMaterial);
    parent.name = 'parent-anchor'; child.name = 'child-anchor';
    parent.renderOrder = child.renderOrder = 15;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, lineMaterial);
    line.name = 'anchor-pair-segment'; line.renderOrder = 14;
    // The endpoint buffer moves every frame; do not retain an old culling sphere.
    line.frustumCulled = false;
    pairGroup.add(parent, child, line);
    group.add(pairGroup);
    const record = { group: pairGroup, parent, child, line };
    records.set(key, record);
    return record;
  }

  function removePair(key, record) {
    group.remove(record.group);
    record.line.geometry.dispose();
    records.delete(key);
  }

  function update(runtime, { visible = true, partIds = null } = {}) {
    if (disposed) return;
    group.visible = Boolean(visible);
    const filter = partIds === null ? null : new Set(partIds);
    bounds.makeEmpty();
    for (const node of runtime?.nodes || []) {
      for (const point of [node.bbox_min, node.bbox_max]) {
        const world = worldPoint(point);
        if (world) bounds.expandByPoint(world);
      }
    }
    const diagonal = bounds.isEmpty() ? 1 : bounds.getSize(extent).length();
    const radius = Math.max(diagonal * 0.005, 1e-5);
    const coincidenceSquared = Math.max(diagonal * 1e-7, 1e-9) ** 2;
    const activeKeys = new Set();
    let visiblePairCount = 0, pointCount = 0;
    for (const [edgeIndex, edge] of (runtime?.edges || []).entries()) {
      if (!isAnchorDisplayEdge(edge)) continue;
      for (const [pairIndex, pair] of displayAnchorPairs(edge).entries()) {
        const parentPoint = worldPoint(pair.parent), childPoint = worldPoint(pair.child);
        if (!parentPoint || !childPoint) continue;
        // Coordinates are intentionally absent from the key, so dragging reuses objects.
        const key = JSON.stringify([edgeIndex, pairIndex, pair.parentId, pair.childId]);
        activeKeys.add(key);
        const record = records.get(key) || makePair(key);
        const metadata = { parentId: pair.parentId, childId: pair.childId, kind: pair.kind, verified: anchorDisplayVerified(edge) };
        record.group.userData.anchorPair = metadata;
        record.parent.userData.anchorEndpoint = { ...metadata, partId: pair.parentId, side: 'parent' };
        record.child.userData.anchorEndpoint = { ...metadata, partId: pair.childId, side: 'child' };
        record.parent.position.copy(parentPoint);
        record.child.position.copy(childPoint);
        record.parent.scale.setScalar(radius);
        record.child.scale.setScalar(radius);
        const positions = record.line.geometry.getAttribute('position');
        positions.setXYZ(0, parentPoint.x, parentPoint.y, parentPoint.z);
        positions.setXYZ(1, childPoint.x, childPoint.y, childPoint.z);
        positions.needsUpdate = true;
        const showParent = filter === null || filter.has(pair.parentId);
        const showChild = filter === null || filter.has(pair.childId);
        const coincide = parentPoint.distanceToSquared(childPoint) <= coincidenceSquared;
        record.parent.visible = showParent;
        record.child.visible = showChild && !(showParent && coincide);
        record.line.visible = showParent && showChild && !coincide;
        record.group.visible = showParent || showChild;
        if (record.group.visible) visiblePairCount += 1;
        pointCount += Number(record.parent.visible) + Number(record.child.visible);
      }
    }
    for (const [key, record] of records) if (!activeKeys.has(key)) removePair(key, record);
    group.userData.pairCount = records.size;
    group.userData.visiblePairCount = visiblePairCount;
    group.userData.pointCount = pointCount;
  }

  return {
    group,
    update,
    setVisible(visible) { if (!disposed) group.visible = Boolean(visible); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [key, record] of records) removePair(key, record);
      sphere.dispose(); parentMaterial.dispose(); childMaterial.dispose(); lineMaterial.dispose();
      scene.remove(group);
    },
  };
}
