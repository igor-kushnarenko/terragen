import * as T from 'three';
export const FOG_MAP_SIZE=64;
export function createEnvironmentMaterials(){
    const fogData=new Float32Array(FOG_MAP_SIZE**2*2),packed=new Uint16Array(fogData.length),fogMap=new T.DataTexture(packed,FOG_MAP_SIZE,FOG_MAP_SIZE,T.RGFormat,T.HalfFloatType);
    fogMap.minFilter=fogMap.magFilter=T.LinearFilter;fogMap.needsUpdate=true;
    const uniforms={uEnvTime:{value:0},uEnvWind:{value:new T.Vector2()},uEnvWetness:{value:0},uEnvLowFog:{value:0},uEnvFogMap:{value:fogMap},uEnvFogColor:{value:new T.Color()}};
    const fogGLSL=`uniform float uEnvLowFog;uniform sampler2D uEnvFogMap;uniform vec3 uEnvFogColor;
float valleyDensity(vec3 p){vec2 uv=p.xz/1024.0+.5;if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 0.0;vec2 basin=texture2D(uEnvFogMap,uv).rg;return basin.g*(1.0-smoothstep(basin.r-3.0,basin.r+6.0,p.y));}
float valleyFog(vec3 p){if(uEnvLowFog<.001)return 0.0;vec3 ray=p-cameraPosition;float density=(valleyDensity(cameraPosition+ray*.1)+valleyDensity(cameraPosition+ray*.5)+valleyDensity(cameraPosition+ray*.9))/3.0;return 1.0-exp(-length(ray)*density*uEnvLowFog*.012);}`;
    const windGLSL=`uniform float uEnvTime;uniform vec2 uEnvWind;
vec3 windOffset(vec3 p,mat4 placement,float grass){
vec3 base=(placement*vec4(0.0,0.0,0.0,1.0)).xyz;float phase=base.x*.17+base.z*.13;
float wave=sin(uEnvTime*1.5+phase)*.7+sin(uEnvTime*3.1+phase*1.7)*.2;
float anchor=max(p.y,0.0);float amount=mix(pow(min(anchor/8.0,1.5),1.7)*.38,anchor*.16,grass)*wave;
return inverse(mat3(placement))*vec3(uEnvWind.x,0.0,uEnvWind.y)*amount;}`;
    const bound=new WeakSet<T.Material>(),depths=new Map<number,T.MeshDepthMaterial>();
    function windVertex(vertex:string,grass:number){const anchor=vertex.includes('#include <morphtarget_vertex>')?'#include <morphtarget_vertex>':'#include <begin_vertex>';return vertex.replace('#include <common>','#include <common>\n'+windGLSL).replace(anchor,`${anchor}
mat4 envPlacement=modelMatrix;
#ifdef USE_INSTANCING
envPlacement=modelMatrix*instanceMatrix;
#endif
transformed+=windOffset(transformed,envPlacement,${grass.toFixed(1)});`);}
    function decorate(material:T.Material|T.Material[],wind=0){
        if(Array.isArray(material)){material.forEach(m=>decorate(m,wind));return;}
        if(bound.has(material)||!(material instanceof T.MeshStandardMaterial))return;
        bound.add(material);const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
        material.onBeforeCompile=(shader,renderer)=>{
            previous(shader,renderer);Object.assign(shader.uniforms,uniforms);
            if(wind)shader.vertexShader=windVertex(shader.vertexShader,wind===2?1:0);
            shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vEnvWorld;').replace('#include <fog_vertex>',`#include <fog_vertex>
vec4 envWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
envWorld=instanceMatrix*envWorld;
#endif
vEnvWorld=(modelMatrix*envWorld).xyz;`);
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vEnvWorld;uniform float uEnvWetness;\n'+fogGLSL)
                .replace('#include <metalnessmap_fragment>',`diffuseColor.rgb*=1.0-uEnvWetness*.27;roughnessFactor=mix(roughnessFactor,.42,uEnvWetness*.72);\n#include <metalnessmap_fragment>`)
                .replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.indirectSpecular*=mix(1.0,.18,uEnvWetness);')
                .replace('#include <fog_fragment>','#include <fog_fragment>\ngl_FragColor.rgb=mix(gl_FragColor.rgb,linearToOutputTexel(vec4(uEnvFogColor,1.0)).rgb,valleyFog(vEnvWorld));');
        };
        material.customProgramCacheKey=()=>key+'/environment-v1/'+wind;material.needsUpdate=true;
    }
    function depth(wind:number){
        if(!depths.has(wind)){const material=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.vertexShader=windVertex(shader.vertexShader,wind===2?1:0);};material.customProgramCacheKey=()=>`wind-depth-${wind}`;depths.set(wind,material);}
        return depths.get(wind)!;
    }
    return {uniforms,fogGLSL,fogData,fogMap,decorate,depth,uploadFog(){for(let i=0;i<fogData.length;i++)packed[i]=T.DataUtils.toHalfFloat(fogData[i]);fogMap.needsUpdate=true;}};
}
export type EnvironmentMaterials=ReturnType<typeof createEnvironmentMaterials>;
