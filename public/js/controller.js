import { MAX_MESSAGE } from './config.js';

const fatalErrors = {
  'not-allowed': 'Microphone access was denied. Allow it in browser and OS settings, then try again.',
  'service-not-allowed': 'The browser blocked its speech service. Check browser settings or type instead.',
  'audio-capture': 'No microphone is available. Connect or enable one, then try again.',
  'language-not-supported': 'The speech service does not support your browser language. You can still type.',
};
const maxRetries = 5;

export class SessionController {
  constructor({ stt, tts, api, journal, settings, render = () => {}, clock = globalThis,
    now = Date.now }) {
    Object.assign(this, { stt, tts, api, journal, settings, render, clock, now });
    this.handsFreeEnabled = false;
    this.sessionGeneration = 0;
    this.captureState = 'idle';
    this.sttState = 'idle';
    this.assistantState = 'idle';
    this.micMuted = false;
    this.retryCount = 0;
    this.prefix = '';
    this.segment = '';
    this.speaking = false;
    this.trace = [];
    this.notice = '';
    this.changed();
  }

  get draft() { return [this.prefix, this.segment].filter(Boolean).join(' ').slice(0, MAX_MESSAGE); }

  get turnState() {
    if (this.pending) return 'committed';
    if (this.silenceDeadline !== undefined) return 'silence_pending';
    return this.draft || this.speaking ? 'composing' : 'empty';
  }

  get status() {
    if (this.assistantState === 'thinking') return 'Thinking';
    if (this.assistantState === 'speaking') return 'Speaking';
    if (this.assistantState === 'error' || this.captureState === 'error') return 'Error';
    if (!this.handsFreeEnabled) return 'Tap to start';
    if (this.micMuted || this.pending) return 'Paused';
    if (this.sttState === 'error') return 'Error';
    if (this.sttState === 'reconnecting' || this.sttState === 'stopping') return 'Reconnecting';
    if (this.sttState === 'starting') return 'Requesting microphone';
    if (this.speaking) return 'Speech detected';
    if (this.silenceDeadline !== undefined) return 'Waiting for pause';
    return 'Listening';
  }

  get busy() { return ['thinking', 'speaking'].includes(this.assistantState); }

  changed(event) {
    if (event) {
      this.trace.push({ at: new Date(this.now()).toISOString(), event });
      if (this.trace.length > 40) this.trace.shift();
    }
    this.render(this);
  }

  get diagnostics() {
    return {
      handsFreeEnabled: this.handsFreeEnabled, sessionGeneration: this.sessionGeneration,
      captureState: this.captureState, sttState: this.sttState,
      turnState: this.turnState, assistantState: this.assistantState,
      lastSpeechEvent: this.lastSpeechEvent ?? null, lastSttError: this.lastSttError ?? null,
      lastSttEnd: this.lastSttEnd ?? null, lastMicState: this.lastMicState ?? null,
      silenceCountdownMs: Math.max(0, (this.silenceDeadline ?? 0) - this.now()),
      retryCount: this.retryCount, lastAiError: this.lastAiError ?? null, trace: this.trace,
    };
  }

  start() {
    if (this.handsFreeEnabled || this.busy) return;
    if (!this.stt.supported) {
      this.notice = this.stt.reason;
      this.changed();
      return;
    }
    this.sessionGeneration++;
    this.handsFreeEnabled = true;
    this.micMuted = false;
    this.retryCount = 0;
    this.captureState = 'idle';
    this.notice = '';
    this.sttState = this.session ? 'stopping' : 'idle';
    if (this.session?.waiters === null) {
      this.sttState = 'error';
      this.notice = 'The browser did not release the microphone. Reload to restore voice input.';
    }
    this.reconcile();
    this.changed('Start');
  }

  stop() {
    this.sessionGeneration++;
    this.handsFreeEnabled = false;
    this.micMuted = false;
    this.captureState = 'stopped';
    this.assistantState = 'idle';
    this.retryCount = 0;
    this.notice = '';
    this.clearDraft();
    this.clearRetry();
    const request = this.request;
    this.request = null;
    request?.abort();
    const cancel = this.cancelTts;
    this.cancelTts = null;
    cancel?.();
    this.pauseRecognition();
    this.changed('Stop');
  }

  toggleMic() {
    if (!this.handsFreeEnabled) return;
    this.micMuted = !this.micMuted;
    if (this.micMuted) {
      this.preserveSegment();
      this.cancelSilence();
      this.pauseRecognition();
    } else {
      this.lastActivityAt = this.now();
      this.reconcile();
      this.armSilence();
    }
    this.changed(this.micMuted ? 'Microphone muted' : 'Microphone unmuted');
  }

