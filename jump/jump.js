import {award,status} from './wallet.js';
const $=id=>document.getElementById(id);
const tg=window.Telegram?.WebApp;
tg?.ready();tg?.expand();
tg?.BackButton?.show();tg?.BackButton?.onClick(()=>location.assign('../'));
const maps=[
  {name:'Луговая тропа',sky:['#559ed5','#d6f4bc'],ridge:'#7fbd99',top:'#8ce2a3',soil:'#426c6a',goal:1835,
    ground:[[0,430],[530,985],[1095,1470],[1565,1940]],ledges:[[250,319,105],[680,303,130],[1210,304,135],[1700,306,90]],hazards:[875,1390]},
  {name:'Янтарный каньон',sky:['#8a78bb','#fac680'],ridge:'#c68483',top:'#ffe2a0',soil:'#a55b65',goal:2010,
    ground:[[0,345],[465,750],[868,1230],[1360,1620],[1740,2120]],ledges:[[230,316,85],[595,305,96],[940,313,105],[1438,305,105],[1850,300,105]],hazards:[620,1120,1910]},
  {name:'Сад над облаками',sky:['#344276','#c5a2e6'],ridge:'#8888c6',top:'#c9effa',soil:'#52618f',goal:2300,
    ground:[[0,285],[416,720],[854,1150],[1273,1550],[1690,1935],[2068,2400]],ledges:[[171,309,90],[516,307,115],[965,301,92],[1360,308,90],[1771,305,104],[2180,304,105]],hazards:[630,1060,1470,1870,2215]}
];
for(const map of maps){
  map.blocks=[...map.ground.map(([a,b])=>[a,395,b-a,62]),...map.ledges.map(([x,y,w])=>[x,y,w,19])];
  map.coins=[
    ...map.ground.flatMap(([a,b])=>[a+83,b-72].map(x=>[x,362])),
    ...map.ledges.flatMap(([x,y,w])=>[x+w*.24,x+w*.72].map(at=>[at,y-24]))
  ];
}
const canvas=$('world'),g=canvas.getContext('2d'),w=800,h=450;
const held=new Set(),pointers=new Map();
let unlocked=0;
try{unlocked=Math.max(0,Math.min(2,Number(localStorage.getItem('rival-jump-level'))||0))}catch{}
let index=0,map=maps[0],mode='menu',player,found,camera,tries,elapsed,jump,grace,buffer;
function reset(){
  player={x:55,y:350,w:29,h:36,dx:0,dy:0,face:1};
  found=new Set();camera=0;tries=0;elapsed=0;jump=false;grace=0;buffer=0;
}
function overlay(next,title,info,button){
  mode=next;held.clear();pointers.clear();jump=false;buffer=0;
  $('overlay').hidden=next==='play';$('pause').hidden=next!=='play';
  $('title').textContent=title;$('info').textContent=info;$('start').textContent=button;
  showLevels();
}
function showLevels(){
  for(const [n,button] of levelButtons.entries()){
    button.disabled=n>unlocked||mode==='play';
    button.setAttribute('aria-pressed',String(n===index));
  }
}
const levelButtons=maps.map((item,n)=>{
  const b=document.createElement('button');b.textContent=(n+1)+' · '+item.name;
  b.onclick=()=>select(n);$('levels').append(b);return b;
});
function select(n){
  index=n;map=maps[n];reset();overlay('menu',map.name,'Доберись до маяка и собери монеты по пути.','Играть');
}
function finish(){
  const ids=new Set([...found].map(n=>index+':'+n));
  award(ids);
  if(index<2){
    unlocked=Math.max(unlocked,index+1);
    try{localStorage.setItem('rival-jump-level',String(unlocked))}catch{}
  }
  overlay('won',index===2?'Все уровни пройдены!':'Уровень пройден!',
    'Монеты: '+found.size+' из '+map.coins.length+' · промахи: '+tries,
    index<2?'Следующий уровень':'Сыграть ещё');
  $('start').focus();
}
$('start').onclick=()=>{
  if(mode==='won'){select((index+1)%maps.length);return}
  overlay('play','','','');canvas.focus();
};
canvas.tabIndex=-1;
const pause=()=>{if(mode==='play')overlay('pause','Пауза','Монеты текущего забега сохранены до продолжения.','Продолжить')};
$('pause').onclick=pause;
window.addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
const bindings={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'jump',Space:'jump',KeyW:'jump'};
function press(key){
  if(key==='jump'){if(!jump)buffer=.14;jump=true}else held.add(key);
}
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'){pause();return}
  if(mode!=='play'||!bindings[e.code])return;
  e.preventDefault();if(!e.repeat)press(bindings[e.code]);
});
window.addEventListener('keyup',e=>{
  const key=bindings[e.code];if(key==='jump')jump=false;else held.delete(key);
});
for(const button of document.querySelectorAll('[data-key]')){
  const key=button.dataset.key;
  button.onpointerdown=e=>{
    if(mode!=='play')return;
    e.preventDefault();pointers.set(e.pointerId,key);button.setPointerCapture(e.pointerId);
    if(key==='jump')press(key);
  };
  button.onlostpointercapture=e=>{pointers.delete(e.pointerId);if(key==='jump')jump=false};
}
const active=key=>held.has(key)||[...pointers.values()].includes(key);
function respawn(){
  player.x=55;player.y=350;player.dx=player.dy=0;camera=0;grace=buffer=0;tries++;
}
function step(dt){
  elapsed+=dt;
  const axis=Number(active('right'))-Number(active('left'));
  if(axis)player.face=axis;
  player.dx+=(axis*290-player.dx)*Math.min(1,dt*(axis?16:20));
  player.x=Math.max(0,player.x+player.dx*dt);
  grace-=dt;buffer-=dt;
  if(grace>0&&buffer>0){player.dy=-545;buffer=grace=0}
  if(!jump&&player.dy<-220)player.dy=-220;
  const past=player.y+player.h;
  player.dy+=1290*dt;player.y+=player.dy*dt;
  if(player.dy>=0){
    for(const [x,y,width] of map.blocks){
      if(past<=y+.1&&player.y+player.h>=y&&player.x+player.w>x&&player.x<x+width){
        player.y=y-player.h;player.dy=0;grace=.11;break;
      }
    }
  }
  for(const [i,[x,y]] of map.coins.entries()){
    if(Math.hypot(player.x+player.w/2-x,player.y+player.h/2-y)<31)found.add(i);
  }
  if(player.y>500||map.hazards.some(x=>player.x+player.w>x+4&&player.x<x+28&&player.y+player.h>379))respawn();
  if(player.x>=map.goal&&player.y<390)finish();
  camera=Math.max(0,Math.min(map.goal-w+110,player.x-w*.32));
}
function rect(x,y,width,height,r,color){
  g.fillStyle=color;g.beginPath();g.roundRect(x,y,width,height,r);g.fill();
}
function circle(x,y,r,color){
  g.fillStyle=color;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
}
function draw(){
  const sky=g.createLinearGradient(0,0,0,h);sky.addColorStop(0,map.sky[0]);sky.addColorStop(1,map.sky[1]);g.fillStyle=sky;g.fillRect(0,0,w,h);
  circle(635-camera*.035,107,55,'#fff4bfaa');
  for(let i=-1;i<9;i++){
    const x=i*163-(camera*.25%163),y=128+(i%3)*56;
    circle(x,y,31,'#fff9ec66');circle(x+35,y-12,38,'#fff9ec66');circle(x+72,y,26,'#fff9ec66');
  }
  g.fillStyle=map.ridge;g.beginPath();g.moveTo(0,h);
  for(let i=0;i<=w;i+=10)g.lineTo(i,312+42*Math.sin((i+camera*.42)/125)+18*Math.cos((i+camera*.42)/54));
  g.lineTo(w,h);g.fill();
  g.save();g.translate(-camera,0);
  for(const [x,y,width,height] of map.blocks){
    rect(x,y,width,height,7,map.soil);rect(x,y,width,10,5,map.top);
    for(let j=x+15;j<x+width-8;j+=23){circle(j,y+20,2,'#ffffff35');if(height>23)circle(j+6,y+39,3,'#17254638')}
  }
  for(const x of map.hazards){
    g.fillStyle='#b74c68';
    for(let i=0;i<3;i++){g.beginPath();g.moveTo(x+i*10,395);g.lineTo(x+i*10+5,372);g.lineTo(x+i*10+10,395);g.fill()}
  }
  for(const [i,[x,y]] of map.coins.entries()){
    if(found.has(i))continue;
    const height=y+Math.sin(elapsed*4+i)*3;
    circle(x,height,11,'#b97636');circle(x,height-1,9,'#ffce50');circle(x,height-1,6,'#ffec88');
    rect(x-2,height-6,4,9,2,'#d99532');
  }
  rect(map.goal+19,267,6,128,3,'#eee4ba');
  circle(map.goal+22,267,10,'#fee284');
  rect(map.goal+24,276,44,28,7,'#ee7495');
  circle(map.goal+43,290,6,'#ffdf95');
  g.translate(player.x+player.w/2,player.y);
  g.scale(player.face,1);
  const gait=Math.sin(elapsed*21)*Math.min(4,Math.abs(player.dx)*.018);
  rect(-13,27+gait,11,10,4,'#273052');rect(2,27-gait,11,10,4,'#273052');
  rect(-16,12,31,19,8,'#9e55cd');rect(-17,3,30,16,7,'#ff8c72');
  rect(-19,0,31,10,5,'#654ba9');rect(-18,7,38,5,2,'#654ba9');
  circle(6,15,2.5,'#292a4a');rect(-16,18,13,8,4,'#ffd068');
  g.restore();
  $('coins').textContent='● '+found.size+' / '+map.coins.length;
  $('wallet').textContent=status;
}
select(0);
let last=performance.now();
function frame(now){
  const dt=Math.min((now-last)/1000,.033);last=now;
  if(mode==='play')step(dt);
  draw();requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
