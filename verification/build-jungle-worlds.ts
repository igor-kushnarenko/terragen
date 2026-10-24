import {mkdir,writeFile} from 'node:fs/promises';
import {jungleWorld} from './jungle-world';
import {jungleDefaults,JUNGLE_VARIANTS,type JungleVariant} from '../src/jungle-settings';
const reports=[];
await mkdir('verification/jungle',{recursive:true});
for(const variant of Object.keys(JUNGLE_VARIANTS) as JungleVariant[]){
    const world=jungleWorld(jungleDefaults(variant));reports.push(world.stats);await writeFile(`examples/jungle-${variant}.json`,world.project());
}
const full=jungleWorld(jungleDefaults(),424242,1,128);reports.push(full.stats);
await writeFile('verification/jungle/metrics.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
