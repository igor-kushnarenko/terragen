import {IRON_VARIANTS,IRON_LIMITS,IRON_TERRAIN_KEYS,ironDefaults,validateIron,type IronSettings,type IronVariant,type IronKey} from './iron-settings';
const LABELS:Record<IronKey,string>={islandCount:'Количество островов',islandSize:'Размер островов',islandSpacing:'Расстояние между островами',cliffHeight:'Высота утёсов, м',cliffSteepness:'Крутизна утёсов',rockSharpness:'Острота скал',erosionStrength:'Выветривание и разломы',plateauFrequency:'Количество плато',coastalComplexity:'Изрезанность побережья',oceanDepth:'Глубина океана, м',waveHeight:'Высота волн',waveRoughness:'Ветровая рябь',seaFoam:'Морская пена',seaSpray:'Морские брызги',vegetationDensity:'Плотность растений',grassCoverage:'Травяной покров',mossCoverage:'Мох и лишайники',windStrength:'Сила ветра',windDirection:'Направление ветра, °',rainIntensity:'Интенсивность дождя',fogDensity:'Морской туман',cloudCoverage:'Облачность',atmosphereDarkness:'Мрачность освещения',surfaceWetness:'Влажность поверхностей'};
export function createIronControls(parent:HTMLElement,initial:IronSettings,changed:()=>void=()=>{},compact=false,includeTerrain=true){
    let value={...initial};
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const label=el('label',parent,'Вариант Железных островов'),variant=el('select',label);variant.setAttribute('aria-label','Вариант Железных островов');
    for(const [id,preset]of Object.entries(IRON_VARIANTS)){const option=el('option',variant,preset.name);option.value=id;}
    const description=el('p',parent);description.className='hint';
    const inputs=new Map<IronKey,HTMLInputElement>(),outputs=new Map<IronKey,HTMLOutputElement>();
    const groups:[string,readonly IronKey[]][]=[...(includeTerrain?[['Острова и геология',IRON_TERRAIN_KEYS] as [string,readonly IronKey[]]]:[]),['Океан и прибой',['waveHeight','waveRoughness','seaFoam','seaSpray']],['Скудная растительность',['vegetationDensity','grassCoverage','mossCoverage']],['Атмосфера',['windStrength','windDirection','rainIntensity','fogDensity','cloudCoverage','atmosphereDarkness','surfaceWetness']]];
    for(const [name,keys]of groups){
        const group=el('details',parent);group.open=!compact;el('summary',group,name);
        for(const key of keys){
            const row=el('label',group);row.className='world-range';el('span',row,LABELS[key]);
            const input=el('input',row);input.type='range';const [min,max]=IRON_LIMITS[key];input.min=String(min);input.max=String(max);input.step=['islandCount','cliffHeight','oceanDepth','windDirection'].includes(key)?'1':'.01';input.setAttribute('aria-label',LABELS[key]+' · Железные острова');
            const output=el('output',row);inputs.set(key,input);outputs.set(key,output);
            input.oninput=()=>{value={...value,[key]:Number(input.value)};output.value=input.value;changed();};
        }
    }
    function sync(next:IronSettings){value={...next};variant.value=value.variant;description.textContent=IRON_VARIANTS[value.variant].description;for(const [key,input]of inputs){input.value=String(value[key]);outputs.get(key)!.value=String(value[key]);}}
    variant.onchange=()=>{const next=ironDefaults(variant.value as IronVariant);if(!includeTerrain)for(const k of IRON_TERRAIN_KEYS)next[k]=value[k];sync(next);changed();};
    sync(value);return {read:()=>validateIron(value),sync};
}
