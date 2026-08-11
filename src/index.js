import './index.css';

const BUILD_VERSION = typeof __UNIVER_DATASOURCE_ENTRY_BUILD_VERSION__ !== 'undefined'
  ? __UNIVER_DATASOURCE_ENTRY_BUILD_VERSION__
  : 'dev';

const TOOLBOX_TITLE = '数据源录入';
const EYEBROW_LABEL = '只增录入';
const EMPTY_SOURCE_MESSAGE = 'Token 应用后，这里会出现可录入字段。';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function parsePastedGrid(text) {
  const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = raw.split('\n');
  const trimmedTail = rows.slice();
  while (trimmedTail.length && trimmedTail[trimmedTail.length - 1] === '') {
    trimmedTail.pop();
  }
  return trimmedTail.map((line) => line.split('\t'));
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
  const rawAssistCols = Array.isArray(data.allowedAssistColumns) ? data.allowedAssistColumns : [];
  return {
    noteId: toPositiveInt(data.noteId),
    query: typeof data.query === 'string' ? data.query : '',
    selectedSourceKey: typeof data.selectedSourceKey === 'string' ? data.selectedSourceKey : '',
    sheetKey: typeof data.sheetKey === 'string' ? data.sheetKey : '',
    headerRow: toNonNegativeInt(data.headerRow, 0),
    encryptedToken: typeof data.encryptedToken === 'string' ? data.encryptedToken : '',
    allowedAssistColumns: rawAssistCols.filter((c) => typeof c === 'string' && c),
    draftRows: Array.isArray(data.draftRows) ? data.draftRows.map(normalizeRow) : [],
    lastSubmitLog: (data.lastSubmitLog && typeof data.lastSubmitLog === 'object') ? data.lastSubmitLog : null
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
      draftRows: {},
      lastSubmitLog: false
    };
  }

  constructor({ data, config, readOnly }) {
    this.config = config || {};
    this.readOnly = !!readOnly;
    this.data = normalizeData(data);
    this.sourceItems = [];
    this.readResult = null;
    this.columns = [];
    this._tokenApplied = false; // Guard flag: prevents loadSources from overwriting token-derived selection
    this._assistRows = []; // Full row objects from data source
    this._assistColumnIndex = {}; // { columnKey: [rowIndex, ...] } for fast search
    this._assistAllColKeys = []; // All column keys in order
    this._assistDropdownEl = null; // Floating dropdown element
    this._assistActiveCellEl = null; // Currently active cell for assist
    this._assistSelecting = false; // Guard flag to prevent re-trigger on fill
    if (!this.data.draftRows.length) {
      this.data.draftRows = [];
    }
    if (!this.data.lastSubmitLog || typeof this.data.lastSubmitLog !== 'object') {
      this.data.lastSubmitLog = null;
    }
  }

  focusCell(rowIndex, columnIndex) {
    if (!this.draftTableEl) return;
    const selector = `[data-role="cell"][data-row-index="${rowIndex}"][data-column-index="${columnIndex}"]`;
    const el = this.draftTableEl.querySelector(selector);
    if (!el) return;
    el.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {}
  }

  ensureRowExists(rowIndex) {
    while (this.data.draftRows.length <= rowIndex) {
      this.data.draftRows.push(createBlankRow(this.columns));
    }
  }

  updateDraftCell(rowIndex, columnKey, value) {
    if (!Number.isFinite(rowIndex) || rowIndex < 0 || !columnKey) return;
    if (!this.data.draftRows[rowIndex]) this.data.draftRows[rowIndex] = createBlankRow(this.columns);
    this.data.draftRows[rowIndex][columnKey] = String(value == null ? '' : value);
  }

  applyGridPaste(startRowIndex, startColumnIndex, grid) {
    const rows = Array.isArray(grid) ? grid : [];
    if (!rows.length || !this.columns.length) return;
    rows.forEach((cells, rowOffset) => {
      const targetRowIndex = startRowIndex + rowOffset;
      this.ensureRowExists(targetRowIndex);
      (Array.isArray(cells) ? cells : []).forEach((cellValue, colOffset) => {
        const targetColumn = this.columns[startColumnIndex + colOffset];
        if (!targetColumn) return;
        this.updateDraftCell(targetRowIndex, targetColumn.key, cellValue);
      });
    });
    this.renderDraftTable();
    this.focusCell(startRowIndex + rows.length - 1, startColumnIndex);
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
        <button type="button" class="cdx-univer-datasource-entry__submit-btn" data-role="submit" title="提交追加到数据源">提交</button>
      </div>
      <div class="cdx-univer-datasource-entry__status"></div>
      <div class="cdx-univer-datasource-entry__section" data-role="token-section">
        <div class="cdx-univer-datasource-entry__section-title">Token 导入</div>
        <div class="cdx-univer-datasource-entry__hint">粘贴由验证工具生成的 Token，自动填充数据源配置。</div>
        <div class="cdx-univer-datasource-entry__grid">
          <div class="cdx-univer-datasource-entry__field cdx-univer-datasource-entry__field--span-full">
            <label>Token</label>
            <input class="cdx-univer-datasource-entry__input cdx-univer-datasource-entry__input--mono" data-role="token-input" type="text" placeholder="粘贴 utk: 开头的加密 Token" autocomplete="off" />
          </div>
        </div>
        <div class="cdx-univer-datasource-entry__actions">
          <button type="button" class="cdx-univer-datasource-entry__button is-primary" data-role="apply-token">应用 Token</button>
        </div>
        <div class="cdx-univer-datasource-entry__token-status" data-role="token-status"></div>
      </div>

      <div class="cdx-univer-datasource-entry__submit-log" data-role="submit-log" contenteditable="false" style="display:none;"></div>

      <div class="cdx-univer-datasource-entry__section">
        <div class="cdx-univer-datasource-entry__section-title">录入表格</div>
        <div class="cdx-univer-datasource-entry__hint">这里只会向源表尾部追加新行，不会修改或删除已有数据。</div>
        <div data-role="draft-table"></div>
      </div>

    `;

    this.wrapper = wrapper;
    this.statusEl = wrapper.querySelector('.cdx-univer-datasource-entry__status');
    this.draftTableEl = wrapper.querySelector('[data-role="draft-table"]');
    this.submitLogEl = wrapper.querySelector('[data-role="submit-log"]');
    this.submitBtnEl = wrapper.querySelector('[data-role="submit"]');
    this.tokenSectionEl = wrapper.querySelector('[data-role="token-section"]');
    this.tokenInputEl = wrapper.querySelector('[data-role="token-input"]');
    this.applyTokenBtnEl = wrapper.querySelector('[data-role="apply-token"]');
    this.tokenStatusEl = wrapper.querySelector('[data-role="token-status"]');

    if (this.tokenInputEl && this.data.encryptedToken) {
      this.tokenInputEl.value = this.data.encryptedToken;
    }

    if (!this.readOnly) {
      this.submitBtnEl.addEventListener('click', () => { this.submitDraftRows({ silent: false }); });
      this.applyTokenBtnEl.addEventListener('click', () => { this.applyToken({ silent: false }); });
    } else {
      [this.tokenInputEl, this.submitBtnEl, this.applyTokenBtnEl].forEach((el) => {
        if (el) el.disabled = true;
      });
    }

    this.renderDraftTable();
    this.renderSubmitLog();

    // Auto-apply saved token on load
    if (this.data.encryptedToken) {
      this.applyToken({ silent: true }).then(() => {
        if (this.config.runtimeAvailable !== false) {
          this.loadSources({ silent: true, autoRead: true });
        }
      });
    } else if (this.config.runtimeAvailable === false) {
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
    let tokenKeyFound = false;
    this.sourceItems.forEach((item) => {
      const key = buildSourceKey(item);
      if (key === selectedKey) tokenKeyFound = true;
    });
    if (this._tokenApplied && selectedKey && !tokenKeyFound) {
      // Token-derived key not found in loaded list — warn but don't overwrite
      this.setTokenStatus('⚠️ Token 指定的数据源未在当前列表中找到，请检查权限或重新生成 Token。', true);
    } else if (!selectedKey && this.sourceItems[0]) {
      this.data.selectedSourceKey = buildSourceKey(this.sourceItems[0]);
    }
  }

  renderSheetOptions() {
    // Sheet selection is now driven by token; no UI to update
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
      this.loadAssistData(); // Load full data for assist search (async, non-blocking)
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
    // Summary section removed; method kept as no-op for call-site compatibility
  }

  renderDraftTable() {
    const columns = Array.isArray(this.columns) ? this.columns : [];
    const rows = Array.isArray(this.data.draftRows) ? this.data.draftRows : [];
    if (!columns.length) {
      this.draftTableEl.innerHTML = `<div class="cdx-univer-datasource-entry__empty">${EMPTY_SOURCE_MESSAGE}</div>`;
      return;
    }
    if (!rows.length) {
      this.data.draftRows = [createBlankRow(columns)];
    }
    const bodyRows = (this.data.draftRows || []).map((row, rowIndex) => {
      const cells = columns.map((column, columnIndex) => {
        const value = row && Object.prototype.hasOwnProperty.call(row, column.key) ? row[column.key] : '';
        const editable = this.readOnly ? 'false' : 'true';
        return `<td><div class="cdx-univer-datasource-entry__cell" data-role="cell" data-row-index="${rowIndex}" data-column-index="${columnIndex}" data-column-key="${escapeAttr(column.key)}" contenteditable="${editable}">${escapeHtml(value)}</div></td>`;
      }).join('');
      const actionCell = this.readOnly
        ? '<td></td>'
        : `<td><button type="button" class="cdx-univer-datasource-entry__button is-danger" data-role="remove-row" data-row-index="${rowIndex}">删除行</button></td>`;
      return `<tr><td>${rowIndex + 1}</td>${cells}${actionCell}</tr>`;
    }).join('');
    // Add-row button as a table footer row with + icon
    const addRowSpan = columns.length + 2; // # + columns + action
    const addRowHtml = !this.readOnly
      ? `<tr class="cdx-univer-datasource-entry__add-row" data-role="add-row"><td colspan="${addRowSpan}"><span class="cdx-univer-datasource-entry__add-icon">+</span> 新增一行</td></tr>`
      : '';
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
          <tbody>${bodyRows}${addRowHtml}</tbody>
        </table>
      </div>
    `;

    if (!this.readOnly) {
      this.draftTableEl.querySelectorAll('[data-role="cell"]').forEach((el) => {
        el.addEventListener('input', () => {
          const rowIndex = Number(el.getAttribute('data-row-index'));
          const columnIndex = Number(el.getAttribute('data-column-index'));
          const columnKey = String(el.getAttribute('data-column-key') || '');
          if (!Number.isFinite(rowIndex) || rowIndex < 0 || !columnKey) return;
          this.updateDraftCell(rowIndex, columnKey, el.textContent || '');
          if (Number.isFinite(columnIndex) && columnIndex === columns.length - 1 && rowIndex === this.data.draftRows.length - 1) {
            this.renderDraftTable();
          }
          // Assist search: trigger dropdown if column is allowed
          if (!this._assistSelecting) {
            const allowedCols = this.data.allowedAssistColumns || [];
            if (allowedCols.includes(columnKey)) {
              const query = (el.textContent || '').trim();
              if (query) {
                const matches = this.searchAssistValues(columnKey, query);
                this.showAssistDropdown(el, matches, columnKey);
              } else {
                this.hideAssistDropdown();
              }
            }
          }
        });
        el.addEventListener('blur', () => {
          // Delay hide to allow mousedown on dropdown item to fire first
          setTimeout(() => { this.hideAssistDropdown(); }, 150);
        });
        el.addEventListener('keydown', (event) => {
          // Close assist dropdown on Escape
          if (event.key === 'Escape' && this._assistDropdownEl) {
            event.preventDefault();
            this.hideAssistDropdown();
            return;
          }
          const rowIndex = Number(el.getAttribute('data-row-index'));
          const columnIndex = Number(el.getAttribute('data-column-index'));
          if (!Number.isFinite(rowIndex) || rowIndex < 0 || !Number.isFinite(columnIndex) || columnIndex < 0) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            const targetRowIndex = rowIndex + 1;
            this.ensureRowExists(targetRowIndex);
            this.renderDraftTable();
            this.focusCell(targetRowIndex, columnIndex);
            return;
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            let targetRowIndex = rowIndex;
            let targetColumnIndex = columnIndex + (event.shiftKey ? -1 : 1);
            if (targetColumnIndex >= columns.length) {
              targetRowIndex += 1;
              targetColumnIndex = 0;
            } else if (targetColumnIndex < 0) {
              targetRowIndex = Math.max(0, rowIndex - 1);
              targetColumnIndex = columns.length - 1;
            }
            this.ensureRowExists(targetRowIndex);
            this.renderDraftTable();
            this.focusCell(targetRowIndex, targetColumnIndex);
          }
        });
        el.addEventListener('paste', (event) => {
          event.preventDefault();
          const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
          const rowIndex = Number(el.getAttribute('data-row-index'));
          const columnIndex = Number(el.getAttribute('data-column-index'));
          if (!Number.isFinite(rowIndex) || rowIndex < 0 || !Number.isFinite(columnIndex) || columnIndex < 0) return;
          const grid = parsePastedGrid(text);
          if (grid.length > 1 || (grid[0] && grid[0].length > 1)) {
            this.applyGridPaste(rowIndex, columnIndex, grid);
            return;
          }
          const plainText = grid[0] && grid[0][0] != null ? String(grid[0][0]) : '';
          try {
            document.execCommand('insertText', false, plainText);
          } catch (_) {
            el.textContent = plainText;
          }
        });
      });
      this.draftTableEl.querySelectorAll('[data-role="remove-row"]').forEach((el) => {
        el.addEventListener('click', () => {
          const rowIndex = Number(el.getAttribute('data-row-index'));
          this.removeDraftRow(rowIndex);
        });
      });
      const addRowEl = this.draftTableEl.querySelector('[data-role="add-row"]');
      if (addRowEl) {
        addRowEl.addEventListener('click', () => { this.addDraftRow(); });
      }
    }
  }

  async loadAssistData() {
    const allowedCols = Array.isArray(this.data.allowedAssistColumns) ? this.data.allowedAssistColumns : [];
    if (!allowedCols.length) { this._assistRows = []; this._assistColumnIndex = {}; return; }
    const source = this.getSelectedSource();
    if (!source || typeof this.config.readSource !== 'function') return;
    try {
      const response = await this.config.readSource({
        note_id: source.note_id,
        block_index: source.block_index,
        sheet_key: this.data.sheetKey,
        header_row: this.data.headerRow,
        limit: 500
      });
      const rows = Array.isArray(response && response.rows) ? response.rows : [];
      const columns = Array.isArray(response && response.columns) ? response.columns : [];
      // Store full row data as flat objects
      const allColKeys = columns.map((c) => c.key);
      const assistRows = rows.map((row) => {
        const obj = {};
        allColKeys.forEach((k) => {
          obj[k] = String(row && row.values && row.values[k] != null ? row.values[k] : '');
        });
        return obj;
      });
      // Build column index for fast search: { columnKey: [rowIndex, ...] }
      const colIndex = {};
      const allowedSet = new Set(allowedCols);
      allowedCols.forEach((ck) => { colIndex[ck] = []; });
      assistRows.forEach((rowObj, idx) => {
        allowedCols.forEach((ck) => {
          const v = (rowObj[ck] || '').trim();
          if (v) colIndex[ck].push(idx);
        });
      });
      this._assistRows = assistRows;
      this._assistColumnIndex = colIndex;
      this._assistAllColKeys = allColKeys;
    } catch (_) {
      this._assistRows = [];
      this._assistColumnIndex = {};
    }
  }

  searchAssistValues(columnKey, query) {
    if (!columnKey || !query) return [];
    const indices = this._assistColumnIndex[columnKey];
    if (!Array.isArray(indices) || !indices.length) return [];
    const q = query.toLowerCase();
    const results = [];
    for (let i = 0; i < indices.length && results.length < 50; i++) {
      const rowObj = this._assistRows[indices[i]];
      if (!rowObj) continue;
      const v = (rowObj[columnKey] || '').toLowerCase();
      if (v.includes(q)) results.push(rowObj);
    }
    return results;
  }

  showAssistDropdown(cellEl, matches, columnKey) {
    if (!matches.length) { this.hideAssistDropdown(); return; }
    this.hideAssistDropdown();
    const dropdown = document.createElement('div');
    dropdown.className = 'cdx-assist-dropdown';
    const allCols = Array.isArray(this._assistAllColKeys) ? this._assistAllColKeys : [];
    const colLabels = {};
    (Array.isArray(this.columns) ? this.columns : []).forEach((c) => { colLabels[c.key] = c.label || c.key; });
    matches.forEach((rowObj) => {
      const item = document.createElement('div');
      item.className = 'cdx-assist-dropdown__item';
      // Build multi-column display
      const parts = allCols.map((ck) => {
        const val = rowObj[ck] || '';
        const label = colLabels[ck] || ck;
        const isMatch = ck === columnKey;
        if (!val) return null;
        const span = document.createElement('span');
        span.className = 'cdx-assist-dropdown__cell' + (isMatch ? ' is-match' : '');
        span.innerHTML = '<span class="cdx-assist-dropdown__label">' + escapeHtml(label) + '</span>' + escapeHtml(val);
        return span;
      }).filter(Boolean);
      parts.forEach((p) => item.appendChild(p));
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._assistSelecting = true;
        const rIdx = Number(cellEl.getAttribute('data-row-index'));
        // Fill entire row from matched data
        allCols.forEach((ck) => {
          const val = rowObj[ck] || '';
          this.updateDraftCell(rIdx, ck, val);
        });
        this.renderDraftTable();
        this.hideAssistDropdown();
        // Focus back on the original cell
        this.focusCell(rIdx, Number(cellEl.getAttribute('data-column-index')));
        Promise.resolve().then(() => { this._assistSelecting = false; });
      });
      dropdown.appendChild(item);
    });
    const rect = cellEl.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    dropdown.style.position = 'absolute';
    dropdown.style.left = (rect.left - wrapperRect.left) + 'px';
    dropdown.style.top = (rect.bottom - wrapperRect.top + 2) + 'px';
    dropdown.style.minWidth = Math.max(rect.width, 300) + 'px';
    this.wrapper.appendChild(dropdown);
    this._assistDropdownEl = dropdown;
    this._assistActiveCellEl = cellEl;
  }

  hideAssistDropdown() {
    if (this._assistDropdownEl) {
      this._assistDropdownEl.remove();
      this._assistDropdownEl = null;
    }
    this._assistActiveCellEl = null;
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
      // Save submit log before clearing draft
      const submittedSnapshot = submitRows.slice(0, 10).map((r) => {
        const row = {};
        this.columns.forEach((col) => { row[col.key] = r[col.key] || ''; });
        return row;
      });
      this.data.lastSubmitLog = {
        timestamp: new Date().toISOString(),
        count: submitRows.length,
        rows: submittedSnapshot
      };
      this.renderSubmitLog();

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

  async applyToken(options = {}) {
    const opts = options || {};
    const tokenStr = this.tokenInputEl ? this.tokenInputEl.value.trim() : '';
    if (!tokenStr) {
      this.setTokenStatus('请输入 Token。', true);
      if (!opts.silent) this.setStatus('请输入 Token。', true, true);
      return false;
    }

    const userId = typeof this.config.getCurrentUserId === 'function' ? this.config.getCurrentUserId() : null;
    if (!userId) {
      this.setTokenStatus('无法获取当前用户 ID，请确认已登录。', true);
      if (!opts.silent) this.setStatus('无法获取当前用户 ID。', true, true);
      return false;
    }

    // Prefer server-side decoding so LAN HTTP deployments do not depend on Web Crypto.
    const crypto = (typeof window !== 'undefined' && window.UniverTokenCrypto) ? window.UniverTokenCrypto : null;
    if (typeof this.config.decodeToken !== 'function' && (!crypto || typeof crypto.decrypt !== 'function')) {
      this.setTokenStatus('Token 解密模块未加载。', true);
      if (!opts.silent) this.setStatus('Token 解密模块未加载。', true, true);
      return false;
    }

    try {
      let payload;
      if (typeof this.config.decodeToken === 'function') {
        const result = await this.config.decodeToken(tokenStr);
        payload = result && result.payload ? result.payload : result;
      } else {
        payload = await crypto.decrypt(tokenStr, userId);
      }
      // Auto-fill configuration from token
      if (payload.note_id != null) {
        this.data.noteId = toPositiveInt(payload.note_id);
      }
      if (payload.block_index != null) {
        // Store as part of selectedSourceKey pattern: note_id:block_index
        const newKey = `${payload.note_id}:${payload.block_index}`;
        this.data.selectedSourceKey = newKey;
      }
      if (typeof payload.sheet_key === 'string' && payload.sheet_key) {
        this.data.sheetKey = payload.sheet_key;
      }
      if (payload.header_row != null) {
        this.data.headerRow = toNonNegativeInt(payload.header_row, 0);
      }
      if (Array.isArray(payload.allowed_assist_columns)) {
        this.data.allowedAssistColumns = payload.allowed_assist_columns.filter((c) => typeof c === 'string' && c);
      }
      // Save encrypted token for persistence
      this.data.encryptedToken = tokenStr;
      this._tokenApplied = true;

      this.setTokenStatus('✅ Token 解析成功，配置已自动填充。', false);
      // Hide the entire Token import section after successful parse
      if (this.tokenSectionEl) {
        this.tokenSectionEl.style.display = 'none';
      }
      if (!opts.silent) this.setStatus('Token 解析成功，数据源配置已自动填充。', false, true);
      return true;
    } catch (error) {
      const msg = error && error.message ? error.message : '解密失败';
      this.setTokenStatus('❌ Token 解析失败: ' + msg, true);
      if (!opts.silent) this.setStatus('Token 解析失败: ' + msg, true, true);
      return false;
    }
  }

  setTokenStatus(message, isError) {
    if (!this.tokenStatusEl) return;
    this.tokenStatusEl.textContent = message || '';
    this.tokenStatusEl.classList.toggle('is-error', !!isError);
    this.tokenStatusEl.classList.toggle('is-success', !isError && !!message);
  }

  renderSubmitLog() {
    if (!this.submitLogEl) return;
    const log = this.data.lastSubmitLog;
    if (!log || !log.rows || !log.rows.length) {
      this.submitLogEl.style.display = 'none';
      this.submitLogEl.innerHTML = '';
      return;
    }

    const time = new Date(log.timestamp);
    const timeStr = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
    const colLabels = {};
    this.columns.forEach((col) => { colLabels[col.key] = col.label || col.key; });

    let rowsHtml = '';
    log.rows.forEach((row, idx) => {
      let cellsHtml = '';
      this.columns.forEach((col) => {
        const val = escapeHtml(row[col.key] || '');
        if (val) {
          cellsHtml += `<span class="cdx-submit-log__cell"><span class="cdx-submit-log__label">${escapeHtml(colLabels[col.key])}</span>${val}</span>`;
        }
      });
      if (cellsHtml) {
        rowsHtml += `<div class="cdx-submit-log__row"><span class="cdx-submit-log__idx">#${idx + 1}</span>${cellsHtml}</div>`;
      }
    });

    const truncated = log.count > log.rows.length ? `（显示前 ${log.rows.length} / 共 ${log.count} 条）` : `（共 ${log.count} 条）`;
    this.submitLogEl.innerHTML = `
      <div class="cdx-submit-log__header">
        <span class="cdx-submit-log__icon">✅</span>
        <span class="cdx-submit-log__title">已提交记录</span>
        <span class="cdx-submit-log__time">${timeStr} ${truncated}</span>
      </div>
      <div class="cdx-submit-log__body">${rowsHtml}</div>
    `;
    this.submitLogEl.style.display = '';
  }

  save() {
    return {
      noteId: this.data.noteId,
      query: this.data.query || '',
      selectedSourceKey: this.data.selectedSourceKey || '',
      sheetKey: this.data.sheetKey || '',
      headerRow: toNonNegativeInt(this.data.headerRow, 0) || 0,
      encryptedToken: this.data.encryptedToken || '',
      allowedAssistColumns: Array.isArray(this.data.allowedAssistColumns) ? this.data.allowedAssistColumns : [],
      draftRows: Array.isArray(this.data.draftRows) ? this.data.draftRows.map(normalizeRow) : [],
      lastSubmitLog: this.data.lastSubmitLog || null
    };
  }
}

window.UniverDatasourceEntryTool = UniverDatasourceEntryTool;

export default UniverDatasourceEntryTool;
