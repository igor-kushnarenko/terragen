import {mulberry32} from './noise';
import {createIronHabitat} from './iron-habitat';
import {MAX_WORLD_OBJECTS,type WorldObject} from './world';
import type {EditorModel} from './state';
import {createEcology,FootprintIndex,objectFootprint,type EcologyTerrain} from './ecology';

/** Sparse habitat-driven cover; no trees, no ocean plants, stable geological objects. */
export function scatterIron(model:EditorModel,terrain:EcologyTerrain,mode:'all'|'plants'='all'){
    const retained=model.world.objects.filter(o=>o.source!=='scatter'||mode==='plants'&&!o.asset.startsWith('iron-')||mode==='plants'&&['iron-stack','iron-cliff','iron-boulder','iron-debris','arch','cave'].includes(o.asset));
    const objects=[...retained],counts={trees:0,rocks:0,bushes:0},habitat=createIronHabitat(model,terrain),ecology=createEcology(model,terrain),occupied=new FootprintIndex();
    retained.forEach(o=>occupied.insert(objectFootprint(o,terrain)));const ids=new Set([...retained,...model.world.groups,...model.world.biomes,...model.world.routes,...model.world.waterBodies,...model.world.landmarks,...model.world.viewpoints].map(o=>o.id));
    const random=mulberry32(model.seeds.scatter^0x19e58),cells=Array.from(model.heights.keys()).filter(k=>model.heights[k]>model.state.water+1.5&&k%model.n>0&&k%model.n<model.N&&k>=model.n&&k<model.N*model.n),fraction=cells.length/model.heights.length;
    function place(asset:string,x:number,z:number,scale:number,rock=false){
        if(objects.length>=MAX_WORLD_OBJECTS)return false;
        const e=habitat.sample(x,z);if(!e.dry)return false;
        const item:WorldObject={id:'',asset,source:'scatter',position:[x,e.h,z],rotation:[rock?(random()-.5)*.25:0,rock?random()*Math.PI*2:(e.t.windDirection*Math.PI/180-Math.PI/2)+(random()-.5)*.65,0],scale:[scale,scale,scale],groundOffset:rock?-.15*scale:0,followTerrain:true,tint:.85+random()*.2};
        const fp=objectFootprint(item,terrain);if(occupied.overlaps(fp)||ecology.pathClearance(x,z)<fp.radius+.5)return false;
        let id='iron-'+asset+'-'+objects.length;while(ids.has(id))id+='x';ids.add(id);item.id=id;objects.push(item);occupied.insert(fp);return true;
    }
    const targetRocks=mode==='plants'?0:Math.round(1000*fraction),targetPlants=Math.round((2600+4000*habitat.sample(0,0).t.vegetationDensity)*fraction);
    for(let attempt=0;attempt<(targetRocks+targetPlants)*12&&cells.length;attempt++){
        const k=cells[Math.floor(random()*cells.length)],x=((k%model.n+random()-.5)/model.N-.5)*1024,z=((Math.floor(k/model.n)+random()-.5)/model.N-.5)*1024,e=habitat.sample(x,z);
        if(Math.abs(x)>510||Math.abs(z)>510||!e.dry)continue;
        if(counts.rocks<targetRocks&&e.ny>.4&&random()<.4+e.erosion){
            const asset=e.ny<.8?'iron-cliff':e.elevation<12?'iron-debris':'iron-boulder';
            if(place(asset,x,z,.45+random()*(asset==='iron-cliff'?1.4:.9),true))counts.rocks++;
        }else if(counts.bushes<targetPlants&&e.ny>.86&&random()<e.vegetation*2.4){
            const choice=random(),asset=choice<.17&&e.basin>.3?'iron-sedge':choice<.40?'iron-heather':choice<.62?'iron-crowberry':choice<.8?'iron-grass':choice<.92?'iron-cushion':'iron-thrift';
            if(place(asset,x,z,.7+random()*.8))counts.bushes++;
        }
    }
    // Detached stacks stand on submerged rock shelves; use fixed placement so editor's
    // generic underwater-scatter filtering cannot hide their visible upper portions.
    if(mode==='all'){
        const n=model.n;
        for(let k=0,stacks=0;k<model.heights.length&&stacks<24;k+=3){
            const h=model.heights[k];if(h>model.state.water-2||h<model.state.water-22||random()>.1)continue;
            const x=(k%n/model.N-.5)*1024,z=(Math.floor(k/n)/model.N-.5)*1024;
            if(Math.abs(x)>480||Math.abs(z)>480)continue;
            if(![[-18,0],[18,0],[0,18],[0,-18]].some(([dx,dz])=>terrain.getH(x+dx,z+dz)>model.state.water+15))continue;
            const scale=1.1+random()*1.1;
            const item:WorldObject={id:'',asset:'iron-stack',source:'scatter',position:[x,h-1,z],rotation:[0,random()*6.28,0],scale:[scale,scale*1.4,scale],groundOffset:-1,followTerrain:false,tint:.95};
            const fp=objectFootprint(item,terrain);if(occupied.overlaps(fp)||objects.length>=MAX_WORLD_OBJECTS)continue;
            let id='iron-sea-stack-'+stacks;while(ids.has(id))id+='x';ids.add(id);item.id=id;objects.push(item);occupied.insert(fp);stacks++;counts.rocks++;
        }
    }
    return {objects,counts};
}
