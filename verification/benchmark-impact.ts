import {writeFileSync,mkdirSync} from 'node:fs';
import {editorFixture} from '../tests/fixture';
import {initializeRapier,createCollisions} from '../src/collisions';
import {applyMeteorImpact,type MeteorPlan} from '../src/meteor-impact';
import {createContactShading} from '../src/contact-shading';
import {createWaterFlow} from '../src/water-flow';
import {mulberry32} from '../src/noise';
import type {WorldObject} from '../src/world';

await initializeRapier();
const samples=[];
for(let trial=0;trial<4;trial++){
    const f=editorFixture(),random=mulberry32(431);f.model.N=f.model.state.N=512;f.terrain.buildTerrain();f.model.heights.fill(40);f.terrain.updateMeshAll();
    f.model.world.objects=Array.from({length:3000},(_,i):WorldObject=>({id:'pine-'+i,asset:'pine',source:'scatter',position:[random()*1000-500,40,random()*1000-500],rotation:[0,random()*6,0],scale:[1,1,1],followTerrain:true,groundOffset:0,tint:1}));
    f.vegetation.rebuild();const collisions=createCollisions(f.model,f.terrain),flow=createWaterFlow(f.model,f.terrain.getH),contacts=createContactShading(f.model,f.terrain,f.materials.terrainUniforms.uContactMap);collisions.ensure();flow.ensure();contacts.update();
    const times:Record<string,number>={};
    function time<T>(key:string,fn:()=>T){const start=performance.now(),value=fn();times[key]=performance.now()-start;return value;}
    const plan:MeteorPlan={seed:123,radius:12,target:[0,40,0],start:[0,200,0],duration:6};
    time('transaction',()=>f.history.transactionChanged('Удар',()=>{
        const r=time('crater',()=>applyMeteorImpact(f.model,f.terrain,plan));
        time('mesh',()=>f.terrain.updateMeshRect(...r.rect));time('range',f.terrain.recomputeRange);time('heightTexture',f.terrain.updateHeightTex);
        time('vegetation',()=>f.vegetation.refreshRegions([r.rect]));
        contacts.invalidateRegions([r.rect]);
    }));
    times.history=times.transaction-times.crater-times.mesh-times.range-times.heightTexture-times.vegetation;
    time('collisions',collisions.ensure);time('contactMap',()=>contacts.update());time('flow',flow.ensure);
    samples.push({...times,collisionRebuilds:collisions.statistics.rebuilds,terrainUpdates:collisions.statistics.terrainUpdates,contactPixels:contacts.statistics.pixels});collisions.dispose();flow.dispose();contacts.dispose();
}
mkdirSync('verification/impact-v0162',{recursive:true});
const file=process.argv[2]??'node-current.json';writeFileSync('verification/impact-v0162/'+file,JSON.stringify({grid:512,objects:3000,radius:12,samples},null,2));
console.log(JSON.stringify(samples,null,2));
