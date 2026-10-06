import sys
import os
import time
import webbrowser
import threading

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def open_windows_after_delay(main_url: str, dropnote_url: str, delay: float = 1.2):
    time.sleep(delay)
    try:
        webbrowser.open(main_url)
        time.sleep(0.4)
        webbrowser.open(dropnote_url)
    except Exception:
        pass

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "backend")
    sys.path.insert(0, backend_dir)

    main_url = "http://localhost:8000"
    dropnote_url = "http://localhost:8000/dropnote"

    print("=" * 68)
    print("      STUDINIX -- MINIMALIST TO-DO, POINTS & DROP NOTE v2.5")
    print("=" * 68)
    print(" [*] Auto-Renew Daily Tasks Engine : Active")
    print(" [*] Gamified Points System        : +10 Daily | +25 Weekly/Target")
    print(" [*] Focus Stopwatch               : Active")
    print(" [*] Floating Desktop Drop Note    : Always-On-Top Enabled")
    print("-" * 68)
    print(f" Main Application Window           : {main_url}")
    print(f" Floating Desktop Drop Note        : {dropnote_url}")
    print("=" * 68)
    print(" Starting engine... Press Ctrl+C to stop.")
    print("-" * 68)

    # Launch browser preview if Electron is not used directly
    threading.Thread(target=open_windows_after_delay, args=(main_url, dropnote_url), daemon=True).start()

    try:
        import uvicorn
        from server import app
        uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
    except KeyboardInterrupt:
        print("\n[!] Studinix shut down cleanly.")

if __name__ == "__main__":
    main()
