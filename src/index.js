import './index.css';

const BUILD_VERSION = typeof __UNIVER_DATASOURCE_ENTRY_BUILD_VERSION__ !== 'undefined'
  ? __UNIVER_DATASOURCE_ENTRY_BUILD_VERSION__
  : 'dev';

const TOOLBOX_TITLE = '数据源录入';
const EYEBROW_LABEL = '只增录入';
const SELECT_SOURCE_PLACEHOLDER = '请选择数据源';
const SELECT_SHEET_PLACEHOLDER = '请选择工作表';
const EMPTY_SOURCE_MESSAGE = '选择并读取数据源后，这里会出现可录入字段。';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function buildSourceKey(item) {
  return `${item.note_id}:${item.block_index}`;
}

function normalizeRow(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const out = {};
  Object.keys(raw).forEach((key) => {
    out[key] = String(raw[key] == null ? '' : raw[key]);
  });
  return out;
}

function normalizeData(source) {
  const data = source && typeof source === 'object' ? source : {};
  return {
    noteId: toPositiveInt(data.noteId),
    query: typeof data.query === 'string' ? data.query : '',
    selectedSourceKey: typeof data.selectedSourceKey === 'string' ? data.selectedSourceKey : '',
    sheetKey: typeof data.sheetKey === 'string' ? data.sheetKey : '',
    headerRow: toNonNegativeInt(data.headerRow, 0),
    draftRows: Array.isArray(data.draftRows) ? data.draftRows.map(normalizeRow) : []
  };
}

function createBlankRow(columns) {
  const row = {};
  (Array.isArray(columns) ? columns : []).forEach((column) => {
    if (!column || !column.key) return;
    row[column.key] = '';
  });
  return row;
}

class UniverDatasourceEntryTool {
  static get toolbox() {
    return {
      title: TOOLBOX_TITLE,
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4.75H18C19.2426 4.75 20.25 5.75736 20.25 7V17C20.25 18.2426 19.2426 19.25 18 19.25H6C4.75736 19.25 3.75 18.2426 3.75 17V7C3.75 5.75736 4.75736 4.75 6 4.75Z" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 9.5H16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7.5 13H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15.5 12V16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.25 14.25H17.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      noteId: false,
      query: {},
      selectedSourceKey: false,
      sheetKey: false,
      headerRow: false,
      draftRows: {}
    };
  }

