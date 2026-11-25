import { createCloudApp, readCloudConfig } from '../../../src/cloud.ts';

const app = createCloudApp({
  ...readCloudConfig(name => Deno.env.get(name), 'edge'),
  log: (record) => console.info(JSON.stringify(record)),
});

Deno.serve((request) => {
  const url = new URL(request.url);
  const normalized = url.pathname.replace(/^\/(?:functions\/v1\/)?api(?=\/|$)/, '') || '/';
  if (normalized === url.pathname) return app(request);
  url.pathname = normalized;
  return app(new Request(url, request));
});
