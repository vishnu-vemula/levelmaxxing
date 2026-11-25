import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('real HTTP sync: replay, conflicts, tombstones and restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'levelmaxing-qa-'));
  const port = process.env.LEVELMAXING_TEST_PORT || '4336';
  const root = 'http://127.0.0.1:' + port;
  let child;
  async function stop() {
    if (child?.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }
  t.after(async () => { await stop(); await rm(directory, { recursive:true,force:true }); });
  async function start() {
    child = spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
      env:{...process.env,PORT:port,LEVELMAXING_DATA_DIR:directory},stdio:['ignore','pipe','pipe']
    });
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')),5000);
      child.stdout.once('data',() => { clearTimeout(timer); resolve(); });
      child.stderr.once('data',chunk => { clearTimeout(timer); reject(new Error(chunk.toString())); });
      child.once('error',err => { clearTimeout(timer); reject(err); });
    });
  }
  async function fetchJson(path,opts) {
    const res = await fetch(root+path,{...opts,signal:AbortSignal.timeout(5000)});
    return {status:res.status,body:await res.json()};
  }
  const getSnapshot = () => fetchJson('/api/snapshot');
  const getPull = (epoch,cursor,high) => fetchJson('/api/pull?epoch='+epoch+'&cursor='+cursor+(high===undefined?'':'&high='+high));
  const push = op => fetchJson('/api/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(op)});
  await start();
  const {body:snapshot} = await getSnapshot();
  assert.equal(snapshot.cursor,0);
  const epoch = snapshot.epoch;
  const date='2026-11-23';
  const make = (clientId,kind,id,expected,data,action='put') => {
    return {epoch,opId:randomUUID(),clientId,kind,id,expected,action,...(action==='put'?{data}:{})};
  };
  const meal = {name:'Test meal',slot:'Lunch',date,calories:390,protein:20,carbs:42,fat:10,source:'Manual entry'};
  const testMeal = randomUUID();
  const lost = {...make('A','meal',testMeal,0,meal),dropTestReply:true};
  await assert.rejects(push(lost), /fetch failed/);
  const retry = await push(lost);
  assert.equal(retry.status,200);
  assert.equal(retry.body.revision,1);
  assert.equal((await push({...lost,data:{...meal,calories:392}})).body.code,'key_reused');
  const secondDeviceChanges = await getPull(epoch,0);
  assert.deepEqual(secondDeviceChanges.body.changes.map(c=>c.row.id),[testMeal]);
  assert.deepEqual(secondDeviceChanges.body.changes[0].row.data,meal);

  const [left,right] = await Promise.all([
    push(make('A','meal',testMeal,1,{...meal,name:'Edit from A'})),
    push(make('B','meal',testMeal,1,{...meal,name:'Edit from B'}))
  ]);
  const pass = [left,right].find(x => x.status===200);
  const conflict = [left,right].find(x => x.status===409);
  assert.equal(pass.body.row.version,2);
  assert.equal(conflict.body.code,'conflict');
  assert.deepEqual(conflict.body.current,pass.body.row);
  assert.equal((await push(make('B','meal',testMeal,2,null,'delete'))).status,200);
  const stale = await push(make('A','meal',testMeal,2,{...meal,name:'Offline edit'}));
  assert.equal(stale.status,409);
  assert.equal(stale.body.current.deleted,true);
  assert.equal((await push(make('A','meal',testMeal,0,meal))).body.current.deleted,true);

  const workout='demo-workout-qa';
  const draft={date,name:'Upper body',status:'active',exercises:['Incline dumbbell press']};
  assert.equal((await push(make('A','session',workout,0,draft))).status,200);
  assert.equal((await push(make('B','session',workout,1,{...draft,status:'completed'}))).body.code,'missing_sets');
  const set={date,exercise:'Incline dumbbell press',load:25,reps:8,session:workout};
  const [setA,setB]=await Promise.all([
    push(make('A','set','set-a',0,set)),
    push(make('B','set','set-b',0,{...set,load:27.5}))
  ]);
  assert.equal(setA.status,200);
  assert.equal(setB.status,200);
  assert.equal((await push(make('A','session',workout,1,{...draft,name:'Edited plan',status:'completed'}))).body.code,'invalid_session');
  assert.equal((await push(make('A','session',workout,1,{...draft,status:'completed'}))).status,200);
  assert.equal((await push(make('B','set','late-set',0,set))).body.code,'invalid_workout');
  assert.equal((await push(make('B','weight','bad-weight',0,{date,kg:-5}))).status,422);
  assert.equal((await push({...make('B','weight','old-epoch',0,{date,kg:75}),epoch:'different'})).body.code,'reset_required');

  for (let i=0; i<101; i+=1) {
    assert.equal((await push(make('A','bookmark','page-'+i,0,{name:'Test lesson '+i}))).status,200);
  }
  const firstPage=await getPull(epoch,0);
  assert.equal(firstPage.body.more,true);
  assert.equal(firstPage.body.cursor,100);
  assert.equal((await push(make('B','bookmark','after-page',0,{name:'After page 1'}))).status,200);
  const nextPage=await getPull(epoch,firstPage.body.cursor,firstPage.body.high);
  assert.equal(nextPage.body.more,false);
  assert.equal(nextPage.body.changes.some(c=>c.row.id==='after-page'),false);
  const nextWindow=await getPull(epoch,nextPage.body.cursor);
  assert.deepEqual(nextWindow.body.changes.map(c=>c.row.id),['after-page']);

  const beforeRestart=await getSnapshot();
  await stop();
  await start();
  assert.deepEqual(await getSnapshot(),beforeRestart);
  assert.deepEqual(await push(lost),retry);
  assert.equal((await fetch(root+'/')).status,200);
  assert.equal((await fetch(root+'/workout.webp')).headers.get('content-type'),'image/webp');
});
