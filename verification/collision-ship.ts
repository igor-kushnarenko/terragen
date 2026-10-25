import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

/** Synthetic two-deck ship: a doorway, solid walls and many separate source meshes. */
export async function collisionShipGLB(dense=true){
    const group=new T.Group(),mat=new T.MeshStandardMaterial();
    for(const y of [0,4]){const deck=new T.Mesh(new T.PlaneGeometry(8,12,dense?235:8,dense?235:8),mat);deck.rotation.x=-Math.PI/2;deck.position.y=y;group.add(deck);}
    for(const x of [-4,4]){const wall=new T.Mesh(new T.BoxGeometry(.2,4,12),mat);wall.position.set(x,2,0);group.add(wall);}
    for(const x of [-2.5,2.5]){const wall=new T.Mesh(new T.BoxGeometry(3,4,.2),mat);wall.position.set(x,2,-6);group.add(wall);}
    for(let i=0;i<70;i++){const rail=new T.Mesh(new T.BoxGeometry(.04,.04,.04),mat);rail.position.set(3.95,1,-5+i*.14);group.add(rail);}
    return await new GLTFExporter().parseAsync(group,{binary:true}) as ArrayBuffer;
}