  settingsChanged() {
    if (!this.settings.ttsEnabled) this.skipPlayback();
    this.armSilence();
    this.changed();
  }

  get wantsRecognition() {
    return this.handsFreeEnabled && !this.micMuted && !this.busy && !this.pending &&
      this.sttState !== 'error';
  }

  reconcile() {
    if (!this.wantsRecognition || this.session || this.retryTimer !== undefined) return;
    const session = { generation: this.sessionGeneration, stopping: false, error: '' };
    this.session = session;
    this.captureState = 'requesting';
    this.sttState = 'starting';
    const current = () => this.session === session &&
      session.generation === this.sessionGeneration && !session.stopping;
    try {
      session.engine = this.stt.open({
        start: () => {
          if (!current()) return;
          this.clock.clearTimeout(session.startDeadline);
          this.sttState = 'listening';
          this.captureState = 'active';
          if (this.retryCount) {
            session.stable = this.clock.setTimeout(() => { this.retryCount = 0; this.changed(); }, 15000);
          }
          this.changed('Recognition started');
        },
        capture: state => {
          if (!current()) return;
          this.captureState = state;
          this.lastMicState = state;
          this.changed('Microphone ' + state);
        },
        speech: active => {
          if (!current() || !this.wantsRecognition) return;
          this.speaking = active;
          this.lastActivityAt = this.now();
          this.lastSpeechEvent = new Date(this.now()).toISOString();
          this.armSilence();
          this.changed(active ? 'Speech started' : 'Speech ended');
        },
        result: snapshot => {
          if (!current() || !this.wantsRecognition) return;
          this.segment = snapshot;
          if (snapshot) {
            this.lastActivityAt = this.now();
            this.lastSpeechEvent = new Date(this.now()).toISOString();
            this.retryCount = 0;
          }
          this.armSilence();
          this.changed('Recognition result');
        },
        error: code => {
          if (!current()) return;
          session.error = code;
          this.lastSttError = code;
          this.changed('Recognition error: ' + code);
          if (Object.hasOwn(fatalErrors, code)) this.failMicrophone(fatalErrors[code]);
        },
        end: () => this.recognitionEnded(session),
      });
      session.engine.start();
      if (current() && this.sttState === 'starting') {
        session.startDeadline = this.clock.setTimeout(() => {
          if (!current() || this.sttState !== 'starting') return;
          this.failMicrophone('The browser speech service did not start. Check permissions and try again.');
        }, 30000);
      }
    } catch {
      session.error = 'start-failed';
      this.lastSttError = session.error;
      this.recognitionEnded(session);
    }
    this.changed();
  }

  recognitionEnded(session) {
    if (this.session !== session) return;
    this.clock.clearTimeout(session.stable);
    this.clock.clearTimeout(session.startDeadline);
    this.clock.clearTimeout(session.stopDeadline);
    this.session = null;
    this.lastSttEnd = session.stopping ? 'requested stop' : session.error || 'browser ended';
    this.lastMicState = 'stopped';
    if (this.captureState !== 'error') this.captureState = 'stopped';
    if (this.sttState !== 'error') this.sttState = 'ended';
    if (!session.stopping && session.generation === this.sessionGeneration) {
      const wasSpeaking = this.speaking;
      this.preserveSegment();
      if (wasSpeaking) this.lastActivityAt = this.now();
      if (wasSpeaking || this.silenceDeadline === undefined) this.armSilence();
      if (this.wantsRecognition) this.scheduleRetry();
    } else {
      this.reconcile();
    }
    this.changed('Recognition ended');
    for (const resolve of session.waiters ?? []) resolve(true);
  }

