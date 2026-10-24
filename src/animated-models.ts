import * as T from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {getModel,type ModelTemplate} from './model-library';
import type {EditorModel} from './state';
import type {WorldObject,ObjectAnimation} from './world';
import type {TerrainSystem} from './terrain';
import type {EnvironmentMaterials} from './environment-materials';
import type {FloatingBody} from './water-buoyancy';
import {objectColor} from './object-appearance';

export const defaultObjectAnimation=(template:ModelTemplate):ObjectAnimation=>({clip:template.rig?.clips.length?0:-1,playing:!!template.rig?.clips.length,speed:1,loop:'repeat',time:0});
type Actor={root:T.Group;content:T.Object3D;template:ModelTemplate;item:WorldObject;mixer:T.AnimationMixer;action?:T.AnimationAction;settings?:ObjectAnimation;materials:Map<T.Material,T.Material>;skins:Set<T.SkinnedMesh>};

/** Rigs share immutable geometry/textures but own bones, actions and tinted materials. */
export function createAnimatedModels(model:EditorModel,scene:T.Scene,terrain:Pick<TerrainSystem,'getH'>,environment?:EnvironmentMaterials){
    const actors=new Map<string,Actor>();
    function dispose(actor:Actor){actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.content);scene.remove(actor.root);actor.materials.forEach(m=>m.dispose());new Set([...actor.skins].map(s=>s.skeleton)).forEach(s=>s.dispose());}
    function configure(actor:Actor){
        const next=actor.item.animation??defaultObjectAnimation(actor.template),old=actor.settings,clip=actor.template.rig!.clips[next.clip];
        if(old&&old.clip===next.clip&&old.playing===next.playing&&old.speed===next.speed&&old.loop===next.loop&&old.time===next.time&&(old.restart??0)===(next.restart??0))return;
        if(!old||old.clip!==next.clip){
            actor.mixer.stopAllAction();actor.action=clip?actor.mixer.clipAction(clip).reset().play():undefined;
        }
        const action=actor.action;
        if(action){
            if(!old||old.clip!==next.clip||old.time!==next.time||(old.restart??0)!==(next.restart??0)){action.reset().play();action.time=Math.min(next.time,clip.duration);}
            action.setLoop(next.loop==='once'?T.LoopOnce:T.LoopRepeat,Infinity);action.clampWhenFinished=next.loop==='once';action.timeScale=next.speed;action.paused=!next.playing;
            actor.mixer.update(0);
        }
        actor.settings={...next};actor.root.updateMatrixWorld(true);
    }
    function snap(only?:Set<string>){for(const [id,actor]of actors){if(only&&!only.has(id))continue;const o=actor.item;if(o.followTerrain)o.position[1]=terrain.getH(o.position[0],o.position[2])+o.groundOffset;actor.root.position.fromArray(o.position);actor.root.rotation.set(...o.rotation);actor.root.scale.fromArray(o.scale);actor.root.updateMatrixWorld(true);}}
    function sync(){
        const wanted=new Set<string>();
        for(const item of model.world.objects){
            const template=getModel(item.asset);if(!template.rig)continue;wanted.add(item.id);let actor=actors.get(item.id);
            if(actor&&actor.template.rig?.root!==template.rig.root){dispose(actor);actors.delete(item.id);actor=undefined;}
            if(!actor){
                const content=cloneSkeleton(template.rig.root),root=new T.Group(),materials=new Map<T.Material,T.Material>(),skins=new Set<T.SkinnedMesh>();
                root.name='Animated object '+item.id;root.add(content);scene.add(root);
                const material=(source:T.Material)=>{let copy=materials.get(source);if(!copy){copy=source.clone();environment?.decorate(copy);materials.set(source,copy);}return copy;};
                content.traverse(o=>{if(o instanceof T.Mesh){o.material=Array.isArray(o.material)?o.material.map(material):material(o.material);o.castShadow=o.receiveShadow=true;
                    // Poses can leave the bind-pose sphere; avoid stale GPU/raycast bounds.
                    o.frustumCulled=false;if(o instanceof T.SkinnedMesh)skins.add(o);
                }});
                actor={root,content,template,item,mixer:new T.AnimationMixer(content),materials,skins};actors.set(item.id,actor);
            }
            actor.item=item;
            const tint=objectColor(item,new T.Color());for(const [source,copy]of actor.materials){if('color'in source&&'color'in copy)(copy as T.MeshStandardMaterial).color.copy((source as T.MeshStandardMaterial).color).multiply(tint);}
            configure(actor);
        }
        for(const [id,actor]of actors)if(!wanted.has(id)){dispose(actor);actors.delete(id);}
        snap();setVisibility();
    }
    function setVisibility(){for(const actor of actors.values())actor.root.visible=actor.item.source!=='scatter'||model.state.showScatter;}
    function update(dt:number){for(const actor of actors.values())if(actor.root.visible&&dt>0){actor.mixer.update(dt);actor.root.updateMatrixWorld(true);}}
    function renderFloating(items:ReadonlyMap<string,FloatingBody>|null,alpha:number){if(!items){snap(new Set([...actors].filter(([,a])=>a.item.floating).map(([id])=>id)));return;}for(const [id,actor]of actors){const body=items.get(id);if(!body)continue;actor.root.position.lerpVectors(body.pose.previousPosition,body.pose.position,alpha);actor.root.quaternion.slerpQuaternions(body.pose.previousRotation,body.pose.rotation,alpha);actor.root.updateMatrixWorld(true);}}
    function pick(ray:T.Ray){
        const caster=new T.Raycaster();caster.ray.copy(ray);let nearest:{id:string;distance:number}|null=null;
        for(const [id,actor]of actors){if(!actor.root.visible)continue;
            actor.content.traverse(o=>{if(o instanceof T.SkinnedMesh){o.skeleton.update();o.computeBoundingSphere();o.computeBoundingBox();}else if(o instanceof T.Mesh&&o.morphTargetInfluences?.length){o.geometry.boundingSphere=null;o.geometry.computeBoundingSphere();}});
            const hit=caster.intersectObject(actor.root,true)[0];if(hit&&(!nearest||hit.distance<nearest.distance))nearest={id,distance:hit.distance};
        }return nearest;
    }
    function state(id:string){const actor=actors.get(id);if(!actor)return null;const settings=actor.settings??defaultObjectAnimation(actor.template),action=actor.action;return {...settings,time:action?.time??0,duration:action?.getClip().duration??0,playing:!!action&&settings.playing&&action.isRunning()};}
    return {sync,snap,setVisibility,update,renderFloating,pick,state,dispose(){actors.forEach(dispose);actors.clear();},get statistics(){return {instances:actors.size,playing:[...actors.values()].filter(a=>a.root.visible&&a.action?.isRunning()).length,skinnedMeshes:[...actors.values()].reduce((s,a)=>s+a.skins.size,0)};}};
}
