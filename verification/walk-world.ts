import { createModel, HALF, SIZE } from '../src/state';
import { createWorld, deriveSeeds, type Vec2, type WorldObject } from '../src/world';
import { encodeProject, type ProjectView } from '../src/project';
import { smoothstep } from '../src/noise';
import { paintTrails } from '../src/trail-earthworks';
import { trailCurve, RouteIndex, sampleHeight } from '../src/trail-math';
import { mulberry32 } from '../src/noise';

export const WALK_DB = 'terrain-editor-walk-check';
export const WALK_SEED = 32032;
export const WALK_POINTS: Vec2[] = [[-65,48],[-48,43],[-34,38],[-20,32],[-12,36],[12,36],[27,39],[43,36],[58,30]];
export const WALK_STOPS = [
    { name: 'Лес', point: WALK_POINTS[0] }, { name: 'Озеро', point: WALK_POINTS[3] }, { name: 'Видовая точка', point: WALK_POINTS.at(-1)! },
];
export function scenarioHeight(x:number,z:number) {
    let h = 16 + 12 * smoothstep(10,68,x) + Math.sin(x*.035)*Math.cos(z*.03)*.65;
    h -= 13*Math.exp(-((x+5)**2/700+z*z/270));
    const pad=(1-smoothstep(10,17,Math.abs(x)))*(1-smoothstep(5,11,Math.abs(z-36)));
    h += (16-h)*pad;
    const inlet=(1-smoothstep(3,7,Math.abs(x)))*(1-smoothstep(22,28,Math.abs(z-36)));
    h += (7-h)*inlet;
    return h - 28*smoothstep(150,205,Math.hypot(x,z));
}
export function createWalkWorld() {
    const model=createModel();
    Object.assign(model.state,{N:256,seed:WALK_SEED,areaSize:.4,water:4,wave:.4,quality:'low',weather:'partly',precipitation:0,fog:.15,fogIntensity:.4,lowFog:.15,wetness:.15,
        sunEl:38,sunAz:145,dayTime:11,dayCycle:false,snowLine:200,treeDensity:.1,rockDensity:.03,foliageDensity:.65,tool:'camera',windSpeed:.8});
    model.N=model.state.N;model.n=model.N+1;model.cell=SIZE/model.N;model.heights=new Float32Array(model.n**2);model.seeds=deriveSeeds(WALK_SEED);
    for(let z=0;z<model.n;z++)for(let x=0;x<model.n;x++)model.heights[z*model.n+x]=scenarioHeight(-HALF+x*model.cell,-HALF+z*model.cell);
    model.world=createWorld();
    model.world.preset='forest';
    const points=[...trailCurve(WALK_POINTS.slice(0,5),1.5),...trailCurve(WALK_POINTS.slice(4,6),1.5).slice(1),...trailCurve(WALK_POINTS.slice(5),1.5).slice(1)];
    model.world.routes=[{id:'walk-route',name:'Лес → озеро → видовая точка',kind:'trail',width:6,points,controlPoints:WALK_POINTS,curve:'centripetal',source:'manual',surface:'soil',maxGrade:.4}];
    model.world.landmarks=WALK_STOPS.map((stop,i)=>({id:'walk-place-'+i,name:stop.name,kind:i===2?'viewpoint':'glade',position:[...stop.point],radius:7}));
    model.world.biomes=[{id:'walk-forest',name:'Хвойный лес',kind:'forest',center:[-65,28],radius:100},{id:'walk-shore',name:'Береговая поляна',kind:'meadow',center:[15,0],radius:42}];
    model.world.waterBodies=[{id:'ocean',kind:'ocean',level:4,points:[],width:1,opacity:.7,wave:.4},
        {id:'walk-lake',name:'Лесное озеро',kind:'lake',level:10,width:1,opacity:.72,wave:.28,points:Array.from({length:32},(_,i)=>[-5+Math.cos(i/32*Math.PI*2)*32,Math.sin(i/32*Math.PI*2)*22] as Vec2)},
        {id:'walk-inlet',name:'Протока под мостом',kind:'river',level:10,endLevel:10,width:6,opacity:.7,wave:.15,flowSpeed:.4,flowDirection:1,points:[[0,18],[0,58]]}];
    const getH=(x:number,z:number)=>sampleHeight(model.heights,model.N,x,z), random=mulberry32(WALK_SEED), route=new RouteIndex(model.world.routes);
    const object=(id:string,asset:string,x:number,z:number,scale=1):WorldObject=>({id,asset,source:'manual',position:[x,getH(x,z),z],rotation:[0,random()*Math.PI*2,0],scale:[scale,scale,scale],followTerrain:true,groundOffset:0,tint:.9+random()*.2});
    for(let i=0;i<580;i++){
        const x=random()*230-125,z=random()*180-75;
        if(getH(x,z)<11.3||route.clearance(x,z)<3||Math.hypot(x+20,z-32)<7||Math.hypot(x-58,z-30)<8)continue;
        model.world.objects.push({...object('walk-tree-'+i,i%4===0?'birch':i%3===0?'spruce':'pine',x,z,.85+random()*.6),source:'scatter'});
    }
    for(let i=0;i<45;i++){
        const x=random()*220-115,z=random()*150-60;
        if(getH(x,z)>11&&route.clearance(x,z)>4)model.world.objects.push({...object('walk-rock-'+i,'rock',x,z,.8+random()),source:'scatter'});
    }
    model.world.objects.push({...object('walk-bridge','bridge',0,36),position:[0,16,36],followTerrain:false,rotation:[0,Math.PI/2,0]});
    model.world.objects.push({...object('probe-tree','pine',-85,58),rotation:[0,0,0],scale:[1,1,1]});
    model.world.objects.push({...object('probe-rock','boulder',-80,75),rotation:[0,0,0],scale:[1.4,1.4,1.4]});
    model.world.objects.push({...object('walk-ruins','ruins',66,21),rotation:[0,.3,0]});
    paintTrails(model,model.world.routes);
    const start=WALK_POINTS[0],y=getH(...start);
    const view:ProjectView={camera:{pos:[start[0],y+1.7,start[1]],target:[-20,10,0],rotation:[0,0,0],near:.1},walk:{on:true,feet:[start[0],y,start[1]],yaw:Math.atan2(start[0]-WALK_POINTS[1][0],start[1]-WALK_POINTS[1][1]),pitch:0,vy:0,grounded:true,swim:false,bob:0,start:[start[0],y,start[1]],autoWalking:false,saved:{pos:[-100,90,120],target:[0,16,10],near:.5}}};
    model.world.viewpoints=WALK_STOPS.map((stop,i)=>({id:'walk-photo-'+i,name:stop.name,position:[stop.point[0],getH(...stop.point)+1.7,stop.point[1]],target:i===2?[-5,10,0]:[stop.point[0]+10,getH(...stop.point),stop.point[1]-20],fov:70,roll:0,exposure:.55}));
    return {model,view,project:encodeProject(model,view)};
}
