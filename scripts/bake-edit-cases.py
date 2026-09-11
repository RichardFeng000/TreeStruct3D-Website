#!/usr/bin/env python3
"""Bake native Blender parameter edits for a static website, without a server.

Example configuration (paths are relative to --research-root)::

    {"cases": [{"id": "paper-example", "source": "results/Example/Example.py",
      "label": "Example", "source_label": "TreeStruct3D",
      "parent": {"id": "body", "label": "Body"},
      "child": {"id": "leg", "label": "Leg"},
      "scales": [0.4, 0.8, 1.0, 1.2, 1.6]}]}

Only existing literal PART_PARAMS[part_id]['scale'] fields are edited. Every
state is rebuilt by the original visual_validation exporter, then independently
executed by its runtime probe using the exact same override. This script does
not resize exported meshes or copy historical parameter-invariance results.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque


SITE = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def multiply(a, b):
    return [[sum(a[row][k] * b[k][col] for k in range(4)) for col in range(4)] for row in range(4)]


IDENTITY = [[int(row == col) for col in range(4)] for row in range(4)]


def local_matrix(node):
    if "matrix" in node:
        return [[node["matrix"][col * 4 + row] for col in range(4)] for row in range(4)]
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    scale = node.get("scale", [1, 1, 1])
    translation = node.get("translation", [0, 0, 0])
    rotation = [
        [1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
        [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
        [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)],
    ]
    return [[*(rotation[row][col] * scale[col] for col in range(3)), translation[row]] for row in range(3)] + [[0, 0, 0, 1]]


def glb_mesh_map(path):
    """Read actual exported vertices and transforms, rather than source bounds."""
    blob = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", blob)
    if (magic, version, length) != (b"glTF", 2, len(blob)):
        raise ValueError(f"Invalid GLB: {path}")
    offset, document, binary = 12, None, None
    while offset < len(blob):
        chunk_length, chunk_type = struct.unpack_from("<II", blob, offset)
        chunk = blob[offset + 8:offset + 8 + chunk_length]
        if chunk_type == 0x4E4F534A:
            document = json.loads(chunk)
        elif chunk_type == 0x004E4942:
            binary = chunk
        offset += chunk_length + 8
    if document is None or binary is None:
        raise ValueError("GLB must contain JSON and binary data")
    output = []

    def visit(index, parent):
        node = document["nodes"][index]
        matrix = multiply(parent, local_matrix(node))
        if "mesh" in node:
            lower, upper = [math.inf] * 3, [-math.inf] * 3
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
                if accessor["componentType"] != 5126 or accessor["type"] != "VEC3" or "sparse" in accessor:
                    raise ValueError("Expected dense float VEC3 positions")
                view = document["bufferViews"][accessor["bufferView"]]
                start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
                stride = view.get("byteStride", 12)
                for vertex in range(accessor["count"]):
                    point = [*struct.unpack_from("<fff", binary, start + vertex * stride), 1]
                    world = [sum(matrix[row][col] * point[col] for col in range(4)) for row in range(3)]
                    lower = [min(lower[axis], world[axis]) for axis in range(3)]
                    upper = [max(upper[axis], world[axis]) for axis in range(3)]
            extras = node.get("extras", {})
            node_id = extras.get("codex_semantic_node_id") or node["name"]
            output.append({"id": node_id, "mesh_index": node["mesh"], "part_id": extras.get("treestruct3d_part_id") or extras.get("stage7_part_id") or node_id, "bbox_min": lower, "bbox_max": upper})
        for child in node.get("children", []):
            visit(child, matrix)

    for index in document["scenes"][document.get("scene", 0)]["nodes"]:
        visit(index, IDENTITY)
    return output


def verify_geometry(runtime, meshes):
    nodes = {node["id"]: node for node in runtime["nodes"]}
    by_mesh = {mesh["id"]: mesh for mesh in meshes}
    if set(nodes) != set(by_mesh):
        raise ValueError(f"Mesh identity mismatch; missing={set(nodes)-set(by_mesh)}, extra={set(by_mesh)-set(nodes)}")
    differences = []
    for node_id, node in nodes.items():
        low, high = node["bbox_min"], node["bbox_max"]
        expected = ([low[0], low[2], -high[1]], [high[0], high[2], -low[1]])
        actual = (by_mesh[node_id]["bbox_min"], by_mesh[node_id]["bbox_max"])
        differences.extend([[actual[side][axis] - expected[side][axis] for axis in range(3)] for side in range(2)])
    shift = [sum(item[axis] for item in differences) / len(differences) for axis in range(3)]
    error = max(abs(item[axis] - shift[axis]) for item in differences for axis in range(3))
    extent = max(runtime.get("scene_extent") or 1, 1)
    if error > max(1e-6, extent * 2e-6):
        raise ValueError(f"Export geometry disagrees with same-parameter runtime probe: error={error}")
    return {"mesh_name_match": True, "runtime_to_glb_translation": shift,
            "mesh_bbox_max_error_before_translation": max(abs(value) for item in differences for value in item),
            "mesh_bbox_max_error_after_translation": error}


def scrub(value, research_root):
    if isinstance(value, dict):
        return {key: scrub(item, research_root) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item, research_root) for item in value]
    if isinstance(value, str):
        return value.replace(str(research_root) + "/", "")
    return value


def run(command, log_path, timeout, cwd):
    with log_path.open("w") as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        tail = "\n".join(log_path.read_text(errors="replace").splitlines()[-25:])
        raise RuntimeError(f"Blender exited {result.returncode}:\n{tail}")


def selected_connections(runtime, parent_ids, child_ids):
    """Match paper edit roles to real instance edges, including attachment paths."""
    part_ids = {node["id"]: node.get("part_id") or node["id"] for node in runtime["nodes"]}
    parents = {node_id for node_id, part_id in part_ids.items() if part_id in parent_ids}
    children = {node_id for node_id, part_id in part_ids.items() if part_id in child_ids}
    edges = runtime["edges"]
    chosen, paths = set(), []
    adjacent = {}
    for index, edge in enumerate(edges):
        if not (edge.get("parent_child_known") or edge.get("directed_verified")):
            continue
        adjacent.setdefault(edge["parent"], []).append((edge["child"], index))
        adjacent.setdefault(edge["child"], []).append((edge["parent"], index))
    for parent in sorted(parents):
        for child in sorted(children):
            direct = [index for index, edge in enumerate(edges) if (edge.get("parent_child_known") or edge.get("directed_verified")) and {edge["parent"], edge["child"]} == {parent, child}]
            if direct:
                chosen.update(direct)
                paths.append([parent, child])
                continue
            queue, seen = deque([(parent, [], [parent])]), {parent}
            while queue:
                node, indexes, node_path = queue.popleft()
                if node == child:
                    chosen.update(indexes)
                    paths.append(node_path)
                    break
                for neighbor, index in adjacent.get(node, []):
                    if neighbor not in seen:
                        seen.add(neighbor)
                        queue.append((neighbor, [*indexes, index], [*node_path, neighbor]))
    return [edges[index] for index in sorted(chosen)], paths


def bake_case(case, args, playground):
    research = args.research_root
    source = (research / case["source"]).resolve()
    source.relative_to(research)
    native = playground._native_part_params(source)
    parent, child = case["parent"], case["child"]
    for endpoint in (parent, child):
        endpoint.setdefault("ids", [endpoint["id"]] if "id" in endpoint else [])
    for endpoint in (parent, child):
        for part_id in endpoint["ids"]:
            if part_id not in native:
                raise ValueError(f"{case['id']}: no native scale parameter for {part_id}")
            if float(native[part_id]["scale"]) != 1.0:
                raise ValueError("This demo expects scale=1.0 as the source baseline")
    source_hash = digest(source)
    case_dir = args.output / case["id"]
    case_dir.mkdir(parents=True, exist_ok=True)
    entry = playground.ModelEntry("treestruct3d", f"{source.stem}/{source.stem}", case.get("label", source.stem), source)
    schema = playground.PlaygroundState.schema(None, entry)
    text = source.read_text()
    structure = playground.SourceStructure(source, text, playground.ast.parse(text))
    structure.analyze()
    structure = playground._interactive_data(structure)
    scales = case.get("scales", [0.4, 0.8, 1, 1.2, 1.6])
    states = [("default", None, 1.0)] + [(f"{side}-{scale:g}", side, float(scale)) for side in ("parent", "child") for scale in scales if float(scale) != 1]
    metadata = {"id": case["id"], "title": case.get("title", case["label"]), "provider": case.get("provider"), "group": case.get("group"), "label": entry.label, "model": entry.model_id, "source": "treestruct3d", "source_label": case.get("source_label", "TreeStruct3D"), "parent": parent, "child": child, "scales": scales, "mode": "precomputed_native_rebuild", "variants": []}
    baseline = None
    for state_id, side, scale in states:
        started = time.monotonic()
        endpoint_ids = case[side]["ids"] if side else []
        params = {f"part_param|{part_id}|scale": scale for part_id in endpoint_ids}
        directory = case_dir / "edits" / state_id
        directory.mkdir(parents=True, exist_ok=True)
        cached = directory / "provenance.json"
        cached_provenance = json.loads(cached.read_text()) if args.resume and cached.is_file() else None
        final_scene = bool(case.get("final_scene_probe"))
        export_worker = playground.ALGORITHM_DIR / "blender_live_export.py"
        adapter = SITE / "scripts" / "blender-final-scene-probe.py"
        expected_hashes = {"source_sha256": source_hash, "exporter_sha256": digest(export_worker), "probe_sha256": digest(playground.RUNTIME_GRAPH_PROBE)}
        if final_scene:
            expected_hashes["final_scene_adapter_sha256"] = digest(adapter)
        cache_valid = bool(cached_provenance and all(cached_provenance.get(key) == value for key, value in expected_hashes.items()) and cached_provenance.get("params") == params and bool(cached_provenance.get("same_execution_export")) == final_scene and all((directory / filename).is_file() for filename in ("model.glb", "runtime-probe.json", "snapshot.json", "mesh-map.json")))
        with tempfile.TemporaryDirectory(prefix="treestruct-bake-") as temporary:
            temporary = Path(temporary)
            request = temporary / "request.json"
            save(request, {"adapter": "generic", "params": params})
            prefix = [str(args.blender), "--background", "--factory-startup", "--threads", "1", "--python"]
            expression = f"import random, numpy, runpy; random.seed(0); numpy.random.seed(0); runpy.run_path({str(export_worker)!r}, run_name='__main__')"
            if not cache_valid and not final_scene:
                run([*prefix[:-1], "--python-expr", expression, "--", "--source", str(source), "--output", str(directory / "model.glb"), "--request", str(request)], temporary / "export.log", args.timeout, source.parent)
            raw = temporary / "probe.json"
            probe = [*prefix, str(playground.RUNTIME_GRAPH_PROBE), "--", "--script", str(source), "--source-root", str(source.parent), "--output", str(raw), "--contact-ratio", "0.025", "--anchor-ratio", "0.025", "--samples", "96", "--max-nodes", "2048", "--max-edges", "8192"]
            for part_id in endpoint_ids:
                probe += ["--part-param-scale", f"{part_id}={scale:g}"]
            if final_scene:
                probe = [*prefix, str(adapter), "--", "--probe", str(playground.RUNTIME_GRAPH_PROBE), "--exporter", str(export_worker), "--glb", str(directory / "model.glb"), *probe[probe.index("--") + 1:]]
            if not cache_valid:
                run(probe, temporary / "probe.log", args.timeout, source.parent)
            report = json.loads((directory / "runtime-probe.json" if cache_valid else raw).read_text())
            if report.get("status") != "ok":
                raise RuntimeError(report.get("error", "Probe failed"))
        runtime = playground.PlaygroundState._runtime_graph_view(report)
        save(directory / "runtime-probe.json", scrub(report, research))
        mesh_map = glb_mesh_map(directory / "model.glb")
        geometry = verify_geometry(runtime, mesh_map)
        if baseline is None:
            baseline = copy.deepcopy(runtime)
        before = {node["id"]: node for node in baseline["nodes"]}
        node_part_ids = {node["id"]: node.get("part_id") or node["id"] for node in runtime["nodes"]}
        edited_nodes = [node for node in runtime["nodes"] if node_part_ids[node["id"]] in endpoint_ids]
        changed_parts = {node_part_ids[node["id"]] for node in edited_nodes if node["id"] in before and max(abs(a-b) for a, b in zip(node["dimensions"], before[node["id"]]["dimensions"])) > 1e-5}
        changed = bool(endpoint_ids) and set(endpoint_ids) <= changed_parts
        if endpoint_ids and not changed:
            raise ValueError(f"{state_id}: native edit did not change geometry dimensions")
        selected_edges, attachment_paths = selected_connections(runtime, parent["ids"], child["ids"])
        edit = {"id": state_id, "side": side or "default", "part_ids": endpoint_ids, "parameter": "scale", "scale": scale, "params": params, "paper_parent_ids": parent["ids"], "paper_child_ids": child["ids"], "geometry_changed": changed, "attachment_observed": bool(selected_edges), "attachment_paths": attachment_paths, "dimensions": [{"id": node["id"], "part_id": node_part_ids[node["id"]], "before": before[node["id"]]["dimensions"], "after": node["dimensions"]} for node in edited_nodes], "selected_attachment_checks": [{**{key: edge.get(key) for key in ("parent", "child", "relation", "contact", "shared_anchor", "anchor_gap", "anchor_tolerance", "authored_anchor_all_valid")}, "runtime_parent_part_id": node_part_ids[edge["parent"]], "runtime_child_part_id": node_part_ids[edge["child"]]} for edge in selected_edges]}
        if digest(source) != source_hash:
            raise RuntimeError(f"Source changed during baking: {source}")
        provenance = {"method": case.get("source_label", "TreeStruct3D"), "role": "precomputed_edit_demo", "source_file": str(source.relative_to(research)), "source_sha256": source_hash, "source_size": source.stat().st_size, "glb_sha256": digest(directory / "model.glb"), "native_part_params": True, "runtime_snapshot": True, "execution": "full_source_from_empty_scene", "parameter_mode": "native_rebuild", "params": params, "random_seed_before_source_execution": 0, "exporter_sha256": digest(export_worker), "probe_sha256": digest(playground.RUNTIME_GRAPH_PROBE), "validation_note": "Fresh checks for this exact saved parameter state. No claim about unbaked values or benchmark aggregates. Paper edit roles and runtime parent-child direction are recorded separately.", "edit": edit, **geometry}
        if final_scene:
            provenance.update(same_execution_export=True, final_scene_adapter_sha256=digest(adapter), final_scene_adapter=report["website_final_scene_adapter"])
        state_schema = copy.deepcopy(schema)
        for control in state_schema["controls"]:
            if control["id"] in params:
                control["value"] = params[control["id"]]
        snapshot = {"schema": state_schema, "structure": structure, "runtime": runtime, "provenance": provenance}
        save(directory / "snapshot.json", scrub(snapshot, research))
        save(directory / "runtime-probe.json", scrub(report, research))
        save(directory / "provenance.json", provenance)
        save(directory / "mesh-map.json", mesh_map)
        relative = directory.relative_to(args.output).as_posix()
        variant = {"id": state_id, "side": side or "default", "scale": scale, "glb": f"{relative}/model.glb", "snapshot": f"{relative}/snapshot.json", "provenance": f"{relative}/provenance.json", "mesh_map": f"{relative}/mesh-map.json", "bytes": (directory / "model.glb").stat().st_size}
        metadata["variants"].append(variant)
        if side is None:
            metadata["baseline"] = {**variant, "parts": len(runtime["nodes"]), "shared_anchors": sum(bool(edge.get("shared_anchor")) for edge in runtime["edges"])}
        save(case_dir / "edits" / "edit-demo.json", metadata)
        print(json.dumps({"case": case["id"], "state": state_id, "seconds": round(time.monotonic()-started, 1), "bytes": variant["bytes"], "parts": len(runtime["nodes"]), "selected_edges": len(selected_edges), "shared": sum(bool(edge.get("shared_anchor")) for edge in selected_edges), "resumed": cache_valid}), flush=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--research-root", type=Path, default=SITE.parent)
    parser.add_argument("--output", type=Path, default=SITE / "public" / "explorer" / "data")
    parser.add_argument("--blender", type=Path)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--jobs", type=int, default=1)
    args = parser.parse_args()
    args.research_root = args.research_root.resolve()
    args.output = args.output.resolve()
    args.output.relative_to(SITE)
    sys.path.insert(0, str(args.research_root))
    from visual_validation.algorithm import model_playground as playground
    args.blender = args.blender or playground.discover_default_blender()
    cases = [case for case in json.loads(args.config.read_text())["cases"] if not args.case or case["id"] in args.case]
    errors = []
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        pending = {pool.submit(bake_case, case, args, playground): case["id"] for case in cases}
        for future in as_completed(pending):
            try:
                future.result()
            except Exception as error:
                errors.append({"case": pending[future], "error": str(error)})
                print(json.dumps(errors[-1]), flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
