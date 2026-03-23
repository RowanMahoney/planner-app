// gantt.js — Interactive Gantt chart view

const GanttView = (() => {
  let container = null;
  let zoom = 'week'; // day, week, month
  let groupBy = 'bucket'; // bucket, assignee, pipeline, none
  let cellWidth = 40;
  let scrollSync = true;
  let collapsedGroups = new Set();
  let showGroupBars = true;
  let dragState = null;

  const ZOOM_WIDTHS = { day: 40, week: 28, month: 10, quarter: 4, year: 1.5 };

  function init(el) {
    container = el;
  }

  function render(filters = {}) {
    let tasks = filters.search || filters.assignee || filters.label || filters.priority
      ? Store.filterTasks(filters)
      : Store.getTasks();

    // Only show tasks with dates
    tasks = tasks.filter(t => t.startDate);

    cellWidth = ZOOM_WIDTHS[zoom];

    // Calculate date range
    const allDates = [];
    tasks.forEach(t => {
      if (t.startDate) allDates.push(new Date(t.startDate + 'T00:00:00'));
      if (t.dueDate) allDates.push(new Date(t.dueDate + 'T00:00:00'));
    });

    if (allDates.length === 0) {
      allDates.push(new Date());
    }

    let minDate = new Date(Math.min(...allDates));
    let maxDate = new Date(Math.max(...allDates));

    // Add padding
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);

    // Snap to week start (Monday)
    const dayOfWeek = minDate.getDay();
    minDate.setDate(minDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group tasks
    const groups = groupTasks(tasks);

    // Build rows data
    const rows = [];
    groups.forEach(g => {
      if (g.name) {
        // Compute group date range for summary bar
        let groupStart = null, groupEnd = null;
        g.tasks.forEach(t => {
          if (t.startDate) {
            const s = new Date(t.startDate + 'T00:00:00');
            if (!groupStart || s < groupStart) groupStart = s;
          }
          const endDate = t.dueDate || t.startDate;
          if (endDate) {
            const e = new Date(endDate + 'T00:00:00');
            if (!groupEnd || e > groupEnd) groupEnd = e;
          }
        });
        rows.push({ type: 'group', name: g.name, color: g.color, id: g.id, count: g.tasks.length, groupStart, groupEnd });
      }
      if (!g.name || !collapsedGroups.has(g.id)) {
        g.tasks.forEach(t => rows.push({ type: 'task', task: t }));
      }
    });

    let html = `<div class="gantt-view">
      <div class="gantt-controls">
        <div class="gantt-zoom-group">
          ${['day','week','month','quarter','year'].map(z =>
            `<button class="gantt-zoom-btn ${zoom === z ? 'active' : ''}" onclick="GanttView.setZoom('${z}')">${z.charAt(0).toUpperCase()+z.slice(1)}</button>`
          ).join('')}
        </div>
        <button class="gantt-today-btn" onclick="GanttView.scrollToToday()">Today</button>
        <select class="gantt-group-select" onchange="GanttView.setGroupBy(this.value)">
          <option value="none" ${groupBy === 'none' ? 'selected' : ''}>No grouping</option>
          <option value="bucket" ${groupBy === 'bucket' ? 'selected' : ''}>Group by Bucket</option>
          <option value="assignee" ${groupBy === 'assignee' ? 'selected' : ''}>Group by Assignee</option>
          <option value="pipeline" ${groupBy === 'pipeline' ? 'selected' : ''}>Group by Pipeline</option>
        </select>
        ${groupBy !== 'none' ? `<label class="gantt-toggle" title="Show summary bar for each group">
          <input type="checkbox" ${showGroupBars ? 'checked' : ''} onchange="GanttView.toggleGroupBars(this.checked)" />
          <span>Summary bars</span>
        </label>` : ''}
        <span class="text-sm text-muted ml-auto">${tasks.length} tasks</span>
      </div>
      <div class="gantt-wrapper">
        <div class="gantt-task-list">
          <div class="gantt-task-list-header">Task Name</div>
          <div class="gantt-task-list-body" id="gantt-task-list-body">
            ${rows.map(r => renderTaskListRow(r)).join('')}
          </div>
        </div>
        <div class="gantt-timeline" id="gantt-timeline">
          <div class="gantt-timeline-header" style="width:${totalDays * cellWidth}px;">
            ${renderTimelineHeader(minDate, totalDays)}
          </div>
          <div class="gantt-timeline-body" id="gantt-timeline-body" style="width:${totalDays * cellWidth}px;position:relative;">
            ${renderWeekendColumns(minDate, totalDays)}
            ${renderTodayLine(minDate, today, totalDays)}
            ${rows.map((r, i) => renderTimelineRow(r, i, minDate, totalDays)).join('')}
            ${renderDependencies(rows, minDate)}
          </div>
        </div>
      </div>
    </div>`;

    container.innerHTML = html;
    setupScrollSync();
    setTimeout(() => scrollToToday(), 100);
  }

  function groupTasks(tasks) {
    if (groupBy === 'none') return [{ name: '', id: 'all', tasks, color: '' }];

    const map = new Map();
    tasks.forEach(t => {
      let key, name, color;
      if (groupBy === 'bucket') {
        key = t.bucketId;
        const b = Store.getBucket(t.bucketId);
        name = b ? b.name : 'Unassigned';
        color = '#6366f1';
      } else if (groupBy === 'assignee') {
        if (t.assignees.length === 0) {
          key = '__none__';
          name = 'Unassigned';
          color = '#94a3b8';
        } else {
          key = t.assignees[0];
          const m = Store.getMember(t.assignees[0]);
          name = m ? m.name : 'Unknown';
          color = m ? m.color : '#94a3b8';
        }
      } else if (groupBy === 'pipeline') {
        key = t.pipelineId || '__none__';
        const p = Store.getPipeline(t.pipelineId);
        name = p ? p.name : 'No Pipeline';
        color = p ? p.color : '#94a3b8';
      }
      if (!map.has(key)) map.set(key, { id: key, name, color, tasks: [] });
      map.get(key).tasks.push(t);
    });

    return [...map.values()];
  }

  function renderTaskListRow(row) {
    if (row.type === 'group') {
      const collapsed = collapsedGroups.has(row.id);
      return `<div class="gantt-group-row ${collapsed ? 'collapsed' : ''}" onclick="GanttView.toggleGroup('${row.id}')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        <span style="width:8px;height:8px;border-radius:50%;background:${row.color};flex-shrink:0;"></span>
        <span style="flex:1;">${esc(row.name)}</span>
        <span class="column-count">${row.count}</span>
      </div>`;
    }
    const t = row.task;
    const m = t.assignees[0] ? Store.getMember(t.assignees[0]) : null;
    const pColor = { urgent: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#94a3b8' }[t.priority] || '#94a3b8';
    return `<div class="gantt-task-row" onclick="TaskPanel.open('${t.id}')">
      <span class="priority-dot" style="background:${pColor};"></span>
      <span class="task-name">${esc(t.title)}</span>
      ${m ? `<span class="task-assignee" style="background:${m.color};">${initials(m.name)}</span>` : ''}
    </div>`;
  }

  function renderTimelineHeader(startDate, totalDays) {
    let topHtml = '', bottomHtml = '';

    if (zoom === 'year') {
      const years = new Map();
      const quarters = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const yr = '' + d.getFullYear();
        const q = Math.floor(d.getMonth() / 3) + 1;
        const qk = d.getFullYear() + '-Q' + q;
        if (!years.has(yr)) years.set(yr, { name: yr, count: 0 });
        years.get(yr).count++;
        if (!quarters.has(qk)) quarters.set(qk, { name: 'Q' + q, count: 0 });
        quarters.get(qk).count++;
      }
      years.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;font-weight:700;">${v.name}</div>`; });
      quarters.forEach(v => { bottomHtml += `<div class="gantt-header-day" style="width:${v.count * cellWidth}px;min-width:${v.count * cellWidth}px;">${v.name}</div>`; });
    } else if (zoom === 'quarter') {
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
      const months = new Map();
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const mk = d.getFullYear() + '-' + d.getMonth();
        if (!months.has(mk)) months.set(mk, { name: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), count: 0 });
        months.get(mk).count++;
        const isToday = d.toDateString() === new Date().toDateString();
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        let dayLabel = '';
        if (zoom === 'day') dayLabel = d.getDate();
        else if (zoom === 'week') dayLabel = d.getDate();
        else dayLabel = d.getDate() % 5 === 1 ? d.getDate() : '';
        bottomHtml += `<div class="gantt-header-day ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}" style="width:${cellWidth}px;min-width:${cellWidth}px;" title="${d.toLocaleDateString()}">${dayLabel}</div>`;
      }
      months.forEach(v => { topHtml += `<div class="gantt-header-month" style="width:${v.count * cellWidth}px;">${v.name}</div>`; });
    }

    return `<div class="gantt-header-months">${topHtml}</div><div class="gantt-header-days">${bottomHtml}</div>`;
  }

  function renderWeekendColumns(startDate, totalDays) {
    let html = '';
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) {
        html += `<div class="gantt-weekend-col" style="left:${i * cellWidth}px;width:${cellWidth}px;"></div>`;
      }
    }
    return html;
  }

  function renderTodayLine(startDate, today, totalDays) {
    const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > totalDays) return '';
    return `<div class="gantt-today-line" style="left:${diffDays * cellWidth + cellWidth / 2}px;"></div>`;
  }

  function renderTimelineRow(row, idx, startDate, totalDays) {
    if (row.type === 'group') {
      if (showGroupBars && row.groupStart && row.groupEnd) {
        const startDiff = Math.floor((row.groupStart - startDate) / (1000 * 60 * 60 * 24));
        const duration = Math.max(1, Math.ceil((row.groupEnd - row.groupStart) / (1000 * 60 * 60 * 24)) + 1);
        const barLeft = startDiff * cellWidth;
        const barWidth = duration * cellWidth;
        return `<div class="gantt-grid-row group-row">
          <div class="gantt-group-bar" style="left:${barLeft}px;width:${barWidth}px;background:${row.color};">
            <span class="gantt-group-bar-label">${esc(row.name)}</span>
          </div>
        </div>`;
      }
      return `<div class="gantt-grid-row group-row"></div>`;
    }

    const t = row.task;
    const start = new Date(t.startDate + 'T00:00:00');
    const end = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : new Date(start);
    const startDiff = Math.floor((start - startDate) / (1000 * 60 * 60 * 24));
    const duration = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
    const barLeft = startDiff * cellWidth;
    const barWidth = duration * cellWidth;

    const barColor = getTaskColor(t);
    const showLabel = barWidth > 60;

    return `<div class="gantt-grid-row">
      <div class="gantt-bar" style="left:${barLeft}px;width:${barWidth}px;background:${barColor};"
           data-task-id="${t.id}"
           onclick="TaskPanel.open('${t.id}')"
           onmousedown="GanttView.startDrag(event, '${t.id}', ${startDiff}, ${duration})">
        <div class="bar-progress" style="width:${t.progress}%;"></div>
        ${showLabel ? `<span class="bar-label">${esc(t.title)}</span>` : ''}
        <div class="resize-handle left" onmousedown="GanttView.startResize(event, '${t.id}', 'left', ${startDiff}, ${duration})"></div>
        <div class="resize-handle right" onmousedown="GanttView.startResize(event, '${t.id}', 'right', ${startDiff}, ${duration})"></div>
      </div>
    </div>`;
  }

  function renderDependencies(rows, startDate) {
    let svg = '';
    const taskRows = rows.reduce((acc, r, i) => {
      if (r.type === 'task') acc[r.task.id] = i;
      return acc;
    }, {});

    rows.forEach((r, i) => {
      if (r.type !== 'task') return;
      const t = r.task;
      if (!t.dependencies || !t.dependencies.length) return;

      t.dependencies.forEach(depId => {
        const depRow = taskRows[depId];
        if (depRow === undefined) return;
        const dep = Store.getTask(depId);
        if (!dep || !dep.dueDate || !t.startDate) return;

        const depEnd = new Date(dep.dueDate + 'T00:00:00');
        const taskStart = new Date(t.startDate + 'T00:00:00');
        const depEndX = Math.floor((depEnd - startDate) / (1000 * 60 * 60 * 24)) * cellWidth + cellWidth;
        const taskStartX = Math.floor((taskStart - startDate) / (1000 * 60 * 60 * 24)) * cellWidth;
        const depY = depRow * 42 + 21;
        const taskY = i * 42 + 21;

        const midX = (depEndX + taskStartX) / 2;

        svg += `<svg class="gantt-dependency" style="left:0;top:0;width:100%;height:100%;position:absolute;">
          <path d="M ${depEndX} ${depY} C ${midX} ${depY}, ${midX} ${taskY}, ${taskStartX} ${taskY}"
                stroke-dasharray="4 2" />
          <polygon points="${taskStartX},${taskY} ${taskStartX - 6},${taskY - 4} ${taskStartX - 6},${taskY + 4}" />
        </svg>`;
      });
    });

    return svg;
  }

  function getTaskColor(task) {
    if (task.pipelineId) {
      const p = Store.getPipeline(task.pipelineId);
      if (p) return p.color;
    }
    const colors = { urgent: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#64748b' };
    return colors[task.priority] || '#6366f1';
  }

  // Scroll sync
  function setupScrollSync() {
    const timeline = document.getElementById('gantt-timeline');
    const taskList = document.getElementById('gantt-task-list-body');
    if (!timeline || !taskList) return;

    timeline.addEventListener('scroll', () => {
      if (scrollSync) taskList.scrollTop = timeline.scrollTop;
    });
    taskList.addEventListener('scroll', () => {
      if (scrollSync) timeline.scrollTop = taskList.scrollTop;
    });
  }

  function scrollToToday() {
    const timeline = document.getElementById('gantt-timeline');
    const todayLine = timeline ? timeline.querySelector('.gantt-today-line') : null;
    if (todayLine && timeline) {
      const left = parseInt(todayLine.style.left) - timeline.clientWidth / 3;
      timeline.scrollLeft = Math.max(0, left);
    }
  }

  // Drag to move bars
  function startDrag(e, taskId, startDay, duration) {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    const timeline = document.getElementById('gantt-timeline-body');
    if (!timeline) return;

    dragState = { taskId, startDay, duration, type: 'move', startX: e.clientX };

    const onMove = (ev) => {
      const dx = ev.clientX - dragState.startX;
      const dayDelta = Math.round(dx / cellWidth);
      const bar = timeline.querySelector(`.gantt-bar[data-task-id="${taskId}"]`);
      if (bar) {
        bar.style.left = (dragState.startDay + dayDelta) * cellWidth + 'px';
      }
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dx = ev.clientX - dragState.startX;
      const dayDelta = Math.round(dx / cellWidth);
      if (dayDelta !== 0) {
        const task = Store.getTask(taskId);
        if (task) {
          const s = new Date(task.startDate + 'T00:00:00');
          s.setDate(s.getDate() + dayDelta);
          const updates = { startDate: dateStr(s) };
          if (task.dueDate) {
            const d = new Date(task.dueDate + 'T00:00:00');
            d.setDate(d.getDate() + dayDelta);
            updates.dueDate = dateStr(d);
          }
          Store.updateTask(taskId, updates);
          render(App.getFilters());
        }
      }
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Resize bars
  function startResize(e, taskId, side, startDay, duration) {
    e.preventDefault();
    e.stopPropagation();
    const timeline = document.getElementById('gantt-timeline-body');
    if (!timeline) return;

    dragState = { taskId, startDay, duration, type: 'resize', side, startX: e.clientX };

    const onMove = (ev) => {
      const dx = ev.clientX - dragState.startX;
      const dayDelta = Math.round(dx / cellWidth);
      const bar = timeline.querySelector(`.gantt-bar[data-task-id="${taskId}"]`);
      if (!bar) return;

      if (side === 'left') {
        const newStart = dragState.startDay + dayDelta;
        const newDuration = dragState.duration - dayDelta;
        if (newDuration >= 1) {
          bar.style.left = newStart * cellWidth + 'px';
          bar.style.width = newDuration * cellWidth + 'px';
        }
      } else {
        const newDuration = dragState.duration + dayDelta;
        if (newDuration >= 1) {
          bar.style.width = newDuration * cellWidth + 'px';
        }
      }
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dx = ev.clientX - dragState.startX;
      const dayDelta = Math.round(dx / cellWidth);
      if (dayDelta !== 0) {
        const task = Store.getTask(taskId);
        if (task) {
          if (side === 'left') {
            const s = new Date(task.startDate + 'T00:00:00');
            s.setDate(s.getDate() + dayDelta);
            Store.updateTask(taskId, { startDate: dateStr(s) });
          } else {
            const d = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : new Date(task.startDate + 'T00:00:00');
            d.setDate(d.getDate() + dayDelta);
            Store.updateTask(taskId, { dueDate: dateStr(d) });
          }
          render(App.getFilters());
        }
      }
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function setZoom(z) {
    zoom = z;
    render(App.getFilters());
  }

  function setGroupBy(g) {
    groupBy = g;
    collapsedGroups.clear();
    render(App.getFilters());
  }

  function toggleGroupBars(val) {
    showGroupBars = val;
    render(App.getFilters());
  }

  function toggleGroup(id) {
    if (collapsedGroups.has(id)) collapsedGroups.delete(id);
    else collapsedGroups.add(id);
    render(App.getFilters());
  }

  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

  return { init, render, setZoom, setGroupBy, toggleGroup, toggleGroupBars, scrollToToday, startDrag, startResize };
})();
