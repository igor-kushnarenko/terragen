import {makeSimplex,fbm,smoothstep,clamp} from './noise';
import {taigaDefaults,TAIGA_LIMITS,type TaigaSettings} from './taiga-settings';
import type {EditorModel} from './state';
import type {WorldData} from './world';
import type {EcologyTerrain} from './ecology';
import {waterLevelAt,waterSignedDistance} from './water-math';
const defaults=taigaDefaults();
export function hasTaiga(world:WorldData){return world.preset==='taiga'||world.biomes.some(b=>b.kind==='taiga');}
export function taigaRegion(world:WorldData,x:number,z:number){
    let settings:TaigaSettings|undefined=world.preset==='taiga'?world.recipe?.taiga??defaults:undefined,weight=settings?1:0;
    for(const b of world.biomes){
        if(b.id==='world-biome'&&world.preset==='taiga')continue;
        const w=1-smoothstep(b.radius*.65,b.radius,Math.hypot(x-b.center[0],z-b.center[1]));if(w<=0)continue;
        if(b.kind==='taiga'){
            const next=b.taiga??defaults;
            if(settings&&weight>.05&&w<1){
                const blended={...(w<.5?settings:next)};
                for(const key of Object.keys(TAIGA_LIMITS) as (keyof typeof TAIGA_LIMITS)[])blended[key]=settings[key]*(1-w)+next[key]*w;
                settings=blended;
            }else settings=next;
            weight=weight*(1-w)+w;
        }
        else weight*=1-w;
    }
    return {settings,weight};
}
export function createTaigaHabitat(model:EditorModel,terrain:EcologyTerrain){
    const noise=makeSimplex(model.seeds.scatter^0x9b231),area=model.state.areaSize;
    return {sample(x:number,z:number){
        const region=taigaRegion(model.world,x,z),t=region.settings??defaults,h=terrain.getH(x,z),ny=terrain.getNormalY(x,z);
        const water=waterLevelAt(model.state.water,model.world.waterBodies,x,z);
        let shore=0;for(const body of model.world.waterBodies)if(body.kind!=='ocean')shore=Math.max(shore,1-smoothstep(0,Math.max(7,32*area),-waterSignedDistance(body,x,z).signed));
        const basin=clamp(((terrain.getH(x+12*area,z)+terrain.getH(x-12*area,z)+terrain.getH(x,z+12*area)+terrain.getH(x,z-12*area))*.25-h)/Math.max(.2,area*2),0,1);
        const u=x/Math.max(.3,area),v=z/Math.max(.3,area),patch=.5+.5*fbm(noise,u*.007,v*.007,3),detail=.5+.5*noise(u*.04+13,v*.04-6);
        const moisture=clamp(t.moisture*.72+(.5+.5*noise(u*.011,v*.011))*.24+shore*.24+basin*.16-(1-ny)*.8,0,1);
        const bog=smoothstep(.65,.94,moisture)*(shore*.75+basin*.6+smoothstep(.4,.75,.5+.5*noise(u*.014-19,v*.014+9))*.65)*t.bogFrequency;
        const disturbance=smoothstep(.65,.86,.5+.5*noise(u*.022+83,v*.022-47));
        const clearing=clamp(smoothstep(.50-t.clearingFrequency*.2,.77-t.clearingFrequency*.2,.5+.5*noise(u*.009+41,v*.009-28))*t.clearingFrequency*1.8+disturbance*.25,0,1);
        const density=(.12+.88*smoothstep(.25,.72,patch))*(1-clearing)*smoothstep(.82,.98,ny)*region.weight;
        const drainage=clamp((1-moisture)*.7+(1-ny)*2+.3-basin*.3,0,1);
        return {t,weight:region.weight,h,ny,water,shore,basin,patch,detail,moisture,bog,clearing,disturbance,density,drainage,dry:h>water+.7};
    }};
}
