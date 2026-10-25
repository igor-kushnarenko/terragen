import {mkdir,writeFile} from 'node:fs/promises';
import {taigaWorld} from './taiga-world';
import {taigaDefaults,TAIGA_VARIANTS,type TaigaVariant} from '../src/taiga-settings';
await mkdir('verification/taiga',{recursive:true});
const metrics=[];
for(const variant of Object.keys(TAIGA_VARIANTS) as TaigaVariant[]){const f=taigaWorld(taigaDefaults(variant),424242,.25,256);await writeFile('examples/taiga-'+variant+'.json',f.project());metrics.push(f.stats);}
const full=taigaWorld(taigaDefaults(),2026,1,128);metrics.push(full.stats);
await writeFile('verification/taiga/metrics.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));
