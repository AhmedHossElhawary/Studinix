// Studinix Drop Note Widget Logic (Multi-User Aware)
let dailyTasks = [];
let isCollapsed = false;
let ws = null;
let currentUser = null;
let authToken = null;

document.addEventListener('DOMContentLoaded', () => {
  syncSessionFromStorage();
  connectWebSocket();
  initDesktopListeners();
  if (window.lucide) lucide.createIcons();
});

// ----------------- USER SESSION SYNC -----------------

function syncSessionFromStorage() {
  authToken = localStorage.getItem('studinix_auth_token') || null;
  const userJson = localStorage.getItem('studinix_user');
  if (userJson) {
    try {
      currentUser = JSON.parse(userJson);
    } catch (e) {
      currentUser = null;
    }
  } else {
    currentUser = null;
  }

  updateUserUI();
  if (currentUser) {
    loadDailyTasks();
    loadStats();
  } else {
    dailyTasks = [];
    renderDailyTasks();
    updatePointsUI(0);
  }
}

function getActiveUserId() {
  return currentUser ? (currentUser.user_id || currentUser.id) : null;
}

function updateUserUI() {
  const badge = document.getElementById('dn-user-badge');
  if (!badge) return;
  if (currentUser) {
    badge.textContent = currentUser.username ? `@${currentUser.username}` : 'Active';
    badge.title = currentUser.full_name || currentUser.username;
  } else {
    badge.textContent = 'Sign In Required';
    badge.title = 'Please log in on the main window';
  }
}

// ----------------- DATA FETCHING & RENDERING -----------------

async function loadDailyTasks() {
  const userId = getActiveUserId();
  if (!userId) {
    dailyTasks = [];
    renderDailyTasks();
    return;
  }

  try {
    const res = await fetch(`/api/tasks?user_id=${userId}`, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    const tasks = await res.json();
    dailyTasks = tasks.filter(t => t.category === 'daily');
    renderDailyTasks();
  } catch (err) {
    console.error('Failed to load daily tasks:', err);
  }
}

async function loadStats() {
  const userId = getActiveUserId();
  if (!userId) {
    updatePointsUI(0);
    return;
  }

  try {
    const res = await fetch(`/api/stats?user_id=${userId}`, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    const stats = await res.json();
    updatePointsUI(stats.points || 0);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function updatePointsUI(pts) {
  const pointsLabel = document.getElementById('dn-points-label');
  const chipPoints = document.getElementById('dn-chip-points');
  if (pointsLabel) pointsLabel.textContent = pts;
  if (chipPoints) chipPoints.textContent = pts;
}

function renderDailyTasks() {
  const container = document.getElementById('dn-task-list');
  const countLabel = document.getElementById('dn-task-count');
  const chipStatus = document.getElementById('dn-chip-status');

  if (!currentUser) {
    if (countLabel) countLabel.textContent = 'Auth required';
    if (chipStatus) chipStatus.textContent = 'Sign in on Main';
    container.innerHTML = `
      <div style="text-align:center;padding:28px 8px;color:var(--muted);font-size:0.75rem;line-height:1.5;">
        🔒 Please log in on the<br/><strong style="color:#c7d2fe;">Main Studinix Window</strong><br/>to sync your tasks & points.
      </div>
    `;
    return;
  }

  const completedCount = dailyTasks.filter(t => t.completed === 1).length;
  const totalCount = dailyTasks.length;

  if (countLabel) {
    countLabel.textContent = `${completedCount}/${totalCount} completed`;
  }
  if (chipStatus) {
    const remaining = totalCount - completedCount;
    chipStatus.textContent = remaining === 0 && totalCount > 0 ? 'All done! 🎉' : `${remaining} left`;
  }

  if (dailyTasks.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 0;color:var(--muted);font-size:0.75rem;">
        No daily tasks yet.<br/>Type below to add one!
      </div>
    `;
    return;
  }

  container.innerHTML = dailyTasks.map(t => `
    <div class="task-item ${t.completed ? 'completed' : ''}" onclick="toggleDailyTask('${t.id}')">
      <div class="task-checkbox">
        ${t.completed ? '<i data-lucide="check" style="width:12px;height:12px;color:#fff;"></i>' : ''}
      </div>
      <span class="task-title">${escapeHtml(t.title)}</span>
      <span class="task-pts-badge">+10</span>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

// ----------------- ACTIONS: TOGGLE & ADD -----------------

async function toggleDailyTask(taskId) {
  if (!currentUser) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}/toggle`, {
      method: 'POST',
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    const data = await res.json();
    if (data.status === 'success') {
      const target = dailyTasks.find(t => t.id === taskId);
      if (target) target.completed = data.completed;
      renderDailyTasks();
      updatePointsUI(data.stats.points);

      if (window.StudinixDesktop && window.StudinixDesktop.notifyTasksUpdated) {
        window.StudinixDesktop.notifyTasksUpdated();
      }
    }
  } catch (err) {
    console.error('Error toggling task:', err);
  }
}

async function addDailyTask() {
  if (!currentUser) return;

  const input = document.getElementById('dn-new-task-input');
  const title = input.value.trim();
  if (!title) return;

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
        category: 'daily'
      })
    });
    if (res.ok) {
      input.value = '';
      await loadDailyTasks();
      if (window.StudinixDesktop && window.StudinixDesktop.notifyTasksUpdated) {
        window.StudinixDesktop.notifyTasksUpdated();
      }
    }
  } catch (err) {
    console.error('Error adding task:', err);
  }
}

// ----------------- COLLAPSE / MINIMIZE MODES -----------------

function toggleCollapse(collapse) {
  isCollapsed = collapse;
  const container = document.getElementById('dropnote-container');
  if (collapse) {
    container.classList.add('is-collapsed');
  } else {
    container.classList.remove('is-collapsed');
  }

  if (window.StudinixDesktop && window.StudinixDesktop.setDropNoteCollapsed) {
    window.StudinixDesktop.setDropNoteCollapsed(collapse);
  }
}

function closeDropNote() {
  if (window.StudinixDesktop && window.StudinixDesktop.hideDropNote) {
    window.StudinixDesktop.hideDropNote();
  } else {
    toggleCollapse(true);
  }
}

// ----------------- DESKTOP IPC & REAL-TIME WEBSOCKET SYNC -----------------

function initDesktopListeners() {
  if (window.StudinixDesktop) {
    if (window.StudinixDesktop.onTasksSynced) {
      window.StudinixDesktop.onTasksSynced(() => {
        loadDailyTasks();
        loadStats();
      });
    }
    if (window.StudinixDesktop.onUserChanged) {
      window.StudinixDesktop.onUserChanged((user) => {
        syncSessionFromStorage();
      });
    }
  }

  // Also listen for localStorage changes across browser tabs/windows
  window.addEventListener('storage', (e) => {
    if (e.key === 'studinix_auth_token' || e.key === 'studinix_user') {
      syncSessionFromStorage();
    }
  });
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const currentId = getActiveUserId();

      if (data.user_id && currentId && data.user_id !== currentId) {
        return;
      }

      if (data.type === 'TASK_TOGGLED' || data.type === 'TASKS_UPDATED') {
        loadDailyTasks();
        loadStats();
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}
