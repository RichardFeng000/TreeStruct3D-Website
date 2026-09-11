"""Rebuild the 20 native browser-edit datasets from unchanged research sources.

Example:
  python3 scripts/bake-native-edits.py --case paper-gpt-5-6-sol-spiny-lobster
  python3 scripts/bake-native-edits.py --plan-only

Blender and its bundled NumPy Python are discovered under research/tools.
No server, network request, commit, or deployment is performed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import time


def main():
    website = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", type=Path, default=website.parent)
    parser.add_argument("--blender", type=Path)
    parser.add_argument("--numpy-python", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/treestruct-native-rebuild"))
    parser.add_argument("--artifact-root", type=Path, default=website, help="Alternate website-shaped output root for isolated reproduction tests.")
    parser.add_argument("--case", action="append", dest="cases")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--skip-capture", action="store_true", help="Repack an existing complete cache; do not run source programs again.")
    args = parser.parse_args()
    research = args.research_root.resolve()
    blender = args.blender or research / "tools/Blender-5.0.app/Contents/MacOS/Blender"
    numpy_python = args.numpy_python
    if numpy_python is None:
        candidates = sorted((blender.parent.parent / "Resources").glob("*/python/bin/python3.*"))
        numpy_python = next((path for path in candidates if path.is_file() and not path.name.endswith("-config")), None)
    if not args.plan_only and (not blender.is_file() or numpy_python is None):
        parser.error("Pass --blender and --numpy-python for a Blender installation with NumPy.")
    recipes = json.loads((website / "scripts/native-edit-recipes.json").read_text())["cases"]
    if args.cases:
        unknown = set(args.cases) - {item["id"] for item in recipes}
        if unknown:
            parser.error(f"Unknown cases: {sorted(unknown)}")
        recipes = [item for item in recipes if item["id"] in args.cases]
    args.cache.mkdir(parents=True, exist_ok=True)
    scripts = website / "scripts"

    def command(command, log):
        with log.open("w") as output:
            result = subprocess.run([str(arg) for arg in command], cwd=research, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"{log.name}: exit {result.returncode}\n" + "\n".join(log.read_text(errors="replace").splitlines()[-20:]))

    def blender_command(script, *extra):
        return [blender, "--background", "--factory-startup", "--threads", "1", "--python-exit-code", "1", "--python", script, "--", *extra]

    def bake(recipe):
        started = time.monotonic()
        case_id = recipe["id"]
        cache = args.cache / case_id
        native = args.artifact_root / "public/explorer/data" / case_id / "native"
        archived = website / "public/explorer/data" / case_id / "edits/default"
        fixtures = args.artifact_root / "tests/fixtures/native" / case_id
        replay = recipe.get("replay", {})
        request = {"source": str(research / recipe["source"]), "probe": str(research / "visual_validation/algorithm/runtime/blender_probe.py"), "output": str(cache), "states": recipe["states"], **{key: replay.get(key, False if key != "canonical_meshes" else []) for key in ["stable_primitives", "stable_nearest", "canonical_meshes"]}}
        if recipe["export_native_baseline"]:
            request["export_default"] = {"exporter": str(research / "visual_validation/algorithm/blender_live_export.py"), "materials": str(scripts / "export-browser-materials.py"), "glb": str(native / "model.glb")}
        request_path = args.cache / f"{case_id}.request.json"
        request_path.write_text(json.dumps(request, indent=2))
        if args.plan_only:
            return {"case": case_id, "states": len(recipe["states"]), "request": str(request_path)}
        native.mkdir(parents=True, exist_ok=True)
        if not args.skip_capture:
            command(blender_command(scripts / "capture-native-edit-response.py", "--request", request_path), args.cache / f"{case_id}.capture.log")
        packing = recipe["packing"]
        if packing.get("replacement") == "hollow_tree":
            pack_command = [numpy_python, scripts / "pack-native-hollow-tree.py", "--capture", cache, "--source", research / recipe["source"], "--output", native, "--fixtures", fixtures]
        else:
            pack_command = [numpy_python, scripts / "pack-native-edit-response.py", "--capture", cache, "--output", native, "--fixtures", fixtures]
            for key, flag in [("interactions", "--interactions"), ("ratios", "--ratios")]:
                if key in packing:
                    path = args.cache / f"{case_id}.{key}.json"
                    path.write_text(json.dumps(packing[key], indent=2))
                    pack_command.extend([flag, path])
            if packing.get("bed_pillow_height"):
                pack_command.append("--bed-pillow-height")
            if packing.get("procedural") == "chameleon_limbs":
                procedural = args.cache / "chameleon-procedural"
                command(blender_command(scripts / "bake-chameleon-limbs.py", "--source", research / recipe["source"], "--native-cache", cache, "--output", procedural), args.cache / "chameleon-procedural.log")
                pack_command.extend(["--procedural", procedural / "procedural.json"])
        command(pack_command, args.cache / f"{case_id}.pack.log")
        if recipe["export_native_baseline"]:
            reason = ("Local native replay adapter: nearest squared-distance ties within max(1e-12, minimum_squared_distance*1e-5) choose the lowest original vertex index. Applied only to nearest_anchor_in_objects and retained_surface_anchor; original source and archived states remain unchanged. Validation uses this same adapted native program."
                if replay.get("stable_nearest") else "BMesh primitive ordering is canonicalized before seeded face sampling, preventing allocator-dependent hair selection; parameter formulas and original source are unchanged. Evaluated spherical meshes retain one-to-one normalized local vertex identity.")
            command([numpy_python, scripts / "write-native-baseline.py", "--capture", cache / "default", "--archived", archived, "--native", native, "--reason", reason], args.cache / f"{case_id}.baseline.log")
        return {"case": case_id, "states": len(recipe["states"]), "seconds": round(time.monotonic() - started, 1)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for result in pool.map(bake, recipes):
            print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
