import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    Accepts raw audio bytes from the browser mic.
    Returns transcribed text string.
    """
    # Whisper needs a file-like object with a name so it knows the format
    import io
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = filename

    transcription = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file
    )

    return transcription.text.strip()