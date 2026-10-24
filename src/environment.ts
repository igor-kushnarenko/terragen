import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {RenderingSystem} from './rendering';
import type {EnvironmentMaterials} from './environment-materials';
import {FOG_MAP_SIZE} from './environment-materials';
import {basinFog,wetnessAfter} from './environment-math';
import {waterLevelAt} from './water-math';
import {sampleAtmosphere} from './atmosphere';
export function createEnvironment(model:EditorModel,terrain:TerrainSystem,render:RenderingSystem,materials:EnvironmentMaterials){
    let revision=-1,bodies=model.world.waterBodies,water=NaN;
    function update(dt:number,rain:number){
        model.state.wetness=wetnessAfter(model.state.wetness,rain,dt);
        const u=materials.uniforms;u.uEnvTime.value+=dt;
        const p=render.camera.position,ground=terrain.getH(p.x,p.z),air=sampleAtmosphere(model.state,model.balloon?.seed??model.state.seed,p.x,ground+10,p.z,model.balloon?.time??u.uEnvTime.value,ground);
        u.uEnvWind.value.set(air.wind[0]/4,air.wind[2]/4);u.uEnvWetness.value=model.state.wetness;
        u.uEnvLowFog.value=model.state.lowFog*model.state.fogIntensity*(model.state.quality==='low'?.65:1);u.uEnvFogColor.value.copy(render.fog.color);
        if(revision!==model.terrainRevision||bodies!==model.world.waterBodies||water!==model.state.water){
            for(let j=0;j<FOG_MAP_SIZE;j++)for(let i=0;i<FOG_MAP_SIZE;i++){
                const x=(i+.5)/FOG_MAP_SIZE*1024-512,z=(j+.5)/FOG_MAP_SIZE*1024-512,h=terrain.getH(x,z);
                const fog=basinFog(h,[[48,0],[-48,0],[0,48],[0,-48],[80,80],[-80,-80]].map(([dx,dz])=>terrain.getH(x+dx,z+dz)),waterLevelAt(model.state.water,model.world.waterBodies,x,z)),k=(j*FOG_MAP_SIZE+i)*2;
                materials.fogData[k]=fog.ceiling;materials.fogData[k+1]=fog.strength;
            }
            materials.uploadFog();revision=model.terrainRevision;bodies=model.world.waterBodies;water=model.state.water;
        }
    }
    return {update};
}
