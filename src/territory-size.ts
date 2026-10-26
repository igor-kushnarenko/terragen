/** Linear footprint inside the 1024 m editor map; half-metre slider precision. */
export const MIN_AREA_SIZE=1/16;
export const AREA_SIZE_STEP=1/2048;
export function territoryLabel(value:number){return `${Math.round(value*1024)} м · ${Math.round(value*1000)/10}% карты${value===MIN_AREA_SIZE?' · микроостров':value===1?' · вся карта':''}`;}
