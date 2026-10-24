import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import {HALF} from './state';
import type {WorldData,WorldObject} from './world';

export function expandSelection(world:WorldData,ids:string[]) {
    const selected=new Set(ids.filter(id=>world.objects.some(o=>o.id===id)));
    for(const group of world.groups)if(group.objectIds.some(id=>selected.has(id)))group.objectIds.forEach(id=>selected.add(id));
    return [...selected];
}
export function transformedObjects(items:WorldObject[],matrix:Matrix4) {
    const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
    return items.map(item=>{
        const current=new Matrix4().compose(new Vector3(...item.position),new Quaternion().setFromEuler(new Euler(...item.rotation)),new Vector3(...item.scale));
        current.premultiply(matrix).decompose(position,rotation,scale);
        if(![...position,...rotation,...scale].every(Number.isFinite)||Math.abs(position.x)>HALF||Math.abs(position.z)>HALF||Math.abs(position.y)>60000||scale.toArray().some(v=>v<.01||v>100))throw new Error('Трансформация выходит за границы карты или допустимый масштаб 0.01–100');
        const euler=new Euler().setFromQuaternion(rotation,'XYZ');
        return {...structuredClone(item),source:'manual' as const,position:position.toArray() as WorldObject['position'],rotation:[euler.x,euler.y,euler.z] as WorldObject['rotation'],scale:scale.toArray() as WorldObject['scale'],followTerrain:false,groundOffset:0};
    });
}
