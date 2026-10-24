import {build} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const template=await readFile('index.html','utf8');
await writeFile('verification/jungle.html',template.replace('/src/main.ts','/verification/jungle-check.ts'));
const result=await build({configFile:false,build:{target:'es2022',write:false,lib:{entry:'verification/jungle-check.ts',name:'JungleCheck',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(x=>x.output),script=output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n'),css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
const html=template.replace('</head>',()=>`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.ts"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir('dist',{recursive:true});await writeFile('dist/jungle-check.html',html);console.log('Jungle verification: /verification/jungle.html (development) or dist/jungle-check.html (offline; isolated IndexedDB).');
