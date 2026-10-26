import * as T from 'three';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {MaterialsSystem} from './materials';
import {effectiveQuality} from './quality';
import {mulberry32,clamp} from './noise';

/** Shore crossings from the actual edited heightfield, including lee-side shelter. */
export function ironSurfSites(model:EditorModel,getH:(x:number,z:number)=>number){
    if(model.world.preset!=='iron-islands')return [];
    const sites:{x:number;z:number;dx:number;dz:number}[]=[],step=1024/model.N,level=model.state.water;
    for(let z=0;z<model.N;z++)for(let x=0;x<model.N;x++){
        const wx=x*step-512,wz=z*step-512,h=getH(wx,wz);
        for(const [ox,oz]of [[step,0],[0,step]]){
            const h2=getH(wx+ox,wz+oz);if((h>level)===(h2>level)||Math.max(h,h2)<level+3)continue;
            const t=clamp((level-h)/(h2-h),0,1),px=wx+ox*t,pz=wz+oz*t,dx=getH(px+step,pz)-getH(px-step,pz),dz=getH(px,pz+step)-getH(px,pz-step),len=Math.hypot(dx,dz);
            if(len>1)sites.push({x:px,z:pz,dx:-dx/len,dz:-dz/len});
        }
    }
    // Even coverage around the whole archipelago with fixed memory and one draw call.
    return sites.length<=256?sites:Array.from({length:256},(_,i)=>sites[Math.floor(i*sites.length/256)]);
}
export function createIronSurf(model:EditorModel,render:RenderingSystem,materials:MaterialsSystem,getH:(x:number,z:number)=>number){
    const uniforms={uTime:materials.waterUniforms.uTime,uWind:materials.waterUniforms.uWindAngle,uWindSpeed:materials.waterUniforms.uWindSpeed,uSea:{value:0},uAmount:{value:0},uPixel:{value:1},uFog:materials.waterUniforms.uFogDensity,uFogColor:materials.waterUniforms.uFogColor};
    const material=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
        vertexShader:`attribute vec3 aMotion;uniform float uTime,uWind,uWindSpeed,uSea,uAmount,uPixel;varying float vAlpha,vDistance;
void main(){float age=fract(uTime*(.32+aMotion.z*.13)+aMotion.z*7.0);float burst=pow(max(0.0,sin(age*3.14159265)),.65);vec2 wind=vec2(sin(uWind),cos(uWind));float exposure=.25+.75*max(0.0,-dot(aMotion.xy,wind));
vec3 p=position;float height=(1.0+uWindSpeed*1.6)*exposure;p.y=uSea+.12+4.0*age*(1.0-age)*height;
p.xz+=aMotion.xy*age*(.5+uWindSpeed*.6)+wind*age*age*(.7+uWindSpeed*.8);p.xz+=vec2(sin(aMotion.z*173.0),cos(aMotion.z*93.0))*age*1.4;
vec4 view=viewMatrix*vec4(p,1.0);vDistance=length(view.xyz);vAlpha=burst*uAmount*exposure*(1.0-smoothstep(70.0,190.0,vDistance))*.42;gl_Position=projectionMatrix*view;gl_PointSize=clamp((.3+age*.7)*uPixel/max(1.0,-view.z),1.0,48.0);}`,
        fragmentShader:`uniform float uFog;uniform vec3 uFogColor;varying float vAlpha,vDistance;
void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;float a=pow(1.0-r*r,2.0)*vAlpha;float f=1.0-exp(-uFog*uFog*vDistance*vDistance);gl_FragColor=vec4(mix(vec3(.61,.68,.7),uFogColor,f),a*(1.0-f));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    const points=new T.Points(new T.BufferGeometry(),material);points.name='Iron Isles coastal spray';points.frustumCulled=false;points.userData.noWaterReflection=true;points.renderOrder=3;points.visible=false;render.scene.add(points);
    const bufferSize=new T.Vector2();let revision=-1,key='',sites=0;
    function update(){
        const enabled=model.world.preset==='iron-islands',signature=JSON.stringify([enabled,model.state.seed,model.state.water,model.N]);
        if(revision!==model.terrainRevision||signature!==key){
            revision=model.terrainRevision;key=signature;const coast=ironSurfSites(model,getH);sites=coast.length;
            const random=mulberry32(model.state.seed^0x713a),positions:number[]=[],motions:number[]=[];
            for(let i=0;i<1024&&coast.length;i++){const p=coast[i%coast.length],offset=random()*3-1.5;positions.push(p.x-p.dz*offset,model.state.water,p.z+p.dx*offset);motions.push(p.dx,p.dz,random());}
            const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('aMotion',new T.Float32BufferAttribute(motions,3));points.geometry.dispose();points.geometry=geometry;
        }
        if(!enabled){points.visible=false;return;}
        const settings=enabled?model.world.recipe?.iron:undefined,amount=settings?.seaSpray??0;
        uniforms.uAmount.value=amount*Math.min(1,model.state.wave)*Math.min(1,model.state.windSpeed/1.5);uniforms.uSea.value=model.state.water;
        uniforms.uPixel.value=render.renderer.getDrawingBufferSize(bufferSize).y*.6;
        const count=effectiveQuality(model)==='low'?256:effectiveQuality(model)==='high'?1024:640;
        points.geometry.setDrawRange(0,Math.min(count,points.geometry.attributes.position?.count??0));points.visible=enabled&&sites>0&&uniforms.uAmount.value>.001;
    }
    return {update,get statistics(){return {surfSites:sites,seaSprayParticles:points.visible?points.geometry.drawRange.count:0};},dispose(){points.removeFromParent();points.geometry.dispose();material.dispose();}};
}
