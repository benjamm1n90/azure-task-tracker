// Task Tracker front end — plain JavaScript, no frameworks.
// Talks to the same-origin API:  GET/POST /api/tasks, PUT/DELETE /api/tasks/{id}, GET /api/me
// All user text is written with textContent (never innerHTML), so a task title
// can't inject markup or script.

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    today: $('today'),
    user: $('user'),
    avatar: $('avatar'),
    userName: $('userName'),
    doneCount: $('doneCount'),
    totalCount: $('totalCount'),
    percent: $('percent'),
    bar: $('bar'),
    barFill: $('barFill'),
    composer: $('composer'),
    newTitle: $('newTitle'),
    addBtn: $('addBtn'),
    clearDone: $('clearDone'),
    banner: $('banner'),
    list: $('list'),
    empty: $('empty'),
    emptyTitle: $('emptyTitle'),
    emptySub: $('emptySub'),
    toast: $('toast'),
    themeToggle: $('themeToggle'),
    filters: document.querySelectorAll('.seg-btn'),
  };

  const state = {
    tasks: [],
    filter: 'all',   // 'all' | 'active' | 'done'
    loaded: false,
    loadFailed: false,
    editingId: null,
    justAddedId: null,
  };

  // ---------- Icons (constant, trusted markup) ----------
  const ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4h4v2m-6 0l.7 10h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- API ----------
  class AuthError extends Error {}

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(path, {
        // 'manual' lets us notice when App Service sign-in redirects us
        // (an expired session) instead of silently following it to a login page.
        redirect: 'manual',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch {
      throw new Error('Can’t reach the server.');
    }
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
      throw new AuthError();
    }
    if (!res.ok) throw new Error(`The server returned ${res.status}.`);
    return res.status === 204 ? null : res.json();
  }

  // ---------- Small helpers ----------
  let toastTimer;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3800);
  }

  function showBanner(text, kind = 'info', link) {
    els.banner.className = 'banner' + (kind === 'warn' ? ' warn' : '');
    els.banner.textContent = text;
    if (link) {
      els.banner.append(' ');
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      els.banner.append(a);
    }
    els.banner.hidden = false;
  }
  const hideBanner = () => { els.banner.hidden = true; };

  function handleError(err, fallback) {
    if (err instanceof AuthError) {
      showBanner('Your session has ended.', 'warn', {
        href: '/.auth/login/aad?post_login_redirect_uri=/',
        label: 'Sign in again',
      });
    } else {
      toast(err.message && err.message !== 'Failed to fetch' ? `${fallback} ${err.message}` : fallback);
    }
  }

  // The API returns UTC timestamps; some arrive without a trailing "Z".
  function parseUtc(value) {
    if (!value) return null;
    const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
    const d = new Date(hasZone ? value : value + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function timeAgo(date) {
    if (!date) return '';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(seconds / 86400), 'day');
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function cleanUserName(raw) {
    if (!raw) return '';
    // Guest accounts look like  jane_gmail.com#EXT#@tenant.onmicrosoft.com
    const ext = raw.indexOf('#EXT#');
    if (ext > 0) {
      const base = raw.slice(0, ext);
      const i = base.lastIndexOf('_');
      return i > 0 ? base.slice(0, i) + '@' + base.slice(i + 1) : base;
    }
    return raw;
  }

  function initials(name) {
    const local = name.split('@')[0];
    const parts = local.split(/[^a-zA-Z]+/).filter(Boolean);
    const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2));
    return letters.toUpperCase();
  }

  // ---------- Rendering ----------
  function visibleTasks() {
    if (state.filter === 'active') return state.tasks.filter((t) => !t.isComplete);
    if (state.filter === 'done') return state.tasks.filter((t) => t.isComplete);
    return state.tasks;
  }

  function renderProgress() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.isComplete).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    els.doneCount.textContent = done;
    els.totalCount.textContent = total;
    els.percent.textContent = pct + '%';
    els.barFill.style.width = pct + '%';
    els.bar.setAttribute('aria-valuenow', String(pct));
    els.clearDone.hidden = done === 0;
  }

  function renderSkeleton() {
    els.list.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li');
      li.className = 'skeleton';
      li.innerHTML = '<span class="sk dot"></span><span class="sk line"></span>';
      els.list.append(li);
    }
  }

  function buildItem(task) {
    const li = document.createElement('li');
    li.className = 'item' + (task.isComplete ? ' done' : '');
    li.dataset.id = String(task.id);
    if (task.id === state.justAddedId) li.classList.add('enter');

    // Checkbox
    const check = document.createElement('label');
    check.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = task.isComplete;
    input.setAttribute('aria-label', `Mark “${task.title}” as ${task.isComplete ? 'not done' : 'done'}`);
    input.addEventListener('change', () => toggle(task));
    const box = document.createElement('span');
    box.className = 'box';
    box.innerHTML = ICON_CHECK;
    check.append(input, box);

    // Title (or inline editor)
    const body = document.createElement('div');
    body.className = 'body';

    if (state.editingId === task.id) {
      const edit = document.createElement('input');
      edit.className = 'edit';
      edit.type = 'text';
      edit.maxLength = 200;
      edit.value = task.title;
      edit.setAttribute('aria-label', 'Edit task title');
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        state.editingId = null;
        if (save) rename(task, edit.value);
        else render();
      };
      edit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      edit.addEventListener('blur', () => finish(true));
      body.append(edit);
      queueMicrotask(() => { edit.focus(); edit.select(); });
    } else {
      const title = document.createElement('p');
      title.className = 'title';
      title.textContent = task.title;
      title.title = 'Double-click to edit';
      title.addEventListener('dblclick', () => startEdit(task));
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = 'Added ' + timeAgo(parseUtc(task.createdAtUtc));
      body.append(title, meta);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('aria-label', `Edit “${task.title}”`);
    editBtn.innerHTML = ICON_EDIT;
    editBtn.addEventListener('click', () => startEdit(task));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn danger';
    delBtn.setAttribute('aria-label', `Delete “${task.title}”`);
    delBtn.innerHTML = ICON_TRASH;
    delBtn.addEventListener('click', () => remove(task, li));
    actions.append(editBtn, delBtn);

    li.append(check, body, actions);
    return li;
  }

  function render() {
    renderProgress();
    els.list.setAttribute('aria-busy', String(!state.loaded));

    if (!state.loaded) {
      els.empty.hidden = true;
      renderSkeleton();
      return;
    }

    const tasks = visibleTasks();
    els.list.replaceChildren(...tasks.map(buildItem));
    state.justAddedId = null;

    els.empty.hidden = tasks.length > 0;
    if (!tasks.length) {
      const copy = {
        all: ['Nothing here yet', 'Add your first task above to get started.'],
        active: ['All caught up', 'Every task is done. Enjoy the quiet.'],
        done: ['Nothing completed yet', 'Finished tasks will show up here.'],
      }[state.filter];
      els.emptyTitle.textContent = state.loadFailed ? 'Couldn’t load tasks' : copy[0];
      els.emptySub.textContent = state.loadFailed ? 'Refresh the page to try again.' : copy[1];
    }
  }

  // ---------- Actions ----------
  async function load() {
    // The free App Service tier sleeps when idle; tell people why it's slow.
    const slow = setTimeout(() => {
      if (!state.loaded) {
        showBanner('Waking the server up… The free hosting tier sleeps when idle, so the first load can take a little while.');
      }
    }, 4000);
    try {
      state.tasks = await api('/api/tasks');
      state.loaded = true;
      state.loadFailed = false;
      hideBanner();
    } catch (err) {
      state.loaded = true; // stop the skeleton
      state.loadFailed = true;
      handleError(err, 'Couldn’t load your tasks.');
    } finally {
      clearTimeout(slow);
    }
    render();
  }

  async function add(title) {
    els.addBtn.disabled = true;
    try {
      const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
      state.tasks.unshift(created);
      state.justAddedId = created.id;
      if (state.filter === 'done') setFilter('all'); else render();
      els.newTitle.value = '';
    } catch (err) {
      handleError(err, 'Couldn’t add that task.');
    } finally {
      els.addBtn.disabled = false;
      els.newTitle.focus();
    }
  }

  async function toggle(task) {
    const previous = task.isComplete;
    task.isComplete = !previous;          // optimistic: update instantly
    render();
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: task.title, isComplete: task.isComplete }),
      });
    } catch (err) {
      task.isComplete = previous;         // roll back if the server said no
      render();
      handleError(err, 'Couldn’t update that task.');
    }
  }

  function startEdit(task) {
    state.editingId = task.id;
    render();
  }

  async function rename(task, rawTitle) {
    const title = rawTitle.trim();
    if (!title || title === task.title) { render(); return; }
    const previous = task.title;
    task.title = title;
    render();
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, isComplete: task.isComplete }),
      });
    } catch (err) {
      task.title = previous;
      render();
      handleError(err, 'Couldn’t rename that task.');
    }
  }

  async function remove(task, li) {
    li.classList.add('leaving');
    try {
      await Promise.all([
        api(`/api/tasks/${task.id}`, { method: 'DELETE' }),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      render();
    } catch (err) {
      li.classList.remove('leaving');
      handleError(err, 'Couldn’t delete that task.');
    }
  }

  async function clearCompleted() {
    const done = state.tasks.filter((t) => t.isComplete);
    if (!done.length) return;
    const results = await Promise.allSettled(
      done.map((t) => api(`/api/tasks/${t.id}`, { method: 'DELETE' }))
    );
    const removed = new Set(done.filter((_, i) => results[i].status === 'fulfilled').map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !removed.has(t.id));
    render();
    if (removed.size < done.length) toast('Some tasks couldn’t be cleared.');
  }

  function setFilter(filter) {
    state.filter = filter;
    els.filters.forEach((btn) => {
      const on = btn.dataset.filter === filter;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    render();
  }

  async function loadUser() {
    try {
      // Only present behind App Service sign-in; locally it returns no name.
      const me = await api('/api/me');
      const name = cleanUserName(me && me.name);
      if (!name) return;
      els.userName.textContent = name;
      els.avatar.textContent = initials(name);
      els.user.hidden = false;
    } catch {
      /* not signed in, or running locally: just don't show the chip */
    }
  }


  // ---------- Theme (dark by default, light via the toggle) ----------
  function applyTheme(theme, persist) {
    const light = theme === 'light';
    if (light) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    els.themeToggle.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f5f3ee' : '#101211');
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch { /* storage blocked: fine, just not remembered */ }
    }
  }
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);
  els.themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  });

  // ---------- Wire up ----------
  els.today.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = els.newTitle.value.trim();
    if (title) add(title);
  });
  els.filters.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
  els.clearDone.addEventListener('click', clearCompleted);

  render();     // shows the loading skeleton immediately
  load();
  loadUser();
})();
