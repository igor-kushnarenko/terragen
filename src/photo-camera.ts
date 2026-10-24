import * as T from 'three';
import type {SavedViewpoint} from './world';
export function applyPhotoView(camera:T.PerspectiveCamera,target:T.Vector3,view:Pick<SavedViewpoint,'position'|'target'|'fov'|'roll'>){
    camera.position.fromArray(view.position);target.fromArray(view.target);camera.up.set(0,1,0);camera.lookAt(target);camera.rotateZ(view.roll*Math.PI/180);camera.fov=view.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
/** Resize only the drawing buffer. The page layout and camera aspect remain unchanged. */
export async function capturePhotoPNG(renderer:T.WebGLRenderer,camera:T.PerspectiveCamera,scene:T.Scene,width=0,draw=()=>renderer.render(scene,camera)):Promise<Blob>{
    const size=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio(),aspect=camera.aspect;
    const limit=Math.min(4096,renderer.capabilities.maxTextureSize),w=Math.max(1,Math.round(width||size.x*ratio)),h=Math.max(1,Math.round(w/aspect));
    if(w>limit||h>limit||w*h>16_000_000)throw new Error('Размер снимка превышает возможности видеокарты');
    try{
        renderer.setPixelRatio(1);renderer.setSize(w,h,false);draw();
        return await new Promise<Blob>((resolve,reject)=>{renderer.domElement.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать PNG')),'image/png');});
    }finally{renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);camera.aspect=aspect;camera.updateProjectionMatrix();}
}
