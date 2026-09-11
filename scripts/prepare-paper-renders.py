#!/usr/bin/env python3
"""Copy the existing paper demo PNGs without modifying their image bytes.

Run from any directory with Python 3.10+; no third-party packages are required.
The input paths are relative to the research repository containing this site.
This script never executes Blender or the archived source programs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = SITE_ROOT / "docs/paper-demo-cases.json"
OUTPUT = SITE_ROOT / "public/explorer/paper-demos"
PROVIDER_SLUGS = {
    "GPT-5.5": "gpt-5-5",
    "GPT-5.6 Sol": "gpt-5-6-sol",
    "Gemini 3.1 Pro": "gemini-3-1-pro",
    "Gemini 3.5 Flash": "gemini-3-5-flash",
}
STATE_IDS = {
    "default": "default",
    "parent_0p4": "parent-0.4",
    "parent_1p6": "parent-1.6",
    "child_0p4": "child-0.4",
    "child_1p6": "child-1.6",
}


def case_words(case: str) -> str:
    name = re.sub(r"_seed\d+$", "", case)
    name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name).replace("_", " ")


def case_id(provider: str, case: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", case_words(case).lower()).strip("-")
    return f"paper-{PROVIDER_SLUGS[provider]}-{slug}"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_path(research_root: Path, relative: str) -> Path:
    path = (research_root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(research_root):
        raise ValueError(f"Expected a path relative to the research root: {relative}")
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", type=Path, default=SITE_ROOT.parent)
    parser.add_argument("--check", action="store_true", help="Verify outputs without writing any files.")
    args = parser.parse_args()
    research_root = args.research_root.resolve()
    manifest_bytes = MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    copies: list[tuple[Path, Path, str]] = []
    cases = []
    dimensions: dict[str, int] = {}
    total_bytes = 0
    tree_count = baseline_count = 0

    for case in manifest["cases"]:
        identifier = case_id(case["provider"], case["case"])
        semantic = case["semantic"]
        record = {
            "id": identifier,
            "provider": case["provider"],
            "provider_slug": PROVIDER_SLUGS[case["provider"]],
            "label": case_words(case["case"]),
            "case": case["case"],
            "group": case["group"],
            "source_figure": case["source_figure"],
            "parent_label": semantic["parent_label"],
            "child_label": semantic["child_label"],
            "parent_ids": case["parent_ids"],
            "child_ids": case["child_ids"],
            "source_script": case["source_script"],
            "historical_validation": case["historical_validation"],
        }
        for method in ("tree", "baseline"):
            if method == "baseline" and "baseline" not in case:
                continue
            source = case if method == "tree" else case["baseline"]
            states = []
            if [state["state"] for state in source["states"]] != list(STATE_IDS):
                raise ValueError(f"Unexpected state order for {identifier}/{method}")
            for state in source["states"]:
                source_file = source_path(research_root, state["render_path"])
                data = source_file.read_bytes()
                if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
                    raise ValueError(f"Expected an original PNG: {source_file}")
                width, height = struct.unpack(">II", data[16:24])
                state_id = STATE_IDS[state["state"]]
                destination = OUTPUT / identifier / method / f"{state_id}.png"
                sha256 = digest(data)
                copies.append((source_file, destination, sha256))
                states.append({
                    "id": state_id,
                    "image": destination.relative_to(OUTPUT.parent).as_posix(),
                    "edited_side": state["edited_side"],
                    "parent_scale": state["parent_scale"],
                    "child_scale": state["child_scale"],
                    "width": width,
                    "height": height,
                    "bytes": len(data),
                    "source_image": state["render_path"],
                    "sha256": sha256,
                })
                key = f"{width}x{height}"
                dimensions[key] = dimensions.get(key, 0) + 1
                total_bytes += len(data)
                if method == "tree":
                    tree_count += 1
                else:
                    baseline_count += 1
            record[method] = {"states": states}
            if method == "baseline":
                record[method].update({
                    "edit_mode": source["edit_mode"],
                    "note": source["note"],
                    "source_script": source["source_script"],
                })
        if "runtime_mapping_note" in case:
            record["runtime_mapping_note"] = case["runtime_mapping_note"]
        cases.append(record)

    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Duplicate generated case IDs")
    if (len(cases), tree_count, baseline_count) != (20, 100, 20):
        raise ValueError("Expected exactly 20 cases, 100 tree PNGs, and 20 baseline PNGs")
    index = {
        "schema_version": 1,
        "source_manifest": "docs/paper-demo-cases.json",
        "source_manifest_sha256": digest(manifest_bytes),
        "path_base": "Image URLs are relative to public/explorer. Source paths are relative to the research repository.",
        "copy_mode": "Unmodified source PNG bytes; no resampling, recompression, or image edits.",
        "edit_roles": "Parent and child are paper edit roles, which may differ from Blender object parenting. Repeated part IDs may represent multiple instances.",
        "validation_scope": "Historical 0.8/1.2 checks do not certify the displayed 0.4/1.6 stress states; retain each case's recorded scope.",
        "case_count": len(cases),
        "tree_render_count": tree_count,
        "baseline_render_count": baseline_count,
        "total_render_bytes": total_bytes,
        "dimensions": dimensions,
        "cases": cases,
    }
    index_bytes = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    index_path = OUTPUT / "paper-render-index.json"

    # Resolve and validate every input before writing the first output.
    changed = 0
    for source_file, destination, sha256 in copies:
        matches = destination.is_file() and digest(destination.read_bytes()) == sha256
        if args.check:
            if not matches:
                raise RuntimeError(f"Missing or changed output: {destination}")
        elif not matches:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_file, destination)
            if digest(destination.read_bytes()) != sha256:
                raise RuntimeError(f"Source changed during copy: {source_file}")
            changed += 1
    if args.check:
        if not index_path.is_file() or index_path.read_bytes() != index_bytes:
            raise RuntimeError(f"Missing or stale render index: {index_path}")
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        if not index_path.is_file() or index_path.read_bytes() != index_bytes:
            index_path.write_bytes(index_bytes)
    print(f"{'Verified' if args.check else 'Prepared'} {len(cases)} cases / {len(copies)} PNGs / {total_bytes:,} bytes ({total_bytes / 1024**2:.2f} MiB); dimensions: {dimensions}; copied: {changed}.")
    print(index_path.relative_to(SITE_ROOT))


if __name__ == "__main__":
    main()
