# TreeStruct3D Website

This repository contains the official project website for **TreeStruct3D:
Enabling Structural Editability in Agentic Procedural 3D Modeling**.

- Live site: <https://www.ruiding-feng.com/treeStruct3D/>
- Research code: <https://github.com/RichardFeng000/TreeStruct3D>

The website opens directly into an interactive inspector adapted from the
project's `visual_validation/frontend/model_playground.html`. Its three panels
show model information, a selectable structure graph, and the actual GLB model.
Select a part in either the tree or the model to highlight it in both views.
The explorer includes orbit/pan/zoom, model switching, wireframe, part isolation,
shared-anchor inspection, five graph views, and transparent graph PNG export.

The white background, light-gray panels, and blue accents follow the palette of
[3DCodeBench](https://www.3dcodebench.com/). The layout and inspection behavior
come from the local TreeStruct3D toolkit.

Four curated examples are included: Monitor, Floor lamp, Chameleon, and a
Stage 1 Fish baseline. These are saved model and runtime snapshots, not aggregate
benchmark results. Browser controls inspect those snapshots; they do not rerun
Blender or regenerate geometry. Native parameter editing remains available in
the [local toolkit](https://github.com/RichardFeng000/TreeStruct3D/tree/main/visual_validation).
See [the snapshot documentation](docs/explorer-snapshots.md) for provenance and
the data format.

## Development

The project requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Check the application and curated examples:

```bash
npm run lint
npm run check:explorer
```

The explorer checks validate mesh identities, file hashes, graph references,
selection/material restoration, and strict shared-anchor rendering. They run
against the actual saved examples and renderer helpers without a browser.

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
