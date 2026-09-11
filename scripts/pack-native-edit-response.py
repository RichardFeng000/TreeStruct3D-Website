"""Pack independently regenerated Blender geometry into browser response fields.

Run with Blender's bundled Python (NumPy), or any Python with NumPy installed.
The input is capture-native-edit-response.py's cache, never an affine GLB edit.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np


def load_cache(directory):
    states = {}
    for path in sorted(directory.glob("*/geometry.json")):
        meta = json.loads(path.read_text())
        key = tuple(sorted((k, v) for k, v in meta["params"].items() if v != 1))
        states[key] = {"meta": meta, "directory": path.parent}
    return states


def positions(state):
    return np.fromfile(state["directory"] / "positions.f32", dtype="<f4").reshape((-1, 3))


def anchors(state):
    return np.asarray([[*a["parent_world"], *a["child_world"]] for a in state["meta"]["anchors"]], dtype=np.float32)


def pack(directory, output, fixtures=None, interactions_file=None, procedural_file=None, ratio_file=None, bed_pillow_height=False):
    states = load_cache(directory)
    base_state = states[()]
    native_positions = globals()["positions"]
    base = native_positions(base_state)
    native_anchors = globals()["anchors"]
    base_anchors = native_anchors(base_state)
    mesh_meta = base_state["meta"]["meshes"]
    procedural = json.loads(procedural_file.read_text()) if procedural_file else None
    procedural_ids = {item["id"] for item in procedural["procedural"]} if procedural else set()
    scalar_parts = {}
    scalar_anchor_indices = []
    def pillow_height(params):
        frame = params.get("wooden_bed_frame_base", 1)
        mattress = params.get("green_mattress", 1)
        pillow = params.get("pillow", 1)
        u = abs(1 - (1.16 / 7.54) * pillow / (frame * mattress))
        return mattress * (.62 + .055 * max(0, .75 * (1 - u * u)) - .045 * max(.5, u) ** 4)
    if bed_pillow_height:
        for part in mesh_meta:
            if part["id"] in ("green_mattress", "pillow"):
                weights = np.ones(part["vertex_count"], dtype=np.float32) if part["id"] == "pillow" else np.zeros(part["vertex_count"], dtype=np.float32)
                if part["id"] == "green_mattress":
                    weights[-10:] = 1
                scalar_parts[part["id"]] = weights
        scalar_anchor_indices = [index for index, anchor in enumerate(base_state["meta"]["anchors"]) if anchor["parent"] == "green_mattress" and anchor["child"] == "pillow"]
    def positions(state):
        values = native_positions(state)
        for part in mesh_meta:
            if part["id"] in procedural_ids:
                start, count = part["vertex_offset"], part["vertex_count"]
                values[start:start + count] = base[start:start + count]
            if part["id"] in scalar_parts:
                start, count = part["vertex_offset"], part["vertex_count"]
                values[start:start + count, 2] -= scalar_parts[part["id"]] * (pillow_height(state["meta"]["params"]) - pillow_height({}))
        return values
    def anchors(state):
        values = native_anchors(state)
        if bed_pillow_height:
            for index in scalar_anchor_indices:
                values[index, [2, 5]] -= pillow_height(state["meta"]["params"]) - pillow_height({})
        return values
    extent = float(np.ptp(base, axis=0).max())
    tolerance = max(1e-6, extent * 1e-5)
    chunks, offset = [], 0

    def field(array):
        nonlocal offset
        array = np.asarray(array, dtype="<f4").reshape(-1)
        descriptor = {"offset": offset, "count": int(array.size)}
        chunks.append(array)
        offset += array.size
        return descriptor

    def response_arrays(actual, anchor_actual):
        if actual.shape != base.shape:
            raise ValueError("Variable topology requires replacement geometry")
        value = {"parts": []}
        for part in mesh_meta:
            start, count = part["vertex_offset"], part["vertex_count"]
            delta = actual[start:start + count]
            if np.max(np.abs(delta), initial=0) > 1e-7:
                value["parts"].append({"id": part["id"], "delta": field(delta)})
        aa = anchor_actual
        if aa.shape != base_anchors.shape:
            raise ValueError("Native anchor count changed; cannot assume correspondence")
        if base_anchors.size and np.max(np.abs(aa)) > 1e-7:
            value["anchors"] = field(aa)
        return value

    def response(state):
        return response_arrays(positions(state) - base, anchors(state) - base_anchors)

    header = {"version": 1, "coordinate_system": "blender_z_up", "binary": "native-edit.bin", "parts": [], "controls": [], "anchors": base_state["meta"]["anchors"], "validation": {"scene_extent": extent, "linear_tolerance": tolerance, "source": "Independent native PART_PARAMS regeneration; evaluated world vertices before export normalization"}}
    for part in mesh_meta:
        start, count = part["vertex_offset"], part["vertex_count"]
        header["parts"].append({"id": part["id"], "part_id": part["part_id"], "positions": field(base[start:start + count])})
    control_ids = sorted({key[0][0] for key in states if len(key) == 1})
    single_errors = {}
    curves = {}
    for control_id in control_ids:
        available = {key[0][1]: state for key, state in states.items() if len(key) == 1 and key[0][0] == control_id and .4 <= key[0][1] <= 1.6}
        low, high = positions(available[0.4]), positions(available[1.6])
        maximum_error = 0.0
        for scale, state in available.items():
            predicted = base + ((low - base) * ((1 - scale) / 0.6) if scale < 1 else (high - base) * ((scale - 1) / 0.6))
            maximum_error = max(maximum_error, float(np.linalg.norm(predicted - positions(state), axis=1).max()))
        single_errors[control_id] = maximum_error
        linear = maximum_error <= tolerance
        scales = [0.4, 1, 1.6] if linear else sorted({*available, 1})
        curves[control_id] = {scale: (np.zeros_like(base), np.zeros_like(base_anchors)) if scale == 1 else (positions(available[scale]) - base, anchors(available[scale]) - base_anchors) for scale in scales}
        header["controls"].append({"id": control_id, "interpolation": "linear" if linear else "sampled_native", "samples": [{"scale": scale, **({"parts": []} if scale == 1 else response(available[scale]))} for scale in scales]})

    def bracket(values, value):
        values = sorted(values)
        upper = next((v for v in values if v >= value - 1e-9), values[-1])
        lower = max((v for v in values if v <= value + 1e-9), default=values[0])
        if abs(upper - lower) < 1e-9:
            return [(lower, 1)]
        t = (value - lower) / (upper - lower)
        return [(lower, 1 - t), (upper, t)]

    interactions, ratio_interactions = [], []
    def predict(params):
        geometry, anchor_values = base.astype(np.float64).copy(), base_anchors.astype(np.float64).copy()
        for control_id, scale in params.items():
            for knot, weight in bracket(curves[control_id], scale):
                geometry += weight * curves[control_id][knot][0]
                anchor_values += weight * curves[control_id][knot][1]
        for interaction in interactions:
            for combination in itertools.product(*(bracket(knots, params.get(control_id, 1)) for control_id, knots in zip(interaction["ids"], interaction["knots"]))):
                keys = tuple(row[0] for row in combination)
                weight = float(np.prod([row[1] for row in combination]))
                residual, anchor_residual = interaction["values"][keys]
                geometry += weight * residual
                anchor_values += weight * anchor_residual
        for interaction in ratio_interactions:
            u = params.get(interaction["numerator_control"], 1)
            v = params.get(interaction["denominator_control"], 1)
            for ratio, coefficient in [(u / v, v), (u, -1), (1 / v, -v)]:
                for knot, weight in bracket(interaction["values"], ratio):
                    delta, anchor_delta = interaction["values"][knot]
                    geometry += coefficient * weight * delta
                    anchor_values += coefficient * weight * anchor_delta
        return geometry, anchor_values

    if ratio_file:
        header["ratio_interactions"] = []
        for config in json.loads(ratio_file.read_text())["ratios"]:
            numerator = config["numerator_control"]
            available = {key[0][1]: state for key, state in states.items() if len(key) == 1 and key[0][0] == numerator}
            available[1] = base_state
            if min(available) > .25 or max(available) < 4:
                raise ValueError("Ratio samples must cover .25 through 4")
            interaction = {**config, "values": {}}
            packed = {"numerator_control": numerator, "denominator_control": config["denominator_control"], "samples": []}
            for ratio, state in sorted(available.items()):
                delta, anchor_delta = positions(state) - base, anchors(state) - base_anchors
                for part in mesh_meta:
                    if part["id"] not in config["parts"]:
                        start, count = part["vertex_offset"], part["vertex_count"]
                        delta[start:start + count] = 0
                interaction["values"][ratio] = (delta, anchor_delta)
                packed["samples"].append({"ratio": ratio, **response_arrays(delta, anchor_delta)})
            ratio_interactions.append(interaction)
            header["ratio_interactions"].append(packed)

    if interactions_file:
        configs = json.loads(interactions_file.read_text())["interactions"]
        header["interactions"] = []
        for config in configs:
            ids = config.get("controls", config.get("ids"))
            interaction = {"ids": ids, "knots": config["knots"], "values": {}}
            packed = {"ids": ids, "knots": config["knots"], "samples": []}
            for values in itertools.product(*config["knots"]):
                params = {key: value for key, value in zip(ids, values) if value != 1}
                state = states[tuple(sorted(params.items()))]
                predicted, predicted_anchors = predict(params)
                residual = positions(state) - predicted
                anchor_residual = anchors(state) - predicted_anchors
                interaction["values"][values] = (residual, anchor_residual)
                packed["samples"].append({"scales": list(values), **response_arrays(residual, anchor_residual)})
            interactions.append(interaction)
            header["interactions"].append(packed)
    multi_errors = []
    for key, state in states.items():
        if len(key) < 2:
            continue
        if not state["meta"]["id"].startswith(("multi-", "heldout", "holdout")):
            continue
        predicted, _ = predict(dict(key))
        error = float(np.linalg.norm(predicted - positions(state), axis=1).max())
        multi_errors.append({"params": dict(key), "max_position_error": error, "relative_error": error / extent})
    header["validation"].update({"linear_fit_max_error": single_errors, "native_multi_checks": multi_errors})
    if bed_pillow_height:
        header["scalar_fields"] = [{"type": "bed_pillow_height", "controls": {"frame": "wooden_bed_frame_base", "mattress": "green_mattress", "pillow": "pillow"}, "parts": [{"id": id, "axis": 2, "weights": field(weights)} for id, weights in scalar_parts.items()], "anchor_indices": scalar_anchor_indices}]
    if procedural:
        source_offset = offset
        source_binary = np.fromfile(procedural_file.parent / procedural["binary"], dtype="<f4")
        field(source_binary)
        header["procedural"] = procedural["procedural"]
        for item in header["procedural"]:
            for descriptor in [item["weights"], item["snap_indices"]]:
                descriptor["offset"] += source_offset
        header["validation"]["procedural_validation"] = procedural["validation"]
    if max((row["max_position_error"] for row in multi_errors), default=0) > extent * 1e-4:
        raise ValueError(f"Response fields fail native multi-parameter truth: {max(row['relative_error'] for row in multi_errors):.7g} relative")
    output.mkdir(parents=True, exist_ok=True)
    binary = np.concatenate(chunks).astype("<f4").tobytes()
    header["binary_sha256"] = hashlib.sha256(binary).hexdigest()
    capture_meta = json.loads((directory / "capture.json").read_text())
    header["source_sha256"] = capture_meta["source_sha256"]
    if capture_meta.get("replay_adapter"):
        header["replay_adapter"] = capture_meta["replay_adapter"]
    if all((output / name).exists() for name in ["model.glb", "snapshot.json", "mesh-map.json", "provenance.json"]):
        header["baseline"] = {"glb": "model.glb", "snapshot": "snapshot.json", "mesh_map": "mesh-map.json", "provenance": "provenance.json"}
    if len(binary) > 8_000_000:
        header.update(binary="native-edit.bin.gz", compression="gzip")
        (output / "native-edit.bin.gz").write_bytes(gzip.compress(binary, compresslevel=9, mtime=0))
        (output / "native-edit.bin").unlink(missing_ok=True)
    else:
        (output / "native-edit.bin").write_bytes(binary)
    (output / "native-edit.json").write_text(json.dumps(header, indent=2))
    if fixtures:
        fixture_chunks, fixture_samples, fixture_offset = [], [], 0
        for key, state in states.items():
            if not (state["meta"]["id"].startswith(("multi-", "heldout", "holdout")) or len(key) == 1 and key[0][1] in (0.63, 1.37)):
                continue
            actual = native_positions(state)
            sample = {"id": state["meta"]["id"], "params": dict(key), "parts": []}
            for part in mesh_meta:
                start, count = part["vertex_offset"], part["vertex_count"]
                values = actual[start:start + count].reshape(-1)
                sample["parts"].append({"id": part["id"], "positions": {"offset": fixture_offset, "count": int(values.size)}})
                fixture_chunks.append(values)
                fixture_offset += values.size
            fixture_samples.append(sample)
        fixtures.mkdir(parents=True, exist_ok=True)
        capture_meta = json.loads((directory / "capture.json").read_text())
        (fixtures / "validation.json").write_text(json.dumps({"source_sha256": capture_meta["source_sha256"], "replay_adapter": capture_meta.get("replay_adapter"), "samples": fixture_samples}, indent=2))
        np.concatenate(fixture_chunks).astype("<f4").tofile(fixtures / "validation.bin")
    print(json.dumps({"case": directory.name, "bytes": len(binary), "controls": len(control_ids), "samples": [len(c["samples"]) for c in header["controls"]]}))
    return header


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--interactions", type=Path)
    parser.add_argument("--procedural", type=Path)
    parser.add_argument("--ratios", type=Path)
    parser.add_argument("--bed-pillow-height", action="store_true")
    args = parser.parse_args()
    pack(args.capture, args.output, args.fixtures, args.interactions, args.procedural, args.ratios, args.bed_pillow_height)
