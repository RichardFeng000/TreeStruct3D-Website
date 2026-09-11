#!/usr/bin/env python3
"""Assemble the complete, locally prepared paper demo. Does not publish it."""
import hashlib
import json
from collections import Counter
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
EXPLORER = SITE / 'public' / 'explorer'
DATA = EXPLORER / 'data'
STATE_IDS = {'default', 'parent-0.4', 'parent-1.6', 'child-0.4', 'child-1.6'}


def read(path):
    return json.loads(path.read_text())


def checked_path(base, relative):
    path = (base / relative).resolve()
    path.relative_to(base.resolve())
    if not path.is_file():
        raise ValueError(f'Missing prepared asset: {relative}')
    return path


def main():
    renders = read(EXPLORER / 'paper-demos' / 'paper-render-index.json')['cases']
    assert len(renders) == 20 and len({c['id'] for c in renders}) == 20
    assert sorted(Counter(c['provider'] for c in renders).values()) == [5, 5, 5, 5]
    models = []
    for case in renders:
        demo = read(DATA / case['id'] / 'edits' / 'edit-demo.json')
        assert {v['id'] for v in demo['variants']} == STATE_IDS, case['id']
        assert len(demo['variants']) == 5, case['id']
        assert demo['parent']['ids'] == case['parent_ids']
        assert demo['child']['ids'] == case['child_ids']
        for variant in demo['variants']:
            paths = {field: checked_path(DATA, variant[field]) for field in ('glb', 'snapshot', 'provenance', 'mesh_map')}
            snapshot = read(paths['snapshot'])
            assert paths['glb'].stat().st_size == variant['bytes']
            assert hashlib.sha256(paths['glb'].read_bytes()).hexdigest() == snapshot['provenance']['glb_sha256']
            assert snapshot['provenance']['edit']['id'] == variant['id']
        base = next(v for v in demo['variants'] if v['id'] == 'default')
        runtime = read(DATA / base['snapshot'])['runtime']
        entry = {
            'id': case['id'], 'title': case['label'], 'label': case['case'],
            'model': f"{case['case']}/{case['case']}",
            'provider': case['provider'], 'source': case['provider_slug'],
            'source_label': case['provider'], 'directory': case['id'],
            **{key: base[key] for key in ('glb', 'snapshot', 'mesh_map', 'provenance', 'bytes')},
            'parts': len(runtime['nodes']),
            'shared_anchors': sum(edge.get('shared_anchor') is True for edge in runtime['edges']),
            'historical_validation': case['historical_validation'],
            'edit_demo': {key: demo[key] for key in ('parent', 'child', 'scales', 'mode', 'variants')},
            'paper_renders': {'states': []},
        }
        native_directory = Path(case['id']) / 'native'
        native_path = native_directory / 'native-edit.json'
        native = read(checked_path(DATA, native_path))
        native_binary = native_directory / native['binary']
        checked_path(DATA, native_binary)
        entry['native_edit'] = {
            'response': native_path.as_posix(),
            'buffer': native_binary.as_posix(),
        }
        if native.get('baseline'):
            entry['native_edit']['baseline'] = {}
            for key in ('glb', 'snapshot', 'mesh_map', 'provenance'):
                relative = native_directory / native['baseline'][key]
                checked_path(DATA, relative)
                entry['native_edit']['baseline'][key] = relative.as_posix()
        for source_key, target_key in [('tree', 'paper_renders'), ('baseline', 'comparison')]:
            if source_key not in case:
                continue
            images = case[source_key]['states']
            assert {state['id'] for state in images} == STATE_IDS
            for state in images:
                path = checked_path(EXPLORER, state['image'])
                assert hashlib.sha256(path.read_bytes()).hexdigest() == state['sha256']
            entry[target_key] = {
                'label': 'TreeStruct3D' if source_key == 'tree' else '3DCodeBench',
                'states': [{key: state[key] for key in ('id', 'image', 'width', 'height')} for state in images],
            }
            if source_key == 'baseline':
                entry[target_key]['edit_mode'] = case[source_key]['edit_mode']
                entry[target_key]['note'] = 'Original paper renders: 3DCodeBench uses object-group scaling; TreeStruct3D rebuilds its parameters. The 3D view is rebuilt separately.'
        models.append(entry)
    for provider in {entry['provider'] for entry in models}:
        assert sum('comparison' in entry for entry in models if entry['provider'] == provider) == 1
    catalog = {
        'version': 2,
        'description': 'Twenty paper cases in four model collections, with native Blender parameter response data and case-specific geometry rules for continuous browser editing. Archived paper states retain their own saved Blender checks.',
        'coordinate_system': {'glb': 'right-handed Y-up', 'runtime': 'Blender Z-up', 'blender_to_gltf': '[x, y, z] -> [x, z, -y]'},
        'models': models,
    }
    destination = DATA / 'manifest.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Prepared {len(models)} cases, 100 GLB states, and 4 paper comparisons: {destination}')


if __name__ == '__main__':
    main()
