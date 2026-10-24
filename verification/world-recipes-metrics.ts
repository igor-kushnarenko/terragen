import {createModel} from '../src/state';
import {WORLD_PRESET_IDS} from '../src/world';
import {worldSettings,defaultWorldRequest} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
const rows=[];
for(const seed of [1337,17,9001])for(const preset of WORLD_PRESET_IDS){
    const s=worldSettings(createModel().state,{...defaultWorldRequest(),preset,seed,N:256}),start=performance.now();
    const h=computeTerrainJob({kind:'terrain',settings:s,seed,preset,worldErosion:1});
    let min=Infinity,max=-Infinity,dry=0;for(const y of h){min=Math.min(min,y);max=Math.max(max,y);if(y>s.water+1)dry++;}
    rows.push({preset,seed,ms:Math.round(performance.now()-start),dryPercent:Math.round(dry/h.length*100),min:Math.round(min),max:Math.round(max)});
}
console.log(JSON.stringify(rows,null,2));
