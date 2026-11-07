export async function requestReply({ messages, model, key, signal }, fetcher = fetch) {
  let response;
  try {
    response = await fetcher('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ messages, provider: 'openai', model }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Could not reach the app server. Check your connection and retry.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? 'The app server could not reply. Try again.');
  if (typeof body?.reply !== 'string' || !body.reply.trim()) throw new Error('The app server returned no reply.');
  return body.reply;
}
