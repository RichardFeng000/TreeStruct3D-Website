# Interactive explorer snapshots

The explorer adapts the TreeStruct3D Visual Validation Toolkit's inspector from
`visual_validation/frontend/model_playground.html` in
[`RichardFeng000/TreeStruct3D`](https://github.com/RichardFeng000/TreeStruct3D),
based on project revision `672e3e3908d7f3caa8a0bad4f091c2f9f6f69647`.
The browser module retains the toolkit's graph layout, real-part hierarchy,
mesh picking, anchor inspection, and Three.js view controls. A static adapter
replaces the local API, generation, and review actions. Selection handling,
material restoration, shared-anchor validation, and the light theme are adapted
for the published website.

## Included examples

| Example | Source | Runtime parts | Verified shared anchors |
| --- | --- | ---: | ---: |
| Monitor | TreeStruct3D · GPT-5.6-sol | 4 | 3 |
| Floor lamp | TreeStruct3D · GPT-5.5 | 5 | 4 |
| Chameleon | TreeStruct3D · Gemini 3.1 Pro | 13 instances / 6 semantic IDs | 0 |
| Fish | Stage 1 baseline | 10 | 0 |

These counts describe the saved examples only. Chameleon's authored anchor
coordinates have no strictly verified shared anchors; they must not appear as
green shared connections. The Fish baseline includes two broken attachments.
Parameter-invariance details, where present, are saved local probe observations.
Changing view controls does not perform a new validation run.

The three method examples are compact release artifacts curated from local
experiment exports. The baseline originates from the tracked Stage 1 dataset.
Original experiment Python files, provider responses, configuration, and other
local cache contents are not published with this website. Each example records
its repository-relative source path, source hash, export identity, and geometry
verification in `provenance.json`.

## Published data

`public/explorer/data/manifest.json` lists the supported examples. Each example
directory contains:

- `model.glb`: the unmodified cached model, with named mesh nodes and any
  historical `stage7_part_id` semantic identity fields.
- `snapshot.json`: the saved `schema`, static `structure`, observed `runtime`
  graph, and `provenance` in a single document.
- `mesh-map.json`: measured GLB world-space mesh bounds and semantic identities.
- `provenance.json`: source/export hashes, source-to-cache metadata matching,
  coordinate alignment, and saved validation context.

The static adapter uses runtime IDs for part and anchor views so selections
resolve to the exported meshes. Definition and call views retain the saved
static analysis. Shared connections require `shared_anchor === true`.

Runtime points use Blender Z-up; the GLB uses Y-up. The coordinate conversion is
`[x, y, z] -> [x, z, -y]`, followed by the saved export translation. The adapted
viewer already aligns coordinates through `source_bounds`, so this translation
must not be applied a second time. Mesh bounding-box agreement after alignment
is better than `2.1e-7` scene units for all four examples.

## Updating examples

Only include a GLB and runtime snapshot that match the same source/export.
Preserve the exact exported mesh names, audit the source metadata and hashes,
and verify coordinate alignment. Add the example to the manifest and run
`npm run check:explorer` before publishing a new portfolio snapshot.

## Display palette

The theme follows the background and interface palette of
[3DCodeBench](https://www.3dcodebench.com/): surface `#ffffff`, alternate surface
`#f8f9fa`, border `#e8eaed`, text `#202124`, secondary text `#5f6368`, and primary
blue `#1a73e8`. This website uses its own project identity and toolkit content.
