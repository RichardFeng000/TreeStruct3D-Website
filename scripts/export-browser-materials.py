#!/usr/bin/env python3
"""Bake unsupported procedural base colors in temporary Blender executions.

Research sources are never edited. The default GLB is replaced only after its
semantic mesh identities and source-space geometry match the previous export.
Texture baking captures base color, not scene lighting. Procedural bump,
displacement, and view-dependent shader effects are not baked by this helper.
Run with Python; it launches the project's Blender executable for each case.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile

SITE = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bake_materials(objects, resolution):
    import bpy
    report = {'strategy': 'cycles_emission_base_color_bake', 'resolution': resolution,
              'lighting_baked': False, 'procedural_normal_baked': False,
              'limitations': 'Base color only; procedural bump and view-dependent effects remain approximations.',
              'objects': [], 'fallbacks': []}
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        entries = []
        for slot in obj.material_slots:
            material = slot.material
            principled = next((node for node in material.node_tree.nodes
                               if node.type == 'BSDF_PRINCIPLED'), None) if material and material.use_nodes else None
            if principled and principled.inputs['Base Color'].is_linked:
                entries.append(material.name)
        if not entries:
            report['objects'].append({'name': obj.name, 'mode': 'native_gltf_material'})
            continue
        # Use the same final evaluated surface the glTF exporter would export.
        # Only a UV layer is added; the world-space surface is verified below.
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True,
                                               depsgraph=depsgraph)
        obj.data = mesh
        obj.modifiers.clear()
        bpy.ops.object.select_all(action='DESELECT')
        obj.hide_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        old_uv = mesh.uv_layers.active.name if mesh.uv_layers.active else None
        uv = mesh.uv_layers.new(name='BrowserMaterialUV')
        uv_name = uv.name
        mesh.uv_layers.active = uv
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.1519173, island_margin=0.02)
        bpy.ops.object.mode_set(mode='OBJECT')
        if old_uv:
            mesh.uv_layers.active = mesh.uv_layers[old_uv]
        size = resolution if len(mesh.polygons) >= 1000 else min(resolution, 256)
        image = bpy.data.images.new(f'{obj.name}_base_color', width=size, height=size, alpha=False)
        image.colorspace_settings.name = 'sRGB'
        states = []
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            original = slot.material
            material = original.copy()
            material.name = f'{original.name} · {obj.name}'
            slot.material = material
            material.use_nodes = True
            nodes, links = material.node_tree.nodes, material.node_tree.links
            principled = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
            output = next((node for node in nodes if node.type == 'OUTPUT_MATERIAL' and node.is_active_output), None)
            if principled is None or output is None:
                raise RuntimeError(f'Cannot bake non-Principled material {original.name} safely')
            color = principled.inputs['Base Color']
            color_source = color.links[0].from_socket if color.is_linked else None
            surface_source = output.inputs['Surface'].links[0].from_socket if output.inputs['Surface'].is_linked else None
            emission = nodes.new('ShaderNodeEmission')
            emission.inputs['Color'].default_value = color.default_value
            if color_source:
                links.new(color_source, emission.inputs['Color'])
            links.new(emission.outputs[0], output.inputs['Surface'])
            target = nodes.new('ShaderNodeTexImage')
            target.image = image
            nodes.active = target
            states.append((material, principled, output, surface_source, emission, target, bool(color_source)))
        try:
            bpy.ops.object.bake(type='EMIT', uv_layer=uv_name)
        except Exception:
            # Never silently ship a failed/black bake. No output is installed
            # until the worker and geometric verification both succeed.
            raise
        for material, principled, output, surface_source, emission, target, linked in states:
            nodes, links = material.node_tree.nodes, material.node_tree.links
            nodes.remove(emission)
            if surface_source:
                links.new(surface_source, output.inputs['Surface'])
            if linked:
                mapping = nodes.new('ShaderNodeUVMap')
                mapping.uv_map = uv_name
                links.new(mapping.outputs['UV'], target.inputs['Vector'])
                links.new(target.outputs['Color'], principled.inputs['Base Color'])
            else:
                nodes.remove(target)
        image.pack()
        report['objects'].append({'name': obj.name, 'mode': 'baked_base_color', 'materials': entries,
                                  'width': size, 'height': size})
    return report


def worker(args):
    import bpy
    import numpy as np
    random.seed(0)
    np.random.seed(0)
    config = read(args.worker_config)
    research = Path(config['research_root'])
    exporter_path = research / 'visual_validation/algorithm/blender_live_export.py'
    exporter = module_at('browser_material_original_exporter', exporter_path)
    source = research / config['case']['source']
    output = Path(config['output'])
    if config['case'].get('final_scene_probe'):
        adapter = SITE / 'scripts/blender-final-scene-probe.py'
        probe = research / 'visual_validation/algorithm/runtime/blender_probe.py'
        # Reuse the existing final-scene execution adapter exactly, injecting
        # only the material conversion immediately before its glTF export.
        code = adapter.read_text()
        old = '    exporter._export_glb(args.glb, objects)'
        if code.count(old) != 1:
            raise RuntimeError('Final-scene adapter changed; review the material hook')
        code = code.replace(old, '    material_export(exporter, args.glb, objects)', 1)
        def material_export(original_exporter, path, objects):
            report = bake_materials(objects, config['resolution'])
            original_exporter._export_glb(path, objects)
            save(config['report'], report)
        sys.argv = [str(adapter), '--', '--probe', str(probe), '--exporter', str(exporter_path),
                    '--glb', str(output), '--script', str(source), '--source-root', str(source.parent),
                    '--output', str(output.parent / 'probe.json'), '--contact-ratio', '0.025',
                    '--anchor-ratio', '0.025', '--samples', '96', '--max-nodes', '2048', '--max-edges', '8192']
        exec(compile(code, str(adapter), 'exec'), {'__file__': str(adapter), '__name__': '__main__',
                                                'material_export': material_export})
    else:
        namespace, _result, _parts = exporter._execute_source(source, {}, 'generic')
        exporter._apply_generic_part_scales(namespace, {})
        exporter._apply_generic_part_visibility(namespace, {})
        exporter._finalize_hidden_objects()
        exporter._finalize_semantic_snapshots()
        objects = exporter._normalize_scene({})
        exporter._ensure_materials(objects)
        report = bake_materials(objects, config['resolution'])
        exporter._export_glb(output, objects)
        save(config['report'], report)
    print('BROWSER_MATERIAL_EXPORT_OK', bpy.app.version_string)


def glb_geometry(path, bake):
    blob = Path(path).read_bytes()
    length, _kind = struct.unpack_from('<II', blob, 12)
    doc = json.loads(blob[20:20 + length])
    binary = blob[28 + length:]
    geometries = {}
    def visit(index, parent):
        node = doc['nodes'][index]
        matrix = bake.multiply(parent, bake.local_matrix(node))
        if 'mesh' in node:
            points = set()
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                accessor = doc['accessors'][primitive['attributes']['POSITION']]
                view = doc['bufferViews'][accessor['bufferView']]
                start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                for j in range(accessor['count']):
                    point = (*struct.unpack_from('<fff', binary, start + j * view.get('byteStride', 12)), 1)
                    points.add(tuple(sum(matrix[r][c] * point[c] for c in range(4)) for r in range(3)))
            geometries[node['name']] = points
        for child in node.get('children', []):
            visit(child, matrix)
    for node in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(node, bake.IDENTITY)
    return geometries, doc


def geometry_matches(left, right, tolerance):
    if left == right:
        return True
    def covered(source, target):
        bins = {}
        for point in target:
            key = tuple(math.floor(value / tolerance) for value in point)
            bins.setdefault(key, []).append(point)
        for point in source:
            cell = tuple(math.floor(value / tolerance) for value in point)
            candidates = (candidate for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
                          for candidate in bins.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), []))
            if not any(math.dist(point, candidate) <= tolerance for candidate in candidates):
                return False
        return True
    return covered(left, right) and covered(right, left)


def preserve_native_geometry(previous, output, report, changed):
    """Keep unchanged material objects byte-for-byte from the saved geometry.

    A source can use iteration-dependent procedural geometry even with a fixed
    seed. Rebuilding that geometry serves no purpose when its materials already
    export natively. UV-baked objects are still independently compared below.
    """
    def parse(path):
        blob = Path(path).read_bytes()
        length = struct.unpack_from('<I', blob, 12)[0]
        return json.loads(blob[20:20 + length]), blob[28 + length:]
    native = {item['name'] for item in report['objects'] if item['mode'] == 'native_gltf_material'} & changed
    report['preserved_geometry_objects'] = sorted(native)
    if not native:
        return
    old, old_binary = parse(previous)
    new, new_binary = parse(output)
    binary = bytearray(new_binary)
    cache = {}
    def accessor(index):
        if index in cache:
            return cache[index]
        value = copy.deepcopy(old['accessors'][index])
        view = copy.deepcopy(old['bufferViews'][value['bufferView']])
        while len(binary) % 4:
            binary.append(0)
        start = view.get('byteOffset', 0)
        view['byteOffset'] = len(binary)
        binary.extend(old_binary[start:start + view['byteLength']])
        value['bufferView'] = len(new['bufferViews'])
        new['bufferViews'].append(view)
        cache[index] = len(new['accessors'])
        new['accessors'].append(value)
        return cache[index]
    old_nodes = {node['name']: node for node in old['nodes'] if 'mesh' in node}
    materials = {material['name']: i for i, material in enumerate(new.get('materials', []))}
    for node in new['nodes']:
        if 'mesh' not in node or node['name'] not in native:
            continue
        original = old_nodes[node['name']]
        mesh = copy.deepcopy(old['meshes'][original['mesh']])
        for primitive in mesh['primitives']:
            primitive['attributes'] = {key: accessor(value) for key, value in primitive['attributes'].items()}
            if 'indices' in primitive:
                primitive['indices'] = accessor(primitive['indices'])
            if primitive.get('targets'):
                raise ValueError('Morph geometry needs explicit preservation support')
            if 'material' in primitive:
                primitive['material'] = materials[old['materials'][primitive['material']]['name']]
        new['meshes'][node['mesh']] = mesh
        for key in ('matrix', 'translation', 'rotation', 'scale'):
            node.pop(key, None)
            if key in original:
                node[key] = original[key]
    new['buffers'][0]['byteLength'] = len(binary)
    while len(binary) % 4:
        binary.append(0)
    document = json.dumps(new, separators=(',', ':')).encode()
    document += b' ' * (-len(document) % 4)
    payload = struct.pack('<II', len(document), 0x4E4F534A) + document + struct.pack('<II', len(binary), 0x004E4942) + binary
    Path(output).write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(payload)) + payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-config', type=Path)
    parser.add_argument('--research-root', type=Path, default=SITE.parent)
    parser.add_argument('--blender', type=Path)
    parser.add_argument('--case', action='append', default=[])
    parser.add_argument('--resolution', type=int, default=512)
    parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'treestruct3d-browser-materials')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--install-prepared', action='store_true', help='Verify and install existing staged outputs without rerunning Blender')
    parser.add_argument('--backup', type=Path, help='Backup directory required for prepared installation')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    if args.worker_config:
        return worker(args)
    if args.install_prepared and (not args.apply or not args.backup):
        parser.error('--install-prepared requires --apply and a verified --backup directory')
    args.research_root = args.research_root.resolve()
    blender = args.blender or args.research_root / 'tools/Blender-5.0.app/Contents/MacOS/Blender'
    bake = module_at('browser_material_bake_checks', SITE / 'scripts/bake-edit-cases.py')
    cases = read(SITE / 'scripts/paper-edit-cases.json')['cases']
    if args.case:
        cases = [case for case in cases if case['id'] in args.case]
        if len(cases) != len(set(args.case)):
            raise ValueError('Unknown or duplicate case selection')
    data = SITE / 'public/explorer/data'
    for case in cases:
        folder = args.output / case['id']
        folder.mkdir(parents=True, exist_ok=True)
        config = folder / 'config.json'
        output, report_path = folder / 'model.glb', folder / 'materials.json'
        save(config, {'research_root': str(args.research_root), 'case': case, 'output': str(output),
                      'report': str(report_path), 'resolution': args.resolution})
        if not args.install_prepared:
            command = [str(blender), '--background', '--factory-startup', '--python-exit-code', '1', '--python', str(Path(__file__).resolve()),
                       '--', '--worker-config', str(config)]
            with (folder / 'blender.log').open('w') as log:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=600)
            if result.returncode:
                raise RuntimeError(f'{case["id"]}: Blender failed; see {folder / "blender.log"}')
        demo_path = data / case['id'] / 'edits/edit-demo.json'
        demo = read(demo_path)
        variant = next(item for item in demo['variants'] if item['id'] == 'default')
        previous = data / variant['glb']
        report = read(report_path)
        if args.install_prepared:
            for path in [demo_path, *[data / variant[key] for key in ('glb', 'snapshot', 'provenance', 'mesh_map')]]:
                backup = args.backup / path.relative_to(data)
                if not backup.is_file() or digest(backup) != digest(path):
                    raise ValueError(f'Current asset has no matching verified backup: {path}')
            if report.get('source_sha256') != digest(args.research_root / case['source']):
                raise ValueError('Source changed since the temporary material export')
        old_geometry, _old_doc = glb_geometry(previous, bake)
        new_geometry, document = glb_geometry(output, bake)
        snapshot_path = data / variant['snapshot']
        snapshot = read(snapshot_path)
        tolerance = max(1e-6, (snapshot['runtime'].get('scene_extent') or 1) * 2e-6)
        if old_geometry.keys() != new_geometry.keys():
            raise ValueError(f'{case["id"]}: Material export changed mesh names')
        changed = {name for name in old_geometry if not geometry_matches(old_geometry[name], new_geometry[name], tolerance)}
        preserve_native_geometry(previous, output, report, changed)
        if changed:
            new_geometry, document = glb_geometry(output, bake)
        if any(not geometry_matches(old_geometry[name], new_geometry[name], tolerance) for name in old_geometry):
            raise ValueError(f'{case["id"]}: Material export changed world-space geometry')
        meshes = bake.glb_mesh_map(output)
        agreement = bake.verify_geometry(snapshot['runtime'], meshes)
        report.update(source_sha256=digest(args.research_root / case['source']),
                      helper_sha256=digest(__file__), blender_version='5.0.0',
                      material_count=len(document.get('materials', [])), image_count=len(document.get('images', [])),
                      geometry_unchanged=True, geometry_comparison_tolerance=tolerance,
                      original_glb_sha256=digest(previous))
        save(report_path, report)
        if args.apply:
            provenance_path = data / variant['provenance']
            provenance = read(provenance_path)
            provenance.update(glb_sha256=digest(output), material_export=report)
            snapshot['provenance'] = provenance
            # Stage file contents before atomically replacing individual assets.
            temporary = previous.with_suffix('.glb.tmp')
            temporary.write_bytes(output.read_bytes())
            temporary.replace(previous)
            save(provenance_path, provenance)
            save(snapshot_path, snapshot)
            save(data / variant['mesh_map'], meshes)
            variant['bytes'] = previous.stat().st_size
            if demo.get('baseline', {}).get('id') == 'default':
                demo['baseline']['bytes'] = variant['bytes']
            save(demo_path, demo)
            manifest_path = data / 'manifest.json'
            manifest = read(manifest_path)
            entry = next(item for item in manifest['models'] if item['id'] == case['id'])
            entry['bytes'] = variant['bytes']
            for state in entry['edit_demo']['variants']:
                if state['id'] == 'default':
                    state['bytes'] = variant['bytes']
            save(manifest_path, manifest)
        print(json.dumps({'case': case['id'], 'images': report['image_count'], 'bytes': output.stat().st_size,
                          'geometry_unchanged': True, 'applied': args.apply, 'agreement': agreement}), flush=True)


if __name__ == '__main__':
    main()
