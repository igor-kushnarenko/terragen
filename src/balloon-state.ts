import type {Vec3} from './world';
export type Rotation4=[number,number,number,number];
export interface BalloonPose {position:Vec3;rotation:Rotation4;velocity:Vec3;angular:Vec3;}
export const BALLOON_KEYS={board:'KeyB',boost:'Space',vent:'KeyV',ballast:'KeyZ',anchor:'KeyX',camera:'KeyC',increase:'ArrowUp',decrease:'ArrowDown'} as const;
export type BalloonAction=keyof typeof BALLOON_KEYS;
export const RESERVED_BALLOON_KEYS=new Set(['KeyG','KeyU','KeyW','KeyA','KeyS','KeyD','KeyE','KeyI','KeyF','KeyP','KeyR','KeyH','Escape','F1','F8','Tab','Digit0','Digit1','Digit2']);
export interface BalloonOptions {mode:'scenic'|'manual';assist:boolean;targetAGL:number;unlimited:boolean;reduceMotion:boolean;external:boolean;bindings:Record<BalloonAction,string>;}
export interface BalloonState {
    version:1;seed:number;time:number;started:boolean;seated:boolean;moored:boolean;
    spawn:Vec3;returnPoint:Vec3;basket:BalloonPose;envelope:BalloonPose;anchor:BalloonPose;
    temperature:number;fuel:number;ballast:number;wetness:number;burner:number;vent:number;battery:number;
    anchorOut:boolean;ropeLength:number;winch:'lower'|'raise'|'stop';hooked:boolean;broken:boolean;damage:number;
    options:BalloonOptions;
}
export const BALLOON={volume:3000,area:230,envelopeMass:140,basketMass:165,pilotMass:85,anchorMass:25,fuelCapacity:45,ballastCapacity:60,
    maxTemperature:398.15,heatPower:2_400_000,fuelFlow:.078,heatTransfer:4700,ropeMax:40,ropeStrength:18_000,anchorHolding:9000,winchForce:4000,winchSpeed:1.2,batteryCapacity:540_000,envelopeOffset:18} as const;
export function balloonPose(x:number,y:number,z:number):BalloonPose{return {position:[x,y,z],rotation:[0,0,0,1],velocity:[0,0,0],angular:[0,0,0]};}
export function createBalloonState(point:Vec3,returnPoint:Vec3,seed:number):BalloonState{
    const [x,y,z]=point;
    return {version:1,seed:seed>>>0,time:0,started:false,seated:false,moored:true,spawn:[...point],returnPoint:[...returnPoint],basket:balloonPose(x,y+.72,z),envelope:balloonPose(x,y+.72+BALLOON.envelopeOffset,z),anchor:balloonPose(x+1.2,y+.35,z),temperature:350,fuel:45,ballast:40,wetness:0,burner:.15,vent:0,battery:BALLOON.batteryCapacity,anchorOut:false,ropeLength:.6,winch:'stop',hooked:false,broken:false,damage:0,
        options:{mode:'scenic',assist:false,targetAGL:30,unlimited:false,reduceMotion:true,external:false,bindings:{...BALLOON_KEYS}}};
}
/** Reject the entire imported flight before changing any editor state. */
export function validateBalloon(value:unknown):BalloonState|null{
    if(value===undefined||value===null)return null;
    const fail=(p:string):never=>{throw new Error('Неверный проект: balloon.'+p);};
    const obj=(v:unknown,p:string):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail(p);
    const n=(v:unknown,p:string,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(p);
    const b=(v:unknown,p:string)=>typeof v==='boolean'?v:fail(p);
    const vector=(v:unknown,p:string,length:number,max:number)=>Array.isArray(v)&&v.length===length?v.map((x,i)=>n(x,p+'.'+i,-max,max)):fail(p);
    function pose(v:unknown,p:string):BalloonPose{const a=obj(v,p),rotation=vector(a.rotation,p+'.rotation',4,1) as Rotation4;if(Math.abs(Math.hypot(...rotation)-1)>.01)fail(p+'.rotation');return {position:vector(a.position,p+'.position',3,60000) as Vec3,rotation,velocity:vector(a.velocity,p+'.velocity',3,200) as Vec3,angular:vector(a.angular,p+'.angular',3,100) as Vec3};}
    const s=obj(value,'state'),o=obj(s.options,'options'),binding=obj(o.bindings,'bindings'),bindings={} as Record<BalloonAction,string>,used=new Set<string>();
    for(const key of Object.keys(BALLOON_KEYS) as BalloonAction[]){const code=binding[key];if(typeof code!=='string'||!(/^(Key[A-Z]|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(code))||RESERVED_BALLOON_KEYS.has(code)||used.has(code))fail('bindings.'+key);bindings[key]=code as string;used.add(code as string);}
    if(s.version!==1||!Number.isInteger(s.seed))fail('version/seed');
    const mode=o.mode;if(mode!=='scenic'&&mode!=='manual')fail('options.mode');const winch=s.winch;if(winch!=='lower'&&winch!=='raise'&&winch!=='stop')fail('winch');
    const result:BalloonState={version:1,seed:n(s.seed,'seed',0,0xffffffff),time:n(s.time,'time',0,1e9),started:b(s.started,'started'),seated:b(s.seated,'seated'),moored:b(s.moored,'moored'),spawn:vector(s.spawn,'spawn',3,60000) as Vec3,returnPoint:vector(s.returnPoint,'returnPoint',3,60000) as Vec3,basket:pose(s.basket,'basket'),envelope:pose(s.envelope,'envelope'),anchor:pose(s.anchor,'anchor'),temperature:n(s.temperature,'temperature',180,BALLOON.maxTemperature),fuel:n(s.fuel,'fuel',0,45),ballast:n(s.ballast,'ballast',0,60),wetness:n(s.wetness,'wetness',0,1),burner:n(s.burner,'burner',0,1),vent:n(s.vent,'vent',0,1),battery:n(s.battery,'battery',0,BALLOON.batteryCapacity),anchorOut:b(s.anchorOut,'anchorOut'),ropeLength:n(s.ropeLength,'ropeLength',.4,BALLOON.ropeMax),winch:winch as BalloonState['winch'],hooked:b(s.hooked,'hooked'),broken:b(s.broken,'broken'),damage:n(s.damage,'damage',0,1),options:{mode:mode as BalloonOptions['mode'],assist:b(o.assist,'options.assist'),targetAGL:n(o.targetAGL,'options.targetAGL',0,2000),unlimited:b(o.unlimited,'options.unlimited'),reduceMotion:b(o.reduceMotion,'options.reduceMotion'),external:b(o.external,'options.external'),bindings}};
    for(const p of [result.spawn,result.returnPoint,result.basket.position])if(Math.abs(p[0])>512||Math.abs(p[2])>512)fail('outside world');
    if(Math.hypot(...result.envelope.position.map((v,i)=>v-result.basket.position[i]))>40||!result.broken&&Math.hypot(...result.anchor.position.map((v,i)=>v-result.basket.position[i]))>60)fail('body separation');
    if(result.hooked&&(!result.anchorOut||result.broken)||result.seated&&!result.started)fail('state combination');
    return result;
}
