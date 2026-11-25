const $ = (selector) => document.querySelector(selector);
const DAY = '2026-11-23';
const SESSION = 'workout-' + DAY;
const device = new URL(location.href).searchParams.get('device') === 'B' ? 'B' : 'A';
const storageKey = 'levelmaxing-demo-v1-' + device;
const emptyState = { epoch:null, cursor:0, base:{}, pending:[], conflicts:[], offline:false, restUntil:0, theme:'light' };
let local = JSON.parse(localStorage.getItem(storageKey) || 'null') || emptyState;
let syncBusy = false;
let reachable = false;
let syncError = '';
let storageError = '';
let loseNextResponse = false;
let lastDialogFocus;
let noticeTimeout;
let restTimer;
let diaryDate = DAY;
let foodQuery = '';
const formatNumber = new Intl.NumberFormat('en-IN',{ maximumFractionDigits:1 });
const n = (v) => formatNumber.format(v);
const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const dateLabel = (v) => new Date(v + 'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
const id = () => crypto.randomUUID();
const byDate = (a,b) => a.data.date.localeCompare(b.data.date);
const option = (value,label=value) => '<option value="' + h(value) + '">' + h(label) + '</option>';
const button = (label,action,variant='',key='') => '<button type="button" class="button ' + variant + '" data-do="' + action + '" data-id="' + h(key) + '">' + h(label) + '</button>';
const viewLink = (label,view,variant='') => '<a class="button ' + variant + '" href="#' + view + '">' + h(label) + '</a>';
const groups = [
  ['Workspace',[['today','Today','▦'],['training','Train','◫'],['nutrition','Eat','◉'],['progress','Progress','↗']]],
  ['Explore',[['coach','Coach','✧'],['library','Library','▤'],['settings','Settings','⚙']]]
];
const labels = Object.fromEntries(groups.flatMap(([,routes]) => routes.map(([key,label]) => [key,label])));
const defaultExercises = ['Incline dumbbell press','Chest-supported row','Seated shoulder press','Lat pulldown'];
const foods = [
  {name:'Chicken tikka rice bowl',calories:580,protein:42,carbs:69,fat:15},
  {name:'Dal, rice & salad',calories:460,protein:18,carbs:70,fat:10},
  {name:'Paneer bhurji wrap',calories:490,protein:23,carbs:45,fat:24},
  {name:'Greek yogurt, oats & banana',calories:445,protein:31,carbs:55,fat:11},
  {name:'Banana & peanut butter',calories:285,protein:7,carbs:28,fat:15},
  {name:'Masala chana',calories:268,protein:13,carbs:41,fat:7}
];
const lessons = [
  ['Choosing a starting weight','Training','Begin with a load you can move with control through the planned range. Keep a record of the load and reps to make your next session easier to plan.'],
  ['A useful rest timer','Training','Let your breathing settle and give yourself time to prepare for the next set. Use the timer as a reference and adjust it to your training plan.'],
  ['Portions and recipe yield','Nutrition','Weigh the finished recipe. A portion is the fraction of the finished weight you serve. Log ingredient quantities before estimating each serving.'],
  ['Understanding weight trends','Progress','A single measurement can fluctuate. Look at measurements taken in similar conditions over time, and use other measures that matter to you.']
];
function commit(updates) {
  const next = { ...local, ...updates };
  try { localStorage.setItem(storageKey,JSON.stringify(next)); }
  catch {
    storageError = 'Local storage is full or unavailable. Keep this tab open and free space before saving.';
    updateSyncLabel();
    throw new Error(storageError);
  }
  local = next;
  storageError = '';
}
function projected() {
  const records = { ...local.base };
  for (const op of local.pending) {
    records[op.id] = { id:op.id, kind:op.kind, version:op.expected+1,
      deleted:op.action==='delete', data:op.action==='delete' ? null : op.data, queued:true };
  }
  return records;
}
const rows = (kind) => Object.values(projected()).filter(r => !r.deleted && r.kind === kind);
const lookup = (key) => Object.hasOwn(projected(),key) ? projected()[key] : undefined;
const profile = () => lookup('profile')?.data || { name:'Aarav',goal:'Build strength',units:'kg',language:'English',reminders:false };
const session = () => lookup(SESSION)?.data;
const finished = () => session()?.status === 'completed';
const activePlan = () => rows('program').filter(r=>r.data.date<=DAY).sort(byDate).at(-1)?.data;
function enqueue(kind,data,key=id(),action='put') {
  const current = lookup(key);
  const op = { epoch:local.epoch, opId:id(), clientId:device, id:key, kind, action, expected:current?.version ?? 0 };
  if (action==='put') op.data = data;
  if (loseNextResponse) { op.dropTestReply = true; loseNextResponse = false; }
  commit({ pending:[...local.pending,op] });
  render();
  void sync();
}
async function request(path,opts={}) {
  const response = await fetch(path,{ ...opts, cache:'no-store',signal:AbortSignal.timeout(3500) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.code),{ payload,status:response.status });
  return payload;
}
function applyRow(base,row) {
  const old = Object.hasOwn(base,row.id) ? base[row.id] : undefined;
  if (!old || row.version >= old.version) base[row.id] = row;
}
async function snapshot() {
  const result = await request('/api/snapshot');
  if (local.offline) return;
  const base = Object.fromEntries(result.records.map(r => [r.id,r]));
  const stale = local.epoch && local.epoch !== result.epoch;
  const pending = stale ? [] : local.pending.map(op => op.epoch ? op : { ...op,epoch:result.epoch });
  const conflicts = stale ? [...local.conflicts,...local.pending.map(op => ({ op, message:'The server history changed. Review this draft.', code:'reset_required' }))] : local.conflicts;
  commit({ epoch:result.epoch,cursor:result.cursor,base,pending,conflicts });
}
async function pull() {
  let high = null;
  do {
    let url = '/api/pull?epoch=' + encodeURIComponent(local.epoch) + '&cursor=' + local.cursor;
    if (high !== null) url += '&high=' + high;
    const result = await request(url);
    if (local.offline) return;
    if (result.changes.length) {
      const base = { ...local.base };
      result.changes.forEach(({row}) => applyRow(base,row));
      commit({ base,cursor:result.cursor });
    }
    high = result.more ? result.high : null;
  } while (high !== null);
}
async function sync() {
  if (syncBusy || local.offline) return;
  syncBusy = true;
  const before = local;
  updateSyncLabel();
  try {
    if (!local.epoch) await snapshot();
    try { if (!local.offline) await pull(); }
    catch (e) { if (e.payload?.code === 'reset_required') await snapshot(); else throw e; }
    while (!local.offline && local.pending.length) {
      const op = local.pending[0];
      let result;
      try {
        result = await request('/api/push',{ method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(op) });
      } catch (e) {
        if (e.payload?.code === 'reset_required') { await snapshot(); continue; }
        if (![409,422].includes(e.status)) throw e;
        if (local.offline) break;
        const base = { ...local.base };
        if (e.payload.current) applyRow(base,e.payload.current);
        commit({base, pending:local.pending.filter(x => x.opId !== op.opId),
          conflicts:[...local.conflicts,{ op,message:e.message,code:e.payload.code }] });
        announce('A change needs your review. Open Sync.');
        continue;
      }
      if (local.offline) break;
      const base = { ...local.base };
      applyRow(base,result.row);
      commit({base,pending:local.pending.filter(x => x.opId !== op.opId)});
    }
    if (!local.offline) await pull();
    reachable = true;
    syncError = '';
  } catch {
    reachable = false;
    syncError = 'Server unavailable. Saved changes will retry.';
  } finally {
    syncBusy = false;
    if (before !== local) render();
    else updateSyncLabel();
  }
}
function updateSyncLabel() {
  const label = local.offline ? 'Offline' : local.conflicts.length ? local.conflicts.length + ' to review' :
    !reachable && syncError ? 'Reconnect' : local.pending.length ? local.pending.length + ' queued' :
    local.epoch ? 'Synced' : 'Connecting';
  $('#sync-label').textContent = label;
  $('#sync-status').dataset.state = storageError || local.conflicts.length ? 'error' :
    local.offline || !reachable || local.pending.length ? 'waiting' : 'ready';
  $('#sync-status').title = storageError || syncError || 'Open Sync and devices';
  $('#device-label').textContent = 'Device ' + device + ' · Revision ' + local.cursor;
}
function announce(message) {
  const box = $('#notice');
  box.textContent = message;
  box.classList.add('visible');
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => box.classList.remove('visible'),3200);
}
function pageHead(title,desc='',actions='',kicker='') {
  return '<div class="page-head"><div>' + (kicker?'<p class="kicker">'+h(kicker)+'</p>':'') + '<h1>' + h(title) + '</h1>' + (desc?'<p class="muted">'+h(desc)+'</p>':'') + '</div>' + (actions?'<div class="actions">'+actions+'</div>':'') + '</div>';
}
function panel(title,items,actions='',extra='') {
  return '<section class="panel panel-inset '+extra+'"><div class="panel-head"><h2>'+h(title)+'</h2>'+actions+'</div>'+items+'</section>';
}
function list(items,empty='Nothing logged yet.') {
  return items.length ? '<ul class="list">'+items.join('')+'</ul>' : '<p class="empty">'+h(empty)+'</p>';
}
function row(name,meta='',end='',icon='') {
  return '<li class="row"><div class="row-main">'+(icon?'<span class="row-icon" aria-hidden="true">'+icon+'</span>':'')+'<div><div class="row-title">'+h(name)+'</div>'+(meta?'<span class="row-meta">'+h(meta)+'</span>':'')+'</div></div><div class="actions">'+end+'</div></li>';
}
const escaped = (text) => '<span class="row-end">'+h(text)+'</span>';
function totals(date) {
  const dayRows = rows('meal').filter(r => r.data.date === date);
  return ['calories','protein','carbs','fat'].map(k => dayRows.reduce((sum,r) => sum+r.data[k],0));
}
function meter(value,target,label,variant='') {
  return '<progress class="progress-track '+variant+'" aria-label="'+h(label)+'" max="'+target+'" value="'+Math.min(value,target)+'"></progress>';
}
function nutritionSummary(date) {
  const [cal,protein,carbs,fat] = totals(date);
  const macro = (value,target,label,variant) => '<div class="macro"><span>'+label+'</span><strong>'+n(value)+' / '+target+' g</strong>'+meter(value,target,label,variant)+'</div>';
  return '<section class="panel panel-inset overview"><div><div class="panel-head"><div><p class="kicker">Daily intake</p><h2>Nutrition overview</h2></div><span class="row-icon" aria-hidden="true">◉</span></div><div class="big-data"><strong>'+n(cal)+'</strong><small>/ 2,200 kcal</small></div>'+
    meter(cal,2200,'Calories logged')+'<div class="macros">'+macro(protein,145,'Protein','')+macro(carbs,255,'Carbs','carbs')+macro(fat,66,'Fat','fat')+'</div></div><div class="actions">'+button('＋ Log food','food','solid')+viewLink('See diary','nutrition')+'</div></section>';
}
function mealRows(date,editable=false) {
  return list(rows('meal').filter(r => r.data.date===date).map(r => row(r.data.name,r.data.slot+' · '+r.data.source+(r.queued?' · Queued':''),
    escaped(n(r.data.calories)+' kcal')+(editable?button('Edit','edit-meal','compact',r.id):''),'◉')), 'No meals for this day. Log food to start.');
}
function weightPanel() {
  const weights = rows('weight').sort(byDate).slice(-12);
  const first = weights[0]?.data, last = weights.at(-1)?.data;
  const lb = profile().units === 'lb';
  const weight = (kg) => n(kg * (lb ? 2.2046226 : 1));
  return panel('Weight trend',last ? '<div class="weight-data"><strong>'+weight(last.kg)+'</strong><small>'+(lb?'lb':'kg')+'</small>'+
    (weights.length>1?'<span class="delta">'+((last.kg-first.kg)>0?'+':'')+weight(last.kg-first.kg)+' '+(lb?'lb':'kg')+'</span>':'')+'</div>'+
    '<canvas class="trend" role="img" aria-label="'+h(weights.map(r => dateLabel(r.data.date)+' '+weight(r.data.kg)+(lb?' pounds':' kilograms')).join(', '))+'"></canvas><div class="chart-labels"><span>'+dateLabel(first.date)+'</span><span>'+dateLabel(last.date)+'</span></div>' : '<p class="empty">Add a measurement to see your trend.</p>', button('＋ Log weight','weight','compact'));
}
function today() {
  const name = profile().name;
  const plan = activePlan();
  return pageHead('Today','',button('＋ Quick log','quick','solid'),'Monday, 23 November')+
    '<div class="today-layout"><section class="hero"><p class="kicker">'+(finished()?'Workout complete':session()?'Workout in progress':'Today’s workout')+'</p><h2>'+h(session()?.name||plan?.name||'Upper body strength')+'</h2><p>'+(session()?.exercises?.length||plan?.exercises.length||4)+' exercises · Strength session</p>'+
    button(finished()?'View session ↗':session()?'Resume workout ↗':'Start workout ↗','start-workout','primary')+'</section>'+nutritionSummary(DAY)+'</div>'+
    '<div class="today-layout dash-bottom">'+panel('Food diary',mealRows(DAY),viewLink('View diary ↗','nutrition','compact'))+weightPanel()+'</div>'+
    '<div class="dash-bottom">'+panel('Weekly check-in','<p class="muted">Review your training and nutrition for the week'+(name?', '+h(name):'')+'.</p>',button('Open check-in','checkin'))+'</div>';
}
function training() {
  const plan = activePlan();
  const sets = rows('set').filter(r => r.data.session===SESSION);
  const active = !!session();
  const exercises = session()?.exercises || plan?.exercises || defaultExercises;
  const title = session()?.name || plan?.name || 'Upper body strength';
  const controls = active && !finished() ? '<div class="actions">'+button('Log a set','set','primary')+button('Start 90s rest','rest')+button('Finish workout','finish','solid')+'</div><p id="rest-clock" class="detail"></p>' : '';
  const work = panel(title,'<div class="stack-sm"><p class="muted">'+h(exercises.join(' · '))+'</p>'+controls+
    list(sets.map(r=>row(r.data.exercise,n(r.data.load * (profile().units==='lb'?2.2046226:1))+' '+profile().units+' × '+r.data.reps+' reps'+(r.queued?' · Queued':''),finished()?'':button('Edit set','edit-set','compact',r.id))), active?'No sets logged yet.':'Start a workout to log your first set.')+'</div>',active||session()?'<span class="inline-flag">'+(finished()?'Complete':'In progress')+'</span>':button('Start workout','start-workout','primary'),'current-session');
  const history = panel('Session history',list(rows('session').filter(r=>r.data.status==='completed').sort(byDate).reverse().map(r=>row(r.data.name,dateLabel(r.data.date),escaped(r.queued?'Queued':'Complete'))),'Completed workouts appear here.'));
  return pageHead('Training','Plan your workouts and log each set.',button('Build a program','program','solid')+button('Substitute exercise','substitute'))+'<div class="columns"><div class="stack">'+work+history+'</div><div class="stack">'+panel('Program',list([row(plan?.name||'Strength foundations',(plan?.days||3)+' days per week',button('Edit','program'))]))+panel('Exercise library',list(exercises.map(e=>row(e,'Exercise guide',button('View','exercise','compact',e)))))+'</div></div>';
}
function nutrition() {
  const recipeRows = rows('recipe').map(r=>row(r.data.name,n(r.data.yield)+' g cooked yield',button('Open','recipe-detail','compact',r.id)));
  return pageHead('Nutrition','Log meals, review portions, and save recipes.',button('＋ Log food','food','solid'))+
    '<div class="columns"><div class="stack">'+panel('Food diary', '<form id="date-form"><label class="field">Diary date<input type="date" name="date" value="'+diaryDate+'"></label></form>'+mealRows(diaryDate,true))+panel('Recipes',list(recipeRows,'Create a recipe to reuse its ingredient totals.')+'<div class="actions">'+button('Create recipe','recipe')+button('Preview URL import','import-recipe')+'</div>')+
    panel('Grocery prices',list(rows('grocery').map(r=>row(r.data.name,r.data.store+' · '+dateLabel(r.data.date),escaped('₹'+n(r.data.price)+' / '+r.data.unit))),'No regional feed connected. Save a price you observed.'),button('Record price','grocery'))+'</div><div class="stack">'+nutritionSummary(diaryDate)+panel('Saved foods',list(foods.slice(0,4).map((f,i)=>row(f.name,n(f.calories)+' kcal per sample serving',button('Log','food-preset','compact',String(i))))))+'</div></div>';
}
function progress() {
  const weights = rows('weight').sort(byDate).reverse();
  return pageHead('Progress','Review trends across training and daily habits.',button('＋ Log activity','activity','solid')+button('Log weight','weight'))+
    '<div class="columns"><div class="stack">'+weightPanel()+panel('Measurements',list(weights.map(r=>row(n(r.data.kg*(profile().units==='lb'?2.2046226:1))+' '+profile().units,dateLabel(r.data.date),button('Edit','weight','compact',r.id)))))+
    panel('Progress photos',list(rows('photo').map(r=>row(r.data.name,dateLabel(r.data.date),'','◫')),'No photo references recorded.'),button('Add sample photo','photo'))+'</div><div class="stack">'+
    panel('Workout and activity history',list([...rows('session').filter(r=>r.data.status==='completed'),...rows('activity')].sort(byDate).reverse().map(r=>row(r.data.name,dateLabel(r.data.date),escaped(r.data.minutes?n(r.data.minutes)+' min':'Workout complete'),'↗'))))+
    panel('Cycle log',list(rows('cycle').map(r=>row(r.data.event,dateLabel(r.data.date),button('Remove','delete','danger compact',r.id))),'Optional private log. No entries.'),button('Log event','cycle'))+'</div></div>';
}
function coach() {
  return pageHead('Coach','Review training guidance and decide what to apply.',button('Weekly check-in','checkin','solid'))+
    '<div class="columns"><div class="stack">'+panel('Ask the coach','<p class="detail">Preview mode uses reviewed sample responses.</p><form id="coach-form"><label class="field">Your question<textarea name="question" required maxlength="300" placeholder="How should I track a workout?"></textarea></label><div class="actions"><button class="button primary">Preview response</button></div><p id="coach-answer" class="help" hidden></p></form>')+panel('Program proposal','<p class="muted">Preview a four-exercise plan. Review the schedule and exercise choices before you save it.</p>',button('Review proposal','program-proposal'))+'</div><div class="stack">'+panel('Check-in history',list(rows('checkin').sort(byDate).reverse().map(r=>row(r.data.focus,dateLabel(r.data.date),escaped(r.data.status)))))+'</div></div>';
}
function library() {
  const saved = new Set(rows('bookmark').map(r=>r.data.name));
  return pageHead('Library','Exercise guides and short lessons.')+
    '<div class="columns">'+panel('Lessons',list(lessons.map(([name,type],i)=>row(name,type+(saved.has(name)?' · Saved':''),button('Read','lesson','compact',String(i)),'▤'))))+
    panel('Exercises',list(defaultExercises.map(name=>row(name,'Strength training',button('Open','exercise','compact',name),'◫'))))+'</div>';
}
function settings() {
  return pageHead('Settings','Manage your profile, devices, and data.',button('Edit profile','profile','solid'))+
    '<div class="columns"><div class="stack">'+panel('Your profile',list([row(profile().name,profile().goal+' · '+profile().units+' · '+profile().language,button('Edit','profile')),row('Appearance','Stored on this device',button('Toggle theme','theme')),row('Sync and devices','Device '+device,button('Open sync','sync-panel'))]))+
    panel('Data and support',list([row('Demo workspace export','Download the entries visible on this device.',button('Download JSON','export')),row('Account deletion and support','Production account workflow',button('Preview options','privacy')),row('Content operations','Demo operator view',button('Open console','admin'))]))+'</div>'+
    '<div class="stack">'+panel('Connections',list(['Apple Health','Health Connect / Samsung Health','Strava','Apple Watch','Live Activities'].map(name=>row(name,'Native or provider connection',button('View','connection','compact',name)))))+
    panel('Subscription',list([row('Membership','Purchase and restore flow',button('Preview','membership'))]))+'</div></div>';
}
const views = {today,training,nutrition,progress,coach,library,settings};
function chart() {
  const canvas = $('.trend');
  if (!canvas) return;
  const entries = rows('weight').sort(byDate).slice(-12);
  const weights = entries.map(r=>r.data.kg);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const c = canvas.getContext('2d');
  c.scale(ratio,ratio);
  const width=rect.width, height=rect.height;
  const css=getComputedStyle(document.documentElement);
  c.strokeStyle=css.getPropertyValue('--line');
  for (const f of [.2,.48,.76]) {
    c.beginPath(); c.moveTo(0,height*f); c.lineTo(width,height*f); c.stroke();
  }
  const low=Math.min(...weights)-.18, high=Math.max(...weights)+.18;
  const dates=entries.map(r=>Date.parse(r.data.date));
  const timespan=Math.max(1,dates.at(-1)-dates[0]);
  const pts=weights.map((v,i)=>[6+(dates[i]-dates[0])*(width-12)/timespan,10+(high-v)*(height-21)/(high-low)]);
  if (pts.length>1) {
    const fill=c.createLinearGradient(0,0,0,height);
    fill.addColorStop(0,'#9cb95159'); fill.addColorStop(1,'#9cb95105');
    c.beginPath(); pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
    c.lineTo(pts.at(-1)[0],height); c.lineTo(pts[0][0],height); c.closePath();
    c.fillStyle=fill; c.fill();
  }
  c.beginPath(); pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
  c.strokeStyle=css.getPropertyValue('--success'); c.lineWidth=2.4; c.stroke();
  for (const [x,y] of pts) { c.beginPath(); c.arc(x,y,3,0,Math.PI*2); c.fillStyle=c.strokeStyle; c.fill(); }
}
function render() {
  const raw = location.hash.slice(1);
  const view = Object.hasOwn(views,raw)?raw:'today';
  document.documentElement.dataset.theme=local.theme;
  $('#crumb').textContent = 'Workspace / ' + labels[view];
  const focused = document.activeElement;
  const refocus = focused?.matches('main button[data-do], main a[href]');
  const navHref = focused?.matches('#nav a,#mobile-nav a') ? focused.getAttribute('href') : null;
  const navSource = focused?.closest('#nav,#mobile-nav')?.id;
  $('#nav').innerHTML = groups.map(([label,links])=>'<div class="nav-group"><p class="nav-label">'+label+'</p>'+
    links.map(([key,text,icon])=>'<a class="nav-link'+(key===view?' active':'')+'" '+(key===view?'aria-current="page" ':'')+'href="#'+key+'"><span class="symbol" aria-hidden="true">'+icon+'</span>'+text+'</a>').join('')+'</div>').join('');
  $('#mobile-nav').innerHTML = groups[0][1].map(([key,label,icon])=>'<a class="nav-link'+(key===view?' active':'')+'" '+(key===view?'aria-current="page" ':'')+'href="#'+key+'"><span class="symbol" aria-hidden="true">'+icon+'</span>'+label+'</a>').join('')+
    '<button type="button" class="nav-link'+(groups[1][1].some(([key])=>key===view)?' active':'')+'" data-do="more"><span class="symbol" aria-hidden="true">⋯</span>More</button>';
  const keepCoach = $('#coach-form') ? { question:$('#coach-form textarea').value, answer:$('#coach-answer').textContent } : null;
  $('#main').innerHTML = views[view]();
  if (keepCoach && $('#coach-form')) {
    $('#coach-form textarea').value=keepCoach.question;
    $('#coach-answer').textContent=keepCoach.answer;
    $('#coach-answer').hidden=!keepCoach.answer;
  }
  if (refocus) {
    const replacement = [...$('#main').querySelectorAll('button,a')].find(el => el.dataset.do===focused.dataset.do && el.dataset.id===focused.dataset.id && el.getAttribute('href')===focused.getAttribute('href'));
    replacement?.focus({preventScroll:true});
  }
  if (navHref) [...document.getElementById(navSource).querySelectorAll('a')].find(el => el.getAttribute('href')===navHref)?.focus({preventScroll:true});
  else if (navSource==='mobile-nav' && focused?.tagName==='BUTTON') $('#mobile-nav button').focus({preventScroll:true});
  $('#profile-name').textContent=profile().name;
  $('.avatar').textContent=profile().name[0].toLocaleUpperCase();
  updateSyncLabel();
  drawRest();
  requestAnimationFrame(chart);
}
const modal = $('#dialog');
function dialog(title,content) {
  if (!modal.open) lastDialogFocus = document.activeElement;
  $('#dialog-body').innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+h(title)+'</h2>'+button('Close','close','compact')+'</div>'+content;
  if (!modal.open) modal.showModal();
  const focus = $('#dialog-body').querySelector('input:not([type=hidden]),textarea,select') || $('#dialog-body button');
  focus?.focus();
}
modal.addEventListener('close', () => {
  if (lastDialogFocus?.isConnected) lastDialogFocus.focus();
  else $('#main').focus({preventScroll:true});
});
const handle = (name,value) => '<input type="hidden" name="'+name+'" value="'+h(value)+'">';
const input = (label,name,value='',type='text',rules='required maxlength="120"') =>
  '<label class="field">'+h(label)+'<input name="'+name+'" value="'+h(value)+'" type="'+type+'" '+rules+'></label>';
