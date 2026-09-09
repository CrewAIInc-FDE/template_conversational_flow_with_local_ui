"""Tiny FastAPI proxy for the Research Assistant chat UI.

Holds the CrewAI AMP bearer token server-side and exposes same-origin /api/*
endpoints to the static frontend, so the token never reaches the browser and we
avoid CORS on the AMP domain.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

BASE_URL = (os.environ.get("CREWAI_DEPLOYMENT_URL") or "").rstrip("/")
DEPLOYMENT_KEY = os.environ.get("CREWAI_DEPLOYMENT_KEY") or ""

if not BASE_URL or not DEPLOYMENT_KEY:
    raise RuntimeError(
        "CREWAI_DEPLOYMENT_URL and CREWAI_DEPLOYMENT_KEY must be set in .env"
    )

HEADERS = {
    "Authorization": f"Bearer {DEPLOYMENT_KEY}",
    "Content-Type": "application/json",
}

STATIC_DIR = Path(__file__).parent / "static"
POLL_INTERVAL_SECONDS = 1.0
POLL_TIMEOUT_SECONDS = 120

app = FastAPI(title="Research Assistant Chat UI")


class SendBody(BaseModel):
    session_id: str
    message: str


def _amp_error(resp: httpx.Response) -> HTTPException:
    """Map an upstream AMP error into an HTTPException with a readable detail."""
    detail: str
    try:
        detail = str(resp.json())
    except Exception:
        detail = resp.text or f"Upstream error {resp.status_code}"
    return HTTPException(status_code=resp.status_code, detail=detail)


@app.post("/api/start")
def start() -> dict:
    """Create a new chat session on the AMP deployment."""
    try:
        resp = httpx.post(
            f"{BASE_URL}/chat/start", headers=HEADERS, json={}, timeout=30
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach AMP: {exc}")
    if resp.status_code >= 400:
        raise _amp_error(resp)
    return {"session_id": resp.json()["session_id"]}


@app.post("/api/send")
def send(body: SendBody) -> dict:
    """Queue one user turn, wait for it to finish, and return the transcript."""
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    try:
        msg_resp = httpx.post(
            f"{BASE_URL}/chat/{body.session_id}/message",
            headers=HEADERS,
            json={"message": body.message, "stream": False},
            timeout=30,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach AMP: {exc}")

    if msg_resp.status_code == 409:
        raise HTTPException(
            status_code=409, detail="A turn is still running - please wait a moment."
        )
    if msg_resp.status_code >= 400:
        raise _amp_error(msg_resp)

    deadline = time.time() + POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        try:
            hist = httpx.get(
                f"{BASE_URL}/chat/{body.session_id}/history",
                headers=HEADERS,
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach AMP: {exc}")
        if hist.status_code >= 400:
            raise _amp_error(hist)
        data = hist.json()
        if data.get("active_kickoff_id") is None:
            return {"messages": data.get("messages", [])}
        time.sleep(POLL_INTERVAL_SECONDS)

    raise HTTPException(status_code=504, detail="Timed out waiting for the assistant.")


@app.get("/api/history")
def history(session_id: str) -> dict:
    """Return the stored transcript for a session."""
    try:
        resp = httpx.get(
            f"{BASE_URL}/chat/{session_id}/history", headers=HEADERS, timeout=30
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach AMP: {exc}")
    if resp.status_code >= 400:
        raise _amp_error(resp)
    return resp.json()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
