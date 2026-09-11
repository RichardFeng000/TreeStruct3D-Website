# Native geometry fidelity

The static explorer reconstructs selected TreeStruct3D programs' parameter
edits from local Blender executions. GitHub Pages serves the resulting files;
it does not execute Blender, Python, or a remote geometry service. Geometry
reconstruction and attachment validation are separate: an edited browser model
always has `validation_status: "not_run"` until a matching validation has
actually been performed.

## Scope and controls

The catalog contains 20 cases, four providers with five cases each. Their
literal `PART_PARAMS` dictionaries contain 91 scale controls. The supported UI
domain is 0.40–1.60 inclusive, rounded to 0.01. This is 121 values per control,
not arbitrary real-valued parameter execution.

[paper-demo-cases.json](paper-demo-cases.json) records figure provenance and
original parameter IDs. [native-dependencies.json](../scripts/native-dependencies.json)
records source hashes, runtime instances, actual parent edges, cross-parameter
dependencies, and the evidence behind special handling. A runtime instance's
`part_id` selects its source parameter. Repeated leaves, florets, wings, or legs
can therefore share a control even though they remain separately selectable.

The attachment forest alone does not determine every dependency. The Monitor's
paper editing roles reverse an actual Blender parenting edge. CoffeeTable's
top-to-leg relationship passes through the bottom shelf. Bed pillow parameters
also change authored patches on the mattress. The native reconstruction keeps
these source dependencies instead of inferring geometry solely from tree edges.

## Reconstruction methods

### Native response fields

`capture-native-edit-response.py` executes the original parameterized program
locally through the validation toolkit's instrumentation. Each capture records
final evaluated world-space positions in Blender Z-up coordinates, topology,
normals, material indices, and declared attachment coordinates. Research source
files are not edited. The browser binds GLB vertices to these native positions;
it does not assume that glTF preserves Blender vertex indices. UV, material,
and normal seams can duplicate a source vertex in the GLB.

For a control `i`, the independent field is the native displacement
`F(s_i, others=1) - F(1)`. Linear responses can use endpoint samples; nonlinear
responses retain additional native samples. Every update reconstructs from the
baseline and current parameter values, preventing cumulative transform drift.

Independent fields cannot represent all simultaneous edits. For example, Bed
mattress width is `4.68 * frame_scale * mattress_scale`, and blanket width also
multiplies `blanket_scale`. The packer adds sparse pair and triple residual
fields after subtracting the already included lower-order responses. The
browser evaluates these tensor grids with multilinear interpolation. Exact
multilinear source terms and general nonlinear sampled functions must not be
described as having the same interpolation guarantee. Held-out native results
measure the error of the assembled reconstruction.

Bed's pillow attachment height is evaluated directly from the source formula
instead of being approximated by a three-dimensional interpolation grid. For
frame scale `f`, mattress scale `m`, and pillow scale `p`:

```text
u = abs(1 - (1.16 / 7.54) * p / (f * m))
z = m * (0.62 + 0.055 * max(0, 0.75 * (1 - u*u))
               - 0.045 * max(0.5, u)^4)
```

Packing with `--bed-pillow-height` removes this scalar contribution before
building response fields and records the affected vertex/anchor weights. The
browser restores the exact scalar contribution for both the whole pillow mesh
and its two authored patches on the mattress. Pair/triple fields handle the
remaining dimensional dependencies.

### Ratio corrections

Pan handle curvature and FloorLamp tray/shade geometry use ratio corrections
for shapes homogeneous in two scale variables. Crab's coupled carapace/leg
response is currently packaged as a 13×13 pair-residual grid instead. With
numerator `u`, denominator `v`, and
`D(r) = F(r, 1) - F(1, 1)`, the correction after independent responses is:

```text
v * D(u / v) - D(u) - v * D(1 / v)
```

The correction is zero when either parameter is 1. Ratio samples must cover
0.25–4 because both controls independently range over 0.4–1.6. The current
capture configuration samples this ratio domain in 0.01 steps. This formula
preserves the source's two-parameter dependency; interpolation between ratio
samples still has a measurable approximation error. Native clamp branches,
bevel evaluation, and attachment coordinates are included in the captures.

