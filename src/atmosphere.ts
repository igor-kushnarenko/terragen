import type {EditorState} from './state';
import type {Vec3} from './world';
import {clamp,smoothstep} from './noise';
export interface AirSample {wind:Vec3;temperature:number;pressure:number;density:number;rain:number;}
/** 1 unit in the existing wind control is 4 m/s at ten metres AGL. */
export function sampleAtmosphere(s:Pick<EditorState,'windDir'|'windSpeed'|'weather'|'precipitation'|'sunEl'>,seed:number,x:number,y:number,z:number,time:number,ground=0,gradient:[number,number]=[0,0]):AirSample{
    const storm=s.weather==='storm',rain=(s.weather==='rain'||storm)?s.precipitation:0,agl=Math.max(0,y-ground),phase=(seed>>>0)*.0000037;
    const blend=smoothstep(20,180,agl),high=smoothstep(160,600,agl),direction=(s.windDir+blend*24+high*19)*Math.PI/180;
    const gust=1+.12*Math.sin(time*.19+x*.009+phase)+.07*Math.sin(time*.7+z*.018-phase);
    const speed=s.windSpeed*4*(.65+.35*smoothstep(0,10,agl))*(1+blend*.35+high*.35)*Math.max(.1,gust);
    const wind:Vec3=[Math.sin(direction)*speed,0,Math.cos(direction)*speed];
    const turbulence=(storm?.9:rain>.1?.22:.06)*Math.min(1,s.windSpeed);
    wind[1]=Math.sin(time*.37+x*.025+phase)*turbulence+clamp((gradient[0]*wind[0]+gradient[1]*wind[2])*.3,-2.5,2.5)*Math.exp(-agl/90);
    if(!rain&&s.sunEl>20)wind[1]+=.18*Math.sin(x*.014+phase)*Math.sin(z*.014-phase)*smoothstep(10,100,agl);
    const seaTemperature=(s.weather==='snow'?271.15:storm||rain>0?285.15:291.15)+Math.max(0,Math.sin(s.sunEl*Math.PI/180))*4;
    const temperature=Math.max(210,seaTemperature-.0065*Math.max(-200,y)),pressure=101325*Math.exp(-9.81*Math.max(-200,y)/(287.05*(seaTemperature-.00325*Math.max(-200,y))));
    return {wind,temperature,pressure,density:pressure/(287.05*temperature),rain};
}
