import {makeSimplex,fbm,mulberry32,smoothstep,clamp} from './noise';
import {smoothRelief} from './terrain-smoothing';
import type {EditorState} from './state';
import type {WorldPresetId} from './world';
import type {Progress} from './terrain-compute';
import {generateJungleTerrain} from './jungle-terrain';
import {jungleDefaults,type JungleSettings} from './jungle-settings';

/** Recipe v1: macro landforms in metres, independent of mesh resolution. */
export function generateWorldTerrain(s:EditorState,preset:WorldPresetId,progress:Progress=()=>{},jungle?:JungleSettings){
    if(preset==='jungle')return generateJungleTerrain(s,jungle??jungleDefaults(),progress);
    const random=mulberry32(s.seed^0x5a3712),noise=makeSimplex(s.seed),detail=makeSimplex(s.seed^0x2f913),angle=random()*Math.PI*2,cs=Math.cos(angle),sn=Math.sin(angle);
    const islands=Array.from({length:preset==='archipelago'?12:7},(_,i)=>{
        const a=i*2.399963+random()*.5,r=i===0?.04:.16+random()*.24;
        return {x:Math.cos(a)*r,z:Math.sin(a)*r,r:i===0?.13:.045+random()*.075,h:.45+random()*.55};
    });
    const channels=Array.from({length:3},(_,i)=>({x:(i-1)*.22,phase:random()*8,width:.022+random()*.014}));
    const n=s.N+1,result=new Float32Array(n*n),sharp=clamp(s.sharp/5,0,1),gain=sharp**.7;
    const scale=1.4/s.scale,octaves=Math.min(s.octaves,Math.max(1,Math.floor(Math.log2(s.N*s.areaSize/10))));
    for(let j=0;j<n;j++){
        if(j%8===0)progress(j/n*.9);
        for(let i=0;i<n;i++){
            const u=(i/s.N-.5)/s.areaSize,v=(j/s.N-.5)/s.areaSize;
            const x=(u*cs-v*sn)*scale,z=(u*sn+v*cs)*scale;
            const warpX=x+noise(x*2+17,z*2)*.045*s.warp,warpZ=z+noise(x*2-9,z*2+4)*.045*s.warp;
            const broad=fbm(noise,warpX*3+4,warpZ*3-3,3)*.5+.5;
            const fine=fbm(detail,warpX*7,warpZ*7,octaves)*.5+.5;
            let elevation=0,shore=1;
            if(preset==='archipelago'||preset==='iron-islands'){
                shore=-1;let islandHeight=0;
                for(const island of islands){
                    const dx=u-island.x+noise(u*9,v*9)*.018*s.warp,dz=v-island.z+noise(u*9+7,v*9)*.018*s.warp;
                    const radius=island.r*(1+.19*noise(u*13+3,v*13-2));
                    const field=1-Math.hypot(dx,dz)/radius;
                    if(field>shore){shore=field;islandHeight=island.h;}
                }
                if(preset==='archipelago')elevation=Math.max(0,shore)**.7*(.3+.7*broad)*islandHeight;
                else{
                    const plateau=Math.max(0,shore)**.35*(.45+.55*broad);
                    elevation=(plateau*.72+Math.floor(plateau*5)/5*.28)*islandHeight;
                }
            }else if(preset==='desert'){
                const phase=warpX*24+noise(warpX*2,warpZ*2)*2+Math.sin(warpZ*3)*.7;
                const wave=phase-Math.floor(phase),dune=wave<.76?wave/.76:(1-wave)/.24;
                const dunes=smoothstep(0,1,dune)*(.5+.5*broad);
                const ridge=Math.max(0,1-Math.abs(noise(warpX*3-7,warpZ*3+4)));
                elevation=.08+dunes*.40+smoothstep(.63,.88,broad)*ridge*.42*s.mountains;
            }else if(preset==='fjords'){
                let distance=100;
                for(const channel of channels){
                    const center=channel.x+Math.sin(z*5+channel.phase)*.055+noise(z*3,channel.phase)*.035*s.warp;
                    distance=Math.min(distance,Math.abs(x-center)/channel.width);
                }
                const inland=smoothstep(-.4,-.05,z);
                const channel=1-smoothstep(.65,2.4,distance);
                shore=(distance-.78)*.15;shore=Math.min(shore,(z+.43)*8);
                elevation=(.35+.65*broad)*smoothstep(.7,3.3,distance)*(.5+.5*inland);
                elevation*=1-channel*.75;
            }else if(preset==='taiga'){
                const ridge=1-Math.abs(noise(warpX*3+5,warpZ*3));
                elevation=.10+broad*.36+ridge*ridge*s.mountains*.4+fine*.06;
            }else{
                const ridge=1-Math.abs(noise(warpX*4-3,warpZ*4+7));
                elevation=.1+broad*.3+ridge**(1.6+sharp)*s.mountains*.5+fine*.1;
            }
            const footprint=1-smoothstep(.44,.495,Math.hypot(u,v));
            const coastal=preset==='archipelago'||preset==='iron-islands'||preset==='fjords';
            let h=s.water+3+elevation*s.height*gain*s.areaSize;
            if(coastal){
                const dry=smoothstep(0,preset==='iron-islands'?.10:.2,shore);
                h=shore>0?s.water+3*smoothstep(0,.12,shore)+elevation*s.height*gain*s.areaSize*dry:s.water-Math.min(35*s.areaSize,3+Math.abs(shore)*30*s.areaSize);
            }
            if(s.areaSize<1||s.island||coastal)h=s.water-22*s.areaSize+(h-s.water+22*s.areaSize)*footprint;
            result[j*n+i]=h;
        }
    }
    progress(.93);
    const filtered=smoothRelief(result,s.N,preset==='desert'?.35:.45+(1-sharp)*.5);
    progress(1);return filtered;
}
