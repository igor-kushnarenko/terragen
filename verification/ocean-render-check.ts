import * as T from 'three';
import {createModel} from '../src/state';
import {createMaterials} from '../src/materials';
import {createTerrain} from '../src/terrain';
import {createWaterSurface,waveSettings,WATER_WAVE_GLSL} from '../src/water-surface';
import {createWaterRendering} from '../src/water-rendering';
import type {RenderingSystem} from '../src/rendering';
import type {WaterBody} from '../src/world';

/** Real WebGL regression: compare visible water to bare seabed and compare two wave times. */
export function checkOceanRendering(windSpeed=1.5){
    const model=createModel();model.N=model.state.N=32;model.heights=new Float32Array(33**2);
    Object.assign(model.state,{water:16,wave:1,windSpeed,lowFog:0,waterReflections:false});
    const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true,antialias:false});renderer.setSize(256,192);renderer.setPixelRatio(1);
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.65;
    document.body.append(renderer.domElement);
    const scene=new T.Scene();scene.background=new T.Color(.55,.65,.75);
    scene.add(new T.HemisphereLight(0xddeeff,0x665544,2));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(50,100,20);scene.add(sun);
    const camera=new T.PerspectiveCamera(55,256/192,.5,40000);camera.position.set(0,35,75);camera.lookAt(0,16,0);camera.updateMatrixWorld();
    const render={renderer,scene,camera} as RenderingSystem,materials=createMaterials(model,render),terrain=createTerrain(model,render,materials);
    terrain.buildTerrain();terrain.updateMeshAll();terrain.updateView(camera,null,192);
    materials.waterUniforms.uSunDir.value.set(.5,1,.2).normalize();materials.waterUniforms.uSunColor.value.setRGB(1,1,1);
    materials.waterUniforms.uSkyZenith.value.setRGB(.1,.3,.6);materials.waterUniforms.uSkyHorizon.value.setRGB(.5,.6,.7);
    materials.waterUniforms.uFogDensity.value=0;const surface=createWaterSurface(model,terrain.getH),water=createWaterRendering(model,render,materials,surface,terrain.getH);
    const capture=()=>{renderer.render(scene,camera);const gl=renderer.getContext(),pixels=new Uint8Array(256*192*4);gl.readPixels(0,0,256,192,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
    const difference=(a:Uint8Array,b:Uint8Array)=>{let pixels=0;for(let k=0;k<a.length;k+=4)if(Math.abs(a[k]-b[k])+Math.abs(a[k+1]-b[k+1])+Math.abs(a[k+2]-b[k+2])>12)pixels++;return pixels;};
    const river:WaterBody={id:'fall',kind:'river',points:[[20,0],[20,20],[20,22],[20,40]],pointLevels:[30,28,16,16],level:30,endLevel:16,outlet:1,width:10,wave:.2,opacity:.8};
    const results=[];
    for(const quality of ['low','balanced','high'] as const)for(const falls of [false,true])for(const reflections of [false,true]){
        model.state.quality=quality;model.state.waterReflections=reflections;model.world.waterBodies=[model.world.waterBodies[0],...(falls?[river]:[])];
        surface.reset();water.update(0);materials.water.visible=false;const dry=capture();materials.water.visible=true;const first=capture();
        surface.advance(1.7);water.update(0);const second=capture();
        results.push({quality,falls,reflections,visible:materials.water.visible,cascade:materials.waterUniforms.uCascade.value.toArray(),waterPixels:difference(dry,first),movingPixels:difference(first,second)});
    }
    water.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    for(const result of results)if(result.waterPixels<1000||result.movingPixels<25)throw new Error('Ocean surface or waves missing: '+JSON.stringify(result));
    return results;
}


/** Read the production GLSL profile back from a float render target and compare it to physics. */
export function checkWaveShaderParity(){
    const renderer=new T.WebGLRenderer(),target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,depthBuffer:false});renderer.setSize(1,1);
    const uniforms={uWave:{value:1},uWindSpeed:{value:0},uWaterKind:{value:0},uDepth:{value:0}};
    const material=new T.ShaderMaterial({uniforms,vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:WATER_WAVE_GLSL+'\nuniform float uDepth;void main(){vec3 p=waveParameters(uDepth);gl_FragColor=vec4(p.xy,waterRunup(),waterBasePeak());}'});
    const scene=new T.Scene(),quad=new T.Mesh(new T.PlaneGeometry(2,2),material);scene.add(quad);const camera=new T.Camera(),pixel=new Float32Array(4);let cases=0,maxError=0;
    try{
        for(const [kindIndex,kind]of (['ocean','lake','river'] as const).entries())for(const wind of [.5,2,3])for(const wave of [0,1,3])for(const depth of [-3,0,5,60]){
            uniforms.uWave.value=wave;uniforms.uWindSpeed.value=wind;uniforms.uWaterKind.value=kindIndex;uniforms.uDepth.value=depth;
            renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
            const cpu=waveSettings(kind,wave,wind,depth),expected=[cpu.amplitude,cpu.length,cpu.runup,cpu.peak];
            for(let k=0;k<4;k++){const error=Math.abs(expected[k]-pixel[k]);maxError=Math.max(maxError,error);if(!Number.isFinite(pixel[k])||error>.001)throw new Error('CPU/GPU wave mismatch: '+JSON.stringify({kind,wind,wave,depth,expected,actual:[...pixel]}));}cases++;
        }
        return {cases,maxError};
    }finally{quad.geometry.dispose();material.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
}
