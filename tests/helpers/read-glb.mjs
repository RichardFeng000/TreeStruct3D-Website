import * as THREE from '../../public/explorer/vendor/three.module.min.js';

// Read real exported buffers in Node, without browser texture decoding.
// Geometry, hierarchy, vertex splitting and transforms match the saved glTF.
export function readGLB(bytes) {
  const jsonSize = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize));
  const binary = bytes.subarray(28 + jsonSize);
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const components = {
    5120: [Int8Array, 'readInt8', 1], 5121: [Uint8Array, 'readUInt8', 1],
    5122: [Int16Array, 'readInt16LE', 2], 5123: [Uint16Array, 'readUInt16LE', 2],
    5125: [Uint32Array, 'readUInt32LE', 4], 5126: [Float32Array, 'readFloatLE', 4],
  };
  function attribute(index) {
    const accessor = document.accessors[index];
    const view = document.bufferViews[accessor.bufferView];
    const [ArrayType, read, bytesPerComponent] = components[accessor.componentType];
    const itemSize = sizes[accessor.type];
    const array = new ArrayType(accessor.count * itemSize);
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    for (let i = 0; i < accessor.count; i += 1) {
      for (let axis = 0; axis < itemSize; axis += 1) {
        array[i * itemSize + axis] = binary[read](offset + i * (view.byteStride || itemSize * bytesPerComponent) + axis * bytesPerComponent);
      }
    }
    return new THREE.BufferAttribute(array, itemSize, accessor.normalized || false);
  }
  const objects = document.nodes.map((node) => {
    const pieces = (document.meshes?.[node.mesh]?.primitives || []).map((primitive, index) => {
      const geometry = new THREE.BufferGeometry();
      for (const [source, target] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
        if (primitive.attributes[source] !== undefined) geometry.setAttribute(target, attribute(primitive.attributes[source]));
      }
      if (primitive.indices !== undefined) geometry.setIndex(attribute(primitive.indices));
      const material = new THREE.MeshStandardMaterial();
      material.name = document.materials?.[primitive.material]?.name || '';
      const pbr = document.materials?.[primitive.material]?.pbrMetallicRoughness;
      if (pbr?.baseColorFactor) material.color.fromArray(pbr.baseColorFactor);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${THREE.PropertyBinding.sanitizeNodeName(node.name || '')}_${index}`;
      return mesh;
    });
    const object = pieces.length === 1 ? pieces[0] : new THREE.Group();
    if (pieces.length > 1) object.add(...pieces);
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name || '');
    object.userData = { ...node.extras };
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      object.position.fromArray(node.translation || [0, 0, 0]);
      object.quaternion.fromArray(node.rotation || [0, 0, 0, 1]);
      object.scale.fromArray(node.scale || [1, 1, 1]);
    }
    return object;
  });
  document.nodes.forEach((node, index) => (node.children || []).forEach((child) => objects[index].add(objects[child])));
  const root = new THREE.Group();
  document.scenes[document.scene || 0].nodes.forEach((index) => root.add(objects[index]));
  root.updateMatrixWorld(true);
  return { root, document };
}
