import {writeFile} from 'node:fs/promises';
import {editorFixture} from '../tests/fixture';
import {carveWater} from '../src/water-compute';
import {createWaterEdits} from '../src/water-edits';
import {smoothstep} from '../src/noise';
import {decodeProject} from '../src/project';
import type {WaterBody} from '../src/world';

const f=editorFixture();Object.assign(f.model.state,{N:256,water:5,sunEl:35,sunAz:135,fog:.15,fogIntensity:.3,precipitation:0,weather:'partly',exposure:.4,treeDensity:.07,rockDensity:.025,foliageDensity:.8,snowLine:250});
f.model.N=256;f.terrain.buildTerrain();
for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++){
    const x=-512+i*f.model.cell,z=-512+j*f.model.cell;
    f.model.heights[j*f.model.n+i]=22+11*smoothstep(60,170,x)*smoothstep(0,100,-z)+Math.sin(x*.016)*Math.cos(z*.018)*1.5;
}
f.terrain.updateMeshAll();f.materials.updateWater();f.model.world.routes=[];f.model.world.biomes=[{id:'glade',name:'Береговая поляна',kind:'meadow',center:[0,30],radius:120},{id:'forest',name:'Сосновый лес',kind:'forest',center:[-150,-80],radius:130}];
const lower:WaterBody={id:'lake-low',name:'Нижнее озеро',kind:'lake',level:20,width:1,depth:5,bankWidth:12,bankSurface:'sand',opacity:.72,wave:.35,points:[[-90,-45],[-40,-75],[40,-65],[75,-20],[55,35],[-45,40]]};
const upper:WaterBody={...lower,id:'lake-high',name:'Верхнее озеро',level:30,bankSurface:'gravel',points:[[115,-165],[165,-175],[195,-140],[185,-100],[135,-95],[110,-120]]};
const river:WaterBody={...lower,id:'river-demo',name:'Лесная река',kind:'river',level:30,endLevel:20,width:14,depth:3,bankWidth:7,flowDirection:1,flowSpeed:1.2,bankSurface:'gravel',controlPoints:[[138,-99],[116,-77],[92,-60],[71,-38]],points:[[138,-99],[126,-85],[116,-77],[103,-68],[92,-60],[82,-49],[71,-38]]};
const edits=createWaterEdits(f.model,f.terrain,f.vegetation,f.materials,f.history,f.feedback,{async run(job,progress){return carveWater(job.settings,job.heights!,job.waterBodies!,progress);},cancel(){}});
for(const body of [lower,upper,river])await edits.upsert(body);
f.vegetation.scatter();
const cabin=f.edits.addObject('cabin',-54,55)!;f.edits.updateObject(cabin,{rotation:[0,.2,0]});
const pier=f.edits.addObject('pier',-32,32)!;f.edits.updateObject(pier,{position:[-32,20.1,32],followTerrain:false});
const bridge=f.edits.addObject('bridge',102,-68)!;f.edits.updateObject(bridge,{position:[102,27,-68],followTerrain:false,rotation:[0,.9,0],scale:[1,1,1.6]});
f.edits.addObject('arch',-28,65);f.edits.addObject('ruins',29,65);const cave=f.edits.addObject('cave',-120,-12)!;f.edits.updateObject(cave,{rotation:[0,-1,0]});
f.edits.groupObjects([cabin,pier],'Домик и причал');
f.render.controls.target.set(20,22,-30);f.render.camera.position.set(155,115,175);f.render.camera.lookAt(f.render.controls.target);f.render.camera.updateMatrixWorld();
const text=f.storage.projectJSON(),data=decodeProject(text);if(data.world.waterBodies.length!==4||data.world.groups.length!==1)throw new Error('Invalid demo');
await writeFile(new URL('../examples/lakes-river-buildings.json',import.meta.url),text);console.log(`Water example: ${data.world.objects.length} objects, 3 local water bodies, format ${data.version}`);
