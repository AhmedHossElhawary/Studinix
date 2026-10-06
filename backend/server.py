import os
import sys
import json
import time
import asyncio
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

APP_NAME = "Studinix"

if not os.environ.get("STUDINIX_DATA_DIR"):
    os.environ["STUDINIX_DATA_DIR"] = os.path.join(
        os.getenv("APPDATA") or os.path.expanduser("~"),
        APP_NAME
    )

os.makedirs(os.environ["STUDINIX_DATA_DIR"], exist_ok=True)

import database as db

# Initialize Database
db.init_db()

app = FastAPI(title="Studinix Focus & To-Do Engine", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# ----------------- REALTIME WEBSOCKET SYNC -----------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            self.disconnect(dc)

manager = ConnectionManager()

# ----------------- DATA MODELS -----------------

class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateTaskRequest(BaseModel):
    user_id: Optional[str] = None
    title: str
    category: str  # 'daily', 'weekly', 'target'
    deadline: Optional[str] = None

def get_current_user_from_auth(authorization: Optional[str] = None, token: Optional[str] = None) -> Optional[dict]:
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization.split("Bearer ")[1].strip()
    elif token:
        auth_token = token.strip()

    if auth_token:
        return db.get_user_by_token(auth_token)
    return None

# ----------------- HEALTH CHECK -----------------

@app.get("/health")
def health_check():
    """Simple liveness probe used by Electron to know the backend is ready."""
    return {"status": "ok"}

# ----------------- MULTI-USER AUTHENTICATION API -----------------

@app.post("/api/register")
@app.post("/api/auth/register")
def register(req: RegisterRequest):
    try:
        user = db.register_user(req.username, req.password, req.full_name)
        return {"status": "success", "user": user}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Registration failed: " + str(e))

@app.post("/api/login")
@app.post("/api/auth/login")
def login(req: LoginRequest):
    try:
        user = db.authenticate_user(req.username, req.password)
        return {"status": "success", "user": user}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Login failed: " + str(e))

@app.get("/api/me")
@app.get("/api/auth/me")
def get_current_profile(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)):
    user = get_current_user_from_auth(authorization, token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    stats = db.get_user_stats(user["id"])
    return {"status": "success", "user": stats}

@app.post("/api/logout")
@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)):
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization.split("Bearer ")[1].strip()
    elif token:
        auth_token = token.strip()
    if auth_token:
        db.logout_user(auth_token)
    return {"status": "success"}

# ----------------- TASKS & GAMIFIED POINTS API -----------------

@app.get("/api/tasks")
def list_tasks(
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
):
    target_user_id = user_id
    if not target_user_id:
        user = get_current_user_from_auth(authorization, token)
        if user:
            target_user_id = user["id"]

    if not target_user_id:
        return []
    return db.get_tasks(target_user_id)

@app.post("/api/tasks")
async def add_task(
    req: CreateTaskRequest,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Task title is required.")

    target_user_id = req.user_id
    if not target_user_id:
        user = get_current_user_from_auth(authorization, token)
        if user:
            target_user_id = user["id"]

    if not target_user_id:
        raise HTTPException(status_code=401, detail="User ID or Authentication required.")

    task_id = db.create_task(
        user_id=target_user_id,
        title=req.title,
        category=req.category,
        deadline=req.deadline
    )

    # Broadcast to all windows (Main App + Drop Note)
    await manager.broadcast({
        "type": "TASKS_UPDATED",
        "action": "create",
        "user_id": target_user_id,
        "task_id": task_id
    })
    return {"status": "success", "task_id": task_id}

@app.post("/api/tasks/{task_id}/toggle")
async def toggle_task(task_id: str):
    completed, delta, stats = db.toggle_task(task_id)
    if completed is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    # Broadcast real-time points & task completion to Main Window & Drop Note
    await manager.broadcast({
        "type": "TASK_TOGGLED",
        "task_id": task_id,
        "user_id": stats.get("user_id"),
        "completed": completed,
        "delta": delta,
        "stats": stats
    })
    return {
        "status": "success",
        "completed": completed,
        "delta": delta,
        "stats": stats
    }

@app.delete("/api/tasks/{task_id}")
async def remove_task(task_id: str):
    db.delete_task(task_id)
    await manager.broadcast({
        "type": "TASKS_UPDATED",
        "action": "delete",
        "task_id": task_id
    })
    return {"status": "success"}

@app.get("/api/stats")
def get_stats(
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
):
    target_user_id = user_id
    if not target_user_id:
        user = get_current_user_from_auth(authorization, token)
        if user:
            target_user_id = user["id"]

    if not target_user_id:
        return {
            "user_id": "",
            "username": "",
            "full_name": "",
            "points": 0,
            "streak_days": 0,
            "daily_done": 0,
            "daily_total": 0
        }
    return db.get_user_stats(target_user_id)

# ----------------- WEBSOCKET REAL-TIME SYNC -----------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                await manager.broadcast(parsed)
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# ----------------- STATIC ASSETS & HTML VIEWS -----------------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_main_app():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/dropnote")
def serve_dropnote():
    dn_path = os.path.join(STATIC_DIR, "dropnote.html")
    if os.path.exists(dn_path):
        return FileResponse(dn_path)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print(" Studinix Multi-User Engine Starting...")
    print(" Main Application Window : http://localhost:8000")
    print(" Desktop Drop Note       : http://localhost:8000/dropnote")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
