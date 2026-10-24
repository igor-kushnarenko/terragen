import {writeFile} from 'node:fs/promises';
import {editorFixture} from '../tests/fixture';
import {createWorld,deriveSeeds} from '../src/world';
import {mulberry32,smoothstep} from '../src/noise';
const f=editorFixture();Object.assign(f.model.state,{N:256,seed:16016,tool:'camera',quality:'balanced',water:16,wave:1.2,windSpeed:3,windDir:90,weather:'partly',precipitation:0,fogIntensity:.2,fog:.12,sunAz:150,sunEl:32,dayTime:10,dayCycle:false,treeDensity:.03,rockDensity:.01,foliageDensity:.4,snowLine:300,exposure:.55});
f.model.N=256;f.model.world=createWorld();f.model.seeds=deriveSeeds(16016);f.terrain.buildTerrain();
const shore=(z:number)=>25*Math.sin(z*.012)+7*Math.sin(z*.05);
for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++){const x=-512+i*f.model.cell,z=-512+j*f.model.cell,d=x-shore(z);f.model.heights[j*f.model.n+i]=16+12*Math.tanh(d/80)+smoothstep(70,250,d)*(12+6*Math.sin(z*.018));}
f.terrain.updateMeshAll();f.materials.updateWater();f.model.world.waterBodies[0].clarity=18;f.model.world.biomes=[{id:'shore',name:'Морское побережье',kind:'coast',center:[0,0],radius:440},{id:'forest',name:'Прибрежный лес',kind:'forest',center:[150,0],radius:260}];
const random=mulberry32(16016);
for(let i=0;i<260;i++){const z=random()*550-275,x=shore(z)+45+random()*170,scale=.75+random()*.65;f.model.world.objects.push({id:'coast-tree-'+i,asset:i%4?'pine':'birch',source:'scatter',position:[x,f.terrain.getH(x,z),z],rotation:[0,random()*Math.PI*2,0],scale:[scale,scale,scale],followTerrain:true,groundOffset:0,tint:.85+random()*.2});}
for(let i=0;i<24;i++){const z=random()*300-150,x=shore(z)+15+random()*40,scale=.5+random()*1.3;f.model.world.objects.push({id:'coast-rock-'+i,asset:'boulder',source:'scatter',position:[x,f.terrain.getH(x,z),z],rotation:[0,random()*6,0],scale:[scale,scale,scale],followTerrain:true,groundOffset:0,tint:1});}
f.model.walkSettings.equippedLight='none';f.model.walkSettings.lightEnabled=false;f.vegetation.rebuild();f.render.camera.position.set(38,25,50);f.render.controls.target.set(-25,16.4,5);f.render.camera.lookAt(f.render.controls.target);f.render.camera.updateMatrixWorld();
await writeFile(new URL('../examples/storm-coast.json',import.meta.url),f.storage.projectJSON());console.log('Storm coast example: gentle beach, wind 3, empty hands, 284 models');

// A separate stress world puts every impact on dry land at the largest grid.
const forest=editorFixture(),trees=mulberry32(431);Object.assign(forest.model.state,f.model.state,{N:512,seed:431,windSpeed:.7,weather:'clear',fogIntensity:.15});forest.model.N=512;forest.model.world=createWorld();forest.model.seeds=deriveSeeds(431);forest.terrain.buildTerrain();forest.model.heights.fill(40);forest.terrain.updateMeshAll();
forest.model.world.objects=Array.from({length:3000},(_,i)=>({id:'pine-'+i,asset:'pine',source:'scatter' as const,position:[trees()*1000-500,40,trees()*1000-500] as [number,number,number],rotation:[0,trees()*6,0] as [number,number,number],scale:[1,1,1] as [number,number,number],followTerrain:true,groundOffset:0,tint:1}));
forest.model.walkSettings.equippedLight='none';forest.model.walkSettings.lightEnabled=false;forest.materials.updateWater();forest.vegetation.rebuild();forest.render.camera.position.set(80,42,0);forest.render.controls.target.set(-100,40,0);forest.render.camera.lookAt(forest.render.controls.target);forest.render.camera.updateMatrixWorld();await writeFile(new URL('../examples/impact-forest.json',import.meta.url),forest.storage.projectJSON());console.log('Impact forest: 512 grid, 3000 trees, dry ground');
