import { MAX_CONTEXT, MAX_MESSAGE, MODELS } from '../public/js/config.js';
import { askOpenAI, ChatError } from './ai-provider.js';

const maxBody = 512 * 1024;

export function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= maxBody) chunks.push(chunk);
      else reject(new ChatError(413, 'body_too_large', 'The request is too large.'));
    });
    request.once('error', reject);
    request.once('end', () => {
      if (size > maxBody) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ChatError(400, 'invalid_json', 'The request must contain valid JSON.'));
      }
    });
  });
}

function validate(body) {
  if (body?.provider !== 'openai' || typeof body.model !== 'string' || !Object.hasOwn(MODELS, body.model)) {
    throw new ChatError(400, 'invalid_provider', 'Select a supported OpenAI model.');
  }
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_CONTEXT ||
      messages.at(-1)?.role !== 'user' || !messages.every(row =>
        row && ['user', 'assistant'].includes(row.role) &&
        typeof row.content === 'string' && row.content.trim() && row.content.length <= MAX_MESSAGE)) {
    throw new ChatError(400, 'invalid_messages', 'Send a valid conversation ending in a user message.');
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

export async function chat(request, response, { fetcher, timeoutMs = 25000 } = {}) {
  const disconnected = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) disconnected.abort();
  });
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([timeout, disconnected.signal]);
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      throw new ChatError(415, 'invalid_content_type', 'Send the request as JSON.');
    }
    const key = /^Bearer ([!-~]{1,512})$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!key) throw new ChatError(401, 'missing_key', 'Add an OpenAI API key in Settings.');
    const body = await readBody(request);
    const messages = validate(body);
    const reply = await askOpenAI({ key, model: body.model, messages, signal }, fetcher);
    if (!disconnected.signal.aborted) json(response, 200, { reply });
  } catch (error) {
    if (disconnected.signal.aborted || response.destroyed) return;
    const failure = timeout.aborted
      ? new ChatError(504, 'provider_timeout', 'OpenAI took too long to reply. Retry the turn.')
      : error instanceof ChatError ? error : new ChatError(500, 'internal_error', 'The app server could not complete the request.');
    json(response, failure.status, { code: failure.code, message: failure.message });
  }
}
