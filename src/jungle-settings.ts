export const JUNGLE_VARIANTS = {
    dense: {name:'Густые джунгли',description:'Сомкнутый полог, редкие деревья-гиганты и лианы.'},
    river: {name:'Речные джунгли',description:'Извилистая река, влажные берега и папоротники.'},
    clearing: {name:'Джунгли с поляной',description:'Светлая поляна в окружении плотной стены леса.'},
} as const;
export type JungleVariant = keyof typeof JUNGLE_VARIANTS;
export interface JungleSettings {
    variant:JungleVariant;
    canopy:number; emergents:number; understory:number; vines:number;
    moisture:number; clearings:number; microrelief:number;
    streams:boolean; atmosphere:boolean; haze:number;
}
export const JUNGLE_LIMITS = {canopy:[.2,1],emergents:[0,1],understory:[0,1],vines:[0,1],moisture:[0,1],clearings:[0,.75],microrelief:[0,2],haze:[0,1]} as const;
export function jungleDefaults(variant:JungleVariant='dense'):JungleSettings {
    return {variant,canopy:variant==='clearing'?.62:variant==='river'?.87:.95,emergents:.5,understory:variant==='river'?.95:.75,
        vines:variant==='dense'?.8:.5,moisture:variant==='river'?1:.85,clearings:variant==='clearing'?.55:.08,
        microrelief:1,streams:variant!=='clearing',atmosphere:true,haze:.3};
}
/** Shared strict validation for requests and documents; invalid values are not silently clamped. */
export function validateJungle(value:unknown):JungleSettings {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Неверные параметры джунглей');
    const v=value as Record<string,unknown>;
    if(typeof v.variant!=='string'||!Object.hasOwn(JUNGLE_VARIANTS,v.variant))throw new Error('Неизвестный вариант джунглей');
    const result=jungleDefaults(v.variant as JungleVariant);
    for(const [key,[min,max]] of Object.entries(JUNGLE_LIMITS)) {
        const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error('Параметр джунглей вне диапазона: '+key);
        (result as unknown as Record<string,unknown>)[key]=n;
    }
    for(const key of ['streams','atmosphere'] as const){if(typeof v[key]!=='boolean')throw new Error('Неверный параметр джунглей: '+key);result[key]=v[key];}
    return result;
}
