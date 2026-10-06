// Studinix Main Application Logic (Multi-User & Zero-State Engine)
let allTasks = [];
let currentCategory = 'all';
let userStats = { points: 0, streak_days: 0 };
let ws = null;
let currentUser = null;
let authToken = localStorage.getItem('studinix_auth_token') || null;

// Stopwatch State
let stopwatchTimer = null;
let stopwatchSeconds = 0;
let stopwatchRunning = false;

document.addEventListener('DOMContentLoaded', () => {
  initSession();
  connectWebSocket();
  initDesktopListeners();
  if (window.lucide) lucide.createIcons();
});

// ----------------- AUTHENTICATION & SESSION MANAGEMENT -----------------

async function initSession() {
  if (authToken) {
    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        localStorage.setItem('studinix_user', JSON.stringify(currentUser));
        hideAuthModal();
        renderUserProfile();
        await loadStats();
        await loadTasks();
        return;
      }
    } catch (e) {
      console.warn('Session verification error:', e);
    }
  }

  // Not authenticated or token invalid
  clearSessionState();
  showAuthModal();
}

function clearSessionState() {
  currentUser = null;
  authToken = null;
  localStorage.removeItem('studinix_auth_token');
  localStorage.removeItem('studinix_user');
  userStats = { points: 0, streak_days: 0 };
  allTasks = [];
  renderUserProfile();
  renderStats();
  renderTasks();
}

function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('hidden');
  switchAuthTab('login');
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');
  const errBox = document.getElementById('auth-error');

  if (errBox) errBox.classList.add('hidden');

  if (tab === 'login') {
    tabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition active bg-indigo-600/20 text-indigo-400 border border-indigo-500/40';
    tabRegister.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition text-slate-400 hover:text-white';
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    authTitle.textContent = 'Welcome to Studinix';
    authSubtitle.textContent = 'Sign in to access your tasks and earn focus points';
  } else {
    tabRegister.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition active bg-emerald-600/20 text-emerald-400 border border-emerald-500/40';
    tabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition text-slate-400 hover:text-white';
    formLogin.classList.add('hidden');
    formRegister.classList.remove('hidden');
    authTitle.textContent = 'Create Studinix Account';
    authSubtitle.textContent = 'Clean-slate setup: 0 PTS and 0 Days Streak guaranteed';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errBox = document.getElementById('auth-error');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  try {
    let res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (res.status === 404) {
      // Fallback
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data.detail || 'Login failed.';
      if (res.status === 404) {
        msg = 'Login service unavailable (404). Please restart the backend server.';
      } else if (res.status === 401 || msg.toLowerCase().includes('invalid')) {
        msg = 'Incorrect username or password. Please try again.';
      }
      throw new Error(msg);
    }

    authToken = data.user.token;
    currentUser = data.user;
    localStorage.setItem('studinix_auth_token', authToken);
    localStorage.setItem('studinix_user', JSON.stringify(currentUser));

    hideAuthModal();
    renderUserProfile();
    showToast(`Welcome back, ${currentUser.full_name}!`, 'success');

    await loadStats();
    await loadTasks();

    if (window.StudinixDesktop && window.StudinixDesktop.notifyUserChanged) {
      window.StudinixDesktop.notifyUserChanged(currentUser);
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const fullnameInput = document.getElementById('reg-fullname');
  const usernameInput = document.getElementById('reg-username');
  const passwordInput = document.getElementById('reg-password');
  const errBox = document.getElementById('auth-error');

  const fullName = fullnameInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  try {
    let res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, username: username, password: password })
    });

    if (res.status === 404) {
      // Fallback
      res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, username: username, password: password })
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data.detail || 'Registration failed.';
      if (res.status === 404) {
        msg = 'Registration service unavailable (404). Please restart the backend server.';
      } else if (msg.toLowerCase().includes('already taken') || msg.toLowerCase().includes('unique')) {
        msg = 'Username already exists. Please choose a different username.';
      } else if (msg.toLowerCase().includes('least 4')) {
        msg = 'Password must be at least 4 characters long.';
      }
      throw new Error(msg);
    }

    authToken = data.user.token;
    currentUser = data.user;
    localStorage.setItem('studinix_auth_token', authToken);
    localStorage.setItem('studinix_user', JSON.stringify(currentUser));

    hideAuthModal();
    renderUserProfile();
    showToast(`Welcome to Studinix, ${currentUser.full_name}! Starting with 0 PTS.`, 'success');

    await loadStats();
    await loadTasks();

    if (window.StudinixDesktop && window.StudinixDesktop.notifyUserChanged) {
      window.StudinixDesktop.notifyUserChanged(currentUser);
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }
}

async function logout() {
  if (authToken) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (e) {}
  }

  clearSessionState();
  showAuthModal();
  showToast('Logged out successfully', 'info');

  if (window.StudinixDesktop && window.StudinixDesktop.notifyUserChanged) {
    window.StudinixDesktop.notifyUserChanged(null);
  }
}

