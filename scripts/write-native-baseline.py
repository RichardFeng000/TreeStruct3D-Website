"""Describe a same-execution native baseline without reusing archived checks."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--archived", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--reason", required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("geometry_verification", Path(__file__).with_name("bake-edit-cases.py"))
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    snapshot = json.loads((args.archived / "snapshot.json").read_text())
    metadata = json.loads((args.capture / "geometry.json").read_text())
    values = np.fromfile(args.capture / "positions.f32", dtype="<f4").reshape((-1, 3))
    triangles = np.fromfile(args.capture / "triangles.u32", dtype="<u4").reshape((-1, 3))
    meshes = {mesh["id"]: mesh for mesh in metadata["meshes"]}
    used = np.unique(triangles)
    runtime = snapshot["runtime"]
    for node in runtime["nodes"]:
        mesh = meshes[node["id"]]; start = mesh["vertex_offset"]; end = start + mesh["vertex_count"]
        points = values[used[(used >= start) & (used < end)]]
        low, high = points.min(axis=0), points.max(axis=0)
        node.update(bbox_min=low.tolist(), bbox_max=high.tolist(), dimensions=(high-low).tolist(), center=((low+high)/2).tolist())
    low = values[used].min(axis=0); high = values[used].max(axis=0)
    runtime.update(source_bounds={"min":low.tolist(),"max":high.tolist()}, scene_extent=float(max(high-low)), preview_only=True, validation_status="not_run", parameter_invariance=None)
    for edge in runtime["edges"]:
        edge["parent_child_known"] = bool(edge.get("parent_child_known") or edge.get("directed_verified"))
        edge.update(preview_only=True, validation_status="not_run", shared_anchor=False, directed_verified=False)
        for field in ["contact", "geometric_anchor_aligned", "shared_anchor_evidence", "authored_anchor_valid", "authored_anchor_count", "authored_anchor_valid_count", "authored_anchor_all_valid", "child_anchor_vertex_gap", "parent_anchor_vertex_gap", "parameter_invariance", "parameter_invariance_failed"]:
            edge[field] = None
        edge["evidence"] = "Native baseline geometry captured in Blender; archived attachment checks were invalidated for this regenerated realization."
        for declaration in edge.get("declared_directions", []):
            declaration["authored_anchor_valid"] = None; declaration["authored_anchor_all_valid"] = None
    mesh_map = helper.glb_mesh_map(args.native / "model.glb")
    geometry = helper.verify_geometry(runtime, mesh_map)
    provenance = {**snapshot["provenance"], **geometry, "glb_sha256": hashlib.sha256((args.native / "model.glb").read_bytes()).hexdigest(), "execution": "same_execution_native_capture_and_material_export", "native_stabilization": args.reason, "runtime_snapshot": "geometry_and_direction_only", "validation_status": "not_run", "validation_note": "Geometry correspondence verified against the exact exported execution. Archived runtime attachment pass/fail flags are not reused.", "material_export": json.loads((args.native / "model.material-report.json").read_text())}
    snapshot["provenance"] = provenance
    for name, data in [("snapshot.json", snapshot), ("provenance.json", provenance), ("mesh-map.json", mesh_map)]:
        (args.native / name).write_text(json.dumps(data, indent=2))
    header_path = args.native / "native-edit.json"
    if header_path.exists():
        header = json.loads(header_path.read_text())
        header["baseline"] = {"glb": "model.glb", "snapshot": "snapshot.json", "mesh_map": "mesh-map.json", "provenance": "provenance.json"}
        header_path.write_text(json.dumps(header, indent=2))
    print(json.dumps(geometry))


if __name__ == "__main__":
    main()