  constructor({ data, config, readOnly }) {
    this.config = config || {};
    this.readOnly = !!readOnly;
    this.data = normalizeData(data);
    this.sourceItems = [];
    this.readResult = null;
    this.columns = [];
    if (!this.data.draftRows.length) {
      this.data.draftRows = [];
    }
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cdx-univer-datasource-entry';
    wrapper.innerHTML = `
      <div class="cdx-univer-datasource-entry__top">
        <div class="cdx-univer-datasource-entry__meta">
          <div class="cdx-univer-datasource-entry__eyebrow">${EYEBROW_LABEL}</div>
          <div class="cdx-univer-datasource-entry__title">Univer 数据源录入工具</div>
          <div class="cdx-univer-datasource-entry__subtitle">build ${escapeHtml(BUILD_VERSION)}</div>
        </div>
      </div>
      <div class="cdx-univer-datasource-entry__status"></div>
      <div class="cdx-univer-datasource-entry__section">
        <div class="cdx-univer-datasource-entry__section-title">定位数据源</div>
        <div class="cdx-univer-datasource-entry__grid">
          <div class="cdx-univer-datasource-entry__field">
            <label>源笔记 ID</label>
            <input class="cdx-univer-datasource-entry__input" data-role="note-id" type="number" min="1" placeholder="留空表示在可访问范围内搜索" />
          </div>
          <div class="cdx-univer-datasource-entry__field">
            <label>搜索关键字</label>
            <input class="cdx-univer-datasource-entry__input" data-role="source-query" type="text" placeholder="按笔记标题或表格标题过滤" />
          </div>
          <div class="cdx-univer-datasource-entry__field">
            <label>数据源块</label>
            <select class="cdx-univer-datasource-entry__select" data-role="source-select">
              <option value="">${SELECT_SOURCE_PLACEHOLDER}</option>
            </select>
          </div>
          <div class="cdx-univer-datasource-entry__field">
            <label>工作表</label>
            <select class="cdx-univer-datasource-entry__select" data-role="sheet-select">
              <option value="">${SELECT_SHEET_PLACEHOLDER}</option>
            </select>
          </div>
          <div class="cdx-univer-datasource-entry__field">
            <label>表头行</label>
            <input class="cdx-univer-datasource-entry__input" data-role="header-row" type="number" min="0" />
          </div>
        </div>
        <div class="cdx-univer-datasource-entry__actions">
          <button type="button" class="cdx-univer-datasource-entry__button is-primary" data-role="list">读取数据源列表</button>
          <button type="button" class="cdx-univer-datasource-entry__button" data-role="read">读取录入结构</button>
          <button type="button" class="cdx-univer-datasource-entry__button" data-role="open">打开源笔记</button>
        </div>
      </div>
      <div class="cdx-univer-datasource-entry__section">
        <div class="cdx-univer-datasource-entry__section-title">录入表格</div>
        <div class="cdx-univer-datasource-entry__hint">这里只会向源表尾部追加新行，不会修改或删除已有数据。</div>
        <div class="cdx-univer-datasource-entry__actions">
          <button type="button" class="cdx-univer-datasource-entry__button" data-role="add-row">新增一行</button>
          <button type="button" class="cdx-univer-datasource-entry__button is-primary" data-role="submit">提交追加</button>
          <div class="cdx-univer-datasource-entry__count" data-role="draft-count"></div>
        </div>
        <div data-role="draft-table"></div>
      </div>
      <div class="cdx-univer-datasource-entry__section">
        <div class="cdx-univer-datasource-entry__section-title">数据源摘要</div>
        <div class="cdx-univer-datasource-entry__summary" data-role="summary"></div>
      </div>
    `;

    this.wrapper = wrapper;
    this.statusEl = wrapper.querySelector('.cdx-univer-datasource-entry__status');
    this.summaryEl = wrapper.querySelector('[data-role="summary"]');
    this.draftTableEl = wrapper.querySelector('[data-role="draft-table"]');
    this.draftCountEl = wrapper.querySelector('[data-role="draft-count"]');
    this.noteIdEl = wrapper.querySelector('[data-role="note-id"]');
    this.sourceQueryEl = wrapper.querySelector('[data-role="source-query"]');
    this.sourceSelectEl = wrapper.querySelector('[data-role="source-select"]');
    this.sheetSelectEl = wrapper.querySelector('[data-role="sheet-select"]');
    this.headerRowEl = wrapper.querySelector('[data-role="header-row"]');
    this.listBtnEl = wrapper.querySelector('[data-role="list"]');
    this.readBtnEl = wrapper.querySelector('[data-role="read"]');
    this.openBtnEl = wrapper.querySelector('[data-role="open"]');
    this.addRowBtnEl = wrapper.querySelector('[data-role="add-row"]');
    this.submitBtnEl = wrapper.querySelector('[data-role="submit"]');

    this.noteIdEl.value = this.data.noteId != null ? String(this.data.noteId) : '';
    this.sourceQueryEl.value = this.data.query || '';
    this.headerRowEl.value = String(this.data.headerRow || 0);

    if (!this.readOnly) {
      this.noteIdEl.addEventListener('input', () => { this.data.noteId = toPositiveInt(this.noteIdEl.value); });
      this.sourceQueryEl.addEventListener('input', () => { this.data.query = this.sourceQueryEl.value; });
      this.sourceSelectEl.addEventListener('change', () => { this.data.selectedSourceKey = this.sourceSelectEl.value || ''; });
      this.sheetSelectEl.addEventListener('change', () => { this.data.sheetKey = this.sheetSelectEl.value || ''; });
      this.headerRowEl.addEventListener('input', () => { this.data.headerRow = toNonNegativeInt(this.headerRowEl.value, 0); });
      this.listBtnEl.addEventListener('click', () => { this.loadSources({ silent: false }); });
      this.readBtnEl.addEventListener('click', () => { this.readSource({ silent: false }); });
      this.addRowBtnEl.addEventListener('click', () => { this.addDraftRow(); });
      this.submitBtnEl.addEventListener('click', () => { this.submitDraftRows({ silent: false }); });
      this.openBtnEl.addEventListener('click', async () => {
        const source = this.getSelectedSource();
        if (source && typeof this.config.openNoteById === 'function') {
          await this.config.openNoteById(source.note_id);
        }
      });
    } else {
      [this.noteIdEl, this.sourceQueryEl, this.sourceSelectEl, this.sheetSelectEl, this.headerRowEl].forEach((el) => {
        if (el) el.disabled = true;
      });
      [this.listBtnEl, this.readBtnEl, this.openBtnEl, this.addRowBtnEl, this.submitBtnEl].forEach((el) => {
        if (el) el.disabled = true;
      });
    }

    this.renderSummary(null);
    this.renderDraftTable();
    if (this.config.runtimeAvailable === false) {
      this.setStatus('当前上下文不支持实时录入，仅显示已保存的草稿表格。', false, false);
    } else {
      this.loadSources({ silent: true, autoRead: true });
    }
    return wrapper;
  }

