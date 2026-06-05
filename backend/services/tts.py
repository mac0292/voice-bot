import os
import requests
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")


def text_to_speech(text: str) -> bytes:
    """
    Accepts a text string.
    Returns MP3 audio as raw bytes to send back to the browser.
    """
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"

    headers = {
        "xi-api-key":   ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
    }

    payload = {
        "text":       text,
        "model_id":   "eleven_monolingual_v1",
        "voice_settings": {
            "stability":        0.5,
            "similarity_boost": 0.75
        }
    }

    response = requests.post(url, headers=headers, json=payload)

    if response.status_code != 200:
        raise Exception(f"ElevenLabs error {response.status_code}: {response.text}")

    return response.content  # raw MP3 bytes