### HollowTree topology replacement

The HollowTree source shares a pseudorandom stream between bark-material
assignment and recursive branch generation. Material decisions depend on
scaled height and conditionally consume random numbers, so changing branch
scale can change the actual number of branches and triangles. A fixed vertex
displacement field cannot express this behavior.

`pack-native-hollow-tree.py` packages all 121 branch states for the supported
hundredths, including positions, triangle indices, normals, and per-triangle
material assignments. `native-replacement.js` selects that exact state; it
does not morph incompatible topologies. Trunk edits apply the separately
captured common translation to the branch mesh while rebuilding trunk geometry.
The packer checks this translation decomposition against native captures. The
binary is gzip-compressed for static delivery.

### Chameleon source formula and native subdivision

Each Chameleon limb starts with 84 vertices: four rings of 12 vertices, followed
by three toes with 12 interleaved start/end vertices each. Torso scale controls
the limb's drop height, and limb scale controls radii and toe dimensions. The
source then moves the nearest coarse vertex to `(0, 0, 0)` and applies Blender
Subdivision Surface at level 2. Floating-point ties can change which vertex is
snapped, so interpolating final limb meshes can introduce a different shape.

`bake-chameleon-limbs.py` compiles the original three limb/snap/shading function
definitions without executing the complete model. It captures a linear
subdivision matrix mapping 84 coarse vertices to the 1,048 evaluated vertices
of each limb, plus a 121×121 torso/limb snap-index table. The table uses the
original formulas and native `mathutils` operations. A lightweight vertex
collector is checked against real Blender coarse meshes; subdivision is checked
against real evaluated meshes and separately captured complete models.

`native-chameleon.js` rebuilds those coarse vertices, applies the saved snap
choice, multiplies by the native subdivision weights, and restores the source
attachment translation. This retains the native construction over the supported
hundredth grid without storing a complete model for every parameter pair.

## Deterministic source execution and identity

Some BMesh primitives change vertex/face traversal order between executions.
An unchanged point cloud can therefore appear different under an index-by-index
comparison. Where appropriate, capture binds normalized local positions back
to a canonical baseline ordering and rejects ambiguous correspondence.

Dragonfly also assigns seeded random hairs by iterating sphere faces. A changed
face order changes which faces receive hairs, even with the same seed. The
capture adapter's `stable_primitives` option injects a deterministic sort of
BMesh vertices, edges, and faces immediately after UV-sphere creation and before
parameter-dependent deformation and hair sampling. Default and edited captures
must use the same adapter. This is an explicit execution adaptation; it must not
be mistaken for proof that arbitrary uninstrumented executions are identical.

Lobster's `stable_nearest` option makes near-equal nearest-vertex selections
deterministic inside `retained_surface_anchor` and `nearest_anchor_in_objects`.
Their key is squared distance. Among vertices with squared distance at most
`d_min + max(1e-12, abs(d_min) * 1e-5)`, the adapter chooses the smallest source
vertex index. The comparison between different objects remains unchanged.
This explicit tolerance/tie rule prevents floating-point noise from switching
the selected attachment to a distant vertex on a symmetric surface. Its
baseline and edited captures use the same rule; it is not an assertion that
every unadapted source execution makes that same choice.

Both adaptations are injected into the temporary execution AST. The original
research files and the 100 archived saved-state assets remain unchanged by
these adaptations.

When a stabilized execution has a different realization from the archived GLB,
its matching baseline GLB, snapshot, and mesh map are stored under `native/`.
`write-native-baseline.py` verifies those files against that exact capture and
marks the baseline geometry/directions as `not_run` for attachment validation.
The viewer uses this matched baseline for native editing while retaining the
separate archived five-state assets and their original provenance.

## Materials and validation boundaries

`export-browser-materials.py` evaluates linked procedural base colors through
an emission bake and stores UV textures for glTF. It verifies mesh identities
and source-space geometry before installing a material export. Native PBR
properties that glTF supports remain available. Scene illumination, procedural
bump/displacement shading, and view-dependent shader effects are not captured
by this base-color bake. Browser lighting and the archived paper renders can
therefore look different even when geometry agrees.

