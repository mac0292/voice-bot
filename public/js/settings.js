import { DEFAULT_MODEL, MODELS } from './config.js';

export class Settings {
  #key = '';
  model = DEFAULT_MODEL;
  silenceMs = 3000;
  ttsEnabled = true;

  get key() { return this.#key; }

  apply({ key, model, seconds, ttsEnabled }) {
    if (!Object.hasOwn(MODELS, model)) throw new Error('Select a supported model.');
    const ms = Math.round(Number(seconds) * 1000);
    if (!Number.isFinite(ms) || ms < 1000 || ms > 10000) {
      throw new Error('Choose a pause between 1 and 10 seconds.');
    }
    const value = key.trim();
    if (value && !/^[!-~]{1,512}$/.test(value)) throw new Error('Enter a valid API key.');
    if (value) this.#key = value;
    this.model = model;
    this.silenceMs = ms;
    this.ttsEnabled = ttsEnabled;
  }

  clearKey() { this.#key = ''; }
}
