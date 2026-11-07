# Voice AI Chat

A local, voice-first browser chat that sends your turn after three seconds of silence, reads the reply aloud, and saves both sides of the conversation. Typed chat works independently of speech recognition.

## Run locally

Install Node.js 22 or newer, then run these commands in the project folder.

```sh
npm install
npm start
```

1. Open [the local app](http://127.0.0.1:3000) in desktop Chrome. Other browsers may expose speech recognition but lack a working speech service. The footer reports detected support.
2. Open **Settings**, enter an OpenAI API key, choose a model, and select **Apply / Update**.
3. Select **Start listening** once and grant microphone access when prompted. Speak, then wait three seconds or select **Send now**. The app shows and reads the answer, then resumes listening.
4. Select **Stop listening** to end hands-free mode. Use **Export Markdown** or **Export JSON** to save a copy of the transcript.

You can type a message at any time between replies. Enter sends and Shift+Enter inserts a newline. When the text box contains a message, **Send now** sends that text in place of the live voice draft. **Mute microphone** holds voice input while keeping hands-free mode enabled. **Read replies aloud** toggles playback, and **Skip playback** cancels the current reading.

The Node server binds to loopback. Set `PORT` to change the default port. Voice features require a secure browser context, which includes the local loopback URL.

## Data and credentials

- The API key stays in tab memory. Refreshing loses it. To replace it, enter a new value and apply. **Clear key** removes the value for future requests.
- The local server receives the key in the Authorization header and can access it. It forwards the key to OpenAI over HTTPS and keeps no key store. The app requests `store: false` from the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text).
- The browser speech service may process microphone audio remotely. The Node app receives message text. Its chat request includes up to 20 recent transcript entries.
- The journal uses localStorage for this browser profile and origin. JSON preserves identifiers, roles, timestamps and turn links. Markdown formats the same messages for reading. Clear history requires confirmation.

## Tests and troubleshooting

Run `npm test`. The suite uses a fake clock, mocked browser speech events, and a mocked OpenAI upstream over the local HTTP route. See [manual browser checks and troubleshooting](docs/browser-checks.md) for microphone and speech playback verification.

This version uses the [Web Speech API](https://webaudio.github.io/web-speech-api/) fallback. The app restarts recognition after idle timeouts. If the browser's online speech service cannot connect, **Settings → Enable on-device speech (English US)** is available in browsers that support language packs. See [architecture](docs/architecture.md) for the session lifecycle and the requirements for a streaming adapter.

## Maintaining the documentation

Update the README, architecture notes, and affected manual checks in the same change as user-facing behavior, model settings, storage, or session lifecycle changes. Use the [pull request checklist](.github/pull_request_template.md) when submitting changes.

The GitHub repository also contains an earlier Python backend and browser extension in `backend/` and `extension/`. The Node app runs independently from those directories.
