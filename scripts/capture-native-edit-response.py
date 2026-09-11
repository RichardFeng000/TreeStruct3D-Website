"""Blender-only geometry truth capture for native PART_PARAMS response analysis.

Usage: blender -b --factory-startup --python capture-native-edit-response.py --
       --request /tmp/request.json
Request: {source, probe, output, states:[{id, params:{part_id: scale}}]}.
Coordinates remain original Blender world coordinates, without recentering.
This instrumented native execution does not modify source programs on disk.
"""
from __future__ import annotations

import argparse
import ast
import builtins
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree


def stabilize_bmesh(bm):
    """Freeze primitive ordering, including the input order for seeded sampling.

    BMesh can return a different allocation order on each execution. Sorting
    primitive elements changes no surface, but makes the source's seeded face
    sampling reproducible. Called before parameter-dependent deformations.
    """
    extent = max((abs(value) for vertex in bm.verts for value in vertex.co), default=1) or 1
    def ranked_sort(sequence, key):
        ranks = {element: index for index, element in enumerate(sorted(sequence, key=key))}
        sequence.sort(key=lambda element: ranks[element])
    ranked_sort(bm.verts, lambda vertex: tuple(round(value / extent, 7) for value in vertex.co))
    bm.verts.index_update()
    ranked_sort(bm.edges, lambda edge: tuple(sorted(vertex.index for vertex in edge.verts)))
    bm.edges.index_update()
    ranked_sort(bm.faces, lambda face: tuple(sorted(vertex.index for vertex in face.verts)))
    bm.faces.index_update()


class StablePrimitives(ast.NodeTransformer):
    def visit_Expr(self, node):
        if isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == "bmesh.ops.create_uvsphere":
            return [node, ast.copy_location(ast.Expr(ast.Call(ast.Name("__pcg_stabilize_bmesh__", ast.Load()), [node.value.args[0]], [])), node)]
        return self.generic_visit(node)


def stable_nearest(items, *, key):
    """Resolve mathematically tied nearest vertices without float-noise flips."""
    candidates = [(float(key(item)), item) for item in items]
    distance = min(row[0] for row in candidates)
    tolerance = max(1e-12, abs(distance) * 1e-5)
    return min((item for value, item in candidates if value <= distance + tolerance), key=lambda item: item.index)


