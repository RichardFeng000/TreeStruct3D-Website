# TreeStruct3D Website

This repository contains the official project website for **TreeStruct3D:
Enabling Structural Editability in Agentic Procedural 3D Modeling**.

- Live site: <https://www.ruiding-feng.com/TreeStruct3D-Website/>
- Research code: <https://github.com/RichardFeng000/TreeStruct3D>

The site introduces the structure-aware generation pipeline, documents the
benchmark input boundary, links to the open-source implementation, and presents
the controlled-editing comparison and qualitative appendix gallery.

## Development

The project requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Build the deployable application:

```bash
npm run build
```

Build the static snapshot used at the portfolio subpath:

```bash
npm run build:pages
```

## Deployment

Pushes to `main` build and deploy the standalone GitHub Pages mirror at
`richardfeng000.github.io/TreeStruct3D-Website/`. The custom-domain release is
stored as a reviewed static snapshot in the `Richard_website` portfolio
repository, so it is served at `www.ruiding-feng.com/TreeStruct3D-Website/`
without changing the root portfolio page.

To refresh the portfolio snapshot, run `npm run build:pages` and replace
`Richard_website/public/TreeStruct3D-Website/` with `dist/client/`.

## License

Website source code is released under the Apache License 2.0. Paper figures
remain part of the TreeStruct3D research project.
