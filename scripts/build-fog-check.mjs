import {build} from 'vite';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const result=await build({configFile:false,build:{target:'es2022',write:false,lib:{entry:'verification/fog-check.ts',name:'FogCheck',formats:['iife']}}});
const outputs=(Array.isArray(result)?result:[result]).flatMap(x=>x.output),script=outputs.filter(x=>x.type==='chunk').map(x=>x.code).join('\n'),css=outputs.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
const html=(await readFile('index.html','utf8')).replace('</head>',()=>`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.ts"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir('dist/examples',{recursive:true});await writeFile('dist/fog-check.html',html);await copyFile('examples/storm-coast.json','dist/examples/storm-coast.json');
if(process.argv.includes('--baseline')){await mkdir('verification/fog-v0171',{recursive:true});await writeFile('verification/fog-v0171/before.html',html);await writeFile('dist/fog-before.html',html);}
else{try{await copyFile('verification/fog-v0171/before.html','dist/fog-before.html');}catch(error){if(error.code!=='ENOENT')throw error;}}
console.log('Fog regression: dist/fog-check.html (isolated IndexedDB)');