function renderUserProfile() {
  const avatar = document.getElementById('user-avatar');
  const nameLabel = document.getElementById('user-display-name');
  const usernameLabel = document.getElementById('user-display-username');

  if (currentUser) {
    const fullName = typeof currentUser.full_name === 'string' ? currentUser.full_name.trim() : '';
    const username = typeof currentUser.username === 'string' ? currentUser.username.trim() : '';
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    let initials = '';

    if (nameParts.length >= 2) {
      initials = `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`;
    } else if (nameParts.length === 1) {
      initials = nameParts[0][0];
    } else if (username) {
      initials = username[0];
    }

    const avatarText = (initials || 'S').toUpperCase();
    if (avatar) avatar.textContent = avatarText;
    if (nameLabel) nameLabel.textContent = fullName || username || 'Studinix';
    if (usernameLabel) usernameLabel.textContent = username ? `@${username}` : '@studinix';
  } else {
    if (avatar) avatar.textContent = 'S';
    if (nameLabel) nameLabel.textContent = 'Not Signed In';
    if (usernameLabel) usernameLabel.textContent = '@guest';
  }
}

// ----------------- DATA LOADING -----------------

function getActiveUserId() {
  return currentUser ? (currentUser.user_id || currentUser.id) : null;
}

async function loadStats() {
  const userId = getActiveUserId();
  if (!userId) return;

  try {
    const res = await fetch(`/api/stats?user_id=${userId}`, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    userStats = await res.json();
    renderStats();
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function renderStats() {
  const pts = document.getElementById('points-counter');
  const streak = document.getElementById('streak-counter');
  const points = userStats ? (userStats.points || 0) : 0;
  const streakDays = userStats ? (userStats.streak_days || 0) : 0;

  if (pts) pts.textContent = `${points} PTS`;
  if (streak) streak.textContent = `${streakDays} Day${streakDays === 1 ? '' : 's'}`;
}

async function loadTasks() {
  const userId = getActiveUserId();
  if (!userId) {
    allTasks = [];
    updateCategoryCounts();
    renderTasks();
    return;
  }

  try {
    const res = await fetch(`/api/tasks?user_id=${userId}`, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    allTasks = await res.json();
    updateCategoryCounts();
    renderTasks();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

function updateCategoryCounts() {
  const cDaily = document.getElementById('count-daily');
  const cWeekly = document.getElementById('count-weekly');
  const cTarget = document.getElementById('count-target');

  if (cDaily) cDaily.textContent = allTasks.filter(t => t.category === 'daily').length;
  if (cWeekly) cWeekly.textContent = allTasks.filter(t => t.category === 'weekly').length;
  if (cTarget) cTarget.textContent = allTasks.filter(t => t.category === 'target').length;
}

function switchCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tab-${cat}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderTasks();
}

function renderTasks() {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `
      <div class="glass-card p-10 text-center text-slate-400 text-xs space-y-3">
        <p>Please sign in or create an account to view and manage your tasks.</p>
        <button onclick="showAuthModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition">
          Sign In / Create Account
        </button>
      </div>
    `;
    return;
  }

  const filtered = currentCategory === 'all'
    ? allTasks
    : allTasks.filter(t => t.category === currentCategory);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="glass-card p-10 text-center text-slate-500 text-xs">
        No tasks in this view. Add one above to start earning points!
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const isCompleted = t.completed === 1;
    const ptsBadge = t.category === 'daily' ? '+10 PTS' : '+25 PTS';
    const catBadgeClass = t.category === 'daily'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : t.category === 'weekly'
      ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
      : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';

    return `
      <div class="glass-card p-3.5 flex items-center justify-between gap-3 transition hover:border-indigo-500/40 ${isCompleted ? 'opacity-60 bg-emerald-950/10 border-emerald-500/20' : ''}">
        <div class="flex items-center gap-3 flex-1 min-w-0" onclick="toggleTask('${t.id}')" style="cursor: pointer;">
          <div class="w-5 h-5 rounded-lg border-2 flex items-center justify-center transition shrink-0 ${isCompleted ? 'bg-emerald-500 border-emerald-500' : 'border-indigo-500/60'}">
            ${isCompleted ? '<i data-lucide="check" class="w-3.5 h-3.5 text-white"></i>' : ''}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-white truncate ${isCompleted ? 'line-through text-slate-400' : ''}">
              ${escapeHtml(t.title)}
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded border ${catBadgeClass}">
                ${t.category}
              </span>
              ${t.deadline ? `<span class="text-[11px] text-slate-400 font-mono-numbers">📅 ${t.deadline}</span>` : ''}
              ${t.category === 'daily' ? '<span class="text-[10px] text-slate-500">Auto-renews daily</span>' : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2.5">
          <span class="text-xs font-extrabold font-mono-numbers ${isCompleted ? 'text-emerald-400' : 'text-slate-400'}">
            ${ptsBadge}
          </span>
          <button onclick="deleteTask('${t.id}')" class="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg transition" title="Delete Task">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// ----------------- TASK ACTIONS -----------------

async function createNewTask() {
  if (!currentUser) {
    showAuthModal();
    return;
  }

  const titleInput = document.getElementById('new-task-title');
  const catInput = document.getElementById('new-task-cat');
  const deadlineInput = document.getElementById('new-task-deadline');

  const title = titleInput.value.trim();
  if (!title) {
    showToast('Task title is required', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({
        user_id: getActiveUserId(),
        title: title,
        category: catInput.value,
        deadline: deadlineInput.value || null
      })
    });
    if (res.ok) {
      titleInput.value = '';
      deadlineInput.value = '';
      showToast('Task added!', 'success');
      await loadTasks();
      if (window.StudinixDesktop && window.StudinixDesktop.notifyTasksUpdated) {
        window.StudinixDesktop.notifyTasksUpdated();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleTask(taskId) {
  if (!currentUser) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}/toggle`, {
      method: 'POST',
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    const data = await res.json();
    if (data.status === 'success') {
      const target = allTasks.find(t => t.id === taskId);
      if (target) target.completed = data.completed;

      userStats = data.stats;
      renderStats();
      renderTasks();

      const sign = data.delta > 0 ? '+' : '';
      showToast(`${sign}${data.delta} Points!`, data.delta > 0 ? 'success' : 'info');

      if (window.StudinixDesktop && window.StudinixDesktop.notifyTasksUpdated) {
        window.StudinixDesktop.notifyTasksUpdated();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTask(taskId) {
  if (!currentUser) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    if (res.ok) {
      showToast('Task deleted', 'info');
      await loadTasks();
      if (window.StudinixDesktop && window.StudinixDesktop.notifyTasksUpdated) {
        window.StudinixDesktop.notifyTasksUpdated();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------- FOCUS STOPWATCH -----------------

function toggleStopwatch() {
  const btn = document.getElementById('btn-timer-toggle');
  const label = document.getElementById('timer-toggle-label');
  const badge = document.getElementById('timer-state-badge');

  if (stopwatchRunning) {
    clearInterval(stopwatchTimer);
    stopwatchRunning = false;
    label.textContent = 'Resume Focus';
    badge.textContent = 'Paused';
    badge.className = 'px-2 py-0.5 text-[10px] rounded-full bg-amber-500/20 text-amber-400 font-semibold uppercase';
  } else {
    stopwatchRunning = true;
    label.textContent = 'Pause Focus';
    badge.textContent = 'Focusing';
    badge.className = 'px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-400 font-semibold uppercase';

    stopwatchTimer = setInterval(() => {
      stopwatchSeconds++;
      updateStopwatchDisplay();
    }, 1000);
  }
}

function resetStopwatch() {
  clearInterval(stopwatchTimer);
  stopwatchRunning = false;
  stopwatchSeconds = 0;
  updateStopwatchDisplay();

  const label = document.getElementById('timer-toggle-label');
  const badge = document.getElementById('timer-state-badge');
  label.textContent = 'Start Focus';
  badge.textContent = 'Idle';
  badge.className = 'px-2 py-0.5 text-[10px] rounded-full bg-slate-800 text-slate-400 font-semibold uppercase';
}

function updateStopwatchDisplay() {
  const hrs = Math.floor(stopwatchSeconds / 3600);
  const mins = Math.floor((stopwatchSeconds % 3600) / 60);
  const secs = stopwatchSeconds % 60;

  const fmt = [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
  const display = document.getElementById('stopwatch-display');
  if (display) display.textContent = fmt;
}

// ----------------- FLOATING DROP NOTE TOGGLE -----------------

function toggleDropNoteWindow() {
  if (window.StudinixDesktop && window.StudinixDesktop.toggleDropNote) {
    window.StudinixDesktop.toggleDropNote();
    showToast('Toggled Floating Drop Note', 'info');
  } else {
    window.open('/dropnote', 'StudinixDropNote', 'width=340,height=480,resizable=yes');
  }
}

// ----------------- DESKTOP IPC & REAL-TIME WEBSOCKET SYNC -----------------

function initDesktopListeners() {
  if (window.StudinixDesktop) {
    if (window.StudinixDesktop.onTasksSynced) {
      window.StudinixDesktop.onTasksSynced(() => {
        loadStats();
        loadTasks();
      });
    }
    if (window.StudinixDesktop.onUserChanged) {
      window.StudinixDesktop.onUserChanged((user) => {
        if (!user) {
          clearSessionState();
          showAuthModal();
        } else {
          initSession();
        }
      });
    }
  }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const currentId = getActiveUserId();

      // Filter by active user
      if (data.user_id && currentId && data.user_id !== currentId) {
        return;
      }

      if (data.type === 'TASK_TOGGLED') {
        userStats = data.stats;
        renderStats();
        loadTasks();
      } else if (data.type === 'TASKS_UPDATED') {
        loadTasks();
        loadStats();
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

// ----------------- TOAST & HELPERS -----------------

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const bg = type === 'success' ? 'bg-emerald-600' :
             type === 'warning' ? 'bg-amber-600' :
             type === 'error' ? 'bg-rose-600' : 'bg-indigo-600';

  toast.className = `fixed bottom-6 right-6 z-50 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-2xl transition transform translate-y-0 opacity-100 ${bg}`;
  toast.textContent = msg;

  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 z-50 transition transform translate-y-4 opacity-0 pointer-events-none';
  }, 2500);
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}
