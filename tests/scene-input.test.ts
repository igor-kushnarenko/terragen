import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {bindSceneClick} from '../src/scene-click';
import {configureEditorOrbit} from '../src/rendering';

class Surface extends EventTarget {
    style:Record<string,string>={};clientWidth=800;clientHeight=600;
    ownerDocument=new EventTarget();
    getRootNode(){return this.ownerDocument;}
    getBoundingClientRect(){return {left:0,top:0,right:800,bottom:600,width:800,height:600};}
}
function pointer(target:Surface,type:string,x=100,y=100,options:Record<string,unknown>={}){
    target.dispatchEvent(Object.assign(new Event(type),{clientX:x,clientY:y,pointerId:1,button:0,altKey:false,shiftKey:false,ctrlKey:false,metaKey:false,...options}));
}
test('scene clicks select, while orbit drags, modified clicks, cancelled and disabled gestures do not',()=>{
    const surface=new Surface();let enabled=true;const selected:PointerEvent[]=[];
    const dispose=bindSceneClick(surface as unknown as HTMLElement,()=>enabled,event=>selected.push(event));
    pointer(surface,'pointerdown');pointer(surface,'pointerup',102,100);assert.equal(selected.length,1);
    pointer(surface,'pointerdown',100,100,{shiftKey:true});pointer(surface,'pointerup',100,100,{shiftKey:true});assert.equal(selected.at(-1)!.shiftKey,true);
    for(const options of [{altKey:true},{ctrlKey:true},{metaKey:true},{button:2}]){pointer(surface,'pointerdown',100,100,options);pointer(surface,'pointerup',100,100,options);}
    pointer(surface,'pointerdown');pointer(surface,'pointermove',160,100);pointer(surface,'pointerup',100,100);
    pointer(surface,'pointerdown');pointer(surface,'pointercancel');pointer(surface,'pointerup');
    pointer(surface,'pointerdown');pointer(surface,'pointerup',-2,100);
    pointer(surface,'pointerdown');enabled=false;pointer(surface,'pointerup');enabled=true;
    enabled=false;pointer(surface,'pointerdown');enabled=true;pointer(surface,'pointerup');
    assert.equal(selected.length,2);dispose();pointer(surface,'pointerdown');pointer(surface,'pointerup');assert.equal(selected.length,2);
});
function zoom(distance:number,deltaY:number,deltaMode=0,x=400){
    const surface=new Surface(),camera=new PerspectiveCamera(55,800/600,.5,40000);camera.position.set(0,0,distance);
    const controls=new OrbitControls(camera,surface as unknown as HTMLElement);configureEditorOrbit(controls);controls.update();camera.updateMatrixWorld();
    surface.dispatchEvent(Object.assign(new Event('wheel',{cancelable:true}),{deltaY,deltaMode,clientX:x,clientY:300,ctrlKey:false}));
    const result={distance:camera.position.distanceTo(controls.target),position:camera.position.clone()};controls.dispose();return result;
}
test('wheel zoom remains responsive up close, follows the cursor, and normalizes wheel units',()=>{
    for(const distance of [2,10,1000]){
        const next=zoom(distance,-100);assert.ok(next.distance<distance*.88&&next.distance>distance*.8);
        assert.ok(zoom(distance,100).distance>distance*1.12);
    }
    assert.ok(zoom(2,-100).position.distanceTo(new Vector3(0,0,2))>.2,'close zoom must not stop at the old 5m limit');
    assert.ok(zoom(20,-100,0,650).position.x>0,'zoom must move towards the cursor');
    assert.ok(Math.abs(zoom(100,-48).distance-zoom(100,-3,1).distance)<1e-8);
    assert.ok(Math.abs(zoom(100,-100).distance-zoom(100,-1,2).distance)<1e-8);
    assert.ok(zoom(1,-10000).distance>=.75-1e-8,'zoom must keep its minimum distance');
});
