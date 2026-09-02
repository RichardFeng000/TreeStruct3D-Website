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

Pushes to `main` build and deploy this repository as a GitHub Pages project
site. The custom domain configured for the account's portfolio site is inherited
by project sites, so this repository is served under
`www.ruiding-feng.com/TreeStruct3D-Website/` without replacing the root pages.

## License

Website source code is released under the Apache License 2.0. Paper figures
remain part of the TreeStruct3D research project.
