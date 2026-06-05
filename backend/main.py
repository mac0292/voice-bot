import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from session import create_session, get_session, clear_session, get_available_roles
from ws_handler import handle_websocket

load_dotenv()

app = FastAPI(title="Voice Bot API")

# Serve the web app (index.html + app.js + style.css)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ── REST endpoints ────────────────────────────────────────────────────

@app.get("/")
def root():
    """Serve the web app."""
    return FileResponse("static/index.html")


@app.get("/roles")
def list_roles():
    """Return available roles for the UI dropdown."""
    return get_available_roles()


@app.post("/session")
def start_session(role: str = "teacher"):
    """Create a new session and return session_id."""
    session_id = create_session(role)
    return {"session_id": session_id, "role": role}


@app.delete("/session/{session_id}")
def end_session(session_id: str):
    """Clean up session when call ends."""
    clear_session(session_id)
    return {"status": "closed"}


@app.get("/health")
def health():
    """Quick check that server is running."""
    return {"status": "ok"}


# ── WebSocket endpoint ────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    Main real-time audio channel.
    Browser sends audio bytes → server returns MP3 bytes.
    """
    session = get_session(session_id)
    if not session:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    try:
        await handle_websocket(websocket, session_id)
    except WebSocketDisconnect:
        clear_session(session_id)


# ── Run ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)