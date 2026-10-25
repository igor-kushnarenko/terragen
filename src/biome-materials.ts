import { smoothstep } from './noise';
import { HALF, SIZE } from './state';
import type { WorldData } from './world';
export const BIOME_MAP_SIZE=128;
export function biomeMaterialMap(world:WorldData){
    const side=BIOME_MAP_SIZE,data=new Uint8Array(side*side*4),kinds=['forest','coast','mountains','valley'];
    for(let j=0;j<side;j++)for(let i=0;i<side;i++){
        const x=-HALF+(i+0.5)/side*SIZE,z=-HALF+(j+0.5)/side*SIZE,weights=[0,0,0,0];
        if(world.preset&&kinds.includes(world.preset))weights[kinds.indexOf(world.preset)]=1;
        for(const biome of world.biomes){const weight=1-smoothstep(biome.radius*0.65,biome.radius,Math.hypot(x-biome.center[0],z-biome.center[1]));for(let c=0;c<4;c++)weights[c]=weights[c]*(1-weight)+(kinds[c]===(biome.kind==='jungle'||biome.kind==='taiga'?'forest':biome.kind)?weight:0);}
        for(let c=0;c<4;c++)data[(j*side+i)*4+c]=weights[c]*255;
    }return data;
}
