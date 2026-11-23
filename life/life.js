import {actions,tracks,goals,HOUR,DAY,create,advance,lock,claimable,utcDay} from './sim.js';
const $=id=>document.getElementById(id);
const tg=window.Telegram?.WebApp;
tg?.ready();tg?.expand();
tg?.BackButton?.show();
tg?.BackButton?.onClick(()=>location.assign('../'));
let uid=String(tg?.initDataUnsafe?.user?.id||'');
try{uid||=sessionStorage.getItem('rival_session_uid')||localStorage.getItem('rival_demo_uid')||''}catch{}
const shared=/^(?:\d{1,20}|demo_\d{1,10})$/.test(uid);
const cacheKey='rival-life-v1:'+(shared?uid:'guest');
let state=null,ready=false,busy=false,connection,nextRetry=0,notice='';
try{state=JSON.parse(localStorage.getItem(cacheKey)||'null')}catch{}
function cache(){
  try{if(state)localStorage.setItem(cacheKey,JSON.stringify(state))}catch{}
}
async function connect(){
  const [{initializeApp},store]=await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
  ]);
  const db=store.getFirestore(initializeApp({
    apiKey:'AIzaSyDfnuR07pt2IIWCScmI7H4aSy57XIHZpHg',authDomain:'rivalcoin-738cc.firebaseapp.com',
    projectId:'rivalcoin-738cc',storageBucket:'rivalcoin-738cc.firebasestorage.app',
    messagingSenderId:'53292984166',appId:'1:53292984166:web:63d508b16bb8c04affcaa7'
  }));
  return {store,db,ref:store.doc(db,'users',uid)};
}
function apply(cloud,action,now){
  let updated=cloud.lifeV1 ? advance(cloud.lifeV1,now) : null;
  let reward=0,message='';
  const today=utcDay(now);
  const deposit=day=>{
    const amount=claimable(day);
    if(amount){day.claimed=(day.claimed||0)+amount;reward+=amount}
  };
  if(updated&&shared)for(const [date,day] of Object.entries(updated.daily))if(date<today)deposit(day);
  if(action.type==='create'&&!updated)updated=create(action.name,action.gender,action.track,now);
  if(action.type==='start'&&updated){
    message=lock(updated,action.id);
    if(!message){
      const entry=actions[action.id];
      const cost=Math.min(updated.cash,entry.cost||0);
      updated.cash-=cost;
      updated.task={type:action.id,start:now,end:now+entry.duration,cost};
    }
  }
  if(action.type==='cancel'&&updated?.task){
    updated.cash+=updated.task.cost;
    delete updated.task;
    message='Действие отменено.';
  }
  if(action.type==='claim'&&updated&&shared)deposit(updated.daily[today]);
  return {updated,reward,message};
}
async function sync(action={type:'refresh'}){
  if(busy)return;
  busy=true;render();
  try{
    let result;const now=Date.now();
    if(shared){
      connection??=connect();
      const {store,db,ref}=await connection;
      result=await store.runTransaction(db,async tx=>{
        const snapshot=await tx.get(ref);
        const cloud=snapshot.data()||{};
        const result=apply(cloud,action,now);
        if(result.updated){
          const patch={lifeV1:result.updated};
          if(result.reward)patch.balance=(Number(cloud.balance)||0)+result.reward;
          if(snapshot.exists())tx.update(ref,patch);
          else tx.set(ref,patch);
        }
        return result;
      });
    }else{
      let saved=state;
      try{saved=JSON.parse(localStorage.getItem(cacheKey)||'null')||state}catch{}
      result=apply({lifeV1:saved},action,now);
    }
    state=result.updated;
    cache();ready=true;
    if(result.reward)notice='На баланс RivalCoin начислено '+result.reward+' RVC.';
    else if(action.type!=='refresh'||notice.startsWith('Нет связи'))notice=result.message;
  }catch(error){
    connection=null;ready=false;nextRetry=Date.now()+15000;
    notice='Нет связи с профилем. Повторим подключение автоматически.';
    console.warn('Life profile:',error);
  }finally{busy=false;render()}
}
const number=new Intl.NumberFormat('ru-RU');
const timeFormat=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const dateFormat=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'});
function duration(ms){
  const seconds=Math.max(0,Math.ceil(ms/1000));
  if(seconds>=3600)return Math.floor(seconds/3600)+' ч '+Math.floor(seconds%3600/60)+' мин';
  return Math.floor(seconds/60)+' мин '+seconds%60+' с';
}
const meters=Object.entries({food:'Сытость',mood:'Настроение',health:'Здоровье',energy:'Энергия'}).map(([id,label])=>{
  const item=document.createElement('div');item.className='meter';
  const caption=document.createElement('span'),bar=document.createElement('progress');bar.max=100;bar.setAttribute('aria-label',label);
  item.append(caption,bar);$('needs').append(item);
  return {id,label,caption,bar};
});
const entries=Object.entries(actions).map(([id,a])=>{
  const b=document.createElement('button'),title=document.createElement('strong'),sub=document.createElement('small');
  title.textContent=a.label;b.type='button';b.append(title,sub);
  (a.group==='care'?$('home-actions'):$('career-actions')).append(b);
  b.onclick=()=>void sync({type:'start',id});
  return {id,a,b,sub};
});
const dailyRows=Object.entries(goals).map(([id,[label,value]])=>{
  const li=document.createElement('li');$('daily-goals').append(li);return {id,label,value,li};
});
function render(){
  const now=Date.now();
  $('time').textContent=timeFormat.format(now);$('date').textContent=dateFormat.format(now);
  $('status').textContent=notice||(busy?'Сохраняем…':!ready?'Загружаем профиль…':!shared?'Гостевой режим на этом устройстве. Для RVC открой игру из RivalCoin.':'');
  $('setup').hidden=Boolean(state)||!ready;
  $('setup').querySelector('button').disabled=busy;
  $('game').hidden=!state;
  if(!state)return;
  const view=advance(state,now);
  const course=tracks[view.track];
  const age=18+Math.floor(Math.max(0,now-view.born)/(365.2425*DAY));
  $('name').textContent=view.name+' · '+age+' лет';
  $('track').textContent=(view.gender==='f'?'Девушка':'Парень')+' · '+course[0];
  $('career').textContent=course[view.level]||(view.education>=3?'Выпускник':'Студент');
  $('cash').textContent=number.format(view.cash)+' ₽';
  $('career-progress').textContent=view.level?(view.level===4?'Высшая должность':'Опыт '+view.xp+' / '+view.level*4+' до повышения')
    : 'Учёба '+view.education+' / 3 занятий до собеседования';
  for(const m of meters){const n=Math.round(view[m.id]);m.caption.textContent=m.label+' · '+n+'%';m.bar.value=n}
  const task=state.task;
  $('activity').hidden=!task;
  if(task){
    $('activity-name').textContent=actions[task.type].label;
    $('activity-time').textContent=task.end>now?'Осталось '+duration(task.end-now)+' · до '+timeFormat.format(task.end):'Завершено · сохраняем результат';
    $('activity-bar').value=Math.min(1,Math.max(0,(now-task.start)/(task.end-task.start)));
  }
  $('cancel').disabled=busy||!ready||!task||task.end<=now;
  for(const e of entries){
    const reason=lock(view,e.id);
    e.b.disabled=busy||!ready||Boolean(state.task)||Boolean(reason);
    e.sub.textContent=duration(e.a.duration).replace(' 0 с','')+(e.a.cost?' · '+(e.id==='meal'&&view.cash<12?'экономный обед':e.a.cost+' ₽'):'')+(reason&&!view.task?' · '+reason:'');
  }
  const today=view.daily[utcDay(now)];
  for(const {id,label,value,li} of dailyRows)li.textContent=(today?.groups?.includes(id)?'✓ ':'○ ')+label+' · '+value+' RVC';
  const credit=claimable(today);
  $('claim').disabled=!shared||!ready||busy||!credit||Boolean(task&&task.end<=now);
  $('claim').textContent=credit?'Получить '+credit+' RVC':today?.claimed?'Получено сегодня: '+today.claimed+' RVC':'Получить RVC';
}
$('setup').onsubmit=event=>{
  event.preventDefault();const fields=new FormData(event.currentTarget),name=String(fields.get('name')||'').trim();
  if(!name)return;
  void sync({type:'create',name,gender:fields.get('gender'),track:fields.get('track')});
};
$('claim').onclick=()=>void sync({type:'claim'});
$('cancel').onclick=()=>void sync({type:'cancel'});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{
  for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-pressed',String(button===b));
  for(const item of document.querySelectorAll('[data-page]'))item.hidden=item.dataset.page!==b.dataset.tab;
};
window.addEventListener('online',()=>void sync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync()});
setInterval(()=>{
  render();
  if(Date.now()>=nextRetry&&(!ready||(state?.task&&state.task.end<=Date.now())||
      (state&&utcDay(state.updated)!==utcDay(Date.now()))))void sync();
},1000);
void sync();
