import {readFile,writeFile} from 'node:fs/promises';
import {PerspectiveCamera,Vector3} from 'three';
import {createModel,SIZE} from '../src/state';
import {generateHeightmap} from '../src/terrain-compute';
import {deriveSeeds,type Vec3} from '../src/world';
import {sampleHeight} from '../src/trail-math';
import {scatterObjects} from '../src/scatter';
import {encodeProject,decodeProject,type ProjectView} from '../src/project';
import {LANDSCAPE_PRESETS} from '../src/presets';
import {recordOperation} from '../src/operations';
import {TERRAIN_ALGORITHM} from '../src/generation-settings';

const original=JSON.parse(await readFile(new URL('../examples/natural-coast-brush.json',import.meta.url),'utf8'));
function cameraView(position:Vec3,target:Vec3):ProjectView{
    const camera=new PerspectiveCamera(55);camera.position.fromArray(position);camera.lookAt(new Vector3(...target));
    return{camera:{pos:position,target,rotation:[camera.rotation.x,camera.rotation.y,camera.rotation.z],near:.5},walk:null};
}
const overview=cameraView([-650,470,760],[0,25,0]);
// Only the comparison copy changes the camera and quality; the historical
// project's heights and objects stay intact.
original.view=overview;original.state.quality='balanced';
decodeProject(JSON.stringify(original));
await writeFile(new URL('./natural-relief-v0141/before-project.json',import.meta.url),JSON.stringify(original));
for(const kind of ['coast','mountains'] as const){
    const model=createModel();
    Object.assign(model.state,kind==='coast'?original.state:LANDSCAPE_PRESETS.mountains.settings,{seed:kind==='coast'?original.state.seed:1337,quality:'balanced',tool:'camera',fogIntensity:.15,soundEnabled:false});
    model.N=model.state.N;model.n=model.N+1;model.cell=SIZE/model.N;model.seeds=deriveSeeds(model.state.seed);
    model.heights=generateHeightmap(model.state);Object.assign(model.world.waterBodies[0],{level:model.state.water,opacity:model.state.waterOpacity,wave:model.state.wave});
    if(kind==='mountains')model.world.preset='mountains';
    const getH=(x:number,z:number)=>sampleHeight(model.heights,model.N,x,z),e=model.cell;
    const terrain={getH,getNormalY:(x:number,z:number)=>1/Math.hypot(1,(getH(x+e,z)-getH(x-e,z))/(2*e),(getH(x,z+e)-getH(x,z-e))/(2*e))};
    model.world.objects=scatterObjects(model,terrain).objects;
    const s=model.state;
    recordOperation(model,'terrain',s.seed,{N:s.N,scale:s.scale,height:s.height,octaves:s.octaves,sharp:s.sharp,warp:s.warp,mountains:s.mountains,island:s.island,areaSize:s.areaSize},TERRAIN_ALGORITHM);
    recordOperation(model,'scatter',model.seeds.scatter,{treeDensity:s.treeDensity,rockDensity:s.rockDensity},4);
    const view=kind==='coast'?overview:cameraView([-260,260,450],[0,95,0]);
    model.world.viewpoints=[{id:'relief-overview',name:kind==='coast'?'Побережье':'Горный массив',position:view.camera.pos,target:view.camera.target,fov:55,roll:0,exposure:s.exposure}];
    const text=encodeProject(model,view);decodeProject(text);
    const filename=kind==='coast'?'natural-relief.json':'natural-mountains.json';
    await writeFile(new URL('../examples/'+filename,import.meta.url),text);
    console.log(`${filename}: seed ${s.seed}, ${model.world.objects.length} models, algorithm ${TERRAIN_ALGORITHM}`);
}
