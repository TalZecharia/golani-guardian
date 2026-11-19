import * as esbuild from 'esbuild';
import fs from 'fs';

const r = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'], write: false, legalComments: 'none'
});
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('template.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl.replace('/*__JS__*/', () => js));
console.log('built dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB');
fs.cpSync('assets', 'dist/assets', { recursive: true });
