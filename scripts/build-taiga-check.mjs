import {readFile,writeFile} from 'node:fs/promises';
const template=await readFile('index.html','utf8');
await writeFile('verification/taiga.html',template.replace('/src/main.ts','/verification/taiga-check.ts'));
console.log('Taiga browser verification: /verification/taiga.html (isolated IndexedDB).');
