import {isIronRock,makeIronModel} from './iron-models';
import * as T from 'three';
import { getModel, type ModelTemplate } from './model-library';
import {isFinePlantAsset} from './plant-geometry';
import {isNaturalAsset,makeNaturalModel} from './natural-models';
import {isWorldPlant,makeWorldPlant} from './world-models';
const cache = new WeakMap<ModelTemplate['parts'], ModelTemplate['parts'][]>();
export function modelLOD(asset: string, level: number): ModelTemplate['parts'] {
    const template = getModel(asset);
    if (!level || template.rig || template.category==='animated' || isFinePlantAsset(asset) || template.category === 'bridge' || template.category === 'wood' || template.category === 'structure') return template.parts;
    let levels = cache.get(template.parts);
    if (!levels) { levels = [template.parts,proxy(template,1),proxy(template,2)]; cache.set(template.parts,levels); }
    return levels[level];
}
function proxy(template: ModelTemplate, level: number): ModelTemplate['parts'] {
    if(isNaturalAsset(template.id)||isWorldPlant(template.id)||isIronRock(template.id)){
        const root=isIronRock(template.id)?makeIronModel(template.id,level):isWorldPlant(template.id)?makeWorldPlant(template.id,level):makeNaturalModel(template.id as import('./natural-models').NaturalAsset,level);root.updateMatrixWorld(true);
        const bounds=new T.Box3().setFromObject(root),size=bounds.getSize(new T.Vector3()),target=template.bounds.getSize(new T.Vector3());
        // Match the full model's envelope so species do not shrink, lift or change center at a threshold.
        const scale=target.divide(size),offset=template.bounds.min.clone().sub(bounds.min.clone().multiply(scale));
        const fit=new T.Matrix4().makeTranslation(...offset.toArray()).multiply(new T.Matrix4().makeScale(...scale.toArray()));
        return root.children.map(child=>{const mesh=child as T.Mesh;mesh.geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(fit,mesh.matrixWorld));return {geometry:mesh.geometry,material:mesh.material};});
    }
    const size = template.bounds.getSize(new T.Vector3()), center = template.bounds.getCenter(new T.Vector3()), parts: ModelTemplate['parts'] = [];
    const material = (color: number) => new T.MeshStandardMaterial({color,roughness:0.9});
    const add = (geometry: T.BufferGeometry, mat: T.Material, scale: T.Vector3, position: T.Vector3) => {
        geometry.scale(scale.x,scale.y,scale.z).translate(position.x,position.y,position.z); parts.push({geometry,material:mat});
    };
    if (template.category === 'tree') {
        const bark = material(template.id === 'birch' ? 0xd8d5c6 : 0x6e5033), leaf = material(template.id === 'birch' ? 0x579333 : template.id === 'oak' ? 0x3b702c : 0x2d603e);
        add(new T.CylinderGeometry(0.18,0.29,1,5),bark,new T.Vector3(1,size.y*0.65,1),new T.Vector3(0,template.bounds.min.y+size.y*0.325,0));
        if (template.id === 'pine' || template.id === 'spruce') {
            for(let i=0;i<(level===1?2:1);i++) add(new T.ConeGeometry(1,1,6),leaf,new T.Vector3(size.x*0.5*(1-i*0.28),size.y*(level===1?0.6:0.82),size.z*0.5*(1-i*0.28)),new T.Vector3(0,template.bounds.min.y+size.y*(level===1?0.42+i*0.26:0.59),0));
        } else {
            const count=level===1?3:1;
            for(let i=0;i<count;i++) add(new T.IcosahedronGeometry(1,0),leaf,new T.Vector3(size.x*(count===1?0.53:0.36),size.y*0.28,size.z*(count===1?0.53:0.36)),new T.Vector3(center.x+(i-1)*(count===1?0:size.x*0.17),template.bounds.min.y+size.y*(0.74+(i%2)*0.07),center.z));
        }
    } else {
        const source = template.parts.flatMap(part=>Array.isArray(part.material)?part.material:[part.material]).find(mat=>mat instanceof T.MeshStandardMaterial) as T.MeshStandardMaterial | undefined;
        const mat = material(template.category==='shrub'?0x3d7032:0x807d73);
        if(source && !source.map) (mat as T.MeshStandardMaterial).color.copy(source.color);
        add(new T.IcosahedronGeometry(1,0),mat,size.clone().multiplyScalar(0.54),center);
    }
    return parts;
}
