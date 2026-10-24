import { createEcology, FootprintIndex, objectFootprint, type EcologyTerrain } from './ecology';
import { mulberry32 } from './noise';
import { SIZE, type EditorModel } from './state';
import { MAX_WORLD_OBJECTS, type WorldObject } from './world';
import { BIOME_TREES } from './presets';
import {naturalScale} from './object-appearance';
import {worldPreset} from './world-recipes';
import {scatterJungle} from './jungle-scatter';
export function scatterObjects(model: EditorModel, terrain: EcologyTerrain) {
    if(model.world.preset==='jungle'&&model.world.recipe?.jungle)return scatterJungle(model,terrain);
    const manual = model.world.objects.filter(item=>item.source!=='scatter'), capacity = MAX_WORLD_OBJECTS-manual.length;
    const objects: WorldObject[] = [], ecology = createEcology(model,terrain), occupied = new FootprintIndex();
    const counts = { trees:0,rocks:0,bushes:0 };
    if(capacity<=0) return { objects:manual,counts };
    manual.forEach(item=>occupied.insert(objectFootprint(item,terrain)));
    const ids = new Set([...manual,...model.world.groups,...model.world.viewpoints,...model.world.biomes,...model.world.routes,...model.world.waterBodies,...model.world.landmarks].map(item=>item.id));
    function id(base:string){ let result=base,index=1; while(ids.has(result))result=base+'-g'+index++;ids.add(result);return result; }
    const random=mulberry32(model.seeds.scatter), settings=model.state,recipe=worldPreset(model.world.preset);
    const landCells=recipe?Array.from(model.heights.keys()).filter(k=>model.heights[k]>settings.water+1&&k%model.n>0&&k%model.n<model.N&&k>=model.n&&k<model.n*model.N):[];
    function candidate():[number,number]{
        if(!recipe||!landCells.length)return [(random()-.5)*SIZE*.99,(random()-.5)*SIZE*.99];
        const k=landCells[Math.floor(random()*landCells.length)];
        return [((k%model.n+random()-.5)/model.N-.5)*SIZE,((Math.floor(k/model.n)+random()-.5)/model.N-.5)*SIZE];
    }
    function place(asset:string,x:number,z:number,s:number,tree:boolean) {
        const h=terrain.getH(x,z), item:WorldObject={id:'',asset,source:'scatter',position:[x,h,z],rotation:tree?[0,random()*Math.PI*2,0]:[random()*0.4,random()*Math.PI*2,random()*0.4],scale:naturalScale(asset,s,x,z),groundOffset:tree?-0.1*s:-0.2*s,followTerrain:true,tint:(0.85+random()*0.23)*(model.world.preset==='iron-islands'&&(asset==='rock'||asset==='boulder')?.65:1)};
        const footprint=objectFootprint(item,terrain);
        if(ecology.pathClearance(footprint.x,footprint.z)<footprint.radius+0.8 || occupied.overlaps(footprint))return false;
        item.id=id(`scatter-${tree?'pine':asset==='bush'?'bush':'rock'}-${objects.length}`); objects.push(item); occupied.insert(footprint);return true;
    }
    const areaFactor=recipe?landCells.length/model.heights.length:1;
    const targetTrees=Math.round(settings.treeDensity*9000*areaFactor),targetRocks=Math.round(settings.rockDensity*2500*areaFactor);
    for(let attempt=0;counts.trees<targetTrees&&objects.length<capacity&&attempt<targetTrees*18;attempt++) {
        const [x,z]=candidate(),e=ecology.sample(x,z);
        if(e.kind==='jungle'||!e.dry || e.ny<0.86 || e.forest<0.035 || random()>e.forest || e.h>settings.snowLine-18)continue;
        const weights=[0.2+(1-e.moisture)*0.8,0.25+Math.max(0,e.h/settings.snowLine)*0.65,0.1+e.moisture*0.8,0.15+e.moisture*0.35];
        if(model.world.preset || model.world.biomes.length)weights.forEach((weight,i)=>weights[i]=weight*BIOME_TREES[e.kind][i]);
        let selected=random()*weights.reduce((a,b)=>a+b,0),species=0;
        while(species<3 && (selected-=weights[species])>0)species++;
        const asset=recipe?recipe.trees[Math.floor(random()*recipe.trees.length)]:['pine','spruce','birch','oak'][species];
        if(place(asset,x,z,0.7+random()*0.5,true))counts.trees++;
    }
    for(let attempt=0;counts.rocks<targetRocks&&objects.length<capacity&&attempt<targetRocks*14;attempt++) {
        const [x,z]=candidate(),e=ecology.sample(x,z);
        const probability=(1-e.ny)*2.6+(e.kind==='mountains'?0.45:e.kind==='coast'?0.25:0.06);
        if(!e.dry||e.ny<0.45||random()>probability)continue;
        if(place(random()<0.22?'boulder':'rock',x,z,0.45+Math.pow(random(),2)*2.2,false))counts.rocks++;
    }
    const targetBushes=Math.round(settings.treeDensity*600*areaFactor);
    for(let attempt=0;counts.bushes<targetBushes&&objects.length<capacity&&attempt<targetBushes*10;attempt++) {
        const [x,z]=candidate(),e=ecology.sample(x,z);
        if(e.kind==='jungle'||!e.dry||e.ny<0.88||e.h>settings.snowLine-20||random()>e.edge*e.moisture)continue;
        const asset=recipe?recipe.shrubs[Math.floor(random()*recipe.shrubs.length)]:'bush';
        if(place(asset,x,z,0.6+random()*0.65,false))counts.bushes++;
    }
    if(model.world.biomes.some(b=>b.kind==='jungle')){const jungle=scatterJungle(model,terrain,[...manual,...objects]);return {objects:jungle.objects,counts:{trees:counts.trees+jungle.counts.trees,rocks:counts.rocks+jungle.counts.rocks,bushes:counts.bushes+jungle.counts.bushes}};}
    return { objects:[...manual,...objects],counts };
}
