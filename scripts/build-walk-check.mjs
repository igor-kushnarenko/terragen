import { build } from 'vite';
import { readFile,writeFile } from 'node:fs/promises';
const result=await build({configFile:false,build:{target:'es2022',write:false,sourcemap:false,lib:{entry:'verification/walk-check.ts',name:'WalkCheck',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(bundle=>bundle.output);
const script=output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n'),css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n');
let html=(await readFile('index.html','utf8')).replace('<title>Редактор ландшафта — Open World Terrain Editor</title>','<title>Проверка прогулочного сценария · задача 32</title>')
    .replace('</head>',()=>`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.ts"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await writeFile('dist/walk-check.html',html);
console.log('Scenario verification: dist/walk-check.html (isolated IndexedDB)');
