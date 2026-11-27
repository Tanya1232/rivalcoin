const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
if (tg?.isVersionAtLeast?.('6.9')) {
  tg.setHeaderColor("#100c1d");
  tg.setBackgroundColor("#100c1d");
}
const person = tg?.initDataUnsafe?.user;
const fmt = new Intl.NumberFormat('ru-RU');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const RETENTION = 7 * DAY;
const GOAL = 150;
const dayNumber = now => Math.floor(now / DAY);
const config = {
  apiKey: 'AIzaSyDfnuR07pt2IIWCScmI7H4aSy57XIHZpHg',
  authDomain: 'rivalcoin-738cc.firebaseapp.com',
  projectId: 'rivalcoin-738cc',
  storageBucket: 'rivalcoin-738cc.firebasestorage.app',
  messagingSenderId: '53292984166',
  appId: '1:53292984166:web:63d508b16bb8c04affcaa7'
};

function accountId() {
  if (person?.id) {
    try { sessionStorage.setItem('rival_session_uid', String(person.id)); } catch { /* Optional storage. */ }
    return String(person.id);
  }
  try {
    const session = sessionStorage.getItem('rival_session_uid');
    if (/^\d{1,20}$/.test(session ?? '')) return session;
    let demo = localStorage.getItem('rival_demo_uid');
    if (!/^demo_\d+$/.test(demo ?? '')) {
      demo = 'demo_' + crypto.getRandomValues(new Uint32Array(1))[0];
      localStorage.setItem('rival_demo_uid', demo);
    }
    return demo;
  } catch { return null; }
}

const uid = accountId();
const referral = /^(?:r_)?(\d{1,20})$/.exec(String(tg?.initDataUnsafe?.start_param ||
  new URLSearchParams(location.search).get('tgWebAppStartParam') || ''))?.[1];
const inviteUrl = /^\d{1,20}$/.test(uid ?? '') ? 'https://t.me/RivalCoin_bot/rivalcoin?startapp=r_' + uid : '';
const prefix = 'rival_outbox_' + uid + '_';
const queuedInMemory = new Map();
const defaults = {
  balance: 0, energy: 1000, maxEnergy: 1000, tapValue: 1, multitapCost: 100, energyCost: 200,
  lastEnergyUpdate: 0, lifetimeTaps: 0, dailyDay: -1, dailyTaps: 0, missionClaimDay: -1,
  dailyClaimDay: -1, dailyStreak: 0, referralCount: 0, passiveStartedAt: 0,
  passiveLastRewardAt: 0, passiveEndAt: 0, passiveHoursGranted: 0, passiveHoursPaid: 0
};
let state = { ...defaults, operationReceipts: {} };
let firestore, db, profile;
let ready = false, loading = false, syncing = false, failed = false, storageFailed = false;
let activeBatch, ads, adBusy = false, notice = '';
let haptics = Boolean(tg?.HapticFeedback);

function enqueue(operation) {
  queuedInMemory.set(operation.id, operation);
  try { localStorage.setItem(prefix + operation.id, JSON.stringify(operation)); }
  catch { storageFailed = true; }
}

function listOperations(now = Date.now()) {
  const found = new Map(queuedInMemory);
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const item = JSON.parse(localStorage.getItem(key));
      if (!item || key !== prefix + item.id) continue;
      if (item.at < now - RETENTION) { localStorage.removeItem(key); continue; }
      if (!found.has(item.id) || found.get(item.id).count <= item.count) found.set(item.id,item);
    }
  } catch { /* In-memory outbox remains available. */ }
  return [...found.values()].filter(item =>
    /^[-a-f\d]{36}$/.test(item.id) && item.at >= now - RETENTION &&
    ['tap','farm'].includes(item.type) && Number.isSafeInteger(item.count) && item.count > 0);
}

function acknowledge(item) {
  if (queuedInMemory.get(item.id)?.count <= item.count) queuedInMemory.delete(item.id);
  try {
    const key = prefix + item.id;
    if (JSON.parse(localStorage.getItem(key))?.count === item.count) localStorage.removeItem(key);
  } catch { /* Cloud receipt makes a retry safe. */ }
}

