// store.js — Central data store with CRUD, import/export, and event system

const Store = (() => {
  const STORAGE_KEY = 'planner_project_data';
  const IDB_NAME = 'planner_handles';
  const IDB_STORE = 'handles';
  let data = null;
  let fileHandle = null; // File System Access API handle for save-back
  let autoSaveInterval = null;
  const AUTO_SAVE_MS = 30000; // auto-save to file every 30 seconds
  const listeners = new Map();

  // ── IndexedDB helpers for persisting file handle across reloads ──
  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveHandleToIDB(handle) {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, 'fileHandle');
    } catch (e) { console.warn('IDB save handle failed:', e); }
  }

  async function loadHandleFromIDB() {
    try {
      const db = await openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('fileHandle');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async function clearHandleFromIDB() {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete('fileHandle');
    } catch (e) { /* ignore */ }
  }

  // Check if File System Access API is available (requires secure context)
  function hasFileSystemAccess() {
    return typeof window.showOpenFilePicker === 'function';
  }

  function createId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function emit(event, payload) {
    const cbs = listeners.get(event) || [];
    cbs.forEach(cb => cb(payload));
    const allCbs = listeners.get('*') || [];
    allCbs.forEach(cb => cb(event, payload));
    autoSave();
  }

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(cb);
    return () => {
      const arr = listeners.get(event);
      const idx = arr.indexOf(cb);
      if (idx > -1) arr.splice(idx, 1);
    };
  }

  function autoSave() {
    if (!data) return;
    data.meta.lastModified = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  function load(jsonData) {
    if (!jsonData.projectGroups) jsonData.projectGroups = [];
    if (!jsonData.validationActionDefs) jsonData.validationActionDefs = [];
    // Ensure groups have projectGroupId
    (jsonData.groups || []).forEach(g => { if (!g.projectGroupId) g.projectGroupId = ''; });
    data = jsonData;
    emit('dataLoaded', data);
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        data = JSON.parse(raw);
        // Backward compatibility
        if (!data.projectGroups) data.projectGroups = [];
        if (!data.validationActionDefs) data.validationActionDefs = [];
        (data.groups || []).forEach(g => { if (!g.projectGroupId) g.projectGroupId = ''; });
        return true;
      }
    } catch (e) {
      console.warn('Load from storage failed:', e);
    }
    return false;
  }

  async function loadFromFile(file) {
    const text = await file.text();
    const json = JSON.parse(text);
    load(json);
    return json;
  }

  // Load using File System Access API (preserves handle for save-back)
  async function loadFromHandle(handle) {
    fileHandle = handle;
    await saveHandleToIDB(handle);
    const file = await handle.getFile();
    const text = await file.text();
    const json = JSON.parse(text);
    load(json);
    startAutoSaveToFile();
    return json;
  }

  // Restore file handle from IDB after page reload
  async function restoreFileHandle() {
    const handle = await loadHandleFromIDB();
    if (!handle) return false;
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        fileHandle = handle;
        startAutoSaveToFile();
        return true;
      }
      // Permission not granted yet — store handle, will request on next save
      fileHandle = handle;
      return true;
    } catch (e) {
      console.warn('Restore handle failed:', e);
      return false;
    }
  }

  // Save back to the original file handle
  async function saveToFile() {
    if (!data) return false;
    if (!fileHandle) return false;
    if (!hasFileSystemAccess()) return false;
    try {
      // Verify we still have write permission
      const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const req = await fileHandle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') {
          console.warn('Write permission denied');
          return false;
        }
      }
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      return true;
    } catch (e) {
      console.warn('Save to file failed:', e);
      return false;
    }
  }

  // Save As — pick a new file location
  async function saveToFileAs() {
    if (!data || !hasFileSystemAccess()) return false;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: (data.meta.title || 'project').replace(/\s+/g, '-').toLowerCase() + '.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      fileHandle = handle;
      await saveHandleToIDB(handle);
      await saveToFile();
      startAutoSaveToFile();
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Save As failed:', e);
      return false;
    }
  }

  function startAutoSaveToFile() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    if (!fileHandle) return;
    autoSaveInterval = setInterval(async () => {
      if (fileHandle && data) {
        await saveToFile();
      }
    }, AUTO_SAVE_MS);
  }

  function stopAutoSaveToFile() {
    if (autoSaveInterval) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
  }

  function getFileHandle() { return fileHandle; }
  function clearFileHandle() { fileHandle = null; stopAutoSaveToFile(); clearHandleFromIDB(); }

  function exportJSON() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.meta.title || 'project').replace(/\s+/g, '-').toLowerCase() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    if (!data) return;
    const headers = ['ID', 'Title', 'Description', 'Bucket', 'Phase', 'Stage', 'Priority', 'Start Date', 'Due Date', 'Progress', 'Assignees', 'Labels'];
    const rows = data.tasks.map(t => [
      t.id,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      getBucketName(t.bucketId),
      getPipelineName(t.pipelineId),
      t.stage || '',
      t.priority || '',
      t.startDate || '',
      t.dueDate || '',
      t.progress || 0,
      `"${(t.assignees || []).map(id => getMemberName(id)).join(', ')}"`,
      `"${(t.labels || []).map(id => getLabelName(id)).join(', ')}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.meta.title || 'project').replace(/\s+/g, '-').toLowerCase() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Getters
  function getData() { return data; }
  function getTasks() { return data ? data.tasks : []; }
  function getTask(id) { return data ? data.tasks.find(t => t.id === id) : null; }
  function getBuckets() { return data ? data.buckets.sort((a, b) => a.order - b.order) : []; }
  function getBucket(id) { return data ? data.buckets.find(b => b.id === id) : null; }
  function getBucketName(id) { const b = getBucket(id); return b ? b.name : ''; }
  function getPipelines() { return data ? data.pipelines : []; }
  function getPipeline(id) { return data ? data.pipelines.find(p => p.id === id) : null; }
  function getPipelineName(id) { const p = getPipeline(id); return p ? p.name : ''; }
  function getMembers() { return data ? data.members : []; }
  function getMember(id) { return data ? data.members.find(m => m.id === id) : null; }
  function getMemberName(id) { const m = getMember(id); return m ? m.name : ''; }
  function getLabels() { return data ? data.labels : []; }
  function getLabel(id) { return data ? data.labels.find(l => l.id === id) : null; }
  function getLabelName(id) { const l = getLabel(id); return l ? l.name : ''; }
  function getGroups() { return data ? data.groups : []; }
  function getGroup(id) { return data ? data.groups.find(g => g.id === id) : null; }
  function getProjectGroups() { return data ? (data.projectGroups || []) : []; }
  function getProjectGroup(id) { return (data && data.projectGroups) ? data.projectGroups.find(pg => pg.id === id) : null; }

  function getTasksForBucket(bucketId) {
    return getTasks().filter(t => t.bucketId === bucketId).sort((a, b) => a.order - b.order);
  }

  function getTasksForPipeline(pipelineId) {
    return getTasks().filter(t => t.pipelineId === pipelineId);
  }

  // Task CRUD
  function addTask(taskData) {
    const task = {
      id: createId(),
      title: taskData.title || 'New Task',
      description: taskData.description || '',
      bucketId: taskData.bucketId || (data.buckets[0] ? data.buckets[0].id : ''),
      pipelineId: taskData.pipelineId || '',
      stage: taskData.stage || '',
      assignees: taskData.assignees || [],
      labels: taskData.labels || [],
      priority: taskData.priority || 'medium',
      startDate: taskData.startDate || new Date().toISOString().slice(0, 10),
      dueDate: taskData.dueDate || '',
      progress: taskData.progress || 0,
      checklist: taskData.checklist || [],
      validationActions: taskData.validationActions || [],
      dependencies: taskData.dependencies || [],
      order: data.tasks.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.tasks.push(task);
    emit('taskAdded', task);
    return task;
  }

  function updateTask(id, updates) {
    const task = getTask(id);
    if (!task) return null;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    emit('taskUpdated', task);
    return task;
  }

  function deleteTask(id) {
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    const task = data.tasks.splice(idx, 1)[0];
    // Remove from groups
    data.groups.forEach(g => {
      const gi = g.taskIds.indexOf(id);
      if (gi > -1) g.taskIds.splice(gi, 1);
    });
    // Remove from dependencies
    data.tasks.forEach(t => {
      const di = t.dependencies.indexOf(id);
      if (di > -1) t.dependencies.splice(di, 1);
    });
    emit('taskDeleted', task);
    return true;
  }

  // Bucket CRUD
  function addBucket(name) {
    const bucket = { id: createId(), name, order: data.buckets.length };
    data.buckets.push(bucket);
    emit('bucketAdded', bucket);
    return bucket;
  }

  function updateBucket(id, updates) {
    const bucket = getBucket(id);
    if (!bucket) return null;
    Object.assign(bucket, updates);
    emit('bucketUpdated', bucket);
    return bucket;
  }

  function deleteBucket(id) {
    const idx = data.buckets.findIndex(b => b.id === id);
    if (idx === -1) return false;
    data.buckets.splice(idx, 1);
    // Move tasks to first bucket
    const fallback = data.buckets[0] ? data.buckets[0].id : '';
    data.tasks.forEach(t => { if (t.bucketId === id) t.bucketId = fallback; });
    emit('bucketDeleted', { id });
    return true;
  }

  // Pipeline CRUD
  function addPipeline(name, stages) {
    const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444'];
    const pipeline = {
      id: createId(),
      name,
      stages: stages || ['To Do', 'In Progress', 'Done'],
      color: colors[data.pipelines.length % colors.length]
    };
    data.pipelines.push(pipeline);
    emit('pipelineAdded', pipeline);
    return pipeline;
  }

  function updatePipeline(id, updates) {
    const pipeline = getPipeline(id);
    if (!pipeline) return null;
    Object.assign(pipeline, updates);
    emit('pipelineUpdated', pipeline);
    return pipeline;
  }

  function deletePipeline(id) {
    const idx = data.pipelines.findIndex(p => p.id === id);
    if (idx === -1) return false;
    data.pipelines.splice(idx, 1);
    data.tasks.forEach(t => {
      if (t.pipelineId === id) { t.pipelineId = ''; t.stage = ''; }
    });
    emit('pipelineDeleted', { id });
    return true;
  }

  // Member CRUD
  function addMember(name) {
    const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#22c55e'];
    const member = { id: createId(), name, color: colors[data.members.length % colors.length] };
    data.members.push(member);
    emit('memberAdded', member);
    return member;
  }

  function updateMember(id, updates) {
    const member = data.members.find(m => m.id === id);
    if (!member) return null;
    Object.assign(member, updates);
    emit('memberUpdated', member);
    return member;
  }

  function deleteMember(id) {
    const idx = data.members.findIndex(m => m.id === id);
    if (idx === -1) return false;
    data.members.splice(idx, 1);
    // Remove from task assignees
    data.tasks.forEach(t => {
      const ai = t.assignees.indexOf(id);
      if (ai > -1) t.assignees.splice(ai, 1);
    });
    emit('memberDeleted', { id });
    return true;
  }

  // Label CRUD
  function addLabel(name, color) {
    const label = { id: createId(), name, color: color || '#6b7280' };
    data.labels.push(label);
    emit('labelAdded', label);
    return label;
  }

  function updateLabel(id, updates) {
    const label = data.labels.find(l => l.id === id);
    if (!label) return null;
    Object.assign(label, updates);
    emit('labelUpdated', label);
    return label;
  }

  function deleteLabel(id) {
    const idx = data.labels.findIndex(l => l.id === id);
    if (idx === -1) return false;
    data.labels.splice(idx, 1);
    // Remove from task labels
    data.tasks.forEach(t => {
      const li = t.labels.indexOf(id);
      if (li > -1) t.labels.splice(li, 1);
    });
    emit('labelDeleted', { id });
    return true;
  }

  // Group CRUD
  function addGroup(name, taskIds) {
    const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6'];
    const group = { id: createId(), name, color: colors[data.groups.length % colors.length], taskIds: taskIds || [] };
    data.groups.push(group);
    emit('groupAdded', group);
    return group;
  }

  function updateGroup(id, updates) {
    const group = getGroup(id);
    if (!group) return null;
    Object.assign(group, updates);
    emit('groupUpdated', group);
    return group;
  }

  function deleteGroup(id) {
    const idx = data.groups.findIndex(g => g.id === id);
    if (idx === -1) return false;
    data.groups.splice(idx, 1);
    emit('groupDeleted', { id });
    return true;
  }

  // Project Group CRUD
  function addProjectGroup(name) {
    if (!data.projectGroups) data.projectGroups = [];
    const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444'];
    const pg = { id: createId(), name, color: colors[data.projectGroups.length % colors.length] };
    data.projectGroups.push(pg);
    emit('projectGroupAdded', pg);
    return pg;
  }

  function updateProjectGroup(id, updates) {
    const pg = getProjectGroup(id);
    if (!pg) return null;
    Object.assign(pg, updates);
    emit('projectGroupUpdated', pg);
    return pg;
  }

  function deleteProjectGroup(id) {
    if (!data.projectGroups) return false;
    const idx = data.projectGroups.findIndex(pg => pg.id === id);
    if (idx === -1) return false;
    data.projectGroups.splice(idx, 1);
    // Unlink groups
    data.groups.forEach(g => { if (g.projectGroupId === id) g.projectGroupId = ''; });
    emit('projectGroupDeleted', { id });
    return true;
  }

  // Filtering
  function filterTasks(filters) {
    let tasks = getTasks();
    if (filters.search) {
      const q = filters.search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }
    if (filters.assignee) {
      tasks = tasks.filter(t => t.assignees.includes(filters.assignee));
    }
    if (filters.label) {
      tasks = tasks.filter(t => t.labels.includes(filters.label));
    }
    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    if (filters.bucketId) {
      tasks = tasks.filter(t => t.bucketId === filters.bucketId);
    }
    if (filters.pipelineId) {
      tasks = tasks.filter(t => t.pipelineId === filters.pipelineId);
    }
    return tasks;
  }

  // ── Validation Action Definitions ──
  function getValidationActionDefs() { return data ? (data.validationActionDefs || []) : []; }
  function getValidationActionDef(id) { return getValidationActionDefs().find(v => v.id === id); }

  function addValidationActionDef(defData) {
    if (!data.validationActionDefs) data.validationActionDefs = [];
    const def = {
      id: defData.id || createId(),
      name: defData.name || '',
      description: defData.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.validationActionDefs.push(def);
    emit('validationActionDefAdded', def);
    return def;
  }

  function updateValidationActionDef(id, updates) {
    const def = getValidationActionDef(id);
    if (!def) return null;
    Object.assign(def, updates, { updatedAt: new Date().toISOString() });
    emit('validationActionDefUpdated', def);
    return def;
  }

  function deleteValidationActionDef(id) {
    if (!data.validationActionDefs) return;
    const idx = data.validationActionDefs.findIndex(v => v.id === id);
    if (idx > -1) {
      data.validationActionDefs.splice(idx, 1);
      emit('validationActionDefDeleted', id);
    }
  }

  // Initialize with empty project
  function createEmpty(title) {
    load({
      meta: { title: title || 'New Project', lastModified: new Date().toISOString(), version: '1.0' },
      members: [],
      labels: [
        { id: createId(), name: 'Bug', color: '#ef4444' },
        { id: createId(), name: 'Feature', color: '#3b82f6' },
        { id: createId(), name: 'Design', color: '#a855f7' }
      ],
      buckets: [
        { id: createId(), name: 'To Do', order: 0 },
        { id: createId(), name: 'In Progress', order: 1 },
        { id: createId(), name: 'Done', order: 2 }
      ],
      pipelines: [],
      tasks: [],
      groups: [],
      projectGroups: [],
      validationActionDefs: []
    });
  }

  return {
    on, emit, load, loadFromStorage, loadFromFile, loadFromHandle, restoreFileHandle,
    hasFileSystemAccess, saveToFile, saveToFileAs, getFileHandle, clearFileHandle, startAutoSaveToFile, stopAutoSaveToFile,
    exportJSON, exportCSV,
    getData, getTasks, getTask, getBuckets, getBucket, getBucketName,
    getPipelines, getPipeline, getPipelineName,
    getMembers, getMember, getMemberName,
    getLabels, getLabel, getLabelName,
    getGroups, getGroup,
    getProjectGroups, getProjectGroup,
    addProjectGroup, updateProjectGroup, deleteProjectGroup,
    getTasksForBucket, getTasksForPipeline,
    addTask, updateTask, deleteTask,
    addBucket, updateBucket, deleteBucket,
    addPipeline, updatePipeline, deletePipeline,
    addMember, updateMember, deleteMember, addLabel, updateLabel, deleteLabel,
    addGroup, updateGroup, deleteGroup,
    getValidationActionDefs, getValidationActionDef, addValidationActionDef, updateValidationActionDef, deleteValidationActionDef,
    filterTasks, createEmpty, createId
  };
})();
