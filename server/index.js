import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chat, json } from './chat.js';

const mime = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
const publicRoot = new URL('../public/', import.meta.url);
const loopbackHost = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

export function createApp(options) {
  return createServer({ requestTimeout: 30000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    if (!loopbackHost.test(req.headers.host ?? '')) {
      return json(res, 403, { message: 'Use localhost to access this app.' });
    }
    const path = new URL('http://localhost' + (req.url?.startsWith('/') ? req.url : '/')).pathname;
    if (path === '/api/chat') {
      if (req.method !== 'POST') return json(res, 405, { message: 'Use POST for this endpoint.' });
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) {
        return json(res, 403, { message: 'Send chat requests from the app origin.' });
      }
      return chat(req, res, options);
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: 'Method not allowed.' });
    if (!/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:html|css|js|svg)$/.test(file)) {
      return json(res, 404, { message: 'Page not found.' });
    }
    try {
      const data = await readFile(new URL(file, publicRoot));
      res.writeHead(200, { 'Content-Type': mime[file.split('.').at(-1)] + '; charset=utf-8',
        'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      json(res, 404, { message: 'Page not found.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, '127.0.0.1', function () {
    console.log('Voice AI Chat is running at http://127.0.0.1:' + this.address().port);
  });
}
