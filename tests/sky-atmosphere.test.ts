import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Ray,Scene,Sphere,Vector3} from 'three';
import {Sky} from 'three/addons/objects/Sky.js';
import {ATMOSPHERE_RADIUS,CLOUD_ALTITUDE,cloudLayerDistance,skyFogAmount,weatherStrengths} from '../src/atmosphere-settings';
import {createSkyAtmosphere} from '../src/sky-atmosphere';

test('ordinary fog hides the horizon while leaving more sky visible overhead; zero really disables it',()=>{
    for(const weatherFog of [.0008,.0018,.0025,.0032]){
        const density=weatherStrengths(.000174,weatherFog,0,0,1,1).fog;
        assert.ok(skyFogAmount(density,0)>.99999);
        assert.ok(skyFogAmount(density,.1)>skyFogAmount(density,.5));
        assert.ok(skyFogAmount(density,.5)>skyFogAmount(density,1));
        assert.ok(skyFogAmount(density,1)<.2);
    }
    for(const y of [-1,0,.001,.05,.5,1]){
        assert.equal(skyFogAmount(0,y),0);
        assert.equal(skyFogAmount(.55,y),1);
        let previous=0;
        for(let i=0;i<=100;i++){const amount=skyFogAmount(.004*i/100,y);assert.ok(Number.isFinite(amount)&&amount>=previous&&amount<=1);previous=amount;}
    }
});

test('cloud layer has no missing rays at the former plane edge or the horizon',()=>{
    const height=19,formerEdge=Math.atan((CLOUD_ALTITUDE-height)/13000);
    let previous:number|undefined;
    for(let i=0;i<=200;i++){
        const angle=formerEdge+.01-i*.0001,distance=cloudLayerDistance(height,Math.sin(angle));
        assert.ok(distance!==null&&distance>0);
        if(previous!==undefined)assert.ok(Math.abs(distance-previous)<50);
        previous=distance;
    }
    for(const y of [-.001,0,.001])assert.ok(cloudLayerDistance(height,y)!>13000);
    assert.ok(Math.abs(cloudLayerDistance(height,1)!-(CLOUD_ALTITUDE-height))<1e-9);
});

test('cloud intersections agree with geometric ray casting below and above the layer',()=>{
    const shell=new Sphere(new Vector3(0,-ATMOSPHERE_RADIUS,0),ATMOSPHERE_RADIUS+CLOUD_ALTITUDE);
    for(const height of [0,19,100,749,751,1500,6000])for(const y of [-1,-.1,-.01,0,.01,.1,1]){
        const origin=new Vector3(0,height,0),direction=new Vector3(Math.sqrt(1-y*y),y,0);
        const point=new Ray(origin,direction).intersectSphere(shell,new Vector3()),distance=cloudLayerDistance(height,y);
        if(point)assert.ok(distance!==null&&Math.abs(point.distanceTo(origin)-distance)<.00001);
        else assert.equal(distance,null);
    }
    assert.equal(cloudLayerDistance(1500,1),null);
    assert.ok(Math.abs(cloudLayerDistance(1500,-1)!-750)<1e-8);
});

test('sky and environment share weather and disable the extra addon cloud layer',()=>{
    const render={sky:new Sky(),envSky:new Sky(),sunDir:new Vector3(0,1,0),camera:new PerspectiveCamera(),scene:new Scene()};
    const {uniforms,clouds}=createSkyAtmosphere(render);uniforms.uFogDensity.value=.003;uniforms.uCover.value=1;
    for(const sky of [render.sky,render.envSky]){
        assert.equal(sky.material.uniforms.uFogDensity.value,.003);
        assert.equal(sky.material.uniforms.uCover.value,1);
        assert.equal(sky.material.uniforms.cloudCoverage.value,0);
        assert.equal(sky.frustumCulled,false);
        sky.geometry.dispose();sky.material.dispose();
    }
    assert.equal(render.envSky.material.uniforms.uObserverOffset.value,render.camera.position);
    assert.equal(render.sky.material.uniforms.uObserverOffset.value.length(),0);
    assert.equal(clouds.visible,false);assert.equal(clouds.material.depthWrite,false);clouds.geometry.dispose();clouds.material.dispose();
});
