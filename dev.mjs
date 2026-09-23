// Development server: rebuilds the bundle on change and serves it at http://localhost:5173
import { fileURLToPath as __f } from "node:url"; import { dirname as __d } from "node:path"; process.chdir(__d(__f(import.meta.url)));
import * as esbuild from 'esbuild';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { esbuildOptions, htmlTemplate } from './build.mjs';

const PORT = Number(process.env.PORT || 5173);
const ctx = await esbuild.context({ ...esbuildOptions(true), absWorkingDir: process.cwd(), outfile: '.cache/dev/bundle.js', write: true });
await ctx.watch();
console.log('esbuild watching');

const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.map': 'application/json' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(htmlTemplate('<script src="/bundle.js"></script>'));
    return;
  }
  let file = url === '/bundle.js' || url === '/bundle.js.map' ? join('.cache/dev', url) : join('.', normalize(url));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
