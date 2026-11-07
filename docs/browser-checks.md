# Manual browser checks

Start the Node server on loopback and open the URL it prints. Use a microphone and an OpenAI API key with access to a model offered in Settings. Use headphones if you want to isolate the microphone from room audio.

| Check | Expected result |
| --- | --- |
| Click Start once and wait in silence | Status becomes Listening. Silence without speech creates no messages. |
| Leave the microphone enabled through several browser idle timeouts, then speak | Each `no-speech` timeout briefly shows Reconnecting. The microphone resumes without using up its failure retries, and the next turn can send. |
| Speak, pause briefly, then continue before three seconds | Interim text changes in place. The app sends one combined turn after a full pause. |
| Speak and click Send now | The visible utterance sends immediately and appears once in the journal. |
| Wait for the reply and speak again after playback | The answer appears as text and is spoken. Listening resumes without another click. No assistant speech appears as a user turn. |
| Toggle Read replies aloud during playback, then send another turn | Playback stops immediately. The next reply appears as text and the mic resumes. |
| Mute and unmute the microphone between replies | While muted, the app shows Paused and ignores speech. Unmuting resumes recognition. |
| Stop while listening, reconnecting, thinking or speaking | The app returns to Tap to start and audio does not reopen. A committed user message remains in history. |
| Clear the API key and send a typed message | The message is saved once and the app offers Retry reply. Apply a valid key, retry, and confirm the assistant reply appears below the original message. |
| Export both formats and refresh | Exports contain ordered timestamped turns. The transcript remains visible after refresh and Settings reports that no key is set. |
| Cancel Clear history, then confirm it | Cancelling preserves the transcript. Confirming clears saved history. |

## Troubleshooting

- If the microphone is blocked, allow microphone access for the app origin in the browser. On Windows, also check microphone access for desktop apps in system privacy settings. Then try Start again.
- If recognition is unavailable, open the loopback URL in Chrome and check the support message in the app footer. Typed chat is available on the same page.
- If the browser speech service cannot connect, try opening the loopback URL directly in desktop Chrome. In **Settings**, choose **Enable on-device speech (English US)** if available. Wait for the language pack to finish loading, then close Settings and select **Retry microphone**. If a recognition session is already active, the mode changes the next time recognition starts.
- Open **Debug panel** to see the last recognition error and retry counter. **Retry microphone** restarts an exhausted session while preserving the draft. If the browser fails to release the old recognizer, reload.
- If you get a reply on screen without playback, check **Read replies aloud**, site audio and system volume. Click the toggle to give the page a fresh user interaction and try another turn.
- If a request fails with an access or quota error, check the model and key in Settings and the key's API project access, then use **Retry reply**.
- Export the transcript if the app reports a browser-storage error.
