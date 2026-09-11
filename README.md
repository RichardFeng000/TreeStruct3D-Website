# TreeStruct3D Website

This repository contains the official project website for **TreeStruct3D:
Enabling Structural Editability in Agentic Procedural 3D Modeling**.

- Live site: <https://www.ruiding-feng.com/treeStruct3D/>
- Research code: <https://github.com/RichardFeng000/TreeStruct3D>

The website first introduces the research problem, the text-to-program pipeline,
geometry-dependent anchors, and controlled editing examples using the paper's
original figures. Its reading order follows the research-page presentation of
3DCodeBench. See [figure sources](docs/paper-introduction.md).

The interactive inspector appears directly after the introduction. It is
adapted from the project's `visual_validation/frontend/model_playground.html`
and uses its three-column desktop layout: model controls, structure graph,
and the actual GLB model. The default is 3D Hierarchy; anchors on the model
appear only while the corresponding part is highlighted. View tabs, search, display filters, and relation details are directly
available; smaller screens stack the panels.
Select a part in either the tree or the model to highlight it in both views.
The explorer includes orbit/pan/zoom, model switching, wireframe, part isolation,
shared-anchor inspection, five graph views, and transparent graph PNG export.

The white background, light-gray panels, and blue accents follow the palette of
[3DCodeBench](https://www.3dcodebench.com/). The layout and inspection behavior
come from the local TreeStruct3D toolkit.

The demo fixes the paper's 20 cases into four model collections, with five cases
per collection: four appendix examples and one Figure 1 comparison example.
Every part is shown in an expanded list with its own slider, numeric input,
and reset button. Drag its scale from 0.4× to 1.6× in 0.01 increments, or select
it directly in the model or structure tree.
Edits to different native parameters remain combined until reset. The browser
uses Blender geometry response data, native parameter dependencies, and small
source-specific geometry rules. Shared mesh instances follow the same original
`PART_PARAMS` control. Nonlinear connections, topology changes, and nearest-vertex
attachment choices are retained rather than approximated by scaling an entire
mesh around one point. Changed previews do not reuse saved pass/fail results.
Reset restores the matching baseline and its available checks. The model assets
also include baked procedural base colors. See the measured accuracy and
rendering limits in [native fidelity](docs/native-fidelity.md).

The Figure 1 cases also provide a **Paper comparison** view with its own five
archived states, switching both methods' original renders together. This
selection is independent of continuous geometry edits. These are selected
qualitative examples, not aggregate benchmark results or validation of
arbitrary parameter values.

See [the fixed-demo documentation](docs/paper-demo.md) and the complete
[local source mapping](docs/paper-demo-cases.json). Native editing of arbitrary
parameters remains available in the
[local toolkit](https://github.com/RichardFeng000/TreeStruct3D/tree/main/visual_validation).

## Development

The project requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

For a local review on a stable port:

```bash
npm run dev -- --host localhost --port 5179
```

Open <http://localhost:5179/>. Review the introduction and interactive behavior
locally before publishing. Do not push or deploy a UI change until the owner
explicitly approves that release; pushing `main` triggers GitHub Pages.

Check the application and curated examples:

```bash
npm run lint
npm run check:explorer
```

The explorer checks validate mesh identities, file hashes, graph references,
selection/material restoration, and strict shared-anchor rendering. Native
editing checks compare the final rendered vertices to independent Blender
rebuilds, including simultaneous parameter changes. They run against real saved
examples and renderer helpers without a browser.

Build the deployable application:

```bash
npm run build
```

Build the static snapshot used at the portfolio subpath:

```bash
npm run build:portfolio
```

## Deployment

Pushes to `main` build and deploy the standalone GitHub Pages mirror at
`richardfeng000.github.io/TreeStruct3D-Website/`. The custom-domain release is
stored as a reviewed static snapshot in the `Richard_website` portfolio
repository, so it is served at `www.ruiding-feng.com/treeStruct3D/`
without changing the root portfolio page.

To refresh the portfolio snapshot, run `npm run build:portfolio` and replace
`Richard_website/public/treeStruct3D/` with `dist/client/`, then build and deploy
the portfolio. GitHub Pages redirects `/treeStruct3D` to `/treeStruct3D/`.
The portfolio publishes only this snapshot; the legacy
`public/TreeStruct3D-Website/` directory has been removed.

`npm run build:pages` retains the `/TreeStruct3D-Website` asset prefix for the
standalone repository mirror. `npm run build:portfolio` sets
`PAGES_BASE_PATH=/treeStruct3D` for both the export and asset normalization.

## License

Website source code and the adapted TreeStruct3D inspector are released under
the Apache License 2.0. Vendored Three.js r166 modules use the MIT license; see
[third-party notices](public/explorer/THIRD_PARTY_NOTICES.md). Paper figures
remain part of the TreeStruct3D research project.
