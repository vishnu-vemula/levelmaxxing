import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {HttpProblem, problemResponse} from './http.ts';

export function createNodeServer(handle: (request: Request) => Promise<Response>, port: number) {
  return createServer({requestTimeout: 12_000, headersTimeout: 8_000, maxHeaderSize: 16_384}, async (req, res) => {
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const bound = res.socket?.localPort ?? port;
      const allowedHosts = new Set(['localhost', '127.0.0.1', '10.0.2.2'].map(host => host + ':' + bound));
      const target = req.url ?? '';
      let response: Response;
      if (!allowedHosts.has(req.headers.host ?? '') || !target.startsWith('/') || target.startsWith('//')) {
        response = problemResponse(new HttpProblem(400, 'invalid_request_target', 'A local request target is required'), crypto.randomUUID());
      } else {
        const method = req.method ?? 'GET';
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) value.forEach(entry => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        const init: RequestInit & {duplex?: 'half'} = {method, headers, signal: controller.signal};
        if (method !== 'GET' && method !== 'HEAD') {
          init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
          init.duplex = 'half';
        }
        response = await handle(new Request('http://127.0.0.1:' + bound + target, init));
      }
      // Early errors can leave an unread body. Close after the reply instead of retaining that connection.
      if (!req.complete) res.shouldKeepAlive = false;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
      else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed) res.writeHead(500, {'cache-control': 'no-store'}).end();
      else if (!res.writableFinished) res.destroy();
    }
  });
}
