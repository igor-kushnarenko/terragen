import { build } from 'vite';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import ts from 'typescript';

// IIFE + embedded CSS: no imports, fetches or external assets on file://.
const result = await build({
  configFile: false,
  build: {
    target: 'es2022', write: false, sourcemap: false,
    lib: { entry: 'src/main.ts', name: 'TerrainEditor', formats: ['iife'] },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
const script = outputs.filter(output => output.type === 'chunk').map(output => output.code).join('\n');
const css = outputs.filter(output => output.type === 'asset' && output.fileName.endsWith('.css')).map(output => String(output.source)).join('\n');
if (!script || !css) throw new Error('Offline bundle is incomplete');
let html = await readFile('index.html', 'utf8');
html = html.replace('</head>', () => `<style>${css}</style>\n</head>`);
html = html.replace(/<script type="module" src="\/src\/main.ts"><\/script>/, () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
if (scriptTags.length !== 1 || /\b(?:src|type)\s*=/.test(scriptTags[0][1])) {
  throw new Error('Offline HTML must contain one classic inline script');
}
if (/<(?:link|img|source)\b[^>]*(?:href|src)=["'](?!data:)/i.test(html) || /url\(\s*["']?(?:https?:|\/)/i.test(css)) {
  throw new Error('Offline HTML references an external asset');
}
const bundle = ts.createSourceFile('standalone.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function checkImports(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    throw new Error('Offline script still contains a module import');
  }
  ts.forEachChild(node, checkImports);
}
checkImports(bundle);
await writeFile('dist/terrain_editor_standalone.html', html);
await writeFile('terrain_editor_standalone.html', html);
await copyFile('node_modules/three/LICENSE', 'dist/THREE-LICENSE.txt');
await copyFile('node_modules/@dimforge/rapier3d-compat/LICENSE', 'dist/RAPIER-LICENSE.txt');
console.log('Offline HTML: dist/terrain_editor_standalone.html (also copied to project root)');
