import {makeSimplex,fbm,mulberry32,smoothstep} from './noise';
import type {EditorState} from './state';
import type {TaigaSettings} from './taiga-settings';
import type {Vec2,WaterBody} from './world';
import {createCoastalHeight} from './coastline';
import {fitCoastalWater} from './coastal-water';

/** Shared basin plan for the terrain worker, water meshes and the moisture field. */
export function taigaDrainage(seed:number,area:number){
    const random=mulberry32(seed^0x6b1e72),a=random()*Math.PI*2,c=Math.cos(a),s=Math.sin(a),phase=random()*6;
    const world=(u:number,v:number):Vec2=>[(u*c-v*s)*1024*area,(u*s+v*c)*1024*area];
    const local=(x:number,z:number):Vec2=>[(x*c+z*s)/(1024*area),(-x*s+z*c)/(1024*area)];
    const bend=(v:number)=>Math.sin(v*8+phase)*.065+Math.sin(v*19+phase)*.012;
    const basins=Array.from({length:4},(_,i)=>({u:(i%2?1:-1)*(.11+random()*.12),v:(i<2?-1:1)*(.10+random()*.12),r:.026+random()*.022}));
    return {world,local,bend,basins};
}
export function taigaWaterBodies(s:EditorState,t:TaigaSettings):WaterBody[]{
    if(!t.water)return [];
    const d=taigaDrainage(s.seed,s.areaSize),count=Math.floor(t.bogFrequency*4),level=s.water+5+7*s.areaSize;
    const bodies:WaterBody[]=d.basins.slice(0,count).map((b,i)=>({id:'taiga-pool-'+i,name:'Торфяное лесное озерцо',kind:'lake',
        points:Array.from({length:18},(_,k)=>{const a=k/18*Math.PI*2,r=b.r*(1+.15*Math.sin(a*3+i));return d.world(b.u+Math.cos(a)*r,b.v+Math.sin(a)*r*.8);}),
        level,width:1,depth:1.5,bankWidth:Math.max(5,22*s.areaSize),bankSurface:'gravel',opacity:.86,wave:.04,clarity:1.2}));
    if(t.moisture>.4){
        const points=Array.from({length:25},(_,i)=>{const v=-.33+i/24*.66;return d.world(d.bend(v),v);});
        bodies.push({id:'taiga-stream',name:'Северный лесной ручей',kind:'river',points,level,endLevel:level-3*s.areaSize,
            width:Math.max(3,10*s.areaSize,1024/s.N*2.5),depth:1.2,bankWidth:Math.max(4,14*s.areaSize,1024/s.N),bankSurface:'gravel',opacity:.8,wave:.06,clarity:3,flowSpeed:.22,flowDirection:1});
    }
    return fitCoastalWater(s,bodies);
}
export function generateTaigaTerrain(s:EditorState,t:TaigaSettings,progress:(p:number)=>void=()=>{}){
    const coast=s.areaSize<1||s.island?createCoastalHeight(s):undefined;
    const noise=makeSimplex(s.seed^0x41ba73),fine=makeSimplex(s.seed^0x18df26),d=taigaDrainage(s.seed,s.areaSize);
    const n=s.N+1,result=new Float32Array(n*n),gain=(s.sharp/5)**.7,f=1/Math.max(.3,s.scale);
    for(let z=0;z<n;z++){
        if(z%8===0)progress(z/n);
        for(let x=0;x<n;x++){
            const wx=(x/s.N-.5)*1024,wz=(z/s.N-.5)*1024,[u,v]=d.local(wx,wz);
            const a=u+noise(u*3,v*3)*s.warp*.035,b=v+noise(u*3+9,v*3-7)*s.warp*.035;
            const broad=.5+.5*fbm(noise,a*3*f+2,b*3*f-6,3),hills=.5+.5*noise(a*9*f,b*9*f),rock=1-Math.abs(noise(a*14,b*14));
            const floor=s.water+5+7*s.areaSize;
            let h=floor+4*s.areaSize+(broad*.38+hills*.12+rock**3*s.mountains*.13)*s.height*gain*s.areaSize*t.terrainVariation;
            // Broad, shallow wetlands stay readable even at preview resolution.
            for(const basin of d.basins){
                const weight=(1-smoothstep(basin.r,basin.r*3.8,Math.hypot(u-basin.u,v-basin.v)))*t.bogFrequency;
                h=h*(1-weight)+(floor+.7*s.areaSize)*weight;
            }
            if(t.water&&t.moisture>.4){const w=(1-smoothstep(.008,.07,Math.abs(u-d.bend(v))))*(1-smoothstep(.32,.4,Math.abs(v)));
                h=h*(1-w)+(floor-(v+.33)/.66*3*s.areaSize+1.1*s.areaSize)*w;}
            const micro=fbm(fine,wx/(17*s.areaSize),wz/(17*s.areaSize),Math.min(3,Math.max(1,Math.floor(Math.log2(s.N/24)))));
            const hollow=1-smoothstep(.02,.13,Math.abs(noise(u*18+7,v*18-2)));
            h+=(micro*.8-hollow*.6)*s.areaSize*t.terrainVariation*gain;
            if(coast)h=coast(h,wx/(1024*s.areaSize),wz/(1024*s.areaSize));
            result[z*n+x]=h;
        }
    }
    progress(1);return result;
}
