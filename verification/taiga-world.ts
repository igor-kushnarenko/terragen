import {createModel,SIZE} from '../src/state';
import {deriveSeeds} from '../src/world';
import {worldSettings,defaultWorldRequest} from '../src/world-generation';
import {taigaDefaults,type TaigaSettings} from '../src/taiga-settings';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {taigaWaterBodies} from '../src/taiga-terrain';
import {sampleHeight,triangleGrade} from '../src/trail-math';
import {scatterTaiga} from '../src/taiga-scatter';
import {validateWorld,encodeProject} from '../src/project';
import {CanopyIndex} from '../src/jungle-habitat';
import {createTaigaHabitat} from '../src/taiga-habitat';

export function taigaWorld(settings:TaigaSettings=taigaDefaults(),seed=424242,areaSize=.25,N=128){
    const started=performance.now(),model=createModel(),request={...defaultWorldRequest(),preset:'taiga' as const,seed,areaSize,N,taiga:settings};
    Object.assign(model.state,worldSettings(model.state,request));model.N=N;model.n=N+1;model.cell=SIZE/N;model.seeds=deriveSeeds(seed);
    model.heights=computeTerrainJob({kind:'terrain',preset:'taiga',settings:model.state,seed,taiga:settings,worldErosion:1});
    model.world.preset='taiga';model.world.recipe={version:1,seed,erosion:1,plants:true,routes:false,taiga:settings};
    model.world.biomes=[{id:'world-biome',name:'Тайга',kind:'taiga',center:[0,0],radius:SIZE}];
    model.world.waterBodies[0]={...model.world.waterBodies[0],level:model.state.water,opacity:model.state.waterOpacity,wave:model.state.wave};model.world.waterBodies.push(...taigaWaterBodies(model.state,settings));
    const terrain={getH:(x:number,z:number)=>sampleHeight(model.heights,N,x,z),getNormalY:(x:number,z:number)=>1/Math.hypot(1,triangleGrade(model.heights,N,x,z))};
    const scatter=scatterTaiga(model,terrain);model.world.objects=scatter.objects;model.world=validateWorld(model.world,model.state);
    const canopy=new CanopyIndex(),habitat=createTaigaHabitat(model,terrain);for(const o of model.world.objects)canopy.add(o);
    let dry=0,covered=0,bog=0;const heights:number[]=[];
    for(let z=-512;z<512;z+=12)for(let x=-512;x<512;x+=12){const e=habitat.sample(x,z);if(!e.dry||e.ny<.84)continue;dry++;if(canopy.sample(x,z).covered)covered++;bog+=e.bog;heights.push(e.h);}
    heights.sort((a,b)=>a-b);
    const stats={variant:settings.variant,seed,areaSize,N,objects:model.world.objects.length,...scatter.counts,coverage:dry?covered/dry:0,bog:dry?bog/dry:0,
        relief90:heights.length?heights[Math.floor(heights.length*.95)]-heights[Math.floor(heights.length*.05)]:0,waterBodies:model.world.waterBodies.length-1,cpuMs:Math.round(performance.now()-started)};
    const project=()=>encodeProject(model,{camera:{pos:[-100,70,130],target:[0,18,0],rotation:[0,0,0],near:.5},walk:null});
    return {model,terrain,stats,project,canopy,habitat};
}
