"""Bake the original Chameleon limb formula's subdivision and snap choices.

Run with Blender's Python, e.g.:
  blender -b --factory-startup --threads 1 --python bake-chameleon-limbs.py --

Only three original function definitions are compiled. The full research
program is never executed, and its source file is never changed. Subdivision
stencils use 28 basis evaluations per limb on a fixed 84-vertex mesh. Snap
tables execute the unmodified original formula with native mathutils vectors
and a lightweight vertex collector; real Blender meshes independently check
the collector before any output is accepted.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
import numpy as np


SITE = Path(__file__).resolve().parents[1]
RESEARCH = SITE.parent
LIMBS = ["forelimb_left", "forelimb_right", "hindlimb_left", "hindlimb_right"]


class Vertex:
    def __init__(self, coordinate, index):
        self.co = Vector(coordinate)
        self.index = index


class Vertices(list):
    def new(self, coordinate):
        vertex = Vertex(coordinate, len(self))
        self.append(vertex)
        return vertex


class Faces(list):
    def new(self, vertices):
        face = SimpleNamespace(vertices=list(vertices), use_smooth=False)
        self.append(face)
        return face


class CollectorBMesh:
    def __init__(self):
        self.verts = Vertices()
        self.faces = Faces()

    def to_mesh(self, mesh):
        mesh.vertices = self.verts
        mesh.polygons = self.faces

    def free(self):
        pass


class CollectorObject(dict):
    def __init__(self, name, mesh):
        super().__init__()
        self.name, self.data = name, mesh


def formula_namespace(source, collect=False):
    definitions = ast.parse(source.read_text())
    names = {"create_limb", "snap_and_get_anchor", "set_smooth_shading"}
    selected = [node for node in definitions.body if isinstance(node, ast.FunctionDef) and node.name in names]
    if len(selected) != len(names):
        raise ValueError("Original Chameleon formula definitions changed")
    namespace = {"__name__": "native_chameleon_formula", "math": math, "Vector": Vector, "Matrix": Matrix}
    if collect:
        namespace["bmesh"] = SimpleNamespace(new=CollectorBMesh, ops=SimpleNamespace(recalc_face_normals=lambda *args, **kwargs: None))
        namespace["bpy"] = SimpleNamespace(
            data=SimpleNamespace(
                meshes=SimpleNamespace(new=lambda name: SimpleNamespace(name=name, update=lambda: None)),
                objects=SimpleNamespace(new=CollectorObject),
            ),
            context=SimpleNamespace(collection=SimpleNamespace(objects=SimpleNamespace(link=lambda obj: None))),
        )
    else:
        namespace.update(bpy=bpy, bmesh=bmesh)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), namespace)
    return namespace


def parent_anchor(limb, torso_scale):
    """Original build_chameleon expression order, including float32 storage."""
    sign = -1 if "left" in limb else 1
    hind = limb.startswith("hind")
    torso_width = 1.3 * torso_scale
    torso_length = 3.2 * torso_scale
    torso_height = .9 * torso_scale
    local = Vector((sign * torso_width * (.38 if hind else .4), (-1 if hind else 1) * torso_length * .23, -torso_height * .1))
    return Matrix.Translation(Vector((0, 0, .9 * torso_scale))) @ local


def create(namespace, limb, torso_scale, limb_scale, snap=True):
    anchor = parent_anchor(limb, torso_scale)
    obj = namespace["create_limb"](limb, {"scale": limb_scale}, "left" if "left" in limb else "right", limb.startswith("hind"), anchor.z)
    target = Vector((0, 0, 0))
    closest = min(obj.data.vertices, key=lambda vertex: (vertex.co - target).length)
    index = closest.index
    if snap:
        namespace["snap_and_get_anchor"](obj, target)
    return obj, index, anchor


def coarse_positions(obj):
    return np.asarray([tuple(vertex.co) for vertex in obj.data.vertices], dtype=np.float32)


def evaluated_positions(obj):
    obj.data.update()
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        positions = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", positions)
        return positions.reshape((-1, 3)).copy()
    finally:
        evaluated.to_mesh_clear()


def remove_object(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)


def correspondence(actual, reference):
    if actual.shape != reference.shape:
        raise ValueError(f"Native evaluated vertex count differs: {actual.shape} != {reference.shape}")
    if np.max(np.linalg.norm(actual - reference, axis=1)) < 2e-6:
        return np.arange(len(reference)), 0.0
    kd = KDTree(len(actual))
    for index, point in enumerate(actual):
        kd.insert(point, index)
    kd.balance()
    matches = [kd.find(point) for point in reference]
    order = np.asarray([match[1] for match in matches], dtype=np.int64)
    maximum = max(match[2] for match in matches)
    if len(set(order.tolist())) != len(reference) or maximum > 2e-6:
        raise ValueError(f"Cannot bind subdivision output to canonical native vertices: distance={maximum}")
    return order, maximum


def weights_for(obj, order):
    count = len(obj.data.vertices)
    basis = np.zeros((count, 3), dtype=np.float32)
    result = np.empty((len(order), count), dtype=np.float32)
    for start in range(0, count, 3):
        basis.fill(0)
        for axis in range(min(3, count - start)):
            basis[start + axis, axis] = 1
        obj.data.vertices.foreach_set("co", basis.ravel())
        evaluated = evaluated_positions(obj)[order]
        for axis in range(min(3, count - start)):
            result[:, start + axis] = evaluated[:, axis]
    if np.max(np.abs(result.sum(axis=1) - 1)) > 1e-6:
        raise ValueError("Subdivision matrix rows do not sum to one")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=RESEARCH / "treestruct3d_results/gemini_3.5_flash/Chameleon_seed0/Chameleon_seed0.py")
    parser.add_argument("--native-cache", type=Path, default=Path("/tmp/treestruct-native-response/paper-gemini-3-5-flash-chameleon"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/treestruct-native-chameleon-procedural"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    original = formula_namespace(args.source)
    collector = formula_namespace(args.source, collect=True)
    native_meta = json.loads((args.native_cache / "default/geometry.json").read_text())
    native_local = np.fromfile(args.native_cache / "default/local.f32", dtype="<f4").reshape((-1, 3))
    native_parts = {mesh["id"]: mesh for mesh in native_meta["meshes"]}
    chunks, offset = [], 0
    descriptors, validation, fixtures = [], [], []
    all_weights = {}

    def field(array):
        nonlocal offset
        array = np.asarray(array, dtype="<f4").reshape(-1)
        descriptor = {"offset": offset, "count": int(array.size)}
        offset += int(array.size)
        chunks.append(array)
        return descriptor

    scales = [round(.4 + .01 * index, 2) for index in range(121)]
    check_pairs = [(1, 1), (.63, 1), (1.37, 1), (1, .63), (1, 1.37), (.63, 1.37), (1.37, .63), (.4, 1.6), (1.6, .4)]
    started = time.monotonic()
    for limb in LIMBS:
        obj, snap_index, _ = create(original, limb, 1, 1)
        if len(obj.data.vertices) != 84:
            raise ValueError(f"Original coarse vertex count changed: {limb}")
        baseline_coarse = coarse_positions(obj)
        modifier = obj.modifiers.new(name="Native Subdiv", type="SUBSURF")
        modifier.levels = modifier.render_levels = 2
        actual = evaluated_positions(obj)
        part = native_parts[limb]
        reference = native_local[part["vertex_offset"]:part["vertex_offset"] + part["vertex_count"]]
        order, binding_error = correspondence(actual, reference)
        weights = weights_for(obj, order)
        all_weights[limb] = weights
        predicted = weights.astype(np.float64) @ baseline_coarse.astype(np.float64)
        baseline_error = float(np.linalg.norm(predicted - reference, axis=1).max())
        if baseline_error > 2e-6:
            raise ValueError(f"Subdivision baseline reconstruction differs: {limb} {baseline_error}")
        remove_object(obj)

        formula_error, evaluated_error = 0.0, 0.0
        for torso_scale, limb_scale in check_pairs:
            real, real_snap, anchor = create(original, limb, torso_scale, limb_scale)
            fake, fake_snap, _ = create(collector, limb, torso_scale, limb_scale)
            r, f = coarse_positions(real), coarse_positions(fake)
            error = float(np.linalg.norm(r - f, axis=1).max())
            if real_snap != fake_snap or error != 0:
                raise ValueError(f"Collector differs from original BMesh: {limb} at {torso_scale},{limb_scale}; snap={real_snap}/{fake_snap}, error={error}")
            formula_error = max(formula_error, error)
            modifier = real.modifiers.new(name="Native Subdiv", type="SUBSURF")
            modifier.levels = modifier.render_levels = 2
            actual = evaluated_positions(real)[order]
            prediction = weights.astype(np.float64) @ f.astype(np.float64)
            error = float(np.linalg.norm(actual - prediction, axis=1).max())
            evaluated_error = max(evaluated_error, error)
            if error > 2e-6:
                raise ValueError(f"Subdivision reconstruction differs: {limb} at {torso_scale},{limb_scale}: {error}")
            fixtures.append({"limb": limb, "torso_scale": torso_scale, "limb_scale": limb_scale, "snap_index": real_snap, "anchor": list(anchor), "coarse_positions": f.tolist(), "native_world_positions": (actual + np.asarray(anchor)).tolist()})
            remove_object(real)

        snaps = np.empty((121, 121), dtype=np.float32)
        for ti, torso_scale in enumerate(scales):
            for li, limb_scale in enumerate(scales):
                fake, index, _ = create(collector, limb, torso_scale, limb_scale, snap=False)
                snaps[ti, li] = index
            if ti % 30 == 0:
                print(json.dumps({"limb": limb, "snap_rows": ti + 1, "elapsed_seconds": round(time.monotonic() - started, 1)}), flush=True)
        descriptors.append({"type": "chameleon_limb", "id": limb, "torso_control": "torso_body", "limb_control": limb, "side": "left" if "left" in limb else "right", "is_hind": limb.startswith("hind"), "coarse_count": 84, "vertex_count": len(order), "weights": field(weights), "snap_indices": field(snaps), "snap_scales": {"min": .4, "step": .01, "count": 121}})
        validation.append({"id": limb, "baseline_snap_index": snap_index, "canonical_order_identity": bool(np.array_equal(order, np.arange(len(order)))), "binding_max_error": binding_error, "baseline_max_error": baseline_error, "collector_vs_real_coarse_max_error": formula_error, "subdivision_heldout_max_error": evaluated_error, "tested_pairs": check_pairs, "snap_indices_used": sorted(int(value) for value in np.unique(snaps)), "row_sum_max_error": float(np.max(np.abs(weights.sum(axis=1) - 1)))})

    # Compare against every existing full-model native capture, independently of
    # the collector-vs-mesh checks above. Reuse source float32 formula semantics.
    captures = []
    for path in sorted(args.native_cache.glob("*/geometry.json")):
        meta = json.loads(path.read_text())
        positions_path = path.parent / "positions.f32"
        if not positions_path.exists():
            continue
        native_world = np.fromfile(positions_path, dtype="<f4").reshape((-1, 3))
        parts = {mesh["id"]: mesh for mesh in meta["meshes"]}
        errors = {}
        for limb in LIMBS:
            fake, _, anchor = create(collector, limb, meta["params"].get("torso_body", 1), meta["params"].get(limb, 1))
            prediction = all_weights[limb].astype(np.float64) @ coarse_positions(fake).astype(np.float64) + np.asarray(anchor)
            part = parts[limb]
            truth = native_world[part["vertex_offset"]:part["vertex_offset"] + part["vertex_count"]]
            if truth.shape != prediction.shape:
                raise ValueError(f"Captured full-model topology differs for {path.parent.name}/{limb}")
            errors[limb] = float(np.linalg.norm(prediction - truth, axis=1).max())
        captures.append({"id": meta["id"], "params": meta["params"], "max_errors": errors})
    maximum_capture_error = max((value for capture in captures for value in capture["max_errors"].values()), default=0)
    if maximum_capture_error > 3e-6:
        raise ValueError(f"Full-model native comparison failed: {maximum_capture_error}")
    binary = np.concatenate(chunks).astype("<f4").tobytes()
    header = {"version": 1, "binary": "procedural.bin", "binary_sha256": hashlib.sha256(binary).hexdigest(), "float_element_offsets": True, "source": str(args.source.relative_to(RESEARCH)), "source_sha256": source_hash, "procedural": descriptors, "validation": {"limbs": validation, "full_native_capture_count": len(captures), "full_native_max_error": maximum_capture_error, "full_native_captures": captures, "scope": "Original source formula and native mathutils; real coarse-mesh, Subsurf2, and independently captured full-model checks. Snap indices cover only the 0.01 UI lattice."}}
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise ValueError("Research source changed during bake")
    (args.output / "procedural.bin").write_bytes(binary)
    (args.output / "procedural.json").write_text(json.dumps(header, indent=2) + "\n")
    (args.output / "validation-fixtures.json").write_text(json.dumps({"fixtures": fixtures}, separators=(",", ":")) + "\n")
    print(json.dumps({"output": str(args.output), "bytes": len(binary), "full_native_captures": len(captures), "full_native_max_error": maximum_capture_error, "elapsed_seconds": round(time.monotonic() - started, 1)}), flush=True)


if __name__ == "__main__":
    main()
