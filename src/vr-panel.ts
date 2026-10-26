import * as T from 'three';
export type VRAction='resume'|'flight'|'save'|'undo'|'exit';
/** A real scene panel: browser DOM overlays are not available on every PC runtime. */
export function createVRPanel(scene:T.Scene){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=960;
    const context=canvas.getContext('2d')!,texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const root=new T.Group();root.name='VR menu';root.visible=false;root.userData.noWaterReflection=true;scene.add(root);
    const plane=new T.Mesh(new T.PlaneGeometry(1.4,1.3125),new T.MeshBasicMaterial({map:texture,toneMapped:false,side:T.DoubleSide}));root.add(plane);
    const rows:readonly [VRAction,string][]=[['resume','Продолжить'],['flight','Включить полёт'],['save','Сохранить сейчас'],['undo','Отменить изменение'],['exit','Выйти из VR']];
    const hitMaterial=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide});
    const buttons=rows.map(([action],i)=>{const mesh=new T.Mesh(new T.PlaneGeometry(1.24,.101),hitMaterial);mesh.position.set(0,(480-(180+i*88))*1.4/1024,.003);mesh.userData.action=action;root.add(mesh);return mesh;});
    let status='Выберите объект правым курком',flying=false;
    function paint(){
        context.fillStyle='#152126';context.fillRect(0,0,1024,960);context.strokeStyle='#81b8a0';context.lineWidth=4;context.strokeRect(2,2,1020,956);
        context.fillStyle='#ecf4ed';context.font='bold 44px sans-serif';context.textAlign='center';context.fillText('GenTerrain · VR',512,72);
        context.font='26px sans-serif';context.fillStyle='#b8cecc';context.fillText('Экономный профиль · RTX 2050',512,116);
        rows.forEach(([action,label],i)=>{context.fillStyle='#304b48';context.fillRect(58,142+i*88,908,76);context.fillStyle='#fff';context.font='32px sans-serif';context.fillText(action==='flight'?(flying?'Выключить полёт':'Включить полёт'):label,512,191+i*88);});
        context.font='25px sans-serif';context.fillStyle='#d4e5dc';
        for(const [i,line]of ['Левый стик — идти · правый — поворот','Левый курок — телепорт · правый — выбор','A — прыжок / вверх · Y — вниз · B — полёт','X — меню · Grip справа — перенос модели'].entries())context.fillText(line,512,658+i*43);
        context.fillStyle='#a8e5bd';context.font='25px sans-serif';context.fillText(status.slice(0,62),512,902);texture.needsUpdate=true;
    }
    paint();
    return {root,
        update(text:string,on:boolean){if(text===status&&on===flying)return;status=text;flying=on;paint();},
        place(camera:T.Camera){const direction=camera.getWorldDirection(new T.Vector3());direction.y=0;if(direction.lengthSq()<.01)direction.set(0,0,-1);root.position.copy(camera.position).addScaledVector(direction.normalize(),1.6);root.position.y-=.12;root.lookAt(camera.position);root.visible=true;},
        hit(ray:T.Ray):{action:VRAction;distance:number}|null{if(!root.visible)return null;root.updateMatrixWorld(true);const caster=new T.Raycaster();caster.ray.copy(ray);const hit=caster.intersectObjects(buttons)[0];return hit?{action:hit.object.userData.action,distance:hit.distance}:null;},
    };
}
