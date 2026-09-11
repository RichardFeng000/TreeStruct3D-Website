import type { NextConfig } from 'next';

const isGitHubPagesBuild = process.env.GITHUB_PAGES === 'true';
const pagesBasePath = process.env.PAGES_BASE_PATH || '/TreeStruct3D-Website';

const nextConfig: NextConfig = isGitHubPagesBuild
  ? {
      output: 'export',
      assetPrefix: pagesBasePath,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
