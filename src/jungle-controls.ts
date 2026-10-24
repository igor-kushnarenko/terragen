import {JUNGLE_VARIANTS,JUNGLE_LIMITS,jungleDefaults,validateJungle,type JungleSettings,type JungleVariant} from './jungle-settings';

export function createJungleControls(parent:HTMLElement,initial:JungleSettings,changed:()=>void=()=>{},compact=false,includeTerrain=true) {
    let value={...initial};
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const variantLabel=el('label',parent,'Вариант джунглей');variantLabel.className='jungle-variant-label';
    const variant=el('select',variantLabel);variant.setAttribute('aria-label','Вариант джунглей');
    for(const [id,preset]of Object.entries(JUNGLE_VARIANTS)){const option=el('option',variant,preset.name);option.value=id;}
    const description=el('p',parent);description.className='hint';
    let fields:HTMLElement=parent;
    if(compact){const details=el('details',parent);details.className='jungle-advanced';el('summary',details,'Настроить джунгли');fields=details;}
    const inputs=new Map<keyof JungleSettings,HTMLInputElement>(),outputs=new Map<keyof JungleSettings,HTMLElement>();
    for(const [key,label]of [['canopy','Густота полога'],['emergents','Деревья-гиганты'],['understory','Подлесок'],['vines','Лианы и эпифиты'],['moisture','Влажность почвы'],['clearings','Естественные просветы'],...(includeTerrain?[['microrelief','Микрорельеф']]:[]),['haze','Мягкая дымка']] as [keyof typeof JUNGLE_LIMITS,string][]) {
        const row=el('div',fields);row.className='row';el('label',row,label);const input=el('input',row);input.type='range';const [min,max]=JUNGLE_LIMITS[key];input.min=String(min);input.max=String(max);input.step=key==='microrelief'?'.1':'.01';input.setAttribute('aria-label',label+' джунглей');
        const output=el('span',row);output.className='val';inputs.set(key,input);outputs.set(key,output);
        input.oninput=()=>{value={...value,[key]:Number(input.value)};output.textContent=key==='microrelief'?Number(input.value).toFixed(1):Math.round(Number(input.value)*100)+'%';changed();};
    }
    for(const [key,label]of [...(includeTerrain?[['streams','Ручей и лесной водоём'] as const]:[]),['atmosphere','Влажная дымка в атмосфере'] as const]) {
        const row=el('label',fields);row.className='chk';const input=el('input',row);input.type='checkbox';input.setAttribute('aria-label',label);el('span',row,label);inputs.set(key,input);input.onchange=()=>{value={...value,[key]:input.checked};sync(value);changed();};
    }
    function sync(next:JungleSettings) {
        value={...next};variant.value=value.variant;description.textContent=JUNGLE_VARIANTS[value.variant].description;
        for(const [key,input]of inputs){const v=value[key];if(typeof v==='boolean')input.checked=v;else{input.value=String(v);const output=outputs.get(key);if(output)output.textContent=key==='microrelief'?Number(v).toFixed(1):Math.round(Number(v)*100)+'%';}}
        inputs.get('haze')!.disabled=!value.atmosphere;
    }
    variant.onchange=()=>{const next=jungleDefaults(variant.value as JungleVariant);if(!includeTerrain){next.streams=value.streams;next.microrelief=value.microrelief;}sync(next);changed();};
    sync(value);
    return {read:()=>validateJungle(value),sync};
}