  scheduleRetry() {
    if (this.retryCount >= maxRetries) {
      this.cancelSilence();
      this.sttState = 'error';
      this.captureState = 'interrupted';
      this.notice = 'Speech recognition kept disconnecting. Stop, then start again, or type a message.';
      return;
    }
    this.captureState = 'interrupted';
    this.sttState = 'reconnecting';
    const generation = this.sessionGeneration;
    const delay = Math.min(4000, 250 * 2 ** this.retryCount++);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      if (generation === this.sessionGeneration) this.reconcile();
    }, delay);
  }

  clearRetry() {
    this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  failMicrophone(message) {
    this.handsFreeEnabled = false;
    this.captureState = 'error';
    this.sttState = 'error';
    this.notice = message;
    this.clearDraft();
    this.pauseRecognition();
    this.changed('Microphone blocked');
  }

  pauseRecognition() {
    this.clearRetry();
    const session = this.session;
    if (!session || session.stopping) return;
    session.stopping = true;
    this.clock.clearTimeout(session.stable);
    this.clock.clearTimeout(session.startDeadline);
    if (this.sttState !== 'error') this.sttState = 'stopping';
    session.stopDeadline = this.clock.setTimeout(() => {
      if (this.session !== session) return;
      for (const resolve of session.waiters ?? []) resolve(false);
      session.waiters = null;
      if (this.handsFreeEnabled) {
        this.sttState = 'error';
        this.notice = 'The browser did not release the microphone. Reload to restore voice input.';
        this.changed('Recognition stop timed out');
      }
    }, 4000);
    try {
      session.engine?.abort();
    } catch {
      // Keep ownership until the browser confirms the session has ended.
    }
  }

  preserveSegment() {
    this.prefix = this.draft;
    this.segment = '';
    this.speaking = false;
  }

  cancelSilence() {
    this.clock.clearTimeout(this.silenceTimer);
    this.silenceTimer = this.silenceDeadline = undefined;
  }

  clearDraft() {
    this.cancelSilence();
    this.prefix = this.segment = '';
    this.speaking = false;
    this.lastActivityAt = undefined;
  }

  armSilence() {
    this.cancelSilence();
    if (!this.wantsRecognition || this.speaking || !this.draft.trim()) return;
    const generation = this.sessionGeneration;
    this.silenceDeadline = (this.lastActivityAt ?? this.now()) + this.settings.silenceMs;
    this.silenceTimer = this.clock.setTimeout(() => {
      this.cancelSilence();
      if (generation === this.sessionGeneration && this.wantsRecognition) this.send();
    }, Math.max(0, this.silenceDeadline - this.now()));
  }

  send(typed = '') {
    if (this.busy || this.pending) return false;
    const text = (typed.trim() || this.draft.trim()).slice(0, MAX_MESSAGE);
    if (!text) return false;
    const turnId = crypto.randomUUID();
    this.clearDraft();
    this.journal.append('user', text, turnId);
    this.pending = { turnId, messages: this.journal.context() };
    void this.reply();
    return true;
  }

  retry() {
    if (this.pending && !this.busy) void this.reply();
  }

  dismiss() {
    if (!this.pending || this.busy) return;
    this.pending = null;
    this.assistantState = 'idle';
    this.notice = '';
    this.reconcile();
    this.changed('Pending reply dismissed');
  }

  async reply() {
    const generation = this.sessionGeneration;
    const turn = this.pending;
    const request = new AbortController();
    this.request = request;
    this.assistantState = 'thinking';
    this.notice = '';
    this.pauseRecognition();
    // Playback must wait for terminal acknowledgement even if the AI replies immediately.
    const session = this.session;
    const released = session
      ? new Promise(resolve => {
        if (session.waiters === null) resolve(false);
        else (session.waiters ??= []).push(resolve);
      })
      : Promise.resolve(true);
    this.changed('Turn sent');
    const current = () => generation === this.sessionGeneration && this.request === request;
    try {
      const { key, model } = this.settings;
      if (!key) throw new Error('Add an OpenAI API key in Settings, then retry this turn.');
      const text = await this.api({ messages: turn.messages, key, model, signal: request.signal });
      if (!current()) return;
      this.journal.append('assistant', text, turn.turnId);
      this.pending = null;
      if (this.settings.ttsEnabled && this.tts.supported) {
        const safe = await released;
        if (!current()) return;
        if (safe && this.settings.ttsEnabled) {
          this.play(text, generation);
          return;
        }
        if (!safe) this.notice ||= 'Reply shown as text because the browser did not release the microphone.';
      }
      this.finishReply();
    } catch (error) {
      if (!current()) return;
      this.request = null;
      this.assistantState = 'error';
      this.notice = this.lastAiError = error.message;
      this.changed('AI request failed');
    }
  }

  play(text, generation) {
    const request = this.request;
    this.assistantState = 'speaking';
    this.changed('Playback started');
    const done = reason => {
      if (generation !== this.sessionGeneration || request !== this.request ||
          this.assistantState !== 'speaking') return;
      if (reason === 'error' || reason === 'timeout') this.notice = 'Speech playback was unavailable.';
      this.finishReply();
    };
    try {
      const cancel = this.tts.play(text, done);
      if (this.assistantState === 'speaking') this.cancelTts = cancel;
    } catch {
      done('error');
    }
  }

  skipPlayback() { this.cancelTts?.(); }

  finishReply() {
    this.request = this.cancelTts = null;
    this.assistantState = 'idle';
    this.reconcile();
    this.changed('Reply finished');
  }
}
