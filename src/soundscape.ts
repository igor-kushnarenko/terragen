import { Vector3 } from 'three';
import { createEcology, insidePolygon, nearestOnSegment, routeClearance, FootprintIndex,objectFootprint,type EcologyTerrain } from './ecology';
import { getModel } from './model-library';
import { mulberry32,smoothstep } from './noise';
import { HALF,SPLAT_RES,type EditorModel } from './state';
import {waterLevelAt,waterPath} from './water-math';
export const SURFACES=['grass','rock','sand','snow','litter','soil','gravel','moss'] as const;
export type StepSurface=typeof SURFACES[number]|'wood'|'water';
export function groundSurface(model:EditorModel,terrain:EcologyTerrain,x:number,z:number):StepSurface {
    const px=Math.max(0,Math.min(SPLAT_RES-1,Math.floor((x+HALF)/(HALF*2)*SPLAT_RES))),pz=Math.max(0,Math.min(SPLAT_RES-1,Math.floor((z+HALF)/(HALF*2)*SPLAT_RES))),k=(pz*SPLAT_RES+px)*4;
    const weights=[...model.splat.subarray(k,k+4),...model.splatDetail.subarray(k,k+4)],largest=Math.max(...weights);
    if(largest>12)return SURFACES[weights.indexOf(largest)];
    const h=terrain.getH(x,z),ny=terrain.getNormalY(x,z);
    if(h<waterLevelAt(model.state.water,model.world.waterBodies,x,z)+3.5)return 'sand';
    if(h>model.state.snowLine&&ny>0.75)return 'snow';
    if(1-ny>model.state.rockSlope)return 'rock';
    if(routeClearance(model.world.routes,x,z)<0)return 'soil';
    if(ny<0.94)return 'gravel';
    return 'grass';
}
export function nearestWater(model:EditorModel,terrain:EcologyTerrain,x:number,z:number):{position:Vector3;distance:number;kind:'water'|'shore'}|null {
    let best:{position:Vector3;distance:number;kind:'water'|'shore'}|null=null;
    function consider(px:number,pz:number,level:number,kind:'water'|'shore') {
        if(terrain.getH(px,pz)>level+0.3)return;
        const distance=Math.hypot(px-x,pz-z);if(!best||distance<best.distance)best={position:new Vector3(px,level,pz),distance,kind};
    }
    for(const body of model.world.waterBodies) {
        if(body.kind==='ocean') {
            consider(x,z,body.level,'shore');
            for(const radius of [8,20,45,90,180])for(let i=0;i<16;i++)consider(x+Math.cos(i*Math.PI/8)*radius,z+Math.sin(i*Math.PI/8)*radius,body.level,'shore');
        } else {
            if(body.kind==='lake'&&insidePolygon(x,z,body.points))consider(x,z,body.level,'water');
            const segments=body.kind==='lake'?body.points.length:body.points.length-1;
            for(let i=0;i<segments;i++) {const p=nearestOnSegment(x,z,body.points[i],body.points[(i+1)%body.points.length]);consider(p[0],p[1],waterPath(body,p[0],p[1]).level,'water');}
        }
    }
    return best;
}
export function createSoundEnvironment(model:EditorModel,terrain:EcologyTerrain) {
    const ecology=createEcology(model,terrain);
    let trees=new FootprintIndex(),objects:typeof model.world.objects|undefined,shown=false,water=NaN,revision=-1;
    function forestAt(x:number,z:number){
        if(objects!==model.world.objects||shown!==model.state.showScatter||water!==model.state.water||revision!==model.terrainRevision){objects=model.world.objects;shown=model.state.showScatter;water=model.state.water;revision=model.terrainRevision;trees=new FootprintIndex();for(const item of objects)if(getModel(item.asset).category==='tree'&&(item.source!=='scatter'||shown&&terrain.getH(item.position[0],item.position[2])>water+0.5)) {const footprint=objectFootprint(item,terrain);if(footprint.minY<=terrain.getH(footprint.x,footprint.z)+2)trees.insert(footprint);}}
        const nearby=trees.query(x,z,18).filter(p=>Math.hypot(x-p.x,z-p.z)<18+p.radius);
        return {cover:1-Math.exp(-nearby.length*0.22),underTree:nearby.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius)};
    }
    return {sample(x:number,z:number){ const e=ecology.sample(x,z),forest=forestAt(x,z).cover;return {forest,moisture:e.moisture,birds:(0.2+forest*0.8)*smoothstep(-3,12,model.state.sunEl),wind:0.07+model.state.windSpeed*0.05,water:nearestWater(model,terrain,x,z)};},
        surface(x:number,z:number){const surface=groundSurface(model,terrain,x,z);if(surface!=='grass')return surface;const e=ecology.sample(x,z);return forestAt(x,z).underTree?(e.moisture>0.75?'moss':'litter'):surface;}};
}
export interface SoundPose {on:boolean;paused:boolean;feet:Vector3;grounded:boolean;swim:boolean;}
export interface StepEvent {x:number;y:number;z:number;surface:StepSurface;intensity:number;time:number;}
export function createStepTracker(surface:(x:number,z:number,y:number)=>StepSurface) {
    let previous:Vector3|undefined,onGround=true,distance=0,airTime=0,time=0;
    const pending:StepEvent[]=[];
    function reset(){previous=undefined;distance=0;airTime=0;pending.length=0;}
    function step(dt:number,pose:SoundPose) {
        time+=dt;
        if(!pose.on||pose.paused){reset();return;}
        if(!previous){previous=pose.feet.clone();onGround=pose.grounded;return;}
        const travelled=Math.hypot(pose.feet.x-previous.x,pose.feet.z-previous.z);previous.copy(pose.feet);
        if(travelled>Math.max(1,dt*70)){reset();return;}
        if(!pose.grounded){airTime+=dt;onGround=false;distance=0;return;}
        const landed=!onGround&&airTime>0.12;onGround=true;
        if(landed||travelled>1e-6)distance+=travelled;
        const stride=pose.swim?1.7:travelled/dt>6?2.2:1.7;
        if(landed||distance>=stride) {
            distance=landed?0:distance%stride;
            pending.push({x:pose.feet.x,y:pose.feet.y,z:pose.feet.z,surface:pose.swim?'water':surface(pose.feet.x,pose.feet.z,pose.feet.y),intensity:landed?Math.min(1.4,0.8+airTime*0.3):travelled/dt>6?1.15:0.8,time});
            if(pending.length>4)pending.shift();
        }
        airTime=0;
    }
    return {step,reset,take(){return pending.splice(0);},get time(){return time;}};
}
export function noiseSamples(sampleRate:number,seconds:number,seed:number,pink=false) {
    const data=new Float32Array(Math.round(sampleRate*seconds)),random=mulberry32(seed);let previous=0;
    for(let i=0;i<data.length;i++){const white=random()*2-1;previous=previous*0.97+white*0.03;data[i]=pink?previous*2.5:white*0.4;}
    const seam=Math.min(Math.round(sampleRate*0.04),Math.floor(data.length/4));
    for(let i=0;i<seam;i++){const t=i/seam;data[data.length-seam+i]=data[data.length-seam+i]*(1-t)+data[0]*t;}
    if(data.length>1)data[data.length-1]=data[0];
    return data;
}
export function footstepSamples(surface:StepSurface,sampleRate:number,seed:number) {
    const duration=surface==='sand'||surface==='grass'||surface==='moss'?0.25:0.18,data=noiseSamples(sampleRate,duration,seed),random=mulberry32(seed^0x5243);
    const bass=surface==='wood'?135:surface==='rock'?220:surface==='water'?85:75;
    let low=0;
    for(let i=0;i<data.length;i++) {
        const t=i/sampleRate,u=t/duration,envelope=Math.sin(Math.PI*Math.min(1,u*5))*Math.exp(-u*6),crunch=(surface==='gravel'||surface==='snow'||surface==='litter')?(random()>0.985?0.7:0.12):0.1;
        low=low*0.92+data[i]*0.08;
        const texture=surface==='sand'||surface==='moss'||surface==='grass'?low*1.5:surface==='water'?low*3+Math.sin(t*690)*data[i]:data[i]*(0.5+crunch);
        data[i]=(Math.sin(t*bass*Math.PI*2)*0.32*Math.exp(-t*35)+texture)*envelope;
    }
    if(data.length>1){data[0]=0;data[data.length-1]=0;}
    return data;
}
