import {clamp} from './noise';
import type {EditorState} from './state';

export const TERRAIN_ALGORITHM = 6;
/** The shortest noise wavelength must span at least six terrain cells. */
export function generationOctaveLimit(s:Pick<EditorState,'N'|'areaSize'|'scale'>){
    return clamp(Math.floor(Math.log2(s.N*s.areaSize/(6*(1.8/s.scale))))+1,1,9);
}
export function terrainSharpness(value:number){return clamp(value/5,0,1);}
