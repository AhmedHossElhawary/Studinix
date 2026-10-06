import sqlite3
import os
import uuid
import hashlib
import secrets
from datetime import date, timedelta
from typing import Optional, Dict, Any, Tuple, List

APP_NAME = "Studinix"


def get_data_dir() -> str:
    return os.environ.get("STUDINIX_DATA_DIR") or os.path.join(
        os.getenv("APPDATA") or os.path.expanduser("~"),
        APP_NAME
    )


DB_PATH = os.path.join(get_data_dir(), "studinix.db")


def ensure_data_dir() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_connection() -> sqlite3.Connection:
    ensure_data_dir()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        bytes.fromhex(salt),
        100000
    ).hex()
    return key, salt

def verify_password(password: str, salt: str, password_hash: str) -> bool:
    key, _ = hash_password(password, salt)
    return secrets.compare_digest(key, password_hash)

def init_db():
    conn = get_connection()
    c = conn.cursor()

    # 1. Users table (Zero-state: points=0, streak_days=0, no fake data)
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        points INTEGER DEFAULT 0,
        streak_days INTEGER DEFAULT 0,
        last_active_date TEXT DEFAULT NULL,
        preferred_language TEXT DEFAULT 'en',
        created_at TEXT DEFAULT (DATETIME('now'))
    )
    """)

    # 2. Sessions table for persistent token auth
    c.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (DATETIME('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    # 3. Tasks Table (Daily, Weekly, Target)
    c.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL, -- 'daily', 'weekly', 'target'
        deadline TEXT,
        completed INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        last_reset_date TEXT DEFAULT (DATE('now')),
        points_awarded INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (DATETIME('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    # 4. Settings Table
    c.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    conn.commit()
    conn.close()

# ----------------- AUTHENTICATION ENGINE -----------------

def register_user(username: str, password: str, full_name: Optional[str] = None) -> Dict[str, Any]:
    username_clean = username.strip().lower()
    if not username_clean:
        raise ValueError("Username cannot be empty.")
    if len(password) < 4:
        raise ValueError("Password must be at least 4 characters long.")

    full_name_clean = full_name.strip() if full_name else username_clean.capitalize()

    conn = get_connection()
    c = conn.cursor()

    c.execute("SELECT id FROM users WHERE username = ?", (username_clean,))
    if c.fetchone():
        conn.close()
        raise ValueError("Username already taken. Please choose another.")

    user_id = str(uuid.uuid4())
    pw_hash, pw_salt = hash_password(password)

    # ZERO-STATE INITIALIZATION: 0 PTS, 0 Streak, NULL last_active_date, 0 tasks
    c.execute("""
    INSERT INTO users (id, username, full_name, password_hash, password_salt, points, streak_days, last_active_date)
    VALUES (?, ?, ?, ?, ?, 0, 0, NULL)
    """, (user_id, username_clean, full_name_clean, pw_hash, pw_salt))

    # Generate session token
    token = secrets.token_hex(32)
    c.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))

    conn.commit()
    conn.close()

    return {
        "user_id": user_id,
        "username": username_clean,
        "full_name": full_name_clean,
        "token": token,
        "points": 0,
        "streak_days": 0
    }

def authenticate_user(username: str, password: str) -> Dict[str, Any]:
    username_clean = username.strip().lower()
    conn = get_connection()
    c = conn.cursor()

    c.execute("SELECT * FROM users WHERE username = ?", (username_clean,))
    user = c.fetchone()
    if not user:
        conn.close()
        raise ValueError("Invalid username or password.")

    if not verify_password(password, user["password_salt"], user["password_hash"]):
        conn.close()
        raise ValueError("Invalid username or password.")

    token = secrets.token_hex(32)
    c.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"]))
    conn.commit()
    conn.close()

    return {
        "user_id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "token": token,
        "points": user["points"],
        "streak_days": user["streak_days"]
    }

def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
    SELECT u.id, u.username, u.full_name, u.points, u.streak_days, u.preferred_language, s.token
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
    """, (token,))
    row = c.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def logout_user(token: str) -> bool:
    if not token:
        return True
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()
    return True

