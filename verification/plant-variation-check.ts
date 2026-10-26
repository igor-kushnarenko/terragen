import * as T from 'three';
import {initializeModelLibrary,getModel} from '../src/model-library';
import {plantModelLOD,plantIdentity} from '../src/plant-models';
import {plantWeights,setPlantMorph} from '../src/plant-variation';
import {createEnvironmentMaterials} from '../src/environment-materials';

const environment=createEnvironmentMaterials();
/** Render native instanced morphs + wind + shadows and compare with CPU-baked geometry. */
export async function checkPlantRendering(asset='oak'){
    await initializeModelLibrary();
    const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(520,360);renderer.setPixelRatio(1);renderer.setClearColor(0xb5d1df);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;renderer.info.autoReset=false;
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(48,520/360,.05,2000),size=getModel(asset).bounds.getSize(new T.Vector3()),height=size.y,span=Math.max(size.x,size.z),gap=span*1.25;
    camera.position.set(gap*2.6,height*1.4+span,Math.max(height*2.3,gap*5));camera.lookAt(0,height*.45,0);
    scene.add(new T.HemisphereLight(0xe5f3ff,0x77735f,2));const sun=new T.DirectionalLight(0xfff4df,3);sun.position.set(-gap*3,height*2+span,gap*3);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-gap*4;sun.shadow.camera.right=sun.shadow.camera.top=gap*4;sun.shadow.camera.near=.05;sun.shadow.camera.far=Math.max(100,height*8+span*10);sun.shadow.normalBias=.02;scene.add(sun);
    const floor=new T.Mesh(new T.PlaneGeometry(gap*12,gap*12),new T.MeshStandardMaterial({color:0x939b78,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;floor.receiveShadow=true;scene.add(floor);
    const gpu=new T.Group(),cpu=new T.Group(),neutral=new T.Group();scene.add(gpu,cpu,neutral);cpu.visible=neutral.visible=false;
    const count=9,parts=plantModelLOD(asset),temporary:T.BufferGeometry[]=[],batches:T.InstancedMesh[]=[],wind=getModel(asset).category==='tree'?1:2;
    environment.uniforms.uEnvTime.value=.73;environment.uniforms.uEnvWind.value.set(.3,.15);
    for(const part of parts){
        environment.decorate(part.material,wind);const batch=new T.InstancedMesh(part.geometry,part.material,count);batch.castShadow=batch.receiveShadow=true;batch.customDepthMaterial=environment.depth(wind);gpu.add(batch);batches.push(batch);
        for(let i=0;i<count;i++){
            const transform=new T.Matrix4().compose(new T.Vector3((i%3-1)*gap,0,(Math.floor(i/3)-1)*gap),new T.Quaternion(),new T.Vector3(1,1,1)),identity=plantIdentity({id:'gallery-'+i,asset}),weights=plantWeights(identity);
            batch.setMatrixAt(i,transform);setPlantMorph(batch,i,identity);
            const bake=part.geometry.clone(),p=bake.attributes.position.clone(),n=bake.attributes.normal.clone(),reference=new T.Mesh(part.geometry,part.material),point=new T.Vector3(),normal=new T.Vector3(),v=new T.Vector3();reference.morphTargetInfluences=weights;
            for(let k=0;k<p.count;k++){
                reference.getVertexPosition(k,point);p.setXYZ(k,point.x,point.y,point.z);normal.set(0,0,0);weights.forEach((w,j)=>{if(w)normal.addScaledVector(v.fromBufferAttribute(part.geometry.morphAttributes.normal![j],k),w);});normal.normalize();n.setXYZ(k,normal.x,normal.y,normal.z);
            }
            bake.morphAttributes={};bake.setAttribute('position',p);bake.setAttribute('normal',n);bake.computeBoundingBox();bake.computeBoundingSphere();temporary.push(bake);
            const mesh=new T.Mesh(bake,part.material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(transform);mesh.castShadow=mesh.receiveShadow=true;mesh.customDepthMaterial=environment.depth(wind);cpu.add(mesh);
            const base=part.geometry.clone();base.morphAttributes={};base.computeBoundingBox();base.computeBoundingSphere();temporary.push(base);const stock=new T.Mesh(base,part.material);stock.matrixAutoUpdate=false;stock.matrix.copy(transform);stock.castShadow=stock.receiveShadow=true;stock.customDepthMaterial=environment.depth(wind);neutral.add(stock);
        }
        batch.morphTexture!.needsUpdate=true;
    }
    const target=new T.WebGLRenderTarget(520,360);
    function capture(group:T.Group){gpu.visible=cpu.visible=neutral.visible=false;group.visible=true;renderer.info.reset();renderer.setRenderTarget(target);renderer.render(scene,camera);const pixels=new Uint8Array(520*360*4);renderer.readRenderTargetPixels(target,0,0,520,360,pixels);return {pixels,calls:renderer.info.render.calls};}
    const a=capture(gpu),b=capture(cpu),c=capture(neutral);let error=0,different=0,changed=0;
    for(let i=0;i<a.pixels.length;i+=4){let delta=0,variation=0;for(let j=0;j<3;j++){const e=Math.abs(a.pixels[i+j]-b.pixels[i+j]);error+=e;delta=Math.max(delta,e);variation=Math.max(variation,Math.abs(a.pixels[i+j]-c.pixels[i+j]));}if(delta>12)different++;if(variation>12)changed++;}
    const meanError=error/(520*360*3);gpu.visible=true;cpu.visible=neutral.visible=false;renderer.setRenderTarget(null);renderer.render(scene,camera);const png=renderer.domElement.toDataURL('image/png');
    for(const mesh of batches)mesh.dispose();for(const geometry of temporary)geometry.dispose();floor.geometry.dispose();floor.material.dispose();target.dispose();sun.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();
    if(meanError>.8||different>520*360*.025)throw new Error(`Morph/CPU mismatch ${asset}: ${meanError}, ${different}`);
    if(changed<80)throw new Error('Plant variation is not visible: '+asset+' '+changed);
    if(a.calls>=b.calls)throw new Error('Instancing lost: '+asset);
    return {asset,count,gpuCalls:a.calls,cpuCalls:b.calls,meanError,differentPixels:different,variedPixels:changed,png};
}
