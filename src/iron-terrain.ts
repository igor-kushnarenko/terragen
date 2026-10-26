import {makeSimplex,fbm,mulberry32,smoothstep,clamp} from './noise';
import type {EditorState} from './state';
import type {IronSettings} from './iron-settings';
import type {WaterBody,Vec2} from './world';

/** A shared geological plan in world metres. No resolution-dependent random draws. */
export function ironGeology(s:EditorState,t:IronSettings){
    const random=mulberry32(s.seed^0x1a09b3),noise=makeSimplex(s.seed^0x519abc),extent=1024*s.areaSize,rotation=random()*Math.PI*2;
    const islands=Array.from({length:t.islandCount},(_,i)=>{
        const a=i*2.399963+rotation+(random()-.5)*.4,r=i===0?.06:(.15+.22*Math.sqrt(i/(t.islandCount-1)))*t.islandSpacing;
        const radius=(i===0?.115:.063+random()*.025)*t.islandSize;
        return {x:Math.cos(a)*r,z:Math.sin(a)*r,r:radius,angle:rotation+(random()-.5)*1.7,aspect:1.4+random()*.8,height:.7+random()*.55,phase:random()*20};
    });
    function field(x:number,z:number){
        const u=x/extent,v=z/extent;
        let shore=-1,owner=islands[0];
        for(const island of islands){
            const dx=u-island.x+noise(u*9+island.phase,v*9)*.018*t.coastalComplexity,dz=v-island.z+noise(u*9+17,v*9+island.phase)*.018*t.coastalComplexity;
            const cs=Math.cos(island.angle),sn=Math.sin(island.angle),px=(dx*cs+dz*sn)/island.aspect,pz=(-dx*sn+dz*cs);
            const edge=(noise(u*19+island.phase,v*19)*.012+noise(u*43-9,v*43)*.004)*t.coastalComplexity;
            const distance=island.r-Math.hypot(px,pz)+edge;
            if(distance>shore){shore=distance;owner=island;}
        }
        return {shore:shore*extent,island:owner,u,v};
    }
    return {field,islands,extent,noise};
}
export function createIronHeightField(s:EditorState,t:IronSettings){
    const {field,noise,extent}=ironGeology(s,t),vertical=Math.sqrt(s.areaSize)*s.height/150;
    const cliff=t.cliffHeight*vertical,depth=t.oceanDepth*Math.sqrt(s.areaSize),transition=(2+(1-t.cliffSteepness)*23)*s.areaSize;
    return (x:number,z:number)=>{
            const {shore,island,u,v}=field(x,z);
            const broad=fbm(noise,u*6+island.phase,v*6,3)*.5+.5;
            const ridge=1-Math.abs(noise(u*15+4,v*15-8));
            // Rounded terrace treads separated by narrow weathered scarps.
            const tiers=broad*3,layer=(Math.floor(tiers)+smoothstep(.76,1,tiers%1))/3;
            const plateau=(.72+layer*.2)*t.plateauFrequency+(.45+broad*.55)*(1-t.plateauFrequency);
            const peaks=clamp((ridge-.7)/.3,0,1)**2*t.rockSharpness*(1-t.plateauFrequency*.75)*.55;
            const fault=(1-smoothstep(.015,.06,Math.abs(noise(u*11-13,v*11+5))))*t.erosionStrength;
            const micro=fbm(noise,u*75,v*75,2)*.025*t.rockSharpness;
            const upper=cliff*island.height*(plateau+peaks-fault*.17+micro);
            // Walls rise directly from the sea; a rare sheltered inlet has a gravel shelf.
            const bay=smoothstep(.66,.84,broad)*(1-t.cliffSteepness)*.4;
            const wall=smoothstep(-transition*.4,transition,shore);
            let h=s.water-depth*(1-Math.exp(Math.min(0,shore)/(extent*.038)))*(1-wall)+upper*wall;
            h-=cliff*bay*(1-smoothstep(0,extent*.035,Math.max(0,shore)));
            // Exposed detached pinnacles grow outside the main islands, on the same seabed.
            const stackField=(1-smoothstep(.009,.02,Math.abs(noise(u*39+9,v*39-6))))*smoothstep(.66,.8,noise(u*23-1,v*23));
            const coastal= smoothstep(-extent*.06,-extent*.035,shore)*(1-smoothstep(-extent*.015,0,shore));
            h=Math.max(h,s.water-depth+stackField*coastal*(depth+cliff*.65));
            const edge=smoothstep(.46,.5,Math.hypot(u,v));
            h=h*(1-edge)+(s.water-depth)*edge;
            return h;
    };
}
export function generateIronTerrain(s:EditorState,t:IronSettings,progress:(p:number)=>void=()=>{}){
    const height=createIronHeightField(s,t),n=s.N+1,result=new Float32Array(n*n);
    for(let j=0;j<n;j++){if(j%8===0)progress(j/n);for(let i=0;i<n;i++)result[j*n+i]=height((i/s.N-.5)*1024,(j/s.N-.5)*1024);}
    progress(1);return result;
}

/** Shallow pools cut into sheltered plateau hollows using the existing lake/carving system. */
export function ironPuddles(s:EditorState,t:IronSettings):WaterBody[]{
    if(s.N<128)return [];
    const geology=ironGeology(s,t),height=createIronHeightField(s,t),bodies:WaterBody[]=[],radius=Math.max(4,6*Math.sqrt(s.areaSize));
    for(const island of geology.islands){
        for(let j=-2;j<=2&&bodies.length<3;j++)for(let i=-2;i<=2&&bodies.length<3;i++){
            const x=(island.x+i*.009)*geology.extent,z=(island.z+j*.009)*geology.extent,h=height(x,z);
            if(h<s.water+12*Math.sqrt(s.areaSize)||Math.hypot(x,z)>geology.extent*.42)continue;
            const ring=Array.from({length:12},(_,k)=>{const a=k/12*Math.PI*2;return [x+Math.cos(a)*radius,z+Math.sin(a)*radius*.7] as Vec2;});
            const values=ring.map(([px,pz])=>height(px,pz));if(Math.max(...values)-Math.min(...values)>1.3||Math.min(...values)<h-.5)continue;
            if(bodies.some(b=>Math.hypot(b.points[0][0]-x,b.points[0][1]-z)<50*Math.sqrt(s.areaSize)))continue;
            bodies.push({id:'iron-puddle-'+bodies.length,name:'Дождевая лужа на плато',kind:'lake',points:ring,level:h+.08,width:1,depth:.4,bankWidth:2,bankSurface:'gravel',opacity:.8,wave:.01,clarity:1.2});
        }
    }
    return bodies;
}
