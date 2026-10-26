import {Vector3,Ray} from 'three';

/** xr-standard gamepads put the thumbstick after the optional touchpad. */
export function vrStick(gamepad:Pick<Gamepad,'axes'>|undefined){
    const axes=gamepad?.axes??[],offset=axes.length>=4?2:0;
    let x=Number.isFinite(axes[offset])?axes[offset]:0,y=Number.isFinite(axes[offset+1])?axes[offset+1]:0;
    const length=Math.hypot(x,y);if(length<=.18)return {x:0,y:0};
    const amount=Math.min(1,(length-.18)/.82);x=x/length*amount;y=y/length*amount;
    return {x,y};
}
export function createVREdges(){
    const previous=new Map<string,boolean>();let turning=false;
    return {
        pressed(key:string,on:boolean){const was=previous.get(key)??false;previous.set(key,on);return on&&!was;},
        snap(x:number){if(Math.abs(x)<.3)turning=false;if(turning||Math.abs(x)<.7)return 0;turning=true;return -Math.sign(x)*Math.PI/6;},
        reset(){previous.clear();turning=false;},
    };
}
/** The same rotation is used for room-scale movement and the tracking origin. */
export function vrHorizontal(local:{x:number;z:number},yaw:number){return new Vector3(local.x,0,local.z).applyAxisAngle(new Vector3(0,1,0),yaw);}

export function traceVRTeleport(origin:Vector3,direction:Vector3,cast:(ray:Ray,distance:number)=>{point:Vector3;safe:boolean}|null){
    const points=[origin.clone()],velocity=direction.clone().normalize().multiplyScalar(11),step=.06;
    let previous=origin.clone();
    for(let i=1;i<=55;i++){
        const t=i*step,next=origin.clone().addScaledVector(velocity,t);next.y-=4.9*t*t;
        const segment=next.clone().sub(previous),length=segment.length(),hit=cast(new Ray(previous,segment.normalize()),length);
        if(hit){points.push(hit.point);return {points,target:hit.safe?hit.point:null};}
        points.push(next);previous=next;
    }
    return {points,target:null};
}

export function vrFailure(error:unknown){
    const name=error instanceof Error?error.name:'';
    if(name==='NotAllowedError'||name==='SecurityError')return 'Браузер не разрешил VR. Разрешите доступ к шлему и нажмите «Войти в VR» ещё раз.';
    if(name==='NotSupportedError')return 'VR недоступен: проверьте PICO Connect, активный OpenXR runtime SteamVR и поддержку WebXR в браузере.';
    return 'Не удалось запустить VR: '+(error instanceof Error?error.message:String(error));
}
