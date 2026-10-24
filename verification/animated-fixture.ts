import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

/** Locally authored rig used by both the importer test and the browser verification. */
export function animatedFixture(kind:'skin'|'node'|'morph'='skin'){
    const root=new T.Group(),geometry=new T.BoxGeometry(.48,1.8,.38,1,8,1);geometry.translate(0,1,0);
    const material=new T.MeshStandardMaterial({color:0xe8a44d,roughness:.65});
    const rotation=(angle:number)=>new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),angle).toArray();
    let clips:T.AnimationClip[];
    if(kind==='skin'){
        const indices:number[]=[],weights:number[]=[],p=geometry.attributes.position;
        for(let i=0;i<p.count;i++){const upper=T.MathUtils.clamp((p.getY(i)-.65)/.7,0,1);indices.push(0,1,0,0);weights.push(1-upper,upper,0,0);}
        geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
        const base=new T.Bone(),tip=new T.Bone();base.name='RootJoint';tip.name='BendJoint';tip.position.y=.9;base.add(tip);
        const skin=new T.SkinnedMesh(geometry,material);skin.name='RigMesh';skin.add(base);skin.bind(new T.Skeleton([base,tip]));root.add(skin);
        const head=new T.Mesh(new T.IcosahedronGeometry(.29,1),new T.MeshStandardMaterial({color:0x8bc3b9,roughness:.7}));head.position.y=1.05;tip.add(head);
        for(const side of [-1,1]){const arm=new T.Mesh(new T.BoxGeometry(.65,.18,.22),material);arm.position.set(side*.48,.52,0);tip.add(arm);}
        clips=[new T.AnimationClip('Покачивание',2,[new T.QuaternionKeyframeTrack('BendJoint.quaternion',[0,.5,1,1.5,2],[...rotation(0),...rotation(.65),...rotation(0),...rotation(-.65),...rotation(0)])]),
            new T.AnimationClip('Подпрыгивание',1,[new T.VectorKeyframeTrack('RootJoint.position',[0,.5,1],[0,0,0,0,.4,0,0,0,0])])];
    }else if(kind==='node'){
        const mesh=new T.Mesh(geometry,material);mesh.name='MovingMesh';root.add(mesh);clips=[new T.AnimationClip('Поворот',2,[new T.QuaternionKeyframeTrack('MovingMesh.quaternion',[0,1,2],[...rotation(0),...rotation(.65),...rotation(0)])])];
    }else{
        const delta=geometry.attributes.position.clone();for(let i=0;i<delta.count;i++)delta.setXYZ(i,0,Math.max(0,delta.getY(i)-.65)*.5,0);geometry.morphAttributes.position=[delta];geometry.morphTargetsRelative=true;
        const mesh=new T.Mesh(geometry,material);mesh.name='MorphMesh';root.add(mesh);clips=[new T.AnimationClip('Рост',2,[new T.NumberKeyframeTrack('MorphMesh.morphTargetInfluences',[0,1,2],[0,1,0])])];
    }
    root.updateMatrixWorld(true);return {root,clips};
}
export async function animatedFixtureGLB(kind:'skin'|'node'|'morph'='skin',includeClips=true){
    const {root,clips}=animatedFixture(kind),result=await new GLTFExporter().parseAsync(root,{binary:true,animations:includeClips?clips:[]});if(!(result instanceof ArrayBuffer))throw new Error('Не удалось создать контрольный GLB');return result;
}