  setStatus(message, isError, shouldToast) {
    const text = message || '';
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-error', !!(text && isError));
    if (text && shouldToast && typeof this.config.showMessage === 'function') {
      this.config.showMessage(text, isError ? 'error' : 'info');
    }
  }

  getSelectedSource() {
    const selectedKey = this.data.selectedSourceKey || '';
    return this.sourceItems.find((item) => buildSourceKey(item) === selectedKey) || this.sourceItems[0] || null;
  }

  async loadSources(options = {}) {
    const opts = options || {};
    if (typeof this.config.listSources !== 'function') {
      this.setStatus('listSources is not configured', true, !opts.silent);
      return false;
    }
    this.setStatus('正在读取数据源列表...', false, false);
    try {
      const response = await this.config.listSources({
        note_id: this.data.noteId,
        q: this.data.query,
        limit: 50
      });
      this.sourceItems = Array.isArray(response && response.items) ? response.items : [];
      this.renderSourceOptions();
      this.setStatus(this.sourceItems.length ? `找到 ${this.sourceItems.length} 个可用数据源。` : '未找到可访问的数据源。', false, !opts.silent);
      if (opts.autoRead && this.getSelectedSource()) {
        await this.readSource({ silent: true });
      }
      return true;
    } catch (error) {
      this.sourceItems = [];
      this.renderSourceOptions();
      this.renderSummary(null);
      this.columns = [];
      this.renderDraftTable();
      this.setStatus(error && error.message ? error.message : '读取数据源列表失败', true, !opts.silent);
      return false;
    }
  }

  renderSourceOptions() {
    const selectedKey = this.data.selectedSourceKey || '';
    const options = [`<option value="">${SELECT_SOURCE_PLACEHOLDER}</option>`];
    this.sourceItems.forEach((item) => {
      const key = buildSourceKey(item);
      const label = `#${item.note_id} ${item.note_title || '(无标题)'} / block ${item.block_index} / ${item.sheet_name || 'Sheet'}`;
      options.push(`<option value="${escapeHtml(key)}"${key === selectedKey ? ' selected' : ''}>${escapeHtml(label)}</option>`);
    });
    this.sourceSelectEl.innerHTML = options.join('');
    if (!selectedKey && this.sourceItems[0]) {
      this.data.selectedSourceKey = buildSourceKey(this.sourceItems[0]);
      this.sourceSelectEl.value = this.data.selectedSourceKey;
    }
  }

  renderSheetOptions() {
    const sheets = this.readResult && Array.isArray(this.readResult.sheets) ? this.readResult.sheets : [];
    const selected = this.data.sheetKey || (this.readResult && this.readResult.active_sheet ? this.readResult.active_sheet.key : '');
    const options = [`<option value="">${SELECT_SHEET_PLACEHOLDER}</option>`];
    sheets.forEach((sheet) => {
      options.push(`<option value="${escapeHtml(sheet.key)}"${sheet.key === selected ? ' selected' : ''}>${escapeHtml(sheet.name || sheet.key)}</option>`);
    });
    this.sheetSelectEl.innerHTML = options.join('');
    if (selected) this.sheetSelectEl.value = selected;
  }

