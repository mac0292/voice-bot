import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';

async function app(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

const body = { provider: 'openai', model: 'gpt-4.1-mini',
  messages: [{ role: 'user', content: 'Hello' }] };
function post(url, payload = body, headers = {}) {
  return fetch(url + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('server hosts the app and proxies validated chat to the OpenAI Responses API', async t => {
  const url = await app(t, { fetcher: async (upstream, request) => {
    assert.equal(upstream, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.Authorization, 'Bearer fixture-key');
    const { model, store, input, max_output_tokens } = JSON.parse(request.body);
    assert.equal(model, body.model);
    assert.equal(store, false);
    assert.ok(max_output_tokens > 0 && max_output_tokens < 1000);
    assert.deepEqual(input, body.messages);
    return Response.json({ output: [{ type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello back.' }] }] });
  } });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /Start listening/);
  const js = await fetch(url + '/js/main.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(url + '/.env')).status, 404);
  const response = await post(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'Hello back.' });
});

test('validates headers, origin, provider, messages and body size before calling OpenAI', async t => {
  const url = await app(t, { fetcher: () => assert.fail('should not call provider') });
  for (const [payload, headers, status] of [
    [body, { Authorization: '' }, 401],
    [body, { 'Content-Type': 'text/plain' }, 415],
    [body, { Origin: 'https://example.test' }, 403],
    ['{', {}, 400],
    [{ ...body, model: '__proto__' }, {}, 400],
    [{ ...body, messages: [{ role: 'system', content: 'hi' }] }, {}, 400],
    [{ ...body, messages: Array(21).fill(body.messages[0]) }, {}, 400],
    [' '.repeat(512 * 1024 + 1), {}, 413],
  ]) {
    const response = await post(url, payload, headers);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /fixture-key/);
  }
});

test('upstream access and quota errors are mapped without echoing provider details', async t => {
  const statuses = [401, 429];
  const url = await app(t, { fetcher: async () => new Response('fixture-key', { status: statuses.shift() }) });
  for (const code of [401, 429]) {
    const response = await post(url);
    assert.equal(response.status, code);
    assert.doesNotMatch(await response.text(), /fixture-key/);
  }
});

test('provider timeout aborts the upstream request and returns a retryable error', async t => {
  const url = await app(t, { timeoutMs: 100, fetcher: async (_url, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const response = await post(url);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'provider_timeout');
});
