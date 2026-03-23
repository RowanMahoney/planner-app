// list.js — List/table view

const ListView = (() => {
  let container = null;
  let sortCol = 'title';
  let sortDir = 'asc';

  function init(el) {
    container = el;
  }

  function render(filters = {}) {
    let tasks = filters.search || filters.assignee || filters.label || filters.priority
      ? Store.filterTasks(filters)
      : Store.getTasks();

    // Sort
    tasks = [...tasks].sort((a, b) => {
      let va = a[sortCol] || '';
      let vb = b[sortCol] || '';
      if (sortCol === 'progress') { va = a.progress; vb = b.progress; }
      if (sortCol === 'priority') {
        const order = { urgent: 0, high: 1, medium: 2, low: 3 };
        va = order[a.priority] ?? 4;
        vb = order[b.priority] ?? 4;
      }
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });

    const today = new Date().toISOString().slice(0, 10);

    const columns = [
      { key: 'title', label: 'Task' },
      { key: 'bucketId', label: 'Bucket' },
      { key: 'priority', label: 'Priority' },
      { key: 'assignees', label: 'Assignees' },
      { key: 'startDate', label: 'Start' },
      { key: 'dueDate', label: 'Due' },
      { key: 'progress', label: 'Progress' },
      { key: 'stage', label: 'Stage' },
    ];

    let html = `<div class="list-view"><table class="list-table">
      <thead><tr>
        ${columns.map(c => `
          <th class="${sortCol === c.key ? 'sorted' : ''}" onclick="ListView.sort('${c.key}')">
            ${c.label}
            <span class="sort-icon">${sortCol === c.key ? (sortDir === 'asc' ? '&#9650;' : '&#9660;') : '&#9650;'}</span>
          </th>`).join('')}
      </tr></thead>
      <tbody>`;

    if (tasks.length === 0) {
      html += `<tr><td colspan="${columns.length}" style="text-align:center;padding:40px;color:var(--text-muted);">No tasks found</td></tr>`;
    }

    tasks.forEach(t => {
      const assignees = t.assignees.map(id => Store.getMember(id)).filter(Boolean);
      const isOverdue = t.dueDate && t.dueDate < today && t.progress < 100;
      const progressColor = t.progress >= 100 ? 'var(--success)' : t.progress > 50 ? 'var(--accent)' : 'var(--warning)';

      html += `<tr onclick="TaskPanel.open('${t.id}')">
        <td>
          <div class="flex items-center gap-8">
            <span class="priority-dot" style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${priorityColor(t.priority)};display:inline-block;"></span>
            <span class="list-task-title">${esc(t.title)}</span>
          </div>
        </td>
        <td>${esc(Store.getBucketName(t.bucketId))}</td>
        <td><span class="list-priority ${t.priority}">${capitalize(t.priority)}</span></td>
        <td>
          <div class="flex" style="gap:0;">
            ${assignees.map(m => `<span class="avatar" style="background:${m.color};width:22px;height:22px;font-size:9px;" title="${esc(m.name)}">${initials(m.name)}</span>`).join('')}
          </div>
        </td>
        <td class="list-date">${formatShort(t.startDate)}</td>
        <td class="list-date ${isOverdue ? 'overdue' : ''}">${formatShort(t.dueDate)}</td>
        <td>
          <div class="list-progress">
            <div class="list-progress-bar"><div class="list-progress-fill" style="width:${t.progress}%;background:${progressColor}"></div></div>
            <span class="list-progress-text">${t.progress}%</span>
          </div>
        </td>
        <td><span class="text-sm text-secondary">${esc(t.stage || '-')}</span></td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function sort(col) {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = 'asc'; }
    render(App.getFilters());
  }

  function priorityColor(p) {
    return { urgent: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#94a3b8' }[p] || '#94a3b8';
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function formatShort(d) {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return { init, render, sort };
})();
