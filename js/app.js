// app.js — Main application controller

const App = (() => {
  let currentView = 'project';
  let filters = {};
  let theme = 'dark';

  async function init() {
    // Try loading from localStorage first
    if (Store.loadFromStorage()) {
      showApp();
      // Restore file handle from IndexedDB so save-back works after reload
      await Store.restoreFileHandle();
    } else {
      showWelcome();
    }

    // Listen for data changes to re-render
    Store.on('taskAdded', refreshView);
    Store.on('taskUpdated', refreshView);
    Store.on('taskDeleted', refreshView);
    Store.on('bucketAdded', refreshView);
    Store.on('bucketUpdated', refreshView);
    Store.on('bucketDeleted', refreshView);
    Store.on('groupAdded', refreshView);
    Store.on('groupUpdated', refreshView);
    Store.on('groupDeleted', refreshView);
    Store.on('projectGroupAdded', refreshView);
    Store.on('projectGroupUpdated', refreshView);
    Store.on('projectGroupDeleted', refreshView);
    Store.on('memberDeleted', refreshView);
    Store.on('labelDeleted', refreshView);

    // Load saved theme
    const savedTheme = localStorage.getItem('planner_theme') || 'dark';
    setTheme(savedTheme);
  }

  function showWelcome() {
    document.getElementById('app').innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-card">
          <div style="width:56px;height:56px;background:var(--accent);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;font-weight:700;color:white;">P</div>
          <h1>Planner</h1>
          <p>A local project management tool for your team. Track tasks, manage phases, and visualize progress with interactive Gantt charts.</p>
          <div class="welcome-actions">
            <button class="btn btn-primary" onclick="App.loadSample()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></svg>
              Load Sample Project
            </button>
            <button class="btn btn-secondary" onclick="App.newProject()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              New Empty Project
            </button>
            <div class="drop-zone" id="drop-zone"
                 onclick="App.openFile()"
                 ondragover="event.preventDefault();this.classList.add('drag-over')"
                 ondragleave="this.classList.remove('drag-over')"
                 ondrop="App.handleDrop(event)">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto 8px;display:block;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Drop a JSON file here or click to browse
              <input type="file" id="file-input" accept=".json" style="display:none" onchange="App.handleFileSelect(event)" />
            </div>
          </div>
        </div>
      </div>`;
  }

  function showApp() {
    const data = Store.getData();
    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <!-- Sidebar -->
        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="sidebar-logo">P</div>
            <span class="sidebar-title" id="project-title">${esc(data.meta.title)}</span>
            <button class="btn-icon" onclick="App.editProjectTitle()" title="Edit title">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
          </div>
          <nav class="sidebar-nav">
            <div class="nav-section-label" style="margin-top:16px;">Team</div>
            <div id="sidebar-members"></div>
            <button class="nav-item" onclick="App.addMember()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
              Add Member
            </button>

            <div class="nav-section-label" style="margin-top:16px;">Labels</div>
            <div id="sidebar-labels"></div>
            <button class="nav-item" onclick="App.addLabel()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              Add Label
            </button>

            <div class="nav-section-label" style="margin-top:16px;">Project Groups</div>
            <div id="sidebar-project-groups"></div>
            <button class="nav-item" onclick="App.addProjectGroup()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20"/></svg>
              Add Project Group
            </button>

            <div class="nav-section-label" style="margin-top:16px;">Projects</div>
            <div id="sidebar-groups"></div>
            <button class="nav-item" onclick="App.addGroup()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              Add Project
            </button>

            <div class="nav-section-label" style="margin-top:16px;">Phases</div>
            <div id="sidebar-pipelines"></div>
            <button class="nav-item" onclick="App.addPipeline()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Add Phase
            </button>
          </nav>
          <div class="sidebar-footer">
            <div id="save-status" style="width:100%;padding:4px 0;font-size:10px;color:var(--text-muted);text-align:center;">
              ${Store.hasFileSystemAccess()
                ? (Store.getFileHandle()
                  ? '<span style="color:var(--accent);">● Auto-saving to file</span>'
                  : 'Saving to browser storage')
                : '<span title="Open via localhost for file save-back">Saving to browser storage only</span>'}
            </div>
            <button onclick="App.toggleTheme()" title="Toggle theme">
              <svg id="theme-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
              Theme
            </button>
            <button onclick="Store.exportJSON()" title="Export JSON">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              JSON
            </button>
            <button onclick="Store.exportCSV()" title="Export CSV">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2M8 17h2M12 13h4M12 17h4"/></svg>
              CSV
            </button>
            <button onclick="App.importFile()" title="Import JSON">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              Import
            </button>
            <button onclick="App.closeProject()" title="Save & Close Project">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Close
            </button>
          </div>
        </aside>

        <!-- Main -->
        <main class="main-content">
          <header class="main-header">
            <h1 class="header-title" id="view-title">Project</h1>
            <div class="header-actions">
              <div class="search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input type="text" id="search-input" placeholder="Search tasks..." oninput="App.onSearch(this.value)" />
              </div>
              <div class="dropdown">
                <button class="btn btn-secondary" onclick="App.toggleFilterMenu()">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  Filter
                </button>
                <div class="dropdown-menu" id="filter-menu">
                  <div style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">Priority</div>
                  <button class="dropdown-item" onclick="App.setFilter('priority','urgent')">Urgent</button>
                  <button class="dropdown-item" onclick="App.setFilter('priority','high')">High</button>
                  <button class="dropdown-item" onclick="App.setFilter('priority','medium')">Medium</button>
                  <button class="dropdown-item" onclick="App.setFilter('priority','low')">Low</button>
                  <div class="dropdown-divider"></div>
                  <div style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">Assignee</div>
                  ${Store.getMembers().map(m => `<button class="dropdown-item" onclick="App.setFilter('assignee','${m.id}')">
                    <span style="width:8px;height:8px;border-radius:50%;background:${m.color};display:inline-block;"></span>
                    ${esc(m.name)}
                  </button>`).join('')}
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item" onclick="App.clearFilters()" style="color:var(--accent);">Clear Filters</button>
                </div>
              </div>
            </div>
          </header>

          <div class="view-container" id="view-container"></div>
        </main>
      </div>

      <!-- Slide Panel -->
      <div class="panel-overlay" id="panel-overlay"></div>
      <div class="slide-panel" id="task-panel"></div>

      <!-- Toast Container -->
      <div class="toast-container" id="toast-container"></div>

      <!-- Hidden file input -->
      <input type="file" id="import-file-input" accept=".json" style="display:none" />
    `;

    // Initialize views
    const viewContainer = document.getElementById('view-container');
    BoardView.init(viewContainer);
    ProjectView.init(viewContainer);
    TaskPanel.init();

    renderSidebarLists();
    switchView(currentView);

    // Import file handler
    document.getElementById('import-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          await Store.loadFromFile(file);
          showApp();
          toast('Project loaded', 'success');
        } catch (err) {
          toast('Invalid file: ' + err.message, 'error');
        }
      }
    });
  }

  function renderSidebarLists() {
    // Members
    const membersEl = document.getElementById('sidebar-members');
    if (membersEl) {
      membersEl.innerHTML = Store.getMembers().map(m => `
        <div class="nav-item" style="cursor:pointer;" onclick="App.setFilter('assignee','${m.id}')">
          <span style="width:20px;height:20px;border-radius:50%;background:${m.color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:white;">${initials(m.name)}</span>
          ${esc(m.name)}
          <button class="btn-icon sidebar-remove" onclick="event.stopPropagation();App.removeMember('${m.id}')" title="Remove member">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>`).join('');
    }

    // Labels
    const labelsEl = document.getElementById('sidebar-labels');
    if (labelsEl) {
      labelsEl.innerHTML = Store.getLabels().map(l => `
        <div class="nav-item" style="cursor:pointer;" onclick="App.setFilter('label','${l.id}')">
          <span style="width:10px;height:10px;border-radius:50%;background:${l.color};flex-shrink:0;"></span>
          ${esc(l.name)}
          <button class="btn-icon sidebar-remove" onclick="event.stopPropagation();App.removeLabel('${l.id}')" title="Remove label">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>`).join('');
    }

    // Project Groups
    const pgEl = document.getElementById('sidebar-project-groups');
    if (pgEl) {
      pgEl.innerHTML = Store.getProjectGroups().map(pg => {
        const visible = ProjectView.isProjectGroupVisible(pg.id);
        return `<div class="nav-item" style="cursor:pointer;">
          <span style="width:10px;height:10px;border-radius:3px;background:${pg.color};flex-shrink:0;"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pg.name)}</span>
          <button class="btn-icon sidebar-eye" onclick="event.stopPropagation();App.toggleProjectGroupVisibility('${pg.id}')" title="${visible ? 'Hide in project view' : 'Show in project view'}" style="flex-shrink:0;opacity:${visible ? '0.7' : '0.3'};">
            ${visible
              ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
              : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            }
          </button>
          <button class="btn-icon sidebar-remove" onclick="event.stopPropagation();App.removeProjectGroup('${pg.id}')" title="Remove project group" style="flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>`;
      }).join('');
    }

    // Groups (Projects)
    const groupsEl = document.getElementById('sidebar-groups');
    if (groupsEl) {
      groupsEl.innerHTML = Store.getGroups().map(g => {
        const pg = g.projectGroupId ? Store.getProjectGroup(g.projectGroupId) : null;
        return `<div class="nav-item" style="cursor:pointer;">
          <span style="width:10px;height:10px;border-radius:3px;background:${g.color};flex-shrink:0;"></span>
          ${esc(g.name)}
          ${pg ? `<span class="text-sm text-muted" style="margin-left:auto;font-size:10px;">${esc(pg.name)}</span>` : ''}
          <span class="badge" style="${pg ? '' : 'margin-left:auto;'}">${g.taskIds.length}</span>
          <button class="btn-icon sidebar-remove" onclick="event.stopPropagation();App.removeGroup('${g.id}')" title="Remove project">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>`;
      }).join('');
    }

    // Pipelines
    const pipEl = document.getElementById('sidebar-pipelines');
    if (pipEl) {
      pipEl.innerHTML = Store.getPipelines().map(p => `
        <div class="nav-item" style="cursor:pointer;" onclick="App.editPipeline('${p.id}')">
          <span style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0;"></span>
          ${esc(p.name)}
          <span class="badge" style="margin-left:auto;">${p.stages.length}</span>
          <button class="btn-icon sidebar-remove" onclick="event.stopPropagation();App.removePipeline('${p.id}')" title="Remove phase">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>`).join('');
    }
  }

  function switchView(view) {
    currentView = view;
    // Update nav
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
    // Update title
    const titles = { board: 'Board', project: 'Project Overview' };
    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = titles[view] || view;
    refreshView();
  }

  function refreshView() {
    switch (currentView) {
      case 'board': BoardView.render(filters); break;
      case 'project': ProjectView.render(filters); break;
    }
    renderSidebarLists();
  }

  function getFilters() { return filters; }

  function onSearch(q) {
    filters.search = q || '';
    refreshView();
  }

  function setFilter(key, val) {
    filters[key] = val;
    closeFilterMenu();
    refreshView();
    toast(`Filtered by ${key}: ${val}`, 'info');
  }

  function clearFilters() {
    filters = {};
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    closeFilterMenu();
    refreshView();
    toast('Filters cleared', 'info');
  }

  function toggleFilterMenu() {
    const menu = document.getElementById('filter-menu');
    if (menu) menu.classList.toggle('open');
  }

  function closeFilterMenu() {
    const menu = document.getElementById('filter-menu');
    if (menu) menu.classList.remove('open');
  }

  async function quickAddTask() {
    const result = await Modal.show({
      title: 'New Task',
      fields: [
        { type: 'text', key: 'title', label: 'Title', placeholder: 'Enter task title...', autofocus: true },
        { type: 'textarea', key: 'description', label: 'Description', placeholder: 'Optional description...' },
        { type: 'select', key: 'priority', label: 'Priority', value: 'medium', options: [
          { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
        ]},
        { type: 'select', key: 'bucketId', label: 'Bucket', value: Store.getBuckets()[0]?.id || '',
          options: Store.getBuckets().map(b => ({ value: b.id, label: b.name })) },
      ],
      confirmText: 'Create Task'
    });
    if (!result || !result.title) return;
    Store.addTask(result);
    refreshView();
    toast('Task created', 'success');
  }

  async function editProjectTitle() {
    const data = Store.getData();
    const result = await Modal.show({
      title: 'Edit Project Title',
      fields: [{ type: 'text', key: 'title', label: 'Project Title', value: data.meta.title, autofocus: true }],
      confirmText: 'Save'
    });
    if (!result || !result.title) return;
    data.meta.title = result.title;
    const el = document.getElementById('project-title');
    if (el) el.textContent = result.title;
    Store.emit('dataUpdated');
  }

  async function addMember() {
    const result = await Modal.show({
      title: 'Add Team Member',
      fields: [
        { type: 'text', key: 'name', label: 'Name', placeholder: 'Enter member name...', autofocus: true },
      ],
      confirmText: 'Add Member'
    });
    if (!result || !result.name) return;
    Store.addMember(result.name);
    renderSidebarLists();
    toast('Member added', 'success');
  }

  async function addLabel() {
    const result = await Modal.show({
      title: 'Add Label',
      fields: [
        { type: 'text', key: 'name', label: 'Label Name', placeholder: 'e.g. Bug, Feature, Urgent...', autofocus: true },
        { type: 'color-picker', key: 'color', label: 'Color', value: '#3b82f6' },
      ],
      confirmText: 'Add Label'
    });
    if (!result || !result.name) return;
    Store.addLabel(result.name, result.color || '#3b82f6');
    renderSidebarLists();
    toast('Label added', 'success');
  }

  async function addProjectGroup() {
    const result = await Modal.show({
      title: 'Add Project Group',
      fields: [
        { type: 'text', key: 'name', label: 'Project Group Name', placeholder: 'e.g. Platform Initiatives, Compliance...', autofocus: true },
      ],
      confirmText: 'Add Project Group'
    });
    if (!result || !result.name) return;
    Store.addProjectGroup(result.name);
    renderSidebarLists();
    toast('Project group added', 'success');
  }

  async function addGroup() {
    const pgOptions = [{ value: '', label: 'None' }, ...Store.getProjectGroups().map(pg => ({ value: pg.id, label: pg.name }))];
    const result = await Modal.show({
      title: 'Add Project',
      fields: [
        { type: 'text', key: 'name', label: 'Project Name', placeholder: 'e.g. Dashboard Redesign, Mobile App...', autofocus: true },
        { type: 'select', key: 'projectGroupId', label: 'Project Group', value: '', options: pgOptions },
      ],
      confirmText: 'Add Project'
    });
    if (!result || !result.name) return;
    const group = Store.addGroup(result.name);
    if (result.projectGroupId) {
      Store.updateGroup(group.id, { projectGroupId: result.projectGroupId });
    }
    renderSidebarLists();
    toast('Project added', 'success');
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
  }

  function setTheme(t) {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('planner_theme', t);
  }

  async function openFile() {
    // Prefer File System Access API (gives us a handle for save-back)
    if (Store.hasFileSystemAccess()) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        await Store.loadFromHandle(handle);
        showApp();
        toast('Project loaded', 'success');
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled
        console.warn('File picker failed, falling back:', e);
      }
    }
    // Fallback to file input (file:// or unsupported browser)
    const input = document.getElementById('file-input') || document.getElementById('import-file-input');
    if (input) input.click();
  }

  async function importFile() {
    return openFile();
  }

  async function loadSample() {
    try {
      const resp = await fetch('data/sample-project.json');
      const json = await resp.json();
      Store.load(json);
      showApp();
      toast('Sample project loaded!', 'success');
    } catch (e) {
      toast('Failed to load sample: ' + e.message, 'error');
    }
  }

  async function newProject() {
    const result = await Modal.show({
      title: 'New Project',
      fields: [
        { type: 'text', key: 'title', label: 'Project Name', value: 'My Project', placeholder: 'Enter project name...', autofocus: true },
      ],
      confirmText: 'Create Project'
    });
    if (!result || !result.title) return;
    Store.createEmpty(result.title);
    showApp();
    toast('New project created', 'success');
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    // Try to get a file handle from the drop (requires secure context)
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    if (Store.hasFileSystemAccess() && item && item.kind === 'file' && item.getAsFileSystemHandle) {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle && handle.kind === 'file' && handle.name.endsWith('.json')) {
          await Store.loadFromHandle(handle);
          showApp();
          toast('Project loaded', 'success');
          return;
        }
      } catch (err) {
        console.warn('Drop handle failed, falling back:', err);
      }
    }
    // Fallback: plain File object (no save-back support)
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      try {
        await Store.loadFromFile(file);
        showApp();
        toast('Project loaded (save-back unavailable — use Import to enable)', 'info');
      } catch (err) {
        toast('Invalid file: ' + err.message, 'error');
      }
    }
  }

  async function removeMember(id) {
    const member = Store.getMember(id);
    if (!member) return;
    const confirmed = await Modal.confirm({
      title: 'Remove Member',
      message: `Remove "${member.name}" from the project? They will be unassigned from all tasks.`,
      confirmText: 'Remove',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    Store.deleteMember(id);
    toast('Member removed', 'success');
  }

  async function removeLabel(id) {
    const label = Store.getLabel(id);
    if (!label) return;
    const confirmed = await Modal.confirm({
      title: 'Remove Label',
      message: `Remove the "${label.name}" label? It will be removed from all tasks.`,
      confirmText: 'Remove',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    Store.deleteLabel(id);
    toast('Label removed', 'success');
  }

  async function removeProjectGroup(id) {
    const pg = Store.getProjectGroup(id);
    if (!pg) return;
    const confirmed = await Modal.confirm({
      title: 'Remove Project Group',
      message: `Remove the "${pg.name}" project group? Projects within it will be ungrouped.`,
      confirmText: 'Remove',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    Store.deleteProjectGroup(id);
    toast('Project group removed', 'success');
  }

  async function removeGroup(id) {
    const group = Store.getGroup(id);
    if (!group) return;
    const confirmed = await Modal.confirm({
      title: 'Remove Project',
      message: `Remove the "${group.name}" project? Tasks within it will remain but will no longer be grouped.`,
      confirmText: 'Remove',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    Store.deleteGroup(id);
    toast('Project removed', 'success');
  }

  async function addPipeline() {
    const result = await Modal.show({
      title: 'Add Phase',
      fields: [
        { type: 'text', key: 'name', label: 'Phase Name', placeholder: 'e.g. Development', autofocus: true },
        { type: 'text', key: 'stages', label: 'Stages (comma-separated)', placeholder: 'e.g. Scoping, Build, Review, Done' }
      ],
      confirmText: 'Add Phase'
    });
    if (!result || !result.name) return;
    const stages = (result.stages || '').split(',').map(s => s.trim()).filter(Boolean);
    Store.addPipeline(result.name, stages.length > 0 ? stages : undefined);
    toast('Phase added', 'success');
  }

  async function editPipeline(id) {
    const pipeline = Store.getPipeline(id);
    if (!pipeline) return;
    const result = await Modal.show({
      title: 'Edit Phase',
      fields: [
        { type: 'text', key: 'name', label: 'Phase Name', value: pipeline.name, autofocus: true },
        { type: 'text', key: 'stages', label: 'Stages (comma-separated)', value: pipeline.stages.join(', ') }
      ],
      confirmText: 'Save Changes'
    });
    if (!result || !result.name) return;
    const stages = (result.stages || '').split(',').map(s => s.trim()).filter(Boolean);
    Store.updatePipeline(id, { name: result.name, stages });
    toast('Phase updated', 'success');
  }

  function toggleProjectGroupVisibility(pgId) {
    ProjectView.toggleProjectGroupVisibility(pgId);
    renderSidebarLists();
  }

  async function removePipeline(id) {
    const pipeline = Store.getPipeline(id);
    if (!pipeline) return;
    const confirmed = await Modal.confirm({
      title: 'Remove Phase',
      message: `Remove the "${pipeline.name}" phase? Tasks using it will have their phase cleared.`,
      confirmText: 'Remove',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    Store.deletePipeline(id);
    toast('Phase removed', 'success');
  }

  async function closeProject() {
    const canSaveBack = Store.hasFileSystemAccess() && !!Store.getFileHandle();
    const canSaveAs = Store.hasFileSystemAccess();

    let message, confirmText;
    if (canSaveBack) {
      message = 'Save changes to the original file and return to the welcome screen?';
      confirmText = 'Save & Close';
    } else if (canSaveAs) {
      message = 'Choose a location to save the project, then return to the welcome screen.';
      confirmText = 'Save As & Close';
    } else {
      message = 'Download the project as a JSON file and return to the welcome screen? Your data is also saved in the browser automatically.';
      confirmText = 'Download & Close';
    }

    const confirmed = await Modal.confirm({ title: 'Close Project', message, confirmText, confirmClass: 'btn-primary' });
    if (!confirmed) return;

    if (canSaveBack) {
      const saved = await Store.saveToFile();
      if (!saved) {
        toast('Save failed — downloading instead', 'error');
        Store.exportJSON();
      }
    } else if (canSaveAs) {
      const saved = await Store.saveToFileAs();
      if (!saved) return; // user cancelled
    } else {
      Store.exportJSON();
    }

    Store.clearFileHandle();
    localStorage.removeItem('planner_project_data');
    showWelcome();
    toast('Project saved and closed', 'success');
  }

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      try {
        await Store.loadFromFile(file);
        showApp();
        toast('Project loaded', 'success');
      } catch (err) {
        toast('Invalid file: ' + err.message, 'error');
      }
    }
  }

  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(100%)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) closeFilterMenu();
  });

  return {
    init, switchView, refreshView, getFilters,
    onSearch, setFilter, clearFilters, toggleFilterMenu,
    quickAddTask, editProjectTitle,
    addMember, addLabel, addProjectGroup, addGroup, addPipeline,
    editPipeline, removePipeline, toggleProjectGroupVisibility,
    removeMember, removeLabel, removeProjectGroup, removeGroup,
    toggleTheme, openFile, importFile, loadSample, newProject,
    handleDrop, handleFileSelect, closeProject, toast
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
