// pipeline.js — Pipeline view

const PipelineView = (() => {
  let container = null;

  function init(el) {
    container = el;
  }

  function render(filters = {}) {
    const pipelines = Store.getPipelines();

    if (!pipelines.length) {
      container.innerHTML = `
        <div class="pipeline-view">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.5"/><circle cx="14" cy="12" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>
            <h3>No pipelines yet</h3>
            <p>Create a pipeline to track tasks through custom stages</p>
            <button class="btn btn-primary" style="margin-top:16px;" onclick="PipelineView.addPipeline()">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              Create Pipeline
            </button>
          </div>
        </div>`;
      return;
    }

    let html = '<div class="pipeline-view">';

    pipelines.forEach(pipeline => {
      let tasks = Store.getTasksForPipeline(pipeline.id);
      if (filters.search) {
        const q = filters.search.toLowerCase();
        tasks = tasks.filter(t => t.title.toLowerCase().includes(q));
      }
      if (filters.assignee) tasks = tasks.filter(t => t.assignees.includes(filters.assignee));

      html += `
        <div class="pipeline-container">
          <div class="pipeline-header">
            <div class="pipeline-color-bar" style="background:${pipeline.color}"></div>
            <span class="pipeline-name">${esc(pipeline.name)}</span>
            <span class="pipeline-task-count">${tasks.length} tasks</span>
            <div class="ml-auto flex gap-8">
              <button class="btn btn-ghost btn-icon" onclick="PipelineView.editPipeline('${pipeline.id}')" title="Edit">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon btn-danger" onclick="PipelineView.removePipeline('${pipeline.id}')" title="Delete">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </div>
          <div class="pipeline-stages">
            ${pipeline.stages.map((stage, si) => {
              const stageTasks = tasks.filter(t => t.stage === stage);
              const stageColor = getStageColor(si, pipeline.stages.length, pipeline.color);
              return `
              <div class="pipeline-stage">
                <div class="pipeline-stage-header">
                  <span class="pipeline-stage-name">${esc(stage)}</span>
                  <span class="pipeline-stage-count">${stageTasks.length}</span>
                  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${stageColor};border-radius:var(--radius-md) var(--radius-md) 0 0;"></div>
                </div>
                <div class="pipeline-stage-body" data-pipeline-id="${pipeline.id}" data-stage="${esc(stage)}"
                     ondragover="PipelineView.onDragOver(event)" ondragleave="PipelineView.onDragLeave(event)"
                     ondrop="PipelineView.onDrop(event, '${pipeline.id}', '${esc(stage)}')">
                  ${stageTasks.length === 0 ? '<div class="pipeline-empty">No tasks</div>' : ''}
                  ${stageTasks.map(t => renderPipelineCard(t)).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    });

    html += `
      <div class="add-pipeline-card" onclick="PipelineView.addPipeline()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <div style="margin-top:8px;font-size:14px;font-weight:500;">Add Pipeline</div>
      </div>
    </div>`;

    container.innerHTML = html;
  }

  function renderPipelineCard(task) {
    const assignees = task.assignees.map(id => Store.getMember(id)).filter(Boolean);
    return `
      <div class="pipeline-task-card" draggable="true"
           ondragstart="PipelineView.onDragStart(event, '${task.id}')"
           onclick="TaskPanel.open('${task.id}')">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">
          <div class="flex" style="gap:0;">
            ${assignees.map(m => `<span class="avatar" style="background:${m.color};width:20px;height:20px;font-size:8px;border-width:1px;" title="${esc(m.name)}">${initials(m.name)}</span>`).join('')}
          </div>
          <span>${task.progress}%</span>
        </div>
      </div>`;
  }

  function getStageColor(index, total, baseColor) {
    const opacity = 0.3 + (index / Math.max(total - 1, 1)) * 0.7;
    return baseColor + Math.round(opacity * 255).toString(16).padStart(2, '0');
  }

  // Drag & Drop
  function onDragStart(e, taskId) {
    e.dataTransfer.setData('text/plain', taskId);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function onDrop(e, pipelineId, stage) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      Store.updateTask(taskId, { pipelineId, stage });
      render(App.getFilters());
    }
  }

  async function addPipeline() {
    const result = await Modal.show({
      title: 'Create Pipeline',
      fields: [
        { type: 'text', key: 'name', label: 'Pipeline Name', placeholder: 'e.g. Development, Validation...', autofocus: true },
        { type: 'tags', key: 'stages', label: 'Stages', value: ['Development', 'Validation', 'Regulatory Approval', 'Implementation'], placeholder: 'Add a stage...' },
        { type: 'color-picker', key: 'color', label: 'Color', value: '#6366f1' },
      ],
      confirmText: 'Create Pipeline'
    });
    if (!result || !result.name) return;
    const stages = result.stages && result.stages.length > 0 ? result.stages : ['To Do', 'Done'];
    const pipeline = Store.addPipeline(result.name, stages);
    if (result.color) Store.updatePipeline(pipeline.id, { color: result.color });
    render(App.getFilters());
    App.toast('Pipeline created', 'success');
  }

  async function editPipeline(id) {
    const pipeline = Store.getPipeline(id);
    if (!pipeline) return;
    const result = await Modal.show({
      title: 'Edit Pipeline',
      fields: [
        { type: 'text', key: 'name', label: 'Pipeline Name', value: pipeline.name, autofocus: true },
        { type: 'tags', key: 'stages', label: 'Stages', value: [...pipeline.stages], placeholder: 'Add a stage...' },
        { type: 'color-picker', key: 'color', label: 'Color', value: pipeline.color },
      ],
      confirmText: 'Save Changes'
    });
    if (!result || !result.name) return;
    const stages = result.stages && result.stages.length > 0 ? result.stages : pipeline.stages;
    Store.updatePipeline(id, { name: result.name, stages, color: result.color || pipeline.color });
    render(App.getFilters());
    App.toast('Pipeline updated', 'success');
  }

  async function removePipeline(id) {
    const confirmed = await Modal.confirm({
      title: 'Delete Pipeline',
      message: 'Are you sure you want to delete this pipeline? Tasks assigned to it will be unlinked.'
    });
    if (!confirmed) return;
    Store.deletePipeline(id);
    render(App.getFilters());
    App.toast('Pipeline deleted', 'info');
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

  return { init, render, addPipeline, editPipeline, removePipeline, onDragStart, onDragOver, onDragLeave, onDrop };
})();
