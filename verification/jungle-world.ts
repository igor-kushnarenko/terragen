import {createModel,SIZE} from '../src/state';
import {deriveSeeds} from '../src/world';
import {worldSettings,defaultWorldRequest} from '../src/world-generation';
import {jungleDefaults,type JungleSettings} from '../src/jungle-settings';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {jungleWaterBodies} from '../src/jungle-terrain';
import {sampleHeight,triangleGrade} from '../src/trail-math';
import {scatterJungle} from '../src/jungle-scatter';
import {worldPaths} from '../src/world-paths';
import {paintTrails} from '../src/trail-earthworks';
import {validateWorld,encodeProject} from '../src/project';
import {CanopyIndex,createJungleHabitat} from '../src/jungle-habitat';
import {getModel} from '../src/model-library';

export function jungleWorld(settings:JungleSettings=jungleDefaults(),seed=424242,areaSize=.25,N=256) {
    const started=performance.now(),model=createModel(),request={...defaultWorldRequest(),preset:'jungle' as const,seed,areaSize,N,jungle:settings};
    Object.assign(model.state,worldSettings(model.state,request));model.N=N;model.n=N+1;model.cell=SIZE/N;model.seeds=deriveSeeds(seed);
    model.heights=computeTerrainJob({kind:'terrain',preset:'jungle',settings:model.state,seed,jungle:settings,worldErosion:1});
    model.world.preset='jungle';model.world.recipe={version:1,seed,erosion:1,plants:true,routes:true,jungle:settings};
    model.world.biomes=[{id:'world-biome',name:'Джунгли',kind:'jungle',center:[0,0],radius:SIZE}];
    model.world.waterBodies[0]={...model.world.waterBodies[0],level:model.state.water,opacity:model.state.waterOpacity,wave:model.state.wave};model.world.waterBodies.push(...jungleWaterBodies(model.state,settings));
    const terrain={getH:(x:number,z:number)=>sampleHeight(model.heights,N,x,z),getNormalY:(x:number,z:number)=>1/Math.hypot(1,triangleGrade(model.heights,N,x,z))};
    Object.assign(model.world,worldPaths(model,true));paintTrails(model,model.world.routes);
    const scatter=scatterJungle(model,terrain);model.world.objects=scatter.objects;model.world=validateWorld(model.world,model.state);
    const canopy=new CanopyIndex(),habitat=createJungleHabitat(model,terrain);for(const o of model.world.objects)canopy.add(o);
    let dry=0,covered=0,clearingDry=0,clearingCovered=0;const heights:number[]=[];
    for(let z=-512;z<512;z+=8)for(let x=-512;x<512;x+=8){const e=habitat.sample(x,z);if(!e.dry||e.ny<.88)continue;dry++;const cover=canopy.sample(x,z).covered;if(cover)covered++;if(e.clearing>.7){clearingDry++;if(cover)clearingCovered++;}heights.push(e.h-model.state.water);}
    heights.sort((a,b)=>a-b);
    const sizes=(prefix:string)=>model.world.objects.filter(o=>o.asset.startsWith(prefix)).map(o=>getModel(o.asset).bounds.max.y*o.scale[1]);
    const emergents=sizes('jungle-emergent'),trees=sizes('jungle-canopy');
    const stats={variant:settings.variant,seed,areaSize,N,objects:model.world.objects.length,...scatter.counts,coverage:dry?covered/dry:0,clearingCoverage:clearingDry?clearingCovered/clearingDry:0,
        emergentHeight:emergents.length?[Math.min(...emergents),Math.max(...emergents)]:[],canopyHeight:trees.length?[Math.min(...trees),Math.max(...trees)]:[],
        relief90:heights.length?heights[Math.floor(heights.length*.95)]-heights[Math.floor(heights.length*.05)]:0,waterBodies:model.world.waterBodies.filter(b=>b.kind!=='ocean').length,cpuMs:Math.round(performance.now()-started)};
    const project=()=>encodeProject(model,{camera:{pos:[-110*areaSize/.25,70,150*areaSize/.25],target:[0,20,0],rotation:[0,0,0],near:.5},walk:null});
    return {model,terrain,stats,project,canopy,habitat};
}
