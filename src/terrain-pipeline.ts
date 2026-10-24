import {generateHeightmap,erodeHeightmap,type Progress} from './terrain-compute';
import {shapeLandscape} from './landscape-compute';
import {carveWater} from './water-compute';
import type {TerrainJob} from './worker-jobs';
import {jungleDefaults} from './jungle-settings';
import {jungleWaterBodies} from './jungle-terrain';

/** A recipe is computed in one worker, with one transfer and one final mesh upload. */
export function computeTerrainJob(job:TerrainJob,progress:Progress=()=>{}){
    if(job.kind==='shape')return shapeLandscape(job.settings,job.heights!,job.features,job.routes,job.waterBodies,progress);
    if(job.kind==='water')return carveWater(job.settings,job.heights!,job.waterBodies??[],progress);
    if(job.kind==='erosion')return erodeHeightmap(job.settings,job.seed,job.heights!,progress);
    const erode=job.preset&&job.worldErosion;
    const jungle=job.preset==='jungle',span=jungle?.85:1;
    let heights=generateHeightmap(job.settings,p=>progress(p*(erode?.7:1)*span),job.preset,job.jungle);
    if(erode){
        const settings={...job.settings,droplets:erode===1?14:36,thermal:erode===1?4:10,erosionStrength:erode===1?.09:.15};
        // Wind-shaped dunes keep their silhouette; thermal weathering remains useful.
        if(job.preset==='desert'){settings.droplets=0;settings.thermal=erode===1?2:5;}
        heights=erodeHeightmap(settings,(Math.imul(job.seed,7)+13)>>>0,heights,p=>progress((.7+p*.3)*span));
    }
    if(jungle)heights=carveWater(job.settings,heights,jungleWaterBodies(job.settings,job.jungle??jungleDefaults()),p=>progress(.85+p*.15));
    progress(1);return heights;
}
