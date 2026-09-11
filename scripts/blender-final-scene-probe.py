"""Export the exact final scene observed by a local runtime probe.

This adapter leaves research sources unchanged. It refreshes the toolkit's
cached attachment-time observations after all source modifiers are installed,
checks authored local anchors against final evaluated surfaces, and exports
that same execution. Bounds use polygon vertices because glTF omits loose
vertices. The toolkit's relation rules and tolerances are unchanged.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import types


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError("Runtime probe changed; review the final-scene adapter")
    return text.replace(before, after, 1)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--exporter", type=Path, required=True)
    parser.add_argument("--glb", type=Path, required=True)
    args, probe_args = parser.parse_known_args(argv)
    source = args.probe.read_text()
    source = replace_once(source,
        '        points = [_vector(matrix @ vertex.co) for vertex in mesh.vertices]',
        '        used_vertices = {index for polygon in mesh.polygons for index in polygon.vertices}\n'
        '        points = [_vector(matrix @ vertex.co) for vertex in mesh.vertices if vertex.index in used_vertices]')
    source = replace_once(source,
        '                    "native_parameter_protocol": bool(native_part_params),',
        '                    "native_parameter_protocol": bool(native_part_params),\n'
        '                    "child_anchor_local": _vector(child_anchor_local) if child_anchor_local is not None else None,\n'
        '                    "parent_anchor_local": _vector(parent_anchor_local) if parent_anchor_local is not None else None,')
    source = replace_once(source,
        '            observation = remember(obj)\n'
        '            if observation is None:\n'
        '                continue\n'
        '            registry[obj.name] = observation',
        '            observation = _observe_object(obj, depsgraph, args.samples)\n'
        '            if observation is None:\n'
        '                continue\n'
        '            registry[obj.name] = observation')
    refresh = '''        for link in declared_links:
            child = final_objects.get(link["child"])
            parent = final_objects.get(link["parent"])
            child_local = link.get("child_anchor_local")
            parent_local = link.get("parent_anchor_local")
            if child is None or parent is None or child_local is None or parent_local is None:
                continue
            child_world, child_gap = exact_anchor_endpoint(child, child_local)
            parent_world, parent_gap = exact_anchor_endpoint(parent, parent_local)
            gap = _distance(child_world, parent_world) if child_world is not None and parent_world is not None else None
            tolerance = float(link.get("authored_anchor_tolerance", 1e-5))
            link.update(child_anchor_world=child_world, parent_anchor_world=parent_world,
                        authored_anchor_gap=gap, child_anchor_vertex_gap=child_gap,
                        parent_anchor_vertex_gap=parent_gap,
                        authored_anchor_valid=bool(gap is not None and gap <= tolerance
                            and child_gap is not None and child_gap <= tolerance
                            and parent_gap is not None and parent_gap <= tolerance))

'''
    source = replace_once(source, '        def anchor_signature(value):', refresh + '        def anchor_signature(value):')
    module = types.ModuleType("website_final_scene_probe")
    module.__file__ = str(args.probe)
    exec(compile(source, str(args.probe), "exec"), module.__dict__)
    sys.argv = [str(args.probe), "--", *probe_args]
    module.main()
    output = Path(probe_args[probe_args.index("--output") + 1])
    report = json.loads(output.read_text())
    if report.get("status") != "ok":
        raise RuntimeError(report.get("error", "Runtime probe failed"))
    spec = importlib.util.spec_from_file_location("website_exporter", args.exporter)
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    objects = exporter._normalize_scene({})
    exporter._ensure_materials(objects)
    exporter._export_glb(args.glb, objects)
    report["website_final_scene_adapter"] = {
        "same_execution_export": True,
        "geometry_observation": "final_evaluated_polygon_vertices",
        "anchor_observation": "final_evaluated_surface_after_all_source_modifiers",
        "probe_rules_and_tolerances_changed": False,
    }
    output.write_text(json.dumps(report))


if __name__ == "__main__":
    main()
