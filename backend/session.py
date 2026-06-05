import uuid
import yaml
from pathlib import Path

# Load roles from yaml once at startup
ROLES_PATH = Path(__file__).parent / "roles.yaml"
with open(ROLES_PATH, "r") as f:
    ROLES = yaml.safe_load(f)

# In-memory session store — keyed by session_id
# Each session = { role, history, active }
_sessions: dict = {}


def create_session(role_key: str = "teacher") -> str:
    """Create a new session and return its ID."""
    if role_key not in ROLES:
        role_key = "teacher"

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "role_key":  role_key,
        "role_name": ROLES[role_key]["name"],
        "prompt":    ROLES[role_key]["prompt"],
        "history":   [],   # list of {role, content} dicts
        "active":    True  # is bot currently speaking?
    }
    return session_id


def get_session(session_id: str) -> dict | None:
    """Return session dict or None if not found."""
    return _sessions.get(session_id)


def add_message(session_id: str, role: str, content: str):
    """Append a message to conversation history."""
    session = _sessions.get(session_id)
    if session:
        session["history"].append({"role": role, "content": content})


def get_messages(session_id: str) -> list:
    """Return full message history formatted for OpenAI."""
    session = _sessions.get(session_id)
    if not session:
        return []

    # Always prepend system prompt so GPT-4o has role context
    return [
        {"role": "system", "content": session["prompt"]}
    ] + session["history"]


def set_active(session_id: str, active: bool):
    """Track whether bot is currently speaking (to suppress mic)."""
    session = _sessions.get(session_id)
    if session:
        session["active"] = active


def clear_session(session_id: str):
    """Delete session when call ends."""
    _sessions.pop(session_id, None)


def get_available_roles() -> list:
    """Return list of roles for the UI dropdown."""
    return [
        {"key": key, "name": val["name"], "description": val["description"]}
        for key, val in ROLES.items()
    ]