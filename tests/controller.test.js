import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../public/js/controller.js';
import { Settings } from '../public/js/settings.js';
import { Transcript } from '../public/js/transcript.js';

function fakeTime() {
  let now = 0;
  let next = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++next;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    tick(ms) {
      const end = now + ms;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > end) break;
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = end;
    },
  };
}

function harness({ holdEnd = false, supported = true } = {}) {
  const clock = fakeTime();
  const sessions = [];
  const calls = [];
  const playback = [];
  const journal = new Transcript();
  const settings = new Settings();
  settings.apply({ key: 'test-key', model: settings.model, seconds: 3, ttsEnabled: true });
  const controller = new SessionController({
    clock, now: clock.now, journal, settings,
    stt: {
      supported, reason: 'Unsupported',
      open(events) {
        assert.ok(sessions.every(session => session.ended), 'recognizers must never overlap');
        const session = { ...events, ended: false, aborts: 0 };
        session.end = () => { session.ended = true; events.end(); };
        sessions.push(session);
        return {
          start: events.start,
          abort: () => { session.aborts++; if (!holdEnd) session.end(); },
        };
      },
    },
    tts: {
      supported: true,
      play(text, done) {
        assert.ok(sessions.every(session => session.ended), 'mic must be off during TTS');
        playback.push({ text, done });
        return () => done('cancelled');
      },
    },
    api: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })),
  });
  return { controller, clock, sessions, calls, playback, journal, settings };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('one Start stays enabled across turns and silence before speech sends nothing', async () => {
  const { controller: c, clock, sessions, calls, playback, journal } = harness();
  c.start();
  clock.tick(9000);
  assert.equal(calls.length, 0);
  assert.equal(sessions.length, 1);
  sessions[0].result('first turn');
  clock.tick(3000);
  assert.equal(c.status, 'Thinking');
  calls[0].resolve('First answer.');
  await settle();
  assert.equal(c.status, 'Speaking');
  assert.equal(sessions.length, 1);
  playback[0].done('end');
  assert.equal(c.status, 'Listening');
  sessions[1].result('second turn');
  clock.tick(3000);
  calls[1].resolve('Second answer.');
  await settle();
  playback[1].done('end');
  assert.equal(c.handsFreeEnabled, true);
  assert.equal(sessions.length, 3);
  assert.deepEqual(journal.messages.map(row => row.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual(calls[1].messages.map(row => row.content), ['first turn', 'First answer.', 'second turn']);
  c.stop();
  assert.equal(c.status, 'Tap to start');
});

test('speech activity at 2.9s restarts silence, and interim revisions replace old text', () => {
  const { controller: c, clock, sessions, calls } = harness();
  c.start();
  const speech = sessions[0];
  speech.result('the rain');
  clock.tick(2900);
  speech.speech(true);
  clock.tick(4000);
  assert.equal(calls.length, 0);
  speech.result('the train is');
  speech.result('the train is late');
  speech.speech(false);
  clock.tick(2999);
  assert.equal(calls.length, 0);
  clock.tick(1);
  clock.tick(3000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.at(-1).content, 'the train is late');
});

test('Send now commits once and stale events cannot send again', () => {
  const { controller: c, clock, sessions, calls } = harness({ holdEnd: true });
  c.start();
  sessions[0].result('ask now');
  assert.equal(c.send(), true);
  sessions[0].result('stale');
  assert.equal(c.send(), false);
  clock.tick(3000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.at(-1).content, 'ask now');
});

test('updating playback settings preserves elapsed silence', () => {
  const { controller: c, clock, sessions, calls, settings } = harness();
  c.start();
  sessions[0].result('keep the deadline');
  clock.tick(2900);
  settings.ttsEnabled = false;
  c.settingsChanged();
  clock.tick(100);
  assert.equal(calls.length, 1);
});

test('rapid Stop/Start waits for old onend and ignores later duplicates', () => {
  const { controller: c, clock, sessions } = harness({ holdEnd: true });
  c.start();
  c.stop();
  c.start();
  c.stop();
  c.start();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].aborts, 1);
  sessions[0].end();
  assert.equal(sessions.length, 2);
  sessions[0].end();
  sessions[0].result('stale');
  clock.tick(5000);
  assert.equal(sessions.length, 2);
  assert.equal(c.draft, '');
  assert.equal(c.status, 'Listening');
});

