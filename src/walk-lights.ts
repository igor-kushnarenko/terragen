import * as THREE from 'three';
import type { EditorModel } from './state';

/** Two reusable lights; changing equipment never allocates another light or shadow map. */
export function createWalkLights(model: EditorModel, scene: THREE.Scene, camera: THREE.Camera) {
    const flashlight = new THREE.SpotLight(0xf0f5ff, 520, 70, Math.PI / 7, 0.55, 2);
    const lantern = new THREE.PointLight(0xffb55b, 70, 18, 2);
    flashlight.visible = lantern.visible = false;
    flashlight.shadow.bias = lantern.shadow.bias = -0.0001;
    flashlight.shadow.normalBias = lantern.shadow.normalBias = 0.025;
    flashlight.shadow.camera.near = lantern.shadow.camera.near = 0.08;
    flashlight.shadow.camera.far = 70; lantern.shadow.camera.far = 18;
    scene.add(flashlight, flashlight.target, lantern);

    const held = new THREE.Group(), torchModel = new THREE.Group(), lampModel = new THREE.Group();
    held.userData.noWaterReflection=true;
    held.add(torchModel, lampModel); camera.add(held); if (!camera.parent) scene.add(camera);
    // The flame is centimetres from the frame. Use shaped vertex colours for the
    // held prop so its own point light cannot burn the frame to white on screen.
    const metal = new THREE.MeshBasicMaterial({ color: 0x303b43, vertexColors: true, fog: false });
    const brass = new THREE.MeshBasicMaterial({ color: 0x9e7748, vertexColors: true, fog: false });
    const lens = new THREE.MeshBasicMaterial({ color: 0xc8d8e3, fog: false });
    const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc74, fog: false });
    function part(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x=0,y=0,z=0) {
        if(material===metal || material===brass){
            const normals=geometry.getAttribute('normal'),colors=new Float32Array(normals.count*3);
            for(let i=0;i<normals.count;i++){const shade=0.65+normals.getX(i)*0.12+normals.getY(i)*0.16+normals.getZ(i)*0.08;colors.set([shade,shade,shade],i*3);}
            geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
        }
        const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); parent.add(mesh); return mesh;
    }
    const torchBody = part(torchModel, new THREE.CylinderGeometry(0.036,0.03,0.24,12), metal);
    torchBody.rotation.x = Math.PI / 2;
    const head = part(torchModel, new THREE.CylinderGeometry(0.055,0.036,0.075,12), metal,0,0,-0.145); head.rotation.x=Math.PI/2;
    const glass = part(torchModel, new THREE.CircleGeometry(0.045,16),lens,0,0,-0.184); glass.rotation.y=Math.PI;
    part(lampModel, new THREE.CylinderGeometry(0.08,0.085,0.05,16),brass,0,-0.09);
    part(lampModel, new THREE.CylinderGeometry(0.08,0.05,0.04,16),brass,0,0.1);
    for(const x of [-0.066,0.066])part(lampModel,new THREE.CylinderGeometry(0.009,0.009,0.19,8),brass,x,0);
    const handle=part(lampModel,new THREE.TorusGeometry(0.06,0.008,6,16,Math.PI),brass,0,0.13);handle.rotation.z=0;
    const flame=part(lampModel,new THREE.SphereGeometry(0.028,12,8),flameMaterial,0,-0.025);flame.scale.y=1.7;
    const forward=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(),position=new THREE.Vector3();
    let time=0;
    function shadow(light: THREE.SpotLight | THREE.PointLight, enabled: boolean, size: number) {
        light.castShadow=enabled;
        if(enabled && light.shadow.mapSize.x!==size){light.shadow.map?.dispose();light.shadow.map=null;light.shadow.mapSize.set(size,size);}
    }
    function update(dt: number, walking: boolean, paused=false) {
        if(!paused)time+=Math.max(0,dt);
        const selected=model.walkSettings.equippedLight,on=walking && selected!=='none' && model.walkSettings.lightEnabled;
        flashlight.visible=on && selected==='flashlight'; lantern.visible=on && selected==='lantern';
        held.visible=walking&&selected!=='none';torchModel.visible=selected==='flashlight';lampModel.visible=selected==='lantern';
        held.position.set(0.31,-0.3,-0.58);held.rotation.set(0.08,-0.12,-0.06);
        lens.color.setHex(on?0xf0f5ff:0x65747c);flame.visible=on;
        camera.updateMatrixWorld();camera.getWorldPosition(position);camera.getWorldDirection(forward);
        right.set(1,0,0).applyQuaternion(camera.quaternion);up.set(0,1,0).applyQuaternion(camera.quaternion);
        flashlight.position.copy(position).addScaledVector(forward,0.3).addScaledVector(right,0.18).addScaledVector(up,-0.14);
        flashlight.target.position.copy(position).addScaledVector(forward,35);
        // A waist-height flame illuminates nearby ground on every side.
        flame.getWorldPosition(lantern.position);
        lantern.intensity=70*(1+0.025*Math.sin(time*7)+0.015*Math.sin(time*13));
        const shadows=model.state.shadows && model.state.quality!=='low';
        shadow(flashlight,flashlight.visible&&shadows,model.state.quality==='high'?1024:512);
        shadow(lantern,lantern.visible&&shadows,model.state.quality==='high'?512:256);
    }
    function dispose(){held.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();});metal.dispose();brass.dispose();lens.dispose();flameMaterial.dispose();held.removeFromParent();flashlight.shadow.map?.dispose();lantern.shadow.map?.dispose();scene.remove(flashlight,flashlight.target,lantern);}
    return { flashlight, lantern, held, update, dispose };
}
