import {mulberry32} from './noise';
import {SIZE,type EditorModel} from './state';
import {MAX_WORLD_OBJECTS,type WorldObject} from './world';
import {createEcology,FootprintIndex,objectFootprint,type EcologyTerrain} from './ecology';
import {createJungleHabitat,CanopyIndex,jungleRegion} from './jungle-habitat';
import {getModel} from './model-library';
import {waterSignedDistance} from './water-math';

export function scatterJungle(model:EditorModel,terrain:EcologyTerrain,existing=model.world.objects.filter(o=>o.source!=='scatter'),regionId?:string) {
    const objects=[...existing],initial=objects.length,occupied=new FootprintIndex(),canopy=new CanopyIndex(),habitat=createJungleHabitat(model,terrain),ecology=createEcology(model,terrain);
    const random=mulberry32(model.seeds.scatter^0x47d923),ids=new Set([...objects,...model.world.biomes,...model.world.routes,...model.world.waterBodies,...model.world.groups,...model.world.viewpoints,...model.world.landmarks].map(o=>o.id));
    for(const o of existing){occupied.insert(objectFootprint(o,terrain));canopy.add(o);}
    const cells:{x:number;z:number}[]=[],step=16;
    const selected=regionId?model.world.biomes.find(b=>b.id===regionId):undefined;
    const inRegion=(x:number,z:number)=>!selected||Math.hypot(x-selected.center[0],z-selected.center[1])<selected.radius;
    for(let z=-SIZE/2+step/2;z<SIZE/2;z+=step)for(let x=-SIZE/2+step/2;x<SIZE/2;x+=step){if(inRegion(x,z)&&jungleRegion(model.world,x,z).weight>.05&&terrain.getH(x,z)>model.state.water+.65)cells.push({x,z});}
    const area=cells.length*step*step/(SIZE*SIZE),counts={trees:0,rocks:0,bushes:0,emergents:0,canopy:0,understory:0,logs:0};
    if(!cells.length)return {objects,counts};
    const global=selected?.jungle??model.world.recipe?.jungle??habitat.sample(cells[0].x,cells[0].z).j;
    function candidate(){const cell=cells[Math.floor(random()*cells.length)];return [cell.x+(random()-.5)*step,cell.z+(random()-.5)*step] as const;}
    function place(asset:string,x:number,z:number,sx:number,sy:number,rootRadius:number,tree=false) {
        if(objects.length>=MAX_WORLD_OBJECTS)return false;
        const h=terrain.getH(x,z),template=getModel(asset),angle=random()*Math.PI*2;
        if((tree||template.category==='shrub')&&model.world.waterBodies.some(b=>b.kind!=='ocean'&&waterSignedDistance(b,x,z).signed>-rootRadius-.25))return false;
        const item:WorldObject={id:'',asset,source:'scatter',position:[x,h-.06,z],rotation:[0,angle,0],scale:[sx,sy,sx*(.90+random()*.20)],groundOffset:-.06,followTerrain:true,tint:.85+random()*.24};
        const footprint=tree?{x,z,radius:rootRadius,minY:h-.1,maxY:h+template.bounds.max.y*sy,item}:objectFootprint(item,terrain);
        if(ecology.pathClearance(x,z)<rootRadius+.8||model.world.landmarks.some(p=>Math.hypot(x-p.position[0],z-p.position[1])<p.radius+rootRadius)||occupied.overlaps(footprint,.55))return false;
        let id='jungle-'+(objects.length-initial),suffix=1;while(ids.has(id))id='jungle-'+(objects.length-initial)+'-'+suffix++;ids.add(id);item.id=id;
        objects.push(item);occupied.insert(footprint);if(tree){counts.trees++;canopy.add(item);}return true;
    }
    function pass(target:number,attempts:number,accept:(x:number,z:number,e:ReturnType<typeof habitat.sample>)=>boolean) {
        let placed=0;for(let i=0;i<Math.ceil(target*attempts)&&placed<target&&objects.length<MAX_WORLD_OBJECTS;i++){const [x,z]=candidate();if(!inRegion(x,z))continue;const e=habitat.sample(x,z);if(e.weight<.05||!e.dry||e.ny<.88)continue;if(accept(x,z,e))placed++;}
    }
    pass(Math.round(145*global.emergents*area),25,(x,z,e)=>{
        if(e.clearing>.25||random()>e.density*.65)return false;
        const vines=random()<e.j.vines,scale=.83+random()*.32;
        if(!place(vines?'jungle-emergent-vines':'jungle-emergent',x,z,.92+random()*.24,scale,3.7,true))return false;counts.emergents++;return true;
    });
    pass(Math.round(5200*global.canopy*area),18,(x,z,e)=>{
        if(random()>e.density*(.8+e.moisture*.2))return false;
        const vines=random()<e.j.vines,wide=.85+random()*.35,high=.90+random()*.22,base=e.species===1?'jungle-canopy-b':'jungle-canopy';
        if(!place(base+(vines?'-vines':''),x,z,wide,high,2.05,true))return false;counts.canopy++;return true;
    });
    pass(Math.round(3300*global.understory*area),20,(x,z,e)=>{
        const shade=canopy.sample(x,z).shade;if(random()>e.weight*(.18+(1-shade)*.6+e.shore*.25)*(.45+e.detail*.55))return false;
        const asset=e.species===0&&e.moisture>.65?'jungle-palm':'jungle-sapling';
        if(!place(asset,x,z,.65+random()*.5,.65+random()*.55,.9,true))return false;counts.understory++;return true;
    });
    pass(Math.round(4400*global.understory*area),16,(x,z,e)=>{
        const shade=canopy.sample(x,z).shade,probability=(.12+(1-shade)*.55+e.shore*.28)*e.moisture*(.35+e.detail*.65);
        if(random()>probability)return false;const asset=e.moisture>.82&&random()<.45?'jungle-tree-fern':e.species===0?'jungle-banana':'jungle-broadleaf';
        if(!place(asset,x,z,.65+random()*.55,.7+random()*.5,1.9))return false;counts.bushes++;return true;
    });
    pass(Math.round(230*area),22,(x,z,e)=>{if(e.ny<.91||random()>.3+e.shore*.6)return false;if(!place('jungle-rock',x,z,.55+random()*.65,.55+random()*.55,1.8))return false;counts.rocks++;return true;});
    pass(Math.round(160*area),24,(x,z,e)=>{if(e.ny<.95||random()>.2+e.clearing*.35)return false;if(!place('jungle-log',x,z,.7+random()*.6,.75+random()*.4,3.7))return false;counts.logs++;return true;});
    return {objects,counts};
}
