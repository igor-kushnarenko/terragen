import type {EditorState} from './state';

export const IRON_VARIANTS={
    isles:{name:'Железные острова',description:'Тёмные утёсы, холодная зыбь, морось и редкий вереск.'},
    tempest:{name:'Шторм',description:'Сильный ветер, бурный прибой и дождь без постоянных молний.'},
    drowned:{name:'Утонувшие берега',description:'Низкие уступы, скальные столбы и узкие проливы в серой дымке.'},
    fog:{name:'Безмолвный туман',description:'Силуэты скал в плотном холодном морском тумане.'},
    highlands:{name:'Продуваемые плато',description:'Широкие каменные плато, вересковые пятна и высокие береговые обрывы.'},
} as const;
export type IronVariant=keyof typeof IRON_VARIANTS;
export const IRON_LIMITS={islandCount:[3,18],islandSize:[.55,1.5],islandSpacing:[.65,1.4],cliffHeight:[15,140],cliffSteepness:[0,1],rockSharpness:[0,1],erosionStrength:[0,1],plateauFrequency:[0,1],coastalComplexity:[0,1],oceanDepth:[20,160],waveHeight:[0,2],waveRoughness:[0,1],seaFoam:[0,2],seaSpray:[0,1],vegetationDensity:[0,1],grassCoverage:[0,1],mossCoverage:[0,1],windStrength:[0,3],windDirection:[0,360],rainIntensity:[0,1],fogDensity:[0,1],cloudCoverage:[0,1],atmosphereDarkness:[0,1],surfaceWetness:[0,1]} as const;
export type IronKey=keyof typeof IRON_LIMITS;
export type IronSettings={variant:IronVariant}&Record<IronKey,number>;
export const IRON_TERRAIN_KEYS:readonly IronKey[]=['islandCount','islandSize','islandSpacing','cliffHeight','cliffSteepness','rockSharpness','erosionStrength','plateauFrequency','coastalComplexity','oceanDepth'];
export const IRON_PLANT_KEYS:readonly IronKey[]=['vegetationDensity','grassCoverage','mossCoverage','windDirection'];
export function ironDefaults(variant:IronVariant='isles'):IronSettings{
    const s:IronSettings={variant,islandCount:8,islandSize:1,islandSpacing:1,cliffHeight:66,cliffSteepness:.88,rockSharpness:.55,erosionStrength:.45,plateauFrequency:.7,coastalComplexity:.72,oceanDepth:85,waveHeight:1.25,waveRoughness:.65,seaFoam:1.1,seaSpray:.55,vegetationDensity:.22,grassCoverage:.32,mossCoverage:.42,windStrength:1.65,windDirection:245,rainIntensity:.2,fogDensity:.2,cloudCoverage:1,atmosphereDarkness:.42,surfaceWetness:.85};
    if(variant==='tempest')Object.assign(s,{windStrength:2.85,waveHeight:1.85,waveRoughness:1,seaFoam:1.65,seaSpray:1,rainIntensity:.85,fogDensity:.38,atmosphereDarkness:.7,surfaceWetness:1});
    if(variant==='drowned')Object.assign(s,{islandCount:14,islandSize:.8,islandSpacing:.7,cliffHeight:23,plateauFrequency:.85,vegetationDensity:.06,grassCoverage:.1,windStrength:1.1,waveHeight:1.1,fogDensity:.36,atmosphereDarkness:.5});
    if(variant==='fog')Object.assign(s,{fogDensity:.85,windStrength:.9,waveHeight:.8,rainIntensity:.08,seaSpray:.15,atmosphereDarkness:.3});
    if(variant==='highlands')Object.assign(s,{islandCount:5,islandSize:1.35,cliffHeight:85,plateauFrequency:1,vegetationDensity:.38,grassCoverage:.55,windStrength:2,rainIntensity:.3,fogDensity:.1,atmosphereDarkness:.25});
    return s;
}
export function validateIron(value:unknown):IronSettings{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Неверные параметры Железных островов');
    const v=value as Record<string,unknown>;
    if(typeof v.variant!=='string'||!Object.hasOwn(IRON_VARIANTS,v.variant))throw new Error('Неизвестный вариант Железных островов');
    const result=ironDefaults(v.variant as IronVariant);
    for(const [key,[min,max]]of Object.entries(IRON_LIMITS)){
        const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||key==='islandCount'&&!Number.isInteger(n))throw new Error('Параметр Железных островов вне диапазона: '+key);
        result[key as IronKey]=n;
    }
    return result;
}
export const ironTerrainKey=(s:IronSettings)=>IRON_TERRAIN_KEYS.map(k=>s[k]);
export function ironClimate(s:IronSettings):Partial<EditorState>{
    return {weather:s.rainIntensity>0?'rain':s.cloudCoverage>.7?'overcast':s.cloudCoverage>.1?'partly':'clear',precipitation:s.rainIntensity,windSpeed:s.windStrength,windDir:s.windDirection,wave:s.waveHeight,wetness:s.surfaceWetness,fog:.015+s.fogDensity*.7,fogIntensity:.5+s.fogDensity,lowFog:.15+s.fogDensity*.5,exposure:.72-s.atmosphereDarkness*.2,soilMoisture:.8,treeDensity:0,foliageDensity:s.vegetationDensity,clearingAmount:.95};
}
