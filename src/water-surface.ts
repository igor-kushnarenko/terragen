import {Vector2, Vector3, Vector4} from 'three';
import type {EditorModel} from './state';
import type {WaterBody} from './world';
import {waterAtShore} from './water-domain';
import {WATER_PROFILES} from './quality';

// This table also generates the GLSL. Physics and rendering use the same wave spectrum.
export const WATER_WAVES = [
    {angle:0, length:18, amplitude:.18, phase:0},
    {angle:.61, length:10.3, amplitude:.085, phase:1.7},
    {angle:-.43, length:5.7, amplitude:.038, phase:3.1},
    {angle:1.2, length:2.9, amplitude:.016, phase:5.2},
] as const;
export const MAX_WATER_IMPACTS=24;
export interface WaterImpact {x:number;z:number;time:number;strength:number;body:number;radius:number;}
export interface WaterSample {level:number;meanLevel:number;dx:number;dz:number;normal:Vector3;body:WaterBody|null;}
export type WaterQuery=(x:number,z:number)=>Pick<WaterSample,'level'|'dx'|'dz'>;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const WATER_SPECTRUM_SUM=WATER_WAVES.reduce((sum,w)=>sum+w.amplitude,0);
export function waveSettings(kind:WaterBody['kind'],wave:number,windSpeed:number,depth:number){
    const wind=Math.max(0,Math.min(3,windSpeed)),factor=kind==='ocean'?1:kind==='lake'?.38:.12;
    const base=40*(1-Math.exp(-Math.max(0,wave)*factor*(.18+.5*wind+1.6*wind*wind)/40)),peak=base*WATER_SPECTRUM_SUM;
    const runup=Math.min(kind==='ocean'?2.8:kind==='lake'?1.4:.45,peak*(kind==='river'?.15:.3));
    const shoal=1+.4*(1-smooth(1,12,depth)),limit=Math.max(0,depth)*.5+runup;
    const localPeak=Math.min(peak*shoal,limit)*(1-smooth(0,Math.max(.03,runup*1.5),-depth));
    return {amplitude:localPeak/WATER_SPECTRUM_SUM,length:kind==='ocean'?1+wind*wind*.9:kind==='lake'?.6*(1+wind*wind*.45):.32*(1+wind*wind*.12),chop:.18*smooth(0,Math.max(3,peak*2),depth),peak,runup};
}
export function gerstnerOffset(x:number,z:number,time:number,angle:number,amplitude:number,length:number,flowX=0,flowZ=0,chop=.18){
    let ox=0,oy=0,oz=0,gx=0,gz=0;
    for(const w of WATER_WAVES){const a=angle+w.angle,dx=Math.sin(a),dz=Math.cos(a),k=2*Math.PI/(w.length*length),p=k*(dx*(x-flowX*time)+dz*(z-flowZ*time))-Math.sqrt(9.81*k)*time+w.phase,h=w.amplitude*amplitude;
        ox+=dx*h*chop*Math.cos(p);oz+=dz*h*chop*Math.cos(p);oy+=h*Math.sin(p);gx+=dx*k*h*Math.cos(p);gz+=dz*k*h*Math.cos(p);
    }
    return {x:ox,y:oy,z:oz,gx,gz};
}
export function impactHeight(impact:WaterImpact,x:number,z:number,time:number){
    const age=time-impact.time;if(age<0||age>4.5)return 0;
    const d=Math.hypot(x-impact.x,z-impact.z),front=d-age*2.6,spread=.32+age*.18+impact.radius;
    return impact.strength*Math.sin(front*7)*Math.exp(-front*front/(spread*spread))*Math.exp(-age*1.05)/Math.sqrt(1+d);
}
export function createWaterSurface(model:EditorModel,getH:(x:number,z:number)=>number){
    let time=0,source=model.world.waterBodies,terrainRevision=model.terrainRevision;
    const impacts:WaterImpact[]=[],packed=Array.from({length:MAX_WATER_IMPACTS},()=>new Vector4()),meta=Array.from({length:MAX_WATER_IMPACTS},()=>new Vector4());
    let flowQuery:((body:WaterBody,x:number,z:number,dx:number,dz:number)=>Vector2)|undefined;
    function reset(){time=0;impacts.length=0;source=model.world.waterBodies;terrainRevision=model.terrainRevision;}
    function advance(dt:number){if(source!==model.world.waterBodies||terrainRevision!==model.terrainRevision){impacts.length=0;source=model.world.waterBodies;terrainRevision=model.terrainRevision;}if(Number.isFinite(dt))time+=Math.max(0,dt);while(impacts.length&&time-impacts[0].time>4.5)impacts.shift();}
    function addImpact(x:number,z:number,strength:number,radius=.08){
        const sample=waterAtShore(model.state.water,model.world.waterBodies,x,z,getH(x,z));if(getH(x,z)>=sample.level+waveSettings(sample.body?.kind??'ocean',sample.body?.wave??model.state.wave,model.state.windSpeed,0).runup+.1||!Number.isFinite(strength))return false;
        if(impacts.length===MAX_WATER_IMPACTS)impacts.shift();
        impacts.push({x,z,time,strength:Math.max(-.22,Math.min(.22,strength)),body:sample.body?model.world.waterBodies.indexOf(sample.body)+1:0,radius});return true;
    }
    function sample(x:number,z:number):WaterSample{
        const s=waterAtShore(model.state.water,model.world.waterBodies,x,z,getH(x,z)),ocean=model.world.waterBodies.find(b=>b.kind==='ocean')!,body=s.body??ocean;
        const kind=body.kind,wave=kind==='ocean'?model.state.wave:body.wave,mean=s.level,id=s.body?model.world.waterBodies.indexOf(body)+1:0;
        let dx=s.dx,dz=s.dz;if(s.body&&flowQuery){const f=flowQuery(body,x,z,dx,dz);dx=f.x;dz=f.y;}
        const angle=model.state.windDir*Math.PI/180,settings=waveSettings(kind,wave,model.state.windSpeed,mean-getH(x,z));
        // Invert the horizontal Gerstner displacement to query height at an Eulerian world point.
        let bx=x,bz=z,w=gerstnerOffset(x,z,time,angle,settings.amplitude,settings.length,dx,dz,settings.chop);
        for(let i=0;i<8;i++){bx=x-w.x;bz=z-w.z;const local=waveSettings(kind,wave,model.state.windSpeed,mean-getH(bx,bz));w=gerstnerOffset(bx,bz,time,angle,local.amplitude,local.length,dx,dz,local.chop);}
        let ripple=0,rx=0,rz=0;for(const impact of impacts.slice(-WATER_PROFILES[model.state.quality].impacts))if(impact.body===id){ripple+=impactHeight(impact,x,z,time);rx+=(impactHeight(impact,x+.04,z,time)-impactHeight(impact,x-.04,z,time))/.08;rz+=(impactHeight(impact,x,z+.04,time)-impactHeight(impact,x,z-.04,time))/.08;}
        return {level:mean+w.y+ripple,meanLevel:mean,dx,dz,body:s.body??null,normal:new Vector3(-w.gx-rx,1,-w.gz-rz).normalize()};
    }
    function upload(limit=MAX_WATER_IMPACTS){const active=impacts.slice(-limit);for(let i=0;i<MAX_WATER_IMPACTS;i++){const p=active[i];packed[i].set(p?.x??0,p?.z??0,p?.time??-100,p?.strength??0);meta[i].set(p?.body??-1,p?.radius??0,0,0);}return {packed,meta,count:active.length};}
    return {advance,reset,sample,addImpact,upload,bindFlow(query:NonNullable<typeof flowQuery>){flowQuery=query;},get time(){return time;},get impacts(){return impacts as readonly WaterImpact[];}};
}
export type WaterSurface=ReturnType<typeof createWaterSurface>;

