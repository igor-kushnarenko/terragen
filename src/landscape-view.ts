import * as T from 'three';
import type { EditorModel } from './state';
import type { TerrainSystem } from './terrain';
export function createLandscapeView(model:EditorModel,terrain:TerrainSystem,scene:T.Scene){
    const group=new T.Group();group.name='Landscape guides';scene.add(group);
    const material=new T.LineBasicMaterial({color:0xe1b572,transparent:true,opacity:0.85});
    const markerMaterial=new T.MeshBasicMaterial({color:0x79d9ff,transparent:true,opacity:0.85});const markerGeometry=new T.RingGeometry(2,3.5,24).rotateX(-Math.PI/2);
    let routes=model.world.routes,points=model.world.landmarks,revision=-1,timer=0;
    function rebuild(){for(const child of group.children)if(child instanceof T.Line)child.geometry.dispose();group.clear();
        for(const route of routes){const line=new T.Line(new T.BufferGeometry().setFromPoints(route.points.map(p=>new T.Vector3(p[0],terrain.getH(...p)+0.45,p[1]))),material);group.add(line);}
        for(const point of points){const mesh=new T.Mesh(markerGeometry,markerMaterial);mesh.position.set(point.position[0],terrain.getH(...point.position)+0.6,point.position[1]);group.add(mesh);}
    }
    return {update(dt:number,walking:boolean){group.visible=!walking;timer+=dt;if(routes!==model.world.routes||points!==model.world.landmarks||revision!==model.terrainRevision&&timer>0.15){routes=model.world.routes;points=model.world.landmarks;revision=model.terrainRevision;timer=0;rebuild();}}};
}
