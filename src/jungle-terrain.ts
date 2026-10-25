import {makeSimplex,fbm,mulberry32,smoothstep} from './noise';
import type {EditorState} from './state';
import type {JungleSettings} from './jungle-settings';
import type {Vec2,WaterBody} from './world';
import {createCoastalHeight} from './coastline';
import {fitCoastalWater} from './coastal-water';

export function jungleDrainage(seed:number,area:number) {
    const random=mulberry32(seed^0x29c731),angle=random()*Math.PI*2,cs=Math.cos(angle),sn=Math.sin(angle),phase=random()*6;
    const bend=(v:number)=>Math.sin(v*6+phase)*.07+Math.sin(v*13+phase*.6)*.025;
    return {bend,local(x:number,z:number):Vec2{return [(x*cs+z*sn)/(1024*area),(-x*sn+z*cs)/(1024*area)];},
        world(u:number,v:number):Vec2{return [(u*cs-v*sn)*1024*area,(u*sn+v*cs)*1024*area];}};
}
/** The terrain worker and editable water meshes share the same deterministic drainage plan. */
export function jungleWaterBodies(s:EditorState,j:JungleSettings):WaterBody[] {
    if(!j.streams)return [];
    const d=jungleDrainage(s.seed,s.areaSize),river=j.variant==='river',points:Vec2[]=[];
    for(let i=0;i<=28;i++){const v=-.36+i/28*.72;points.push(d.world(d.bend(v),v));}
    const level=s.water+6+6*s.areaSize,endLevel=level-4*s.areaSize;
    const width=Math.max(river?8:3,(river?24:8)*s.areaSize),lakeCenter=points.at(-1)!,radius=Math.max(9,(river?29:17)*s.areaSize);
    return fitCoastalWater(s,[{id:'jungle-river',kind:'river',name:river?'Тропическая река':'Лесной ручей',points,level,endLevel,width,
        depth:river?2.8:1.5,bankWidth:Math.max(4,11*s.areaSize),bankSurface:'gravel',opacity:.78,wave:.12,clarity:river?3:4,flowSpeed:river?.5:.3,flowDirection:1},
        {id:'jungle-pool',kind:'lake',name:'Лесной водоём',points:Array.from({length:14},(_,i)=>{const a=i/14*Math.PI*2,r=radius*(1+.13*Math.sin(a*3+.7));return [lakeCenter[0]+Math.cos(a)*r,lakeCenter[1]+Math.sin(a)*r*.75] as Vec2;}),
            level:endLevel,width:1,depth:2,bankWidth:Math.max(4,9*s.areaSize),bankSurface:'gravel',opacity:.8,wave:.06,clarity:2.5}]);
}
export function generateJungleTerrain(s:EditorState,j:JungleSettings,progress:(p:number)=>void=()=>{}) {
    const coast=s.areaSize<1||s.island?createCoastalHeight(s):undefined;
    const noise=makeSimplex(s.seed^0x648ead),fine=makeSimplex(s.seed^0x79b912),d=jungleDrainage(s.seed,s.areaSize);
    const result=new Float32Array((s.N+1)**2),n=s.N+1,f=1/Math.max(.3,s.scale),gain=Math.pow(s.sharp/5,.7);
    for(let z=0;z<n;z++){
        if(z%8===0)progress(z/n);
        for(let x=0;x<n;x++){
            const wx=(x/s.N-.5)*1024,wz=(z/s.N-.5)*1024,[u,v]=d.local(wx,wz);
            const warpedU=u+noise(u*3,v*3)*s.warp*.05,warpedV=v+noise(u*3+8,v*3)*s.warp*.05;
            const broad=.5+.5*fbm(noise,warpedU*2.2*f+3,warpedV*2.2*f-4,3);
            const hills=.5+.5*noise(warpedU*6*f,warpedV*6*f),basin=smoothstep(.47,.7,.5+.5*noise(u*10+13,v*10));
            const ridge=1-Math.abs(noise(u*5-6,v*5));
            const micro=fbm(fine,wx/(s.areaSize*19),wz/(s.areaSize*19),Math.min(3,Math.max(1,Math.floor(Math.log2(s.N/32))))) * j.microrelief;
            let h=s.water+5+(broad*.62+hills*.24+ridge*ridge*s.mountains*.25)*s.height*gain*s.areaSize-basin*2.5*s.areaSize;
            if(j.streams){
                const distance=Math.abs(u-d.bend(v)),valley=(1-smoothstep(.012,.085,distance))*(1-smoothstep(.35,.44,Math.abs(v)));
                const floor=s.water+6+6*s.areaSize-(v+.36)/.72*4*s.areaSize+2.2*s.areaSize;
                h=h*(1-valley*.92)+floor*valley*.92;
            }
            h+=micro*.8*s.areaSize;
            const gully=1-smoothstep(.025,.12,Math.abs(noise(u*11+9,v*11-6)));
            h-=gully*1.5*j.microrelief*s.areaSize;
            if(coast)h=coast(h,wx/(1024*s.areaSize),wz/(1024*s.areaSize));
            result[z*n+x]=h;
        }
    }
    progress(1);return result;
}
