import { MAX_CONTEXT } from './config.js';

export const JOURNAL_KEY = 'voice-ai-chat.journal.v1';

export class Transcript {
  constructor(storage) {
    this.storage = storage;
    this.messages = [];
    this.warning = '';
    try {
      const value = storage?.getItem(JOURNAL_KEY);
      if (value) {
        const rows = JSON.parse(value);
        if (!Array.isArray(rows) || !rows.every(validMessage)) throw new Error();
        this.messages = rows;
      }
      if (!storage) this.warning = 'Browser storage is unavailable. Export before closing.';
    } catch {
      this.warning = 'Saved history could not be read. Export new messages before closing.';
    }
    this.conversationId = this.messages.at(-1)?.conversationId ?? crypto.randomUUID();
  }

  append(role, text, turnId) {
    this.messages.push({
      id: crypto.randomUUID(), conversationId: this.conversationId, role, text,
      createdAt: new Date().toISOString(), turnId,
    });
    this.save();
  }

  clear() {
    this.messages = [];
    this.conversationId = crypto.randomUUID();
    this.save();
  }

  save() {
    if (!this.storage) return;
    try {
      if (this.messages.length) this.storage.setItem(JOURNAL_KEY, this.export('json'));
      else this.storage.removeItem(JOURNAL_KEY);
      this.warning = '';
    } catch {
      this.warning = 'History could not be saved to browser storage. Export this transcript.';
    }
  }

  context() {
    return this.messages.slice(-MAX_CONTEXT).map(({ role, text }) => ({ role, content: text }));
  }

  export(format) {
    if (format === 'json') return JSON.stringify(this.messages, null, 2);
    const sections = this.messages.map(({ role, createdAt, text }) => {
      const speaker = role === 'user' ? 'You' : 'Assistant';
      return '## ' + speaker + ' · ' + createdAt + '\n\n' +
        text.split(/\r?\n/).map(line => '> ' + line).join('\n');
    });
    return ['# Voice AI Chat transcript', ...sections].join('\n\n') + '\n';
  }
}

function validMessage(row) {
  return row && ['user', 'assistant'].includes(row.role) &&
    ['id', 'conversationId', 'text', 'createdAt', 'turnId'].every(key => typeof row[key] === 'string') &&
    Number.isFinite(Date.parse(row.createdAt));
}
