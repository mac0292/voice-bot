import json
from fastapi import WebSocket

from session import add_message, get_messages, set_active
from services.stt import transcribe_audio
from services.llm import get_response
from services.tts import text_to_speech


async def handle_websocket(websocket: WebSocket, session_id: str):
    """
    Handles the full real-time pipeline for one session.

    Message protocol (browser → server):
      - bytes  → raw audio chunk (mic recording)
      - text   → JSON control message e.g. {"type": "ping"}

    Message protocol (server → browser):
      - bytes  → MP3 audio (bot response)
      - text   → JSON status e.g. {"type": "transcript", "text": "..."}
                                   {"type": "status", "value": "thinking"}
                                   {"type": "error", "message": "..."}
    """

    await _send_status(websocket, "ready")

    while True:
        message = await websocket.receive()

        # ── Audio bytes received (mic recording) ──────────────────────
        if "bytes" in message:
            audio_bytes = message["bytes"]

            if not audio_bytes:
                continue

            try:
                # Step 1 — STT: audio → text
                await _send_status(websocket, "transcribing")
                user_text = transcribe_audio(audio_bytes)

                if not user_text:
                    await _send_status(websocket, "ready")
                    continue

                # Send transcript back so UI can display it
                await _send_json(websocket, {
                    "type": "transcript",
                    "role": "user",
                    "text": user_text
                })

                # Step 2 — LLM: text → response
                await _send_status(websocket, "thinking")
                add_message(session_id, "user", user_text)
                messages = get_messages(session_id)
                bot_text = get_response(messages)

                # Save bot reply to history
                add_message(session_id, "assistant", bot_text)

                # Send transcript of bot reply to UI
                await _send_json(websocket, {
                    "type": "transcript",
                    "role": "assistant",
                    "text": bot_text
                })

                # Step 3 — TTS: text → speech audio
                await _send_status(websocket, "speaking")
                set_active(session_id, True)
                audio_response = text_to_speech(bot_text)

                # Send MP3 bytes back to browser
                await websocket.send_bytes(audio_response)

                set_active(session_id, False)
                await _send_status(websocket, "ready")

            except Exception as e:
                await _send_json(websocket, {
                    "type":    "error",
                    "message": str(e)
                })
                await _send_status(websocket, "ready")

        # ── Text control message ───────────────────────────────────────
        elif "text" in message:
            try:
                data = json.loads(message["text"])
                if data.get("type") == "ping":
                    await _send_json(websocket, {"type": "pong"})
            except Exception:
                pass


# ── Helpers ───────────────────────────────────────────────────────────

async def _send_status(websocket: WebSocket, value: str):
    """Send a status update to the browser UI."""
    await _send_json(websocket, {"type": "status", "value": value})


async def _send_json(websocket: WebSocket, data: dict):
    """Send a JSON message to the browser."""
    await websocket.send_text(json.dumps(data))