Editing does not rerun execution checks, surface contact, authored-anchor
validity, or the paper's acceptance procedure. Saved pass/fail fields and gaps
are invalidated while parameters differ from baseline. Displayed anchor
coordinates are geometry information, not a new passing validation result.
Returning all controls to 1 restores the loaded baseline observations; it does
not transfer archived checks to a newly captured deterministic realization.

The five archived paper image states have an independent selector. A live value
such as 1.37 never receives the nearest PNG as if it were its render. The
TreeStruct3D paper images use parameter regeneration, while Figure 1's
3DCodeBench baseline images use diagnostic object-group scaling after execution.
Historical 0.8/1.2 checks do not certify the 0.4/1.6 archived edits or current
browser edits. Existing failures and these protocol qualifications are retained
in the case map and per-state provenance.

## Verification status

All 20 catalog entries advertise native reconstruction data, and all 20
browser-module geometry comparisons passed against independently captured
Blender fixtures. The 91-check full suite passed, followed by two additional
gzip/catalog checks: 93 distinct passing checks. Source SHA-256 verification
confirmed that all 20 original research programs remain unchanged.

| Verified artifact or measurement | Result |
| --- | --- |
| Native cases / scale controls | 20 / 91 |
| Packed native fixture states | 306, covering all 20 cases |
| Native capture recipe | 4,098 states |
| Served response binaries | 113,662,775 bytes (about 108.4 MiB), excluding JSON, GLBs, and images |
| Native JSON headers | 3,931,779 bytes |
| Largest response binary | HollowTree: 59,465,354 bytes, gzip-compressed |
| Maximum packer-reported simultaneous-edit residual | `3.5884e-5` of source geometry extent, for FloorLamp |

The geometry tests use a relative tolerance bound of `1e-4` times geometry
extent, with the absolute numerical floor defined in the test. The packer's
reported maximum above is its own native-coordinate measurement, not a
claim of bitmap identity or a proof for every possible parameter assignment.
The 306 fixtures include off-knot single-control values and simultaneous edits;
targeted cases also include randomized held-outs. They do not exhaust the
Cartesian product of 121 values across every control.

One completed focused check compares the JavaScript Chameleon limb replay with
649 independently captured full-model states: 2,596 limb comparisons, with a
maximum world-vertex error of `4.1963e-7` native units. Its 36 real-mesh fixtures
include 0.63, 1.37, simultaneous torso/limb changes, and opposite domain corners.
These more detailed numbers cover the limb replay. The raw local reports are under
`/tmp/treestruct-native-chameleon-procedural/`.

The checks cover source/binary hashes, GLB/native vertex binding, supported
control coverage, reset round trips, single-control held-outs, simultaneous
edits, replacement topology, and invalid-data failure handling. Coordinate
agreement remains separate from a structural-validity claim. All 93 explorer
tests, lint, and the local `/treeStruct3D` static build pass. The native loader
was also checked against a real HTTP response with `Content-Encoding: gzip`:
Floor Lamp's decoded geometry matched the source binary byte for byte. The
loader handles both raw gzip files and responses already decoded by `fetch`.

## Local reproduction

The website checkout lives at
`/Users/fengruiding/Downloads/3d_code/TreeStruct3D-Website`. The research sources
and validation toolkit live in its parent directory. The published static
assets can be previewed without Blender:

```sh
cd /Users/fengruiding/Downloads/3d_code/TreeStruct3D-Website
npm ci
npm run dev -- --host 127.0.0.1
```

The local captures use Blender 5.0.0, Python with NumPy for packing, and Node
22.13 or newer for the website/tests. The local Blender binary is
`../tools/Blender-5.0.app/Contents/MacOS/Blender`. Use the same Blender version
when comparing evaluated topology or subdivision order. On this macOS setup,
Blender's startup GPU initialization fails inside the restricted execution
sandbox; the authorized local Blender process runs outside it, without network
access.

The complete native recipe is checked in as
[native-edit-recipes.json](../scripts/native-edit-recipes.json): 20 cases with
4,098 native capture states, explicit per-case replay adaptations, and packing
configuration. `bake-native-edits.py` generates requests from that recipe,
captures geometry, packs responses/fixtures, and prepares matched native
baselines where required. A full rebuild takes several minutes and writes
local assets only:

