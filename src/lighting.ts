import * as THREE from 'three';
import type { MaterialsSystem } from './materials';
import { smoothstep } from './noise';
import type { RenderingSystem } from './rendering';
import { type EditorModel } from './state';
import { qualityProfile } from './quality';
import type { TerrainSystem } from './terrain';
import {advanceDay,approachAngle,daylight} from './environment-math';
export function createLighting(model: EditorModel, render: RenderingSystem, materials: MaterialsSystem) {
    let envRT: THREE.WebGLRenderTarget | null = null;
    let elevation=model.state.sunEl,azimuth=model.state.sunAz,envDirty=false,envElapsed=0;
    function applySun() {
        const el = THREE.MathUtils.degToRad(elevation), az = THREE.MathUtils.degToRad(azimuth);
        render.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
        render.sky.material.uniforms.sunPosition.value.copy(render.sunDir);
        render.envSky.material.uniforms.sunPosition.value.copy(render.sunDir);
        render.sun.position.copy(render.sunDir).multiplyScalar(1800);
        render.sun.target.position.set(0, 0, 0);
        const day = smoothstep(-4, 12, elevation), warm = smoothstep(2, 35, elevation);
        const sunC = new THREE.Color().setRGB(1.0, 0.64 + 0.34 * warm, 0.44 + 0.51 * warm, THREE.SRGBColorSpace);
        render.sun.color.copy(sunC);
        render.sun.intensity = 3.5 * day;
        render.atmosBase.sunInt = render.sun.intensity;
        render.hemi.intensity = 0.10 + 0.38 * day;
        render.atmosBase.hemiInt = render.hemi.intensity;
        render.hemi.color.setRGB(.72+.04*day,.78+.04*day,.86,THREE.SRGBColorSpace);
        render.hemi.groundColor.setRGB(.40+.06*day,.36+.04*day,.29,THREE.SRGBColorSpace);
        const fogC = new THREE.Color().setRGB(0.70 + 0.12 * (1 - warm), 0.75 - 0.05 * (1 - warm), 0.79 - 0.15 * (1 - warm), THREE.SRGBColorSpace).multiplyScalar(0.12 + 0.88 * day);
        render.fog.color.copy(fogC);
        materials.waterUniforms.uFogColor.value.copy(fogC);
        materials.waterUniforms.uSkyHorizon.value.copy(fogC).multiplyScalar(1.1);
        materials.waterUniforms.uSkyZenith.value.setRGB(0.30, 0.46, 0.68, THREE.SRGBColorSpace).multiplyScalar(0.1 + 0.9 * day);
        materials.waterUniforms.uSunDir.value.copy(render.sunDir);
        materials.waterUniforms.uSunColor.value.copy(sunC).multiplyScalar(day * 1.5);
        render.atmosBase.fogColor.copy(fogC);
        render.atmosBase.skyHorizon.copy(materials.waterUniforms.uSkyHorizon.value);
        render.atmosBase.skyZenith.copy(materials.waterUniforms.uSkyZenith.value);
        render.atmosBase.sunColor.copy(materials.waterUniforms.uSunColor.value);
        envDirty=true;
    }
    function updateSun(instant=false){if(instant){elevation=model.state.sunEl;azimuth=model.state.sunAz;applySun();}else envDirty=true;}
    function setTime(hour:number){model.state.dayTime=hour;Object.assign(model.state,daylight(hour));updateSun();}
    function update(dt:number){
        if(model.state.dayCycle&&dt>0)setTime(advanceDay(model.state.dayTime,dt,model.state.dayDuration));
        if(Math.abs(elevation-model.state.sunEl)>.001||Math.abs(((azimuth-model.state.sunAz+540)%360)-180)>.001){
            elevation+=(model.state.sunEl-elevation)*(1-Math.exp(-Math.max(0,dt)*1.8));azimuth=(approachAngle(azimuth,model.state.sunAz,dt)+360)%360;applySun();
        }
        envElapsed+=dt;if(envDirty&&envElapsed>.8){envElapsed=0;envDirty=false;updateEnv();}
    }
    function updateEnv() {
        const rt = render.pmrem.fromScene(render.envScene, 0, 0.1, 1000);
        if (envRT)
            envRT.dispose();
        envRT = rt;
        render.scene.environment = rt.texture;
    }
    function updateFog() { const d = 0.00003 + model.state.fog * 0.0012; render.fog.density = d; materials.waterUniforms.uFogDensity.value = d; render.atmosBase.fogDensity = d; }
    function updateShadows() { render.sun.castShadow = model.state.shadows && qualityProfile(model).shadowSize>0; }
    const focus=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();let lastRatio=0;
    function updateView(terrain:TerrainSystem,walking:boolean) {
        const profile=qualityProfile(model),ratio=Math.min(window.devicePixelRatio||1,profile.pixelRatio);
        if(ratio!==lastRatio){render.renderer.setPixelRatio(ratio);lastRatio=ratio;}
        render.renderer.toneMappingExposure=model.state.exposure;materials.updateMaterial();updateShadows();
        const size=Math.min(profile.shadowSize,render.renderer.capabilities.maxTextureSize);
        if(size && render.sun.shadow.mapSize.x!==size) {
            render.sun.shadow.map?.dispose();render.sun.shadow.map=null;render.sun.shadow.mapSize.set(size,size);render.sun.shadow.needsUpdate=true;
        }
        focus.copy(walking?render.camera.position:render.controls.target);focus.y=terrain.getH(focus.x,focus.z)+5;
        const radius=walking?profile.shadowRadius:Math.max(profile.shadowRadius,Math.min(650,render.camera.position.distanceTo(render.controls.target)*0.65));
        const texel=2*radius/Math.max(512,size);
        right.crossVectors(render.sunDir,new THREE.Vector3(0,1,0));if(right.lengthSq()<0.01)right.set(1,0,0);right.normalize();up.crossVectors(right,render.sunDir).normalize();
        const u=focus.dot(right),v=focus.dot(up);focus.addScaledVector(right,Math.round(u/texel)*texel-u).addScaledVector(up,Math.round(v/texel)*texel-v);
        render.sun.target.position.copy(focus);render.sun.position.copy(focus).addScaledVector(render.sunDir,1800);
        const camera=render.sun.shadow.camera;camera.left=camera.bottom=-radius;camera.right=camera.top=radius;camera.near=50;camera.far=4000;camera.updateProjectionMatrix();
        render.sun.shadow.bias=-0.00004;render.sun.shadow.normalBias=Math.max(0.025,texel*0.3);render.sun.shadow.radius=2;
    }
    return { updateSun, updateEnv, updateFog, updateShadows, updateView, update, setTime, get sunElevation(){return elevation;} };
}
export type LightingSystem = ReturnType<typeof createLighting>;
