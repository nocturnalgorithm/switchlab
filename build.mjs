import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.tsx'], bundle: true, minify: true, sourcemap: false, outfile: 'dist/app.js', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile('dist/index.html', '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="theme-color" content="#111b2d"><meta name="description" content="Explore capacitor bank switching, inrush current, trapped charge and breaker recovery voltage in an interactive power systems laboratory."><title>SwitchLab — Power System Studio</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>');
