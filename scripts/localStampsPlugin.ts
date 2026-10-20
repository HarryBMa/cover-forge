import { createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

const TYPES: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

/**
 * Serves public/local-stamps/ in `vite` and `vite preview`, decoding the path first: Vite's own public-file handling
 * misses names with spaces (common in logo packs) and files added after the server started. Builds leave them out.
 */
export function localStamps(): Plugin {
  const root = resolve('public/local-stamps');
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    const at = url.indexOf('/local-stamps/');
    if (at < 0) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(url.slice(at + '/local-stamps/'.length));
    } catch {
      return next();
    }
    const file = resolve(root, rel);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
  let outDir = 'dist';
  return {
    name: 'coverforge-local-stamps',
    configResolved: (config) => void (outDir = resolve(config.root, config.build.outDir)),
    // Vite copies public/ into the build: take the local stamps back out, so they can't be deployed by accident.
    closeBundle: () => rmSync(resolve(outDir, 'local-stamps'), { recursive: true, force: true }),
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}
