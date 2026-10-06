import sys
import os
import time

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import database as db

def run_tests():
    print("=" * 65)
    print("   STUDINIX MULTI-USER & ZERO-STATE TEST SUITE")
    print("=" * 65)

    # Clean slate DB for predictable tests
    if os.path.exists(db.DB_PATH):
        try:
            os.remove(db.DB_PATH)
        except Exception:
            pass

    print(">>> 1. Initializing Studinix Database...")
    db.init_db()

    # Test 2: User Registration & Zero-State Verification
    print(">>> 2. Testing User Registration & Zero-State Clean Slate...")
    alice = db.register_user("alice", "securepass123", "Alice Walker")
    assert alice is not None
    assert alice["username"] == "alice"
    assert alice["points"] == 0, f"Expected 0 points, got {alice['points']}"
    assert alice["streak_days"] == 0, f"Expected 0 streak, got {alice['streak_days']}"
    assert alice["token"] is not None

    alice_stats = db.get_user_stats(alice["user_id"])
    assert alice_stats["points"] == 0
    assert alice_stats["streak_days"] == 0
    assert alice_stats["daily_done"] == 0
    assert alice_stats["daily_total"] == 0

    alice_initial_tasks = db.get_tasks(alice["user_id"])
    assert len(alice_initial_tasks) == 0, f"Expected 0 tasks for new user, got {len(alice_initial_tasks)}"
    print(f"    [OK] User Alice registered: {alice_stats['points']} PTS, {alice_stats['streak_days']} Streak days, 0 seeded tasks.")

    # Test 3: Password Verification & Authentication
    print(">>> 3. Testing Authentication & PBKDF2 Password Verification...")
    # Bad password
    try:
        db.authenticate_user("alice", "wrongpassword")
        assert False, "Authentication with wrong password should fail"
    except ValueError:
        print("    [OK] Invalid password correctly rejected.")

    # Valid password
    auth_res = db.authenticate_user("alice", "securepass123")
    assert auth_res["token"] is not None
    token_user = db.get_user_by_token(auth_res["token"])
    assert token_user is not None
    assert token_user["username"] == "alice"
    print("    [OK] Authentication successful; session token validated.")

    # Test 4: Multi-Tenant Isolation
    print(">>> 4. Testing Multi-Tenant Data Isolation...")
    bob = db.register_user("bob", "bobsecret99", "Bob Smith")
    assert bob["points"] == 0
    assert bob["streak_days"] == 0

    # Alice creates tasks
    t_daily = db.create_task(alice["user_id"], "Alice Daily Code Practice", "daily")
    t_weekly = db.create_task(alice["user_id"], "Alice Weekly Database Design", "weekly", "2026-10-20")

    alice_tasks = db.get_tasks(alice["user_id"])
    bob_tasks = db.get_tasks(bob["user_id"])

    assert len(alice_tasks) == 2
    assert len(bob_tasks) == 0, "Bob must NOT see Alice's tasks"
    print(f"    [OK] Data isolation verified: Alice has {len(alice_tasks)} tasks, Bob has {len(bob_tasks)} tasks.")

    # Test 5: Gamified Points & Streak Progression
    print(">>> 5. Testing Gamified Points & Streak Progression...")
    # Alice completes daily task -> +10 PTS, streak becomes 1
    completed_state, delta, new_stats = db.toggle_task(t_daily)
    assert completed_state == 1
    assert delta == 10
    assert new_stats["points"] == 10
    assert new_stats["streak_days"] == 1

    # Alice completes weekly task -> +25 PTS -> 35 PTS
    completed_w, delta_w, new_stats_w = db.toggle_task(t_weekly)
    assert completed_w == 1
    assert delta_w == 25
    assert new_stats_w["points"] == 35

    # Verify Bob's stats remain unaffected at 0
    bob_stats = db.get_user_stats(bob["user_id"])
    assert bob_stats["points"] == 0
    assert bob_stats["streak_days"] == 0
    print(f"    [OK] Alice earned {new_stats_w['points']} PTS, Streak: {new_stats_w['streak_days']}. Bob remains strictly at 0 PTS / 0 Streak.")

    # Uncheck task -> -10 PTS -> 25 PTS
    uncheck_state, uncheck_delta, uncheck_stats = db.toggle_task(t_daily)
    assert uncheck_state == 0
    assert uncheck_delta == -10
    assert uncheck_stats["points"] == 25
    print(f"    [OK] Task unchecked: {uncheck_delta} PTS deducted -> Current Total: {uncheck_stats['points']} PTS.")

    # Test 6: Auto-Renewal for Scoped User
    print(">>> 6. Testing Daily Auto-Renewal Engine...")
    conn = db.get_connection()
    conn.execute("UPDATE tasks SET last_reset_date = '2025-01-01', completed = 1 WHERE id = ?", (t_daily,))
    conn.commit()
    conn.close()

    refreshed_tasks = db.get_tasks(alice["user_id"])
    target_daily = next(t for t in refreshed_tasks if t["id"] == t_daily)
    assert target_daily["completed"] == 0
    print("    [OK] Auto-renewal verified: Old daily task auto-renewed for Alice today!")

    # Test 7: Task Deletion
    print(">>> 7. Testing Task Deletion...")
    db.delete_task(t_weekly)
    final_tasks = db.get_tasks(alice["user_id"])
    assert not any(t["id"] == t_weekly for t in final_tasks)
    print("    [OK] Task deleted cleanly.")

    # Test 8: Logout & Session Invalidation
    print(">>> 8. Testing Session Logout...")
    db.logout_user(auth_res["token"])
    logged_out_user = db.get_user_by_token(auth_res["token"])
    assert logged_out_user is None
    print("    [OK] Session invalidated successfully on logout.")

    print("\n" + "=" * 65)
    print(" ALL MULTI-USER & ZERO-STATE TESTS PASSED 100%!")
    print("=" * 65)

if __name__ == "__main__":
    run_tests()

