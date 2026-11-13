import * as THREE from 'three';
import type {EditorModel} from './state';
import {qualityProfile} from './quality';

/** A single head-mounted beam: no inventory, held props, or omnidirectional light. */
export function createWalkLights(model:EditorModel,scene:THREE.Scene,camera:THREE.Camera){
    const flashlight=new THREE.SpotLight(0xf0f5ff,520,70,Math.PI/7,.55,2);
    flashlight.visible=false;
    flashlight.shadow.bias=-.0001;flashlight.shadow.normalBias=.025;
    flashlight.shadow.camera.near=.08;flashlight.shadow.camera.far=70;
    scene.add(flashlight,flashlight.target);
    const position=new THREE.Vector3(),forward=new THREE.Vector3();
    function update(_dt:number,walking:boolean,_paused=false){
        flashlight.visible=walking&&model.walkSettings.lightEnabled;
        camera.updateMatrixWorld();camera.getWorldPosition(position);camera.getWorldDirection(forward);
        flashlight.position.copy(position).addScaledVector(forward,.15);
        flashlight.target.position.copy(position).addScaledVector(forward,35);
        flashlight.target.updateMatrixWorld();
        flashlight.castShadow=flashlight.visible&&model.state.shadows&&qualityProfile(model).shadowSize>0;
        if(flashlight.castShadow&&flashlight.shadow.mapSize.x!==512){flashlight.shadow.map?.dispose();flashlight.shadow.map=null;flashlight.shadow.mapSize.set(512,512);}
    }
    return {flashlight,update,dispose(){flashlight.shadow.map?.dispose();scene.remove(flashlight,flashlight.target);}};
}
