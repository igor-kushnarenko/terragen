import {mkdir,writeFile} from 'node:fs/promises';
import {PerspectiveCamera,Vector3} from 'three';
import {createModel,SIZE} from '../src/state';
import {generateHeightmap} from '../src/terrain-compute';
import {generationOctaveLimit,TERRAIN_ALGORITHM} from '../src/generation-settings';
import {encodeProject,decodeProject,type ProjectView} from '../src/project';
import {recordOperation} from '../src/operations';
import {deriveSeeds} from '../src/world';

const model=createModel();
Object.assign(model.state,{seed:1337,height:230,island:false,sharp:2.5,mountains:1,warp:0,scale:1,octaves:4,water:3,snowLine:160,quality:'balanced',tool:'camera',fog:.1,fogIntensity:.2,lowFog:0,soundEnabled:false,treeDensity:.08,rockDensity:.1});
model.seeds=deriveSeeds(model.state.seed);Object.assign(model.world.waterBodies[0],{level:3,opacity:model.state.waterOpacity,wave:model.state.wave});
const camera=new PerspectiveCamera(55);camera.position.set(-220,220,350);const target=new Vector3(0,55,0);camera.lookAt(target);
const view:ProjectView={camera:{pos:camera.position.toArray(),target:target.toArray(),rotation:[camera.rotation.x,camera.rotation.y,camera.rotation.z],near:.5},walk:null};
const metrics=[];
for(const sharp of [0,.5,1,2,2.5,3,4,5]){
    const s={...model.state,sharp},h=generateHeightmap(s),n=s.N+1,cell=SIZE/s.N,slopes:number[]=[];let min=Infinity,max=-Infinity;
    for(let j=1;j<s.N;j++)for(let i=1;i<s.N;i++){
        const k=j*n+i;min=Math.min(min,h[k]);max=Math.max(max,h[k]);slopes.push(Math.hypot((h[k+1]-h[k-1])/(2*cell),(h[k+n]-h[k-n])/(2*cell)));
    }
    slopes.sort((a,b)=>a-b);const p99Slope=slopes[Math.floor(slopes.length*.99)];
    metrics.push({sharp,min,max,range:max-min,p99Slope,p99Degrees:Math.atan(p99Slope)*180/Math.PI});
}
model.heights=generateHeightmap(model.state);const s=model.state;
recordOperation(model,'terrain',s.seed,{N:s.N,scale:s.scale,height:s.height,octaves:s.octaves,sharp:s.sharp,warp:s.warp,mountains:s.mountains,island:s.island,areaSize:s.areaSize},TERRAIN_ALGORITHM);
const text=encodeProject(model,view);decodeProject(text);
await writeFile(new URL('../examples/generation-controls.json',import.meta.url),text);
await mkdir(new URL('./generation-controls-v0142/',import.meta.url),{recursive:true});
await writeFile(new URL('./generation-controls-v0142/metrics.json',import.meta.url),JSON.stringify({algorithmVersion:TERRAIN_ALGORITHM,seed:s.seed,N:s.N,height:s.height,octaves:s.octaves,octaveLimit:generationOctaveLimit(s),metrics},null,2));
console.log(metrics);
