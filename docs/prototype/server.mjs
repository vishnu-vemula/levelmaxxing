import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const stateDir = resolve(process.env.LEVELMAXING_DATA_DIR || resolve(root, '.demo-state'));
const stateFile = resolve(stateDir, 'workspace.json');
const port = Number(process.env.PORT || 4316);
const demoDay = '2026-11-23';
const maxAmount = 10_000;
const str = (v, n = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const num = (v, min = 0, max = maxAmount) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const iso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const id = (v) => typeof v === 'string' && /^[\w-]{1,90}$/.test(v) && !Object.hasOwn(Object.prototype,v);
const macros = (d) => ['calories', 'protein', 'carbs', 'fat'].every(k => num(d[k]));
const valid = {
  meal: (d) => str(d.name) && ['Breakfast','Lunch','Dinner','Snack'].includes(d.slot) && iso(d.date) && macros(d) && str(d.source, 60),
  set: (d) => str(d.exercise) && id(d.session) && num(d.reps, 1, 100) && Number.isInteger(d.reps) && num(d.load, 0, 600) && iso(d.date),
  session: (d) => str(d.name) && ['active','completed'].includes(d.status) && iso(d.date) && Array.isArray(d.exercises) && d.exercises.length > 0 && d.exercises.length <= 12 && d.exercises.every(e => str(e)),
  weight: (d) => num(d.kg, 20, 450) && iso(d.date),
  recipe: (d) => str(d.name) && num(d.yield, 1, 10_000) && Array.isArray(d.ingredients) && d.ingredients.length > 0 && d.ingredients.length <= 20 && d.ingredients.every(i => i && str(i.name) && num(i.grams, 1) && macros(i)),
  program: (d) => str(d.name) && num(d.days, 1, 7) && Number.isInteger(d.days) && Array.isArray(d.exercises) && d.exercises.length > 0 && d.exercises.length <= 12 && d.exercises.every(e => str(e)) && iso(d.date),
  settings: (d) => str(d.name, 30) && ['Build strength','Maintain','Improve fitness'].includes(d.goal) && ['kg','lb'].includes(d.units) && ['English','Hindi'].includes(d.language) && typeof d.reminders === 'boolean',
  checkin: (d) => str(d.focus) && iso(d.date) && ['accepted','skipped'].includes(d.status),
  activity: (d) => str(d.name) && num(d.minutes, 1, 1440) && iso(d.date),
  cycle: (d) => iso(d.date) && ['Started','Ended','Symptom logged'].includes(d.event),
  photo: (d) => str(d.name) && iso(d.date),
  bookmark: (d) => str(d.name),
  grocery: (d) => str(d.name) && num(d.price, 0) && str(d.unit, 30) && str(d.store, 60) && iso(d.date),
};
const keys = {
  meal: ['name','slot','date','calories','protein','carbs','fat','source'],
  set: ['exercise','session','reps','load','date'], session: ['name','status','date','exercises'],
  weight: ['kg','date'], recipe: ['name','yield','ingredients'], program: ['name','days','exercises','date'],
  settings: ['name','goal','units','language','reminders'], checkin: ['focus','date','status'],
  activity: ['name','minutes','date'], cycle: ['date','event'], photo: ['name','date'],
  bookmark: ['name'], grocery: ['name','price','unit','store','date']
};
const allowedFields = (data, names) => Object.keys(data).every(k => names.includes(k));
const seed = [
  ['meal','morning-bowl',{name:'Greek yogurt, oats & banana',slot:'Breakfast',date:demoDay,calories:445,protein:31,carbs:55,fat:11,source:'Saved meal'}],
  ['meal','lunch-bowl',{name:'Chicken tikka rice bowl',slot:'Lunch',date:demoDay,calories:690,protein:48,carbs:84,fat:18,source:'Recipe'}],
  ['meal','snack',{name:'Banana & peanut butter',slot:'Snack',date:demoDay,calories:285,protein:7,carbs:28,fat:15,source:'Manual entry'}],
  ['weight','weight-1',{kg:75.8,date:'2026-11-10'}],
  ['weight','weight-2',{kg:75.5,date:'2026-11-13'}],
  ['weight','weight-3',{kg:75.6,date:'2026-11-16'}],
  ['weight','weight-4',{kg:75.2,date:'2026-11-19'}],
  ['weight','weight-5',{kg:75.0,date:demoDay}],
  ['settings','profile',{name:'Aarav',goal:'Build strength',units:'kg',language:'English',reminders:false}]
];
function load() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { epoch: randomUUID(), revision: 0,
      entities: Object.fromEntries(seed.map(([kind, key, data]) => [key,{id:key,kind,version:1,deleted:false,data}])),
      receipts: {}, changes: [] };
  }
}
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
let state = load();
function persist(next) {
  const temporary = resolve(stateDir, '.workspace-next.json');
  writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flush: true });
  renameSync(temporary, stateFile);
  state = next;
}
persist(state);

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Send application/json.'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw Object.assign(new Error('Payload too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
function push(res, op) {
  if (!op || !id(op.opId) || !id(op.clientId) || !id(op.id) || !Object.hasOwn(valid, op.kind) ||
      !Number.isInteger(op.expected) || op.expected < 0 || !['put','delete'].includes(op.action) ||
      (op.kind === 'settings' && (op.id !== 'profile' || op.action === 'delete')) ||
      (op.action === 'put' && (!op.data || typeof op.data !== 'object' || Array.isArray(op.data) ||
        !allowedFields(op.data, keys[op.kind]) || !valid[op.kind](op.data) ||
        (op.kind === 'recipe' && op.data.ingredients.some(i => !allowedFields(i, ['name','grams','calories','protein','carbs','fat'])))))) {
    return send(res, 422, { code: 'invalid_operation', message: 'Check all fields and try again.' });
  }
  if (op.epoch !== state.epoch) return send(res, 409, { code: 'reset_required', message: 'The server workspace changed. Keep your draft and download the new snapshot.' });
  const receiptKey = op.clientId + ':' + op.opId;
  const hash = createHash('sha256').update(JSON.stringify(canonical(op))).digest('hex');
  const receipt = state.receipts[receiptKey];
  if (receipt) {
    if (receipt.hash !== hash) return send(res, 409, { code:'key_reused', message:'An operation ID cannot be used for different data.' });
    return send(res, 200, receipt.result);
  }
  const current = Object.hasOwn(state.entities, op.id) ? state.entities[op.id] : null;
  if ((current?.version ?? 0) !== op.expected || current?.deleted || (current && current.kind !== op.kind) || (!current && op.action === 'delete')) {
    return send(res, 409, { code: 'conflict', current, message: 'This entry changed on another device.' });
  }
  if (op.kind === 'session') {
    const move = current ? op.data?.status === 'completed' && current.data.status === 'active'
      && op.data.name === current.data.name && op.data.date === current.data.date
      && JSON.stringify(op.data.exercises) === JSON.stringify(current.data.exercises)
      : op.data?.status === 'active';
    if (op.action !== 'put' || !move) return send(res, 422, { code:'invalid_session', message:'Start a workout before finishing it.' });
    const hasSet = Object.values(state.entities).some(r => !r.deleted && r.kind === 'set' && r.data.session === op.id);
    if (op.data.status === 'completed' && !hasSet) return send(res, 422, { code:'missing_sets',message:'Log at least one set before finishing.' });
  }
  if (op.kind === 'set') {
    const data = op.action === 'delete' ? current.data : op.data;
    const parent = state.entities[data.session];
    if (!parent || parent.deleted || parent.kind !== 'session' || parent.data.status !== 'active'
        || parent.data.date !== data.date || !parent.data.exercises.includes(data.exercise)
        || (current && current.data.session !== data.session)) {
      return send(res, 422, { code:'invalid_workout',message:'The workout changed or has already been finished.' });
    }
  }
  const row = { id:op.id, kind:op.kind, version:op.expected + 1,
    deleted:op.action === 'delete', data:op.action === 'delete' ? null : op.data };
  const revision = state.revision + 1;
  const result = { opId:op.opId, revision, row };
  persist({ ...state, revision, entities:{ ...state.entities,[op.id]:row },
    receipts:{ ...state.receipts,[receiptKey]:{ hash,result } },
    changes:[ ...state.changes,{ revision,row } ] });
  if (op.dropTestReply === true) { res.destroy(); return; }
  return send(res, 200, result);
}
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']], ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']], ['/workout.webp',['workout.webp','image/webp']]
]);
const server = createServer(async (req, res) => {
  try {
    const origin = 'http://127.0.0.1:' + port;
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:' + port && req.headers.host !== 'localhost:' + port) {
      return send(res, 403, { code:'local_only' });
    }
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.method === 'GET' && url.pathname === '/api/snapshot') {
      return send(res, 200, { epoch:state.epoch, cursor:state.revision, records:Object.values(state.entities) });
    }
    if (req.method === 'GET' && url.pathname === '/api/pull') {
      const parsed = Number(url.searchParams.get('cursor'));
      const claimedHigh = url.searchParams.has('high') ? Number(url.searchParams.get('high')) : state.revision;
      if (!Number.isSafeInteger(parsed) || parsed < 0 || !Number.isSafeInteger(claimedHigh) || claimedHigh < parsed) return send(res, 422, { code:'invalid_cursor' });
      if (url.searchParams.get('epoch') !== state.epoch || claimedHigh > state.revision) return send(res, 409, { code:'reset_required' });
      const page = state.changes.slice(parsed, Math.min(parsed + 100, claimedHigh));
      const cursor = page.at(-1)?.revision ?? claimedHigh;
      return send(res, 200, { cursor, high:claimedHigh, more:cursor < claimedHigh, changes:page });
    }
    if (req.method === 'POST' && url.pathname === '/api/push') {
      if (req.headers.origin && req.headers.origin !== origin && req.headers.origin !== 'http://localhost:' + port) return send(res, 403, { code:'local_only' });
      return push(res, await body(req));
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [file,type] = assets.get(url.pathname);
      const bytes = readFileSync(resolve(root,'public',file));
      res.writeHead(200,{ 'content-type':type,'cache-control':'no-store' });
      return res.end(bytes);
    }
    return send(res, 404, { code:'not_found' });
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { code:'request_failed', message:error.status ? error.message : 'Local server could not complete the request.' });
    if (!error.status) console.error(error.code ?? error.name);
  }
});
server.on('error',error => {
  console.error('Could not start Levelmaxing on local port ' + port + ' (' + error.code + ').');
  process.exitCode = 1;
});
server.listen(port,'127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port;
  console.log('Levelmaxing prototype · ' + url);
  if (process.argv.includes('--open') && process.platform === 'darwin') {
    execFile('/usr/bin/open',[url],error => { if (error) console.error('Open ' + url + ' in your browser.'); });
  }
});
