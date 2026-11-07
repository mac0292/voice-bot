export function createTts(global = window) {
  return {
    supported: Boolean(global.speechSynthesis && global.SpeechSynthesisUtterance),
    play(text, onDone) {
      const synth = global.speechSynthesis;
      const utterance = new global.SpeechSynthesisUtterance(text);
      let finished = false;
      let timeout;
      function finish(reason, cancel = false) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        utterance.onend = utterance.onerror = null;
        try {
          if (cancel) synth.cancel();
        } catch {
          // The browser may already have torn down the speech engine.
        }
        onDone(reason);
      }
      // A browser or OS speech engine may fail without emitting a terminal event.
      timeout = setTimeout(() => finish('timeout', true), Math.max(15000, text.length * 150));
      utterance.onend = () => finish('end');
      utterance.onerror = () => finish('error');
      try {
        synth.speak(utterance);
      } catch {
        finish('error');
      }
      return () => finish('cancelled', true);
    },
  };
}
