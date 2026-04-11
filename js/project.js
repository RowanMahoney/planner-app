// project.js — Hierarchical project overview
// Level 1: Project Group  |  Level 2: Project (group)  |  Level 3: Phase  |  Level 4: Task

const ProjectView = (() => {
  let container = null;
  let cellWidth = 1.5;
  let collapsed = new Set(); // stores row ids like "pg_X", "proj_X", "phase_X_Dev"
  let defaultsApplied = false;
  let exporting = false;
  let timelineStartDate = null; // stored for drag calculations
  let projectFilter = new Set(); // empty = show all, or set of group ids to filter
  let hiddenProjectGroups = new Set(); // project group ids hidden via sidebar eye toggle
  let hiddenProjects = new Set(); // project (group) ids hidden via sidebar eye toggle
  let currentTotalDays = 365; // stored for fit-to-view calculation
  let needsFitToView = true; // auto-fit on first render
  let lastFilterKey = ''; // track filter changes for auto-fit

  const ZOOM_SLIDER_MIN = 0.8;  // most zoomed out
  const ZOOM_SLIDER_MAX = 50;   // most zoomed in

  const PHASE_COLORS = {
    'Development': '#4338ca',
    'Validation & Regulatory Approval': '#6366f1',
    'Implementation': '#a5b4fc',
    'Other': '#94a3b8'
  };
  const PHASE_ORDER = ['Development', 'Validation & Regulatory Approval', 'Implementation', 'Other'];

  let tooltipEl = null;
  let tooltipTimeout = null;

  function init(el) {
    container = el;
    // Create tooltip element once
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'task-tooltip';
      document.body.appendChild(tooltipEl);
    }
  }

  function showTaskTooltip(e, taskId) {
    const t = Store.getTask(taskId);
    if (!t || !tooltipEl) return;
    clearTimeout(tooltipTimeout);

    const phase = getTaskPhase(t);
    const color = PHASE_COLORS[phase];
    const pip = t.pipelineId ? Store.getPipeline(t.pipelineId) : null;
    const assignees = (t.assignees || []).map(id => Store.getMember(id)).filter(Boolean);
    const checkDone = t.checklist ? t.checklist.filter(c => c.checked).length : 0;
    const checkTotal = t.checklist ? t.checklist.length : 0;
    const priorityColors = { urgent: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' };

    let html = `<div class="task-tooltip-title">${esc(t.title)}</div>`;
    html += `<div class="task-tooltip-progress"><div class="task-tooltip-progress-fill" style="width:${t.progress}%;background:${color};"></div></div>`;
    html += `<div class="task-tooltip-rows" style="margin-top:8px;">`;
    html += `<div class="task-tooltip-row"><span class="tt-label">Progress</span><span class="tt-value">${t.progress}%</span></div>`;
    html += `<div class="task-tooltip-row"><span class="tt-label">Priority</span><span class="tt-value" style="color:${priorityColors[t.priority] || '#6b7280'};">${(t.priority || 'medium').charAt(0).toUpperCase() + (t.priority || 'medium').slice(1)}</span></div>`;
    if (t.startDate || t.dueDate) {
      const dates = [t.startDate, t.dueDate].filter(Boolean).join(' → ');
      html += `<div class="task-tooltip-row"><span class="tt-label">Dates</span><span class="tt-value">${dates}</span></div>`;
    }
    if (pip) {
      html += `<div class="task-tooltip-row"><span class="tt-label">Phase</span><span class="tt-value">${esc(pip.name)}</span></div>`;
      if (t.stage) html += `<div class="task-tooltip-row"><span class="tt-label">Stage</span><span class="tt-value">${esc(t.stage)}</span></div>`;
    }
    html += `</div>`;

    if (checkTotal > 0) {
      html += `<div class="task-tooltip-divider"></div>`;
      html += `<div class="task-tooltip-checklist"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span class="done">${checkDone}</span>/<span>${checkTotal}</span> complete</div>`;
      html += `<div class="task-tooltip-checklist-items">`;
      t.checklist.forEach(item => {
        const checked = item.checked;
        html += `<div class="tt-check-item ${checked ? 'tt-checked' : ''}">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">${checked ? '<path d="M20 6L9 17l-5-5"/>' : '<rect x="3" y="3" width="18" height="18" rx="2"/>'}</svg>
          <span>${esc(item.text)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (assignees.length > 0) {
      html += `<div class="task-tooltip-divider"></div>`;
      html += `<div class="task-tooltip-assignees">`;
      assignees.forEach(m => {
        html += `<span class="task-tooltip-assignee"><span class="dot" style="background:${m.color};"></span>${esc(m.name)}</span>`;
      });
      html += `</div>`;
    }

    tooltipEl.innerHTML = html;
    positionTooltip(e);
    tooltipTimeout = setTimeout(() => tooltipEl.classList.add('visible'), 10);
  }

  function positionTooltip(e) {
    if (!tooltipEl) return;
    const pad = 12;
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';
    tooltipEl.style.display = 'block';
    const rect = tooltipEl.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rect.width > window.innerWidth - pad) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = e.clientY - rect.height - pad;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }

  function moveTaskTooltip(e) {
    if (tooltipEl && tooltipEl.classList.contains('visible')) positionTooltip(e);
  }

  function hideTaskTooltip() {
    clearTimeout(tooltipTimeout);
    if (tooltipEl) {
      tooltipEl.classList.remove('visible');
      tooltipEl.style.display = 'none';
    }
  }

  // ── Determine which phase a task belongs to ──
  function getTaskPhase(task) {
    if (!task.pipelineId) return 'Other';
    const p = Store.getPipeline(task.pipelineId);
    if (!p) return 'Other';
    const pn = p.name.toLowerCase();
    if (pn.includes('development')) return 'Development';
    if (pn.includes('validation') || pn.includes('regulatory')) return 'Validation & Regulatory Approval';
    if (pn.includes('implementation')) return 'Implementation';
    if (task.stage) {
      const sn = task.stage.toLowerCase();
      if (sn.includes('development') || sn.includes('dev')) return 'Development';
      if (sn.includes('validation') || sn.includes('regulatory') || sn.includes('apra')) return 'Validation & Regulatory Approval';
      if (sn.includes('implementation') || sn.includes('go-live') || sn.includes('uat')) return 'Implementation';
    }
    return 'Other';
  }

  // ── Compute date range for a set of tasks ──
  function dateRange(tasks) {
    let s = null, e = null;
    tasks.forEach(t => {
      if (t.startDate) { const d = new Date(t.startDate + 'T00:00:00'); if (!s || d < s) s = d; }
      const end = t.dueDate || t.startDate;
      if (end) { const d = new Date(end + 'T00:00:00'); if (!e || d > e) e = d; }
    });
    return { start: s, end: e };
  }

  // ── Compute phase date ranges for a set of tasks ──
  // Returns ordered array of { phase, start, end } with each phase extending to next phase's start
  function computePhaseRanges(tasks) {
    const pipelines = Store.getPipelines();
    const pipMap = new Map(); // pipId -> { pip, start, end }

    tasks.forEach(t => {
      const pipId = t.pipelineId || '__none__';
      if (!pipMap.has(pipId)) pipMap.set(pipId, { start: null, end: null });
      const entry = pipMap.get(pipId);
      if (t.startDate) {
        const s = new Date(t.startDate + 'T00:00:00');
        if (!entry.start || s < entry.start) entry.start = s;
      }
      const ed = t.dueDate || t.startDate;
      if (ed) {
        const e = new Date(ed + 'T00:00:00');
        if (!entry.end || e > entry.end) entry.end = e;
      }
    });

    // Build ordered ranges: known-phase pipelines first, then custom, then no-pipeline
    const ranges = [];
    const addedPipIds = new Set();

    // Known phases first (in PHASE_ORDER)
    PHASE_ORDER.forEach(phase => {
      pipelines.forEach(pip => {
        if (addedPipIds.has(pip.id)) return;
        const derived = getPipelinePhase(pip);
        if (derived !== phase) return;
        const entry = pipMap.get(pip.id);
        if (!entry || !entry.start) return;
        addedPipIds.add(pip.id);
        ranges.push({ phase: pip.name, start: entry.start, end: entry.end, color: PHASE_COLORS[derived] || pip.color || '#94a3b8' });
      });
    });

    // Custom pipelines (not matching any known phase)
    pipelines.forEach(pip => {
      if (addedPipIds.has(pip.id)) return;
      const entry = pipMap.get(pip.id);
      if (!entry || !entry.start) return;
      addedPipIds.add(pip.id);
      ranges.push({ phase: pip.name, start: entry.start, end: entry.end, color: '#94a3b8' });
    });

    // No-pipeline tasks
    const noneEntry = pipMap.get('__none__');
    if (noneEntry && noneEntry.start) {
      ranges.push({ phase: 'Other', start: noneEntry.start, end: noneEntry.end, color: PHASE_COLORS['Other'] });
    }

    // Sort by start date
    ranges.sort((a, b) => a.start - b.start);

    // Extend each range's end to meet the next range's start (fill gaps)
    for (let i = 0; i < ranges.length - 1; i++) {
      if (ranges[i].end < ranges[i + 1].start) {
        ranges[i].end = ranges[i + 1].start;
      }
    }
    return ranges;
  }

  function buildExportLegend() {
    const pipelines = Store.getPipelines();
    const items = [];
    const added = new Set();
    PHASE_ORDER.filter(p => p !== 'Other').forEach(phase => {
      pipelines.forEach(pip => {
        if (added.has(pip.id)) return;
        if (getPipelinePhase(pip) === phase) {
          added.add(pip.id);
          items.push(`<span><span class="dot" style="background:${PHASE_COLORS[phase]}"></span>${esc(pip.name)}</span>`);
        }
      });
    });
    // VA badge legend entry
    items.push(`<span><span class="dot" style="background:#ef4444;border-radius:3px;"></span>Validation Action</span>`);
    return items.join('');
  }

  function buildLegendItems() {
    const pipelines = Store.getPipelines();
    const items = [];
    const added = new Set();
    PHASE_ORDER.filter(p => p !== 'Other').forEach(phase => {
      pipelines.forEach(pip => {
        if (added.has(pip.id)) return;
        if (getPipelinePhase(pip) === phase) {
          added.add(pip.id);
          items.push(`<span class="legend-item"><span class="legend-dot" style="background:${PHASE_COLORS[phase]}"></span>${esc(pip.name)}</span>`);
        }
      });
    });
    return items.join('');
  }

  // ── Count unique assignees across tasks ──
  function countAssignees(tasks) {
    const ids = new Set();
    tasks.forEach(t => (t.assignees || []).forEach(a => ids.add(a)));
    return ids.size;
  }

  // ── Build the 4-level row tree ──
  function buildRows(tasks) {
    const projectGroups = Store.getProjectGroups();
    const groups = Store.getGroups();
    const rows = [];

    // Apply project filter — only include matching groups
    const filteredGroups = projectFilter.size > 0
      ? groups.filter(g => projectFilter.has(g.id))
      : groups;

    // Bucket groups by projectGroupId
    const pgMap = new Map(); // pgId -> [group, ...]
    filteredGroups.forEach(g => {
      const pgId = g.projectGroupId || '__ungrouped_pg__';
      if (!pgMap.has(pgId)) pgMap.set(pgId, []);
      pgMap.get(pgId).push(g);
    });

    // Known project groups first
    const renderedPgIds = new Set();
    projectGroups.forEach(pg => {
      if (hiddenProjectGroups.has(pg.id)) { renderedPgIds.add(pg.id); return; }
      const pgGroups = pgMap.get(pg.id) || [];
      if (projectFilter.size > 0 && pgGroups.length === 0) return; // skip empty PGs when filtering
      renderedPgIds.add(pg.id);
      addProjectGroupRows(rows, pg.id, pg.name, pg.color, pgGroups, tasks);
    });

    // Ungrouped project groups (groups without a projectGroupId)
    const ungroupedGroups = pgMap.get('__ungrouped_pg__') || [];
    // Also include any pgIds that don't match a real project group
    pgMap.forEach((grps, pgId) => {
      if (pgId === '__ungrouped_pg__' || renderedPgIds.has(pgId)) return;
      ungroupedGroups.push(...grps);
    });

    if (ungroupedGroups.length > 0) {
      addProjectGroupRows(rows, '__ungrouped_pg__', 'Ungrouped Projects', '#94a3b8', ungroupedGroups, tasks);
    }

    // Tasks not in any group (skip when filtering to a specific project)
    if (projectFilter.size === 0) {
      const allGroupedTaskIds = new Set(groups.flatMap(g => g.taskIds));
      const orphanTasks = tasks.filter(t => !allGroupedTaskIds.has(t.id));
      if (orphanTasks.length > 0) {
        const range = dateRange(orphanTasks);
        const phaseCounts = countPhases(orphanTasks);
        const orphanVa = collectValidationActions(orphanTasks);
        const orphanPhaseRanges = computePhaseRanges(orphanTasks);
        const orphanAssignees = countAssignees(orphanTasks);
        rows.push({ level: 2, type: 'project', id: '__orphan__', name: 'Unassigned Tasks', color: '#64748b', count: orphanTasks.length, ...range, phaseRanges: orphanPhaseRanges, phaseCounts, validationActions: orphanVa, assigneeCount: orphanAssignees });
        if (!collapsed.has('proj___orphan__')) {
          addPhaseRows(rows, '__orphan__', orphanTasks);
        }
      }
    }

    return rows;
  }

  function addProjectGroupRows(rows, pgId, pgName, pgColor, pgGroups, allTasks) {
    // Collect all tasks across all groups in this project group
    const pgTaskIds = new Set(pgGroups.flatMap(g => g.taskIds));
    const pgTasks = allTasks.filter(t => pgTaskIds.has(t.id));

    const range = dateRange(pgTasks);
    const phaseCounts = countPhases(pgTasks);
    const vaActions = collectValidationActions(pgTasks);
    const pgAssignees = countAssignees(pgTasks);
    rows.push({ level: 1, type: 'project-group', id: pgId, name: pgName, color: pgColor, count: pgTasks.length, ...range, phaseCounts, validationActions: vaActions, assigneeCount: pgAssignees });

    if (collapsed.has('pg_' + pgId)) return;

    pgGroups.forEach(g => {
      if (hiddenProjects.has(g.id)) return;
      const gTasks = allTasks.filter(t => g.taskIds.includes(t.id) && t.startDate);
      const range = dateRange(gTasks);
      const phaseCounts = countPhases(gTasks);
      const gVaActions = collectValidationActions(gTasks);
      const gPhaseRanges = computePhaseRanges(gTasks);
      const gAssignees = countAssignees(gTasks);
      rows.push({ level: 2, type: 'project', id: g.id, name: g.name, color: g.color, count: gTasks.length, ...range, phaseRanges: gPhaseRanges, phaseCounts, validationActions: gVaActions, assigneeCount: gAssignees });

      if (!collapsed.has('proj_' + g.id)) {
        addPhaseRows(rows, g.id, gTasks);
      }
    });
  }

  function addPhaseRows(rows, projId, tasks) {
    // Group tasks by pipeline
    const pipelines = Store.getPipelines();
    const pipelineMap = new Map(); // pipelineId -> tasks
    const noPipelineTasks = [];

    tasks.forEach(t => {
      if (t.pipelineId) {
        if (!pipelineMap.has(t.pipelineId)) pipelineMap.set(t.pipelineId, []);
        pipelineMap.get(t.pipelineId).push(t);
      } else {
        noPipelineTasks.push(t);
      }
    });

    // Render pipelines in a stable order: known phase pipelines first, then others
    const renderedPipIds = new Set();

    // First pass: pipelines that match PHASE_ORDER (existing coloured ones)
    PHASE_ORDER.forEach(phase => {
      pipelines.forEach(pip => {
        if (renderedPipIds.has(pip.id)) return;
        const derivedPhase = getPipelinePhase(pip);
        if (derivedPhase !== phase) return;
        const pipTasks = pipelineMap.get(pip.id) || [];
        if (pipTasks.length === 0) return;
        renderedPipIds.add(pip.id);
        addPipelineRows(rows, projId, pip, pipTasks, PHASE_COLORS[derivedPhase] || pip.color || '#94a3b8');
      });
    });

    // Second pass: pipelines not matching any known phase (new/custom ones)
    pipelines.forEach(pip => {
      if (renderedPipIds.has(pip.id)) return;
      const pipTasks = pipelineMap.get(pip.id) || [];
      if (pipTasks.length === 0) return;
      renderedPipIds.add(pip.id);
      addPipelineRows(rows, projId, pip, pipTasks, '#94a3b8');
    });

    // Tasks with no pipeline
    if (noPipelineTasks.length > 0) {
      const phaseId = projId + '_Other';
      const range = dateRange(noPipelineTasks);
      const va = collectValidationActions(noPipelineTasks);
      const ac = countAssignees(noPipelineTasks);
      rows.push({ level: 3, type: 'phase', id: phaseId, projId, phaseName: 'Other', name: 'Other', color: PHASE_COLORS['Other'], count: noPipelineTasks.length, ...range, validationActions: va, assigneeCount: ac });
      if (!collapsed.has('phase_' + phaseId)) {
        noPipelineTasks.forEach(t => rows.push({ level: 5, type: 'task', task: t }));
      }
    }
  }

  // Determine which known phase a pipeline maps to (for colour)
  function getPipelinePhase(pip) {
    const pn = pip.name.toLowerCase();
    if (pn.includes('development')) return 'Development';
    if (pn.includes('validation') || pn.includes('regulatory')) return 'Validation & Regulatory Approval';
    if (pn.includes('implementation')) return 'Implementation';
    return null;
  }

  function addPipelineRows(rows, projId, pip, pipTasks, color) {
    const phaseId = projId + '_pip_' + pip.id;
    const range = dateRange(pipTasks);
    const va = collectValidationActions(pipTasks);
    const ac = countAssignees(pipTasks);
    rows.push({ level: 3, type: 'phase', id: phaseId, projId, phaseName: pip.name, name: pip.name, color, count: pipTasks.length, ...range, validationActions: va, assigneeCount: ac });

    if (collapsed.has('phase_' + phaseId)) return;

    // Group tasks by stage within this pipeline
    const stages = pip.stages || [];
    const stageMap = new Map();
    const unstagedTasks = [];

    pipTasks.forEach(t => {
      if (t.stage && stages.includes(t.stage)) {
        if (!stageMap.has(t.stage)) stageMap.set(t.stage, []);
        stageMap.get(t.stage).push(t);
      } else {
        unstagedTasks.push(t);
      }
    });

    // If there are stages with tasks, show stage sub-groups
    const hasStageGrouping = stages.some(s => (stageMap.get(s) || []).length > 0);

    if (hasStageGrouping) {
      stages.forEach(stage => {
        const stageTasks = stageMap.get(stage) || [];
        if (stageTasks.length === 0) return;
        const stageId = phaseId + '_' + stage;
        const sRange = dateRange(stageTasks);
        const sVa = collectValidationActions(stageTasks);
        const sAc = countAssignees(stageTasks);
        rows.push({ level: 4, type: 'stage', id: stageId, projId, pipelineId: pip.id, stageName: stage, name: stage, color, count: stageTasks.length, ...sRange, validationActions: sVa, assigneeCount: sAc });
        if (!collapsed.has('phase_' + stageId)) {
          stageTasks.forEach(t => rows.push({ level: 5, type: 'task', task: t }));
        }
      });
      // Unstaged tasks at the end — give them a collapsible "Unstaged" group
      if (unstagedTasks.length > 0) {
        const usId = phaseId + '_Unstaged';
        const usRange = dateRange(unstagedTasks);
        const usVa = collectValidationActions(unstagedTasks);
        const usAc = countAssignees(unstagedTasks);
        rows.push({ level: 4, type: 'stage', id: usId, projId, pipelineId: pip.id, stageName: '(Unstaged)', name: '(Unstaged)', color, count: unstagedTasks.length, ...usRange, validationActions: usVa, assigneeCount: usAc });
        if (!collapsed.has('phase_' + usId)) {
          unstagedTasks.forEach(t => rows.push({ level: 5, type: 'task', task: t }));
        }
      }
    } else {
      // No stage grouping — just show tasks directly
      pipTasks.forEach(t => rows.push({ level: 5, type: 'task', task: t }));
    }
  }

  function countPhases(tasks) {
    const counts = {};
    tasks.forEach(t => { const p = getTaskPhase(t); counts[p] = (counts[p] || 0) + 1; });
    return counts;
  }

  function collectValidationActions(tasks) {
    const actions = [];
    tasks.forEach(t => {
      (t.validationActions || []).forEach(va => actions.push(va));
    });
    return actions;
  }

  // ── Main render ──
  function render(filters = {}) {
    // Auto-fit when filters change
    const filterKey = JSON.stringify(filters) + '|' + [...projectFilter].join(',');
    if (filterKey !== lastFilterKey) {
      if (lastFilterKey !== '') needsFitToView = true; // skip on very first call
      lastFilterKey = filterKey;
    }

    // Apply default collapsed-to-projects on first render
    if (!defaultsApplied) {
      defaultsApplied = true;
      const groups = Store.getGroups();
      groups.forEach(g => collapsed.add('proj_' + g.id));
      collapsed.add('proj___orphan__');
    }

    let tasks = filters.search || filters.assignee || filters.label || filters.priority
      ? Store.filterTasks(filters) : Store.getTasks();
    tasks = tasks.filter(t => t.startDate);

    // Date range with padding
    const allDates = [];
    tasks.forEach(t => {
      if (t.startDate) allDates.push(new Date(t.startDate + 'T00:00:00'));
      if (t.dueDate) allDates.push(new Date(t.dueDate + 'T00:00:00'));
    });
    if (allDates.length === 0) allDates.push(new Date());

    let minDate = new Date(Math.min(...allDates));
    let maxDate = new Date(Math.max(...allDates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);
    // Snap to Monday
    const dow = minDate.getDay();
    minDate.setDate(minDate.getDate() - (dow === 0 ? 6 : dow - 1));
    const totalDays = Math.max(30, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
    currentTotalDays = totalDays;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    timelineStartDate = new Date(minDate);

    // Auto-fit to viewport on first render
    if (needsFitToView) {
      needsFitToView = false;
      const availableWidth = (container ? container.clientWidth : window.innerWidth) - 340;
      if (availableWidth > 0 && totalDays > 0) {
        cellWidth = Math.max(ZOOM_SLIDER_MIN, Math.min(ZOOM_SLIDER_MAX, availableWidth / totalDays));
      }
    }

    const rows = buildRows(tasks);

    const html = `<div class="project-view">
      <div class="project-controls">
        <div class="pv-zoom-slider">
          <button class="pv-zoom-btn" onclick="ProjectView.stepZoom(-8)" title="Zoom out">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M8 11h6"/></svg>
          </button>
          <input type="range" min="0" max="100" value="${zoomToSlider(cellWidth)}" id="pv-zoom-range" oninput="ProjectView.onSliderZoom(this.value)" />
          <button class="pv-zoom-btn" onclick="ProjectView.stepZoom(8)" title="Zoom in">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M8 11h6M11 8v6"/></svg>
          </button>
        </div>
        <button class="gantt-today-btn" onclick="ProjectView.fitToView()" title="Fit timeline to screen">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>Fit
        </button>
        <button class="gantt-today-btn" onclick="ProjectView.collapseToProjects()">Projects</button>
        <button class="gantt-today-btn" onclick="ProjectView.collapseAll()">Collapse All</button>
        <button class="gantt-today-btn" onclick="ProjectView.expandAll()">Expand All</button>
        <button class="gantt-today-btn" onclick="ProjectView.exportView()" title="Export as printable HTML">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export
        </button>
        <div class="project-legend">
          ${buildLegendItems()}
        </div>
        <span class="text-sm text-muted ml-auto">${tasks.length} tasks</span>
      </div>
      <div class="gantt-wrapper">
        <div class="gantt-task-list" style="width:340px;min-width:340px;">
          <div class="gantt-task-list-header" style="justify-content:space-between;">
            Project Hierarchy
            <button class="btn-icon pv-add-btn" style="opacity:0.5;" onclick="App.addProjectGroup()" title="Add project group">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="gantt-task-list-body" id="project-task-list-body">
            ${rows.map(r => renderListRow(r)).join('')}
          </div>
        </div>
        <div class="gantt-timeline" id="project-timeline">
          <div class="gantt-timeline-header" style="width:${totalDays * cellWidth}px;">
            ${renderTimelineHeader(minDate, totalDays)}
          </div>
          <div class="gantt-timeline-body" id="project-timeline-body" style="width:${totalDays * cellWidth}px;position:relative;">
            ${renderWeekendColumns(minDate, totalDays)}
            ${renderFYLines(minDate, totalDays)}
            ${renderTodayLine(minDate, today, totalDays)}
            ${rows.map(r => renderTimelineRow(r, minDate)).join('')}
          </div>
        </div>
      </div>
    </div>`;

    // Save scroll positions before replacing DOM
    const prevTl = document.getElementById('project-timeline');
    const prevList = document.getElementById('project-task-list-body');
    const savedScrollLeft = prevTl ? prevTl.scrollLeft : 0;
    const savedScrollTop = prevTl ? prevTl.scrollTop : (prevList ? prevList.scrollTop : 0);

    container.innerHTML = html;
    setupScrollSync();

    // Restore scroll positions
    const tl = document.getElementById('project-timeline');
    const list = document.getElementById('project-task-list-body');
    if (tl) {
      tl.scrollLeft = savedScrollLeft;
      tl.scrollTop = savedScrollTop;
    }
    if (list) {
      list.scrollTop = savedScrollTop;
    }
  }

  // ── Row heights by level ──
  const ROW_H = { 1: 40, 2: 36, 3: 32, 4: 28, 5: 36 };
  const INDENT = { 1: 8, 2: 24, 3: 44, 4: 60, 5: 76 };

  // ── Left panel rows ──
  function renderListRow(row) {
    if (row.type === 'task') {
      const t = row.task;
      const phase = getTaskPhase(t);
      const pc = PHASE_COLORS[phase];
      const assignees = (t.assignees || []).map(id => Store.getMember(id)).filter(Boolean);
      const assigneeHtml = assignees.length > 0
        ? `<span class="pv-assignees">${assignees.map(m => `<span class="pv-avatar" style="background:${m.color};" title="${esc(m.name)}">${esc(m.name.charAt(0))}</span>`).join('')}</span>`
        : '';
      const taskLevel = row.level || 5;
      return `<div class="pv-row pv-level-${taskLevel}" style="height:${ROW_H[taskLevel]}px;padding-left:${INDENT[taskLevel]}px;" onmouseenter="ProjectView.showTaskTooltip(event,'${t.id}')" onmousemove="ProjectView.moveTaskTooltip(event)" onmouseleave="ProjectView.hideTaskTooltip()" onclick="TaskPanel.open('${t.id}')">
        <span class="priority-dot" style="background:${pc};"></span>
        <span class="task-name" ondblclick="ProjectView.editTaskTitle(event, '${t.id}')">${esc(t.title)}</span>
        ${assigneeHtml}
      </div>`;
    }

    const h = ROW_H[row.level];
    const indent = INDENT[row.level];
    const colKey = row.type === 'project-group' ? 'pg_' + row.id : row.type === 'project' ? 'proj_' + row.id : 'phase_' + row.id;
    const isCollapsed = collapsed.has(colKey);
    const levelClass = 'pv-level-' + row.level;
    const icon = exporting ? '' : (row.level <= 4 ? `<svg class="pv-chevron ${isCollapsed ? 'collapsed' : ''}" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>` : '');

    let badge = '';
    let staffBadge = '';
    let addBtn = '';
    // Staff allocation badge (shown on all summary rows)
    const ac = row.assigneeCount || 0;
    if (ac > 0) {
      staffBadge = `<span class="pv-staff-badge" style="margin-left:auto;flex-shrink:0;" title="${ac} staff allocated"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>${ac}</span>`;
    }
    if (exporting) {
      badge = '';
    } else if (row.type === 'phase' || row.type === 'stage') {
      badge = `<span class="project-phase-badge" style="background:${row.color}20;color:${row.color};border:1px solid ${row.color}40;">${row.count}</span>`;
    } else {
      badge = `<span class="column-count">${row.count}</span>`;
    }
    if (!exporting) {
      if (row.type === 'project-group') {
        addBtn = `<button class="btn-icon pv-add-btn" onclick="event.stopPropagation();ProjectView.quickAddProjectToGroup('${row.id}')" title="Add project to ${esc(row.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
      } else if (row.type === 'project') {
        addBtn = `<button class="btn-icon pv-add-btn" onclick="event.stopPropagation();ProjectView.quickAddToProject('${row.id}')" title="Add task to ${esc(row.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
      } else if (row.type === 'phase') {
        addBtn = `<button class="btn-icon pv-add-btn" onclick="event.stopPropagation();ProjectView.quickAddToPhase('${row.projId}','${row.phaseName}')" title="Add task to ${esc(row.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
      } else if (row.type === 'stage') {
        addBtn = `<button class="btn-icon pv-add-btn" onclick="event.stopPropagation();ProjectView.quickAddToStage('${row.projId}','${row.pipelineId}','${row.stageName}')" title="Add task to ${esc(row.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
      }
    }

    const divider = exporting && row.level === 1 ? 'border-top:3px solid var(--border-light, #475569);' : '';
    const rowFlex = exporting ? 'display:flex;align-items:center;gap:6px;' : '';
    return `<div class="pv-row ${levelClass} ${isCollapsed ? 'is-collapsed' : ''}" style="${rowFlex}height:${h}px;padding-left:${indent}px;padding-right:12px;${divider}" onclick="ProjectView.toggle('${colKey}')">
      ${icon}
      <span class="pv-color-dot" style="background:${row.color};"></span>
      <span class="pv-row-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.name)}</span>
      ${addBtn}
      ${badge}
      ${staffBadge}
    </div>`;
  }

  // ── Timeline rows ──
  function renderTimelineRow(row, startDate) {
    const h = ROW_H[row.level || 5];

    if (row.type === 'task') {
      const t = row.task;
      const start = new Date(t.startDate + 'T00:00:00');
      const end = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : start;
      const sd = dayDiff(startDate, start);
      const dur = Math.max(1, dayDiff(start, end) + 1);
      const phase = getTaskPhase(t);
      const color = PHASE_COLORS[phase];
      const showLabel = dur * cellWidth > 60;
      const taskVa = (t.validationActions || []);
      const vaHtml = vaPillHtml(taskVa, (sd + dur) * cellWidth - 4);
      return `<div class="gantt-grid-row" style="height:${h}px;">
        <div class="gantt-bar" style="left:${sd * cellWidth}px;width:${dur * cellWidth}px;background:${color};height:20px;top:${(h-20)/2}px;"
             data-task-id="${t.id}" onmouseenter="ProjectView.showTaskTooltip(event,'${t.id}')" onmousemove="ProjectView.moveTaskTooltip(event)" onmouseleave="ProjectView.hideTaskTooltip()" onclick="ProjectView.barClick(event,'${t.id}')" onmousedown="ProjectView.startDrag(event,'${t.id}')">
          <div class="bar-progress" style="width:${t.progress}%;"></div>
          ${showLabel ? `<span class="bar-label">${esc(t.title)}</span>` : ''}
          <div class="resize-handle left" onmousedown="ProjectView.startResize(event,'${t.id}','left')"></div>
          <div class="resize-handle right" onmousedown="ProjectView.startResize(event,'${t.id}','right')"></div>
        </div>
        ${vaHtml}
      </div>`;
    }

    // Summary rows (levels 1-3)
    const gridDivider = exporting && row.level === 1 ? 'border-top:3px solid var(--border-light, #475569);' : '';
    if (!row.start || !row.end) return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;${gridDivider}"></div>`;

    const rowEndPx = (dayDiff(startDate, row.end) + 1) * cellWidth;
    const rowVa = row.validationActions || [];
    const vaPill = vaPillHtml(rowVa, rowEndPx - 4);

    // Phase/pipeline row (level 3) — single continuous bar
    if (row.type === 'phase') {
      const barH = 14;
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};border-radius:4px;opacity:0.75;"></div>
        ${vaPill}</div>`;
    }

    // Stage row (level 4) — smaller summary bar
    if (row.type === 'stage') {
      const barH = 10;
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};border-radius:3px;opacity:0.55;"></div>
        ${vaPill}</div>`;
    }

    // Project Group (level 1) — single muted continuous bar (no VA pill)
    if (row.level === 1) {
      const barH = 22;
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-1" style="height:${h}px;${gridDivider}">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};opacity:0.45;border-radius:4px;"></div>
        </div>`;
    }

    // Project (level 2) — phase-colored sections based on actual date ranges (no VA pill)
    const barH = 18;
    const phaseRanges = row.phaseRanges || [];
    if (phaseRanges.length === 0) {
      // Fallback: single bar with project color
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};opacity:0.7;border-radius:4px;"></div>
        </div>`;
    }
    const barsHtml = phaseRanges.map((pr, i) => {
      const sl = dayDiff(startDate, pr.start) * cellWidth;
      const sw = Math.max(1, dayDiff(pr.start, pr.end) + 1) * cellWidth;
      const isFirst = i === 0;
      const isLast = i === phaseRanges.length - 1;
      const br = isFirst && isLast ? '4px' : isFirst ? '4px 0 0 4px' : isLast ? '0 4px 4px 0' : '0';
      return `<div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${pr.color};border-radius:${br};opacity:0.85;" title="${pr.phase}"></div>`;
    }).join('');

    return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">${barsHtml}</div>`;
  }

  // ── Timeline header ──
  function renderTimelineHeader(startDate, totalDays) {
    let topHtml = '', bottomHtml = '';

    // NAB Financial Year: Oct 1 – Sep 30
    // FY runs from Oct of prior calendar year, e.g. FY26 = Oct 2025 – Sep 2026
    // Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep
    function getFY(d) { return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); }
    function getFQ(d) {
      const m = d.getMonth(); // 0-based
      if (m >= 9) return 1;  // Oct-Dec = Q1
      if (m >= 6) return 4;  // Jul-Sep = Q4
      if (m >= 3) return 3;  // Apr-Jun = Q3
      return 2;              // Jan-Mar = Q2
    }

    // Choose header format based on cellWidth thresholds
    if (cellWidth < 3) {
      // Very zoomed out: FY years / FY quarters
      const fyears = new Map();
      const fquarters = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const fy = getFY(d);
        const fq = getFQ(d);
        const fyk = 'FY' + fy;
        const fqk = fy + '-Q' + fq;
        if (!fyears.has(fyk)) fyears.set(fyk, { name: fyk, count: 0 });
        fyears.get(fyk).count++;
        if (!fquarters.has(fqk)) fquarters.set(fqk, { name: 'Q' + fq, count: 0 });
        fquarters.get(fqk).count++;
      }
      fyears.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;font-weight:700;">${v.name}</div>`; });
      fquarters.forEach(v => {
        const w = v.count * cellWidth;
        bottomHtml += `<div class="gantt-header-day" style="width:${w}px;min-width:${w}px;">${w > 30 ? v.name : ''}</div>`;
      });
    } else if (cellWidth < 8) {
      // Medium-out: FY quarters / months
      const fquarters = new Map();
      const months = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const fy = getFY(d);
        const fq = getFQ(d);
        const fqk = 'FY' + fy + '-Q' + fq;
        const mk = d.getFullYear() + '-' + d.getMonth();
        if (!fquarters.has(fqk)) fquarters.set(fqk, { name: 'FY' + fy + ' Q' + fq, count: 0 });
        fquarters.get(fqk).count++;
        if (!months.has(mk)) months.set(mk, { name: d.toLocaleDateString('en-AU', { month: 'short' }), count: 0 });
        months.get(mk).count++;
      }
      fquarters.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;font-weight:700;">${v.name}</div>`; });
      months.forEach(v => {
        const w = v.count * cellWidth;
        bottomHtml += `<div class="gantt-header-day" style="width:${w}px;min-width:${w}px;">${w > 25 ? v.name : ''}</div>`;
      });
    } else {
      // Zoomed in: FY quarters / days
      const fquarters = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const fy = getFY(d);
        const fq = getFQ(d);
        const fqk = 'FY' + fy + '-Q' + fq;
        if (!fquarters.has(fqk)) fquarters.set(fqk, { name: 'FY' + fy + ' Q' + fq, count: 0 });
        fquarters.get(fqk).count++;
        const isToday = d.toDateString() === new Date().toDateString();
        const isWknd = d.getDay() === 0 || d.getDay() === 6;
        let label = '';
        if (cellWidth >= 25) label = d.getDate();
        else if (cellWidth >= 15) label = d.getDate() % 2 === 1 ? d.getDate() : '';
        else label = d.getDate() % 5 === 1 ? d.getDate() : '';
        bottomHtml += `<div class="gantt-header-day ${isToday ? 'today' : ''} ${isWknd ? 'weekend' : ''}" style="width:${cellWidth}px;min-width:${cellWidth}px;" title="${d.toLocaleDateString('en-AU')}">${label}</div>`;
      }
      fquarters.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;">${v.name}</div>`; });
    }

    return `<div class="gantt-header-months">${topHtml}</div><div class="gantt-header-days">${bottomHtml}</div>`;
  }

  function renderWeekendColumns(startDate, totalDays) {
    let h = '';
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate); d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) h += `<div class="gantt-weekend-col" style="left:${i*cellWidth}px;width:${cellWidth}px;"></div>`;
    }
    return h;
  }

  function renderTodayLine(startDate, today, totalDays) {
    const dd = dayDiff(startDate, today);
    if (dd < 0 || dd > totalDays) return '';
    return `<div class="gantt-today-line" style="left:${dd * cellWidth + cellWidth/2}px;"></div>`;
  }

  // Render FY year (solid) and quarter (dashed) boundary lines
  function renderFYLines(startDate, totalDays) {
    let h = '';
    const seen = new Set();
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate); d.setDate(d.getDate() + i);
      const m = d.getMonth();
      const day = d.getDate();
      if (day !== 1) continue; // only on 1st of month
      const key = d.getFullYear() + '-' + m;
      if (seen.has(key)) continue;
      seen.add(key);
      const px = i * cellWidth;
      if (m === 9) {
        // Oct 1 = FY boundary — solid line
        h += `<div class="fy-line fy-year" style="left:${px}px;"></div>`;
      } else if (m === 0 || m === 3 || m === 6) {
        // Jan 1, Apr 1, Jul 1 = FQ boundary — dashed line
        h += `<div class="fy-line fy-quarter" style="left:${px}px;"></div>`;
      }
    }
    return h;
  }

  // ── Scroll sync ──
  function setupScrollSync() {
    const tl = document.getElementById('project-timeline');
    const list = document.getElementById('project-task-list-body');
    if (!tl || !list) return;
    tl.addEventListener('scroll', () => { list.scrollTop = tl.scrollTop; });
    list.addEventListener('scroll', () => { tl.scrollTop = list.scrollTop; });
  }

  function scrollToToday() {
    const tl = document.getElementById('project-timeline');
    const line = tl ? tl.querySelector('.gantt-today-line') : null;
    if (line && tl) { tl.scrollLeft = Math.max(0, parseInt(line.style.left) - tl.clientWidth / 3); }
  }

  // ── Zoom slider helpers (logarithmic scale) ──
  function sliderToCellWidth(val) {
    // val 0..100 → cellWidth ZOOM_SLIDER_MIN..ZOOM_SLIDER_MAX (log scale)
    const t = val / 100;
    return ZOOM_SLIDER_MIN * Math.pow(ZOOM_SLIDER_MAX / ZOOM_SLIDER_MIN, t);
  }

  function zoomToSlider(cw) {
    // cellWidth → slider 0..100
    const t = Math.log(cw / ZOOM_SLIDER_MIN) / Math.log(ZOOM_SLIDER_MAX / ZOOM_SLIDER_MIN);
    return Math.round(Math.max(0, Math.min(100, t * 100)));
  }

  function onSliderZoom(val) {
    cellWidth = sliderToCellWidth(parseFloat(val));
    // Partial re-render: only update timeline content (preserves slider drag)
    updateTimeline();
  }

  function stepZoom(delta) {
    const current = zoomToSlider(cellWidth);
    const next = Math.max(0, Math.min(100, current + delta));
    cellWidth = sliderToCellWidth(next);
    const slider = document.getElementById('pv-zoom-range');
    if (slider) slider.value = next;
    updateTimeline();
  }

  function fitToView() {
    const tl = document.getElementById('project-timeline');
    const availableWidth = tl ? tl.clientWidth : ((container ? container.clientWidth : window.innerWidth) - 340);
    if (availableWidth > 0 && currentTotalDays > 0) {
      cellWidth = Math.max(ZOOM_SLIDER_MIN, Math.min(ZOOM_SLIDER_MAX, availableWidth / currentTotalDays));
    }
    // Update slider position
    const slider = document.getElementById('pv-zoom-range');
    if (slider) slider.value = zoomToSlider(cellWidth);
    updateTimeline();
  }

  function updateTimeline() {
    let tasks = Store.getTasks().filter(t => t.startDate);
    const filters = App.getFilters();
    if (filters.search || filters.assignee || filters.label || filters.priority) {
      tasks = Store.filterTasks(filters).filter(t => t.startDate);
    }

    const allDates = [];
    tasks.forEach(t => {
      if (t.startDate) allDates.push(new Date(t.startDate + 'T00:00:00'));
      if (t.dueDate) allDates.push(new Date(t.dueDate + 'T00:00:00'));
    });
    if (allDates.length === 0) allDates.push(new Date());

    let minDate = new Date(Math.min(...allDates));
    let maxDate = new Date(Math.max(...allDates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);
    const dow = minDate.getDay();
    minDate.setDate(minDate.getDate() - (dow === 0 ? 6 : dow - 1));
    const totalDays = Math.max(30, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
    currentTotalDays = totalDays;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    timelineStartDate = new Date(minDate);

    const rows = buildRows(tasks);
    const timelineWidth = totalDays * cellWidth;

    const headerEl = document.querySelector('.gantt-timeline-header');
    const bodyEl = document.getElementById('project-timeline-body');
    if (headerEl) {
      headerEl.style.width = timelineWidth + 'px';
      headerEl.innerHTML = renderTimelineHeader(minDate, totalDays);
    }
    if (bodyEl) {
      bodyEl.style.width = timelineWidth + 'px';
      bodyEl.innerHTML = renderWeekendColumns(minDate, totalDays)
        + renderFYLines(minDate, totalDays)
        + renderTodayLine(minDate, today, totalDays)
        + rows.map(r => renderTimelineRow(r, minDate)).join('');
    }
  }

  // ── Controls ──
  function toggleFilterDropdown(e) {
    e.stopPropagation();
    const menu = document.getElementById('pv-filter-menu');
    if (!menu) return;
    const isOpen = menu.classList.toggle('open');
    if (isOpen) {
      // Close on outside click
      const closeHandler = () => { menu.classList.remove('open'); document.removeEventListener('click', closeHandler); };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
  }

  function setProjectFilter(val) {
    if (val === '__all__') {
      projectFilter.clear();
    }
    needsFitToView = true;
    render(App.getFilters());
  }

  function toggleProjectFilter(groupId) {
    if (projectFilter.has(groupId)) {
      projectFilter.delete(groupId);
    } else {
      projectFilter.add(groupId);
    }
    needsFitToView = true;
    render(App.getFilters());
  }

  function toggleProjectGroupVisibility(pgId) {
    if (hiddenProjectGroups.has(pgId)) hiddenProjectGroups.delete(pgId);
    else hiddenProjectGroups.add(pgId);
    render(App.getFilters());
  }

  function isProjectGroupVisible(pgId) {
    return !hiddenProjectGroups.has(pgId);
  }

  function toggleProjectVisibility(projId) {
    if (hiddenProjects.has(projId)) hiddenProjects.delete(projId);
    else hiddenProjects.add(projId);
    render(App.getFilters());
  }

  function isProjectVisible(projId) {
    return !hiddenProjects.has(projId);
  }

  function toggle(key) {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    render(App.getFilters());
  }

  function collapseAll() {
    const groups = Store.getGroups();
    const pgs = Store.getProjectGroups();
    pgs.forEach(pg => collapsed.add('pg_' + pg.id));
    collapsed.add('pg___ungrouped_pg__');
    groups.forEach(g => collapsed.add('proj_' + g.id));
    collapsed.add('proj___orphan__');
    render(App.getFilters());
  }

  function collapseToProjects() {
    // Show project groups + projects (levels 1-2), collapse everything below
    collapsed.clear();
    const groups = Store.getGroups();
    groups.forEach(g => collapsed.add('proj_' + g.id));
    collapsed.add('proj___orphan__');
    render(App.getFilters());
  }

  function expandAll() {
    collapsed.clear();
    render(App.getFilters());
  }

  // ── Export as printable HTML ──
  async function exportView() {
    // Show project group filter modal
    const projectGroups = Store.getProjectGroups();
    const allPgIds = projectGroups.map(pg => pg.id);

    // Also check for ungrouped projects
    const groups = Store.getGroups();
    const hasUngrouped = groups.some(g => !g.projectGroupId || !projectGroups.find(pg => pg.id === g.projectGroupId));
    const hasOrphans = (() => {
      const allGroupedTaskIds = new Set(groups.flatMap(g => g.taskIds));
      return Store.getTasks().some(t => t.startDate && !allGroupedTaskIds.has(t.id));
    })();

    const options = projectGroups.map(pg => ({ value: pg.id, label: pg.name }));
    if (hasUngrouped) options.push({ value: '__ungrouped_pg__', label: 'Ungrouped Projects' });
    if (hasOrphans) options.push({ value: '__orphan__', label: 'Unassigned Tasks' });

    const allValues = options.map(o => o.value);

    const result = await Modal.show({
      title: 'Export Project View',
      fields: [
        { type: 'info', text: 'Select which project groups to include in the export. Use browser Print (Ctrl+P) to save the exported page as PDF.' },
        { type: 'checkboxes', label: 'Project Groups', key: 'selectedGroups', options, value: allValues }
      ],
      confirmText: 'Export',
      confirmClass: 'btn-primary'
    });

    if (!result) return;
    const selectedPgIds = new Set(result.selectedGroups || []);
    if (selectedPgIds.size === 0) { App.toast('No project groups selected', 'info'); return; }

    // Build filtered rows
    let tasks = Store.getTasks().filter(t => t.startDate);
    const filteredRows = buildFilteredRows(tasks, selectedPgIds);

    // Compute date range from filtered rows
    const allDates = [];
    filteredRows.forEach(r => {
      if (r.type === 'task' && r.task) {
        if (r.task.startDate) allDates.push(new Date(r.task.startDate + 'T00:00:00'));
        if (r.task.dueDate) allDates.push(new Date(r.task.dueDate + 'T00:00:00'));
      } else if (r.start) {
        allDates.push(r.start);
        if (r.end) allDates.push(r.end);
      }
    });
    if (allDates.length === 0) { App.toast('No tasks in selected groups', 'info'); return; }

    let minDate = new Date(Math.min(...allDates));
    let maxDate = new Date(Math.max(...allDates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);
    const dow = minDate.getDay();
    minDate.setDate(minDate.getDate() - (dow === 0 ? 6 : dow - 1));
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    const today = new Date(); today.setHours(0, 0, 0, 0);

    exporting = true;
    const listHtml = filteredRows.map(r => renderListRow(r)).join('');
    const gridHtml = renderWeekendColumns(minDate, totalDays)
      + renderFYLines(minDate, totalDays)
      + renderTodayLine(minDate, today, totalDays)
      + filteredRows.map(r => renderTimelineRow(r, minDate)).join('');
    const headerHtml = renderTimelineHeader(minDate, totalDays);
    const timelineWidth = (totalDays * cellWidth) + 'px';
    exporting = false;

    const storeData = Store.getData();
    const title = storeData ? storeData.meta.title : 'Project';
    const themeVars = getComputedStyle(document.documentElement);
    const bg = themeVars.getPropertyValue('--bg-primary').trim();
    const bgSec = themeVars.getPropertyValue('--bg-secondary').trim();
    const text = themeVars.getPropertyValue('--text-primary').trim();
    const textSec = themeVars.getPropertyValue('--text-secondary').trim();
    const border = themeVars.getPropertyValue('--border-color').trim();

    // Gather all CSS from document stylesheets for self-contained export
    let inlinedCSS = '';
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) { inlinedCSS += rule.cssText + '\n'; }
        } catch (e) { /* cross-origin sheet, skip */ }
      }
    } catch (e) { /* fallback */ }

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(title)} — Project Overview</title>
<style>
${inlinedCSS}
  * { box-sizing:border-box; margin:0; padding:0; }
  .pv-staff-badge { margin-left:auto !important; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:${bg}; color:${text}; font-size:13px; }
  .export-header { padding:24px 32px; background:${bgSec}; border-bottom:1px solid ${border}; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  .export-header h1 { font-size:20px; font-weight:700; }
  .export-header .date { font-size:12px; color:${textSec}; }
  .export-legend { display:flex; gap:16px; margin-left:auto; }
  .export-legend span { display:flex; align-items:center; gap:4px; font-size:11px; color:${textSec}; }
  .export-legend .dot { width:10px; height:10px; border-radius:3px; }
  /* Export overrides */
  .ex-wrap { display:flex; overflow-x:auto; }
  .ex-list { width:340px; min-width:340px; border-right:1px solid ${border}; background:${bgSec}; }
  .ex-hdr { height:60px; display:flex; align-items:center; padding:0 16px; font-size:12px; font-weight:600; color:${textSec}; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid ${border}; box-sizing:content-box; }
  .ex-tl-hdr { height:60px; display:flex; flex-direction:column; border-bottom:1px solid ${border}; box-sizing:content-box; }
  .ex-tl-hdr .gantt-header-months { display:flex; height:28px; border-bottom:1px solid ${border}; box-sizing:border-box; }
  .ex-tl-hdr .gantt-header-days { display:flex; height:32px; }
  .ex-tl-body { position:relative; }
  .gantt-grid-row { position:relative; overflow:visible; }
  .gantt-bar { position:absolute; display:flex; overflow:visible; }
  .project-summary-bar { position:absolute; display:flex; overflow:hidden; }
  .bar-progress { position:absolute; }
  .gantt-weekend-col { position:absolute; }
  .gantt-today-line { position:absolute; top:0; bottom:0; width:2px; background:#ef4444; z-index:5; pointer-events:none; }
  .gantt-today-line::before { content:''; position:absolute; top:0; left:-4px; width:10px; height:10px; background:#ef4444; border-radius:50%; }
  .gantt-today-line::after { content:'Today'; position:absolute; top:12px; left:6px; font-size:9px; font-weight:700; color:#ef4444; white-space:nowrap; }
  .va-pill { position:absolute; }
  .fy-line { position:absolute; top:0; bottom:0; width:1px; z-index:3; pointer-events:none; }
  .fy-line.fy-year { background:rgba(148,163,184,0.45); }
  .fy-line.fy-quarter { background:repeating-linear-gradient(to bottom, rgba(148,163,184,0.35) 0px, rgba(148,163,184,0.35) 4px, transparent 4px, transparent 8px); }

  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ex-wrap { overflow:visible; }
  }
</style>
</head><body data-theme="${document.documentElement.getAttribute('data-theme')}">
  <div class="export-header">
    <h1>${esc(title)} — Project Overview</h1>
    <span class="date">Exported ${new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}</span>
    <div class="export-legend">
      ${buildExportLegend()}
    </div>
  </div>
  <div class="ex-wrap">
    <div class="ex-list">
      <div class="ex-hdr">Project Hierarchy</div>
      ${listHtml}
    </div>
    <div style="flex:1;overflow:visible;">
      <div class="ex-tl-hdr" style="width:${timelineWidth};">${headerHtml}</div>
      <div class="ex-tl-body" style="width:${timelineWidth};">${gridHtml}</div>
    </div>
  </div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.download = (title || 'project').replace(/\s+/g, '-').toLowerCase() + '-overview.html';
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    App.toast('Exported — use browser Print (Ctrl+P) to save as PDF', 'success');
  }

  // ── Build rows filtered by selected project group IDs ──
  function buildFilteredRows(tasks, selectedPgIds) {
    const projectGroups = Store.getProjectGroups();
    const groups = Store.getGroups();
    const rows = [];

    const pgMap = new Map();
    groups.forEach(g => {
      const pgId = g.projectGroupId || '__ungrouped_pg__';
      if (!pgMap.has(pgId)) pgMap.set(pgId, []);
      pgMap.get(pgId).push(g);
    });

    const renderedPgIds = new Set();
    projectGroups.forEach(pg => {
      if (!selectedPgIds.has(pg.id)) return;
      const pgGroups = pgMap.get(pg.id) || [];
      renderedPgIds.add(pg.id);
      addProjectGroupRows(rows, pg.id, pg.name, pg.color, pgGroups, tasks);
    });

    if (selectedPgIds.has('__ungrouped_pg__')) {
      const ungroupedGroups = pgMap.get('__ungrouped_pg__') || [];
      pgMap.forEach((grps, pgId) => {
        if (pgId === '__ungrouped_pg__' || renderedPgIds.has(pgId)) return;
        if (!selectedPgIds.has(pgId)) ungroupedGroups.push(...grps);
      });
      if (ungroupedGroups.length > 0) {
        addProjectGroupRows(rows, '__ungrouped_pg__', 'Ungrouped Projects', '#94a3b8', ungroupedGroups, tasks);
      }
    }

    if (selectedPgIds.has('__orphan__')) {
      const allGroupedTaskIds = new Set(groups.flatMap(g => g.taskIds));
      const orphanTasks = tasks.filter(t => !allGroupedTaskIds.has(t.id));
      if (orphanTasks.length > 0) {
        const range = dateRange(orphanTasks);
        const phaseCounts = countPhases(orphanTasks);
        const orphanVa = collectValidationActions(orphanTasks);
        const orphanPhaseRanges = computePhaseRanges(orphanTasks);
        const orphanAssignees = countAssignees(orphanTasks);
        rows.push({ level: 2, type: 'project', id: '__orphan__', name: 'Unassigned Tasks', color: '#64748b', count: orphanTasks.length, ...range, phaseRanges: orphanPhaseRanges, phaseCounts, validationActions: orphanVa, assigneeCount: orphanAssignees });
        if (!collapsed.has('proj___orphan__')) {
          addPhaseRows(rows, '__orphan__', orphanTasks);
        }
      }
    }

    return rows;
  }

  // ── Helpers ──
  const VA_PILL_STYLE = 'position:absolute;z-index:10;pointer-events:none;display:inline-flex;align-items:center;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;background:#ef4444;color:white;white-space:nowrap;line-height:1.4;letter-spacing:0.2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);';

  function vaPillHtml(actions, leftPx) {
    if (!actions || actions.length === 0) return '';
    const text = actions.length === 1
      ? `Action - ${esc(actions[0])}`
      : `Actions - ${actions.map(a => esc(a)).join(', ')}`;
    return `<span class="va-pill" style="${VA_PILL_STYLE}left:${leftPx}px;bottom:0;">${text}</span>`;
  }
  async function quickAddProjectToGroup(pgId) {
    const pg = Store.getProjectGroup(pgId);
    if (!pg) return;
    const result = await Modal.show({
      title: `Add Project to ${pg.name}`,
      fields: [
        { type: 'text', key: 'name', label: 'Project Name', placeholder: 'Enter project name...', autofocus: true },
      ],
      confirmText: 'Add Project'
    });
    if (!result || !result.name) return;
    const group = Store.addGroup(result.name);
    Store.updateGroup(group.id, { projectGroupId: pgId });
    App.toast('Project added to ' + pg.name, 'success');
  }

  async function quickAddToPhase(projId, phaseName) {
    const group = Store.getGroup(projId);
    if (!group) return;
    // Find the pipeline that matches this phase name
    const pipelines = Store.getPipelines();
    const matchedPipeline = pipelines.find(p => p.name.toLowerCase().includes(phaseName.toLowerCase()));

    const result = await Modal.show({
      title: `Add Task — ${phaseName}`,
      fields: [
        { type: 'text', key: 'title', label: 'Title', placeholder: 'Enter task title...', autofocus: true },
        { type: 'select', key: 'priority', label: 'Priority', value: 'medium', options: [
          { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
        ]},
        { type: 'date', key: 'startDate', label: 'Start Date', value: new Date().toISOString().slice(0, 10) },
        { type: 'date', key: 'dueDate', label: 'Due Date' }
      ],
      confirmText: 'Add Task'
    });
    if (!result || !result.title) return;

    // Auto-assign pipeline but leave unstaged by default
    if (matchedPipeline) {
      result.pipelineId = matchedPipeline.id;
    }

    const task = Store.addTask(result);
    group.taskIds.push(task.id);
    Store.updateGroup(group.id, { taskIds: group.taskIds });
    App.toast('Task added to ' + group.name + ' — ' + phaseName, 'success');
  }

  async function quickAddToStage(projId, pipelineId, stageName) {
    const group = Store.getGroup(projId);
    const pipeline = Store.getPipeline(pipelineId);
    if (!group || !pipeline) return;

    const result = await Modal.show({
      title: `Add Task — ${pipeline.name} › ${stageName}`,
      fields: [
        { type: 'text', key: 'title', label: 'Title', placeholder: 'Enter task title...', autofocus: true },
        { type: 'select', key: 'priority', label: 'Priority', value: 'medium', options: [
          { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
        ]},
        { type: 'date', key: 'startDate', label: 'Start Date', value: new Date().toISOString().slice(0, 10) },
        { type: 'date', key: 'dueDate', label: 'Due Date' }
      ],
      confirmText: 'Add Task'
    });
    if (!result || !result.title) return;

    result.pipelineId = pipelineId;
    result.stage = stageName;

    const task = Store.addTask(result);
    group.taskIds.push(task.id);
    Store.updateGroup(group.id, { taskIds: group.taskIds });
    App.toast(`Task added to ${group.name} — ${pipeline.name} › ${stageName}`, 'success');
  }

  async function quickAddToProject(groupId) {
    const group = Store.getGroup(groupId);
    if (!group) return;
    const pipelines = Store.getPipelines();
    const fields = [
      { type: 'text', key: 'title', label: 'Title', placeholder: 'Enter task title...', autofocus: true },
      { type: 'select', key: 'priority', label: 'Priority', value: 'medium', options: [
        { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
      ]},
    ];
    if (pipelines.length > 0) {
      fields.push({ type: 'select', key: 'pipelineId', label: 'Phase', value: pipelines[0]?.id || '', options: [
        { value: '', label: 'None' },
        ...pipelines.map(p => ({ value: p.id, label: p.name }))
      ]});
    }
    fields.push(
      { type: 'date', key: 'startDate', label: 'Start Date', value: new Date().toISOString().slice(0, 10) },
      { type: 'date', key: 'dueDate', label: 'Due Date' }
    );
    const result = await Modal.show({
      title: `Add Task to ${group.name}`,
      fields,
      confirmText: 'Add Task'
    });
    if (!result || !result.title) return;

    // Leave unstaged by default — user can assign a stage later

    const task = Store.addTask(result);
    // Add to project group
    group.taskIds.push(task.id);
    Store.updateGroup(group.id, { taskIds: group.taskIds });
    App.toast('Task added to ' + group.name, 'success');
  }

  // ── Drag & Resize ──
  let dragState = null;

  function pxToDate(px) {
    const days = Math.round(px / cellWidth);
    const d = new Date(timelineStartDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Snap pixel to the nearest 1st-of-month (for bar start/left edge)
  function snapToMonthStart(px) {
    const days = px / cellWidth;
    const d = new Date(timelineStartDate);
    d.setDate(d.getDate() + Math.round(days));
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const nextMonthStart = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const snappedDate = Math.abs(d - monthStart) <= Math.abs(d - nextMonthStart) ? monthStart : nextMonthStart;
    return Math.round((snappedDate - timelineStartDate) / (1000 * 60 * 60 * 24)) * cellWidth;
  }

  // Snap pixel to the nearest last-day-of-month (for bar end/right edge)
  function snapToMonthEnd(px) {
    const days = px / cellWidth;
    const d = new Date(timelineStartDate);
    d.setDate(d.getDate() + Math.round(days));
    // Last day of current month and last day of previous month
    const endOfThisMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const endOfPrevMonth = new Date(d.getFullYear(), d.getMonth(), 0);
    const snappedDate = Math.abs(d - endOfThisMonth) <= Math.abs(d - endOfPrevMonth) ? endOfThisMonth : endOfPrevMonth;
    // Pixel position is the right edge of that day, so +1 day worth of px
    const snapDays = Math.round((snappedDate - timelineStartDate) / (1000 * 60 * 60 * 24));
    return (snapDays + 1) * cellWidth;
  }

  function pxToDateAt(px) {
    const days = Math.round(px / cellWidth);
    const d = new Date(timelineStartDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function barClick(e, taskId) {
    // Don't open panel if we just finished a drag
    if (e.target.classList.contains('resize-handle')) return;
    if (dragState && dragState.moved) return;
    TaskPanel.open(taskId);
  }

  function startDrag(e, taskId) {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.button !== 0) return;
    hideTaskTooltip();
    const bar = e.currentTarget;
    const task = Store.getTask(taskId);
    if (!task) return;

    const startX = e.clientX;
    const origLeft = parseInt(bar.style.left);
    const origWidth = parseInt(bar.style.width);

    dragState = { taskId, moved: false, bar, origLeft, origWidth, startX, type: 'move' };

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) dragState.moved = true;
      const snappedLeft = snapToMonthStart(origLeft + dx);
      const snappedRight = snapToMonthEnd(origLeft + origWidth + dx);
      bar.style.left = snappedLeft + 'px';
      bar.style.width = Math.max(cellWidth, snappedRight - snappedLeft) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragState.moved) { dragState = null; return; }

      const newLeft = parseInt(bar.style.left);
      const newWidth = parseInt(bar.style.width);
      const newStart = pxToDateAt(newLeft);
      // End is the last day within the bar (right edge px - 1 day)
      const newEnd = pxToDateAt(newLeft + newWidth - cellWidth);

      Store.updateTask(taskId, { startDate: newStart, dueDate: newEnd });
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  function startResize(e, taskId, side) {
    if (e.button !== 0) return;
    e.stopPropagation();
    hideTaskTooltip();
    const bar = e.target.closest('.gantt-bar');
    const task = Store.getTask(taskId);
    if (!bar || !task) return;

    const startX = e.clientX;
    const origLeft = parseInt(bar.style.left);
    const origWidth = parseInt(bar.style.width);

    dragState = { taskId, moved: false, bar, origLeft, origWidth, startX, type: 'resize', side };

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) dragState.moved = true;
      if (side === 'right') {
        // Snap right edge to end-of-month
        const rawRight = origLeft + origWidth + dx;
        const snappedRight = snapToMonthEnd(rawRight);
        const newWidth = snappedRight - origLeft;
        bar.style.width = Math.max(cellWidth, newWidth) + 'px';
      } else {
        // Snap left edge to 1st-of-month
        const snappedLeft = snapToMonthStart(origLeft + dx);
        const newWidth = origLeft + origWidth - snappedLeft;
        if (newWidth >= cellWidth) {
          bar.style.left = snappedLeft + 'px';
          bar.style.width = newWidth + 'px';
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragState.moved) { dragState = null; return; }

      const newLeft = parseInt(bar.style.left);
      const newWidth = parseInt(bar.style.width);
      const newStart = pxToDateAt(newLeft);
      const newEnd = pxToDateAt(newLeft + newWidth - cellWidth);

      Store.updateTask(taskId, { startDate: newStart, dueDate: newEnd });
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  function dayDiff(from, to) { return Math.floor((to - from) / (1000 * 60 * 60 * 24)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function editTaskTitle(e, taskId) {
    e.stopPropagation();
    const el = e.currentTarget;
    const task = Store.getTask(taskId);
    if (!task) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = task.title;
    input.style.cssText = 'width:100%;font-size:inherit;font-weight:inherit;border:1px solid var(--accent);border-radius:4px;padding:1px 4px;background:var(--surface);color:var(--text-primary);outline:none;';
    el.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== task.title) {
        Store.updateTask(taskId, { title: newTitle });
      }
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = task.title; input.blur(); }
    });
  }

  return { init, render, onSliderZoom, stepZoom, fitToView, setProjectFilter, toggleProjectFilter, toggleFilterDropdown, toggleProjectGroupVisibility, isProjectGroupVisible, toggleProjectVisibility, isProjectVisible, toggle, collapseAll, collapseToProjects, expandAll, exportView, quickAddToProject, quickAddProjectToGroup, quickAddToPhase, quickAddToStage, barClick, startDrag, startResize, showTaskTooltip, moveTaskTooltip, hideTaskTooltip, editTaskTitle };
})();
