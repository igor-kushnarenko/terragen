import * as T from 'three';
import { trailCurve, controlPointHit } from './trail-math';
import type { ControlsSystem, TerrainTool } from './controls';
import type { EditorModel } from './state';
import type { Feedback } from './feedback';
import type { RenderingSystem } from './rendering';
import type { TerrainSystem } from './terrain';
import type { TrailDraft, LandscapeSystem } from './landscape';
import type { Vec2 } from './world';
export function createTrailTool(model:EditorModel,render:RenderingSystem,terrain:TerrainSystem,input:ControlsSystem,feedback:Feedback,landscape:LandscapeSystem,setCameraTool:()=>void){
    const group=new T.Group();group.name='Trail curve draft';group.userData.noWaterReflection=true;render.scene.add(group);
    const lineMaterial=new T.LineBasicMaterial({color:0xffc76b,depthTest:false,transparent:true,opacity:0.95});
    const markerMaterial=new T.MeshBasicMaterial({color:0xffc76b,depthTest:false});
    const sphere=new T.SphereGeometry(1,10,6);let line:T.Line|undefined;
    const state={active:false,points:[] as Vec2[],dragging:-1,hover:null as Vec2|null,error:''};
    let dragOffset:Vec2=[0,0];
    let getDraft:()=>Omit<TrailDraft,'controls'>=()=>({name:'Новая тропа',width:8,maxGrade:0.32,surface:'soil'});
    function refresh(){
        group.clear();line?.geometry.dispose();line=undefined;
        if(state.active){
            const visible=state.hover&&state.points.length<64&&state.dragging<0&&(!state.points.length||Math.hypot(state.hover[0]-state.points.at(-1)![0],state.hover[1]-state.points.at(-1)![1])>3)?[...state.points,state.hover]:state.points;
            if(visible.length>=2){const points=trailCurve(visible,Math.max(1,model.cell/2));line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(p[0],terrain.getH(...p)+0.8,p[1]))),lineMaterial);line.renderOrder=11;group.add(line);}
            const size=Math.max(2,Math.min(8,(render.camera.position.y-terrain.getH(render.camera.position.x,render.camera.position.z))*0.025));
            for(const p of state.points){const marker=new T.Mesh(sphere,markerMaterial);marker.position.set(p[0],terrain.getH(...p)+size,p[1]);marker.scale.setScalar(size);marker.renderOrder=12;group.add(marker);}
        }
        document.body.classList.toggle('drawing-trail',state.active);feedback.syncUI('trailDraft');
    }
    function cancel(){if(!state.active)return;state.active=false;state.error='';state.points=[];state.hover=null;state.dragging=-1;refresh();}
    async function commit(){
        if(model.busy)return;
        if(state.points.length<2){state.error='Добавьте хотя бы две разные точки тропы';feedback.setStatus(state.error);refresh();return;}
        state.error='';
        try{if(await landscape.buildTrail({...getDraft(),controls:structuredClone(state.points)}))cancel();}
        catch(error){state.error=error instanceof Error?error.message:String(error);feedback.setStatus(state.error);refresh();}
    }
    function removeLast(){if(model.busy)return;state.error='';state.points.pop();state.hover=null;state.dragging=-1;refresh();}
    const tool:TerrainTool={
        get active(){return state.active;},cancel,
        pointerDown(point,ray){
            state.error='';
            const p:Vec2=[point.x,point.z],radius=Math.max(2,Math.min(8,(render.camera.position.y-terrain.getH(render.camera.position.x,render.camera.position.z))*0.025));
            const existing=controlPointHit(ray,state.points,terrain.getH,radius);
            dragOffset=[0,0];
            if(existing>=0){state.dragging=existing;dragOffset=[state.points[existing][0]-p[0],state.points[existing][1]-p[1]];}
            else if(state.points.length<64){state.points.push(p);state.dragging=state.points.length-1;}
            else feedback.setStatus('Не больше 64 контрольных точек');state.hover=null;refresh();
        },
        pointerMove(point){if(state.dragging>=0)state.error='';if(!point){state.hover=null;refresh();return;}const p:Vec2=[point.x,point.z];if(state.dragging>=0)state.points[state.dragging]=[p[0]+dragOffset[0],p[1]+dragOffset[1]];else state.hover=p;refresh();},
        pointerUp(){state.dragging=-1;},
        keyDown(event){
            if(model.busy)return false;
            if(event.key==='Escape'){event.preventDefault();cancel();return true;}
            if(event.key==='Backspace'||(event.ctrlKey||event.metaKey)&&event.code==='KeyZ'){event.preventDefault();removeLast();return true;}
            if(event.key==='Enter'){event.preventDefault();void commit();return true;}return false;
        },
    };
    input.bindTerrainTool(tool);
    return {state,cancel,commit,removeLast,bindDraft(callback:typeof getDraft){getDraft=callback;},
        begin(){if(model.busy)return;if(input.walk.on)input.setWalk(false);input.cancelPick();input.clearKeys();setCameraTool();input.bindTerrainTool(tool);state.active=true;state.error='';state.points=[];state.hover=null;state.dragging=-1;refresh();render.renderer.domElement.focus({preventScroll:true});feedback.setStatus('Клик — точка тропы · перетаскивание точки — изменить кривую · Enter — построить · Esc — отменить');},
    };
}
export type TrailTool=ReturnType<typeof createTrailTool>;