const f=(x:number)=>Number.isInteger(x)?x.toFixed(1):String(x);
export const WATER_WAVE_GLSL=`
uniform float uTime,uWave,uWindSpeed,uWindAngle,uWaterKind,uBodyIndex;
uniform vec4 uImpacts[${MAX_WATER_IMPACTS}],uImpactMeta[${MAX_WATER_IMPACTS}];uniform int uImpactCount;
float rippleHeight(vec2 p){float h=0.0;for(int i=0;i<${MAX_WATER_IMPACTS};i++){if(i>=uImpactCount)break;vec4 hit=uImpacts[i];float age=uTime-hit.z;if(age<0.0||age>4.5||abs(uImpactMeta[i].x-uBodyIndex)>.5)continue;float d=length(p-hit.xy),front=d-age*2.6,spread=.32+age*.18+uImpactMeta[i].y;h+=hit.w*sin(front*7.0)*exp(-front*front/(spread*spread))*exp(-age*1.05)/sqrt(1.0+d);}return h;}
vec2 rippleGradient(vec2 p){vec2 g=vec2(0.0);for(int i=0;i<${MAX_WATER_IMPACTS};i++){if(i>=uImpactCount)break;vec4 hit=uImpacts[i];float age=uTime-hit.z;if(age<0.0||age>4.5||abs(uImpactMeta[i].x-uBodyIndex)>.5)continue;vec2 delta=p-hit.xy;float d=length(delta),front=d-age*2.6,spread=.32+age*.18+uImpactMeta[i].y;if(abs(front)>spread*3.0)continue;float envelope=hit.w*exp(-front*front/(spread*spread))*exp(-age*1.05)/sqrt(1.0+d);float gradient=envelope*(7.0*cos(front*7.0)-sin(front*7.0)*(2.0*front/(spread*spread)+.5/(1.0+d)));g+=delta/max(.001,d)*gradient;}return g;}
float waterBasePeak(){float wind=clamp(uWindSpeed,0.0,3.0),factor=uWaterKind<.5?1.0:uWaterKind<1.5?.38:.12;return 40.0*(1.0-exp(-max(0.0,uWave)*factor*(.18+.5*wind+1.6*wind*wind)/40.0))*${f(WATER_SPECTRUM_SUM)};}
float waterRunup(){return min(uWaterKind<.5?2.8:uWaterKind<1.5?1.4:.45,waterBasePeak()*(uWaterKind>1.5?.15:.3));}
vec3 waveParameters(float depth){float wind=clamp(uWindSpeed,0.0,3.0),peak=waterBasePeak(),runup=waterRunup();float shoal=1.0+.4*(1.0-smoothstep(1.0,12.0,depth)),limit=max(0.0,depth)*.5+runup;float localPeak=min(peak*shoal,limit)*(1.0-smoothstep(0.0,max(.03,runup*1.5),-depth));float lengthScale=uWaterKind<.5?1.0+wind*wind*.9:uWaterKind<1.5?.6*(1.0+wind*wind*.45):.32*(1.0+wind*wind*.12);return vec3(localPeak/${f(WATER_SPECTRUM_SUM)},lengthScale,.18*smoothstep(0.0,max(3.0,peak*2.0),depth));}
vec2 waterGradient(vec2 p,float depth,vec2 flow){vec3 settings=waveParameters(depth);float amplitude=settings.x,lengthScale=settings.y;vec2 g=vec2(0.0);
${WATER_WAVES.map(w=>`{float a=uWindAngle+${f(w.angle)};vec2 d=vec2(sin(a),cos(a));float k=6.28318530718/(${f(w.length)}*lengthScale),phase=k*dot(d,p-flow*uTime)-sqrt(9.81*k)*uTime+${f(w.phase)};g+=d*k*${f(w.amplitude)}*amplitude*cos(phase);}`).join('\n')}
return g+rippleGradient(p);}
vec3 waterOffset(vec2 p,float depth,vec2 flow){
vec3 settings=waveParameters(depth);float amplitude=settings.x,lengthScale=settings.y,chop=settings.z;vec3 o=vec3(0.0);
${WATER_WAVES.map(w=>`{float a=uWindAngle+${f(w.angle)};vec2 d=vec2(sin(a),cos(a));float k=6.28318530718/(${f(w.length)}*lengthScale),phase=k*dot(d,p-flow*uTime)-sqrt(9.81*k)*uTime+${f(w.phase)},h=${f(w.amplitude)}*amplitude;o+=vec3(d.x*h*chop*cos(phase),h*sin(phase),d.y*h*chop*cos(phase));}`).join('\n')}
o.y+=rippleHeight(p+o.xz);return o;}
`;
