import * as T from 'three';
import {getModel,type ModelTemplate} from './model-library';
import {modelLOD} from './model-lod';
import {BUILTIN_INFO} from './model-shapes';
import {isFinePlantAsset} from './plant-geometry';
import {plantMorphGeometry,plantWeights,shapePlantPoint} from './plant-variation';
import type {WorldObject} from './world';

const cache=new WeakMap<ModelTemplate['parts'],ReturnType<typeof plantMorphGeometry>>();
const boundsCache=new WeakMap<WorldObject,{source:ModelTemplate['parts'];box:T.Box3}>();
export function variedPlant(asset:string){const info=BUILTIN_INFO[asset as keyof typeof BUILTIN_INFO];return !!info&&(info.category==='tree'||info.category==='shrub');}
export const plantIdentity=(item:Pick<WorldObject,'id'|'asset'>)=>item.asset+'/'+item.id;
function variation(asset:string){
    const model=getModel(asset);let value=cache.get(model.parts);
    if(!value){value=plantMorphGeometry((isFinePlantAsset(asset)?[0]:[0,1,2]).map(level=>modelLOD(asset,level)),model.bounds,asset);cache.set(model.parts,value);}return value;
}
export function plantModelLOD(asset:string,level=0){if(!variedPlant(asset))return modelLOD(asset,level);const value=variation(asset);return value.levels[Math.min(level,value.levels.length-1)];}
export function plantObjectBounds(item:WorldObject){
    const model=getModel(item.asset);if(!variedPlant(item.asset))return model.bounds;
    const cached=boundsCache.get(item);if(cached?.source===model.parts)return cached.box;
    const box=new T.Box3(),point=new T.Vector3(),weights=plantWeights(plantIdentity(item));
    for(const part of plantModelLOD(item.asset)){const mesh=new T.Mesh(part.geometry,part.material);mesh.morphTargetInfluences=weights;for(let i=0;i<part.geometry.attributes.position.count;i++)box.expandByPoint(mesh.getVertexPosition(i,point));}
    boundsCache.set(item,{source:model.parts,box});return box;
}
/** Shared CPU shape for static trunk collision construction. */
export function plantPoint(item:WorldObject,point:T.Vector3){
    const {shapes}=variation(item.asset),weights=plantWeights(plantIdentity(item)),result=new T.Vector3();
    for(let i=0;i<weights.length;i++)if(weights[i])result.addScaledVector(shapePlantPoint(point.clone(),shapes[i]),weights[i]);return result;
}
/** One convex trunk envelope per tree; the thin crown remains traversable. */
export function plantTrunkHull(item:WorldObject){
    const size=getModel(item.asset).bounds.getSize(new T.Vector3()),radius=Math.max(.12,Math.min(size.x,size.z)*.055),vertices:number[]=[],{shapes}=variation(item.asset),weights=plantWeights(plantIdentity(item)),point=new T.Vector3(),p=new T.Vector3(),scratch=new T.Vector3();
    for(let row=0;row<=4;row++)for(let i=0;i<8;i++){
        const angle=i*Math.PI/4;point.set(Math.cos(angle)*radius,size.y*.65*row/4,Math.sin(angle)*radius);p.set(0,0,0);
        weights.forEach((w,j)=>{if(w)p.addScaledVector(shapePlantPoint(scratch.copy(point),shapes[j]),w);});
        vertices.push(p.x*item.scale[0],p.y*item.scale[1],p.z*item.scale[2]);
    }
    return Float32Array.from(vertices);
}