# ----------------- USER & GAMIFIED POINTS ENGINE -----------------

def get_user_stats(user_id: str) -> Dict[str, Any]:
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        return {
            "user_id": user_id,
            "username": "guest",
            "full_name": "Guest User",
            "points": 0,
            "streak_days": 0,
            "daily_done": 0,
            "daily_total": 0
        }

    user = dict(row)

    # Count daily tasks completed for this specific user
    c.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND category = 'daily' AND completed = 1", (user_id,))
    daily_done = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND category = 'daily'", (user_id,))
    daily_total = c.fetchone()[0]

    conn.close()
    return {
        "user_id": user["id"],
        "username": user.get("username", ""),
        "full_name": user.get("full_name", ""),
        "points": user.get("points", 0),
        "streak_days": user.get("streak_days", 0),
        "daily_done": daily_done,
        "daily_total": daily_total
    }

def update_user_points(user_id: str, delta: int) -> Dict[str, Any]:
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT points, streak_days, last_active_date FROM users WHERE id = ?", (user_id,))
    row = c.fetchone()
    if row:
        new_points = max(0, row["points"] + delta)
        today = date.today().isoformat()
        current_streak = row["streak_days"] or 0
        last_date = row["last_active_date"]

        if delta > 0:
            if current_streak == 0:
                current_streak = 1
            elif last_date != today:
                current_streak += 1

        c.execute("""
        UPDATE users
        SET points = ?, streak_days = ?, last_active_date = ?
        WHERE id = ?
        """, (new_points, current_streak, today, user_id))
        conn.commit()
    conn.close()
    return get_user_stats(user_id)

# ----------------- AUTO-RENEWING TASK ENGINE -----------------

def get_tasks(user_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    c = conn.cursor()
    today_str = date.today().isoformat()

    # 1. AUTO-RENEW DAILY TASKS for this specific user
    c.execute("""
    UPDATE tasks
    SET completed = 0, last_reset_date = ?
    WHERE user_id = ? AND category = 'daily' AND last_reset_date != ?
    """, (today_str, user_id, today_str))
    conn.commit()

    # 2. Return tasks grouped
    c.execute("""
    SELECT * FROM tasks
    WHERE user_id = ?
    ORDER BY
        CASE category
            WHEN 'daily' THEN 1
            WHEN 'weekly' THEN 2
            WHEN 'target' THEN 3
            ELSE 4
        END,
        created_at ASC
    """, (user_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def create_task(user_id: str, title: str, category: str, deadline: Optional[str] = None) -> str:
    task_id = str(uuid.uuid4())
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
    INSERT INTO tasks (id, user_id, title, category, deadline, completed, last_reset_date)
    VALUES (?, ?, ?, ?, ?, 0, DATE('now'))
    """, (task_id, user_id, title.strip(), category, deadline))
    conn.commit()
    conn.close()
    return task_id

def toggle_task(task_id: str) -> Tuple[Optional[int], int, Dict[str, Any]]:
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    task = c.fetchone()
    if not task:
        conn.close()
        return None, 0, {}

    cur_completed = task["completed"]
    new_completed = 0 if cur_completed == 1 else 1
    category = task["category"]
    user_id = task["user_id"]

    # Points rules: +10 pts for Daily, +25 pts for Weekly/Target
    pts_value = 10 if category == "daily" else 25
    delta = pts_value if new_completed == 1 else -pts_value

    new_comp_count = task["completed_count"] + (1 if new_completed == 1 else 0)

    c.execute("""
    UPDATE tasks
    SET completed = ?, completed_count = ?
    WHERE id = ?
    """, (new_completed, new_comp_count, task_id))
    conn.commit()
    conn.close()

    # Update points & streak
    stats = update_user_points(user_id, delta)
    return new_completed, delta, stats

def delete_task(task_id: str) -> bool:
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return True
