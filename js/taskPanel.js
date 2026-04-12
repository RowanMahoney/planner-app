// taskPanel.js — Slide-out task detail editor

const TaskPanel = (() => {
  let currentTaskId = null;
  let panelEl = null;
  let overlayEl = null;

  function init() {
    overlayEl = document.getElementById('panel-overlay');
    panelEl = document.getElementById('task-panel');
    overlayEl.addEventListener('click', close);
  }

  function open(taskId) {
    const task = Store.getTask(taskId);
    if (!task) return;
    currentTaskId = taskId;
    render(task);
    overlayEl.classList.add('open');
    panelEl.classList.add('open');
  }

  function close() {
    overlayEl.classList.remove('open');
    panelEl.classList.remove('open');
    currentTaskId = null;
  }

  function render(task) {
    const buckets = Store.getBuckets();
    const pipelines = Store.getPipelines();
    const members = Store.getMembers();
    const labels = Store.getLabels();
    const pipeline = task.pipelineId ? Store.getPipeline(task.pipelineId) : null;
    const checklistDone = task.checklist.filter(c => c.checked).length;
    const checklistTotal = task.checklist.length;

    // Save panel scroll position before replacing DOM
    const prevBody = panelEl.querySelector('.panel-body');
    const savedScroll = prevBody ? prevBody.scrollTop : 0;

    panelEl.innerHTML = `
      <div class="panel-header">
        <span class="panel-header-title">Task Details</span>
        <button class="btn-icon" onclick="TaskPanel.close()" title="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="panel-body">
        <div class="form-group">
          <input class="form-input" id="panel-title" value="${escHTML(task.title)}"
                 style="font-size:16px;font-weight:600;"
                 placeholder="Task title" />
        </div>

        <div class="form-group">
          <label class="form-label">Checklist ${checklistTotal > 0 ? `(${checklistDone}/${checklistTotal})` : ''}</label>
          ${checklistTotal > 0 ? `
          <div class="task-progress-bar" style="margin-bottom:8px;">
            <div class="task-progress-fill" style="width:${checklistTotal > 0 ? (checklistDone/checklistTotal*100) : 0}%;background:var(--accent);"></div>
          </div>` : ''}
          <div id="panel-checklist">
            ${task.checklist.map((item, i) => `
              <div class="checklist-item ${item.checked ? 'checked' : ''}">
                <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="TaskPanel.toggleCheck(${i})" />
                <span>${escHTML(item.text)}</span>
                <button class="btn-icon" onclick="TaskPanel.removeCheck(${i})" style="padding:2px;">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>`).join('')}
          </div>
          <div class="checklist-add">
            <input id="panel-check-input" placeholder="Add checklist item..."
                   onkeydown="if(event.key==='Enter')TaskPanel.addCheck()" />
            <button class="btn btn-secondary" onclick="TaskPanel.addCheck()">Add</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-textarea" id="panel-desc" placeholder="Add a description...">${escHTML(task.description)}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Bucket</label>
            <select class="form-select" id="panel-bucket">
              ${buckets.map(b => `<option value="${b.id}" ${b.id === task.bucketId ? 'selected' : ''}>${escHTML(b.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select class="form-select" id="panel-priority">
              <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Start Date</label>
            <input type="date" class="form-input" id="panel-start" value="${task.startDate || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Due Date</label>
            <input type="date" class="form-input" id="panel-due" value="${task.dueDate || ''}" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Project</label>
          <select class="form-select" id="panel-group">
            <option value="">None</option>
            ${Store.getGroups().map(g => `<option value="${g.id}" ${g.taskIds.includes(task.id) ? 'selected' : ''}>${escHTML(g.name)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Phase</label>
          <select class="form-select" id="panel-pipeline">
            <option value="">None</option>
            ${pipelines.map(p => `<option value="${p.id}" ${p.id === task.pipelineId ? 'selected' : ''}>${escHTML(p.name)}</option>`).join('')}
          </select>
        </div>

        ${pipeline ? `
        <div class="form-group">
          <label class="form-label">Stage</label>
          <select class="form-select" id="panel-stage">
            <option value="" ${!task.stage ? 'selected' : ''}>None</option>
            ${pipeline.stages.map(s => `<option value="${s}" ${s === task.stage ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>` : ''}

        <div class="form-group">
          <label class="form-label">Progress (${task.progress}%)</label>
          <input type="range" id="panel-progress" min="0" max="100" value="${task.progress}"
                 style="width:100%;accent-color:var(--accent);" />
        </div>

        <div class="form-group">
          <label class="form-label">Assignees</label>
          <div class="chip-select" id="panel-assignees">
            ${members.map(m => `
              <span class="chip ${task.assignees.includes(m.id) ? 'selected' : ''}"
                    data-id="${m.id}" onclick="TaskPanel.toggleAssignee('${m.id}')">
                <span style="width:8px;height:8px;border-radius:50%;background:${m.color};display:inline-block;"></span>
                ${escHTML(m.name)}
              </span>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Labels</label>
          <div class="chip-select" id="panel-labels">
            ${labels.map(l => `
              <span class="chip ${task.labels.includes(l.id) ? 'selected' : ''}"
                    data-id="${l.id}" onclick="TaskPanel.toggleLabel('${l.id}')"
                    style="${task.labels.includes(l.id) ? `background:${l.color}22;border-color:${l.color};color:${l.color};` : ''}">
                <span style="width:8px;height:8px;border-radius:50%;background:${l.color};display:inline-block;"></span>
                ${escHTML(l.name)}
              </span>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Validation Actions</label>
          <div id="panel-validation-actions">
            ${(task.validationActions || []).map((va, i) => `
              <div class="validation-action-item">
                <span class="validation-action-label">Action - ${escHTML(va)}</span>
                <button class="btn-icon" onclick="TaskPanel.removeValidationAction(${i})" style="padding:2px;">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>`).join('')}
          </div>
          <div class="checklist-add">
            <input id="panel-va-input" placeholder="e.g. 1234"
                   onkeydown="if(event.key==='Enter')TaskPanel.addValidationAction()" />
            <button class="btn btn-secondary" onclick="TaskPanel.addValidationAction()">Add</button>
          </div>
        </div>

        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);">
          <div class="text-sm text-muted">Created: ${formatDate(task.createdAt)}</div>
          <div class="text-sm text-muted">Updated: ${formatDate(task.updatedAt)}</div>
        </div>
      </div>
      <div class="panel-footer">
        <button class="btn btn-danger" onclick="TaskPanel.deleteTask()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          Delete
        </button>
        <button class="btn btn-primary" onclick="TaskPanel.save()">Save Changes</button>
      </div>
    `;

    // Live update listeners
    const progressInput = document.getElementById('panel-progress');
    if (progressInput) {
      progressInput.addEventListener('input', (e) => {
        const label = progressInput.closest('.form-group').querySelector('.form-label');
        label.textContent = `Progress (${e.target.value}%)`;
      });
    }

    const pipelineSelect = document.getElementById('panel-pipeline');
    if (pipelineSelect) {
      pipelineSelect.addEventListener('change', () => {
        save();
        open(currentTaskId);
      });
    }

    // Restore panel scroll position
    const newBody = panelEl.querySelector('.panel-body');
    if (newBody) newBody.scrollTop = savedScroll;
  }

  function save() {
    if (!currentTaskId) return;
    const updates = {
      title: document.getElementById('panel-title').value,
      description: document.getElementById('panel-desc').value,
      bucketId: document.getElementById('panel-bucket').value,
      priority: document.getElementById('panel-priority').value,
      startDate: document.getElementById('panel-start').value,
      dueDate: document.getElementById('panel-due').value,
      pipelineId: document.getElementById('panel-pipeline').value,
      progress: parseInt(document.getElementById('panel-progress').value),
    };
    const stageEl = document.getElementById('panel-stage');
    if (stageEl) updates.stage = stageEl.value;
    else if (!updates.pipelineId) updates.stage = '';

    // Collect assignees
    updates.assignees = [...document.querySelectorAll('#panel-assignees .chip.selected')].map(c => c.dataset.id);
    // Collect labels
    updates.labels = [...document.querySelectorAll('#panel-labels .chip.selected')].map(c => c.dataset.id);
    // Handle group (project) assignment
    const groupEl = document.getElementById('panel-group');
    if (groupEl) {
      const newGroupId = groupEl.value;
      // Remove from all groups first
      Store.getGroups().forEach(g => {
        const idx = g.taskIds.indexOf(currentTaskId);
        if (idx > -1) {
          g.taskIds.splice(idx, 1);
          Store.updateGroup(g.id, { taskIds: g.taskIds });
        }
      });
      // Add to selected group
      if (newGroupId) {
        const group = Store.getGroup(newGroupId);
        if (group && !group.taskIds.includes(currentTaskId)) {
          group.taskIds.push(currentTaskId);
          Store.updateGroup(group.id, { taskIds: group.taskIds });
        }
      }
    }

    Store.updateTask(currentTaskId, updates);
    App.toast('Task updated', 'success');
  }

  function toggleAssignee(memberId) {
    const chip = document.querySelector(`#panel-assignees .chip[data-id="${memberId}"]`);
    if (chip) chip.classList.toggle('selected');
  }

  function toggleLabel(labelId) {
    const chip = document.querySelector(`#panel-labels .chip[data-id="${labelId}"]`);
    if (chip) {
      chip.classList.toggle('selected');
      const label = Store.getLabel(labelId);
      if (chip.classList.contains('selected')) {
        chip.style.background = label.color + '22';
        chip.style.borderColor = label.color;
        chip.style.color = label.color;
      } else {
        chip.style.background = '';
        chip.style.borderColor = '';
        chip.style.color = '';
      }
    }
  }

  function toggleDep(taskId) {
    const chip = document.querySelector(`#panel-deps .chip[data-id="${taskId}"]`);
    if (chip) chip.classList.toggle('selected');
  }

  function toggleCheck(idx) {
    const task = Store.getTask(currentTaskId);
    if (!task) return;
    task.checklist[idx].checked = !task.checklist[idx].checked;
    Store.updateTask(currentTaskId, { checklist: task.checklist });
    render(task);
  }

  function addCheck() {
    const input = document.getElementById('panel-check-input');
    if (!input || !input.value.trim()) return;
    const task = Store.getTask(currentTaskId);
    if (!task) return;
    task.checklist.push({ text: input.value.trim(), checked: false });
    Store.updateTask(currentTaskId, { checklist: task.checklist });
    render(task);
  }

  function removeCheck(idx) {
    const task = Store.getTask(currentTaskId);
    if (!task) return;
    task.checklist.splice(idx, 1);
    Store.updateTask(currentTaskId, { checklist: task.checklist });
    render(task);
  }

  function addValidationAction() {
    const input = document.getElementById('panel-va-input');
    if (!input || !input.value.trim()) return;
    const task = Store.getTask(currentTaskId);
    if (!task) return;
    if (!task.validationActions) task.validationActions = [];
    task.validationActions.push(input.value.trim());
    Store.updateTask(currentTaskId, { validationActions: task.validationActions });
    render(task);
  }

  function removeValidationAction(idx) {
    const task = Store.getTask(currentTaskId);
    if (!task || !task.validationActions) return;
    task.validationActions.splice(idx, 1);
    Store.updateTask(currentTaskId, { validationActions: task.validationActions });
    render(task);
  }

  async function deleteTask() {
    if (!currentTaskId) return;
    const confirmed = await Modal.confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.'
    });
    if (!confirmed) return;
    Store.deleteTask(currentTaskId);
    close();
    App.toast('Task deleted', 'info');
  }

  function escHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }


  return { init, open, close, save, toggleAssignee, toggleLabel, toggleCheck, addCheck, removeCheck, addValidationAction, removeValidationAction, deleteTask };
})();
