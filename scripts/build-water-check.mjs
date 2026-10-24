import {build} from 'vite';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const storm=process.argv[2]==='storm',entry=storm?'verification/storm-check.ts':'verification/water-check.ts',page=storm?'storm-check.html':'water-check.html',example=storm?'storm-coast.json':'living-water.json';
const result=await build({configFile:false,build:{target:'es2022',write:false,sourcemap:false,lib:{entry,name:'WaterCheck',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(bundle=>bundle.output),script=output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n'),css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
const html=(await readFile('index.html','utf8')).replace('</head>',()=>`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.ts"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await writeFile('dist/'+page,html);await mkdir('dist/examples',{recursive:true});await copyFile('examples/'+example,'dist/examples/'+example);console.log('Verification: dist/'+page+' (isolated IndexedDB)');
if(storm)await copyFile('examples/impact-forest.json','dist/examples/impact-forest.json');
