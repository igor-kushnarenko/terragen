import {writeFile,mkdir} from 'node:fs/promises';
import {getModel,initializeModelLibrary} from '../src/model-library';
import {BUILTIN_INFO} from '../src/model-shapes';
import {modelLOD} from '../src/model-lod';
import {createSurfaceMaps} from '../src/surface-maps';
await initializeModelLibrary();
const assets=Object.fromEntries(Object.keys(BUILTIN_INFO).map(id=>[id,[0,1,2].map(level=>{
    const parts=modelLOD(id,level);return {parts:parts.length,triangles:parts.reduce((n,p)=>n+(p.geometry.index?.count??p.geometry.attributes.position.count)/3,0),bounds:getModel(id).bounds.min.toArray().concat(getModel(id).bounds.max.toArray())};
})]));
const maps=createSurfaceMaps(),bytes=maps.albedo.image.data!.byteLength+maps.detail.image.data!.byteLength;
maps.albedo.dispose();maps.detail.dispose();
await mkdir('verification/graphics-v017',{recursive:true});
await writeFile(process.argv[2]??'verification/graphics-v017/budget-after.json',JSON.stringify({assets,surfaceBytes:bytes},null,2));
