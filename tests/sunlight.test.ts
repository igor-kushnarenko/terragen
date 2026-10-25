import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,DirectionalLight,HemisphereLight,FogExp2,Vector3,WebGLRenderTarget} from 'three';
import {Sky} from 'three/addons/objects/Sky.js';
import {directSunlight} from '../src/atmosphere-settings';
import {createLighting} from '../src/lighting';
import {createWeather} from '../src/weather';
import type {RenderingSystem} from '../src/rendering';
import {editorFixture} from './fixture';

test('direct sun fades continuously with clouds, precipitation, fog and sunset',()=>{
    assert.equal(directSunlight(45,0,0,0,0,0),1);
    for(const args of [[45,1,1,0,0,0],[45,1,1,1,0,0],[45,0,0,1,0,0],[45,0,0,0,1,0],[45,0,0,0,0,.55],[-5,0,0,0,0,0]])assert.equal(directSunlight(...args as [number,number,number,number,number,number]),0);
    let previous=1;for(let i=0;i<=100;i++){const value=directSunlight(45,i/100,0,0,0,0);assert.ok(value<=previous);previous=value;}
});

test('clear sky exposes the solar disc; rain and overcast disable direct light and solar shadows',()=>{
    const f=editorFixture(),render={...f.render,sky:new Sky(),envSky:new Sky(),sun:new DirectionalLight(),hemi:new HemisphereLight(),sunDir:new Vector3(),fog:new FogExp2(),renderer:{getPixelRatio:()=>1},pmrem:{fromScene:()=>new WebGLRenderTarget(1,1)},atmosBase:{sunInt:0,hemiInt:0,fogDensity:0,fogColor:new Color(),skyHorizon:new Color(),skyZenith:new Color(),sunColor:new Color()}} as unknown as RenderingSystem;
    Object.assign(f.model.state,{sunEl:45,sunAz:130,fog:0,fogIntensity:0,shadows:true,quality:'balanced'});
    const light=createLighting(f.model,render,f.materials);light.updateSun(true);light.updateFog();
    assert.ok(Math.abs(render.sky.material.uniforms.sunPosition.value.length()-450000)<.001);
    assert.ok(Math.abs(f.materials.waterUniforms.uSunDir.value.length()-1)<1e-8);
    const weather=createWeather(f.model,render,f.feedback,f.materials,light);
    for(const id of ['clear','rain','overcast','storm','clear']){
        weather.setWeather(id,true);weather.atmosUpdate(.1);light.updateShadows();
        const clear=id==='clear';assert.equal(render.sun.castShadow,clear);assert.equal(render.sky.material.uniforms.showSunDisc.value,clear?1:0);
        assert.equal(render.envSky.material.uniforms.showSunDisc.value,0);
        assert.equal(render.sun.intensity>0,clear);assert.ok(render.hemi.intensity>0,'diffuse daylight remains');
    }
});
