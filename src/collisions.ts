import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3, Mesh, type Ray } from 'three';
import type { EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import { getModel } from './model-library';
import {plantModelLOD,variedPlant,plantIdentity,plantTrunkHull} from './plant-models';
import {plantWeights} from './plant-variation';
import type { WalkMotion } from './physics';
import { WALK_STEP_HEIGHT, WALK_GROUND_SNAP } from './physics';
import type { StepSurface } from './soundscape';
import {waterLevelAt} from './water-math';
import {applyBuoyancy,captureFloatingPose,type FloatingBody} from './water-buoyancy';
import type {WaterQuery} from './water-surface';
import type {WorldObject} from './world';
import {SIZE} from './state';
let ready: Promise<void> | undefined;
export const initializeRapier = () => ready ??= RAPIER.init();
export interface CollisionParticipant {attach(world:RAPIER.World):void;detach():void;beforeStep(dt:number):void;afterStep():void;}
export function modelTriangles(asset: string, scale: number[], item?:WorldObject) {
    const vertices: number[] = [], indices: number[] = [];
    for (const part of item?plantModelLOD(asset):getModel(asset).parts) {
        const position = part.geometry.attributes.position, base = vertices.length / 3;
        const mesh=item&&variedPlant(asset)?new Mesh(part.geometry,part.material):undefined,point=new Vector3();if(mesh)mesh.morphTargetInfluences=plantWeights(plantIdentity(item!));
        for (let i = 0; i < position.count; i++){if(mesh)mesh.getVertexPosition(i,point);else point.fromBufferAttribute(position,i);vertices.push(point.x*scale[0],point.y*scale[1],point.z*scale[2]);}
        const index = part.geometry.index;
        for (let i = 0; i < (index?.count ?? position.count); i++) indices.push(base + (index ? index.getX(i) : i));
    }
    if(scale[0]*scale[1]*scale[2]<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) };
}
export function createCollisions(model: EditorModel, terrain: TerrainSystem) {
    let world: RAPIER.World | undefined, controller: RAPIER.KinematicCharacterController, capsule: RAPIER.Collider;
    let revision = -1, objects: typeof model.world.objects | undefined, visibility = false, height = 0, water = 0,bodies=model.world.waterBodies;
    let center = 0, supportRadius = .2;
    const surfaces=new Map<number,StepSurface>();
    const floating=new Map<string,FloatingBody>();let stepped=false;
    let ground:RAPIER.Collider,geometry=terrain.geo,assets=model.world.assets;
    const records=new Map<string,{item:WorldObject;key:string;collider:RAPIER.Collider;y:number;body?:RAPIER.RigidBody}>();
    const statistics={rebuilds:0,terrainUpdates:0,objectCreates:0,lastUpdateMs:0};
    let participant:CollisionParticipant|undefined,passenger=false;
    const key=(o:WorldObject)=>JSON.stringify([o.asset,o.position,o.rotation,o.scale,o.followTerrain,o.groundOffset,o.floating,o.density,o.source]);
    const field=()=>new RAPIER.Heightfield(model.N,model.N,terrain.physicsHeights,{x:SIZE,y:1,z:SIZE},RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
    function syncQueries(){const dt=world!.timestep;world!.timestep=0;try{world!.step();}finally{world!.timestep=dt;}}
    function addObject(item:WorldObject){
        if(item.source==='scatter'&&!model.state.showScatter)return;
        const asset=getModel(item.asset);
        if(item.floating){
            const mesh=modelTriangles(item.asset,item.scale,item),descriptor=RAPIER.ColliderDesc.convexHull(mesh.vertices);if(!descriptor)return;
            const bounds=asset.bounds.clone();bounds.min.multiply(new Vector3(...item.scale));bounds.max.multiply(new Vector3(...item.scale));const size=bounds.getSize(new Vector3()),volume=Math.max(.00001,size.x*size.y*size.z),rotation=new Quaternion().setFromEuler(new Euler(...item.rotation));
            const body=world!.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...item.position).setRotation(rotation).setLinearDamping(.12).setAngularDamping(.3).setCcdEnabled(true));
            const collider=world!.createCollider(descriptor.setMass(volume*1000*(item.density??.45)).setFriction(.65),body);surfaces.set(collider.handle,'wood');
            const position=new Vector3(...item.position);floating.set(item.id,{body,bounds,pose:{position,rotation,previousPosition:position.clone(),previousRotation:rotation.clone()}});
            records.set(item.id,{item,key:key(item),collider,body,y:item.position[1]});statistics.objectCreates++;return;
        }
        if(asset.collider==='none')return;
        const y=item.followTerrain?terrain.getH(item.position[0],item.position[2])+item.groundOffset:item.position[1];
        if(item.source==='scatter'&&item.asset!=='iron-stack'&&terrain.getH(item.position[0],item.position[2])<waterLevelAt(model.state.water,model.world.waterBodies,item.position[0],item.position[2])+.5)return;
        let descriptor:RAPIER.ColliderDesc|null;
        if(asset.collider==='trunk'&&variedPlant(item.asset)){
            descriptor=RAPIER.ColliderDesc.convexHull(plantTrunkHull(item));if(!descriptor)return;
            descriptor.setTranslation(item.position[0],y,item.position[2]).setRotation(new Quaternion().setFromEuler(new Euler(...item.rotation)));
        }else if(asset.collider==='trunk'){
            const size=asset.bounds.getSize(new Vector3()),radius=Math.max(.12,Math.min(size.x,size.z)*.055),trunkHeight=size.y*.65;
            descriptor=RAPIER.ColliderDesc.cylinder(trunkHeight*item.scale[1]/2,radius*Math.max(item.scale[0],item.scale[2]));
            const rotation=new Quaternion().setFromEuler(new Euler(...item.rotation)),offset=new Vector3(0,trunkHeight*item.scale[1]/2,0).applyQuaternion(rotation);
            descriptor.setTranslation(item.position[0]+offset.x,y+offset.y,item.position[2]+offset.z).setRotation(rotation);
        }else{
            const mesh=modelTriangles(item.asset,item.scale,item);descriptor=asset.collider==='mesh'?RAPIER.ColliderDesc.trimesh(mesh.vertices,mesh.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES):RAPIER.ColliderDesc.convexHull(mesh.vertices);
            if(!descriptor)throw new Error('Не удалось построить коллизию модели: '+item.asset);
            descriptor.setTranslation(item.position[0],y,item.position[2]).setRotation(new Quaternion().setFromEuler(new Euler(...item.rotation)));
        }
        const collider=world!.createCollider(descriptor.setFriction(.9));surfaces.set(collider.handle,asset.category==='rock'||asset.category==='structure'&&item.asset!=='pier'&&item.asset!=='cabin'?'rock':'wood');
        records.set(item.id,{item,key:key(item),collider,y});statistics.objectCreates++;
    }
    function removeObject(id:string){const record=records.get(id)!;surfaces.delete(record.collider.handle);if(record.body)world!.removeRigidBody(record.body);else world!.removeCollider(record.collider,true);floating.delete(id);records.delete(id);}
    function rebuild() {
        const started=performance.now();statistics.rebuilds++;
        participant?.detach();world?.free(); world = new RAPIER.World({ x: 0, y: 0, z: 0 });surfaces.clear();floating.clear();records.clear();stepped=false;
        const descriptor=new RAPIER.ColliderDesc(field());ground=world.createCollider(descriptor.setFriction(.9));
        for(const item of model.world.objects)addObject(item);
        const bodyHeight = Math.max(0.9, model.walkSettings.eyeHeight + 0.12), radius = Math.min(0.3, bodyHeight / 3);
        supportRadius = radius * .65;
        center = bodyHeight / 2;
        capsule = world.createCollider(RAPIER.ColliderDesc.capsule(bodyHeight / 2 - radius, radius).setCollisionGroups(0x0001ffff));
        capsule.setEnabled(!passenger);
        controller = world.createCharacterController(0.025);
        controller.setMaxSlopeClimbAngle(45 * Math.PI / 180); controller.setMinSlopeSlideAngle(50 * Math.PI / 180);
        controller.setSlideEnabled(true);
        controller.enableAutostep(WALK_STEP_HEIGHT, 0.2, false); controller.enableSnapToGround(WALK_GROUND_SNAP);
        revision = model.terrainRevision; objects = model.world.objects; visibility = model.state.showScatter; height = model.walkSettings.eyeHeight; water = model.state.water;bodies=model.world.waterBodies;
        geometry=terrain.geo;assets=model.world.assets;participant?.attach(world);syncQueries();statistics.lastUpdateMs=performance.now()-started;
    }
    function ensure() {
        if(!world||geometry!==terrain.geo||assets!==model.world.assets||visibility!==model.state.showScatter||height!==model.walkSettings.eyeHeight||water!==model.state.water||bodies!==model.world.waterBodies){rebuild();return;}
        if(revision===model.terrainRevision&&objects===model.world.objects)return;
        const started=performance.now(),terrainChanged=revision!==model.terrainRevision;
        if(terrainChanged){ground.setShape(field());statistics.terrainUpdates++;}
        const ids=new Set(model.world.objects.map(item=>item.id));for(const id of records.keys())if(!ids.has(id))removeObject(id);
        for(const item of model.world.objects){
            let record=records.get(item.id);
            if(record&&record.item!==item&&record.key!==key(item)){removeObject(item.id);record=undefined;}
            if(!record){addObject(item);continue;}
            record.item=item;
            if(terrainChanged&&!record.body){
                const groundY=terrain.getH(item.position[0],item.position[2]);
                if(item.source==='scatter'&&item.asset!=='iron-stack'&&groundY<waterLevelAt(model.state.water,model.world.waterBodies,item.position[0],item.position[2])+.5){removeObject(item.id);continue;}
                const y=item.followTerrain?groundY+item.groundOffset:item.position[1];
                if(y!==record.y){const p=record.collider.translation();record.collider.setTranslation({x:p.x,y:p.y+y-record.y,z:p.z});record.y=y;record.key=key(item);}
            }
        }
        revision=model.terrainRevision;objects=model.world.objects;syncQueries();statistics.lastUpdateMs=performance.now()-started;
    }
    function support(x:number,z:number,y:number) {
        ensure();const origin=y+.75;
        const cast=(dx:number,dz:number)=>world!.castRay(new RAPIER.Ray({x:x+dx,y:origin,z:z+dz},{x:0,y:-1,z:0}),120000,true,undefined,undefined,capsule);
        let hit=cast(0,0);
        // A capsule spans small plank gaps. A single centre ray incorrectly treats them as open water.
        // Keep the common case to one ray; probe its footprint only when support is substantially lower.
        if(!hit||origin-hit.timeOfImpact<y-.3)for(const [dx,dz]of [[-supportRadius,0],[supportRadius,0],[0,-supportRadius],[0,supportRadius]]){
            const other=cast(dx,dz);if(other&&(!hit||other.timeOfImpact<hit.timeOfImpact))hit=other;
        }
        return hit;
    }
    const motion: WalkMotion = {
        resolve(feet, movement, dt, flying=false) {
            ensure(); world!.timestep = dt;
            const feetY = Math.max(feet.y, terrain.getSurfaceH(feet.x, feet.z));
            capsule.setTranslation({ x: feet.x, y: feetY + center, z: feet.z }); if(!stepped)world!.step();stepped=false;
            if(flying){controller.disableSnapToGround();controller.disableAutostep();}else{controller.enableSnapToGround(WALK_GROUND_SNAP);controller.enableAutostep(WALK_STEP_HEIGHT,.2,false);}
            controller.computeColliderMovement(capsule, movement, undefined, undefined, collider => collider.handle !== capsule.handle);
            const actual = controller.computedMovement();
            return { position: new Vector3(feet.x + actual.x, feetY + actual.y, feet.z + actual.z), grounded: controller.computedGrounded() };
        },
        ground(x, z, y) {
            const hit=support(x,z,y);
            return hit ? y + .75 - hit.timeOfImpact : terrain.getSurfaceH(x, z);
        },
    };
    return { motion, ensure, rebuild,
        teleportHit(ray:Ray,distance:number){
            ensure();const hit=world!.castRayAndGetNormal(new RAPIER.Ray(ray.origin,ray.direction),distance,true,undefined,undefined,capsule);
            if(!hit)return null;
            const point=ray.at(hit.timeOfImpact,new Vector3()),inside=Math.abs(point.x)<SIZE/2-1&&Math.abs(point.z)<SIZE/2-1;
            const clear=!world!.intersectionWithShape({x:point.x,y:point.y+center+.08,z:point.z},{x:0,y:0,z:0,w:1},capsule.shape,undefined,undefined,capsule);
            return {point,safe:inside&&hit.normal.y>=Math.SQRT1_2&&point.y>waterLevelAt(model.state.water,model.world.waterBodies,point.x,point.z)+.15&&clear};
        },
        bindDynamic(next:CollisionParticipant|undefined){ensure();participant?.detach();participant=next;participant?.attach(world!);},
        setPassenger(on:boolean){passenger=on;if(world)capsule.setEnabled(!on);},
        stepWater(dt:number,sample:WaterQuery){ensure();world!.timestep=dt;participant?.beforeStep(dt);for(const item of floating.values()){item.pose.previousPosition.copy(item.pose.position);item.pose.previousRotation.copy(item.pose.rotation);applyBuoyancy(item,sample);}world!.step();participant?.afterStep();for(const item of floating.values()){captureFloatingPose(item);const p=item.body.translation();if(Math.abs(p.x)>511||Math.abs(p.z)>511){item.body.setTranslation({x:Math.max(-511,Math.min(511,p.x)),y:p.y,z:Math.max(-511,Math.min(511,p.z))},true);captureFloatingPose(item);}}stepped=true;},
        get floating(){return floating;},get statistics(){return {...statistics};},
        surfaceAt(x:number,z:number,y:number){const hit=support(x,z,y);return hit?surfaces.get(hit.collider.handle):undefined;},
        dispose() {participant?.detach(); world?.free(); world = undefined; }, get colliderCount() { return world?.colliders.len() ?? 0; } };
}
export type CollisionSystem = ReturnType<typeof createCollisions>;
