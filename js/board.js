// board.js — Kanban board view

const BoardView = (() => {
  let container = null;

  function init(el) {
    container = el;
  }

  function render(filters = {}) {
    const buckets = Store.getBuckets();
    if (!buckets.length) {
      container.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <h3>No buckets yet</h3>
        <p>Create a bucket to start organizing your tasks</p>
      </div>`;
      return;
    }

    let html = '<div class="board-view">';

    buckets.forEach(bucket => {
      let tasks = Store.getTasksForBucket(bucket.id);
      if (filters.search) {
        const q = filters.search.toLowerCase();
        tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)));
      }
      if (filters.assignee) tasks = tasks.filter(t => t.assignees.includes(filters.assignee));
      if (filters.label) tasks = tasks.filter(t => t.labels.includes(filters.label));
      if (filters.priority) tasks = tasks.filter(t => t.priority === filters.priority);

      const colors = { 'To Do': '#64748b', 'In Progress': '#6366f1', 'Review': '#f59e0b', 'Done': '#22c55e' };
      const dotColor = colors[bucket.name] || '#6366f1';

      html += `
        <div class="board-column" data-bucket-id="${bucket.id}">
          <div class="column-header">
            <span class="column-color-dot" style="background:${dotColor}"></span>
            <span class="column-name">${esc(bucket.name)}</span>
            <span class="column-count">${tasks.length}</span>
            <div class="column-actions">
              <button onclick="BoardView.renameBucket('${bucket.id}')" title="Rename">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button onclick="BoardView.removeBucket('${bucket.id}')" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          <div class="column-body" data-bucket-id="${bucket.id}"
               ondragover="BoardView.onDragOver(event)" ondragleave="BoardView.onDragLeave(event)"
               ondrop="BoardView.onDrop(event, '${bucket.id}')">
            ${tasks.map(t => renderCard(t)).join('')}
          </div>
          <div class="column-footer">
            <button class="add-task-btn" onclick="BoardView.addTask('${bucket.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              Add task
            </button>
          </div>
        </div>`;
    });

    html += `
      <button class="add-column-btn" onclick="BoardView.addBucket()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Add Bucket
      </button>
    </div>`;

    container.innerHTML = html;
  }

  function renderCard(task) {
    const labels = task.labels.map(id => Store.getLabel(id)).filter(Boolean);
    const assignees = task.assignees.map(id => Store.getMember(id)).filter(Boolean);
    const checkDone = task.checklist.filter(c => c.checked).length;
    const checkTotal = task.checklist.length;
    const progressColor = task.progress >= 100 ? 'var(--success)' : task.progress > 50 ? 'var(--accent)' : 'var(--warning)';

    return `
      <div class="task-card" draggable="true" data-task-id="${task.id}"
           ondragstart="BoardView.onDragStart(event, '${task.id}')"
           onclick="TaskPanel.open('${task.id}')">
        <div class="priority-indicator priority-${task.priority}"></div>
        ${labels.length ? `
        <div class="task-card-labels">
          ${labels.map(l => `<span class="task-label" style="background:${l.color}">${esc(l.name)}</span>`).join('')}
        </div>` : ''}
        <div class="task-card-title">${esc(task.title)}</div>
        <div class="task-card-meta">
          <div class="task-card-avatars">
            ${assignees.map(m => `<span class="avatar" style="background:${m.color}" title="${esc(m.name)}">${initials(m.name)}</span>`).join('')}
          </div>
          <div class="task-card-info">
            ${task.dueDate ? `<span title="Due ${task.dueDate}">${formatShortDate(task.dueDate)}</span>` : ''}
            ${checkTotal > 0 ? `<span>${checkDone}/${checkTotal}</span>` : ''}
          </div>
        </div>
        ${task.progress > 0 ? `
        <div class="task-progress-bar">
          <div class="task-progress-fill" style="width:${task.progress}%;background:${progressColor}"></div>
        </div>` : ''}
      </div>`;
  }

  // Drag & Drop
  function onDragStart(e, taskId) {
    e.dataTransfer.setData('text/plain', taskId);
    e.target.classList.add('dragging');
  }

  function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function onDrop(e, bucketId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      Store.updateTask(taskId, { bucketId });
      render(App.getFilters());
    }
  }

  async function addTask(bucketId) {
    const result = await Modal.show({
      title: 'New Task',
      fields: [
        { type: 'text', key: 'title', label: 'Title', placeholder: 'Enter task title...', autofocus: true },
        { type: 'select', key: 'priority', label: 'Priority', value: 'medium', options: [
          { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
        ]},
      ],
      confirmText: 'Create Task'
    });
    if (!result || !result.title) return;
    Store.addTask({ title: result.title, bucketId, priority: result.priority });
    render(App.getFilters());
    App.toast('Task created', 'success');
  }

  async function addBucket() {
    const result = await Modal.show({
      title: 'Add Bucket',
      fields: [{ type: 'text', key: 'name', label: 'Bucket Name', placeholder: 'e.g. To Do, In Progress...', autofocus: true }],
      confirmText: 'Add Bucket'
    });
    if (!result || !result.name) return;
    Store.addBucket(result.name);
    render(App.getFilters());
    App.toast('Bucket added', 'success');
  }

  async function renameBucket(id) {
    const bucket = Store.getBucket(id);
    if (!bucket) return;
    const result = await Modal.show({
      title: 'Rename Bucket',
      fields: [{ type: 'text', key: 'name', label: 'Bucket Name', value: bucket.name, autofocus: true }],
      confirmText: 'Save'
    });
    if (!result || !result.name) return;
    Store.updateBucket(id, { name: result.name });
    render(App.getFilters());
  }

  async function removeBucket(id) {
    const confirmed = await Modal.confirm({
      title: 'Delete Bucket',
      message: 'Are you sure you want to delete this bucket? All tasks in it will be moved to the first remaining bucket.'
    });
    if (!confirmed) return;
    Store.deleteBucket(id);
    render(App.getFilters());
    App.toast('Bucket deleted', 'info');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function initials(name) {
    return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function formatShortDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return { init, render, onDragStart, onDragOver, onDragLeave, onDrop, addTask, addBucket, renameBucket, removeBucket };
})();
