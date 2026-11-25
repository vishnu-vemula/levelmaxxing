import {createCloudApp, readCloudConfig} from './cloud.ts';
import {createLocalApp} from './local.ts';
import {createNodeServer} from './platform/node-http.ts';
import type {AppDependencies} from './app.ts';

const env = process.env;
const port = Number(env.LEVELMAXING_PORT ?? 4321);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Set a valid LEVELMAXING_PORT.');
const log: NonNullable<AppDependencies['log']> = record => console.info(JSON.stringify(record));

function handler() {
  const origin = env.LEVELMAXING_ALLOWED_ORIGIN;
  if (env.LEVELMAXING_MODE === 'local') return createLocalApp({
    participantToken: env.LEVELMAXING_LOCAL_TOKEN ?? '',
    ...(env.LEVELMAXING_LOCAL_SECOND_TOKEN === undefined ? {} : {secondParticipantToken: env.LEVELMAXING_LOCAL_SECOND_TOKEN}),
    ...(env.LEVELMAXING_LOCAL_OPERATOR_TOKEN === undefined ? {} : {operatorToken: env.LEVELMAXING_LOCAL_OPERATOR_TOKEN}),
    ...(origin === undefined ? {} : {allowedOrigin: origin}),
    log,
  });
  if (env.LEVELMAXING_MODE === 'cloud') return createCloudApp({
    ...readCloudConfig(name => env[name], 'node'),
    log,
  });
  throw new Error('Set LEVELMAXING_MODE to local or cloud.');
}

const server = createNodeServer(handler(), port);
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('Levelmaxing could not start the loopback listener: ' + (error.code ?? 'listener_error'));
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.info(JSON.stringify({event: 'api.listening', port})));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
}
