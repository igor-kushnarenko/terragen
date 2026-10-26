import {makeSimplex,fbm,smoothstep,clamp} from './noise';
import {ironDefaults} from './iron-settings';
import type {EditorModel} from './state';
import type {EcologyTerrain} from './ecology';
import {sampleHeight} from './trail-math';
import {waterLevelAt} from './water-math';
export const IRON_MAP_SIZE=128;
export function createIronHabitat(model:EditorModel,terrain:EcologyTerrain){
    const t=model.world.recipe?.iron??ironDefaults(),noise=makeSimplex(model.state.seed^0x1a23fe),area=Math.max(.125,model.state.areaSize),wr=t.windDirection*Math.PI/180,wx=Math.sin(wr),wz=Math.cos(wr);
    return {sample(x:number,z:number){
        const h=terrain.getH(x,z),ny=terrain.getNormalY(x,z),water=waterLevelAt(model.state.water,model.world.waterBodies,x,z),elevation=h-water,step=Math.max(4,12*area);
        const upwind=terrain.getH(x-wx*step*3,z-wz*step*3),shelter=clamp((upwind-h)/(step*2),0,1),windExposure=1-shelter;
        const around=[terrain.getH(x+step,z),terrain.getH(x-step,z),terrain.getH(x,z+step),terrain.getH(x,z-step)],basin=clamp((around.reduce((a,b)=>a+b,0)/4-h)/Math.max(.3,2*area),0,1);
        const coastalDistance=Math.min(...around)>water+2?step*2:step*(1-smoothstep(water,water+12,h));
        const saltSpray=(1-smoothstep(0,18*Math.sqrt(area),elevation))*windExposure;
        const moisture=clamp(.55+basin*.35+shelter*.15-(1-ny)*.4,0,1),soilDepth=smoothstep(.8,.98,ny)*(1-saltSpray*.9)*(1-smoothstep(90*Math.sqrt(area),130*Math.sqrt(area),elevation));
        const patch=.5+.5*fbm(noise,x/(35*area),z/(35*area),3),cluster=smoothstep(.38,.7,patch),erosion=(1-ny)*(.5+.5*noise(x*.05,z*.05));
        const moss=t.mossCoverage*moisture*(.18+shelter*.6+basin*.4)*smoothstep(.35,.9,ny),vegetation=t.vegetationDensity*soilDepth*cluster*(.18+shelter*.82)*(1-saltSpray);
        const level=elevation<0?'ocean':elevation<15*Math.sqrt(area)&&ny<.75?'lower-cliffs':elevation>t.cliffHeight*Math.sqrt(area)*1.02&&windExposure>.7?'ridges':ny>.9?'plateaus':'upper-cliffs';
        return {t,h,ny,water,elevation,coastalDistance,saltSpray,windExposure,shelter,basin,moisture,soilDepth,patch,cluster,erosion,moss,vegetation,level,dry:elevation>1.5};
    }};
}
export function ironSurfaceMap(model:EditorModel){
    const data=new Uint8Array(IRON_MAP_SIZE**2*4);if(model.world.preset!=='iron-islands')return data;
    const getH=(x:number,z:number)=>sampleHeight(model.heights,model.N,x,z),habitat=createIronHabitat(model,{getH,getNormalY:(x,z)=>1/Math.hypot(1,(getH(x+2,z)-getH(x-2,z))/4,(getH(x,z+2)-getH(x,z-2))/4)});
    for(let z=0;z<IRON_MAP_SIZE;z++)for(let x=0;x<IRON_MAP_SIZE;x++){
        const e=habitat.sample((x+.5)/IRON_MAP_SIZE*1024-512,(z+.5)/IRON_MAP_SIZE*1024-512),k=(z*IRON_MAP_SIZE+x)*4;
        data.set([255,Math.round(e.moss*255),Math.round(e.soilDepth*e.cluster*e.t.grassCoverage*255),Math.round(e.saltSpray*255)],k);
    }
    return data;
}
