// Production build: bundles everything (code, map data, styles) into ONE self-contained HTML file
// that works offline from file:// — dist/FAU-Campus.html
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function esbuildOptions(dev = false) {
  return {
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: !dev,
    sourcemap: dev ? 'linked' : false,
    loader: { '.json': 'json' },
    define: { __DEV__: dev ? 'true' : 'false' },
    legalComments: 'none',
    logLevel: 'warning',
  };
}

export function htmlTemplate(scriptTag) {
  const css = readFileSync('src/ui/style.css', 'utf8');
  const icon = readFileSync('desktop/icon.png').toString('base64');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#1b2a3a">
<title>FAU Campus 3D · Südgelände</title>
<link rel="icon" type="image/png" href="data:image/png;base64,${icon}">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
${scriptTag}
</body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await esbuild.build({ ...esbuildOptions(false), write: false });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
  mkdirSync('dist', { recursive: true });
  const html = htmlTemplate(`<script>${js}</script>`);
  writeFileSync('dist/FAU-Campus.html', html);
  console.log(`dist/FAU-Campus.html  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
}
