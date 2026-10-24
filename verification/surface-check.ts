import * as T from 'three';
import { createModel } from '../src/state';
import { createRendering } from '../src/rendering';
import { createMaterials } from '../src/materials';
import { createTerrain } from '../src/terrain';
import { createLighting } from '../src/lighting';

// Uses the production ground shader on a bare plane, with no shadows or foliage.
const model=createModel();model.N=model.state.N=64;model.state.tool='camera';model.state.shadows=false;model.state.groundDetail=0;
const render=createRendering(model),materials=createMaterials(model,render),terrain=createTerrain(model,render,materials),lighting=createLighting(model,render,materials);
terrain.buildTerrain();model.heights.fill(30);terrain.updateMeshAll();materials.updateWater();lighting.updateSun(true);lighting.updateEnv();lighting.updateShadows();
render.camera.position.set(0,32.0,8);render.camera.fov=70;render.camera.updateProjectionMatrix();render.camera.lookAt(0,30,-8);render.controls.enabled=false;
const select=document.querySelector<HTMLSelectElement>('#surface')!,detail=document.querySelector<HTMLInputElement>('#detail')!;
function paint(){model.splat.fill(0);model.splatDetail.fill(0);const layer=Number(select.value),data=layer<4?model.splat:model.splatDetail;for(let k=layer%4;k<data.length;k+=4)data[k]=255;materials.splatTex.needsUpdate=materials.detailTex.needsUpdate=true;}
select.onchange=paint;detail.onchange=()=>{model.state.groundDetail=detail.checked?1:0;materials.updateMaterial();};paint();
render.renderer.setAnimationLoop(()=>{terrain.updateView(render.camera);render.renderer.render(render.scene,render.camera);});
const status=document.querySelector('#result')!;
try{
    // Sample a tile boundary with stable gradients, then force the coarsest mip.
    // Neither should pull colors from another ground material (especially snow).
    const target=new T.WebGLRenderTarget(256,1,{type:T.UnsignedByteType}),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,2);
    const colors=materials.terrainUniforms.uAlbedoAtlas.value,isArray=(colors as T.DataArrayTexture).isDataArrayTexture===true;
    const sample=new T.ShaderMaterial({uniforms:{source:{value:colors},uLayer:{value:4}},vertexShader:'void main(){gl_Position=vec4(position,1.0);}',fragmentShader:isArray?
        'uniform highp sampler2DArray source; uniform float uLayer; void main(){float p=1.0+(gl_FragCoord.x-128.0)*0.00001;gl_FragColor=textureLod(source,vec3(p,0.413,uLayer),7.0);}' :
        'uniform sampler2D source; uniform float uLayer; void main(){float p=1.0+(gl_FragCoord.x-128.0)*0.00001;vec2 uv=(fract(vec2(p,0.413))*126.0+1.0)/128.0;uv.x=(uv.x+uLayer)/8.0;gl_FragColor=textureLod(source,uv,7.0);}' });
    scene.add(new T.Mesh(new T.PlaneGeometry(2,2),sample));render.renderer.setRenderTarget(target);render.renderer.render(scene,camera);const pixels=new Uint8Array(256*4);render.renderer.readRenderTargetPixels(target,0,0,256,1,pixels);render.renderer.setRenderTarget(null);
    const image=colors.image,bytes=image.data as Uint8Array,width=image.width;
    const sum=[0,0,0];for(let y=0;y<128;y++)for(let x=0;x<128;x++){const k=isArray?(4*128*128+y*128+x)*4:(y*width+4*128+x)*4;for(let c=0;c<3;c++)sum[c]+=bytes[k+c];}
    const average=sum.map(value=>value/(128*128)),error=Math.max(...average.map((value,c)=>Math.abs(value-pixels[128*4+c])));
    status.textContent=`Контроль фильтрации подстилки: ${error<=2?'PASS':'FAIL'} · отклонение цвета ${error.toFixed(1)}/255`;
    target.dispose();sample.dispose();
}catch(error){status.textContent='Ошибка проверки: '+String(error);}
