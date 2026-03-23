// modal.js — Reusable modal dialog system (replaces prompt/confirm)

const Modal = (() => {
  let resolvePromise = null;

  function show({ title, fields, confirmText, confirmClass, cancelText }) {
    return new Promise((resolve) => {
      resolvePromise = resolve;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) dismiss(overlay); };

      const fieldsHtml = (fields || []).map((f, i) => {
        const id = `modal-field-${i}`;
        if (f.type === 'text' || f.type === 'color' || f.type === 'date') {
          return `<div class="form-group">
            <label class="form-label" for="${id}">${esc(f.label)}</label>
            <input class="form-input" type="${f.type}" id="${id}" data-key="${f.key}"
                   value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"
                   ${f.autofocus ? 'autofocus' : ''} />
          </div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="form-group">
            <label class="form-label" for="${id}">${esc(f.label)}</label>
            <textarea class="form-textarea" id="${id}" data-key="${f.key}"
                      placeholder="${esc(f.placeholder || '')}" ${f.autofocus ? 'autofocus' : ''}>${esc(f.value || '')}</textarea>
          </div>`;
        }
        if (f.type === 'select') {
          return `<div class="form-group">
            <label class="form-label" for="${id}">${esc(f.label)}</label>
            <select class="form-select" id="${id}" data-key="${f.key}">
              ${(f.options || []).map(o => {
                const val = typeof o === 'string' ? o : o.value;
                const label = typeof o === 'string' ? o : o.label;
                return `<option value="${esc(val)}" ${val === f.value ? 'selected' : ''}>${esc(label)}</option>`;
              }).join('')}
            </select>
          </div>`;
        }
        if (f.type === 'tags') {
          return `<div class="form-group">
            <label class="form-label">${esc(f.label)}</label>
            <div class="modal-tags-input" id="${id}" data-key="${f.key}">
              <div class="modal-tags-list" id="${id}-list">
                ${(f.value || []).map((tag, ti) => `<span class="modal-tag">${esc(tag)}<button type="button" onclick="Modal.removeTag('${id}', ${ti})">&times;</button></span>`).join('')}
              </div>
              <div class="modal-tags-add">
                <input class="form-input" id="${id}-input" placeholder="${esc(f.placeholder || 'Add and press Enter')}"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();Modal.addTag('${id}')}" />
                <button type="button" class="btn btn-secondary" onclick="Modal.addTag('${id}')">Add</button>
              </div>
            </div>
          </div>`;
        }
        if (f.type === 'color-picker') {
          const colors = f.colors || ['#6366f1','#ec4899','#14b8a6','#f59e0b','#3b82f6','#ef4444','#a855f7','#22c55e','#6b7280','#f97316'];
          return `<div class="form-group">
            <label class="form-label">${esc(f.label)}</label>
            <div class="modal-color-grid" id="${id}" data-key="${f.key}" data-value="${f.value || colors[0]}">
              ${colors.map(c => `<button type="button" class="modal-color-swatch ${c === (f.value || colors[0]) ? 'selected' : ''}"
                style="background:${c}" data-color="${c}"
                onclick="Modal.selectColor('${id}', '${c}')"></button>`).join('')}
            </div>
          </div>`;
        }
        if (f.type === 'checkboxes') {
          return `<div class="form-group">
            <label class="form-label">${esc(f.label)}</label>
            <div class="modal-checkboxes" id="${id}" data-key="${f.key}">
              ${(f.options || []).map((o, oi) => {
                const val = typeof o === 'string' ? o : o.value;
                const label = typeof o === 'string' ? o : o.label;
                const checked = (f.value || []).includes(val);
                return `<label class="modal-checkbox-item">
                  <input type="checkbox" value="${esc(val)}" ${checked ? 'checked' : ''} />
                  <span>${esc(label)}</span>
                </label>`;
              }).join('')}
              <div class="modal-checkbox-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Modal.checkAll('${id}', true)">Select All</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="Modal.checkAll('${id}', false)">Deselect All</button>
              </div>
            </div>
          </div>`;
        }
        if (f.type === 'info') {
          return `<div class="modal-info">${esc(f.text)}</div>`;
        }
        return '';
      }).join('');

      overlay.innerHTML = `
        <div class="modal-card">
          <div class="modal-header">
            <h3>${esc(title || 'Dialog')}</h3>
            <button class="btn-icon" onclick="Modal.dismiss(this.closest('.modal-overlay'))">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <form class="modal-body" onsubmit="event.preventDefault();Modal.submit(this.closest('.modal-overlay'))">
            ${fieldsHtml}
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="Modal.dismiss(this.closest('.modal-overlay'))">${esc(cancelText || 'Cancel')}</button>
              <button type="submit" class="btn ${confirmClass || 'btn-primary'}">${esc(confirmText || 'Confirm')}</button>
            </div>
          </form>
        </div>`;

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));

      // Focus first input
      const firstInput = overlay.querySelector('input:not([type="color"]), textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 50);

      // Escape key
      const onKey = (e) => {
        if (e.key === 'Escape') { dismiss(overlay); document.removeEventListener('keydown', onKey); }
      };
      document.addEventListener('keydown', onKey);
      overlay._onKey = onKey;
    });
  }

  function submit(overlay) {
    const result = {};
    // Gather text/date/select inputs
    overlay.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        result[key] = el.value;
      } else if (el.classList.contains('modal-tags-input')) {
        result[key] = [...el.querySelectorAll('.modal-tag')].map(t => t.firstChild.textContent.trim());
      } else if (el.classList.contains('modal-color-grid')) {
        result[key] = el.dataset.value;
      } else if (el.classList.contains('modal-checkboxes')) {
        result[key] = [...el.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
      }
    });
    cleanup(overlay);
    if (resolvePromise) resolvePromise(result);
    resolvePromise = null;
  }

  function dismiss(overlay) {
    cleanup(overlay);
    if (resolvePromise) resolvePromise(null);
    resolvePromise = null;
  }

  function cleanup(overlay) {
    if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  }

  function addTag(fieldId) {
    const input = document.getElementById(fieldId + '-input');
    const list = document.getElementById(fieldId + '-list');
    if (!input || !list || !input.value.trim()) return;
    const tag = input.value.trim();
    const idx = list.querySelectorAll('.modal-tag').length;
    const span = document.createElement('span');
    span.className = 'modal-tag';
    span.innerHTML = `${esc(tag)}<button type="button" onclick="Modal.removeTag('${fieldId}', ${idx})">&times;</button>`;
    list.appendChild(span);
    input.value = '';
    input.focus();
  }

  function removeTag(fieldId, idx) {
    const list = document.getElementById(fieldId + '-list');
    if (!list) return;
    const tags = list.querySelectorAll('.modal-tag');
    if (tags[idx]) tags[idx].remove();
  }

  function selectColor(fieldId, color) {
    const grid = document.getElementById(fieldId);
    if (!grid) return;
    grid.dataset.value = color;
    grid.querySelectorAll('.modal-color-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === color);
    });
  }

  // Convenience: confirmation dialog
  function confirm({ title, message, confirmText, confirmClass }) {
    return show({
      title: title || 'Confirm',
      fields: message ? [{ type: 'info', text: message }] : [],
      confirmText: confirmText || 'Delete',
      confirmClass: confirmClass || 'btn-danger',
      cancelText: 'Cancel'
    }).then(result => result !== null);
  }

  function checkAll(fieldId, checked) {
    const container = document.getElementById(fieldId);
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  return { show, submit, dismiss, confirm, addTag, removeTag, selectColor, checkAll };
})();
