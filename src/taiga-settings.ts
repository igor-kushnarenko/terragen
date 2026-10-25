import type {EditorState} from './state';

export const TAIGA_VARIANTS = {
    spruce:{name:'Густая еловая тайга',description:'Влажный елово-пихтовый лес, тёмный полог, черника и мох.'},
    pine:{name:'Светлый сосновый бор',description:'Высокие открытые стволы, сухая почва, брусника и светлые лишайники.'},
    larch:{name:'Сибирская лиственничная тайга',description:'Разреженные группы лиственниц, холодные низины и кустарники.'},
    swamp:{name:'Заболоченная тайга',description:'Торфяные низины, сфагнум, лесные озерца и угнетённые деревья.'},
    winter:{name:'Зимняя тайга',description:'Снежный покров, хвойные кроны под снегом и мягкий холодный свет.'},
} as const;
export type TaigaVariant=keyof typeof TAIGA_VARIANTS;
export const TAIGA_SEASONS={summer:'Лето',autumn:'Осень',winter:'Зима',spring:'Весна'} as const;
export type TaigaSeason=keyof typeof TAIGA_SEASONS;
export interface TaigaSettings {
    variant:TaigaVariant;season:TaigaSeason;
    forestDensity:number;coniferDensity:number;deciduousRatio:number;treeHeightVariation:number;treeAgeVariation:number;
    understoryDensity:number;shrubDensity:number;mossCoverage:number;lichenCoverage:number;deadwoodAmount:number;boulderDensity:number;
    moisture:number;bogFrequency:number;clearingFrequency:number;terrainVariation:number;atmosphericFog:number;snowCoverage:number;
    water:boolean;
}
export const TAIGA_LIMITS={forestDensity:[0,1],coniferDensity:[0,1],deciduousRatio:[0,1],treeHeightVariation:[0,1],treeAgeVariation:[0,1],
    understoryDensity:[0,1],shrubDensity:[0,1],mossCoverage:[0,1],lichenCoverage:[0,1],deadwoodAmount:[0,1],boulderDensity:[0,1],
    moisture:[0,1],bogFrequency:[0,1],clearingFrequency:[0,1],terrainVariation:[0,2],atmosphericFog:[0,1],snowCoverage:[0,1]} as const;
export function taigaDefaults(variant:TaigaVariant='spruce'):TaigaSettings {
    const base:TaigaSettings={variant,season:'summer',forestDensity:.82,coniferDensity:.95,deciduousRatio:.12,treeHeightVariation:.75,treeAgeVariation:.65,
        understoryDensity:.45,shrubDensity:.55,mossCoverage:.85,lichenCoverage:.14,deadwoodAmount:.35,boulderDensity:.28,
        moisture:.78,bogFrequency:.18,clearingFrequency:.16,terrainVariation:1,atmosphericFog:.15,snowCoverage:0,water:true};
    if(variant==='pine')Object.assign(base,{forestDensity:.5,deciduousRatio:.08,understoryDensity:.22,shrubDensity:.4,mossCoverage:.25,lichenCoverage:.85,moisture:.24,bogFrequency:.03,clearingFrequency:.3,atmosphericFog:.05});
    if(variant==='larch')Object.assign(base,{forestDensity:.38,deciduousRatio:.1,understoryDensity:.28,shrubDensity:.65,mossCoverage:.6,lichenCoverage:.4,moisture:.55,bogFrequency:.36,clearingFrequency:.42,terrainVariation:1.15,atmosphericFog:.1});
    if(variant==='swamp')Object.assign(base,{forestDensity:.48,deciduousRatio:.18,understoryDensity:.3,shrubDensity:.85,mossCoverage:.98,lichenCoverage:.05,moisture:.98,bogFrequency:.95,deadwoodAmount:.55,terrainVariation:.55,clearingFrequency:.32,atmosphericFog:.4});
    if(variant==='winter')Object.assign(base,{season:'winter',forestDensity:.68,understoryDensity:.2,shrubDensity:.18,mossCoverage:.55,lichenCoverage:.2,snowCoverage:.9,atmosphericFog:.14});
    return base;
}
export function validateTaiga(value:unknown):TaigaSettings {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Неверные параметры тайги');
    const v=value as Record<string,unknown>;
    if(typeof v.variant!=='string'||!Object.hasOwn(TAIGA_VARIANTS,v.variant)||typeof v.season!=='string'||!Object.hasOwn(TAIGA_SEASONS,v.season))throw new Error('Неизвестный вариант или сезон тайги');
    const result=taigaDefaults(v.variant as TaigaVariant);result.season=v.season as TaigaSeason;
    for(const [key,[min,max]]of Object.entries(TAIGA_LIMITS)){
        const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error('Параметр тайги вне диапазона: '+key);
        (result as unknown as Record<string,unknown>)[key]=n;
    }
    if(typeof v.water!=='boolean')throw new Error('Неверный параметр водоёмов тайги');result.water=v.water;
    return result;
}
/** The same climate mapping is used on creation and when editing an existing forest. */
export function taigaClimate(t:TaigaSettings):Partial<EditorState>{
    return {soilMoisture:t.moisture,clearingAmount:t.clearingFrequency,fog:t.atmosphericFog*.3,lowFog:t.atmosphericFog*.75,
        wetness:t.season==='spring'?.65:t.moisture*.23,sunEl:t.season==='winter'?17:34,weather:'partly',precipitation:.15,
        snowLine:500,treeDensity:t.forestDensity,rockDensity:t.boulderDensity,foliageDensity:.75};
}
