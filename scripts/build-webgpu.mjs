import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// The experiment stays separate: the editor does not download or initialize WebGPU/TSL.
const result = await build({ configFile: false, build: {
    target: 'es2022', write: false, sourcemap: false,
    lib: { entry: 'src/webgpu/main.ts', name: 'TerrainWebGPULab', formats: ['iife'] },
} });
const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
const script = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n');
if (!script || !css) throw new Error('WebGPU lab bundle is incomplete');
const source = ts.createSourceFile('webgpu.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function checkImports(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error('WebGPU lab still has external imports');
    ts.forEachChild(node, checkImports);
}
checkImports(source);
const html = (await readFile('webgpu_lab.html', 'utf8'))
    .replace('</head>', () => `<style>${css}</style></head>`)
    .replace('<script type="module" src="/src/webgpu/main.ts"></script>', () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
if (/<(?:link|img|source|script)\b[^>]*(?:href|src)=["'](?!data:)/i.test(html)) throw new Error('WebGPU lab references an external resource');
const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
if (scripts.length !== 1 || /\b(?:src|type)\s*=/.test(scripts[0][1])) throw new Error('Offline lab must contain one classic inline script');
if (/url\(\s*["']?(?:https?:|\/)/i.test(css)) throw new Error('Offline lab CSS references an external resource');
await writeFile('dist/webgpu_lab_standalone.html', html);
await writeFile('webgpu_lab_standalone.html', html);
console.log('Offline WebGPU lab: webgpu_lab_standalone.html (root + dist)');