function normalize(cloud, now) {
  const next = {};
  for (const [key, initial] of Object.entries(defaults)) {
    const value = Number(cloud[key]);
    next[key] = Number.isSafeInteger(value) && value >= Math.min(0,initial) ? value : initial;
  }
  for (const key of ['maxEnergy','tapValue','multitapCost','energyCost']) next[key] = Math.max(defaults[key],next[key]);
  next.username = person?.username || cloud.username || 'Player';
  next.operationReceipts = cloud.operationReceipts && typeof cloud.operationReceipts === 'object'
    ? cloud.operationReceipts : {};
  const last = Math.min(now,next.lastEnergyUpdate || now);
  const seconds = Math.floor((now - last) / 1000);
  next.energy = Math.min(next.maxEnergy,next.energy + seconds * 3);
  next.lastEnergyUpdate = next.energy === next.maxEnergy ? now : last + seconds * 1000;
  if (next.dailyDay !== dayNumber(now)) { next.dailyDay = dayNumber(now); next.dailyTaps = 0; }
  next.passiveHoursGranted = Math.min(12,next.passiveHoursGranted);
  next.passiveHoursPaid = Math.min(next.passiveHoursGranted,next.passiveHoursPaid);
  if (next.passiveStartedAt && next.passiveEndAt) {
    const lastPaid = next.passiveLastRewardAt || next.passiveStartedAt + next.passiveHoursPaid * HOUR;
    const complete = Math.max(0,Math.floor((Math.min(now,next.passiveEndAt) - lastPaid) / HOUR));
    const payable = Math.min(complete,next.passiveHoursGranted - next.passiveHoursPaid);
    next.balance += payable * 100;
    next.passiveHoursPaid += payable;
    next.passiveLastRewardAt = lastPaid + payable * HOUR;
  }
  if (next.passiveEndAt <= now && next.passiveHoursPaid >= next.passiveHoursGranted) {
    next.passiveStartedAt = next.passiveLastRewardAt = next.passiveEndAt = 0;
    next.passiveHoursGranted = next.passiveHoursPaid = 0;
  }
  return next;
}

function addFarmHour(next, now) {
  if (next.passiveHoursGranted >= 12) return false;
  if (!next.passiveHoursGranted) next.passiveStartedAt = next.passiveLastRewardAt = next.passiveEndAt = now;
  next.passiveHoursGranted++;
  next.passiveEndAt += HOUR;
  return true;
}

async function sync(action, message) {
  if (!profile || syncing) return false;
  syncing = true;
  const now = Date.now();
  const queue = listOperations(now).sort((a,b) => a.at - b.at);
  render();
  try {
    const result = await firestore.runTransaction(db, async transaction => {
      const snapshot = await transaction.get(profile);
      const cloud = snapshot.data() ?? {};
      const next = normalize(cloud,now);
      const newPlayer = !Object.hasOwn(cloud,'username') && !cloud.referredBy && !cloud.referralProcessed;
      const inviterId = cloud.referralProcessed ? '' : cloud.pendingReferrer || (newPlayer && person?.id ? referral : '');
      const inviterRef = /^\d{1,20}$/.test(inviterId ?? '') && inviterId !== uid
        ? firestore.doc(db,'users',inviterId) : null;
      const inviter = inviterRef ? await transaction.get(inviterRef) : null;

      const receipts = Object.fromEntries(Object.entries(next.operationReceipts)
        .filter(([,receipt]) => receipt?.at >= now - RETENTION));
      const applied = [];
      let capped = false;
      for (const item of queue) {
        const delta = Math.max(0,item.count - (receipts[item.id]?.count || 0));
        if (item.type === 'farm' && delta && !addFarmHour(next,now)) continue;
        if (item.type === 'tap' && delta) {
          const taps = Math.min(delta,Math.floor(next.energy / next.tapValue));
          const earned = taps * next.tapValue;
          if (earned && next.energy === next.maxEnergy) next.lastEnergyUpdate = now;
          next.energy -= earned;
          next.balance += earned;
          next.lifetimeTaps += taps;
          if (dayNumber(item.at) === next.dailyDay) next.dailyTaps += taps;
          capped ||= taps < delta;
        }
        if (delta) receipts[item.id] = { at: item.at, count: item.count };
        applied.push(item);
      }
      next.operationReceipts = receipts;
      const actionApplied = !action || action(next,now);
      if (inviter?.exists()) {
        const data = inviter.data();
        transaction.update(inviterRef,{
          balance: (Number(data.balance) || 0) + 10000,
          referralCount: (Number(data.referralCount) || 0) + 1
        });
        next.pendingReferrer = '';
        next.referredBy = inviterId;
        next.referralProcessed = true;
      } else if (inviterRef) next.pendingReferrer = inviterId;
      const patch = Object.fromEntries(Object.entries(next).filter(([key,value]) =>
        key === 'operationReceipts' ? JSON.stringify(cloud[key] ?? {}) !== JSON.stringify(value) : cloud[key] !== value));
      if (Object.keys(patch).length) {
        if (snapshot.exists()) transaction.update(profile,patch);
        else transaction.set(profile,patch);
      }
      return { next, applied, actionApplied, capped };
    });
    state = result.next;
    result.applied.forEach(acknowledge);
    ready = true;
    failed = false;
    if (result.capped) notice = 'Часть тапов пропущена: не хватило энергии.';
    else if (!result.actionApplied) notice = 'Условия награды пока не выполнены.';
    else if (message) notice = message;
    return true;
  } catch (error) {
    failed = true;
    console.warn('RivalCoin sync:',error);
    return false;
  } finally {
    syncing = false;
    render();
  }
}

