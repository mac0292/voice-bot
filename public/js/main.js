import { requestReply } from './api.js';
import { MODELS } from './config.js';
import { SessionController } from './controller.js';
import { Settings } from './settings.js';
import { Transcript } from './transcript.js';
import { createTts } from './tts.js';
import { byId, createUi, downloadJournal } from './ui.js';
import { createWebSpeech } from './web-speech-stt.js';

const settings = new Settings();
let storage;
try { storage = window.localStorage; } catch { /* journal reports unavailable storage */ }
const journal = new Transcript(storage);
const stt = createWebSpeech();
const tts = createTts();
const render = createUi({ journal, settings, stt, tts });
const controller = new SessionController({ stt, tts, api: requestReply, journal, settings, render });

const on = (id, listener) => byId(id).addEventListener('click', listener);
on('start', () => {
  if (controller.handsFreeEnabled || controller.busy) controller.stop();
  else controller.start();
});
on('mic', () => controller.toggleMic());
on('retry', () => controller.retry());
on('dismiss', () => controller.dismiss());
on('skip', () => controller.skipPlayback());
on('tts', () => {
  settings.ttsEnabled = !settings.ttsEnabled;
  controller.settingsChanged();
});

const compose = byId('compose');
const typed = byId('message');
compose.addEventListener('submit', event => {
  event.preventDefault();
  if (controller.send(typed.value)) typed.value = '';
  render(controller);
});
typed.addEventListener('input', () => render(controller));
typed.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    compose.requestSubmit();
  }
});
on('markdown', () => downloadJournal(journal, 'markdown'));
on('json', () => downloadJournal(journal, 'json'));
on('clear-history', () => {
  if (!window.confirm('Clear the saved transcript in this browser?')) return;
  journal.clear();
  controller.dismiss();
  render(controller);
});

const debug = byId('debug');
let debugInterval;
debug.addEventListener('toggle', () => {
  clearInterval(debugInterval);
  if (debug.open) {
    render(controller);
    debugInterval = setInterval(() => {
      byId('diagnostics').textContent = JSON.stringify(controller.diagnostics, null, 2);
    }, 250);
  }
});

const dialog = byId('settings');
const keyInput = byId('api-key');
const model = byId('model');
const silence = byId('silence');
const settingsTts = byId('settings-tts');
const error = byId('settings-error');
for (const [value, label] of Object.entries(MODELS)) model.add(new Option(label, value));

function showKeyStatus() {
  byId('key-status').textContent = settings.key ? 'Key set for this tab' : 'No key set';
}

on('open-settings', () => {
  showKeyStatus();
  model.value = settings.model;
  silence.value = settings.silenceMs / 1000;
  settingsTts.checked = settings.ttsEnabled;
  settingsTts.disabled = !tts.supported;
  error.hidden = true;
  dialog.showModal();
});
on('close-settings', () => dialog.close());
dialog.addEventListener('close', () => { keyInput.value = ''; });
on('clear-key', () => {
  keyInput.value = '';
  settings.clearKey();
  showKeyStatus();
});
byId('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    settings.apply({ key: keyInput.value, model: model.value,
      seconds: silence.value, ttsEnabled: settingsTts.checked });
    keyInput.value = '';
    controller.settingsChanged();
    dialog.close();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  }
});
window.addEventListener('pagehide', () => {
  controller.stop();
  settings.clearKey();
});
