import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {base64Binary} from './asset-format';
import {PICO_CONTROLLER_GLB} from './vr-controller-assets';
import profile from './vr-controller-profile.json';
import {DEFAULT_VR_RAY_PITCH} from './vr-preferences';

type Hand='left'|'right';
interface Response{componentProperty:'button'|'xAxis'|'yAxis';valueNodeName:string;minNodeName:string;maxNodeName:string;}
interface Component{gamepadIndices:{button?:number;xAxis?:number;yAxis?:number};visualResponses:Record<string,Response>;}
const cached=new Map<Hand,Promise<T.Group>>();
function load(hand:Hand){
    let result=cached.get(hand);
    if(!result){result=new GLTFLoader().parseAsync(base64Binary(PICO_CONTROLLER_GLB[hand]),'').then(gltf=>gltf.scene);cached.set(hand,result);result.catch(()=>cached.delete(hand));}
    return result;
}
/** The supplied profile maps controls to the model's authored min/value/max poses. */
export function bindPICOResponses(scene:T.Object3D,hand:Hand){
    const responses=Object.values(profile.layouts[hand].components as Record<string,Component>).flatMap(component=>Object.values(component.visualResponses).map(response=>({
        index:component.gamepadIndices[response.componentProperty],axis:response.componentProperty!=='button',
        value:scene.getObjectByName(response.valueNodeName),min:scene.getObjectByName(response.minNodeName),max:scene.getObjectByName(response.maxNodeName),
    })));
    return (gamepad:Pick<Gamepad,'buttons'|'axes'>|undefined)=>{
        for(const response of responses){
            if(!response.value||!response.min||!response.max||response.index===undefined)continue;
            const raw=response.axis?gamepad?.axes[response.index]??0:gamepad?.buttons[response.index]?.value??0;
            const value=Number.isFinite(raw)?Math.max(0,Math.min(1,response.axis?(raw+1)/2:raw)):0;
            response.value.position.lerpVectors(response.min.position,response.max.position,value);
            response.value.quaternion.slerpQuaternions(response.min.quaternion,response.max.quaternion,value);
        }
    };
}
export function createPICOController(initial:Hand){
    const root=new T.Group();let version=0,ready=false,update:ReturnType<typeof bindPICOResponses>=()=>{};
    async function setHand(hand:Hand){
        const current=++version,source=await load(hand);if(current!==version)return;
        const scene=source.clone(true);root.clear();root.add(scene);root.name='PICO 4 Ultra '+hand;update=bindPICOResponses(scene,hand);ready=true;
    }
    const loaded=setHand(initial);
    return {root,loaded,setHand,update(gamepad:Gamepad|undefined){update(gamepad);},get ready(){return ready;}};
}

/** Correct the handheld grip inclination; keep aiming independent of the runtime aim pose. */
export function createVRPointer(pitch=DEFAULT_VR_RAY_PITCH){
    const root=new T.Group();root.name='Controller forward pointer';root.position.set(0,.015,-.07);
    root.rotation.x=T.MathUtils.degToRad(pitch);
    const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3(0,0,-1)]),new T.LineBasicMaterial({color:0x8bdfc4,transparent:true,opacity:.8}));line.scale.z=8;root.add(line);
    return {root,line};
}
export function vrPointerRay(pointer:T.Object3D){pointer.updateWorldMatrix(true,false);return new T.Ray(new T.Vector3().setFromMatrixPosition(pointer.matrixWorld),new T.Vector3(0,0,-1).transformDirection(pointer.matrixWorld));}
