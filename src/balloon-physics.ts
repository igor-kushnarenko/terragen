import {BALLOON,type BalloonState} from './balloon-state';
import type {AirSample} from './atmosphere';
import type {Vec3} from './world';
import {clamp} from './noise';
export function balloonPayload(s:BalloonState){return BALLOON.basketMass+BALLOON.envelopeMass+s.fuel+s.ballast+s.wetness*28+(s.seated?BALLOON.pilotMass:0)+(s.anchorOut?0:BALLOON.anchorMass);}
export function neutralTemperature(air:AirSample,payload:number){return air.temperature/(1-Math.min(.6,payload/(air.density*BALLOON.volume)));}
export function aerodynamicDrag(air:AirSample,velocity:Vec3,area:number=BALLOON.area,coefficient:number=.47):Vec3{
    const relative=air.wind.map((v,i)=>v-velocity[i]) as Vec3,k=.5*air.density*coefficient*area*Math.hypot(...relative);
    return relative.map(v=>v*k) as Vec3;
}
export function thermalStep(s:BalloonState,air:AirSample,dt:number,agl:number,boost=false,ventHeld=false){
    const airMass=air.pressure/(287.05*s.temperature)*BALLOON.volume;
    const relative=Math.hypot(...air.wind.map((v,i)=>v-s.envelope.velocity[i]));
    const transfer=BALLOON.heatTransfer*(1+air.rain*.7+s.damage*.8+Math.min(20,relative)*.025),loss=transfer*Math.max(0,s.temperature-air.temperature);
    let power=boost?1:s.burner;
    let vent=ventHeld?1:s.vent;
    if(s.options.assist&&!boost&&!ventHeld&&s.vent===0&&s.options.mode==='scenic'){
        // Thermal inertia requires active cooling to brake before the target.
        // This controller drives actual valves rather than writing a velocity.
        const target=neutralTemperature(air,balloonPayload(s))+clamp((s.options.targetAGL-agl)*.14-s.basket.velocity[1]*10,-18,18);
        power=clamp(loss/BALLOON.heatPower+(target-s.temperature)*.14,0,1);
        vent=clamp((s.temperature-target-.2)*.14,0,1);
    }
    if(s.temperature>=BALLOON.maxTemperature-.1||!s.options.unlimited&&s.fuel<=0)power=0;
    if(!s.started){power=0;return {power,vent:0,airMass,lift:(air.density*BALLOON.volume-airMass-BALLOON.envelopeMass)*9.81};}
    const spent=Math.min(s.fuel,power*BALLOON.fuelFlow*dt),actual=s.options.unlimited?power:dt>0?spent/(BALLOON.fuelFlow*dt):0;
    if(!s.options.unlimited)s.fuel=Math.max(0,s.fuel-spent);
    const capacity=airMass*1005+BALLOON.envelopeMass*900,ventLoss=vent*airMass*.018*1005*Math.max(0,s.temperature-air.temperature);
    s.temperature=clamp(s.temperature+(actual*BALLOON.heatPower-loss-ventLoss)*dt/capacity,Math.min(air.temperature,210),BALLOON.maxTemperature);
    s.wetness=clamp(s.wetness+(air.rain*.008-(1-air.rain)*.0015)*dt,0,1);s.time+=dt;
    const nextMass=air.pressure/(287.05*s.temperature)*BALLOON.volume;
    return {power:actual,vent,airMass:nextMass,lift:(air.density*BALLOON.volume-nextMass-BALLOON.envelopeMass)*9.81};
}
/** Slack line produces no tension; a damped spring is a bounded rope approximation. */
export function ropeForce(distance:number,length:number,relativeSpeed:number){return distance<=length?0:Math.max(0,(distance-length)*6500+relativeSpeed*650);}
export function releaseBallast(s:BalloonState,kg:number){if(!Number.isFinite(kg)||kg<=0)return 0;const released=Math.min(s.ballast,kg);if(!s.options.unlimited)s.ballast-=released;return released;}