function render() {
  const now = Date.now();
  const view = normalize(state,now);
  const queue = listOperations(now);
  const taps = queue.filter(item => item.type === 'tap');
  const unconfirmed = item => Math.max(0,item.count - (state.operationReceipts[item.id]?.count || 0));
  const count = Math.min(taps.reduce((total,item) => total + unconfirmed(item),0),Math.floor(view.energy / view.tapValue));
  const dailyPending = Math.min(count,taps.filter(item => dayNumber(item.at) === view.dailyDay)
    .reduce((total,item) => total + unconfirmed(item),0));
  const energy = view.energy - count * view.tapValue;
  const balance = view.balance + count * view.tapValue;
  const rank = [[10000,'Мастер'],[2500,'Профи'],[500,'Райдер'],[100,'Оператор']]
    .find(([level]) => view.lifetimeTaps + count >= level);
  $('rank').textContent = rank?.[1] || 'Новичок';
  $('balance').textContent = ready ? fmt.format(balance) : '…';
  $('energy-text').textContent = ready ? fmt.format(energy) + ' / ' + fmt.format(view.maxEnergy) : '—';
  $('energy').max = view.maxEnergy;
  $('energy').value = ready ? energy : 0;
  $('tap-power').textContent = '+' + view.tapValue + ' за тап';
  $('coin-btn').disabled = !ready || energy < view.tapValue;
  const busy = !ready || syncing;
  $('multitap-sub').textContent = '+' + (view.tapValue + 1) + ' за тап · ' + fmt.format(view.multitapCost) + ' RIVAL';
  $('energy-sub').textContent = '+500 энергии · ' + fmt.format(view.energyCost) + ' RIVAL';
  $('buy-tap').disabled = busy || balance < view.multitapCost;
  $('buy-energy').disabled = busy || balance < view.energyCost;

  const progress = Math.min(GOAL,view.dailyTaps + dailyPending);
  const missionClaimed = view.missionClaimDay === view.dailyDay;
  const goal = progress + ' / ' + GOAL + ' тапов · +300 RIVAL';
  $('tap-mission').textContent = goal;
  $('daily-progress').textContent = missionClaimed ? 'Награда получена' : goal;
  $('claim-mission').disabled = busy || missionClaimed || progress < GOAL;
  $('claim-mission').textContent = missionClaimed ? 'Получено' : 'Забрать';
  const claimed = view.dailyClaimDay === view.dailyDay;
  const streak = view.dailyClaimDay === view.dailyDay - 1 ? view.dailyStreak + 1 : 1;
  $('streak').textContent = claimed ? 'Серия · ' + view.dailyStreak + ' дн.' :
    'День ' + streak + ' · +' + 100 * Math.min(7,streak) + ' RIVAL';
  $('claim-daily').disabled = busy || claimed;
  $('claim-daily').textContent = claimed ? 'Получено' : 'Забрать';
  $('invite-count').textContent = inviteUrl ? '10 000 RIVAL за нового игрока · приглашено: ' + fmt.format(view.referralCount)
    : 'Откройте RivalCoin в Telegram для приглашений.';

  const minutes = Math.max(0,Math.ceil((view.passiveEndAt - now) / 60000));
  $('farm-status').textContent = minutes ? view.passiveHoursGranted + ' / 12 ч · осталось ' +
    Math.floor(minutes / 60) + ' ч ' + minutes % 60 + ' мин' : '1 час за видео · 100 RIVAL за полный час';
  const waitingAd = queue.some(item => item.type === 'farm');
  $('farm-ad').disabled = busy || adBusy || waitingAd || view.passiveHoursGranted >= 12;
  $('farm-ad').textContent = adBusy ? 'Открываем видео…' : waitingAd ? 'Видео учтено · сохраняем'
    : view.passiveHoursGranted >= 12 ? 'Достигнут лимит 12 часов' : 'Видео · +1 час фарма';
  $('sync-status').textContent = !uid ? 'Для сохранений разрешите хранилище или откройте игру в Telegram.'
    : failed ? (ready ? 'Связи нет. Прогресс ждёт отправки.' : 'Подключаемся к профилю…')
    : !ready ? 'Загружаем профиль…'
    : storageFailed && queue.length ? 'Оставьте игру открытой до сохранения.'
    : queue.length ? 'Сохраняем прогресс…' : notice;
}

