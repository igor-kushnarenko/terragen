import * as T from 'three';
import type {WaterBody} from './world';
import {waterAt,waterBounds,waterSignedDistance,waterPath} from './water-math';
export const SHORE_PADDING=24;
const cache=new WeakMap<WaterBody[],{length:number;bins:Map<string,WaterBody[]>}>();
/** Extend a local body over its dry bank for swash, without flooding lower land outside its outline. */
export function waterAtShore(water:number,bodies:WaterBody[],x:number,z:number,ground:number){
    const result=waterAt(water,bodies,x,z),cached=cache.get(bodies);let bins=cached?.length===bodies.length?cached.bins:undefined;
    if(!bins){bins=new Map();for(const b of bodies){if(b.kind==='ocean')continue;const bounds=waterBounds(b,SHORE_PADDING);for(let j=Math.floor(bounds.minZ/32);j<=Math.floor(bounds.maxZ/32);j++)for(let i=Math.floor(bounds.minX/32);i<=Math.floor(bounds.maxX/32);i++){const key=i+','+j,list=bins.get(key)??[];list.push(b);bins.set(key,list);}}cache.set(bodies,{length:bodies.length,bins});}
    for(const body of bins.get(Math.floor(x/32)+','+Math.floor(z/32))??[]){const p=waterSignedDistance(body,x,z);if(p.signed>=0||p.signed<-SHORE_PADDING||p.level<=result.level||ground<p.level-.1)continue;
        result.level=p.level;result.body=body;result.dx=body.kind==='river'?p.dx*(body.flowSpeed??.6):0;result.dz=body.kind==='river'?p.dz*(body.flowSpeed??.6):0;
    }return result;
}
export function createWaterDomain(body:WaterBody,spacing:number,resolution=96){
    const b=waterBounds(body,SHORE_PADDING),bounds=new T.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ),size=body.points.length>128?64:resolution,data=new Uint16Array(size*size);
    for(let j=0;j<size;j++)for(let i=0;i<size;i++)data[j*size+i]=T.DataUtils.toHalfFloat(waterSignedDistance(body,b.minX+(i+.5)/size*bounds.z,b.minZ+(j+.5)/size*bounds.w).signed);
    const texture=new T.DataTexture(data,size,size,T.RedFormat,T.HalfFloatType);texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
    const nx=Math.max(1,Math.min(160,Math.ceil(bounds.z/spacing))),nz=Math.max(1,Math.min(160,Math.ceil(bounds.w/spacing))),positions:number[]=[],indices:number[]=[],flow:number[]=[],travel:number[]=[];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=b.minX+i/nx*bounds.z,z=b.minZ+j/nz*bounds.w,p=body.kind==='river'?waterPath(body,x,z):null;positions.push(x,p?.level??body.level,z);flow.push(p?.dx??0,p?.dz??0);travel.push((p?.along??0)*(body.flowDirection??1));}
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,c=a+nx+1;indices.push(a,c,a+1,a+1,c,c+1);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('aFlow',new T.Float32BufferAttribute(flow,2));geometry.setAttribute('aTravel',new T.Float32BufferAttribute(travel,1));geometry.setIndex(indices);geometry.computeBoundingSphere();geometry.boundingSphere!.radius+=20;
    return {texture,bounds,geometry};
}
