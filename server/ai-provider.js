const endpoint = 'https://api.openai.com/v1/responses';

export class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}

export async function askOpenAI({ key, model, messages, signal }, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, input: messages, store: false, max_output_tokens: 550,
        instructions: 'Answer conversationally and concisely. Your answer will be read aloud.',
      }),
      signal,
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new ChatError(502, 'provider_unreachable', 'Could not reach OpenAI. Check your connection and retry.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new ChatError(401, 'provider_access', 'OpenAI rejected the key or model access. Check Settings and retry.');
    }
    if (response.status === 429) {
      throw new ChatError(429, 'provider_limit', 'OpenAI reported a rate or quota limit. Check your API account and retry.');
    }
    if (response.status === 404) {
      throw new ChatError(400, 'model_unavailable', 'This model is unavailable for your key. Select another model and retry.');
    }
    throw new ChatError(502, 'provider_error', 'OpenAI could not complete the request. Retry the turn.');
  }
  const data = await response.json().catch(() => null);
  const reply = data?.output?.filter(item => item.type === 'message' && item.role === 'assistant')
    .flatMap(item => item.content).map(part => part.text ?? part.refusal ?? '')
    .filter(Boolean).join('\n').trim();
  if (!reply) throw new ChatError(502, 'empty_reply', 'OpenAI returned no text. Retry the turn.');
  return reply.slice(0, 6000);
}
