# Paper cases and native parameter editing

The website uses four collections with exactly five cases each. One case per
collection includes the original 3DCodeBench comparison renders.

| Collection | Appendix examples | Comparison example |
| --- | --- | --- |
| GPT-5.5 | HollowTree, Pan, Bed, FloorLamp | Crab |
| GPT-5.6 Sol | Toilet, SpinyLobster, Monitor, StandingSink | Lobster |
| Gemini 3.1 Pro | BedFrame, CabinetDrawerBase, CoconutTree, Pillar | Dragonfly |
| Gemini 3.5 Flash | FruitPineapple, ColumnarCactus, VeratrumMonocot, CoffeeTable | Chameleon |

## Native parameter editor

The editor uses the original programs' `PART_PARAMS[part_id].scale` controls.
The 20 selected programs contain **91 native scale parameters**. Every observed
part remains selectable from the model, structure tree, or expanded part list.
Scales range from 0.4× to 1.6× in 0.01 increments; numeric input is clamped and
rounded to the same grid. Multiple parameter edits are retained together.

Several mesh instances can share one native parameter. Editing a pineapple
crown leaf changes all 48 leaf instances, and editing a Veratrum floret changes
all 48 florets, as in the source program. Resetting one such instance resets its
shared parameter. This grouping is separate from the paper's Chameleon child
preset, which changes four distinct limb parameters together.

The model shows anchor points only on highlighted parts: parent points in yellow
and child points in cyan, including unverified and edited pairs. Clearing the
highlight hides the points. Selecting an attachment relation shows that pair.
The anchor view keeps pairs available during editing; only original verified
relations use the verified styling. Nearby surface estimates without a declared
or directed attachment are excluded.

For catalog entries with `native_edit` assets,
`public/explorer/native-edit.js` reconstructs geometry from locally captured
Blender parameter responses. It combines independent responses, parameter
interaction corrections, and case-specific source formulas. Each update starts
from immutable baseline data, so edits and resets do not accumulate drift.
Joined meshes can move their separate attachment regions as the original
generator does; a single whole-part pivot is insufficient for these cases.

HollowTree replaces its branch mesh with the exact captured topology for the
selected hundredth. Chameleon limbs replay the original 84-vertex construction,
the native nearest-vertex snap choice, and captured Blender subdivision weights.
Other nonlinear responses use sampled curves or interaction fields. Finite
sampling is not a claim of exact equivalence at arbitrary real-valued scales.
See [Native geometry fidelity](native-fidelity.md) for the methods, validation
status, reproduction commands, and remaining limits.

The browser does not run Blender or rerun structural validation. While any
parameter is edited, saved pass/fail claims are cleared and the runtime carries
`preview_only: true` and `validation_status: "not_run"`. Resetting every
parameter to 1× restores the loaded baseline's observations. A newly captured
deterministic baseline can itself have `not_run` status; it does not inherit
the archived realization's passing checks. The older
`continuous-edit.js` transform approximation remains a compatibility path for
catalog entries without native data; it is not the native reconstruction
method. Invalid advertised native data produces a load error rather than a
silent fallback.

## Archived paper comparisons

The comparison pane has an independent selector for the five original states:
default, parent 0.4×, parent 1.6×, child 0.4×, and child 1.6×. It never substitutes
a nearest archived image for a continuous value such as 0.63× or 1.37×.
The saved Blender GLBs and their checks remain available as source artifacts;
their checks apply only to those exact saved states.

## Asset generation

`docs/paper-demo-cases.json` maps the published figures to existing local source
programs, actual parameter IDs, and original renders. Paths in that document are
relative to the research repository containing this website checkout.

- `scripts/prepare-paper-renders.py` copies the 120 original PNGs byte-for-byte.
- `scripts/bake-edit-cases.py` rebuilds each TreeStruct3D state in Blender and
  exports its geometry together with matching runtime observations. Mesh
  identities and geometry bounds are checked before the state is accepted.
- `scripts/blender-final-scene-probe.py` handles programs that add modifiers
  after attachment creation. It refreshes observations on the final evaluated
  scene and exports that same execution, avoiding the toolkit's cached earlier
  geometry. It also excludes loose, unrendered vertices from geometry bounds.
  The research source files and toolkit are left unchanged, and each state's
  provenance records which probe/export mode was used.
- `scripts/build-paper-manifest.py` assembles the complete static catalog from
  the prepared renders, saved states, and native reconstruction data. It
  refuses incomplete case sets.
- `scripts/bake-native-edits.py` reproduces the complete native data from
  `scripts/native-edit-recipes.json`, including all 20 cases, special execution
  adaptations, packing settings, and held-out fixtures.
- `scripts/capture-native-edit-response.py` captures evaluated native vertices,
  topology, normals, material assignments, and declared attachment coordinates
  for the scale controls and held-out combinations.
- `scripts/write-native-baseline.py` describes a freshly captured baseline and
  its matching material export, invalidating archived checks when the native
  realization differs.
- `scripts/pack-native-edit-response.py`, `scripts/pack-native-hollow-tree.py`,
  and `scripts/bake-chameleon-limbs.py` prepare the browser reconstruction data.
- `scripts/export-browser-materials.py` bakes unsupported procedural base
  colors into textures while checking that export geometry is preserved.
  Lighting, procedural bump, and view-dependent shading are not reproduced
  pixel for pixel.

The build and browser need only the resulting static assets. Blender is needed
only when regenerating these files locally. Nothing in these scripts commits,
pushes, or deploys the website.

## Interpretation

The paper's parent/child labels describe editing roles. Runtime edges preserve
the actual generated program structure; for example, the Monitor's Blender
parenting direction differs from its paper editing roles. Repeated instances
are resolved using semantic part IDs, and the Chameleon child edit changes all
four selected limbs together.

The comparison PNGs remain the exact archived paper renders. The TreeStruct3D
renders use parameter-based regeneration; the Figure 1 baseline renders use
diagnostic object-group scaling after execution. They should not be described
as the same parameter-editing protocol.

The old paper checks at 0.8× and 1.2× do not certify the saved 0.4× and 1.6×
states or continuous browser edits. Each baked asset retains its own checks,
including failures. Continuous previews carry an explicit `not_run` validation
status and must not inherit either set of pass/fail results.
