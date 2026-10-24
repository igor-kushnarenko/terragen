import {writeFile} from 'node:fs/promises';
import {editorFixture} from '../tests/fixture';
import {createCollisions,initializeRapier} from '../src/collisions';
import {initializeModelLibrary} from '../src/model-library';
import {createBalloonBody} from '../src/balloon-body';
import {createBalloonState} from '../src/balloon-state';
import {neutralTemperature,balloonPayload} from '../src/balloon-physics';
import {sampleAtmosphere} from '../src/atmosphere';
await initializeRapier();await initializeModelLibrary();
const f=editorFixture();f.model.N=f.model.state.N=128;f.terrain.buildTerrain();f.model.heights.fill(30);f.model.state.water=0;f.terrain.updateMeshAll();f.model.state.windSpeed=.2;
for(let i=0;i<1000;i++){const x=(i%32)*30-465,z=Math.floor(i/32)*30-465;if(Math.hypot(x,z)<35)continue;f.model.world.objects.push({id:'bench-'+i,asset:i%4?'pine':'rock',position:[x,30,z],rotation:[0,0,0],scale:[1,1,1],source:'manual',followTerrain:true,groundOffset:0,tint:1});}
const collisions=createCollisions(f.model,f.terrain);collisions.ensure();
const sample=()=>({level:0,dx:0,dz:0}),dt=1/120;
function measure(){const values:number[]=[];for(let i=0;i<1200;i++){const start=performance.now();collisions.stepWater(dt,sample);if(i>=240)values.push(performance.now()-start);}values.sort((a,b)=>a-b);return {meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1),steps:values.length};}
const baseline=measure(),s=createBalloonState([0,30,0],[3,30,0],47);s.started=s.seated=true;s.moored=false;s.options.assist=true;
const b=createBalloonBody(s,p=>sampleAtmosphere(f.model.state,47,...p,s.time,30),f.terrain.getH,()=>0);s.temperature=neutralTemperature(sampleAtmosphere(f.model.state,47,0,48,0,0,30),balloonPayload(s));collisions.bindDynamic(b.participant);collisions.setPassenger(true);const flight=measure();
collisions.bindDynamic(undefined);const after=collisions.colliderCount;collisions.dispose();
const result={date:new Date().toISOString(),world:{N:128,objects:f.model.world.objects.length},baseline,flight,incrementMs:flight.meanMs-baseline.meanMs,actorBodiesAfterStop:b.bodyCount,collidersAfterStop:after};await writeFile('verification/balloon-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
