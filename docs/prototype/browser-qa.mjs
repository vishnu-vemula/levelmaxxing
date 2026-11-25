import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const proto = fileURLToPath(new URL('.',import.meta.url));
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const serverPort = process.env.LEVELMAXING_BROWSER_TEST_PORT || '4326';
const debugPort = process.env.LEVELMAXING_DEBUG_TEST_PORT || '9426';
const base = 'http://127.0.0.1:' + serverPort;
const cdp = 'http://127.0.0.1:' + debugPort;
const captureDir = process.env.LEVELMAXING_CAPTURE_DIR;
const dir = await mkdtemp(resolve(tmpdir(),'levelmaxing-browser-'));
const children=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label) {
  for(let i=0;i<64;i++) {
    let result;
    try { result=await f(); } catch(err) { if (i>61) throw err; }
    if(result) return result;
    await delay(100);
  }
  throw Error('Timed out: '+label);
}
function run(file,args,env) {
  const child=spawn(file,args,{env:{...process.env,...env},stdio:['ignore','ignore','pipe']});
  children.push(child);
  child.stderr.on('data',b=>{const message=b.toString();if(!message.includes('ERROR:') && !message.includes('DevTools'))process.stderr.write(message);});
  child.on('error',err=>{process.stderr.write(err.message+'\n');});
  return child;
}
async function tab() {
  const r = await fetch(cdp+'/json/new?about:blank',{method:'PUT'});
  const target=await r.json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await once(ws,'open');
  const pending=new Map();
  const errors=[];
  let seq=0;
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if(!msg.id)return;
    const [pass,fail]=pending.get(msg.id)||[];
    pending.delete(msg.id);
    if(msg.error)fail?.(Error(msg.error.message));else pass?.(msg.result);
  });
  const call=(method,params={})=>new Promise((pass,fail)=>{
    const id=++seq;pending.set(id,[pass,fail]);ws.send(JSON.stringify({id,method,params}));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  const js=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  return {call,js,errors,ws,activate:()=>call('Page.bringToFront'),
    go:url=>call('Page.navigate',{url:base+url}),
    size:(w,h,mobile)=>call('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile}),
    shot:async path=>{const {data}=await call('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(data,'base64'));},
    click:selector=>js('document.querySelector('+JSON.stringify(selector)+').click()'),
    value:(name,value)=>js('document.querySelector("dialog [name="+ '+JSON.stringify(name)+' +"]").value = '+JSON.stringify(value)),
    submit:()=>js('document.querySelector("dialog form").requestSubmit()')
  };
}
const sees=(t,text)=>t.js('document.body.innerText.includes('+JSON.stringify(text)+')');
const waitText=(t,text)=>until(()=>sees(t,text),text);
const click=(t,action)=>t.click('[data-do="'+action+'"]');
const close=t=>t.js('if (document.querySelector("dialog").open) document.querySelector("dialog").close()');
const clickDialog=(t,action)=>t.click('dialog [data-do="'+action+'"]');
const ensureSynced = t => until(()=>t.js('document.querySelector("#sync-label").textContent === "Synced"'),'Synced');
const changeView = async(t,name) => { await t.js('location.hash='+JSON.stringify(name)); await until(()=>t.js('location.hash === '+JSON.stringify('#'+name)),name);};
try {
  run(process.execPath,[resolve(proto,'server.mjs')],{LEVELMAXING_DATA_DIR:resolve(dir,'data'),PORT:serverPort});
  run(chrome,['--headless=new','--disable-gpu','--disable-breakpad','--disable-crash-reporter','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debugPort,'--user-data-dir='+resolve(dir,'chrome'),'about:blank'],{BREAKPAD_DUMP_LOCATION:dir});
  await until(async()=> (await fetch(base+'/')).ok,'server ready');
  await until(async()=> (await fetch(cdp+'/json/version')).ok,'browser ready');
  const a=await tab();
  await a.size(1440,940,false);
  await a.go('/?device=A#today');
  await ensureSynced(a);
  if(captureDir)await a.shot(resolve(captureDir,'desktop-preview.png'));
  const m=await tab();
  await m.size(390,844,true);
  await m.go('/?device=A#today');
  await ensureSynced(m);
  if(captureDir)await m.shot(resolve(captureDir,'mobile-preview.png'));
  await a.activate();
  await click(a,'start-workout');
  await waitText(a,'In progress');
  await click(a,'set');
  await a.submit();
  await waitText(a,'25 kg × 8 reps');
  await click(a,'program');
  await a.value('name','Training draft QA');
  await a.submit();
  await ensureSynced(a);
  assert(await a.js('document.querySelector(".current-session h2").textContent === "Upper body strength"'));
  await click(a,'finish');
  await clickDialog(a,'finish-confirm');
  await ensureSynced(a);
  await waitText(a,'Session history');
  assert(await sees(a,'Complete'));
  const b=await tab();
  await b.size(1440,900,false);
  await b.go('/?device=B#training');
  await ensureSynced(b);
  await waitText(b,'25 kg × 8 reps');
  assert(await sees(b,'Complete'));
  await changeView(a,'nutrition');
  await waitText(a,'Recipes');
  await click(a,'sync-panel');
  await clickDialog(a,'offline');
  await close(a);
  await click(a,'food');
  await clickDialog(a,'food-manual');
  await a.value('name','Offline lunch QA');
  for(const [field,value] of [['calories',410],['protein',26],['carbs',44],['fat',14]])await a.value(field,value);
  await a.submit();
  await waitText(a,'Offline lunch QA');
  await a.call('Page.reload');
  await waitText(a,'Offline lunch QA');
  assert(await sees(a,'Offline'));
  await changeView(b,'nutrition');
  await waitText(b,'Recipes');
  assert.equal(await sees(b,'Offline lunch QA'),false);
  await click(a,'sync-panel');
  await clickDialog(a,'offline');
  await close(a);
  await ensureSynced(a);
  await b.activate();
  await waitText(b,'Offline lunch QA');
  await a.activate();
  await click(a,'sync-panel');
  await clickDialog(a,'offline');
  await close(a);
  const editMeal=(t,name)=>t.js(`[...document.querySelectorAll('main li')].find(e=>e.innerText.includes(${JSON.stringify(name)})).querySelector('[data-do=edit-meal]').click()`);
  await editMeal(a,'Offline lunch QA');
  await a.value('name','Unsynced draft QA');
  await a.submit();
  await waitText(a,'Unsynced draft QA');
  await b.activate();
  await editMeal(b,'Offline lunch QA');
  await clickDialog(b,'delete');
  await clickDialog(b,'confirm-delete');
  await ensureSynced(b);
  assert.equal(await sees(b,'Offline lunch QA'),false);
  await a.activate();
  await click(a,'sync-panel');
  await clickDialog(a,'offline');
  await close(a);
  await waitText(a,'1 to review');
  assert.equal(await sees(a,'Unsynced draft QA'),false);
  await click(a,'sync-panel');
  await clickDialog(a,'conflict');
  await waitText(a,'This entry was deleted.');
  assert(await sees(a,'Unsynced draft QA'));
  await clickDialog(a,'apply-conflict');
  await ensureSynced(a);
  await b.activate();
  await waitText(b,'Unsynced draft QA');
  await b.click('main [data-do="food"]');
  await b.click('dialog [data-do="scan"][data-id="Photo"]');
  await b.submit();
  await waitText(b,'Sample result');
  await b.submit();
  await ensureSynced(b);
  await waitText(b,'Photo sample');

  await click(b,'recipe');
  await b.value('name','QA dal bowl');
  await b.submit();
  await ensureSynced(b);
  await click(b,'recipe-detail');
  await b.submit();
  await b.submit();
  await ensureSynced(b);
  const logged = await b.js(`[...document.querySelectorAll('main li')].find(e=>e.innerText.includes('QA dal bowl') && e.innerText.includes('kcal')).innerText`);
  await click(b,'recipe-detail');
  await clickDialog(b,'recipe-edit');
  await b.value('yield',900);
  await b.submit();
  await ensureSynced(b);
  assert.equal(await b.js(`[...document.querySelectorAll('main li')].find(e=>e.innerText.includes('QA dal bowl') && e.innerText.includes('kcal')).innerText`),logged);
  await m.activate();
  await m.call('Page.reload');
  await ensureSynced(m);
  assert(await m.js('document.documentElement.scrollWidth === innerWidth'));
  await click(m,'more');
  await m.click('dialog [data-id="settings"]');
  await waitText(m,'Manage your profile');
  await m.click('main [data-do="theme"]');
  await changeView(m,'today');
  await waitText(m,'Nutrition overview');
  await m.js('document.documentElement.style.fontSize="26px"');
  assert(await m.js('document.documentElement.scrollWidth === innerWidth'));
  assert(await m.js('document.querySelector("#sync-status").getBoundingClientRect().right <= innerWidth'));
  assert(await m.js('document.querySelector("#mobile-nav").getBoundingClientRect().bottom <= innerHeight'));
  if(captureDir)await m.shot(resolve(captureDir,'dark-large-preview.png'));
  await m.size(320,760,true);
  assert(await m.js('document.documentElement.scrollWidth === innerWidth'));
  for(const name of ['today','training','nutrition','progress','coach','library','settings']) {
    await changeView(m,name);
    await delay(70);
    assert(await m.js('document.documentElement.scrollWidth === innerWidth'),name+' overflows at 320 px with 26 px base');
  }
  await a.activate();
  await a.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert(await a.js('document.activeElement.matches("a,button,input,main,select,textarea")'));
  assert.deepEqual([...a.errors,...b.errors,...m.errors],[]);
  for(const current of [a,b,m])current.ws.close();
  console.log('Browser QA passed: two-client workouts, offline reload and reconciliation, tombstone conflict and save-as-new, sample meal scan, preserved workout and recipe snapshots, 1440/390/320 px, dark and enlarged text, keyboard and no page exceptions.');
} finally {
  for(const child of children){
    if(child.exitCode === null && child.signalCode === null && child.pid){
      const closed=once(child,'close');
      child.kill();
      await closed;
    }
  }
  await rm(dir,{recursive:true,force:true});
}
