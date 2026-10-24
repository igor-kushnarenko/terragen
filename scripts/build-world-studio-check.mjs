import {build} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const result=await build({configFile:false,build:{target:'es2022',write:false,lib:{entry:'verification/world-studio-check.ts',name:'WorldStudioCheck',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(x=>x.output),script=output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n'),css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
const html=(await readFile('index.html','utf8')).replace('</head>',()=>`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.ts"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir('dist',{recursive:true});await writeFile('dist/world-studio-check.html',html);console.log('World studio: dist/world-studio-check.html (isolated IndexedDB)');
