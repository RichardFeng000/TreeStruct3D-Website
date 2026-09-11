"""Package exact .01-step native topology changes and independent trunk motion."""
import argparse
import ast
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    args = parser.parse_args()
    cache = {}
    for path in sorted(args.capture.glob("*/geometry.json")):
        meta = json.loads(path.read_text())
        key = tuple(sorted((key, value) for key, value in meta["params"].items() if value != 1))
        cache[key] = (meta, path.parent)
    base_meta, base_path = cache[()]
    chunks, offset = [], 0
    def field(values):
        nonlocal offset
        array = np.asarray(values, dtype="<f4").reshape(-1)
        result = {"offset": offset, "count": len(array)}
        chunks.append(array); offset += len(array)
        return result
    def part(state, id):
        meta, path = state
        mesh = next(mesh for mesh in meta["meshes"] if mesh["id"] == id)
        values = np.fromfile(path / "positions.f32", dtype="<f4").reshape((-1, 3))
        return values[mesh["vertex_offset"]:mesh["vertex_offset"] + mesh["vertex_count"]]
    parts = [{"id": mesh["id"], "part_id": mesh["part_id"], "positions": field(part(cache[()], mesh["id"]))} for mesh in base_meta["meshes"]]
    source_ast = ast.parse(args.source.read_text())
    material_function = next(node for node in source_ast.body if isinstance(node, ast.FunctionDef) and node.name == "create_bark_materials")
    material_names = [node.args[0].value for node in ast.walk(material_function) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "make_material"]
    branch_id, trunk_id = "branch_and_twig_network", "main_trunk"
    replacement = {"id": branch_id, "control": branch_id, "material_names": material_names, "samples": [], "translation_controls": [{"id": trunk_id, "samples": []}]}
    base_branch = part(cache[()], branch_id)
    controls = [{"id": branch_id, "samples": [{"scale": scale, "parts": []} for scale in [.4, 1, 1.6]]}]
    trunk_curve = {"id": trunk_id, "samples": []}
    shifts = {}
    for scale in [.4, 1, 1.6]:
        state = cache[()] if scale == 1 else cache[((trunk_id, scale),)]
        deltas = part(state, branch_id) - base_branch
        shift = deltas.mean(axis=0, dtype=np.float64)
        if np.linalg.norm(deltas - shift, axis=1).max() > 2e-5:
            raise ValueError("Trunk does not translate every native branch vertex uniformly")
        shifts[scale] = shift
        replacement["translation_controls"][0]["samples"].append({"scale": scale, "delta": shift.tolist()})
        trunk_curve["samples"].append({"scale": scale, "parts": [] if scale == 1 else [{"id": trunk_id, "delta": field(part(state, trunk_id) - part(cache[()], trunk_id))}]})
    controls.append(trunk_curve)
    for n in range(40, 161):
        scale = n / 100
        state = cache[()] if scale == 1 else cache[((branch_id, scale),)]
        meta, path = state
        mesh = next(mesh for mesh in meta["meshes"] if mesh["id"] == branch_id)
        triangle_offset = sum(item["triangle_count"] for item in meta["meshes"][:meta["meshes"].index(mesh)])
        positions = part(state, branch_id)
        normal = np.fromfile(path / "normals.f32", dtype="<f4").reshape((-1, 3))[mesh["vertex_offset"]:mesh["vertex_offset"] + mesh["vertex_count"]]
        triangles = np.fromfile(path / "triangles.u32", dtype="<u4").reshape((-1, 3))[triangle_offset:triangle_offset + mesh["triangle_count"]] - mesh["vertex_offset"]
        materials = np.fromfile(path / "materials.i32", dtype="<i4")[triangle_offset:triangle_offset + mesh["triangle_count"]]
        replacement["samples"].append({"scale": scale, "positions": field(positions), "normals": field(normal), "triangles": field(triangles), "materials": field(materials)})
    validation = []
    fixture_parts, fixture_samples, fixture_offset = [], [], 0
    for key, state in cache.items():
        meta, path = state
        if not (meta["id"].startswith("multi-") or len(key) == 1 and key[0][1] in [.63, 1.37]):
            continue
        params = dict(key); branch_scale = params.get(branch_id, 1); trunk_scale = params.get(trunk_id, 1)
        reference = cache[()] if branch_scale == 1 else cache[((branch_id, branch_scale),)]
        shift = shifts[.4 if trunk_scale < 1 else 1.6] * (abs(trunk_scale - 1) / .6)
        actual = part(state, branch_id)
        predicted = part(reference, branch_id) + shift
        error = float(np.linalg.norm(predicted - actual, axis=1).max())
        if error > 2e-5:
            raise ValueError(f"Native topology replacement validation failed: {error}")
        validation.append({"params": params, "max_position_error": error})
        sample = {"id": meta["id"], "params": params, "parts": []}
        for mesh in meta["meshes"]:
            values = part(state, mesh["id"]).reshape(-1)
            sample["parts"].append({"id": mesh["id"], "positions": {"offset": fixture_offset, "count": len(values)}})
            fixture_parts.append(values); fixture_offset += len(values)
        fixture_samples.append(sample)
    binary = np.concatenate(chunks).astype("<f4").tobytes()
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    header = {"version": 1, "coordinate_system": "blender_z_up", "binary": "native-edit.bin.gz", "compression": "gzip", "binary_sha256": hashlib.sha256(binary).hexdigest(), "parts": parts, "controls": controls, "anchors": base_meta["anchors"], "replacements": [replacement], "validation": {"source_sha256": source_hash, "native_multi_checks": validation}}
    args.output.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(binary, compresslevel=9, mtime=0)
    (args.output / "native-edit.bin.gz").write_bytes(compressed)
    (args.output / "native-edit.json").write_text(json.dumps(header, indent=2))
    args.fixtures.mkdir(parents=True, exist_ok=True)
    (args.fixtures / "validation.json").write_text(json.dumps({"source_sha256": source_hash, "samples": fixture_samples}, indent=2))
    np.concatenate(fixture_parts).astype("<f4").tofile(args.fixtures / "validation.bin")
    print(json.dumps({"bytes": len(binary), "gzip_bytes": len(compressed), "max_error": max(row["max_position_error"] for row in validation)}))


if __name__ == "__main__":
    main()
