import * as T from 'three';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {ControlsSystem} from './controls';
import type {CollisionSystem} from './collisions';
import type {VegetationSystem} from './vegetation';
import type {WorldEdits} from './edits';
import type {HistorySystem} from './history';
import type {Feedback} from './feedback';
import type {ProjectView} from './project';
import {getModel} from './model-library';
import {createVREdges,vrStick,vrHorizontal,traceVRTeleport,vrFailure} from './vr-input';
import {createVRPanel,type VRAction} from './vr-panel';
import {VR_QUALITY_PROFILES,type VRQualityId} from './quality';
import {readVRQuality,saveVRQuality,readVRRayPitch,saveVRRayPitch,DEFAULT_VR_RAY_PITCH} from './vr-preferences';
import {createPICOController,createVRPointer,vrPointerRay} from './vr-controller';

export function createVR(model:EditorModel,render:RenderingSystem,input:ControlsSystem,collisions:CollisionSystem,vegetation:VegetationSystem,edits:WorldEdits,history:HistorySystem,feedback:Feedback,save:()=>Promise<unknown>,beforeEnter:()=>void){
    try{model.xrQuality=readVRQuality(localStorage);}catch{/* Browser storage can be disabled. */}
    let rayPitch=DEFAULT_VR_RAY_PITCH;try{rayPitch=readVRRayPitch(localStorage);}catch{/* Keep the default calibration. */}
    const {renderer,xrRig,xrCamera,camera}=render,xr=renderer.xr;
    const panel=createVRPanel(render.scene),edges=createVREdges(),head=new T.Vector3(),previousHead=new T.Vector3();
    const direction=new T.Vector3(),rotation=new T.Quaternion();
    let session:XRSession|undefined,entering=false,savedView:ProjectView|undefined,hasPose=false,tracking=false,yaw=0,selected:string|undefined;
    let aiming=false,target:T.Vector3|null=null,status='Подключите PICO Connect и запустите SteamVR',supported=false,probe=0;
    let resolutionScale:number=VR_QUALITY_PROFILES[model.xrQuality].framebufferScale;
    const qualityPending=()=>model.xrActive&&resolutionScale!==VR_QUALITY_PROFILES[model.xrQuality].framebufferScale;
    let grab:{id:string;start:T.Matrix4;object:T.Matrix4;preview:T.Matrix4}|undefined;
    const outline=new T.Box3Helper(new T.Box3(),0xa8efb9);outline.visible=false;outline.userData.noWaterReflection=true;render.scene.add(outline);
    const arcPositions=new Float32Array(56*3),arcGeometry=new T.BufferGeometry();arcGeometry.setAttribute('position',new T.BufferAttribute(arcPositions,3));
    const arc=new T.Line(arcGeometry,new T.LineBasicMaterial({color:0x81efb3}));arc.visible=false;arc.frustumCulled=false;arc.userData.noWaterReflection=true;render.scene.add(arc);
    const landing=new T.Mesh(new T.RingGeometry(.22,.32,32),new T.MeshBasicMaterial({color:0x81efb3,side:T.DoubleSide,depthWrite:false}));landing.rotation.x=-Math.PI/2;landing.visible=false;landing.userData.noWaterReflection=true;render.scene.add(landing);
    const sources:(XRInputSource|undefined)[]=[undefined,undefined];
    const hands=[0,1].map(i=>{
        const controller=xr.getController(i),grip=xr.getControllerGrip(i);xrRig.add(controller,grip);
        const pico=createPICOController(i===0?'left':'right'),pointer=createVRPointer(rayPitch);grip.add(pico.root,pointer.root);
        const modelError=(error:unknown)=>message('Не удалось загрузить модель контроллера: '+String(error));void pico.loaded.catch(modelError);
        controller.addEventListener('connected',event=>{sources[i]=event.data;void pico.setHand(event.data.handedness==='left'?'left':'right').catch(modelError);});
        controller.addEventListener('disconnected',()=>{sources[i]=undefined;edges.reset();aiming=false;target=null;grab=undefined;});
        controller.addEventListener('selectstart',()=>{
            if(!usable())return;
            if(sources[i]?.handedness==='left'){if(!panel.root.visible)aiming=true;}
            else choose(i);
        });
        controller.addEventListener('selectend',()=>{
            if(sources[i]?.handedness!=='left')return;
            if(aiming&&target&&usable()&&!panel.root.visible){input.teleportXR(target);pulse(i);}
            aiming=false;target=null;
        });
        controller.addEventListener('squeezestart',()=>{if(sources[i]?.handedness==='right')beginGrab(i);});
        controller.addEventListener('squeezeend',()=>{if(sources[i]?.handedness==='right')finishGrab();});
        return {controller,grip,pico,pointer};
    });
    function rayFor(index:number){return vrPointerRay(hands[index].pointer.root);}
    function usable(){return model.xrActive&&!!session&&session.visibilityState==='visible'&&hasPose&&tracking&&!model.busy;}
    function pulse(index:number){const actuator=sources[index]?.gamepad?.hapticActuators?.[0];if(actuator)void actuator.pulse(.25,35).catch(()=>{});}
    function message(text:string){status=text;feedback.setStatus(text);panel.update(text,input.walk.flying,model.xrQuality,qualityPending(),rayPitch);syncUI();}
    function setRayPitch(value:number){if(!Number.isFinite(value))return;rayPitch=Math.max(-70,Math.min(10,value));hands.forEach(hand=>hand.pointer.root.rotation.x=T.MathUtils.degToRad(rayPitch));try{saveVRRayPitch(localStorage,rayPitch);}catch{/* Still usable without storage. */}message('Наклон луча: '+rayPitch+'°');}
    function setQuality(value:VRQualityId){
        if(!(value in VR_QUALITY_PROFILES))return;
        model.xrQuality=value;try{saveVRQuality(localStorage,value);}catch{/* Applies for this visit even without storage. */}
        xr.setFoveation(VR_QUALITY_PROFILES[value].foveation);
        message('Качество VR: '+VR_QUALITY_PROFILES[value].name);
    }
    function menu(open:boolean){
        if(!model.xrActive)return;
        grab=undefined;aiming=false;target=null;
        if(open){panel.place(camera);input.setPaused(true);}else{panel.root.visible=false;input.setPaused(false);}
    }
    function run(action:VRAction){
        if(action==='resume')menu(false);
        if(action==='flight'){menu(false);input.toggleFlight();message(input.walk.flying?'Полёт включён: A — вверх, Y — вниз':'Гравитация включена');}
        if(action==='exit')void exit();
        if(action==='quality')setQuality(model.xrQuality==='economy'?'quality':'economy');
        if(action==='rayUp')setRayPitch(rayPitch+5);
        if(action==='rayDown')setRayPitch(rayPitch-5);
        if(action==='save')void save().then(()=>message('Мир сохранён')).catch(error=>message(String(error)));
        if(action==='undo'){history.undo();message('Последнее изменение отменено');}
    }
    function pick(index:number){const ray=rayFor(index),hit=vegetation.pick(ray),solid=collisions.teleportHit(ray,12);return hit&&hit.distance<=12&&(!solid||hit.distance<=ray.origin.distanceTo(solid.point)+.15)?hit:null;}
    function choose(index:number){
        const ui=panel.hit(rayFor(index));if(ui){run(ui.action);pulse(index);return;}
        if(panel.root.visible)return;
        const hit=pick(index);selected=hit?.id;
        const item=model.world.objects.find(o=>o.id===selected);
        message(item?getModel(item.asset).name+' · Grip справа — перенести':'Наведите правый контроллер на модель');if(item)pulse(index);
    }
    function beginGrab(index:number){
        if(!usable()||input.walk.paused||panel.root.visible)return;
        const hit=pick(index);if(!hit)return;const item=model.world.objects.find(o=>o.id===hit.id);if(!item)return;
        selected=item.id;
        if(item.source!=='manual'||item.floating||model.world.groups.some(g=>g.objectIds.includes(item.id))){message('Перенос: отдельные ручные модели без плавучести');return;}
        hands[index].grip.updateWorldMatrix(true,false);
        const object=new T.Matrix4().compose(new T.Vector3(...item.position),new T.Quaternion().setFromEuler(new T.Euler(...item.rotation)),new T.Vector3(...item.scale));
        grab={id:item.id,start:hands[index].grip.matrixWorld.clone().invert(),object,preview:object.clone()};message('Переместите контроллер; отпустите Grip для размещения');pulse(index);
    }
    function finishGrab(){
        const held=grab;grab=undefined;if(!held||!usable()||input.walk.paused)return;
        const position=new T.Vector3(),quaternion=new T.Quaternion(),scale=new T.Vector3();held.preview.decompose(position,quaternion,scale);
        if(Math.abs(position.x)>511||Math.abs(position.z)>511||Math.abs(position.y)>59999){message('Модель должна оставаться в пределах мира');return;}
        try{const euler=new T.Euler().setFromQuaternion(quaternion);edits.updateObject(held.id,{position:position.toArray(),rotation:[euler.x,euler.y,euler.z],followTerrain:false,groundOffset:0});message('Модель перемещена; отмена доступна в меню');}
        catch(error){message(error instanceof Error?error.message:String(error));}
    }
    const settings=document.createElement('div');settings.className='vr-settings';document.getElementById('cameraSettings')!.append(settings);
    const title=document.createElement('h3');title.textContent='PICO · VR через ПК';settings.append(title);
    const hint=document.createElement('p');hint.className='hint';hint.textContent='PICO Connect → SteamVR (OpenXR) → браузер на ПК.';settings.append(hint);
    const qualityLabel=document.createElement('label');qualityLabel.textContent='Качество VR ';settings.append(qualityLabel);
    const qualitySelect=document.createElement('select');qualitySelect.setAttribute('aria-label','Качество VR');qualityLabel.append(qualitySelect);
    for(const [id,profile]of Object.entries(VR_QUALITY_PROFILES)){const option=document.createElement('option');option.value=id;option.textContent=profile.name;qualitySelect.append(option);}
    qualitySelect.onchange=()=>setQuality(qualitySelect.value as VRQualityId);
    const qualityHint=document.createElement('p');qualityHint.className='hint';settings.append(qualityHint);
    const pitchLabel=document.createElement('label');pitchLabel.textContent='Наклон луча ';settings.append(pitchLabel);
    const pitchInput=document.createElement('input');pitchInput.type='range';pitchInput.min='-70';pitchInput.max='10';pitchInput.step='5';pitchInput.setAttribute('aria-label','Наклон луча VR');pitchLabel.append(pitchInput);
    const pitchOutput=document.createElement('output');pitchLabel.append(pitchOutput);pitchInput.oninput=()=>setRayPitch(Number(pitchInput.value));
    const note=document.createElement('p');note.className='hint';note.setAttribute('role','status');settings.append(note);
    const check=document.createElement('button');check.className='btn';check.textContent='Проверить подключение VR';check.onclick=()=>void detect();settings.append(check);
    const button=document.createElement('button');button.id='vrButton';button.className='workspace-button';button.type='button';button.textContent='Войти в VR';button.onclick=()=>void (model.xrActive?exit():enter());document.querySelector('.header-actions')!.prepend(button);
    const exitButton=document.createElement('button');exitButton.id='vrExit';exitButton.className='btn';exitButton.textContent='Выйти из VR';exitButton.hidden=true;exitButton.onclick=()=>void exit();document.body.append(exitButton);
    function syncUI(){button.disabled=entering||!supported||model.busy;button.textContent=entering?'Подключение VR…':model.xrActive?'Выйти из VR':'Войти в VR';button.title=status;note.textContent=status;exitButton.hidden=!model.xrActive;qualitySelect.value=model.xrQuality;pitchInput.value=String(rayPitch);pitchOutput.value=rayPitch+'°';qualityHint.textContent=qualityPending()?'Детализация уже изменена. Для смены разрешения выйдите и войдите в VR снова.':model.xrQuality==='economy'?'Экономный: масштаб XR 65%, упрощённые детали, без прямых теней.':'Качественный: масштаб XR 100%, подробные поверхности, вода, растительность и тени.';}
    async function detect(){
        const current=++probe;
        if(!window.isSecureContext){supported=false;message('WebXR требует защищённый адрес: запустите приложение через локальный dev-сервер или HTTPS.');return;}
        if(!navigator.xr){supported=false;message('Этот браузер не предоставляет WebXR. Используйте совместимый Chrome/Edge на ПК.');return;}
        try{const result=await navigator.xr.isSessionSupported('immersive-vr');if(current!==probe||model.xrActive||entering)return;supported=result;message(result?'Шлем доступен. Нажмите «Войти в VR».':'Шлем не обнаружен. Проверьте PICO Connect и OpenXR runtime SteamVR; затем повторите проверку.');}
        catch(error){if(current===probe){supported=false;message(vrFailure(error));}}
    }
    function cleanup(){
        const view=savedView;savedView=undefined;session=undefined;model.xrActive=false;entering=false;hasPose=tracking=aiming=false;target=null;grab=undefined;selected=undefined;edges.reset();
        xrRig.visible=panel.root.visible=outline.visible=arc.visible=landing.visible=false;input.setXRMode(false);document.body.classList.remove('vr-mode');
        if(view)input.restoreView(view);render.resizeViewport();message('VR завершён. Можно продолжить работу в редакторе.');
    }
    async function enter(){
        if(entering||model.xrActive||model.busy||!navigator.xr)return;
        entering=true;syncUI();let next:XRSession|undefined;
        try{
            // requestSession must run directly in the user's click activation.
            next=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor']});
            if(model.busy)throw new Error('Дождитесь завершения операции с миром.');
            beforeEnter();savedView=input.captureView();session=next;input.setXRMode(true);
            if(!input.walk.on&&input.setWalk(true)===false)throw new Error('Не найдена безопасная точка старта. Выберите её в режиме прогулки.');
            input.setPaused(false);input.clearKeys();yaw=input.walk.yaw;hasPose=tracking=false;
            model.xrActive=true;xrRig.visible=true;document.body.classList.add('vr-mode');render.controls.enabled=false;
            const profile=VR_QUALITY_PROFILES[model.xrQuality];xr.setFramebufferScaleFactor(profile.framebufferScale);xr.setFoveation(profile.foveation);resolutionScale=profile.framebufferScale;
            next.addEventListener('visibilitychange',()=>{if(session===next&&next!.visibilityState!=='visible'){menu(true);tracking=false;edges.reset();}});
            await xr.setSession(next);supported=true;message('VR: X — меню · левый стик — движение');
        }catch(error){if(next)await next.end().catch(()=>{});if(savedView||model.xrActive)cleanup();message(vrFailure(error));}
        finally{entering=false;syncUI();}
    }
    async function exit(){grab=undefined;if(session){try{await session.end();}catch(error){message(vrFailure(error));}}}
    function stop(){const previous=session;if(model.xrActive||savedView)cleanup();if(previous)void previous.end().catch(()=>{});}
    xr.addEventListener('sessionend',()=>{if(model.xrActive||savedView)cleanup();});
    navigator.xr?.addEventListener('devicechange',()=>void detect());
    window.addEventListener('focus',()=>{if(!model.xrActive&&!entering)void detect();});
    feedback.uiSync.vr=syncUI;void detect();

    function beforeFrame(frame:XRFrame|undefined){
        if(!model.xrActive||!frame||!session)return;
        const reference=xr.getReferenceSpace(),pose=reference?frame.getViewerPose(reference):null;
        if(!pose){tracking=false;input.setXRInput({forward:0,right:0,up:0});return;}
        const p=pose.transform.position;head.set(p.x,p.y,p.z);rotation.set(pose.transform.orientation.x,pose.transform.orientation.y,pose.transform.orientation.z,pose.transform.orientation.w);
        direction.set(0,0,-1).applyQuaternion(rotation);const headYaw=Math.atan2(-direction.x,-direction.z);
        if(!hasPose){yaw-=headYaw;hasPose=true;}
        if(tracking&&usable()){const delta=vrHorizontal(head.clone().sub(previousHead),yaw);if(delta.length()<1.5)input.moveXRRoomscale(delta);}
        previousHead.copy(head);tracking=session.visibilityState==='visible';
        const left=sources.find(s=>s?.handedness==='left')?.gamepad,right=sources.find(s=>s?.handedness==='right')?.gamepad;
        const buttonDown=(gamepad:Gamepad|undefined,index:number)=>!!gamepad?.buttons[index]?.pressed;
        if(!usable()){input.setXRInput({forward:0,right:0,up:0});return;}
        if(edges.pressed('menu',buttonDown(left,4)))menu(!panel.root.visible);
        if(edges.pressed('flight',buttonDown(right,5))&&!panel.root.visible)input.toggleFlight();
        if(edges.pressed('jump',buttonDown(right,4))&&!panel.root.visible&&!input.walk.flying)input.walk.jumpReq=true;
        const stick=vrStick(left),turn=vrStick(right);if(!panel.root.visible)yaw+=edges.snap(turn.x);
        input.walk.yaw=yaw+headYaw;
        input.setXRInput(panel.root.visible?{forward:0,right:0,up:0}:{forward:-stick.y*.45,right:stick.x*.45,up:input.walk.flying?(buttonDown(right,4)?1:0)-(buttonDown(left,5)?1:0):0});
        panel.update(status,input.walk.flying,model.xrQuality,qualityPending(),rayPitch);
    }
    function renderFrame(alpha=1){
        if(!model.xrActive||!hasPose)return;
        const offset=vrHorizontal(head,yaw);xrRig.position.lerpVectors(input.walk.previousFeet,input.walk.feet,alpha).sub(offset);xrRig.rotation.set(0,yaw,0);xrRig.updateMatrixWorld(true);
        xr.updateCamera(xrCamera);xrCamera.updateWorldMatrix(true,false);xrCamera.matrixWorld.decompose(camera.position,camera.quaternion,camera.scale);
        camera.projectionMatrix.copy(xr.getCamera().projectionMatrix);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld(true);
        const rightIndex=sources.findIndex(s=>s?.handedness==='right'),leftIndex=sources.findIndex(s=>s?.handedness==='left');
        if(grab&&rightIndex>=0){hands[rightIndex].grip.updateWorldMatrix(true,false);grab.preview.copy(hands[rightIndex].grip.matrixWorld).multiply(grab.start).multiply(grab.object);}
        const item=model.world.objects.find(o=>o.id===selected);outline.visible=!!item&&!panel.root.visible;
        if(item){const matrix=grab?.id===item.id?grab.preview:new T.Matrix4().compose(new T.Vector3(...item.position),new T.Quaternion().setFromEuler(new T.Euler(...item.rotation)),new T.Vector3(...item.scale));outline.box.copy(getModel(item.asset).bounds).applyMatrix4(matrix);}
        arc.visible=aiming&&leftIndex>=0&&usable()&&!panel.root.visible;landing.visible=false;
        if(arc.visible){const ray=rayFor(leftIndex),trace=traceVRTeleport(ray.origin,ray.direction,collisions.teleportHit);target=trace.target;trace.points.forEach((p,i)=>p.toArray(arcPositions,i*3));arcGeometry.attributes.position.needsUpdate=true;arcGeometry.setDrawRange(0,trace.points.length);arc.material.color.set(target?0x81efb3:0xf5a684);if(target){landing.visible=true;landing.position.copy(target);landing.position.y+=.04;}}
        else target=null;
        hands.forEach((hand,index)=>{if(!sources[index])return;hand.pico.update(sources[index]?.gamepad);const ray=rayFor(index),hit=panel.hit(ray);hand.pointer.line.scale.z=hit?.distance??8;});
    }
    return {enter,exit,stop,beforeFrame,renderFrame,detect,setQuality,setRayPitch,get rayPitch(){return rayPitch;},get quality(){return model.xrQuality;},get resolutionScale(){return resolutionScale;},get qualityPending(){return qualityPending();},
        get controllers(){return hands.map((hand,i)=>{const ray=rayFor(i);return {hand:sources[i]?.handedness,modelReady:hand.pico.ready,origin:ray.origin.toArray(),direction:ray.direction.toArray()};});},
        get active(){return model.xrActive;},get status(){return status;},get selected(){return selected;}};
}
