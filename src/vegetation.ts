import * as T from 'three';
import { getModel, modelEntries } from './model-library';
import {plantModelLOD,variedPlant,plantIdentity} from './plant-models';
import {setPlantMorph,enablePlantRaycast} from './plant-variation';
import { OBJECT_CHUNK_SIZE, cameraFrustum } from './chunk-grid';
import { chooseLOD, qualityProfile } from './quality';
import { scatterObjects } from './scatter';
import { recordOperation } from './operations';
import type { Feedback } from './feedback';
import type { RenderingSystem } from './rendering';
import {HALF,type EditorModel} from './state';
import type { TerrainSystem } from './terrain';
import type { WorldObject } from './world';
import {waterLevelAt} from './water-math';
import {isFinePlantAsset} from './plant-geometry';
import type {EnvironmentMaterials} from './environment-materials';
import type {FloatingBody} from './water-buoyancy';
import {objectColor} from './object-appearance';
import {isWorldPreset} from './world-recipes';
import {isJunglePlant} from './jungle-models';
import {createAnimatedModels} from './animated-models';
import {isTaigaPlant,taigaLeafDepth} from './taiga-models';
import {taigaRegion} from './taiga-habitat';
export function createVegetation(model:EditorModel,render:Pick<RenderingSystem,'scene'>,terrain:TerrainSystem,feedback:Feedback,environment?:EnvironmentMaterials) {
    type Batch={mesh:T.InstancedMesh;data:WorldObject[];source:WorldObject['source'];asset:string;level:number;cell:string};
    type Chunk={batches:Batch[];bounds:T.Box3;level:number};
    const chunks=new Map<string,Chunk>(),groups:Batch[]=[];
    const animated=createAnimatedModels(model,render.scene,terrain,environment);
    const matrix=new T.Matrix4(),quaternion=new T.Quaternion(),scale=new T.Vector3(),position=new T.Vector3(),euler=new T.Euler(),frustum=new T.Frustum();
    let onChange=()=>{},visible=0;
    function disposeInstances(only?:Set<string>){for(let i=groups.length-1;i>=0;i--){const group=groups[i];if(only&&!only.has(group.cell))continue;render.scene.remove(group.mesh);group.mesh.dispose();groups.splice(i,1);}if(only)for(const key of only)chunks.delete(key);else chunks.clear();}
    function rebuild(only?:Set<string>) {
        modelEntries(model.world);disposeInstances(only);animated.sync();
        const buckets=new Map<string,WorldObject[]>();
        for(const item of model.world.objects) {
            if(getModel(item.asset).rig)continue;
            const cell=`${Math.floor(item.position[0]/OBJECT_CHUNK_SIZE)},${Math.floor(item.position[2]/OBJECT_CHUNK_SIZE)}`;
            if(only&&!only.has(cell))continue;
            const key=cell+'/'+item.source+'/'+item.asset,list=buckets.get(key)??[];list.push(item);buckets.set(key,list);
        }
        for(const [key,data]of buckets) {
            const cell=key.split('/')[0],chunk=chunks.get(cell)??{batches:[],bounds:new T.Box3(),level:0}; chunks.set(cell,chunk);
            const fine=isFinePlantAsset(data[0].asset);
            for(let level=0;level<(fine?1:3);level++)for(const part of plantModelLOD(data[0].asset,level)) {
                const category=getModel(data[0].asset).category,wind=category==='tree'?1:category==='shrub'?2:0;
                environment?.decorate(part.material,wind);
                const mesh=new T.InstancedMesh(part.geometry,part.material,data.length);mesh.castShadow=!fine&&(!(isJunglePlant(data[0].asset)||isTaigaPlant(data[0].asset))||category==='tree'||category==='rock'||category==='wood'&&isTaigaPlant(data[0].asset));mesh.receiveShadow=true;mesh.name='Objects '+key+' LOD '+level;
                if(variedPlant(data[0].asset)){data.forEach((item,i)=>setPlantMorph(mesh,i,plantIdentity(item)));mesh.morphTexture!.needsUpdate=true;enablePlantRaycast(mesh);}
                if(wind&&environment)mesh.customDepthMaterial=environment.depth(wind);
                if(isTaigaPlant(data[0].asset)&&!Array.isArray(part.material)&&['taiga-deciduous','taiga-mixed-deciduous'].includes(part.material.name)&&environment)mesh.customDepthMaterial=taigaLeafDepth(environment.depth(wind),part.material.name==='taiga-mixed-deciduous');
                const color=new T.Color();data.forEach((item,i)=>mesh.setColorAt(i,objectColor(item,color)));
                if(isTaigaPlant(data[0].asset)){
                    // Taiga's material decodes tint, snow and season from the instance colour.
                    // This keeps geometry shared across chunks, seasons and all three LODs.
                    data.forEach((item,i)=>{const t=taigaRegion(model.world,item.position[0],item.position[2]).settings;mesh.setColorAt(i,color.setRGB(item.tint,t?.snowCoverage??0,t?.season==='winter'?2:t?.season==='autumn'?1:0));});
                }
                const batch={mesh,data,source:data[0].source,asset:data[0].asset,level,cell}; groups.push(batch);chunk.batches.push(batch);render.scene.add(mesh);
            }
        }
        snapScatter(undefined,only);setVisibilityScatter();
    }
    function refreshRegions(rects:readonly (readonly [number,number,number,number])[]){
        const cells=new Set<string>(),current=new Map(model.world.objects.map(o=>[o.id,o]));
        for(const batch of groups)if(batch.data.some(old=>current.get(old.id)!==old))cells.add(batch.cell);
        for(const [i0,j0,i1,j1]of rects)for(let z=Math.floor((-HALF+(j0-1)*model.cell)/OBJECT_CHUNK_SIZE);z<=Math.floor((-HALF+(j1+1)*model.cell)/OBJECT_CHUNK_SIZE);z++)for(let x=Math.floor((-HALF+(i0-1)*model.cell)/OBJECT_CHUNK_SIZE);x<=Math.floor((-HALF+(i1+1)*model.cell)/OBJECT_CHUNK_SIZE);x++)cells.add(x+','+z);
        rebuild(cells);
    }
    function snapScatter(only?:Set<string>,cells?:Set<string>) {
        animated.snap(only);
        for(const group of groups) {
            if(cells&&!cells.has(group.cell))continue;
            if(only&&!group.data.some(item=>only.has(item.id)))continue;
            group.data.forEach((item,i)=>{
                if(only&&!only.has(item.id))return;
                if(item.followTerrain)item.position[1]=terrain.getH(item.position[0],item.position[2])+item.groundOffset;
                position.fromArray(item.position);euler.set(...item.rotation);quaternion.setFromEuler(euler);scale.fromArray(item.scale);
                if(item.source==='scatter'&&item.asset!=='iron-stack'&&terrain.getH(item.position[0],item.position[2])<waterLevelAt(model.state.water,model.world.waterBodies,item.position[0],item.position[2])+0.5)scale.setScalar(0.0001);
                group.mesh.setMatrixAt(i,matrix.compose(position,quaternion,scale));
            });
            group.mesh.instanceMatrix.needsUpdate=true;group.mesh.computeBoundingBox();group.mesh.computeBoundingSphere();if(environment){group.mesh.boundingSphere!.radius+=3;group.mesh.boundingBox!.expandByScalar(3);}
        }
        for(const [key,chunk]of chunks) {if(cells&&!cells.has(key))continue;chunk.bounds.makeEmpty();chunk.batches.filter(batch=>batch.level===0).forEach(batch=>chunk.bounds.union(batch.mesh.boundingBox!));}
        if(!only)onChange();
    }
    function setVisibilityScatter(){ animated.setVisibility();for(const chunk of chunks.values())for(const group of chunk.batches)group.mesh.visible=group.level===chunk.level&&(group.source!=='scatter'||model.state.showScatter); }
    function updateView(camera:T.Camera) {
        cameraFrustum(camera,frustum);visible=0;
        for(const chunk of chunks.values()) {
            chunk.level=chooseLOD(chunk.bounds.distanceToPoint(camera.position),chunk.level,qualityProfile(model).objectDistances);
            for(const batch of chunk.batches){
                const fine=isFinePlantAsset(batch.asset);
                batch.mesh.visible=(fine?model.state.showFoliage&&batch.mesh.boundingBox!.distanceToPoint(camera.position)<Math.max(80,Math.min(model.state.foliageDistance,qualityProfile(model).foliageDistance)*2):batch.level===chunk.level)&&(batch.source!=='scatter'||model.state.showScatter);
                if((isJunglePlant(batch.asset)||isTaigaPlant(batch.asset))&&getModel(batch.asset).category==='shrub'&&chunk.bounds.distanceToPoint(camera.position)>qualityProfile(model).foliageDistance*3)batch.mesh.visible=false;
            }
            if(frustum.intersectsBox(chunk.bounds)&&chunk.batches.some(batch=>batch.mesh.visible))visible++;
        }
    }
    function scatter(log=true) {
        const {objects,counts}=scatterObjects(model,terrain);model.world.objects=objects;rebuild();
        if(log)recordOperation(model,'scatter',model.seeds.scatter,{N:model.N,treeDensity:model.state.treeDensity,rockDensity:model.state.rockDensity,water:model.state.water,snowLine:model.state.snowLine,soilMoisture:model.state.soilMoisture,clearingAmount:model.state.clearingAmount},isWorldPreset(model.world.preset)?6:5);
        feedback.setStatus(`Расставлено: деревьев ${counts.trees}, камней ${counts.rocks}, кустов ${counts.bushes} · сид ${model.seeds.scatter}`);
    }
    function clearScatter(){model.world.objects=model.world.objects.filter(item=>item.source!=='scatter');rebuild();}
    function updateTaigaClimate(){const color=new T.Color();for(const batch of groups)if(isTaigaPlant(batch.asset)){batch.data.forEach((item,i)=>{const t=taigaRegion(model.world,item.position[0],item.position[2]).settings;batch.mesh.setColorAt(i,color.setRGB(item.tint,t?.snowCoverage??0,t?.season==='winter'?2:t?.season==='autumn'?1:0));});batch.mesh.instanceColor!.needsUpdate=true;}}
    let runtimePoses=false;
    function renderFloating(items:ReadonlyMap<string,FloatingBody>|null,alpha:number){
        animated.renderFloating(items,alpha);
        if(!items){if(runtimePoses){snapScatter(new Set(model.world.objects.filter(o=>o.floating).map(o=>o.id)));runtimePoses=false;}return;}
        runtimePoses=true;
        for(const group of groups){let changed=false;group.data.forEach((o,i)=>{const item=items.get(o.id);if(!item)return;position.lerpVectors(item.pose.previousPosition,item.pose.position,alpha);quaternion.slerpQuaternions(item.pose.previousRotation,item.pose.rotation,alpha);scale.fromArray(o.scale);group.mesh.setMatrixAt(i,matrix.compose(position,quaternion,scale));changed=true;});if(changed){group.mesh.instanceMatrix.needsUpdate=true;group.mesh.computeBoundingBox();group.mesh.computeBoundingSphere();}}
        for(const chunk of chunks.values())if(chunk.batches.some(b=>b.data.some(o=>o.floating))){chunk.bounds.makeEmpty();for(const batch of chunk.batches)if(batch.level===0)chunk.bounds.union(batch.mesh.boundingBox!);}
    }
    return {bindChange(callback:()=>void){onChange=callback;},scatter,snapScatter,clearScatter,setVisibilityScatter,rebuild,refreshRegions,updateTaigaClimate,updateView,renderFloating,updateAnimations:animated.update,animationState:animated.state,
        pick(ray:T.Ray){const caster=new T.Raycaster();caster.ray.copy(ray);const meshes=groups.filter(g=>g.mesh.visible);const hit=caster.intersectObjects(meshes.map(g=>g.mesh))[0],actor=animated.pick(ray);if(hit?.instanceId===undefined)return actor;const batch=meshes.find(g=>g.mesh===hit.object);return actor&&actor.distance<hit.distance?actor:batch?{id:batch.data[hit.instanceId].id,distance:hit.distance}:actor;},
        get statistics(){return {total:chunks.size,visible,levels:[...chunks.values()].reduce((sum,chunk)=>{sum[chunk.level]++;return sum;},[0,0,0]),animated:animated.statistics};},
        get trees(){return groups.find(group=>group.asset==='pine'&&group.source==='scatter'&&group.level===0)?.mesh??null;},
        get rocks(){return groups.find(group=>group.asset==='rock'&&group.source==='scatter'&&group.level===0)?.mesh??null;},
        get treeData(){return model.world.objects.filter(item=>getModel(item.asset).category==='tree');},get rockData(){return model.world.objects.filter(item=>getModel(item.asset).category==='rock');}
    };
}
export type VegetationSystem=ReturnType<typeof createVegetation>;
