import {SIZE,type EditorModel} from './state';
import {createTaigaHabitat,hasTaiga} from './taiga-habitat';
import {CanopyIndex} from './jungle-habitat';
import {sampleHeight,triangleGrade} from './trail-math';
import type {EcologyTerrain} from './ecology';
import {clamp} from './noise';
export const TAIGA_MAP_SIZE=128;
export function taigaSurface(e:ReturnType<ReturnType<typeof createTaigaHabitat>['sample']>,shade:number){
    const t=e.t,moss=t.mossCoverage*e.moisture*(.25+shade*.75)*(1-e.bog*.35),lichen=t.lichenCoverage*(1-e.moisture)*(.4+e.drainage*.6);
    const snow=t.snowCoverage*clamp(.6+e.detail*.55-shade*.38,0,1)*(t.season==='spring'?.65:1);
    return {weight:e.weight,moisture:e.moisture,peat:e.bog,clearing:e.clearing,moss,lichen,snow};
}
/** Two RGBA masks keep seasonal and ecological ground transitions independent of world height. */
export function taigaSurfaceMaps(model:EditorModel){
    const habitatBytes=new Uint8Array(TAIGA_MAP_SIZE**2*4),coverBytes=new Uint8Array(habitatBytes.length);
    if(!hasTaiga(model.world))return {habitat:habitatBytes,cover:coverBytes};
    const terrain:EcologyTerrain={getH:(x,z)=>sampleHeight(model.heights,model.N,x,z),getNormalY:(x,z)=>1/Math.hypot(1,triangleGrade(model.heights,model.N,x,z))};
    const habitat=createTaigaHabitat(model,terrain),canopy=new CanopyIndex();for(const o of model.world.objects)if(o.source!=='scatter'||model.state.showScatter)canopy.add(o);
    for(let z=0;z<TAIGA_MAP_SIZE;z++)for(let x=0;x<TAIGA_MAP_SIZE;x++){
        const wx=((x+.5)/TAIGA_MAP_SIZE-.5)*SIZE,wz=((z+.5)/TAIGA_MAP_SIZE-.5)*SIZE,e=habitat.sample(wx,wz),s=taigaSurface(e,canopy.sample(wx,wz).shade),k=(z*TAIGA_MAP_SIZE+x)*4;
        habitatBytes.set([s.weight,s.moisture,s.peat,s.clearing].map(n=>Math.round(clamp(n,0,1)*255)),k);
        coverBytes.set([s.moss,s.lichen,s.snow,e.t.season==='autumn'?.7:0].map(n=>Math.round(clamp(n,0,1)*255)),k);
    }
    return {habitat:habitatBytes,cover:coverBytes};
}
