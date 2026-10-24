import {readFile,writeFile} from 'node:fs/promises';
import {editorFixture} from '../tests/fixture';
const f=editorFixture();await f.storage.loadProjectText(await readFile(new URL('../examples/lakes-river-buildings.json',import.meta.url),'utf8'));
Object.assign(f.model.state,{tool:'camera',quality:'balanced',wave:1.8,windSpeed:1.25,windDir:55,waterReflections:true,sunEl:35,dayTime:10,dayCycle:false,weather:'clear',precipitation:0,fogIntensity:.15,wetness:.12});
f.edits.replaceWorld({waterBodies:f.model.world.waterBodies.map(b=>({...b,clarity:b.kind==='river'?4:12,wave:b.kind==='ocean'?1.8:1.2}))});
for(const [i,x,z]of [[0,-22,14],[1,-12,5],[2,12,-8]]){const id=f.edits.addObject('log',x,z)!;f.edits.updateObject(id,{floating:true,followTerrain:false,density:.42+i*.08,position:[x,20.1,z],rotation:[0,i*.6,0]});}
const rock=f.edits.addObject('boulder',116,-77)!;f.edits.updateObject(rock,{followTerrain:false,position:[116,26.2,-77],scale:[1.2,1.2,1.2]});
f.render.camera.position.set(32,24.2,62);f.render.controls.target.set(-4,20,-24);f.render.camera.lookAt(f.render.controls.target);f.render.camera.updateMatrixWorld();
await writeFile(new URL('../examples/living-water.json',import.meta.url),f.storage.projectJSON());
console.log('Living water example: two lakes, river, shoreline, three buoyant logs and submerged rock');
