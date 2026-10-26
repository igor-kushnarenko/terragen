import * as THREE from 'three';
import type {ControlsSystem,TerrainTool,WalkVehicle} from './controls';
import type {CollisionSystem} from './collisions';
import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {RenderingSystem} from './rendering';
import type {Feedback} from './feedback';
import type {NatureAudio} from './nature-audio';
import type {Vec3} from './world';
import {BALLOON,validateBalloon,createBalloonState,type BalloonState,type BalloonOptions,type BalloonAction} from './balloon-state';
import {sampleAtmosphere} from './atmosphere';
import {balloonPayload,neutralTemperature,releaseBallast} from './balloon-physics';
import {createBalloonBody,type BalloonBody} from './balloon-body';
import {findBalloonSite,balloonObstacles} from './balloon-site';
import {getModel} from './model-library';
import {createBalloonView} from './balloon-view';
import {waterLevelAt} from './water-math';
import {clamp} from './noise';

export function createBalloonScenario(model:EditorModel,terrain:TerrainSystem,render:RenderingSystem,input:ControlsSystem,collisions:CollisionSystem,audio:NatureAudio,feedback:Feedback,changed:()=>void,beforeLaunch:()=>void){
    let s:BalloonState|null=null,body:BalloonBody|undefined,view:ReturnType<typeof createBalloonView>|undefined,quality=model.state.quality;
    let pointerUI=false,saveTimer=0,uiTimer=0,notify=()=>{},sitePicking=false,ballastEffect=0,boundary=false,restoring=false;
    let message='Подготовьте шар на свободной сухой площадке.';
    const say=(text:string)=>{message=text;feedback.setStatus(text);notify();};
    const dirty=()=>{changed();notify();};
    const water=(x:number,z:number)=>waterLevelAt(model.state.water,model.world.waterBodies,x,z);
    const airAt=(p:Vec3,time:number)=>sampleAtmosphere(model.state,s?.seed??0,...p,time,terrain.getH(p[0],p[2]),[(terrain.getH(p[0]+4,p[2])-terrain.getH(p[0]-4,p[2]))/8,(terrain.getH(p[0],p[2]+4)-terrain.getH(p[0],p[2]-4))/8]);
    function clean(){body?.releaseKeys();collisions.bindDynamic(undefined);collisions.setPassenger(false);view?.dispose();body=undefined;view=undefined;audio.balloon(0,null);pointerUI=false;}
    function adopt(restored:boolean){
        clean();s=model.balloon;boundary=false;saveTimer=0;
        if(!s){notify();return;}
        body=createBalloonBody(s,airAt,terrain.getH,water,p=>balloonObstacles(model,terrain.getH).query(p[0],p[2],28).filter(f=>f.item&&getModel(f.item.asset).collider==='trunk'&&f.maxY>p[1]-12&&f.minY<p[1]+12).map(f=>({key:f.item!.id,position:[f.x,f.minY+(f.maxY-f.minY)*.72,f.z],half:[f.radius*.6,Math.max(.2,(f.maxY-f.minY)*.28),f.radius*.6]})));
        collisions.bindDynamic(body.participant);collisions.setPassenger(s.seated);
        if(s.seated&&!input.walk.on){const point=safeReturn(s.returnPoint);if(point)input.setWalk(true,[point[0],point[2]]);else{s.seated=false;s.moored=false;collisions.setPassenger(false);}}
        view=createBalloonView(render.scene,s,body,model.state.quality);quality=model.state.quality;
        if(restored){restoring=true;input.setPaused(true);restoring=false;say(s.seated?'Полёт восстановлен и приостановлен. Продолжите через меню.':'Шар восстановлен на месте.');}
        notify();
    }
    function safeReturn(preferred:Vec3){return input.starts.nearest(preferred[0],preferred[2])?.point??null;}
    function placePlayer(point:Vec3){input.walk.feet.fromArray(point);input.walk.start=new THREE.Vector3(...point);input.walk.vy=0;input.walk.flying=false;input.walk.grounded=true;input.walk.swim=false;input.walk.autoWalking=false;input.synchronize();}
    function stop(returnPlayer=true){
        if(!s&&!model.balloon)return;
        const old=s??model.balloon!,wasSeated=old.seated;
        clean();s=null;model.balloon=null;
        if(returnPlayer&&wasSeated){const p=safeReturn(old.returnPoint);if(p)placePlayer(p);else input.setWalk(false);}
        changed();say('Полёт завершён.');
    }
    function launch(point?:Vec3){
        if(model.busy||input.xrMode.on)return false;
        const origin=point??input.walk.feet.toArray() as Vec3,site=findBalloonSite(model,terrain.getH,origin,!!point);
        if(!site){say('Не найдена площадка: нужны сухая ровная земля и 10 м свободного пространства. Выберите место на карте.');return false;}
        beforeLaunch();stop();
        if(!input.walk.on){const p=input.starts.nearest(site[0]+3,site[2]);if(!p||!input.setWalk(true,[p.point[0],p.point[2]]))return false;}
        const back=input.walk.feet.toArray() as Vec3;
        model.balloon=createBalloonState(site,back,crypto.getRandomValues(new Uint32Array(1))[0]);s=model.balloon;
        s.temperature=neutralTemperature(airAt(s.envelope.position,0),balloonPayload(s)+BALLOON.pilotMass);
        adopt(false);input.setPaused(false);dirty();
        say(`Шар готов · ${Math.round(Math.hypot(site[0]-back[0],site[2]-back[2]))} м от вас. Подойдите к корзине и нажмите B.`);return true;
    }
    function canBoard(){
        if(!s||s.seated||!input.walk.on||!body)return false;
        const eye=input.walk.feet.clone().add(new THREE.Vector3(0,model.walkSettings.eyeHeight,0)),target=new THREE.Vector3(...s.basket.position),delta=target.clone().sub(eye),distance=delta.length();
        const direction=new THREE.Vector3(-Math.sin(input.walk.yaw),0,-Math.cos(input.walk.yaw));delta.y=0;
        return distance<4.2&&Math.hypot(...s.basket.velocity)<1&&Math.abs(s.basket.position[1]-.72-terrain.getH(s.basket.position[0],s.basket.position[2]))<1&&direction.dot(delta.normalize())> .2&&body.lineClear(eye.toArray() as Vec3,target.toArray() as Vec3);
    }
    function setPointer(open:boolean){pointerUI=open;if(open){body?.releaseKeys();if(document.pointerLockElement)document.exitPointerLock();}notify();}
    function board(){
        if(!canBoard()||!s)return false;input.setFlight(false);s.seated=true;s.started=true;input.walk.autoWalking=false;input.clearKeys();body!.invalidateMass();collisions.setPassenger(true);setPointer(true);input.setPaused(false);void audio.unlock();dirty();say('Вы в корзине. Отпустите швартовку для взлёта. U — панель пилота, Space — горелка, V — клапан.');return true;
    }
    function approach(){if(!s?.moored||s.seated)return false;const point=safeReturn([s.spawn[0]+3,s.spawn[1],s.spawn[2]]);if(!point)return false;placePlayer(point);input.walk.yaw=Math.atan2(point[0]-s.basket.position[0],point[2]-s.basket.position[2]);input.walk.pitch=-.12;input.setPaused(false);return true;}
    function exit(){
        if(!s?.seated||!body||!body.metrics.grounded||Math.hypot(...s.basket.velocity)>.8){say('Выйти можно после мягкой посадки и остановки корзины.');return false;}
        let point:Vec3|null=null;
        for(let i=0;i<16;i++){const a=i*Math.PI/8,x=s.basket.position[0]+Math.cos(a)*3,z=s.basket.position[2]+Math.sin(a)*3,p=input.starts.assess(x,z);if(p.safe&&Math.abs(p.point[1]-(s.basket.position[1]-.72))<.8&&body.lineClear([s.basket.position[0],s.basket.position[1]+1,s.basket.position[2]],[x,p.point[1]+1,z])){point=p.point;break;}}
        if(!point){say('Возле корзины нет безопасной точки выхода. Можно вернуться к старту.');return false;}
        s.seated=false;s.moored=true;s.burner=0;s.vent=0;body.releaseKeys();body.invalidateMass();collisions.setPassenger(false);setPointer(true);placePlayer(point);input.setPaused(false);dirty();say('Вы вышли. Корзина закреплена; к ней можно вернуться.');return true;
    }
    function mooring(){if(!s?.seated||!body)return false;if(!s.moored&&(!body.metrics.grounded||Math.hypot(...s.basket.velocity)>.5)){say('Закрепить аппарат можно только после остановки на земле.');return false;}s.moored=!s.moored;dirty();say(s.moored?'Швартовка закреплена.':'Швартовка отпущена. Нагрев меняет высоту постепенно.');return true;}
    function ballast(kg=5){if(!s?.seated||!body)return 0;const amount=releaseBallast(s,kg);body.invalidateMass();ballastEffect=1;dirty();return amount;}
    function anchor(action:'drop'|'raise'|'stop'){
        if(!s?.seated||!body)return false;if(action==='drop'&&!s.anchorOut)body.dropAnchor();else if(s.anchorOut)s.winch=action==='raise'?'raise':action==='stop'?'stop':'lower';dirty();return true;
    }
    function setting<K extends keyof BalloonOptions>(key:K,value:BalloonOptions[K]){
        if(!s)return;const next=structuredClone(s);next.options[key]=value;validateBalloon(next);s.options=next.options;if(key==='mode'&&value==='manual')s.options.assist=false;dirty();
    }
    function power(value:number){if(s&&Number.isFinite(value)){s.burner=clamp(value,0,1);dirty();}}
    function vent(value:number){if(s&&Number.isFinite(value)){s.vent=clamp(value,0,1);dirty();}}
    function refill(){if(!s||!body||!body.metrics.grounded||Math.hypot(s.basket.position[0]-s.spawn[0],s.basket.position[2]-s.spawn[2])>6){say('Пополнение доступно после посадки на стартовую площадку.');return false;}s.fuel=BALLOON.fuelCapacity;s.ballast=BALLOON.ballastCapacity;s.battery=BALLOON.batteryCapacity;s.damage=0;if(s.broken){s.broken=false;s.anchorOut=false;s.hooked=false;s.winch='stop';s.ropeLength=.6;}body.invalidateMass();dirty();return true;}
    function remap(action:BalloonAction,code:string){if(!s)return false;try{setting('bindings',{...s.options.bindings,[action]:code});return true;}catch{say('Эта клавиша занята или недоступна. Используйте другую.');return false;}}
    function camera(alpha:number){
        if(!s?.seated||!body||!view)return;view.update(alpha);
        const eye=new THREE.Vector3(0,1.02,0),q=view.basket.quaternion;
        if(!s.options.reduceMotion)eye.applyQuaternion(q);eye.add(view.basket.position);
        render.camera.rotation.set(input.walk.pitch,input.walk.yaw,0,'YXZ');
        if(!s.options.reduceMotion)render.camera.quaternion.premultiply(q);
        render.camera.position.copy(eye);
        if(s.options.external){const direction=new THREE.Vector3(0,0,1).applyQuaternion(render.camera.quaternion),desired=eye.clone().addScaledVector(direction,34).add(new THREE.Vector3(0,13,0));desired.y=Math.max(desired.y,terrain.getH(desired.x,desired.z)+2);const delta=desired.clone().sub(eye).normalize(),distance=body.obstacleDistance(eye.toArray() as Vec3,desired.toArray() as Vec3);if(distance<eye.distanceTo(desired))desired.copy(eye).addScaledVector(delta,Math.max(.3,distance-.7));render.camera.position.copy(desired);render.camera.lookAt(eye.clone().add(new THREE.Vector3(0,15,0)));}
        input.walk.feet.fromArray(s.basket.position);input.walk.grounded=false;input.walk.swim=false;input.walk.vy=s.basket.velocity[1];
    }
    const vehicle:WalkVehicle={get seated(){return !!s?.seated;},get pointerUI(){return !!s?.seated&&pointerUI;},lockView(){pointerUI=false;notify();},render:camera,leaveWalk(){if(!restoring)stop();},
        keyDown(e){
            if(!s||e.ctrlKey||e.metaKey||e.altKey)return false;if(!s.seated){if(e.code===s.options.bindings.board&&!e.repeat)return board();return false;}
            if(e.code==='KeyU'){if(!e.repeat)setPointer(!pointerUI);return true;}
            const action=(Object.keys(s.options.bindings) as BalloonAction[]).find(k=>s!.options.bindings[k]===e.code);
            if(action==='boost')body?.setBoost(true);else if(action==='vent')body?.setVent(true);
            else if(action==='increase')power(s.burner+.05);else if(action==='decrease')power(s.burner-.05);
            else if(!e.repeat){if(action==='board')exit();else if(action==='ballast')ballast();else if(action==='anchor')anchor(s.anchorOut?'raise':'drop');else if(action==='camera')setting('external',!s.options.external);}
            return !!action||['KeyW','KeyA','KeyS','KeyD','KeyR'].includes(e.code);
        },
        keyUp(e){if(!s)return;if(e.code===s.options.bindings.boost)body?.setBoost(false);if(e.code===s.options.bindings.vent)body?.setVent(false);},
    };input.bindVehicle(vehicle);
    const marker=new THREE.Mesh(new THREE.RingGeometry(9.5,10,40),new THREE.MeshBasicMaterial({color:0x9bd3b0,side:THREE.DoubleSide,depthTest:false}));marker.rotation.x=-Math.PI/2;marker.visible=false;render.scene.add(marker);
    const siteTool:TerrainTool={get active(){return sitePicking;},cancel(){sitePicking=false;marker.visible=false;},pointerDown(p){const point=findBalloonSite(model,terrain.getH,p.toArray() as Vec3,true);if(!point){say('Площадка занята, под водой или имеет большой уклон.');return;}siteTool.cancel();launch(point);},pointerMove(p){marker.visible=!!p;if(p){marker.position.copy(p).add(new THREE.Vector3(0,.25,0));marker.material.color.setHex(findBalloonSite(model,terrain.getH,p.toArray() as Vec3,true)?0x9bd3b0:0xdb705b);}},pointerUp(){},keyDown(e){if(e.code==='Escape'){siteTool.cancel();return true;}return false;}};
    function chooseSite(){if(model.busy)return;stop();input.setWalk(false);input.cancelPick();input.clearKeys();input.bindTerrainTool(siteTool);model.state.tool='camera';render.setLeftButton();sitePicking=true;say('Выберите сухую ровную площадку для шара. Зелёное кольцо — место свободно, Esc — отмена.');}
    const blur=()=>{body?.releaseKeys();if(s?.seated)input.setPaused(true);};window.addEventListener('blur',blur);
    return {launch,stop,board,approach,exit,mooring,ballast,anchor,power,vent,setting,refill,remap,chooseSite,setPointer,
        boost(on:boolean){body?.setBoost(on);},holdVent(on:boolean){body?.setVent(on);},
        synchronize(){if(model.balloon!==s)adopt(true);},
        update(dt:number,photo=false){
            if(model.balloon!==s)adopt(true);if(!s||!body)return;
            if(quality!==model.state.quality){view?.dispose();view=createBalloonView(render.scene,s,body,model.state.quality);quality=model.state.quality;}
            if(input.walk.paused||model.busy||photo)body.releaseKeys();
            const p=s.basket.position,speed=Math.hypot(...s.basket.velocity),limit=Math.max(Math.abs(p[0]),Math.abs(p[2]));
            if(limit+speed*2>495&&!boundary){boundary=true;input.setPaused(true);say('Впереди край карты. Полёт приостановлен; вернитесь к старту или измените ветер в редакторе.');}else if(limit+speed*2<480)boundary=false;
            if(body.metrics.boundaryHit){body.metrics.boundaryHit=false;input.setPaused(true);say('Достигнут край доступной карты. Вернитесь к старту, чтобы продолжить прогулку.');}
            if(s.seated&&!input.walk.paused&&!model.busy&&!photo){saveTimer+=dt;if(saveTimer>5){saveTimer=0;changed();}}
            ballastEffect=Math.max(0,ballastEffect-dt);uiTimer-=dt;if(uiTimer<=0){uiTimer=.15;notify();}
        },
        render(alpha:number,photo=false){if(!s||!body)return;view?.update(input.walk.paused||photo?1:alpha,ballastEffect);const relative=Math.hypot(...body.metrics.air.wind.map((v,i)=>v-s!.basket.velocity[i]));audio.balloon(input.walk.paused||photo?0:body.metrics.power,s.basket.position,s.seated?relative:undefined);},
        get state(){return s;},get active(){return !!s;},get seated(){return !!s?.seated;},get pointerUI(){return pointerUI;},get canBoard(){return !input.walk.paused&&canBoard();},get status(){return message;},
        get metrics(){return body?.metrics;},get atmosphere(){return s?[-20,0,50,150].map(d=>({height:Math.max(0,s!.envelope.position[1]+d),air:airAt([s!.envelope.position[0],Math.max(0,s!.envelope.position[1]+d),s!.envelope.position[2]],s!.time)})):[];},
        get statistics(){return {active:!!s,seated:!!s?.seated,bodies:body?.bodyCount??0,canopies:body?.canopyCount??0,drawCalls:view?.drawCalls??0,ballastEffect,...(s?{time:s.time,position:[...s.basket.position],temperature:s.temperature,fuel:s.fuel,ballast:s.ballast}:{} )};},
        bindStatus(callback:()=>void){notify=callback;notify();},
        dispose(){stop();siteTool.cancel();marker.removeFromParent();marker.geometry.dispose();marker.material.dispose();window.removeEventListener('blur',blur);},
    };
}
export type BalloonScenario=ReturnType<typeof createBalloonScenario>;