```sh
python3 scripts/bake-native-edits.py --plan-only
python3 scripts/bake-native-edits.py --cache /tmp/treestruct-native-rebuild
python3 scripts/build-paper-manifest.py
```

`--case <case-id>` limits the run; `--jobs` controls parallel local cases;
`--blender` and `--numpy-python` select other compatible executables.
`--skip-capture` repacks an existing complete cache. Capture and packing logs
are written next to generated requests in the cache directory. The manifest
assembler requires all 20 native headers and references their binary files and
any matching native baseline.

For an isolated single-case reproduction that leaves the website assets alone:

```sh
python3 scripts/bake-native-edits.py \
  --case paper-gpt-5-6-sol-spiny-lobster \
  --cache /tmp/treestruct-native-isolated-cache \
  --artifact-root /tmp/treestruct-native-isolated-site
```

The alternate artifact root receives the website-shaped `public/explorer/data`
and `tests/fixtures/native` outputs. It is a native asset/fixture output tree,
not a complete standalone copy of the website.
The isolated SpinyLobster reproduction completed in 21.9 seconds and reproduced
the production 4,534,464-byte response binary byte-for-byte. That timing is a
local measurement, not a runtime guarantee for every case or machine.

The underlying producers are:

| Stage | Command from the website checkout | Inputs/output |
| --- | --- | --- |
| Original paper images | `python scripts/prepare-paper-renders.py` | Copies 120 PNGs unchanged; `--check` verifies them. |
| Five saved states per case | `python scripts/bake-edit-cases.py --config scripts/paper-edit-cases.json --resume` | Rebuilds GLBs and matching saved observations under `public/explorer/data/<case>/edits/`. |
| Native captures | Blender with `--python scripts/capture-native-edit-response.py -- --request <request.json>` | Evaluated geometry and anchors in the request's output directory. |
| Fixed-topology response packing | `python scripts/pack-native-edit-response.py --capture <cache> --output <native-dir> --fixtures <fixture-dir>` | Accepts optional `--interactions`, `--ratios`, and `--procedural` configuration files. |
| Bed scalar contribution | Add `--bed-pillow-height` to the response-packing command. | Preserves the source's rational/piecewise pillow height formula. |
| HollowTree packing | `python scripts/pack-native-hollow-tree.py --capture <cache> --source <source.py> --output <native-dir> --fixtures <fixture-dir>` | Requires all 121 branch states and trunk/held-out captures. |
| Chameleon limb weights/table | Blender with `--python scripts/bake-chameleon-limbs.py -- --native-cache <cache> --output <directory>` | Emits `procedural.json`, `procedural.bin`, and validation fixtures. |
| Procedural base colors | `python scripts/export-browser-materials.py` | Stages and verifies GLBs; `--apply` installs the verified local exports. |
| Matched native baseline | `python scripts/write-native-baseline.py --capture <default-capture> --archived <archived-default> --native <native-dir> --reason <reason>` | Verifies the exact captured realization and clears unrelated archived checks. |

For example, the Chameleon helper can be reproduced locally with:

```sh
../tools/Blender-5.0.app/Contents/MacOS/Blender \
  --background --factory-startup --threads 1 --python-exit-code 1 \
  --python scripts/bake-chameleon-limbs.py -- \
  --native-cache /tmp/treestruct-native-response/paper-gemini-3-5-flash-chameleon \
  --output /tmp/treestruct-native-chameleon-procedural
```

The development captures under `/tmp/treestruct-native-response` and the
temporary single/dense/interaction/ratio request directories are working
caches. They are no longer required as the sole record of the recipe: the
checked-in configuration and runner regenerate their inputs. Use a fresh cache
after changing the source or replay instrumentation; `--skip-capture` assumes
that the selected cache is complete and compatible.

After final assets and manifest assembly, local checks are:

```sh
python scripts/prepare-paper-renders.py --check
npm run lint
npm run check:explorer
npm run build:portfolio
```

`build:portfolio` creates a local static build for `/treeStruct3D`. These
commands do not commit, push, or deploy the website.
