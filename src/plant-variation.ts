import * as T from 'three';
import {mulberry32} from './noise';

export const PLANT_MORPHS=6;
export function plantHash(text:string){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;}
/** Identity, not position or frame order: moving a plant keeps its form; copying creates a new one. */
export function plantWeights(identity:string){
    const random=mulberry32(plantHash(identity+'/plant-v1')),a=Math.floor(random()*PLANT_MORPHS),b=(a+1+Math.floor(random()*(PLANT_MORPHS-1)))%PLANT_MORPHS;
    const weights=new Array<number>(PLANT_MORPHS).fill(0);weights[a]=.55+random()*.4;weights[b]=1-weights[a];return weights;
}
export interface PlantShape {height:number;minY:number;bendX:number;bendZ:number;curl:number;twist:number;width:number;phase:number;lift:number;fit:T.Vector3;}
export function plantShapes(bounds:T.Box3,species:string):PlantShape[]{
    const height=Math.max(.01,bounds.max.y-bounds.min.y),random=mulberry32(plantHash(species+'/structure-v1'));
    return Array.from({length:PLANT_MORPHS},(_,i)=>{const angle=i*Math.PI*2/PLANT_MORPHS+random()*.5;return {height,minY:bounds.min.y,bendX:Math.cos(angle)*height*(.055+random()*.045),bendZ:Math.sin(angle)*height*(.055+random()*.045),curl:(random()-.5)*height*.06,twist:(random()-.5)*.9,width:.85+random()*.28,phase:random()*Math.PI*2,lift:(random()-.5)*.08,fit:new T.Vector3(1,1,1)};});
}
/** Smooth coordinate field keeps branch joints closed and roots anchored at their authored origin. */
export function shapePlantPoint(point:T.Vector3,shape:PlantShape){
    const x=point.x,y=point.y,z=point.z,t=T.MathUtils.clamp((y-Math.max(0,shape.minY))/shape.height,0,1.2);
    if(t<=0)return fitPlantPoint(point,shape);
    const angle=Math.atan2(z,x),radial=Math.hypot(x,z)/shape.height,leaf=T.MathUtils.smoothstep(radial,.045,.2);
    const envelope=1+leaf*((shape.width-1)+.19*Math.cos(angle+shape.phase)+.10*Math.sin(2*angle+shape.phase+t*5));
    const twist=shape.twist*t,cos=Math.cos(twist),sin=Math.sin(twist),bend=t*t;
    point.set((x*cos-z*sin)*envelope+shape.bendX*bend+shape.curl*Math.sin(t*Math.PI),y+shape.lift*shape.height*leaf*Math.sin(angle+shape.phase)*t,(x*sin+z*cos)*envelope+shape.bendZ*bend);
    return fitPlantPoint(point,shape);
}
function fitPlantPoint(point:T.Vector3,shape:PlantShape){const anchor=Math.max(0,shape.minY);point.x*=shape.fit.x;point.z*=shape.fit.z;if(point.y>=anchor)point.y=anchor+(point.y-anchor)*shape.fit.y;else if(!anchor)point.y*=shape.fit.y;return point;}
type Part={geometry:T.BufferGeometry;material:T.Material|T.Material[]};
/** Six shared shape bases, reused by every instance and every quality level. */
export function plantMorphGeometry(levels:Part[][],bounds:T.Box3,species:string){
    const shapes=plantShapes(bounds,species),point=new T.Vector3();
    // A single fit across all parts and LODs preserves joints and the original placement footprint.
    for(const shape of shapes){
        const box=new T.Box3();for(const parts of levels)for(const part of parts){const p=part.geometry.attributes.position;for(let i=0;i<p.count;i++)box.expandByPoint(shapePlantPoint(point.fromBufferAttribute(p,i),shape));}
        for(const axis of ['x','y','z'] as const){let fit=1;const anchor=axis==='y'?Math.max(0,shape.minY):0;if(box.max[axis]>anchor)fit=Math.min(fit,(bounds.max[axis]-anchor)/(box.max[axis]-anchor));if(box.min[axis]<0)fit=Math.min(fit,bounds.min[axis]/box.min[axis]);shape.fit[axis]=Math.max(.01,fit);}
    }
    const result=levels.map(parts=>parts.map(part=>{
        const geometry=part.geometry.clone(),source=geometry.attributes.position;geometry.morphAttributes.position=[];geometry.morphAttributes.normal=[];
        for(const [index,shape]of shapes.entries()){
            const target=part.geometry.clone();target.morphAttributes={};const p=source.clone();for(let i=0;i<p.count;i++){shapePlantPoint(point.fromBufferAttribute(source,i),shape);p.setXYZ(i,point.x,point.y,point.z);}
            target.setAttribute('position',p);target.computeVertexNormals();p.name='plant-shape-'+index;geometry.morphAttributes.position.push(p);geometry.morphAttributes.normal.push(target.attributes.normal.clone());target.dispose();
        }
        geometry.morphTargetsRelative=false;geometry.computeBoundingBox();geometry.computeBoundingSphere();return {geometry,material:part.material};
    }));
    return {levels:result,shapes};
}
const carrier={morphTargetInfluences:[] as number[]} as T.Mesh;
export function setPlantMorph(mesh:T.InstancedMesh,index:number,identity:string){carrier.morphTargetInfluences=plantWeights(identity);mesh.setMorphAt(index,carrier);}
/** Three's stock InstancedMesh raycast does not read per-instance morph weights. */
export function enablePlantRaycast(mesh:T.InstancedMesh){
    const proxy=new T.Mesh(mesh.geometry,mesh.material),local=new T.Matrix4(),hits:T.Intersection[]=[],sphere=new T.Sphere();
    mesh.raycast=(caster,intersections)=>{
        if(!mesh.boundingSphere)mesh.computeBoundingSphere();sphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld);if(!caster.ray.intersectsSphere(sphere))return;
        for(let i=0;i<mesh.count;i++){
            mesh.getMatrixAt(i,local);proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld,local);mesh.getMorphAt(i,proxy);proxy.raycast(caster,hits);
            for(const hit of hits){hit.instanceId=i;hit.object=mesh;intersections.push(hit);}hits.length=0;
        }
    };
}
