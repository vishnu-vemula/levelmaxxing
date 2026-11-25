import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome');
const scratch = await mkdtemp(resolve(tmpdir(), 'levelmaxing-operator-'));
const profile = resolve(scratch, 'chrome');
const origin = 'http://127.0.0.1:5173';
const children = [];
const token = () => randomBytes(32).toString('hex');
const participant = token();
const operator = token();
let browser;

function launch(command, args, cwd, overrides) {
  const processHandle = spawn(command, args, {
    cwd,
    env: { ...process.env, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(processHandle);
  const result = { processHandle, output: '', failed: false };
  processHandle.on('error', () => { result.failed = true; });
  for (const stream of [processHandle.stdout, processHandle.stderr]) {
    stream.on('data', (chunk) => { result.output = (result.output + chunk).slice(-10_000); });
  }
  return result;
}

async function until(check, description, deadlineMs = 14_000) {
  const expires = Date.now() + deadlineMs;
  while (Date.now() < expires) {
    if (await check()) return;
    await delay(90);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function ready(child, text, label) {
  await until(() => {
    if (child.failed || child.processHandle.exitCode !== null) throw new Error(label + ' could not start. Check its installation and local port.');
    return child.output.includes(text);
  }, label);
}

async function openPage(endpoint) {
  const target = await fetch(endpoint + '/json/new?about:blank', {
    method: 'PUT',
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json());
  browser = new WebSocket(target.webSocketDebuggerUrl);
  await once(browser, 'open');
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  browser.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const call = pending.get(message.id);
    if (call) {
      clearTimeout(call.timer);
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id++;
    const requestId = id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Chrome command timed out: ' + method));
    }, 4000);
    pending.set(requestId, { resolve, reject, timer });
    browser.send(JSON.stringify({ id: requestId, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    send,
    exceptions,
    evaluate: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error('Chrome could not evaluate browser assertion.');
      return result.result.value;
    },
  };
}

try {
  const api = launch(process.execPath, ['backend/src/node.ts'], workspace, {
    LEVELMAXING_MODE: 'local',
    LEVELMAXING_PORT: '4321',
    LEVELMAXING_ALLOWED_ORIGIN: origin,
    LEVELMAXING_LOCAL_TOKEN: participant,
    LEVELMAXING_LOCAL_OPERATOR_TOKEN: operator,
    LEVELMAXING_LOCAL_SECOND_TOKEN: token(),
  });
  await ready(api, 'api.listening', 'the Levelmaxing API on port 4321');
  const adminPath = resolve(workspace, 'backend/admin');
  const admin = launch(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173'], adminPath, {
    VITE_LEVELMAXING_AUTH_MODE: 'local',
    VITE_LEVELMAXING_API_BASE: '/api',
  });
  await ready(admin, 'http://127.0.0.1:5173/', 'Vite on port 5173');

  const chromeProcess = launch(chrome, [
    '--headless=new', '--disable-gpu', '--disable-crash-reporter', '--no-first-run',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], workspace, { BREAKPAD_DUMP_LOCATION: scratch });
  let endpoint;
  await until(async () => {
    if (chromeProcess.failed || chromeProcess.processHandle.exitCode !== null) throw new Error('Chrome could not start.');
    try {
      const file = await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8');
      endpoint = 'http://127.0.0.1:' + Number(file.split('\n')[0]);
      return Boolean(endpoint);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return false;
    }
  }, 'a Chrome DevTools port');

  const page = await openPage(endpoint);
  const hasText = (text) => page.evaluate('Boolean(document.body?.innerText.includes(' + JSON.stringify(text) + '))');
  const submit = (value) => page.evaluate(
    '(() => { const input = document.querySelector("[name=token]"); input.value = ' +
    JSON.stringify(value) + '; input.form.requestSubmit(); })()',
  );
  const press = (label) => page.evaluate(
    '[...document.querySelectorAll("button")].find(button => button.textContent === ' +
    JSON.stringify(label) + ').click()',
  );
  const size = (width, height) => page.send('Emulation.setDeviceMetricsOverride', {
    width, height, mobile: false, deviceScaleFactor: 1,
  });

  await size(1170, 760);
  await page.send('Page.navigate', { url: origin });
  await until(() => hasText('Local operator credential'), 'the local admin sign-in');
  await until(() => page.evaluate('Boolean(document.querySelector(".health-reachable"))'), 'liveness passing through the Vite proxy');
  await submit(participant);
  await until(() => hasText('Operator access denied'), 'denied staff access for a participant');
  await press('Sign out');
  await until(() => hasText('Local operator credential'), 'the sign-out state');
  await submit(operator);
  await until(() => hasText('Operator role verified'), 'authenticated operator access');
  assert.ok(await page.evaluate('localStorage.length === 0 && sessionStorage.length === 0'));
  await size(375, 812);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page.evaluate('document.documentElement.style.fontSize = "24px"');
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  if (process.env.LEVELMAXING_TEST_SCREENSHOTS) {
    const output = resolve(process.env.LEVELMAXING_TEST_SCREENSHOTS);
    await mkdir(output, { recursive: true });
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(output, 'operator-dark-large.png'), Buffer.from(data, 'base64'));
  }
  await page.send('Page.reload');
  await until(() => hasText('Local operator credential'), 'discarding the in-memory session on reload');
  assert.deepEqual(page.exceptions, []);
  console.log('Operator browser check passed: proxy liveness, role denial, operator sign-in, in-memory session, dark and large-text narrow layout.');
} finally {
  browser?.close();
  await Promise.all(children.map(async (child) => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }));
  await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
