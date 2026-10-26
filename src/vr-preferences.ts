import type {VRQualityId} from './quality';
export const VR_QUALITY_KEY='terragen.vr.quality';
export const VR_RAY_PITCH_KEY='terragen.vr.rayPitch';
export const DEFAULT_VR_RAY_PITCH=-40;
export function readVRRayPitch(storage:Pick<Storage,'getItem'>){
    try{const raw=storage.getItem(VR_RAY_PITCH_KEY);if(raw===null||raw.trim()==='')return DEFAULT_VR_RAY_PITCH;const value=Number(raw);return Number.isFinite(value)&&value>=-70&&value<=10?value:DEFAULT_VR_RAY_PITCH;}catch{return DEFAULT_VR_RAY_PITCH;}
}
export function saveVRRayPitch(storage:Pick<Storage,'setItem'>,pitch:number){try{storage.setItem(VR_RAY_PITCH_KEY,String(pitch));}catch{/* Session calibration still works. */}}
export function readVRQuality(storage:Pick<Storage,'getItem'>):VRQualityId{
    try{return storage.getItem(VR_QUALITY_KEY)==='quality'?'quality':'economy';}catch{return 'economy';}
}
export function saveVRQuality(storage:Pick<Storage,'setItem'>,quality:VRQualityId){
    try{storage.setItem(VR_QUALITY_KEY,quality);}catch{/* Still usable when browser storage is disabled. */}
}
