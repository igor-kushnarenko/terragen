import {readFile,writeFile} from 'node:fs/promises';
import {editorFixture} from '../tests/fixture';
import {daylight} from '../src/environment-math';
import {decodeProject} from '../src/project';
const f=editorFixture();await f.storage.loadProjectText(await readFile(new URL('../examples/lakes-river-buildings.json',import.meta.url),'utf8'));
Object.assign(f.model.state,{...daylight(7.25),dayTime:7.25,dayCycle:false,dayDuration:20,wetness:.6,lowFog:1.2,fogIntensity:.6,precipitation:0,weather:'partly',windSpeed:1.4,exposure:.6});
f.edits.replaceWorld({viewpoints:[
    {id:'photo-cabin',name:'Домик у озера',position:[-38,30,75],target:[-42,21,25],fov:58,roll:0,exposure:.6},
    {id:'photo-river',name:'Река между озёрами',position:[140,70,40],target:[105,25,-72],fov:55,roll:0,exposure:.6},
    {id:'photo-cave',name:'Скальная пещера',position:[-100,26,0],target:[-120,23,-12],fov:55,roll:0,exposure:.6},
]});
f.render.camera.position.set(-38,30,75);f.render.controls.target.set(-42,21,25);f.render.camera.lookAt(f.render.controls.target);f.render.camera.updateMatrixWorld();
const text=f.storage.projectJSON(),decoded=decodeProject(text);if(decoded.version!==8||decoded.world.viewpoints.length!==3)throw new Error('Invalid photo example');
await writeFile(new URL('../examples/weather-photo.json',import.meta.url),text);console.log('Weather/photo example: format 8, three viewpoints');
