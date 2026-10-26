import * as T from 'three';
import {VR_QUALITY_PROFILES,type VRQualityId} from './quality';
export type VRAction='resume'|'flight'|'quality'|'rayUp'|'rayDown'|'save'|'undo'|'exit';
/** A real scene panel: browser DOM overlays are not available on every PC runtime. */
export function createVRPanel(scene:T.Scene){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1176;
    const context=canvas.getContext('2d')!,texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const root=new T.Group();root.name='VR menu';root.visible=false;root.userData.noWaterReflection=true;scene.add(root);
    const plane=new T.Mesh(new T.PlaneGeometry(1.4,1.6078125),new T.MeshBasicMaterial({map:texture,toneMapped:false,side:T.DoubleSide}));root.add(plane);
    const rows:readonly [VRAction|'ray',string][]=[['resume','Продолжить'],['flight','Включить полёт'],['quality','Качество VR'],['ray','Луч'],['save','Сохранить сейчас'],['undo','Отменить изменение'],['exit','Выйти из VR']];
    const hitMaterial=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide});
    const buttons=rows.flatMap(([action],i)=>{
        const make=(id:VRAction,x:number,width:number)=>{const mesh=new T.Mesh(new T.PlaneGeometry(width,.101),hitMaterial);mesh.position.set(x,(588-(180+i*88))*1.4/1024,.003);mesh.userData.action=id;root.add(mesh);return mesh;};
        return action==='ray'?[make('rayDown',-.315,.59),make('rayUp',.315,.59)]:[make(action,0,1.24)];
    });
    let status='Выберите объект правым курком',flying=false,quality:VRQualityId='economy',pending=false,pitch=-40;
    function paint(){
        context.fillStyle='#152126';context.fillRect(0,0,1024,1176);context.strokeStyle='#81b8a0';context.lineWidth=4;context.strokeRect(2,2,1020,1172);
        context.fillStyle='#ecf4ed';context.font='bold 44px sans-serif';context.textAlign='center';context.fillText('GenTerrain · VR',512,72);
        const profile=VR_QUALITY_PROFILES[quality];
        context.font='26px sans-serif';context.fillStyle='#b8cecc';context.fillText(profile.name+' · XR '+Math.round(profile.framebufferScale*100)+'% · луч '+pitch+'°',512,116);
        rows.forEach(([action,label],i)=>{context.fillStyle='#304b48';context.fillRect(58,142+i*88,908,76);context.fillStyle='#fff';context.font='32px sans-serif';if(action==='ray'){context.fillText('Луч ниже',280,191+i*88);context.fillText('Луч выше',744,191+i*88);context.fillStyle='#152126';context.fillRect(502,142+i*88,20,76);}else context.fillText(action==='flight'?(flying?'Выключить полёт':'Включить полёт'):action==='quality'?'Качество: '+profile.name:label,512,191+i*88);});
        context.font='25px sans-serif';context.fillStyle='#d4e5dc';
        for(const [i,line]of ['Левый стик — идти · правый — поворот','Нажатие левого стика — бег / шаг','Левый курок — телепорт · правый — выбор','A — прыжок / вверх · Y — вниз · B — полёт','X — меню · Grip справа — перенос модели'].entries())context.fillText(line,512,822+i*41);
        context.fillStyle='#a8e5bd';context.font='25px sans-serif';context.fillText(status.slice(0,62),512,1054);
        context.fillStyle='#e4d29c';context.fillText(pending?'Для смены разрешения выйдите и войдите в VR снова':'Качество переключается кнопкой выше',512,1118);texture.needsUpdate=true;
    }
    paint();
    return {root,
        update(text:string,on:boolean,mode:VRQualityId,waiting=false,angle=-40){if(text===status&&on===flying&&mode===quality&&waiting===pending&&angle===pitch)return;status=text;flying=on;quality=mode;pending=waiting;pitch=angle;paint();},
        place(camera:T.Camera){const direction=camera.getWorldDirection(new T.Vector3());direction.y=0;if(direction.lengthSq()<.01)direction.set(0,0,-1);root.position.copy(camera.position).addScaledVector(direction.normalize(),1.6);root.position.y-=.12;root.lookAt(camera.position);root.visible=true;},
        hit(ray:T.Ray):{action:VRAction;distance:number}|null{if(!root.visible)return null;root.updateMatrixWorld(true);const caster=new T.Raycaster();caster.ray.copy(ray);const hit=caster.intersectObjects(buttons)[0];return hit?{action:hit.object.userData.action,distance:hit.distance}:null;},
    };
}