  async readSource(options = {}) {
    const opts = options || {};
    const source = this.getSelectedSource();
    if (!source) {
      this.setStatus('请先选择一个数据源。', true, !opts.silent);
      return false;
    }
    if (typeof this.config.readSource !== 'function') {
      this.setStatus('readSource is not configured', true, !opts.silent);
      return false;
    }

    this.setStatus('正在读取录入结构...', false, false);
    try {
      const response = await this.config.readSource({
        note_id: source.note_id,
        block_index: source.block_index,
        sheet_key: this.data.sheetKey,
        header_row: this.data.headerRow,
        limit: 5
      });
      this.readResult = response || null;
      this.columns = Array.isArray(response && response.columns) ? response.columns.slice() : [];
      const activeSheet = response && response.active_sheet ? response.active_sheet : null;
      if (activeSheet && activeSheet.key && !this.data.sheetKey) {
        this.data.sheetKey = activeSheet.key;
      }
      if (!this.data.draftRows.length && this.columns.length) {
        this.data.draftRows = [createBlankRow(this.columns)];
      } else {
        this.data.draftRows = this.data.draftRows.map((row) => {
          const next = createBlankRow(this.columns);
          Object.keys(next).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(row, key)) next[key] = String(row[key] == null ? '' : row[key]);
          });
          return next;
        });
      }
      this.renderSheetOptions();
      this.renderSummary(response);
      this.renderDraftTable();
      this.setStatus(`已加载 ${this.columns.length} 个录入字段。`, false, !opts.silent);
      return true;
    } catch (error) {
      this.readResult = null;
      this.columns = [];
      this.renderSheetOptions();
      this.renderSummary(null);
      this.renderDraftTable();
      this.setStatus(error && error.message ? error.message : '读取录入结构失败', true, !opts.silent);
      return false;
    }
  }

  renderSummary(result) {
    if (!result || !result.source || !result.active_sheet) {
      this.summaryEl.innerHTML = `<div class="cdx-univer-datasource-entry__empty">选择一个数据源后，这里会显示目标表的摘要信息。</div>`;
      return;
    }
    const source = result.source;
    const sheet = result.active_sheet;
    const metrics = [
      { label: '源笔记', value: `#${source.note_id}` },
      { label: '数据块', value: String(source.block_index) },
      { label: '工作表', value: sheet.name || sheet.key },
      { label: '字段数', value: String((result.columns || []).length) },
      { label: '有效行数', value: String(sheet.used_row_count || 0) },
      { label: '源标题', value: source.title || '(未设置)' },
      { label: '数据源启用', value: source.datasource && source.datasource.enabled ? '是' : '否' },
      { label: '表头行', value: String(sheet.header_row || 0) }
    ];
    this.summaryEl.innerHTML = metrics.map((item) => `
      <div class="cdx-univer-datasource-entry__metric">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.value)}</span>
      </div>
    `).join('');
  }

  renderDraftTable() {
    const columns = Array.isArray(this.columns) ? this.columns : [];
    const rows = Array.isArray(this.data.draftRows) ? this.data.draftRows : [];
    this.draftCountEl.textContent = rows.length ? `草稿行数：${rows.length}` : '';
    if (!columns.length) {
      this.draftTableEl.innerHTML = `<div class="cdx-univer-datasource-entry__empty">${EMPTY_SOURCE_MESSAGE}</div>`;
      return;
    }
    if (!rows.length) {
      this.data.draftRows = [createBlankRow(columns)];
    }
    const bodyRows = (this.data.draftRows || []).map((row, rowIndex) => {
      const cells = columns.map((column) => {
        const value = row && Object.prototype.hasOwnProperty.call(row, column.key) ? row[column.key] : '';
        const disabled = this.readOnly ? ' disabled' : '';
        return `<td><textarea class="cdx-univer-datasource-entry__cell-input" data-role="cell" data-row-index="${rowIndex}" data-column-key="${escapeHtml(column.key)}" rows="2"${disabled}>${escapeHtml(value)}</textarea></td>`;
      }).join('');
      const actionCell = this.readOnly
        ? '<td></td>'
        : `<td><button type="button" class="cdx-univer-datasource-entry__button is-danger" data-role="remove-row" data-row-index="${rowIndex}">删除行</button></td>`;
      return `<tr><td>${rowIndex + 1}</td>${cells}${actionCell}</tr>`;
    }).join('');
    const headerCells = columns.map((column) => `<th>${escapeHtml(column.label || column.key)}</th>`).join('');
    this.draftTableEl.innerHTML = `
      <div class="cdx-univer-datasource-entry__table-wrap">
        <table class="cdx-univer-datasource-entry__table">
          <thead>
            <tr>
              <th>#</th>
              ${headerCells}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;

    if (!this.readOnly) {
      this.draftTableEl.querySelectorAll('[data-role="cell"]').forEach((el) => {
        el.addEventListener('input', () => {
          const rowIndex = Number(el.getAttribute('data-row-index'));
          const columnKey = String(el.getAttribute('data-column-key') || '');
          if (!Number.isFinite(rowIndex) || rowIndex < 0 || !columnKey) return;
          if (!this.data.draftRows[rowIndex]) this.data.draftRows[rowIndex] = createBlankRow(columns);
          this.data.draftRows[rowIndex][columnKey] = el.value;
        });
      });
      this.draftTableEl.querySelectorAll('[data-role="remove-row"]').forEach((el) => {
        el.addEventListener('click', () => {
          const rowIndex = Number(el.getAttribute('data-row-index'));
          this.removeDraftRow(rowIndex);
        });
      });
    }
  }

  addDraftRow() {
    if (!this.columns.length) {
      this.setStatus('请先读取录入结构。', true, true);
      return;
    }
    this.data.draftRows.push(createBlankRow(this.columns));
    this.renderDraftTable();
  }

  removeDraftRow(index) {
    const rowIndex = Number(index);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) return;
    this.data.draftRows.splice(rowIndex, 1);
    if (!this.data.draftRows.length && this.columns.length) {
      this.data.draftRows.push(createBlankRow(this.columns));
    }
    this.renderDraftTable();
  }

  buildSubmitRows() {
    const columns = Array.isArray(this.columns) ? this.columns : [];
    return (Array.isArray(this.data.draftRows) ? this.data.draftRows : [])
      .map((row) => {
        const out = {};
        let hasValue = false;
        columns.forEach((column) => {
          const value = String(row && row[column.key] != null ? row[column.key] : '').trim();
          out[column.key] = value;
          if (value) hasValue = true;
        });
        return hasValue ? out : null;
      })
      .filter(Boolean);
  }

  async submitDraftRows(options = {}) {
    const opts = options || {};
    const source = this.getSelectedSource();
    if (!source) {
      this.setStatus('请先选择一个数据源。', true, !opts.silent);
      return false;
    }
    if (!this.columns.length) {
      this.setStatus('请先读取录入结构。', true, !opts.silent);
      return false;
    }
    if (typeof this.config.appendRows !== 'function') {
      this.setStatus('appendRows is not configured', true, !opts.silent);
      return false;
    }
    const submitRows = this.buildSubmitRows();
    if (!submitRows.length) {
      this.setStatus('请至少填写一条非空记录。', true, !opts.silent);
      return false;
    }

    this.setStatus(`正在追加 ${submitRows.length} 条记录...`, false, false);
    try {
      const result = await this.config.appendRows({
        note_id: source.note_id,
        block_index: source.block_index,
        sheet_key: this.data.sheetKey,
        header_row: this.data.headerRow,
        rows: submitRows
      });
      this.data.draftRows = [createBlankRow(this.columns)];
      this.renderDraftTable();
      await this.readSource({ silent: true });
      this.setStatus(`已追加 ${Number(result && result.appended) || 0} 条记录。`, false, !opts.silent);
      return true;
    } catch (error) {
      this.setStatus(error && error.message ? error.message : '提交追加失败', true, !opts.silent);
      return false;
    }
  }

  save() {
    return {
      noteId: this.data.noteId,
      query: this.data.query || '',
      selectedSourceKey: this.data.selectedSourceKey || '',
      sheetKey: this.data.sheetKey || '',
      headerRow: toNonNegativeInt(this.data.headerRow, 0) || 0,
      draftRows: Array.isArray(this.data.draftRows) ? this.data.draftRows.map(normalizeRow) : []
    };
  }
}

window.UniverDatasourceEntryTool = UniverDatasourceEntryTool;

export default UniverDatasourceEntryTool;
