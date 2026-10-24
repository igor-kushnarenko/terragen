import {Vector3} from 'three';
import {makeSimplex,fbm,smoothstep,clamp} from './noise';
import type {WorldData,WorldObject} from './world';
import type {EditorModel} from './state';
import type {EcologyTerrain} from './ecology';
import {jungleDefaults,type JungleSettings} from './jungle-settings';
import {waterLevelAt,waterSignedDistance} from './water-math';
import {getModel} from './model-library';

const defaults=jungleDefaults();
export function jungleRegion(world:WorldData,x:number,z:number) {
    let settings:JungleSettings|undefined=world.preset==='jungle'?world.recipe?.jungle??defaults:undefined;
    let weight=settings?1:0,center:[number,number]=[0,0],radius=512;
    for(const b of world.biomes){
        const w=1-smoothstep(b.radius*.65,b.radius,Math.hypot(x-b.center[0],z-b.center[1]));
        if(w<=0)continue;
        if(b.kind==='jungle'){settings=b.jungle??world.recipe?.jungle??defaults;weight=weight*(1-w)+w;center=b.center;radius=b.radius;}
        else if(world.preset!=='jungle'||b.id!=='world-biome'){weight*=1-w;if(weight<.01)settings=undefined;}
    }
    return {settings,weight,center,radius};
}
export function createJungleHabitat(model:EditorModel,terrain:EcologyTerrain) {
    const noise=makeSimplex(model.seeds.scatter^0x173caf);
    return {sample(x:number,z:number){
        const region=jungleRegion(model.world,x,z),j=region.settings??defaults,h=terrain.getH(x,z),ny=terrain.getNormalY(x,z);
        const water=waterLevelAt(model.state.water,model.world.waterBodies,x,z);
        let shore=0;for(const body of model.world.waterBodies)if(body.kind!=='ocean'){const p=waterSignedDistance(body,x,z);shore=Math.max(shore,1-smoothstep(0,24,-p.signed));}
        const basin=Math.max(0,(terrain.getH(x+8,z)+terrain.getH(x-8,z)+terrain.getH(x,z+8)+terrain.getH(x,z-8))*.25-h);
        const patch=.5+.5*fbm(noise,x*.008,z*.008,3),detail=.5+.5*noise(x*.036+17,z*.036-9);
        const moisture=clamp(j.moisture*.7+(.5+.5*noise(x*.012,z*.012))*.2+shore*.22+Math.min(.15,basin*.12),0,1);
        let clearing=smoothstep(.60,.82,.5+.5*noise(x*.012+49,z*.012-28))*j.clearings;
        if(j.variant==='clearing'){
            const r=Math.min(95,region.radius*.3,512*model.state.areaSize*.45)*(.65+j.clearings),cx=region.center[0]+noise(3,7)*Math.min(region.radius,512*model.state.areaSize)*.025,cz=region.center[1]+noise(9,2)*Math.min(region.radius,512*model.state.areaSize)*.025;
            clearing=Math.max(clearing,1-smoothstep(r*.7,r,Math.hypot(x-cx,z-cz)));
        }
        if(j.variant==='river')clearing=Math.max(clearing,shore*.48);
        const density=(.35+.65*smoothstep(.27,.7,patch))*(1-clearing)*region.weight;
        return {h,ny,water,shore,basin,moisture,clearing,density,patch,detail,j,weight:region.weight,
            species:noise(x*.0047+11,z*.0047-4)>.05?0:1,dry:h>water+.65&&h<model.state.snowLine-10};
    }};
}
/** Actual host crown envelopes in 32 m bins; no per-plant scan over the whole forest. */
export class CanopyIndex {
    private cells=new Map<string,{x:number;z:number;r:number}[]>();
    add(item:WorldObject) {
        const model=getModel(item.asset);if(model.category!=='tree')return;
        const size=model.bounds.getSize(new Vector3());
        const r=(size.x*item.scale[0]+size.z*item.scale[2])*.25,c={x:item.position[0],z:item.position[2],r};
        for(let z=Math.floor((c.z-r)/32);z<=Math.floor((c.z+r)/32);z++)for(let x=Math.floor((c.x-r)/32);x<=Math.floor((c.x+r)/32);x++){const key=x+','+z,list=this.cells.get(key)??[];list.push(c);this.cells.set(key,list);}
    }
    sample(x:number,z:number) {
        let light=1,covered=false;
        for(const c of this.cells.get(Math.floor(x/32)+','+Math.floor(z/32))??[]){const d=Math.hypot(x-c.x,z-c.z)/c.r;if(d<1){covered=true;light*=1-(1-smoothstep(.3,1,d))*.88;}}
        return {shade:1-light,covered};
    }
}
