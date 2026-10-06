# ⚡ Studinix

> **Minimalist To-Do, Gamified Points & Always-On-Top Desktop Drop Note**  
> Lightweight, high-focus productivity application combining auto-renewing daily tasks, weekly & milestone targets, gamified points rewards, multi-user authentication with zero-state clean initialization, and an unyielding **Always-On-Top Floating Drop Note** widget that stays visible above all full-screen games and apps.

---

## 🚀 One-Click PowerShell Launcher

Run this single command in PowerShell to clean, install, and launch everything automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_and_run.ps1
```

Or double-click `start.bat`.

---

## 📦 Standalone Windows Installer Setup

To compile the entire application into a native Windows Setup installer package (`.exe`):

```cmd
npm run build:win
```

* **Installer Artifact:** `dist/Studinix-Setup.exe` (~106 MB)
* **Installer Capabilities:**
  * Custom directory selection
  * Automatic Desktop icon creation
  * Automatic Start Menu shortcut generation
  * Direct launch upon setup completion

---

## 📑 Core Architecture

```
Studinix/
├── backend/
│   ├── server.py              # Lightweight FastAPI backend, Auth REST endpoints & WebSocket sync
│   ├── database.py            # SQLite schema, PBKDF2 password hashing & multi-tenant isolation
│   └── studinix.db            # Local database store in the OS user data directory
├── static/
│   ├── index.html             # Main Window (Task manager, stopwatch, profile & Auth modal)
│   ├── dropnote.html          # Floating Desktop Drop Note Widget (Daily tasks only)
│   └── js/
│       ├── app.js             # Main window logic, persistent localStorage session & stopwatch
│       └── dropnote.js        # Drop Note widget logic, instant check-off & collapse IPC
├── electron/
│   ├── main.js                # Dual-Window manager (Main Window + Screen-Saver Priority Drop Note)
│   └── preload.js             # Secure IPC bridge for window controls, user session sync
├── dist/
│   └── Studinix-Setup.exe     # Standalone native Windows NSIS Setup Installer
├── electron-builder.yml       # Production installer packaging configuration
├── setup_and_run.ps1          # One-click automated setup & launcher
├── start.bat                  # Windows batch launcher
├── test_suite.py              # Multi-user & zero-state automated test suite (100% passing)
├── package.json               # Electron configuration & build scripts
└── requirements.txt           # Minimalist Python dependencies (FastAPI, uvicorn, pydantic)
```

---

## 💎 Features & Gamification Engine

### 1. Multi-User Authentication & Zero-State Clean Slate
* **User Account System:** Simple signup & login with **Username** and **Password** (salted PBKDF2 HMAC-SHA256 with 100,000 rounds).
* **Multi-Tenant Data Isolation:** Each user's tasks, points, and streak days are strictly isolated. No data leaks between accounts.
* **Zero-State Guarantee:** New accounts start with **0 PTS**, **0 Days Streak**, and an empty task list. No dummy/fake data.
* **Persistent Session & Logout:** Session tokens are stored in `localStorage` for auto-login on re-launch. A visible **Logout / Switch Account** button is available in the top navigation.

### 2. Main Application Window
* **Auto-Renewing Daily Tasks:** Daily tasks reset automatically every calendar day while recording historical completions.
* **Weekly & Target Tasks:** Milestone tasks with custom deadlines for big projects and weekly commitments.
* **Gamified Points System:**
  * **+10 PTS** for every Daily Task completed.
  * **+25 PTS** for every Weekly or Target Task completed.
  * Dynamic streak tracker (`🔥 Streak Days`) awarded for daily consistency.
* **Simple Focus Stopwatch:** Clean start/pause/reset stopwatch for deep work sessions — free of forced OS process locks.

### 3. Floating Desktop "Drop Note" (Sticky Note)
* **Dedicated Daily Widget:** Compact floating sticky note strictly displaying **Daily Tasks** and current points.
* **Strict Always-On-Top Enforcement:**
  * Configured with Electron `alwaysOnTop` at the highest priority level (`screen-saver` / `pop-up-menu`).
  * Stays visible **above ALL desktops, full-screen apps, and games without exception**.
* **Resizable & Collapsible:**
  * Resize freely to any convenient size.
  * Click the collapse icon (`-`) to shrink the widget into a tiny, unobtrusive desktop chip showing points and remaining tasks.
* **Interactive & Real-Time Sync:**
  * Check off tasks directly from the Drop Note with immediate `+10 PTS` reward.
  * Instant bidirectional synchronization between the Main App and the Drop Note via WebSockets & Electron IPC.

---

## 🧪 Verification & Test Suite

Verify multi-user authentication, PBKDF2 password security, zero-state stats, and tenant isolation:

```powershell
python test_suite.py
```

Output:
```
=================================================================
   STUDINIX MULTI-USER & ZERO-STATE TEST SUITE
=================================================================
>>> 1. Initializing Studinix Database...
>>> 2. Testing User Registration & Zero-State Clean Slate...
    [OK] User Alice registered: 0 PTS, 0 Streak days, 0 seeded tasks.
>>> 3. Testing Authentication & PBKDF2 Password Verification...
    [OK] Invalid password correctly rejected.
    [OK] Authentication successful; session token validated.
>>> 4. Testing Multi-Tenant Data Isolation...
    [OK] Data isolation verified: Alice has 2 tasks, Bob has 0 tasks.
>>> 5. Testing Gamified Points & Streak Progression...
    [OK] Alice earned 35 PTS, Streak: 1. Bob remains strictly at 0 PTS / 0 Streak.
    [OK] Task unchecked: -10 PTS deducted -> Current Total: 25 PTS.
>>> 6. Testing Daily Auto-Renewal Engine...
    [OK] Auto-renewal verified: Old daily task auto-renewed for Alice today!
>>> 7. Testing Task Deletion...
    [OK] Task deleted cleanly.
>>> 8. Testing Session Logout...
    [OK] Session invalidated successfully on logout.
=================================================================
 ALL MULTI-USER & ZERO-STATE TESTS PASSED 100%!
=================================================================
```