let combo = 0, comboTimer;
$('coin-btn').addEventListener('click', event => {
  const now = Date.now();
  if ($('coin-btn').disabled) return;
  if (!activeBatch || now - activeBatch.at >= 60000 || dayNumber(now) !== dayNumber(activeBatch.at)) {
    activeBatch = { id: crypto.randomUUID(), type: 'tap', count: 0, at: now };
  }
  activeBatch.count++;
  enqueue({ ...activeBatch });
  if (haptics) tg.HapticFeedback.impactOccurred('light');
  const particles = $('particles');
  const rect = particles.getBoundingClientRect();
  const pop = document.createElement('span');
  pop.className = 'tap-pop';
  pop.textContent = '+' + state.tapValue;
  pop.style.left = (event.detail ? event.clientX - rect.left : rect.width / 2) + 'px';
  pop.style.top = (event.detail ? event.clientY - rect.top : rect.height / 2) + 'px';
  particles.append(pop);
  if (particles.childElementCount > 24) particles.firstElementChild.remove();
  setTimeout(() => pop.remove(),650);
  combo++;
  $('combo').hidden = combo < 5;
  $('combo').textContent = 'КОМБО ×' + combo;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; $('combo').hidden = true; },660);
  render();
});

function purchase(type) {
  void sync(next => {
    const cost = type === 'tap' ? 'multitapCost' : 'energyCost';
    if (next.balance < next[cost] || next[cost] > Number.MAX_SAFE_INTEGER / 2) return false;
    next.balance -= next[cost];
    next[cost] *= 2;
    if (type === 'tap') next.tapValue++;
    else { next.maxEnergy += 500; next.energy += 500; }
    return true;
  },'Улучшение куплено.');
}
$('buy-tap').addEventListener('click',() => purchase('tap'));
$('buy-energy').addEventListener('click',() => purchase('energy'));
$('claim-daily').addEventListener('click',() => {
  void sync(next => {
    if (next.dailyClaimDay === next.dailyDay) return false;
    next.dailyStreak = next.dailyClaimDay === next.dailyDay - 1 ? next.dailyStreak + 1 : 1;
    next.dailyClaimDay = next.dailyDay;
    next.balance += 100 * Math.min(7,next.dailyStreak);
    return true;
  },'Ежедневный бонус получен.');
});
$('claim-mission').addEventListener('click',() => {
  void sync(next => {
    if (next.dailyTaps < GOAL || next.missionClaimDay === next.dailyDay) return false;
    next.missionClaimDay = next.dailyDay;
    next.balance += 300;
    return true;
  },'За миссию начислено 300 RIVAL.');
});
$('farm-ad').addEventListener('click',async () => {
  if ($('farm-ad').disabled) return;
  adBusy = true;
  render();
  try {
    ads ??= window.Adsgram.init({ blockId: '59640' });
    const result = await ads.show();
    if (!result?.done || result.error) throw Error('Incomplete ad');
    enqueue({ id: crypto.randomUUID(), type: 'farm', count: 1, at: Date.now() });
    void sync(undefined,'Добавлен час фарма.');
  } catch {
    notice = 'Видео сейчас недоступно или просмотр прерван.';
  } finally {
    adBusy = false;
    render();
  }
});

