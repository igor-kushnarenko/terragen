import {createJungleHabitat} from './jungle-habitat';
import type {EditorModel} from './state';
import {SIZE} from './state';
import {sampleHeight} from './trail-math';
import {clamp} from './noise';
export const JUNGLE_MAP_SIZE=64;
export function jungleSurfaceMap(model:EditorModel) {
    const data=new Uint8Array(JUNGLE_MAP_SIZE**2*4);
    if(!(model.world.preset==='jungle'&&model.world.recipe?.jungle)&&!model.world.biomes.some(b=>b.kind==='jungle'))return data;
    const getH=(x:number,z:number)=>sampleHeight(model.heights,model.N,x,z),habitat=createJungleHabitat(model,{getH,getNormalY(x,z){return 1/Math.hypot(1,(getH(x+2,z)-getH(x-2,z))/4,(getH(x,z+2)-getH(x,z-2))/4);}});
    for(let z=0;z<JUNGLE_MAP_SIZE;z++)for(let x=0;x<JUNGLE_MAP_SIZE;x++){
        const e=habitat.sample((x+.5)/JUNGLE_MAP_SIZE*SIZE-SIZE/2,(z+.5)/JUNGLE_MAP_SIZE*SIZE-SIZE/2),k=(z*JUNGLE_MAP_SIZE+x)*4;
        data[k]=Math.round(e.weight*255);data[k+1]=Math.round(e.moisture*255);data[k+2]=Math.round(clamp(e.shore*.8+e.basin*.12,0,1)*255);data[k+3]=Math.round(e.clearing*255);
    }
    return data;
}
