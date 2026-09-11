import { rename, rm } from 'node:fs/promises';
import path from 'node:path';

const projectPath = (process.env.PAGES_BASE_PATH || '/TreeStruct3D-Website').replace(/^\/+|\/+$/g, '');
const outputRoot = path.join(process.cwd(), 'dist', 'client');
const nestedAssets = path.join(outputRoot, projectPath, '_next');
const normalizedAssets = path.join(outputRoot, '_next');

await rename(nestedAssets, normalizedAssets);
await rm(path.join(outputRoot, projectPath), { recursive: true, force: true });