$('referral-link').textContent = inviteUrl;
if (inviteUrl) $('referral-link').href = inviteUrl;
$('copy-referral').disabled = $('share-referral').disabled = !inviteUrl;
$('copy-referral').addEventListener('click',async () => {
  try { await navigator.clipboard.writeText(inviteUrl); notice = 'Ссылка скопирована.'; }
  catch { notice = 'Ссылку можно скопировать вручную.'; }
  render();
});
$('share-referral').addEventListener('click',() => {
  const url = 'https://t.me/share/url?url=' + encodeURIComponent(inviteUrl);
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url,'_blank','noopener');
});
$('haptics').hidden = !haptics;
$('haptics').addEventListener('click',() => {
  haptics = !haptics;
  $('haptics').setAttribute('aria-pressed',String(haptics));
});
function showPage(name) {
  for (const page of document.querySelectorAll('.page')) page.hidden = page.id !== name;
  for (const button of document.querySelectorAll('[data-page]')) button.setAttribute('aria-pressed',String(button.dataset.page === name));
}
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click',() => showPage(button.dataset.page));
$('daily-shortcut').addEventListener('click',() => showPage('missions'));
for (const button of document.querySelectorAll('[data-game]')) {
  button.addEventListener('click',() => {
    if (listOperations().length) void sync();
    // Telegram's openLink hands off to an external browser. These paths share the Mini App origin.
    location.assign(new URL('/' + button.dataset.game + '/',location.origin));
  });
}

async function boot() {
  if (!uid || loading || profile) return;
  loading = true;
  try {
    const [{initializeApp},store] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
    ]);
    firestore = store;
    db = store.getFirestore(initializeApp(config));
    profile = store.doc(db,'users',uid);
    await sync();
  } catch (error) {
    failed = true;
    console.warn('RivalCoin startup:',error);
  } finally {
    loading = false;
    render();
  }
}
let runnerWallet;
let reconcilingRunner = false;
async function reconcileRunner() {
  if (reconcilingRunner || !uid) return;
  try {
    if (!Object.keys(localStorage).some(key => key.startsWith('rival_runner_reward_' + uid + '_'))) return;
    reconcilingRunner = true;
    const { createWallet } = await import('/subway-runner-3d/wallet.js');
    runnerWallet ??= createWallet(tg,() => {},false);
    await runnerWallet.flush();
    if (profile && !syncing && !runnerWallet.failed) await sync();
  } catch { /* The runner also retries rewards on its next launch. */ }
  finally { reconcilingRunner = false; }
}
function refresh() {
  if (profile) void sync();
  else void boot();
  void reconcileRunner();
}
window.addEventListener('focus',refresh);
window.addEventListener('online',refresh);
document.addEventListener('visibilitychange',() => {
  if (!document.hidden || listOperations().length) refresh();
});
setInterval(render,1000);
setInterval(() => {
  const now = Date.now();
  const view = normalize(state,now);
  const pending = listOperations(now).some(item => item.type === 'tap' || view.passiveHoursGranted < 12);
  if (pending || view.passiveHoursPaid !== state.passiveHoursPaid || view.passiveEndAt !== state.passiveEndAt || failed) refresh();
  else void reconcileRunner();
},3500);
render();
refresh();
