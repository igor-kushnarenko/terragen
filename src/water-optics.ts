import * as T from 'three';
import type {RenderingSystem} from './rendering';
import type {MaterialsSystem} from './materials';
import type {WaterSurface} from './water-surface';

/** Render colour + real opaque depth before water. All surfaces share one camera-aligned capture. */
export function createWaterOptics(render:RenderingSystem,materials:MaterialsSystem,group:T.Group,surface?:WaterSurface){
    const r=render.renderer,u=materials.waterUniforms,viewport=new T.Vector2();let target:T.WebGLRenderTarget|undefined,underwater:T.WebGLRenderTarget|undefined,captures=0;
    const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1),post=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{uColor:{value:null as T.Texture|null},uDepth:{value:null as T.Texture|null},uInverseProjection:{value:new T.Matrix4()},uTint:{value:new T.Color(.015,.12,.15)},uTime:{value:0},uSubmersion:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:`varying vec2 vUv;uniform sampler2D uColor,uDepth;uniform mat4 uInverseProjection;uniform vec3 uTint;uniform float uTime,uSubmersion;
void main(){vec2 uv=clamp(vUv+vec2(sin(vUv.y*22.0+uTime*1.6),cos(vUv.x*18.0+uTime*1.3))*.0015*uSubmersion,.001,.999);float d=texture2D(uDepth,uv).r;vec4 p=uInverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);float distance=min(80.0,length(p.xyz/p.w));vec3 tr=exp(-vec3(.17,.065,.045)*distance*uSubmersion);gl_FragColor=vec4(texture2D(uColor,uv).rgb*tr+uTint*(1.0-tr),1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});const quad=new T.Mesh(new T.PlaneGeometry(2,2),post);scene.add(quad);
    function make(w:number,h:number){const t=new T.WebGLRenderTarget(w,h,{type:T.HalfFloatType,depthBuffer:true});t.depthTexture=new T.DepthTexture(w,h,T.UnsignedIntType);return t;}
    function capture(scale:number){
        if(!r)return;r.getDrawingBufferSize(viewport);u.uViewport.value.copy(viewport);u.uInverseProjection.value.copy(render.camera.projectionMatrixInverse);
        const w=Math.max(1,Math.floor(viewport.x*scale)),h=Math.max(1,Math.floor(viewport.y*scale));if(!target||target.width!==w||target.height!==h){target?.dispose();target=make(w,h);}
        const hidden:T.Object3D[]=[materials.water,group];render.scene.traverse(o=>{if(o.visible&&o.userData.noWaterReflection)hidden.push(o);});const visible=hidden.map(o=>o.visible),previous=r.getRenderTarget(),shadow=r.shadowMap.autoUpdate,xr=r.xr.enabled;
        hidden.forEach(o=>o.visible=false);
        try{r.xr.enabled=false;r.shadowMap.autoUpdate=false;r.setRenderTarget(target);r.clear();r.render(render.scene,render.camera);u.uRefraction.value=target.texture;u.uSceneDepth.value=target.depthTexture!;u.uRefractionOn.value=1;captures++;}
        finally{r.setRenderTarget(previous);r.shadowMap.autoUpdate=shadow;r.xr.enabled=xr;hidden.forEach((o,i)=>o.visible=visible[i]);}
    }
    function draw(){
        const point=render.camera.position,s=surface?.sample(point.x,point.z),depth=s?s.level-point.y:0;
        // A screen-sized, monocular postprocess cannot be drawn into the two XR
        // eye viewports. Render both eyes normally and use world-space fog below water.
        if(r.xr.isPresenting){
            const color=render.fog.color.clone(),density=render.fog.density;
            try{if(depth>.04){render.fog.color.setRGB(.015,.12,.15);render.fog.density=Math.max(density,.045);}r.render(render.scene,render.xrCamera);}
            finally{render.fog.color.copy(color);render.fog.density=density;}
            return;
        }
        if(depth<=.04){r.render(render.scene,render.camera);return;}
        r.getDrawingBufferSize(viewport);if(!underwater||underwater.width!==viewport.x||underwater.height!==viewport.y){underwater?.dispose();underwater=make(viewport.x,viewport.y);}
        const previous=r.getRenderTarget();try{r.setRenderTarget(underwater);r.clear();r.render(render.scene,render.camera);r.setRenderTarget(previous);post.uniforms.uColor.value=underwater.texture;post.uniforms.uDepth.value=underwater.depthTexture;post.uniforms.uInverseProjection.value.copy(render.camera.projectionMatrixInverse);post.uniforms.uTime.value=surface!.time;post.uniforms.uSubmersion.value=Math.min(1,depth*3);r.render(scene,camera);}finally{r.setRenderTarget(previous);}
    }
    return {capture,draw,get statistics(){return {refractions:captures,refractionSize:target?[target.width,target.height]:[0,0],underwater:!!surface&&surface.sample(render.camera.position.x,render.camera.position.z).level-render.camera.position.y>.04};},dispose(){target?.dispose();underwater?.dispose();post.dispose();quad.geometry.dispose();}};
}