test('recoverable onend preserves the draft and resumes without restarting the silence clock', () => {
  const { controller: c, clock, sessions, calls } = harness();
  c.start();
  sessions[0].result('keep this');
  clock.tick(2000);
  sessions[0].end();
  assert.equal(c.status, 'Reconnecting');
  clock.tick(250);
  assert.equal(sessions.length, 2);
  clock.tick(750);
  assert.equal(calls[0].messages.at(-1).content, 'keep this');
});

test('transient network errors back off with a bounded number of attempts', () => {
  const { controller: c, clock, sessions } = harness();
  c.start();
  for (const delay of [250, 500, 1000, 2000, 4000]) {
    const count = sessions.length;
    sessions.at(-1).error('network');
    sessions.at(-1).end();
    clock.tick(delay - 1);
    assert.equal(sessions.length, count);
    clock.tick(1);
    assert.equal(sessions.length, count + 1);
  }
  sessions.at(-1).error('network');
  sessions.at(-1).end();
  clock.tick(30000);
  assert.equal(sessions.length, 6);
  assert.equal(c.status, 'Error');
  assert.equal(c.handsFreeEnabled, true);
  assert.match(c.recognitionNotice, /speech service could not connect/);
  c.retryRecognition();
  assert.equal(sessions.length, 7);
  assert.equal(c.status, 'Listening');
  assert.equal(c.recognitionNotice, '');
});

test('idle no-speech timeouts do not exhaust retries and speech still sends', () => {
  const { controller: c, clock, sessions, calls } = harness();
  c.start();
  for (let i = 0; i < 8; i++) {
    const session = sessions.at(-1);
    session.error('no-speech');
    clock.tick(1000);
    assert.equal(sessions.length, i + 1);
    session.end();
    clock.tick(999);
    assert.equal(sessions.length, i + 1);
    clock.tick(1);
    assert.equal(sessions.length, i + 2);
    assert.equal(c.status, 'Listening');
    assert.equal(c.retryCount, 0);
  }
  assert.equal(calls.length, 0);
  sessions.at(-1).result('after a long pause');
  clock.tick(3000);
  assert.equal(calls[0].messages.at(-1).content, 'after a long pause');
});

test('Stop cancels an idle recognizer restart', () => {
  const { controller: c, clock, sessions } = harness();
  c.start();
  sessions[0].error('no-speech');
  sessions[0].end();
  c.stop();
  clock.tick(10000);
  assert.equal(sessions.length, 1);
  assert.equal(c.status, 'Tap to start');
});

for (const code of ['not-allowed', 'audio-capture', 'service-not-allowed']) {
  test(code + ' disables hands-free mode without retry', () => {
    const { controller: c, clock, sessions } = harness();
    c.start();
    sessions[0].error(code);
    clock.tick(30000);
    assert.equal(sessions.length, 1);
    assert.equal(c.handsFreeEnabled, false);
    assert.equal(c.status, 'Error');
    assert.ok(c.notice);
  });
}

test('fast AI response waits for recognizer release before playback', async () => {
  const { controller: c, sessions, calls, playback } = harness({ holdEnd: true });
  c.start();
  c.send('hello');
  calls[0].resolve('hi');
  await settle();
  assert.equal(playback.length, 0);
  sessions[0].end();
  await settle();
  assert.equal(playback.length, 1);
  playback[0].done('error');
  assert.equal(c.status, 'Listening');
});

