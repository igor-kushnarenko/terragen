import {TAIGA_VARIANTS,TAIGA_SEASONS,TAIGA_LIMITS,taigaDefaults,validateTaiga,type TaigaSettings,type TaigaVariant,type TaigaSeason} from './taiga-settings';

export function createTaigaControls(parent:HTMLElement,initial:TaigaSettings,changed:()=>void=()=>{},compact=false,includeTerrain=true){
    let value={...initial};
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const label=el('label',parent,'Вариант тайги');label.className='jungle-variant-label';const variant=el('select',label);variant.setAttribute('aria-label','Вариант тайги');
    for(const [id,p]of Object.entries(TAIGA_VARIANTS)){const o=el('option',variant,p.name);o.value=id;}
    const description=el('p',parent);description.className='hint';
    let fields=parent;if(compact){fields=el('details',parent);fields.className='jungle-advanced';el('summary',fields,'Настроить тайгу');}
    const seasonLabel=el('label',fields,'Сезон тайги');seasonLabel.className='jungle-variant-label';const season=el('select',seasonLabel);season.setAttribute('aria-label','Сезон тайги');
    for(const [id,name]of Object.entries(TAIGA_SEASONS)){const o=el('option',season,name);o.value=id;}
    const inputs=new Map<keyof typeof TAIGA_LIMITS,HTMLInputElement>(),outputs=new Map<keyof typeof TAIGA_LIMITS,HTMLElement>();
    for(const [key,name]of [['forestDensity','Плотность леса'],['coniferDensity','Плотность хвойных'],['deciduousRatio','Доля лиственных'],['treeHeightVariation','Разброс высоты деревьев'],['treeAgeVariation','Разнообразие возраста'],['understoryDensity','Плотность подроста'],['shrubDensity','Плотность кустарников'],['mossCoverage','Покрытие мхом'],['lichenCoverage','Покрытие лишайниками'],['deadwoodAmount','Валежник и сухостой'],['boulderDensity','Плотность валунов'],['moisture','Влажность'],['bogFrequency','Болотистые участки'],['clearingFrequency','Лесные прогалины'],...(includeTerrain?[['terrainVariation','Выраженность рельефа']]:[]),['atmosphericFog','Атмосферная дымка'],['snowCoverage','Снежное покрытие']] as [keyof typeof TAIGA_LIMITS,string][]){
        const row=el('div',fields);row.className='row';const l=el('label',row,name),input=el('input',row),[min,max]=TAIGA_LIMITS[key];
        input.type='range';input.min=String(min);input.max=String(max);input.step=key==='terrainVariation'?'.1':'.01';input.setAttribute('aria-label',name+' тайги');
        input.id=(compact?'new-':'edit-')+'taiga-'+key;l.htmlFor=input.id;
        const output=el('span',row);output.className='val';inputs.set(key,input);outputs.set(key,output);
        input.oninput=()=>{value={...value,[key]:Number(input.value)};output.textContent=key==='terrainVariation'?Number(input.value).toFixed(1):Math.round(Number(input.value)*100)+'%';changed();};
    }
    let water:HTMLInputElement|undefined;if(includeTerrain){const l=el('label',fields);l.className='chk';water=el('input',l);water.type='checkbox';water.setAttribute('aria-label','Ручьи и озерца тайги');el('span',l,'Ручьи и лесные озерца');water.onchange=()=>{value={...value,water:water!.checked};changed();};}
    function sync(next:TaigaSettings){value={...next};variant.value=value.variant;season.value=value.season;description.textContent=TAIGA_VARIANTS[value.variant].description;
        for(const [key,input]of inputs){input.value=String(value[key]);outputs.get(key)!.textContent=key==='terrainVariation'?value[key].toFixed(1):Math.round(value[key]*100)+'%';}if(water)water.checked=value.water;}
    variant.onchange=()=>{const next=taigaDefaults(variant.value as TaigaVariant);if(!includeTerrain){next.water=value.water;next.terrainVariation=value.terrainVariation;}sync(next);changed();};
    season.onchange=()=>{const s=season.value as TaigaSeason;sync({...value,season:s,snowCoverage:s==='winter'?.9:s==='spring'?.32:0});changed();};
    sync(value);return {read:()=>validateTaiga(value),sync};
}
