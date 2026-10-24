import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {MaterialsSystem} from './materials';
import {oceanGeometry} from './water-geometry';
import {createWaterDomain} from './water-domain';
import {createWaterOptics} from './water-optics';
import {createWaterFlow} from './water-flow';
import type {WaterSurface} from './water-surface';
import {waterBounds,waterPath} from './water-math';
import {WATER_PROFILES} from './quality';

export function createWaterRendering(model:EditorModel,render:RenderingSystem,materials:MaterialsSystem,surface?:WaterSurface,getH:(x:number,z:number)=>number=()=>0) {
    const group=new T.Group();group.name='Local water surfaces';render.scene.add(group);
    const optics=createWaterOptics(render,materials,group,surface),flow=createWaterFlow(model,getH);surface?.bindFlow(flow.sample);
    let quality=model.state.quality;
    let bodies:typeof model.world.waterBodies|undefined,reflector:Reflector|undefined,size=-1,timer=Infinity,captures=0;
    const uniforms=materials.waterUniforms,inverse=new T.Matrix4(),fallbackReflection=uniforms.uReflection.value;
    function rebuild(){
        for(const child of [...group.children]){const mesh=child as T.Mesh<T.BufferGeometry,T.ShaderMaterial>;mesh.geometry.dispose();mesh.material.uniforms.uDomainMap.value?.dispose();mesh.material.dispose();}group.clear();
        for(const [index,body] of model.world.waterBodies.entries()){if(body.kind==='ocean')continue;
            const domain=createWaterDomain(body,WATER_PROFILES[model.state.quality].spacing,model.state.quality==='low'?64:model.state.quality==='high'?128:96);
            const material=new T.ShaderMaterial({vertexShader:materials.waterMat.vertexShader,fragmentShader:materials.waterMat.fragmentShader,uniforms:{...uniforms,uBodyIndex:{value:index+1},uOpacity:{value:body.opacity},uWave:{value:body.wave},uFlowSpeed:{value:body.kind==='river'?(body.flowSpeed??.6):0},uWaterKind:{value:body.kind==='river'?2:1},uClarity:{value:body.clarity??(body.kind==='river'?3.5:8)},uFlowMap:{value:null},uFlowMapOn:{value:0},uFlowBounds:{value:new T.Vector4()}},transparent:true,depthWrite:true,side:T.DoubleSide});
            material.uniforms.uDomainMap={value:domain.texture};material.uniforms.uDomainBounds={value:domain.bounds};material.uniforms.uDomainOn={value:1};
            const mesh=new T.Mesh(domain.geometry,material);mesh.renderOrder=2;mesh.name=body.name??body.id;mesh.userData.waterBody=body;group.add(mesh);
        }
        materials.water.geometry.dispose();materials.water.geometry=oceanGeometry(WATER_PROFILES[model.state.quality].oceanSegments);
        bodies=model.world.waterBodies;quality=model.state.quality;timer=Infinity;
    }
    function update(dt:number){
        if(bodies!==model.world.waterBodies||quality!==model.state.quality)rebuild();materials.updateWater();flow.ensure();
        materials.water.position.x=render.camera.position.x;materials.water.position.z=render.camera.position.z;
        if(surface){const data=surface.upload(WATER_PROFILES[model.state.quality].impacts);uniforms.uTime.value=surface.time;uniforms.uImpacts.value=data.packed;uniforms.uImpactMeta.value=data.meta;uniforms.uImpactCount.value=data.count;}
        for(const child of group.children){const mesh=child as T.Mesh<T.BufferGeometry,T.ShaderMaterial>,body=mesh.userData.waterBody,field=flow.map(body);mesh.material.uniforms.uFlowMapOn.value=field?1:0;if(field){mesh.material.uniforms.uFlowMap.value=field.texture;mesh.material.uniforms.uFlowBounds.value.copy(field.bounds);}}
        const profile=WATER_PROFILES[model.state.quality];uniforms.uWaterDetail.value=profile.detail;uniforms.uFoamStrength.value=profile.foam;
        uniforms.uReflectionsEnabled.value=model.state.waterReflections?1:0;
        const desiredSize=model.state.waterReflections?profile.reflectionSize:0;
        if(size!==desiredSize){reflector?.dispose();reflector?.geometry.dispose();reflector=undefined;uniforms.uReflection.value=fallbackReflection;size=desiredSize;timer=Infinity;uniforms.uReflectionOn.value=0;
            if(size){reflector=new Reflector(new T.PlaneGeometry(1,1),{textureWidth:size,textureHeight:size,multisample:0,clipBias:.003});reflector.rotation.x=-Math.PI/2;uniforms.uReflection.value=reflector.getRenderTarget().texture;}}
        if(!model.busy)optics.capture(profile.refractionScale);else uniforms.uRefractionOn.value=0;
        timer+=dt;if(!reflector||model.busy||timer<profile.reflectionInterval)return;
        const camera=render.camera;camera.updateMatrixWorld();let level=model.state.water,score=Math.abs(camera.position.y-level)+80;
        for(const body of model.world.waterBodies){if(body.kind==='ocean')continue;const b=waterBounds(body),near=waterPath(body,camera.position.x,camera.position.z),distance=Math.hypot(Math.max(b.minX-camera.position.x,0,camera.position.x-b.maxX),Math.max(b.minZ-camera.position.z,0,camera.position.z-b.maxZ))+Math.abs(camera.position.y-near.level);
            if(distance<score){score=distance;level=near.level;}}
        if(camera.position.y<=level+.05){uniforms.uReflectionOn.value=0;return;}
        reflector.position.set(0,level,0);reflector.updateMatrixWorld();
        const hidden:T.Object3D[]=[materials.water,group];render.scene.traverse(o=>{if(o.userData.noWaterReflection&&o.visible)hidden.push(o);});
        const visibility=hidden.map(o=>o.visible);hidden.forEach(o=>o.visible=false);
        try{
            reflector.onBeforeRender(render.renderer,render.scene,camera,reflector.geometry,reflector.material as T.Material,group);
            uniforms.uReflectionMatrix.value.copy((reflector.material as T.ShaderMaterial).uniforms.textureMatrix.value).multiply(inverse.copy(reflector.matrixWorld).invert());
            uniforms.uReflectionLevel.value=level;uniforms.uReflectionOn.value=1;timer=0;captures++;
        }finally{hidden.forEach((o,i)=>o.visible=visibility[i]);}
    }
    return {update,group,draw:optics.draw,get statistics(){return {surfaces:group.children.length+1,reflectionSize:size,captures,...optics.statistics,impacts:surface?.impacts.length??0};},dispose(){optics.dispose();flow.dispose();for(const child of group.children){const mesh=child as T.Mesh<T.BufferGeometry,T.Material>;mesh.geometry.dispose();(mesh.material as T.ShaderMaterial).uniforms.uDomainMap.value?.dispose();mesh.material.dispose();}group.removeFromParent();reflector?.dispose();reflector?.geometry.dispose();}};
}