test('missing onend times out safely and keeps recognizers serialized', async () => {
  const { controller: c, sessions, calls, playback, clock, journal } = harness({ holdEnd: true });
  c.start();
  c.send('hello');
  calls[0].resolve('hi');
  await settle();
  clock.tick(4000);
  await settle();
  assert.equal(journal.messages.length, 2);
  assert.equal(playback.length, 0);
  assert.equal(sessions.length, 1);
  assert.equal(c.status, 'Error');
});

test('Start after a missing Stop acknowledgement reports the blocked microphone', () => {
  const { controller: c, sessions, clock } = harness({ holdEnd: true });
  c.start();
  c.stop();
  clock.tick(4000);
  c.start();
  assert.equal(sessions.length, 1);
  assert.equal(c.status, 'Error');
  assert.match(c.notice, /did not release/);
});

test('muting playback cancels it, then a muted reply resumes listening', async () => {
  const { controller: c, settings, sessions, calls, playback } = harness();
  c.start();
  c.send('one');
  calls[0].resolve('first');
  await settle();
  settings.ttsEnabled = false;
  c.settingsChanged();
  assert.equal(c.status, 'Listening');
  c.send('two');
  calls[1].resolve('second');
  await settle();
  assert.equal(c.status, 'Listening');
  assert.equal(sessions.length, 3);
  assert.equal(playback.length, 1);
});

test('microphone mute gates callbacks and manual sends remain available', () => {
  const { controller: c, sessions, calls, clock } = harness();
  c.start();
  sessions[0].result('draft');
  c.toggleMic();
  sessions[0].result('echo');
  clock.tick(4000);
  assert.equal(c.status, 'Paused');
  assert.equal(calls.length, 0);
  c.send();
  assert.equal(calls[0].messages.at(-1).content, 'draft');
});

test('Stop during thinking aborts and ignores the old reply after a fresh Start', async () => {
  const { controller: c, calls, journal, playback } = harness();
  c.start();
  c.send('keep my question');
  c.stop();
  assert.equal(c.status, 'Tap to start');
  assert.equal(calls[0].signal.aborted, true);
  c.start();
  calls[0].resolve('stale');
  await settle();
  assert.equal(journal.messages.length, 1);
  assert.equal(playback.length, 0);
  c.dismiss();
  assert.equal(c.status, 'Listening');
});

test('Stop during reconnecting cancels scheduled attempts', () => {
  const { controller: c, clock, sessions } = harness();
  c.start();
  sessions[0].end();
  c.stop();
  clock.tick(30000);
  assert.equal(sessions.length, 1);
  assert.equal(c.status, 'Tap to start');
});

test('Stop during TTS cancels playback and stale callbacks cannot reopen recognition', async () => {
  const { controller: c, calls, playback, sessions } = harness();
  c.start();
  c.send('hello');
  calls[0].resolve('hi');
  await settle();
  c.stop();
  playback[0].done('end');
  assert.equal(c.status, 'Tap to start');
  assert.equal(sessions.length, 1);
});

test('API failure preserves the turn and retry uses updated credentials without duplicate journal rows', async () => {
  const { controller: c, journal, settings, calls } = harness();
  c.start();
  c.send('hello');
  calls[0].reject(new Error('Rate limited'));
  await settle();
  assert.equal(c.status, 'Error');
  settings.apply({ key: 'new-key', model: settings.model, seconds: 3, ttsEnabled: false });
  c.retry();
  c.retry();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].key, 'new-key');
  calls[1].resolve('hello again');
  await settle();
  assert.equal(journal.messages.length, 2);
  assert.equal(journal.messages[0].turnId, journal.messages[1].turnId);
  assert.equal(c.status, 'Listening');
});

test('unsupported speech keeps typed chat available', () => {
  const { controller: c, calls } = harness({ supported: false });
  c.start();
  assert.equal(c.notice, 'Unsupported');
  assert.equal(c.handsFreeEnabled, false);
  assert.equal(c.send('typed'), true);
  assert.equal(calls.length, 1);
});
