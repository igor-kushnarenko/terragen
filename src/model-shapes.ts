import * as T from 'three';
import {FINE_PLANT_IDS,plantGeometry,isFinePlantAsset} from './plant-geometry';
import {isNaturalAsset,makeNaturalModel} from './natural-models';
import {WORLD_PLANTS,isWorldPlant,makeWorldPlant} from './world-models';
export const BUILTIN_INFO = {
    ...WORLD_PLANTS,
    grass:{name:'Трава',category:'shrub',collider:'none'},flowers:{name:'Цветы',category:'shrub',collider:'none'},
    fern:{name:'Папоротник',category:'shrub',collider:'none'},moss:{name:'Мох',category:'shrub',collider:'none'},
    'jungle-herb':{name:'Тропическое почвопокровное растение',category:'shrub',collider:'none'},'jungle-fungi':{name:'Лесные грибы',category:'shrub',collider:'none'},
    'jungle-seedling':{name:'Тропические ростки',category:'shrub',collider:'none'},'jungle-fern':{name:'Широкий тропический папоротник',category:'shrub',collider:'none'},
    'taiga-lichen':{name:'Ягель и лишайник',category:'shrub',collider:'none'},'taiga-sphagnum':{name:'Сфагнум',category:'shrub',collider:'none'},
    'taiga-litter':{name:'Хвойный опад и веточки',category:'shrub',collider:'none'},'taiga-cones':{name:'Сосновые шишки',category:'shrub',collider:'none'},'taiga-seedling':{name:'Хвойная поросль',category:'shrub',collider:'none'},
    pine: { name: 'Сосна', category: 'tree', collider: 'trunk' }, spruce: { name: 'Ель', category: 'tree', collider: 'trunk' },
    birch: { name: 'Берёза', category: 'tree', collider: 'trunk' }, oak: { name: 'Дуб', category: 'tree', collider: 'trunk' },
    bush: { name: 'Лесной куст', category: 'shrub', collider: 'none' }, rock: { name: 'Камень', category: 'rock', collider: 'convex' },
    boulder: { name: 'Валун', category: 'rock', collider: 'convex' }, log: { name: 'Бревно', category: 'wood', collider: 'convex' },
    bridge: { name: 'Мост с пандусами', category: 'bridge', collider: 'mesh' },
    pier: { name: 'Деревянный причал', category: 'structure', collider: 'mesh' },
    cabin: { name: 'Лесной домик', category: 'structure', collider: 'mesh' },
    ruins: { name: 'Каменные руины', category: 'structure', collider: 'mesh' },
    arch: { name: 'Каменная арка', category: 'structure', collider: 'mesh' },
    cave: { name: 'Скальная пещера', category: 'structure', collider: 'mesh' },
} as const;
export type BuiltinAsset = keyof typeof BUILTIN_INFO;
export function makeBuiltinModel(id: BuiltinAsset) {
    if(isWorldPlant(id)){const model=makeWorldPlant(id);model.name=BUILTIN_INFO[id].name;return model;}
    if(isNaturalAsset(id)){const model=makeNaturalModel(id);model.name=BUILTIN_INFO[id].name;return model;}
    const root = new T.Group(); root.name = BUILTIN_INFO[id].name;
    const materials = new Map<string, T.MeshStandardMaterial>();
    const material = (color: number, flat = false) => {
        const key = color + '/' + flat;
        if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: 0.86, flatShading: flat }));
        return materials.get(key)!;
    };
    const bark = material(0x77624b);
    function part(geo: T.BufferGeometry, mat: T.Material, x = 0, y = 0, z = 0) { const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); root.add(mesh); return mesh; }
    if(isFinePlantAsset(id)){
        const mat=new T.MeshStandardMaterial({vertexColors:true,roughness:.93,side:T.DoubleSide});
        part(plantGeometry(FINE_PLANT_IDS.indexOf(id as typeof FINE_PLANT_IDS[number])),mat);
    } else if (id === 'log') {
        const m = part(new T.CylinderGeometry(0.35, 0.45, 4, 12), bark, 0, 0.4, 0); m.rotation.z = Math.PI / 2;
    } else if (id === 'bridge') {
        const wood = material(0x886344);
        for (let i = 0; i < 30; i++) part(new T.BoxGeometry(2.8, 0.2, 0.3), wood, 0, 1, -4.8 + i * 0.33);
        // Sloped solid ramps connect the deck to ground without requiring a jump.
        for (const sign of [-1, 1]) {
            const ramp = part(new T.BoxGeometry(2.8, 0.15, 4.2), wood, 0, 0.5, sign * 6.9); ramp.rotation.x = sign * Math.atan(1 / 4.2);
        }
        for (const x of [-1.35, 1.35]) {
            for (let z = -4; z <= 4; z += 2) part(new T.BoxGeometry(0.12, 1, 0.12), wood, x, 1.6, z);
            part(new T.BoxGeometry(0.12, 0.12, 10), wood, x, 2.05, 0);
        }
    } else if(id==='pier') {
        const wood=material(0x876844),dark=material(0x5a4631);
        for(let i=0;i<24;i++)part(new T.BoxGeometry(3.5,0.18,0.32),wood,0,0.7,-3.8+i*.33);
        for(const x of [-1.5,1.5])for(const z of [-3.5,0,3.5])part(new T.CylinderGeometry(.14,.18,3,8),dark,x,-.25,z);
        const ramp=part(new T.BoxGeometry(3.5,.18,3),wood,0,.35,-5.3);ramp.rotation.x=-Math.atan(.7/3);
    } else if(id==='cabin') {
        const wood=material(0x8b633e),roof=material(0x4d4e40),stone=material(0x65675f);
        part(new T.BoxGeometry(6,.22,6),wood,0,.11,0);
        for(const x of [-2.9,2.9])part(new T.BoxGeometry(.22,3.2,6),wood,x,1.7,0);
        part(new T.BoxGeometry(6,3.2,.22),wood,0,1.7,2.9);
        for(const x of [-2,2])part(new T.BoxGeometry(2,3.2,.22),wood,x,1.7,-2.9);
        part(new T.BoxGeometry(2,1,.22),wood,0,2.8,-2.9);
        for(const sign of [-1,1]){const m=part(new T.BoxGeometry(3.8,.2,6.7),roof,sign*1.6,3.85,0);m.rotation.z=-sign*.4;}
        part(new T.BoxGeometry(.65,1.8,.7),stone,1.9,4.2,1.6);
        const ramp=part(new T.BoxGeometry(1.9,.15,1.5),wood,0,.1,-3.6);ramp.rotation.x=-.14;
    } else if(id==='ruins') {
        const stone=material(0x858473,true);
        for(let row=0;row<5;row++)for(let i=0;i<7;i++){
            if(row>1&&i>3||row>3&&i>1)continue;
            part(new T.BoxGeometry(.85,.48,.7),stone,-2.5+i*.86,row*.49+.24,2);
        }
        for(let i=0;i<6;i++)part(new T.BoxGeometry(.7,.48,.85),stone,-2.5,.24+(i%2)*.49,-2.5+i*.86);
        for(let i=0;i<5;i++){const m=part(new T.BoxGeometry(.7,.5,.6),stone,Math.sin(i*2.4)*2,.2,Math.cos(i*2.4)*1.8);m.rotation.y=i;}
    } else if(id==='arch') {
        const stone=material(0x97927d,true);
        for(const x of [-2.3,2.3])for(let i=0;i<5;i++)part(new T.BoxGeometry(1,.65,1.8),stone,x,.325+i*.65,0);
        for(let i=0;i<9;i++){const a=(i+.5)/9*Math.PI,m=part(new T.BoxGeometry(.85,1,1.8),stone,Math.cos(a)*2.3,3.2+Math.sin(a)*2.3,0);m.rotation.z=a-Math.PI/2;}
    } else if(id==='cave') {
        const rock=material(0x686b61,true),floor=material(0x55584f);
        // A walk-in shell with an open front, rather than a solid convex boulder.
        part(new T.BoxGeometry(8,.15,12),floor,0,.075,2);
        for(let ring=0;ring<6;ring++)for(let i=0;i<9;i++){
            const a=(i+.5)/9*Math.PI,m=part(new T.BoxGeometry(1.8,1.8,2.2),rock,Math.cos(a)*4,Math.sin(a)*4+.1,-3+ring*2);
            m.rotation.z=a-Math.PI/2;
        }
        part(new T.BoxGeometry(8,4.6,.8),rock,0,2.3,8);
    }
    return root;
}