const select = (label,name,options,value) =>
  '<label class="field">'+h(label)+'<select name="'+name+'">'+options.map(x=>option(x).replace('value="'+h(x)+'"','value="'+h(x)+'"'+(x===value?' selected':''))).join('')+'</select></label>';
const amount = (label,name,value='',min=0,max=10000,step='.1') => input(label,name,value,'number','required min="'+min+'" max="'+max+'" step="'+step+'"');
const dateInput = (value=DAY) => input('Date','date',value,'date','required min="1900-01-01" max="2099-12-31"');
function form(action,fields,label,extra='') {
  return '<form id="'+action+'">'+fields+'<div class="actions"><button type="submit" class="button primary">'+h(label)+'</button>'+extra+'</div><p class="form-error detail" role="alert"></p></form>';
}
function setForm(key) {
  const r=key ? lookup(key)?.data : null;
  const lb=profile().units==='lb';
  const choices=[...(session()?.exercises || activePlan()?.exercises || defaultExercises)];
  if (r && !choices.includes(r.exercise)) choices.push(r.exercise);
  return dialog(key?'Edit set':'Log a set',form('set-form',handle('key',key)+select('Exercise','exercise',choices,r?.exercise)+
    '<div class="form-grid">'+amount('Reps','reps',r?.reps??8,1,100,1)+amount('Load ('+(lb?'lb':'kg')+')','load',r?Math.round(r.load*(lb?2.2046226:1)*100)/100:lb?55:25,0,lb?1322.77:600,'.01')+'</div>',key?'Save set':'Log set',key?button('Delete set','delete','danger',key):''));
}
function mealForm(data={},key='') {
  const isNew=!key;
  const source=data.source||'Manual entry';
  const title=key?'Edit food':source==='Manual entry'?'Manual food entry':'Review food';
  return dialog(title,'<div class="stack-sm">'+(source.includes('sample')?'<p class="help">Sample result. Confirm the food, portion, and nutrition before logging.</p>':'')+
    form('meal-form',handle('key',key)+handle('source',source)+input('Food name','name',data.name)+
    '<div class="form-grid">'+select('Meal','slot',['Breakfast','Lunch','Dinner','Snack'],data.slot||'Lunch')+dateInput(data.date||diaryDate)+amount('Calories (kcal)','calories',data.calories)+amount('Protein (g)','protein',data.protein)+amount('Carbs (g)','carbs',data.carbs)+amount('Fat (g)','fat',data.fat)+'</div>',
    isNew?'Save to diary':'Save changes',key?button('Delete entry','delete','danger',key):'')+'</div>');
}
function foodPicker(query='') {
  foodQuery=query;
  const match=foods.map((f,i)=>({f,i})).filter(({f})=>f.name.toLowerCase().includes(query.trim().toLowerCase()));
  const methods='<div class="actions">'+button('Manual macros','food-manual')+button('Barcode','scan','', 'Barcode')+button('Nutrition label','scan','','Label')+button('Meal photo','scan','','Photo')+button('Describe meal','scan','','Description')+'</div>';
  dialog('Log food','<div class="stack-sm">'+methods+form('food-search',input('Search sample catalog','query',query,'search','maxlength="80"'),'Search')+
    (query?'<p class="detail">Results for “'+h(query)+'”</p>':'<h3>Sample foods</h3>')+list(match.map(({f,i})=>row(f.name,n(f.calories)+' kcal per sample serving',button('Review','food-preset','compact',String(i)))),'No matching sample food. Try manual entry.')+'</div>');
}
function scan(method) {
  const text={
    Barcode:'Sample product barcode: 8901234567890. Unknown barcodes can use manual entry.',
    Label:'Review a sample per-serving label. The production scanner reads an image on the device.',
    Photo:'Review a sample estimate for a chicken tikka rice bowl. Production supports taking or choosing a photo.',
    Description:'Describe the food and portion. The preview recognizes sample dishes from the catalog.'
  };
  const fields = method==='Barcode'?input('Barcode','value','8901234567890','text','required inputmode="numeric" pattern="[0-9]{8,14}"'):
    method==='Description'?input('Meal description','value','Paneer bhurji wrap','text','required maxlength="120"'):'';
  dialog(method==='Label'?'Scan nutrition label':method==='Photo'?'Scan meal photo':method==='Barcode'?'Scan barcode':'Describe a meal',
    '<div class="stack-sm"><p class="help">'+h(text[method])+'</p>'+form('scan-form',handle('method',method)+fields,'Review sample',button('Manual entry','food-manual'))+'</div>');
}
function programForm(mode='manual') {
  const plan=rows('program').sort(byDate).at(-1)?.data;
  const fromSample=mode==='proposal';
  const substitute=mode==='substitute';
  const alternatives=[...new Set([...(plan?.exercises||defaultExercises),'Machine chest press','Band row','Push-up'])];
  const defaults=fromSample?['Incline dumbbell press','Chest-supported row','Machine chest press','Lat pulldown']:plan?.exercises||defaultExercises;
  const fields=handle('mode',mode)+input('Program name','name',fromSample?'Upper body plan · proposal':plan?.name||'Upper body strength')+
    '<div class="form-grid">'+amount('Days per week','days',fromSample?3:plan?.days||3,1,7,1)+dateInput()+
    defaults.map((e,i)=>select('Exercise '+(i+1),'exercise'+i,alternatives,e)).join('')+'</div>';
  dialog(fromSample?'Review program proposal':substitute?'Substitute exercise':'Build a program',
    '<div class="stack-sm">'+(fromSample?'<p class="help">This is a sample proposal. Choose what you want to keep before saving.</p>':'')+form('program-form',fields,'Save program')+'</div>');
}
function recipeForm(key='',name='') {
  const r=key ? lookup(key)?.data : null;
  const fields=handle('key',key)+input('Recipe name','name',r?.name||name)+amount('Finished yield (g)','yield',r?.yield||600,1,10000)+
    '<div class="form-grid">'+[0,1].map(i => select('Ingredient '+(i+1),'ingredient'+i,foods.map(f=>f.name),r?.ingredients[i]?.name||foods[i].name)+amount('Ingredient weight (g)','grams'+i,r?.ingredients[i]?.grams||300,1,10000)).join('')+'</div>';
  dialog(key?'Edit recipe':'Create recipe','<div class="stack-sm"><p class="detail">Ingredient values use a fictional 100 g basis in this preview.</p>'+form('recipe-form',fields,'Save recipe')+'</div>');
}
function portion(recipe,grams) {
  return Object.fromEntries(['calories','protein','carbs','fat'].map(k=>[k,Math.round(recipe.ingredients.reduce((v,i)=>v+i[k],0)*grams/recipe.yield*10)/10]));
}
function syncPanel() {
  const places = 'Device '+device+' · Server revision '+local.cursor;
  const other = device==='A'?'B':'A';
  const conflictRows = list(local.conflicts.map(x => row(x.op.data?.name||x.op.data?.exercise||x.op.kind,x.message,button('Review draft','conflict','compact',x.op.opId))),'No drafts need review.');
  dialog('Sync and devices','<div class="stack-sm"><p class="detail">'+h(places)+'</p>'+
    '<p class="help">'+h(storageError||syncError||(local.offline?'This device is paused. New changes stay in its local queue.':'This workspace is shared by the two demo devices.'))+'</p>'+
    '<div class="actions">'+button(local.offline?'Go online':'Go offline','offline','primary')+
    button('Sync now','sync-now')+'<a class="button" target="_blank" rel="noopener" href="/?device='+other+'#'+(location.hash.slice(1)||'today').replace(/[^a-z]/g,'')+'">Open Device '+other+' ↗</a></div>'+
    '<p class="detail">'+local.pending.length+' queued · '+local.conflicts.length+' to review</p>'+
    '<div class="divider"><h3>Conflicts</h3>'+conflictRows+'</div><details><summary>Test recovery</summary><p class="detail">The server will save the next change, then drop its first reply. The client retries with the same operation ID.</p>'+button(loseNextResponse?'Reply drop armed':'Drop next save reply','drop-reply')+'</details></div>');
}
function fieldPreview(data) {
  if (!data) return '<p class="detail">This entry was deleted.</p>';
  return '<p class="detail">'+h(Object.values(data).map(v=>Array.isArray(v)?v.map(i=>i.name||i).join(', '):v).join(' · '))+'</p>';
}
const tabs = {
  'close':()=>modal.close(),
  'theme':()=>{ commit({theme:local.theme==='dark'?'light':'dark'}); render(); },
  'more':()=>dialog('More','<div class="actions">'+groups[1][1].map(([key,label])=>'<button type="button" class="button" data-do="go-view" data-id="'+key+'">'+label+'</button>').join('')+'</div>'),
  'go-view':view=>{modal.close();location.hash=view;},
  'quick':()=>dialog('Quick log','<div class="actions">'+button('Log food','food','primary')+button('Log weight','weight')+button('Log activity','activity')+button('Open workout','start-workout')+'</div>'),
  'sync-panel':syncPanel,
  'sync-now':async()=>{ await sync(); syncPanel(); },
  'offline':()=>{ commit({offline:!local.offline}); render(); syncPanel(); void sync(); },
  'drop-reply':()=>{loseNextResponse=true;syncPanel();},
  'conflict':key=>{
    const x=local.conflicts.find(c=>c.op.opId===key);
    if (!x) return;
    const current=local.base[x.op.id];
    dialog('Review unsynced change','<div class="stack-sm"><p class="help">'+h(x.message)+'</p><h3>On this device</h3>'+fieldPreview(x.op.data)+
      '<h3>Synced version</h3>'+fieldPreview(current?.data)+'<div class="actions">'+button('Keep synced version','discard-conflict','',key)+
      (x.op.action==='put'&&['conflict','reset_required'].includes(x.code)?
        button(current&&!current.deleted?'Apply my version':'Save as a new entry','apply-conflict','primary',key):'')+'</div></div>');
  },
  'discard-conflict':key=>{commit({conflicts:local.conflicts.filter(c=>c.op.opId!==key)});render();syncPanel();},
  'apply-conflict':key=>{
    const x=local.conflicts.find(c=>c.op.opId===key);
    if (!x) return;
    const current=local.base[x.op.id];
    if (local.pending.some(op=>op.id===x.op.id)) return announce('Sync the pending change to this entry first.');
    enqueue(x.op.kind,x.op.data,current&&!current.deleted?x.op.id:id());
    commit({conflicts:local.conflicts.filter(c=>c.op.opId!==key)});
    render(); modal.close(); announce('Your version is queued.');
  },
  'start-workout':()=>{
    if (!session()) {
      const plan=activePlan();
      enqueue('session',{name:plan?.name||'Upper body strength',exercises:plan?.exercises||defaultExercises,status:'active',date:DAY},SESSION);
    }
    if(modal.open) modal.close();
    location.hash='training'; render();
  },
  'set':()=>setForm(''),
  'edit-set':setForm,
  'rest':()=>{commit({restUntil:Date.now()+90_000});drawRest();announce('Rest timer started.');},
  'finish':()=>{
    if (!rows('set').some(r=>r.data.session===SESSION)) return announce('Log a set first.');
    dialog('Finish workout','<div class="stack-sm"><p>Save your logged sets and add this workout to your history.</p>'+button('Confirm finish','finish-confirm','primary')+'</div>');
  },
  'finish-confirm':()=>{
    if (session()?.status !== 'active') return;
    enqueue('session',{...session(),status:'completed'},SESSION);
    commit({restUntil:0}); modal.close(); render(); announce('Workout saved.');
  },
  'program':()=>programForm(),
  'substitute':()=>programForm('substitute'),
  'program-proposal':()=>programForm('proposal'),
  'exercise':name=>dialog(name,'<div class="stack-sm"><p>Set up with a stable base. Use a controlled range, log the load and reps you completed, and adjust the next set to your plan.</p>'+button('Open workout','start-workout','primary')+'</div>'),
  'food':()=>foodPicker(foodQuery),
  'food-manual':()=>mealForm(),
  'food-preset':key=>mealForm({...foods[Number(key)],source:'Catalog sample'}),
  'edit-meal':key=>{const r=lookup(key); if(r?.data) mealForm(r.data,key);},
  'scan':scan,
  'recipe':()=>recipeForm(),
  'recipe-detail':key=>{
    const r=lookup(key)?.data; if (!r) return;
    const p=portion(r,Math.min(100,r.yield));
    dialog(r.name,'<div class="stack-sm"><p>'+h(n(r.yield)+' g finished yield · '+n(p.calories)+' kcal per '+Math.min(100,r.yield)+' g')+'</p>'+
    list(r.ingredients.map(i=>row(i.name,n(i.grams)+' g')))+form('recipe-portion',handle('key',key)+amount('Portion (g)','grams',Math.min(200,r.yield),1,r.yield),'Review portion',
      button('Edit recipe','recipe-edit','',key)+button('Duplicate','duplicate-recipe','',key)+button('Copy ingredients','share-recipe','',key))+'</div>');
  },
  'recipe-edit':key=>recipeForm(key),
  'duplicate-recipe':key=>{const r=lookup(key)?.data; if(!r)return;enqueue('recipe',{...r,name:(r.name.slice(0,112)+' (copy)')});modal.close();announce('Recipe duplicated.');},
  'share-recipe':async key=>{const r=lookup(key)?.data; if(!r)return;
    const text=r.name+'\n'+r.ingredients.map(i=>i.name+' · '+i.grams+' g').join('\n');
    if(navigator.clipboard) {await navigator.clipboard.writeText(text);announce('Ingredients copied.');}
    else dialog('Copy ingredients','<label class="field">Ingredient list<textarea readonly>'+h(text)+'</textarea></label>');},
  'import-recipe':()=>dialog('Preview recipe import','<div class="stack-sm"><p class="help">Sample parser. This preview keeps pasted URLs on this device and uses a sample ingredient list.</p>'+
    form('import-form',input('Recipe URL','url','https://example.com/dal-bowl','url','required maxlength="350"'),'Review sample import')+'</div>'),
  'grocery':()=>dialog('Record grocery price',form('grocery-form',input('Product','name','Masoor dal')+amount('Price (₹)','price',96)+input('Price unit','unit','kg')+input('Store or market','store','Local market')+dateInput(),'Save price')),
  'weight':key=>{
    const r=key?lookup(key)?.data:null;
    const lb=profile().units==='lb';
    dialog(key?'Edit weight':'Log weight',form('weight-form',handle('key',key)+amount('Weight ('+(lb?'lb':'kg')+')','weight',r?Math.round(r.kg*(lb?2.2046226:1)*100)/100:'',lb?44.1:20,lb?992.08:450,'.01')+dateInput(r?.date),'Save weight'));
  },
  'activity':()=>dialog('Log activity',form('activity-form',input('Activity','name','Walk')+amount('Duration (minutes)','minutes',30,1,1440,1)+dateInput(),'Save activity')),
  'photo':()=>dialog('Add sample photo reference','<div class="stack-sm"><p class="help">Saves the sample name and date. Private photo storage and camera access are production integrations.</p>'+
    form('photo-form',input('Label','name','Progress photo')+dateInput(),'Save reference')+'</div>'),
  'cycle':()=>dialog('Log cycle event','<div class="stack-sm"><p class="help">This local workspace uses sample entries. Use fictional information.</p>'+
    form('cycle-form',select('Event','event',['Started','Ended','Symptom logged'])+dateInput(),'Save event')+'</div>'),
  'checkin':()=>{
    const sets=rows('set').length;
    const meals=rows('meal').length;
    dialog('Weekly check-in','<div class="stack-sm"><p>'+sets+' logged sets · '+meals+' diary entries in the demo workspace.</p>'+
      '<p class="help">Sample proposal: review training consistency and keep your current targets while you gather more entries.</p>'+
      '<div class="actions">'+button('Accept focus','accept-checkin','primary')+button('Skip this week','skip-checkin')+'</div></div>');
  },
  'accept-checkin':()=>saveCheckin('accepted'),
  'skip-checkin':()=>saveCheckin('skipped'),
  'lesson':key=>{
    const [name,type,body]=lessons[Number(key)];
    const saved=rows('bookmark').find(x=>x.data.name===name);
    dialog(name,'<div class="stack-sm"><p class="kicker">'+h(type)+'</p><p>'+h(body)+'</p>'+button(saved?'Remove bookmark':'Save lesson','bookmark','primary',key)+'</div>');
  },
  'bookmark':key=>{
    const name=lessons[Number(key)][0]; const saved=rows('bookmark').find(x=>x.data.name===name);
    if(saved) enqueue('bookmark',null,saved.id,'delete'); else enqueue('bookmark',{name}); tabs.lesson(key);
  },
  'profile':()=>{
    const data=profile();
    dialog('Edit profile',form('profile-form',input('Name','name',data.name,'text','required maxlength="30"')+
      select('Goal','goal',['Build strength','Maintain','Improve fitness'],data.goal)+select('Display units','units',['kg','lb'],data.units)+
      select('Preferred language','language',['English','Hindi'],data.language)+
      '<p class="detail">Hindi preference is saved. Translated screens and push notifications are production features.</p>'+
      '<label class="field check"><input type="checkbox" name="reminders" '+(data.reminders?'checked':'')+'> Workout reminders</label>','Save profile'));
  },
  'connection':name=>dialog(name,'<div class="stack-sm"><p class="help">This connection needs the production app or an approved provider account.</p>'+
    '<p class="detail">'+h({
      'Apple Health':'Request access on the iPhone and choose which activity or weight data to share.',
      'Health Connect / Samsung Health':'Check device support and select data permissions. Samsung records are available when shared with Health Connect.',
      'Strava':'Authorize export on Strava, then select a completed workout to share.',
      'Apple Watch':'Pair on iPhone, then log sets and rest timers using the Watch companion.',
      'Live Activities':'Show an active workout timer on supported iPhones when enabled.'
    }[name])+'</p>'+button('Open Sync and devices','sync-panel')+'</div>'),
  'membership':()=>dialog('Membership preview','<div class="stack-sm"><p class="help">This local build has no store connection. Purchases and restores use the native store in production.</p><p>Manage plan options, review renewal terms, and restore access on another device.</p>'+button('Done','close')+'</div>'),
  'privacy':()=>dialog('Data and support','<div class="stack-sm"><p class="help">The demo shares fictional entries between two local devices. Production accounts have identity-verified export and deletion.</p>'+button('Export demo data','export','primary')+'</div>'),
  'admin':()=>dialog('Content and operations','<div class="stack-sm"><p class="help">Operator preview for this local workspace. Production adds role checks, reviews, versioned publishing and audit history.</p>'+
    list([row('Lessons available',lessons.length+' sample lessons'),row('Sync status','Revision '+local.cursor,button('Open sync','sync-panel')),row('Local review queue',local.conflicts.length+' change(s)')])+'</div>'),
  'export':()=>{
    const exportData={updatedAt:new Date().toISOString(),device,records:Object.values(projected()).filter(r=>!r.deleted)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='levelmaxing-demo-export.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Export downloaded.');
  },
  'delete':key=>{
    const row=lookup(key);
    if(!row?.data) return;
    dialog('Remove entry?','<div class="stack-sm"><p>'+h(row.data.name||row.data.event||row.data.exercise||'Selected entry')+' will be removed from both devices after sync.</p>'+
      button('Confirm removal','confirm-delete','danger',key)+'</div>');
  },
  'confirm-delete':key=>{const row=lookup(key);if(row&&!row.deleted){enqueue(row.kind,null,key,'delete');modal.close();announce('Removal saved.');}}
};
function saveCheckin(status){
  const current=rows('checkin').find(r=>r.data.date===DAY);
  enqueue('checkin',{focus:'Training consistency',status,date:DAY},current?.id||'checkin-'+DAY);
  modal.close();announce(status==='accepted'?'Check-in saved.':'Check-in skipped.');
}
function drawRest() {
  const text=$('#rest-clock');
  clearTimeout(restTimer);
  if(!text || !local.restUntil) return;
  const seconds=Math.max(0,Math.ceil((local.restUntil-Date.now())/1000));
  text.textContent=seconds?'Rest remaining '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'Rest complete';
  if(seconds) restTimer=setTimeout(drawRest,250);
}
document.addEventListener('click',async e=>{
  const target=e.target.closest('[data-do],[data-view]');
  if(!target)return;
  const action=target.dataset.do;
  try {
    if(target.dataset.view) location.hash=target.dataset.view;
    else if(Object.hasOwn(tabs,action)) await tabs[action](target.dataset.id||'');
  } catch (error) { announce(error.message || 'Action could not be completed.'); }
});
function finishSave(key,kind,data) {
  enqueue(kind,data,key||id());
  modal.close();
  announce(local.offline?'Saved on this device.':'Saved.');
}
const dataObj = f => Object.fromEntries(new FormData(f));
const formHandlers = {
  'date-form':f=>{diaryDate=f.date;render();},
  'food-search':f=>foodPicker(f.query),
  'scan-form':f=>{
    if(f.method==='Barcode' && f.value!=='8901234567890') throw new Error('No sample product matches. Use manual entry.');
    if(f.method==='Description'){
      const food=foods.find(x=>f.value.toLowerCase().includes(x.name.toLowerCase())) || foods.find(x=>x.name.toLowerCase().includes(f.value.toLowerCase()));
      if(!food) throw new Error('The sample catalog does not recognize that meal. Use manual entry.');
      return mealForm({...food,source:'Description sample'});
    }
    const entry=f.method==='Photo'?foods[0]:{name:'Sample roasted chana',calories:167,protein:7,carbs:21,fat:6};
    mealForm({...entry,source:f.method+' sample'});
  },
  'meal-form':f=>{
    const {key,name,slot,date,source}=f;
    finishSave(key,'meal',{name:name.trim(),slot,date,source,calories:Number(f.calories),protein:Number(f.protein),carbs:Number(f.carbs),fat:Number(f.fat)});
    if(date!==diaryDate){diaryDate=date;render();}
  },
  'set-form':f=>finishSave(f.key,'set',{exercise:f.exercise,reps:Number(f.reps),load:Number(f.load)/(profile().units==='lb'?2.2046226:1),session:SESSION,date:DAY}),
  'weight-form':f=>finishSave(f.key,'weight',{date:f.date,kg:Number(f.weight)/(profile().units==='lb'?2.2046226:1)}),
  'activity-form':f=>finishSave('', 'activity',{date:f.date,name:f.name.trim(),minutes:Number(f.minutes)}),
  'photo-form':f=>finishSave('', 'photo',{date:f.date,name:f.name.trim()}),
  'cycle-form':f=>finishSave('', 'cycle',{date:f.date,event:f.event}),
  'grocery-form':f=>finishSave('', 'grocery',{date:f.date,name:f.name.trim(),price:Number(f.price),unit:f.unit.trim(),store:f.store.trim()}),
  'profile-form':f=>finishSave('profile','settings',{name:f.name.trim(),goal:f.goal,units:f.units,language:f.language,reminders:f.reminders==='on'}),
  'program-form':f=>{
    const exercises=Object.entries(f).filter(([k])=>k.startsWith('exercise')).map(([,v])=>v);
    if(new Set(exercises).size!==exercises.length)throw new Error('Choose different exercises for each row.');
    finishSave('','program',{name:f.name.trim(),days:Number(f.days),date:f.date,exercises});
  },
  'recipe-form':f=>{
    const ingredients=[0,1].map(i=>{
      const grams=Number(f['grams'+i]); const food=foods.find(x=>x.name===f['ingredient'+i]);
      const macros=Object.fromEntries(['calories','protein','carbs','fat'].map(k=>[k,Math.round(food[k]*grams/100*10)/10]));
      if(Object.values(macros).some(v=>v>10000))throw new Error('Use a smaller quantity for the sample ingredient.');
      return {name:food.name,grams,...macros};
    });
    finishSave(f.key,'recipe',{name:f.name.trim(),yield:Number(f.yield),ingredients});
  },
  'recipe-portion':f=>{
    const r=lookup(f.key)?.data;
    if(!r)throw new Error('This recipe no longer exists.');
    mealForm({name:r.name,source:'Recipe',...portion(r,Number(f.grams))});
  },
  'import-form':f=>{
    const url=new URL(f.url);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Enter a public recipe page URL.');
    recipeForm('','Imported sample recipe');
  },
  'coach-form':f=>{
    const a=$('#coach-answer');
    const q=f.question.toLowerCase();
    a.textContent=q.includes('meal')||q.includes('food')?'Review the food name and amount before saving it. For a homemade meal, log the ingredients and the cooked yield.':
      q.includes('workout')||q.includes('set')||q.includes('strength')?'Record the load and reps you complete. Compare similar sets across workouts, and use the rest timer consistently.':
      'Try a question about logging a workout or estimating a meal portion. These are the topics available in the preview.';
    a.hidden=false;
  }
};
document.addEventListener('change',e=>{if(e.target.form?.id==='date-form'&&e.target.value)formHandlers['date-form'](dataObj(e.target.form));});
document.addEventListener('submit',e=>{
  e.preventDefault();
  const action=e.target.id;
  const handleForm=formHandlers[action];
  if(!handleForm)return;
  const f=dataObj(e.target);
  const errorBox=e.target.querySelector('.form-error');
  if(errorBox)errorBox.textContent='';
  try {
    if(Object.entries(f).some(([k,v])=>['name','unit','store'].includes(k)&&!v.trim()))throw new Error('Fill in all names and text fields.');
    handleForm(f);
  } catch(error) {
    if(errorBox)errorBox.textContent=error.message;
    else announce(error.message);
  }
});
window.addEventListener('hashchange',()=>{render();$('#main').focus({preventScroll:true});});
window.addEventListener('resize',()=>requestAnimationFrame(chart));
window.addEventListener('online',()=>void sync());
window.addEventListener('focus',()=>void sync());
setInterval(()=>{if(!document.hidden)void sync();},1600);
render();
void sync();
