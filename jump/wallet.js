const tg=window.Telegram?.WebApp;
let uid=String(tg?.initDataUnsafe?.user?.id||'');
try{uid||=sessionStorage.getItem('rival_session_uid')||localStorage.getItem('rival_demo_uid')||''}catch{}
export const linked=/^(?:\d{1,20}|demo_\d{1,10})$/.test(uid);
const key='rival-jump-coins:'+uid;
let pending=new Set(),connection,busy=false;
export let status=linked?'':'Открой игру из RivalCoin, чтобы получить RVC на баланс.';
function read(){
  try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return []}
}
function write(ids){try{localStorage.setItem(key,JSON.stringify([...ids]))}catch{}}
async function connect(){
  const [{initializeApp},store]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')]);
  const db=store.getFirestore(initializeApp({apiKey:'AIzaSyDfnuR07pt2IIWCScmI7H4aSy57XIHZpHg',authDomain:'rivalcoin-738cc.firebaseapp.com',projectId:'rivalcoin-738cc',storageBucket:'rivalcoin-738cc.firebasestorage.app',messagingSenderId:'53292984166',appId:'1:53292984166:web:63d508b16bb8c04affcaa7'}));
  return {db,store,ref:store.doc(db,'users',uid)};
}
export function award(ids){
  if(!linked||!ids.size)return;
  pending=new Set([...pending,...read(),...ids]);
  write(pending);status='Сохраняем монеты…';void flush();
}
async function flush(){
  if(!linked||busy)return;
  const batch=new Set([...pending,...read()].filter(id=>typeof id==='string'&&/^[0-2]:[0-9]{1,2}$/.test(id)));
  if(!batch.size)return;
  busy=true;
  try{
    connection??=connect();
    const {db,store,ref}=await connection;
    const earned=await store.runTransaction(db,async tx=>{
      const snap=await tx.get(ref),cloud=snap.data()||{};
      const known=new Set(cloud.jumpCoinsV1||[]);
      let reward=0;
      for(const id of batch)if(!known.has(id)){known.add(id);reward++}
      if(reward){
        const patch={jumpCoinsV1:[...known],balance:(Number(cloud.balance)||0)+reward};
        if(snap.exists())tx.update(ref,patch);else tx.set(ref,patch);
      }
      return reward;
    });
    pending=new Set([...pending,...read()].filter(id=>!batch.has(id)));
    write(pending);
    status=earned?'На баланс RivalCoin начислено '+earned+' RVC.':'Эти монеты уже были начислены.';
  }catch{connection=null;status='Начисление ждёт подключения.'}finally{busy=false}
}
void flush();
setInterval(flush,5000);
window.addEventListener('online',flush);