class StableNearest(ast.NodeTransformer):
    def visit_FunctionDef(self, node):
        if node.name not in ("nearest_anchor_in_objects", "retained_surface_anchor"):
            return node
        for child in ast.walk(node):
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "min":
                child.func.id = "__pcg_stable_nearest__"
        return node


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    request = json.loads(args.request.read_text())
    source = Path(request["source"]).resolve()
    output = Path(request["output"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("native_probe", request["probe"])
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    if request.get("stable_primitives") or request.get("stable_nearest"):
        def stable_compile(tree, filename, mode):
            if request.get("stable_primitives"):
                tree = StablePrimitives().visit(tree)
            if request.get("stable_nearest"):
                tree = StableNearest().visit(tree)
            return builtins.compile(ast.fix_missing_locations(tree), filename, mode)
        probe.compile = stable_compile
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    metadata = {"schema_version": 1, "coordinate_system": "Blender world Z-up; no export normalization", "source_sha256": source_hash, "states": []}
    metadata["replay_adapter"] = {"stable_primitives": bool(request.get("stable_primitives")), "canonical_meshes": request.get("canonical_meshes", []), "stable_nearest": bool(request.get("stable_nearest")), "nearest_tie_tolerance": "max(1e-12, minimum_squared_distance * 1e-5); lowest original vertex index" if request.get("stable_nearest") else None}
    os.chdir(source.parent)
    sys.path.insert(0, str(source.parent))
    sys.argv = [str(source)]
    canonical = {}
    default_geometry = output / "default" / "geometry.json"
    if default_geometry.exists() and (output / "default" / "local.f32").exists():
        old = json.loads(default_geometry.read_text())
        local = np.fromfile(output / "default" / "local.f32", dtype="<f4").reshape((-1, 3))
        for part in old["meshes"]:
            canonical[part["id"]] = local[part["vertex_offset"]:part["vertex_offset"] + part["vertex_count"]].copy()
    for state in request["states"]:
        started = time.monotonic()
        probe._clear_scene(bpy)
        for collection in (bpy.data.materials, bpy.data.textures, bpy.data.images):
            for item in list(collection):
                if item.users == 0:
                    collection.remove(item)
        random.seed(0)
        np.random.seed(0)
        links = []

        def record(child, parent, kind, line, child_anchor_local=None, parent_anchor_local=None):
            child = probe._unwrap_object(child, bpy)
            parent = probe._unwrap_object(parent, bpy)
            if child is not None and parent is not None and child_anchor_local is not None and parent_anchor_local is not None:
                links.append((parent, child, Vector(parent_anchor_local), Vector(child_anchor_local)))

        code, helpers, params = probe._instrumented_code(str(source), state.get("params", {}))
        if not set(state.get("params", {})) <= set(params):
            raise ValueError("Unknown native part parameter")
        namespace = {"__name__": "__main__", "__file__": str(source), "__package__": None, "__pcg_capture_join__": lambda: None, "__pcg_record_link__": record, "__pcg_stabilize_bmesh__": stabilize_bmesh, "__pcg_stable_nearest__": stable_nearest}
        exec(code, namespace)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        directory = output / state["id"]
        directory.mkdir(parents=True, exist_ok=True)
        meshes, positions, triangles, material_ids, normals, local_positions = [], [], [], [], [], []
        offset = 0
        topology = hashlib.sha256()
        for obj in sorted(bpy.context.scene.objects, key=lambda item: item.name):
            if obj.type != "MESH" or obj.hide_render:
                continue
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                mesh.calc_loop_triangles()
                co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
                mesh.vertices.foreach_get("co", co)
                co = co.reshape((-1, 3))
                matrix = np.array(evaluated.matrix_world, dtype=np.float64)
                world = (co @ matrix[:3, :3].T + matrix[:3, 3]).astype("<f4")
                normal = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
                mesh.vertices.foreach_get("normal", normal)
                normal = normal.reshape((-1, 3)) @ np.linalg.inv(matrix[:3, :3])
                normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-20)
                indices = np.empty(len(mesh.loop_triangles) * 3, dtype=np.uint32)
                mesh.loop_triangles.foreach_get("vertices", indices)
                materials = np.empty(len(mesh.loop_triangles), dtype=np.int32)
                mesh.loop_triangles.foreach_get("material_index", materials)
                part_id = str(obj.get("stage7_part_id") or obj.get("treestruct3d_part_id") or obj.name)
                normalized = co / state.get("params", {}).get(part_id, 1)
                if obj.name in request.get("canonical_meshes", []):
                    if state["id"] == "default" and not request.get("reuse_canonical_baseline"):
                        canonical[obj.name] = normalized.copy()
                    else:
                        reference = canonical[obj.name]
                        kd = KDTree(len(reference))
                        for index, point in enumerate(reference):
                            kd.insert(point, index)
                        kd.balance()
                        correspondence = [kd.find(point) for point in normalized]
                        current_to_base = np.array([row[1] for row in correspondence], dtype=np.int64)
                        maximum = max(row[2] for row in correspondence)
                        if len(set(current_to_base.tolist())) != len(reference) or maximum > max(np.ptp(reference, axis=0).max() * 2e-5, 1e-6):
                            raise ValueError(f"Unstable native vertex identity: {obj.name}: {maximum}")
                        order = np.argsort(current_to_base)
                        world, normal, normalized = world[order], normal[order], normalized[order]
                        indices = current_to_base[indices].astype(np.uint32)
                topology.update(obj.name.encode())
                topology.update(np.asarray([len(mesh.vertices), len(mesh.loop_triangles)], dtype="<u4").tobytes())
                topology.update(indices.astype("<u4").tobytes())
                polygon_vertices = np.empty(len(mesh.loops), dtype=np.uint32)
                mesh.loops.foreach_get("vertex_index", polygon_vertices)
                polygon_sizes = np.empty(len(mesh.polygons), dtype=np.uint32)
                mesh.polygons.foreach_get("loop_total", polygon_sizes)
                polygon_hash = hashlib.sha256(polygon_vertices.astype("<u4").tobytes() + polygon_sizes.astype("<u4").tobytes()).hexdigest()
                meshes.append({"id": obj.name, "part_id": part_id, "parent": obj.parent.name if obj.parent else None, "vertex_offset": offset, "vertex_count": len(mesh.vertices), "triangle_count": len(mesh.loop_triangles), "polygon_topology_sha256": polygon_hash, "bbox_min": world.min(axis=0).tolist(), "bbox_max": world.max(axis=0).tolist()})
                positions.append(world)
                local_positions.append(normalized)
                normals.append(normal.astype("<f4"))
                triangles.append(indices.astype("<u4") + offset)
                material_ids.append(materials.astype("<i4"))
                offset += len(mesh.vertices)
            finally:
                evaluated.to_mesh_clear()
        np.concatenate(positions).astype("<f4").tofile(directory / "positions.f32")
        np.concatenate(local_positions).astype("<f4").tofile(directory / "local.f32")
        np.concatenate(normals).astype("<f4").tofile(directory / "normals.f32")
        np.concatenate(triangles).astype("<u4").tofile(directory / "triangles.u32")
        np.concatenate(material_ids).astype("<i4").tofile(directory / "materials.i32")
        anchors, seen = [], set()
        for parent, child, parent_local, child_local in links:
            try:
                p = list(parent.matrix_world @ parent_local)
                c = list(child.matrix_world @ child_local)
                key = (parent.name, child.name, *p, *c)
                if key not in seen:
                    anchors.append({"parent": parent.name, "child": child.name, "parent_world": p, "child_world": c})
                    seen.add(key)
            except ReferenceError:
                pass
        details = {"id": state["id"], "params": state.get("params", {}), "vertex_count": offset, "topology_sha256": topology.hexdigest(), "meshes": meshes, "anchors": anchors}
        (directory / "geometry.json").write_text(json.dumps(details, indent=2))
        metadata["states"].append({key: value for key, value in details.items() if key not in ("meshes", "anchors")})
        (output / "capture.json").write_text(json.dumps(metadata, indent=2))
        if state["id"] == "default" and request.get("export_default"):
            export_request = request["export_default"]
            def load_module(name, filename):
                module_spec = importlib.util.spec_from_file_location(name, filename)
                module = importlib.util.module_from_spec(module_spec)
                module_spec.loader.exec_module(module)
                return module
            exporter = load_module("native_scene_exporter", export_request["exporter"])
            materials = load_module("native_scene_materials", export_request["materials"])
            objects = exporter._normalize_scene({})
            report = materials.bake_materials(objects, resolution=512)
            exporter._export_glb(Path(export_request["glb"]), objects)
            Path(export_request["glb"]).with_suffix(".material-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"state": state["id"], "vertices": offset, "seconds": round(time.monotonic() - started, 2), "topology": details["topology_sha256"][:12]}), flush=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("The source program changed during capture")


if __name__ == "__main__":
    main()
