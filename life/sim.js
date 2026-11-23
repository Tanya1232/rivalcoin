export const HOUR=3600000, DAY=24*HOUR;
const minutes=n=>60000*n;
export const tracks={
  tech:['Колледж технологий','Стажёр в IT','Техник','Разработчик','Руководитель команды'],
  design:['Школа дизайна','Стажёр студии','Младший дизайнер','Дизайнер','Арт-директор'],
  business:['Колледж бизнеса','Стажёр офиса','Ассистент','Менеджер','Руководитель отдела']
};
export const goals={study:['Завершить занятие',20],work:['Отработать смену',25],care:['Позаботиться о себе',15],growth:['Пройти курс или собеседование',15]};
export const actions={
  study:{label:'Занятие',duration:minutes(60),group:'study',minEnergy:15},
  interview:{label:'Собеседование',duration:minutes(30),group:'growth',minEnergy:15},
  work:{label:'Рабочая смена',duration:minutes(120),group:'work',minEnergy:25},
  train:{label:'Курс повышения квалификации',duration:minutes(90),group:'growth',cost:40,minEnergy:20},
  meal:{label:'Приготовить обед',duration:minutes(10),group:'care',cost:12},
  sleep:{label:'Отдохнуть',duration:minutes(45),group:'care'},
  walk:{label:'Прогуляться',duration:minutes(20),group:'care',minEnergy:10},
  clinic:{label:'Посетить врача',duration:minutes(20),group:'care',cost:30}
};
const clamp=n=>Math.max(0,Math.min(100,n));
export function create(name,gender,track,now){
  return {name,gender,track,born:now,updated:now,cash:180,education:0,level:0,xp:0,health:100,food:88,mood:80,energy:90,daily:{}};
}
export function utcDay(now){return new Date(now).toISOString().slice(0,10)}
function decay(s,to){
  const hours=Math.max(0,(to-s.updated)/HOUR);
  const oldFood=s.food;
  s.food=clamp(s.food-2.2*hours);
  s.energy=clamp(s.energy-1.25*hours);
  s.mood=clamp(s.mood-.8*hours);
  const hungry=Math.max(0,hours-Math.max(0,(oldFood-20)/2.2));
  s.health=Math.max(35,s.health-.55*hungry);
  s.updated=Math.max(s.updated,to);
}
function complete(s,task){
  const type=task.type;
  if(type==='study'){s.education++;s.energy-=10;s.mood+=5}
  if(type==='interview'){s.level=1;s.energy-=8;s.mood+=12}
  if(type==='work'){
    s.cash+=65+15*s.level;s.xp++;s.energy-=18;s.food-=7;
    if(s.level<4&&s.xp>=s.level*4)s.level++;
  }
  if(type==='train'){s.xp+=2;s.energy-=12;if(s.level<4&&s.xp>=s.level*4)s.level++}
  if(type==='meal')s.food+=48;
  if(type==='sleep'){s.energy+=65;s.health+=6}
  if(type==='walk'){s.mood+=35;s.health+=5;s.energy-=5}
  if(type==='clinic')s.health+=55;
  for(const key of ['food','energy','health','mood'])s[key]=clamp(s[key]);
  const key=utcDay(task.end);
  (s.daily[key]??={}).groups=[...new Set([...(s.daily[key]?.groups||[]),actions[type].group])];
}
export function advance(state,now){
  const s=structuredClone(state);
  if(s.task&&now>=s.task.end){
    decay(s,s.task.end);complete(s,s.task);delete s.task;
  }
  decay(s,now);
  const cutoff=utcDay(now-6*DAY);
  for(const day of Object.keys(s.daily))if(day<cutoff&&!claimable(s.daily[day]))delete s.daily[day];
  return s;
}
export function lock(s,type){
  const a=actions[type];
  if(!a)return 'Действие недоступно';
  if(s.task)return 'Сначала закончи текущее действие';
  if(type==='study'&&s.education>=3)return 'Обучение завершено';
  if(type==='interview'&&(s.education<3||s.level))return 'Нужно закончить обучение';
  if(['work','train'].includes(type)&&!s.level)return 'Нужна работа';
  if(a.cost>s.cash&&type!=='meal')return 'Нужно '+a.cost+' ₽';
  if(a.minEnergy&&(s.energy<a.minEnergy||s.health<45||s.food<15))return 'Сначала восстанови силы';
  return '';
}
export function claimable(day){
  if(!day)return 0;
  const total=[...new Set(day.groups||[])].reduce((n,k)=>n+(goals[k]?.[1]||0),0);
  return Math.max(0,Math.min(total,50)-(day.claimed||0));
}
