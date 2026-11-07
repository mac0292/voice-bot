export const byId = id => document.getElementById(id);

export function createUi({ journal, settings, stt, tts }) {
  const conversation = byId('conversation');
  const messages = byId('messages');
  const typed = byId('message');
  const status = byId('status');
  const notice = byId('notice');
  const debug = byId('debug');
  let renderedCount = 0;
  let lastMessage;

  const start = byId('start');
  const mic = byId('mic');
  const playback = byId('tts');
  const send = byId('send');
  const support = byId('support');
  support.textContent = stt.supported
    ? 'Your browser manages microphone access and may interrupt recognition.'
    : stt.reason;

  function showMessages() {
    const follow = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 56;
    if (renderedCount && journal.messages[renderedCount - 1] !== lastMessage) {
      messages.replaceChildren();
      renderedCount = 0;
    }
    for (const row of journal.messages.slice(renderedCount)) {
      const item = document.createElement('li');
      item.dataset.role = row.role;
      const meta = document.createElement('p');
      meta.className = 'meta';
      const time = document.createElement('time');
      time.dateTime = row.createdAt;
      time.textContent = new Date(row.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      meta.append(row.role === 'user' ? 'You · ' : 'Assistant · ', time);
      const text = document.createElement('p');
      text.className = 'bubble';
      text.textContent = row.text;
      item.append(meta, text);
      messages.append(item);
    }
    if (renderedCount !== journal.messages.length && follow) conversation.scrollTop = conversation.scrollHeight;
    renderedCount = journal.messages.length;
    lastMessage = journal.messages.at(-1);
    byId('empty').hidden = renderedCount > 0;
  }

  return controller => {
    showMessages();
    if (status.textContent !== controller.status) status.textContent = controller.status;
    status.dataset.live = String(controller.sttState === 'listening');
    const stopping = controller.handsFreeEnabled || controller.busy;
    start.textContent = controller.handsFreeEnabled ? 'Stop listening' :
      controller.busy ? 'Stop reply' : 'Start listening';
    start.disabled = !stopping && !stt.supported;
    mic.disabled = !controller.handsFreeEnabled;
    mic.textContent = controller.micMuted ? 'Unmute microphone' : 'Mute microphone';
    mic.setAttribute('aria-pressed', String(controller.micMuted));
    playback.disabled = !tts.supported;
    playback.setAttribute('aria-pressed', String(settings.ttsEnabled && tts.supported));
    byId('skip').hidden = controller.assistantState !== 'speaking';
    byId('retry-tools').hidden = !controller.pending || controller.busy;
    typed.disabled = controller.busy || Boolean(controller.pending);
    send.disabled = typed.disabled || !(typed.value.trim() || controller.draft.trim());
    byId('live-draft').hidden = !controller.draft;
    byId('draft-text').textContent = controller.draft;
    byId('turn-hint').textContent = controller.busy ? 'Voice input is paused during the reply.' :
      controller.pending ? 'Retry the last turn or continue without a reply.' :
      'Sends after ' + settings.silenceMs / 1000 + ' seconds of silence.';
    const message = [controller.notice, journal.warning].filter(Boolean).join(' ');
    if (notice.textContent !== message) notice.textContent = message;
    notice.hidden = !message;
    byId('clear-history').disabled = !renderedCount || controller.busy;
    byId('markdown').disabled = byId('json').disabled = !renderedCount;
    if (debug.open) byId('diagnostics').textContent = JSON.stringify(controller.diagnostics, null, 2);
  };
}

export function downloadJournal(journal, format) {
  const markdown = format === 'markdown';
  const blob = new Blob([journal.export(format)], {
    type: markdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'voice-ai-transcript.' + (markdown ? 'md' : 'json');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
