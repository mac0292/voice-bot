import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSpeech } from '../public/js/web-speech-stt.js';
import { createTts } from '../public/js/tts.js';
import { Settings } from '../public/js/settings.js';
import { Transcript, JOURNAL_KEY } from '../public/js/transcript.js';
import { requestReply } from '../public/js/api.js';

test('Web Speech maps cumulative browser results and acquires no separate media stream', () => {
  let native;
  const global = {
    isSecureContext: true,
    navigator: {
      language: 'en-IN',
      mediaDevices: { getUserMedia: () => assert.fail('browser recognizer owns microphone') },
    },
    webkitSpeechRecognition: class {
      constructor() { native = this; }
      start() { this.onstart(); }
      abort() { this.onend(); }
    },
  };
  const stt = createWebSpeech(global);
  const seen = [];
  const session = stt.open({
    start: () => seen.push('started'), end: () => seen.push('ended'),
    result: text => seen.push(text),
  });
  session.start();
  assert.equal(native.continuous, true);
  assert.equal(native.interimResults, true);
  assert.equal(native.lang, 'en-IN');
  const result = transcript => [{ transcript }];
  native.onresult({ results: [result(' one '), result(' tw ')] });
  native.onresult({ resultIndex: 1, results: [result(' one '), result(' two ')] });
  native.onresult({ resultIndex: 1, results: [result(' one ')] });
  session.abort();
  assert.deepEqual(seen, ['started', 'one tw', 'one two', 'one', 'ended']);
  assert.match(createWebSpeech({}).reason, /localhost/);
  assert.equal(createWebSpeech({ isSecureContext: true }).supported, false);
});

test('TTS terminal and cancel callbacks each settle once', () => {
  let utterance;
  let cancelled = 0;
  const tts = createTts({
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { speak: item => { utterance = item; }, cancel: () => { cancelled++; } },
  });
  const outcomes = [];
  const cancelAfterEnd = tts.play('hello', reason => outcomes.push(reason));
  assert.equal(utterance.text, 'hello');
  utterance.onend();
  cancelAfterEnd();
  const cancel = tts.play('again', reason => outcomes.push(reason));
  const lateEnd = utterance.onend;
  cancel();
  lateEnd();
  tts.play('error', reason => outcomes.push(reason));
  utterance.onerror();
  assert.deepEqual(outcomes, ['end', 'cancelled', 'error']);
  assert.equal(cancelled, 1);
});

test('key is replaceable, clearable and absent from persisted journal and exports', () => {
  const settings = new Settings();
  const apply = key => settings.apply({ key, model: settings.model, seconds: 3, ttsEnabled: true });
  apply('secret-1');
  assert.equal(settings.key, 'secret-1');
  apply('secret-2');
  apply('');
  assert.equal(settings.key, 'secret-2');
  const data = new Map();
  const storage = {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  const journal = new Transcript(storage);
  journal.append('user', 'Question one', 'turn-1');
  journal.append('assistant', 'Answer one', 'turn-1');
  journal.append('user', 'Question two', 'turn-2');
  journal.append('assistant', 'Answer two', 'turn-2');
  const restored = new Transcript(storage);
  assert.deepEqual(restored.messages, journal.messages);
  assert.deepEqual([...data.keys()], [JOURNAL_KEY]);
  const md = restored.export('markdown');
  assert.match(md, /You.*\n\n> Question one[\s\S]+Assistant.*\n\n> Answer one/);
  assert.doesNotMatch(md + restored.export('json') + JSON.stringify(settings), /secret-/);
  assert.equal(new Settings().key, '');
  settings.clearKey();
  assert.equal(settings.key, '');
  restored.clear();
  assert.equal(data.size, 0);
});

test('storage errors leave the transcript available for export', () => {
  const journal = new Transcript({ getItem: () => '{', setItem: () => { throw Error(); } });
  assert.match(journal.warning, /could not be read/);
  journal.append('user', 'preserved', 'one');
  assert.match(journal.warning, /could not be saved/);
  assert.match(journal.export('json'), /preserved/);
});

test('client sends credentials in Authorization and propagates safe backend errors', async () => {
  const signal = new AbortController().signal;
  const args = { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4.1-mini', key: 'secret', signal };
  await assert.rejects(requestReply(args, async (url, init) => {
    assert.equal(url, '/api/chat');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.equal(init.signal, signal);
    assert.doesNotMatch(init.body, /secret/);
    return Response.json({ message: 'Try again' }, { status: 429 });
  }), /Try again/);
});
