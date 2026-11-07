export function createWebSpeech(global = window) {
  const Recognition = global.SpeechRecognition ?? global.webkitSpeechRecognition;
  return {
    supported: Boolean(Recognition && global.isSecureContext),
    reason: !global.isSecureContext ? 'Open this app on localhost or HTTPS.' :
      'Speech recognition is unavailable in this browser. You can still type.',
    open(events) {
      const engine = new Recognition();
      engine.continuous = true;
      engine.interimResults = true;
      engine.lang = global.navigator.language;
      engine.onstart = events.start;
      engine.onaudiostart = () => events.capture('active');
      engine.onaudioend = () => events.capture('stopped');
      engine.onspeechstart = () => events.speech(true);
      engine.onspeechend = () => events.speech(false);
      engine.onerror = event => events.error(event.error);
      engine.onend = events.end;
      engine.onresult = event => {
        // Web Speech supplies a cumulative snapshot. Interim entries can change or disappear.
        const pieces = Array.from(event.results, result => result[0].transcript.trim());
        events.result(pieces.filter(Boolean).join(' '));
      };
      return { start: () => engine.start(), abort: () => engine.abort() };
    },
  };
}
