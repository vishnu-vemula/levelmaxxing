import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../.local/', import.meta.url);
const file = new URL('access.env', directory);

await mkdir(directory, { recursive: true, mode: 0o700 });
const lines = [
  'LEVELMAXING_MODE=local',
  'LEVELMAXING_PORT=4321',
  'LEVELMAXING_ALLOWED_ORIGIN=http://localhost:5173',
  ...['LOCAL_TOKEN', 'LOCAL_OPERATOR_TOKEN', 'LOCAL_SECOND_TOKEN'].map(name =>
    'LEVELMAXING_' + name + '=' + randomBytes(32).toString('hex')),
];
try {
  await writeFile(file, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Created .local/access.env. Open it locally to copy a development token.');
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
  console.log('Existing .local/access.env is ready.');
}
