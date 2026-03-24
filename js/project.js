// project.js — Hierarchical project overview
// Level 1: Project Group  |  Level 2: Project (group)  |  Level 3: Phase  |  Level 4: Task

const ProjectView = (() => {
  let container = null;
  let cellWidth = 1.5;
  let zoom = 'year';
  let collapsed = new Set(); // stores row ids like "pg_X", "proj_X", "phase_X_Dev"
  let defaultsApplied = false;
  let exporting = false;
  let timelineStartDate = null; // stored for drag calculations

  const ZOOM_WIDTHS = { day: 40, week: 28, month: 10, quarter: 4, year: 1.5 };

  const PHASE_COLORS = {
    'Development': '#6366f1',
    'Validation & Regulatory Approval': '#f59e0b',
    'Implementation': '#22c55e',
    'Other': '#94a3b8'
  };
  const PHASE_ORDER = ['Development', 'Validation & Regulatory Approval', 'Implementation', 'Other'];

  function init(el) { container = el; }

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
    const phaseMap = {};
    tasks.forEach(t => {
      const phase = getTaskPhase(t);
      if (!phaseMap[phase]) phaseMap[phase] = { start: null, end: null };
      if (t.startDate) {
        const s = new Date(t.startDate + 'T00:00:00');
        if (!phaseMap[phase].start || s < phaseMap[phase].start) phaseMap[phase].start = s;
      }
      const ed = t.dueDate || t.startDate;
      if (ed) {
        const e = new Date(ed + 'T00:00:00');
        if (!phaseMap[phase].end || e > phaseMap[phase].end) phaseMap[phase].end = e;
      }
    });
    // Build ordered ranges (only phases that exist)
    const ranges = PHASE_ORDER
      .filter(p => phaseMap[p] && phaseMap[p].start)
      .map(p => ({ phase: p, start: phaseMap[p].start, end: phaseMap[p].end, color: PHASE_COLORS[p] }));
    // Extend each phase's end to meet the next phase's start (fill gaps)
    for (let i = 0; i < ranges.length - 1; i++) {
      if (ranges[i].end < ranges[i + 1].start) {
        ranges[i].end = ranges[i + 1].start;
      }
    }
    return ranges;
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

    // Bucket groups by projectGroupId
    const pgMap = new Map(); // pgId -> [group, ...]
    groups.forEach(g => {
      const pgId = g.projectGroupId || '__ungrouped_pg__';
      if (!pgMap.has(pgId)) pgMap.set(pgId, []);
      pgMap.get(pgId).push(g);
    });

    // Known project groups first
    const renderedPgIds = new Set();
    projectGroups.forEach(pg => {
      const pgGroups = pgMap.get(pg.id) || [];
      if (pgGroups.length === 0) return;
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

    // Tasks not in any group
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

    return rows;
  }

  function addProjectGroupRows(rows, pgId, pgName, pgColor, pgGroups, allTasks) {
    // Collect all tasks across all groups in this project group
    const pgTaskIds = new Set(pgGroups.flatMap(g => g.taskIds));
    const pgTasks = allTasks.filter(t => pgTaskIds.has(t.id));
    if (pgTasks.length === 0) return;

    const range = dateRange(pgTasks);
    const phaseCounts = countPhases(pgTasks);
    const vaActions = collectValidationActions(pgTasks);
    const pgAssignees = countAssignees(pgTasks);
    rows.push({ level: 1, type: 'project-group', id: pgId, name: pgName, color: pgColor, count: pgTasks.length, ...range, phaseCounts, validationActions: vaActions, assigneeCount: pgAssignees });

    if (collapsed.has('pg_' + pgId)) return;

    pgGroups.forEach(g => {
      const gTasks = allTasks.filter(t => g.taskIds.includes(t.id) && t.startDate);
      if (gTasks.length === 0) return;
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
    PHASE_ORDER.forEach(phase => {
      const phaseTasks = tasks.filter(t => getTaskPhase(t) === phase);
      if (phaseTasks.length === 0) return;
      const range = dateRange(phaseTasks);
      const phaseId = projId + '_' + phase;
      const phaseVa = collectValidationActions(phaseTasks);
      const phaseAssignees = countAssignees(phaseTasks);
      rows.push({ level: 3, type: 'phase', id: phaseId, projId: projId, phaseName: phase, name: phase, color: PHASE_COLORS[phase], count: phaseTasks.length, ...range, validationActions: phaseVa, assigneeCount: phaseAssignees });

      if (!collapsed.has('phase_' + phaseId)) {
        phaseTasks.forEach(t => rows.push({ level: 4, type: 'task', task: t }));
      }
    });
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
    cellWidth = ZOOM_WIDTHS[zoom];

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
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    timelineStartDate = new Date(minDate);

    const rows = buildRows(tasks);

    const html = `<div class="project-view">
      <div class="project-controls">
        <div class="gantt-zoom-group">
          ${['day','week','month','quarter','year'].map(z =>
            `<button class="gantt-zoom-btn ${zoom === z ? 'active' : ''}" onclick="ProjectView.setZoom('${z}')">${z.charAt(0).toUpperCase()+z.slice(1)}</button>`
          ).join('')}
        </div>
        <button class="gantt-today-btn" onclick="ProjectView.collapseToProjects()">Projects</button>
        <button class="gantt-today-btn" onclick="ProjectView.collapseAll()">Collapse All</button>
        <button class="gantt-today-btn" onclick="ProjectView.expandAll()">Expand All</button>
        <button class="gantt-today-btn" onclick="ProjectView.exportView()" title="Export as printable HTML">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export
        </button>
        <div class="project-legend">
          ${PHASE_ORDER.map(p => `<span class="legend-item"><span class="legend-dot" style="background:${PHASE_COLORS[p]}"></span>${p}</span>`).join('')}
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
            ${renderTodayLine(minDate, today, totalDays)}
            ${rows.map(r => renderTimelineRow(r, minDate)).join('')}
          </div>
        </div>
      </div>
    </div>`;

    container.innerHTML = html;
    setupScrollSync();
    // Scroll to show the start of the timeline
    const tl = document.getElementById('project-timeline');
    if (tl) tl.scrollLeft = 0;
  }

  // ── Row heights by level ──
  const ROW_H = { 1: 40, 2: 36, 3: 32, 4: 36 };
  const INDENT = { 1: 8, 2: 24, 3: 44, 4: 64 };

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
      return `<div class="pv-row pv-level-4" style="height:${ROW_H[4]}px;padding-left:${INDENT[4]}px;" onclick="TaskPanel.open('${t.id}')">
        <span class="priority-dot" style="background:${pc};"></span>
        <span class="task-name">${esc(t.title)}</span>
        ${assigneeHtml}
      </div>`;
    }

    const h = ROW_H[row.level];
    const indent = INDENT[row.level];
    const colKey = row.type === 'project-group' ? 'pg_' + row.id : row.type === 'project' ? 'proj_' + row.id : 'phase_' + row.id;
    const isCollapsed = collapsed.has(colKey);
    const levelClass = 'pv-level-' + row.level;
    const icon = exporting ? '' : (row.level <= 3 ? `<svg class="pv-chevron ${isCollapsed ? 'collapsed' : ''}" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>` : '');

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
    } else if (row.type === 'phase') {
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
    const h = ROW_H[row.level || 4];

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
             data-task-id="${t.id}" onclick="ProjectView.barClick(event,'${t.id}')" onmousedown="ProjectView.startDrag(event,'${t.id}')">
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

    // Phase row (level 3) — single continuous bar
    if (row.type === 'phase') {
      const barH = 14;
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};border-radius:4px;opacity:0.75;"></div>
        ${vaPill}</div>`;
    }

    // Project Group (level 1) — single muted continuous bar
    if (row.level === 1) {
      const barH = 22;
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-1" style="height:${h}px;${gridDivider}">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};opacity:0.45;border-radius:4px;"></div>
        ${vaPill}</div>`;
    }

    // Project (level 2) — phase-colored sections based on actual date ranges
    const barH = 18;
    const phaseRanges = row.phaseRanges || [];
    if (phaseRanges.length === 0) {
      // Fallback: single bar with project color
      const sl = dayDiff(startDate, row.start) * cellWidth;
      const sw = Math.max(1, dayDiff(row.start, row.end) + 1) * cellWidth;
      return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">
        <div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${row.color};opacity:0.7;border-radius:4px;"></div>
        ${vaPill}</div>`;
    }
    const barsHtml = phaseRanges.map((pr, i) => {
      const sl = dayDiff(startDate, pr.start) * cellWidth;
      const sw = Math.max(1, dayDiff(pr.start, pr.end) + 1) * cellWidth;
      const isFirst = i === 0;
      const isLast = i === phaseRanges.length - 1;
      const br = isFirst && isLast ? '4px' : isFirst ? '4px 0 0 4px' : isLast ? '0 4px 4px 0' : '0';
      return `<div class="project-summary-bar" style="left:${sl}px;width:${sw}px;height:${barH}px;top:${(h-barH)/2}px;background:${pr.color};border-radius:${br};opacity:0.85;" title="${pr.phase}"></div>`;
    }).join('');

    return `<div class="gantt-grid-row pv-grid-${row.level}" style="height:${h}px;">${barsHtml}${vaPill}</div>`;
  }

  // ── Timeline header ──
  function renderTimelineHeader(startDate, totalDays) {
    let topHtml = '', bottomHtml = '';

    if (zoom === 'year') {
      // Top row: years, bottom row: quarters
      const years = new Map();
      const quarters = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const yr = d.getFullYear();
        const q = Math.floor(d.getMonth() / 3) + 1;
        const yk = '' + yr;
        const qk = yr + '-Q' + q;
        if (!years.has(yk)) years.set(yk, { name: '' + yr, count: 0 });
        years.get(yk).count++;
        if (!quarters.has(qk)) quarters.set(qk, { name: 'Q' + q, count: 0 });
        quarters.get(qk).count++;
      }
      years.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;font-weight:700;">${v.name}</div>`; });
      quarters.forEach(v => { bottomHtml += `<div class="gantt-header-day" style="width:${v.count * cellWidth}px;min-width:${v.count * cellWidth}px;">${v.name}</div>`; });
    } else if (zoom === 'quarter') {
      // Top row: years, bottom row: months (short)
      const years = new Map();
      const months = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const yr = '' + d.getFullYear();
        const mk = d.getFullYear() + '-' + d.getMonth();
        if (!years.has(yr)) years.set(yr, { name: yr, count: 0 });
        years.get(yr).count++;
        if (!months.has(mk)) months.set(mk, { name: d.toLocaleDateString('en-US', { month: 'short' }), count: 0 });
        months.get(mk).count++;
      }
      years.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;font-weight:700;">${v.name}</div>`; });
      months.forEach(v => { bottomHtml += `<div class="gantt-header-day" style="width:${v.count * cellWidth}px;min-width:${v.count * cellWidth}px;">${v.name}</div>`; });
    } else {
      // Default: top row months, bottom row days
      const months = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const mk = d.getFullYear() + '-' + d.getMonth();
        if (!months.has(mk)) months.set(mk, { name: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), count: 0 });
        months.get(mk).count++;
        const isToday = d.toDateString() === new Date().toDateString();
        const isWknd = d.getDay() === 0 || d.getDay() === 6;
        let label = '';
        if (zoom === 'day') label = d.getDate();
        else if (zoom === 'week') label = d.getDate();
        else if (zoom === 'month') label = d.getDate() % 5 === 1 ? d.getDate() : '';
        bottomHtml += `<div class="gantt-header-day ${isToday ? 'today' : ''} ${isWknd ? 'weekend' : ''}" style="width:${cellWidth}px;min-width:${cellWidth}px;" title="${d.toLocaleDateString()}">${label}</div>`;
      }
      months.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;">${v.name}</div>`; });
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

  // ── Controls ──
  function setZoom(z) { zoom = z; render(App.getFilters()); }

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
  .gantt-today-line { position:absolute; }
  .va-pill { position:absolute; }

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
      ${PHASE_ORDER.map(p => `<span><span class="dot" style="background:${PHASE_COLORS[p]}"></span>${p}</span>`).join('')}
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
      if (pgGroups.length === 0) return;
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
        { type: 'text', key: 'startDate', label: 'Start Date', value: new Date().toISOString().slice(0, 10), placeholder: 'YYYY-MM-DD' },
        { type: 'text', key: 'dueDate', label: 'Due Date', placeholder: 'YYYY-MM-DD' }
      ],
      confirmText: 'Add Task'
    });
    if (!result || !result.title) return;

    // Auto-assign pipeline and first stage
    if (matchedPipeline) {
      result.pipelineId = matchedPipeline.id;
      if (matchedPipeline.stages.length > 0) result.stage = matchedPipeline.stages[0];
    }

    const task = Store.addTask(result);
    group.taskIds.push(task.id);
    Store.updateGroup(group.id, { taskIds: group.taskIds });
    App.toast('Task added to ' + group.name + ' — ' + phaseName, 'success');
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
      fields.push({ type: 'select', key: 'pipelineId', label: 'Pipeline', value: pipelines[0]?.id || '', options: [
        { value: '', label: 'None' },
        ...pipelines.map(p => ({ value: p.id, label: p.name }))
      ]});
    }
    fields.push(
      { type: 'text', key: 'startDate', label: 'Start Date', value: new Date().toISOString().slice(0, 10), placeholder: 'YYYY-MM-DD' },
      { type: 'text', key: 'dueDate', label: 'Due Date', placeholder: 'YYYY-MM-DD' }
    );
    const result = await Modal.show({
      title: `Add Task to ${group.name}`,
      fields,
      confirmText: 'Add Task'
    });
    if (!result || !result.title) return;

    // Set stage to first stage of selected pipeline
    if (result.pipelineId) {
      const pl = Store.getPipeline(result.pipelineId);
      if (pl && pl.stages.length > 0) result.stage = pl.stages[0];
    }

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

  function barClick(e, taskId) {
    // Don't open panel if we just finished a drag
    if (e.target.classList.contains('resize-handle')) return;
    if (dragState && dragState.moved) return;
    TaskPanel.open(taskId);
  }

  function startDrag(e, taskId) {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.button !== 0) return;
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
      bar.style.left = (origLeft + dx) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragState.moved) { dragState = null; return; }

      const newLeft = parseInt(bar.style.left);
      const newStart = pxToDate(newLeft);
      const daysMoved = Math.round((newLeft - origLeft) / cellWidth);
      const oldEnd = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : new Date(task.startDate + 'T00:00:00');
      oldEnd.setDate(oldEnd.getDate() + daysMoved);
      const newEnd = oldEnd.toISOString().slice(0, 10);

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
        bar.style.width = Math.max(cellWidth, origWidth + dx) + 'px';
      } else {
        const newLeft = origLeft + dx;
        const newWidth = origWidth - dx;
        if (newWidth >= cellWidth) {
          bar.style.left = newLeft + 'px';
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
      const newStart = pxToDate(newLeft);
      const newEnd = pxToDate(newLeft + newWidth - cellWidth);

      Store.updateTask(taskId, { startDate: newStart, dueDate: newEnd });
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  function dayDiff(from, to) { return Math.floor((to - from) / (1000 * 60 * 60 * 24)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  return { init, render, setZoom, toggle, collapseAll, collapseToProjects, expandAll, exportView, quickAddToProject, quickAddProjectToGroup, quickAddToPhase, barClick, startDrag, startResize };
})();
