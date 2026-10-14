'use strict';
/* WC-001 蓉城战役 WBS 工作系统 —— 前端（身份选择 / 权限矩阵 / 行内编辑 / 本地导出）。 */
(function (global) {
  var PM = '项目负责人';
  var STATUSES = ['未开始', '进行中', '已完成', '已延期', '被阻塞'];
  var DATE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
  var DATE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
  var FIELD_LABELS = {
    id: '序号',
    level1: '一级', level2: '二级', task: '任务项', owner: '负责人', demo: '是否演示范围',
    note: '进展说明', status: '状态',
    'dates.design': '设计', 'dates.dev': '开发', 'dates.test': '测试', 'dates.product': '产品', 'dates.demo_prep': '演示准备'
  };
  var STRUCT_FIELDS = ['level1', 'level2', 'task', 'owner'];
  var MAX_LEN = { level1: 200, level2: 200, task: 300, owner: 40, demo: 20, note: 2000 };
  var IDENTITY_KEY = 'wbs.identity';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  var EXPORT_COL_COUNT = 11;

  /* ------------------------------------------------------------ 纯逻辑 */

  function isPM(identity) { return identity === PM; }

  function fieldLabel(field) {
    if (FIELD_LABELS[field]) return FIELD_LABELS[field];
    if (field.indexOf('dates.') === 0) return DATE_LABELS[field.slice(6)] || field;
    return field;
  }

  function canEditField(identity, task, field) {
    if (isPM(identity)) return true;
    if (!task || task.owner !== identity) return false;
    return STRUCT_FIELDS.indexOf(field) === -1;
  }

  function readField(task, field) {
    if (field.indexOf('dates.') === 0) {
      var dates = task.dates || {};
      return dates[field.slice(6)] == null ? '' : String(dates[field.slice(6)]);
    }
    return task[field] == null ? '' : String(task[field]);
  }

  function writeField(task, field, value) {
    if (field.indexOf('dates.') === 0) {
      task.dates = task.dates || {};
      task.dates[field.slice(6)] = value;
      return;
    }
    task[field] = value;
  }

  function filterTasks(tasks, filter) {
    var q = ((filter && filter.q) || '').trim().toLowerCase();
    var owner = (filter && filter.owner) || '';
    var status = (filter && filter.status) || '';
    return tasks.filter(function (task) {
      if (owner && task.owner !== owner) return false;
      if (status && task.status !== status) return false;
      if (q) {
        var hay = [task.level1, task.level2, task.task, task.owner, task.note].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function groupFlags(tasks) {
    var prev1 = null;
    var prev2 = null;
    return tasks.map(function (task) {
      var l1Start = task.level1 !== prev1;
      var l2Start = l1Start || task.level2 !== prev2;
      prev1 = task.level1;
      prev2 = task.level2;
      return { l1Start: l1Start, l2Start: l2Start };
    });
  }

  function exportRows(tasks) {
    return tasks.map(function (task) {
      var dates = task.dates || {};
      var row = [task.level1 || '', task.level2 || '', task.task || '', task.owner || '', task.demo || ''];
      DATE_KEYS.forEach(function (key) { row.push(dates[key] == null ? '' : String(dates[key])); });
      row.push(task.note == null ? '' : String(task.note));
      return row;
    });
  }

  function colName(index) {
    var name = '';
    var n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  }

  function addrOf(rowNumber, colIndex) { return colName(colIndex) + rowNumber; }

  function parseRange(ref) {
    var match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(ref || 'A1:K38'));
    if (!match) return { s: { r: 0, c: 0 }, e: { r: 37, c: 10 } };
    var toIndex = function (letters) {
      var value = 0;
      for (var i = 0; i < letters.length; i += 1) value = value * 26 + (letters.charCodeAt(i) - 64);
      return value - 1;
    };
    return {
      s: { r: Number(match[2]) - 1, c: toIndex(match[1]) },
      e: { r: Number(match[4]) - 1, c: toIndex(match[3]) }
    };
  }

  /** 仅覆写 A3:K(3+n-1)，并清空原数据区中超出新行数的 A–K 残留；其余单元格与合并保持不动。 */
  function applyExportRows(worksheet, rows, startRow) {
    var first = startRow || 3;
    var range = parseRange(worksheet['!ref']);
    var originalLastRow = range.e.r + 1;
    rows.forEach(function (values, rowIndex) {
      for (var c = 0; c < EXPORT_COL_COUNT; c += 1) {
        var value = values[c] == null ? '' : String(values[c]);
        var addr = addrOf(first + rowIndex, c);
        var previous = worksheet[addr];
        var cell = { t: 's', v: value };
        if (previous && previous.s !== undefined) cell.s = previous.s; // 保留原数据区单元格样式
        worksheet[addr] = cell;
      }
    });
    for (var r = first + rows.length; r <= originalLastRow; r += 1) {
      for (var c2 = 0; c2 < EXPORT_COL_COUNT; c2 += 1) {
        var addr = addrOf(r, c2);
        if (worksheet[addr]) delete worksheet[addr];
      }
    }
    return Math.max(originalLastRow, first + rows.length - 1);
  }

  /** 导出构建：页面导出与作者自测走同一实现，消除缺陷 D-1 的双路径差异。
   *  必须用 cellStyles:true 读模板：SheetJS 社区版仅在该选项下解析模板 !cols，
   *  否则 XLSX.write 不写 <cols>，A–K 列宽（尤其 K 列 47.259...）在导出文件中丢失。 */
  function buildExportWorkbook(templateBytes, tasks) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('XLSX 未加载');
    var workbook = XLSX.read(templateBytes, { type: 'array', cellStyles: true });
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    applyExportRows(sheet, exportRows(tasks));
    return workbook;
  }

  function validateDraft(doc, identities) {
    var errors = [];
    var push = function (id, field, message) { errors.push({ id: String(id), field: field, message: message }); };
    var tasks = (doc && Array.isArray(doc.tasks)) ? doc.tasks : [];
    if (!Array.isArray(doc && doc.tasks)) { push('-', 'tasks', '任务列表缺失'); return errors; }
    if (!tasks.length) push('-', 'tasks', '任务列表不能为空');
    var seen = {};
    tasks.forEach(function (task) {
      var id = task && task.id ? String(task.id) : '-';
      if (!task || !task.id) push(id, 'id', '任务 id 缺失');
      else if (seen[task.id]) push(id, 'id', '任务 id 重复');
      else seen[task.id] = true;

      ['level1', 'level2', 'task', 'owner'].forEach(function (field) {
        var value = task[field];
        if (typeof value !== 'string' || value.trim() === '') push(id, field, fieldLabel(field) + '不能为空');
        else if (value.length > MAX_LEN[field]) push(id, field, fieldLabel(field) + '长度超过 ' + MAX_LEN[field]);
      });
      if (typeof task.owner === 'string' && task.owner.trim() !== '' && identities && identities.length && identities.indexOf(task.owner) === -1) {
        push(id, 'owner', '负责人必须是九身份之一');
      }
      if (typeof task.demo === 'string' && task.demo.length > MAX_LEN.demo) push(id, 'demo', '是否演示范围取值过长');
      if (typeof task.note === 'string' && task.note.length > MAX_LEN.note) push(id, 'note', '进展说明长度超过 ' + MAX_LEN.note);
      DATE_KEYS.forEach(function (key) {
        var value = (task.dates || {})[key];
        if (typeof value !== 'string') push(id, 'dates.' + key, DATE_LABELS[key] + '日期必须是文本');
        else if (value !== '' && !DATE_RE.test(value)) push(id, 'dates.' + key, DATE_LABELS[key] + '日期格式必须为 YYYY-MM-DD');
      });
      if (STATUSES.indexOf(task.status) === -1) push(id, 'status', '状态必须是 ' + STATUSES.join(' / ') + ' 之一');
    });
    return errors;
  }

  function nextTaskId(tasks) {
    var max = 0;
    (tasks || []).forEach(function (task) {
      var match = /^T(\d+)$/.exec(String(task && task.id));
      if (match) max = Math.max(max, Number(match[1]));
    });
    var next = max + 1;
    return 'T' + String(next).padStart(3, '0');
  }

  var Core = {
    PM: PM,
    STATUSES: STATUSES,
    DATE_KEYS: DATE_KEYS,
    STRUCT_FIELDS: STRUCT_FIELDS,
    IDENTITY_KEY: IDENTITY_KEY,
    isPM: isPM,
    canEditField: canEditField,
    fieldLabel: fieldLabel,
    readField: readField,
    writeField: writeField,
    filterTasks: filterTasks,
    groupFlags: groupFlags,
    exportRows: exportRows,
    applyExportRows: applyExportRows,
    buildExportWorkbook: buildExportWorkbook,
    parseRange: parseRange,
    validateDraft: validateDraft,
    nextTaskId: nextTaskId
  };
  global.WBSCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;

  /* -------------------------------------------------------------- DOM */

  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!document.getElementById('workbench')) return;

  var state = {
    doc: null,
    identity: null,
    revision: null,
    dirty: false,
    filter: { q: '', owner: '', status: '' },
    errorCells: {},
    health: null
  };

  function $(id) { return document.getElementById(id); }

  function showBanner(kind, text, withReload) {
    var banner = $('banner');
    banner.className = 'banner' + (kind ? ' ' + kind : '');
    $('banner-text').textContent = text;
    $('banner-action').hidden = !withReload;
    banner.hidden = false;
  }

  function hideBanner() { $('banner').hidden = true; }

  function showHint(text) {
    var hint = $('hint');
    hint.textContent = text;
    hint.hidden = false;
  }

  function setSession(text, dirty) {
    var el = $('session-status');
    el.textContent = text;
    el.className = 'session-status' + (dirty ? ' dirty' : '');
  }

  function updateSession() {
    var parts = [];
    parts.push('身份：' + (state.identity || '未选择'));
    parts.push('版本：' + (state.revision == null ? '-' : state.revision));
    parts.push(state.dirty ? '有未保存修改' : '已与服务器一致');
    setSession(parts.join(' · '), state.dirty);
    $('save-btn').disabled = !state.dirty;
  }

  function renderIdentityLayer() {
    var list = $('identity-list');
    list.textContent = '';
    state.doc.identities.forEach(function (identity) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'identity-btn' + (isPM(identity) ? ' pm' : '');
      button.setAttribute('data-identity', identity);
      var name = document.createElement('span');
      name.className = 'identity-name';
      name.textContent = identity;
      var role = document.createElement('span');
      role.className = 'identity-role';
      role.textContent = isPM(identity) ? '可维护全表与增删行' : '仅可编辑本人负责的行';
      button.appendChild(name);
      button.appendChild(role);
      button.addEventListener('click', function () { chooseIdentity(identity); });
      list.appendChild(button);
    });
  }

  function chooseIdentity(identity) {
    if (state.doc.identities.indexOf(identity) === -1) {
      var err = $('identity-error');
      err.textContent = '无效身份：' + identity;
      err.hidden = false;
      return;
    }
    $('identity-error').hidden = true;
    state.identity = identity;
    try { global.localStorage.setItem(IDENTITY_KEY, identity); } catch (e) { /* 隐私模式忽略 */ }
    $('identity-layer').hidden = true;
    $('workbench').hidden = false;
    render();
    showHint('已以「' + identity + '」身份进入工作台，' + (isPM(identity) ? '可编辑全部行并增删行。' : '仅“负责人 == ' + identity + '”的行可编辑。'));
  }

  function renderFilters() {
    var identitySelect = $('identity-select');
    identitySelect.textContent = '';
    state.doc.identities.forEach(function (identity) {
      var option = document.createElement('option');
      option.value = identity;
      option.textContent = isPM(identity) ? identity + '（项目负责人）' : identity;
      identitySelect.appendChild(option);
    });
    identitySelect.value = state.identity || state.doc.identities[0];

    var ownerFilter = $('owner-filter');
    var keepOwner = ownerFilter.value;
    ownerFilter.textContent = '';
    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = '全部';
    ownerFilter.appendChild(allOption);
    state.doc.identities.forEach(function (identity) {
      var option = document.createElement('option');
      option.value = identity;
      option.textContent = identity;
      ownerFilter.appendChild(option);
    });
    ownerFilter.value = state.filter.owner || '';
    if (!ownerFilter.value && keepOwner) ownerFilter.value = '';

    var statusFilter = $('status-filter');
    statusFilter.textContent = '';
    var anyStatus = document.createElement('option');
    anyStatus.value = '';
    anyStatus.textContent = '全部';
    statusFilter.appendChild(anyStatus);
    STATUSES.forEach(function (status) {
      var option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      statusFilter.appendChild(option);
    });
    statusFilter.value = state.filter.status || '';
  }

  function cellKey(id, field) { return id + '|' + field; }

  function showReadOnlyHint(task, field) {
    showHint('当前身份「' + state.identity + '」对第 ' + task.id + ' 行的「' + fieldLabel(field) + '」只读' +
      (isPM(state.identity) ? '' : '（仅“负责人 == 自己”的行、且仅非结构性字段可改）'));
  }

  function buildCell(task, field, className) {
    var td = document.createElement('td');
    var editable = canEditField(state.identity, task, field);
    td.className = 'cell ' + className + ' ' + (editable ? 'editable' : 'locked');
    td.setAttribute('data-id', task.id);
    td.setAttribute('data-field', field);
    td.textContent = readField(task, field);
    if (state.errorCells[cellKey(task.id, field)]) td.classList.add('cell-error');
    td.addEventListener('click', function () {
      if (td.classList.contains('editing')) return;
      if (!canEditField(state.identity, task, field)) {
        showReadOnlyHint(task, field);
        return;
      }
      startEdit(td, task, field, className);
    });
    return td;
  }

  function startEdit(td, task, field, className) {
    var value = readField(task, field);
    var editor;
    if (field === 'status') {
      editor = document.createElement('select');
      STATUSES.forEach(function (status) {
        var option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        editor.appendChild(option);
      });
      editor.value = value || STATUSES[0];
    } else if (field === 'owner') {
      editor = document.createElement('select');
      editor.className = 'owner-select';
      state.doc.identities.forEach(function (identity) {
        var option = document.createElement('option');
        option.value = identity;
        option.textContent = identity;
        editor.appendChild(option);
      });
      editor.value = value;
    } else if (field === 'demo') {
      editor = document.createElement('select');
      ['', '是', '否'].forEach(function (option) {
        var item = document.createElement('option');
        item.value = option;
        item.textContent = option === '' ? '（未填写）' : option;
        editor.appendChild(item);
      });
      editor.value = value;
    } else if (field.indexOf('dates.') === 0) {
      editor = document.createElement('input');
      editor.type = 'date';
      editor.className = 'date-input';
      editor.value = value;
    } else if (field === 'note') {
      editor = document.createElement('textarea');
      editor.value = value;
      editor.rows = 2;
    } else {
      editor = document.createElement('input');
      editor.type = 'text';
      editor.value = value;
    }
    editor.setAttribute('data-edit-field', field);

    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      if (save) {
        var next = editor.value;
        var previous = readField(task, field);
        if (next !== previous) {
          writeField(task, field, next);
          state.dirty = true;
          state.errorCells = {};
          task.__dirty = true;
          showHint('已修改第 ' + task.id + ' 行的「' + fieldLabel(field) + '」，点击“保存”提交到服务器。');
        }
      }
      render();
    }

    td.textContent = '';
    td.classList.add('editing');
    td.appendChild(editor);
    editor.focus();
    if (editor.select) { try { editor.select(); } catch (e) { /* date input 不支持 */ } }
    editor.addEventListener('change', function () { commit(true); });
    editor.addEventListener('blur', function () { commit(true); });
    editor.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && field !== 'note') { event.preventDefault(); commit(true); }
      if (event.key === 'Escape') { event.preventDefault(); commit(false); }
    });
  }

  function renderRow(task, flags) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-id', task.id);
    if (flags.l1Start) tr.classList.add('l1-start');
    if (flags.l2Start) tr.classList.add('l2-start');
    if (!flags.l1Start && !flags.l2Start) tr.classList.add('continuation');
    if (task.__dirty) tr.classList.add('row-dirty');

    var idCell = document.createElement('td');
    idCell.className = 'cell cell-id locked';
    idCell.setAttribute('data-id', task.id);
    idCell.setAttribute('data-field', 'id');
    idCell.textContent = task.id;
    idCell.addEventListener('click', function () { showReadOnlyHint(task, 'id'); });
    tr.appendChild(idCell);

    ['level1', 'level2'].forEach(function (field, index) {
      tr.appendChild(buildCell(task, field, index === 0 ? 'cell-l1' : 'cell-l2'));
    });
    ['task', 'owner', 'demo'].forEach(function (field) {
      tr.appendChild(buildCell(task, field, 'cell-' + field));
    });
    DATE_KEYS.forEach(function (key) { tr.appendChild(buildCell(task, 'dates.' + key, 'cell-date')); });
    tr.appendChild(buildCell(task, 'note', 'cell-note'));

    var statusCell = buildCell(task, 'status', 'cell-status');
    statusCell.textContent = '';
    var badge = document.createElement('span');
    badge.className = 'badge status-' + task.status;
    badge.textContent = task.status;
    statusCell.appendChild(badge);
    tr.appendChild(statusCell);

    var opCell = document.createElement('td');
    opCell.className = 'cell cell-op';
    if (isPM(state.identity)) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-mini';
      remove.setAttribute('data-delete', task.id);
      remove.textContent = '删除';
      remove.addEventListener('click', function () { deleteRow(task.id); });
      opCell.appendChild(remove);
    }
    tr.appendChild(opCell);
    return tr;
  }

  function render() {
    if (!state.doc) return;
    renderFilters();
    var tasks = filterTasks(state.doc.tasks, state.filter);
    var flags = groupFlags(tasks);
    var body = $('wbs-body');
    body.textContent = '';
    tasks.forEach(function (task, index) { body.appendChild(renderRow(task, flags[index])); });
    $('empty-state').hidden = tasks.length !== 0;
    $('task-count').textContent = tasks.length === state.doc.tasks.length
      ? state.doc.tasks.length + ' 条'
      : tasks.length + ' / ' + state.doc.tasks.length + ' 条';
    $('add-row-btn').hidden = !isPM(state.identity);
    updateSession();
  }

  function addRow() {
    if (!isPM(state.identity)) { showHint('仅「项目负责人」可以新增行。'); return; }
    var task = {
      id: nextTaskId(state.doc.tasks),
      level1: '', level2: '', task: '', owner: state.doc.identities[0] === PM ? state.doc.identities[1] : state.doc.identities[0],
      demo: '', dates: { design: '', dev: '', test: '', product: '', demo_prep: '' }, note: '', status: STATUSES[0], __dirty: true
    };
    state.doc.tasks.push(task);
    state.dirty = true;
    state.errorCells = {};
    state.filter = { q: '', owner: '', status: '' };
    $('search-input').value = '';
    render();
    showHint('已新增第 ' + task.id + ' 行，请补充一级 / 二级 / 任务项后保存。');
  }

  function deleteRow(id) {
    if (!isPM(state.identity)) { showHint('仅「项目负责人」可以删除行。'); return; }
    var task = state.doc.tasks.filter(function (item) { return item.id === id; })[0];
    if (!task) return;
    var label = '确认删除任务 ' + id + '（' + (task.task || '未命名') + '）？该操作需保存后生效。';
    var confirmed = typeof global.confirm === 'function' ? global.confirm(label) : true;
    if (!confirmed) { showHint('已取消删除 ' + id + '。'); return; }
    state.doc.tasks = state.doc.tasks.filter(function (item) { return item.id !== id; });
    state.dirty = true;
    state.errorCells = {};
    render();
    showHint('已删除第 ' + id + ' 行，点击“保存”提交到服务器。');
  }

  function markErrorCells(errors) {
    state.errorCells = {};
    errors.forEach(function (error) { state.errorCells[cellKey(error.id, error.field)] = true; });
  }

  async function save() {
    var errors = validateDraft(state.doc, state.doc.identities);
    if (errors.length) {
      markErrorCells(errors);
      var detail = errors.slice(0, 3).map(function (error) {
        return '[' + error.id + '] ' + fieldLabel(error.field) + '：' + error.message;
      }).join('；');
      showBanner('error', '前置校验未通过，未向服务器提交（共 ' + errors.length + ' 项）：' + detail +
        (errors.length > 3 ? ' …' : ''));
      render();
      return { ok: false, errors: errors };
    }
    var payload = {
      meta: { name: state.doc.meta.name },
      identities: state.doc.identities.slice(),
      tasks: state.doc.tasks.map(function (task) {
        var clean = {};
        Object.keys(task).forEach(function (key) { if (key !== '__dirty') clean[key] = task[key]; });
        return clean;
      })
    };
    var response;
    try {
      response = await fetch('/api/wbs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(state.revision), 'X-Identity': encodeURIComponent(String(state.identity)) },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      showBanner('error', '保存失败：无法连接服务（' + err.message + '）');
      return { ok: false, error: 'network' };
    }
    if (response.status === 200) {
      var result = await response.json();
      state.revision = result.revision;
      state.doc.meta.revision = result.revision;
      state.doc.tasks.forEach(function (task) { delete task.__dirty; });
      state.dirty = false;
      state.errorCells = {};
      render();
      showBanner('ok', '保存成功，服务器版本号已更新为 ' + result.revision + '（页面、API、磁盘三端一致）。');
      return { ok: true, revision: result.revision };
    }
    if (response.status === 409) {
      var conflict = await response.json();
      state.dirty = true;
      render();
      showBanner('warn', '版本冲突：服务器当前版本为 ' + conflict.current + '，你的保存基于版本 ' + state.revision +
        '，已拒绝覆盖。请重新加载后再改。', true);
      return { ok: false, conflict: true, current: conflict.current };
    }
    var body = await response.json().catch(function () { return null; });
    var message = body && body.errors
      ? body.errors.slice(0, 3).map(function (error) { return '[' + error.id + '] ' + error.field + '：' + error.message; }).join('；')
      : 'HTTP ' + response.status;
    showBanner('error', '服务器拒绝了这次保存（HTTP ' + response.status + '）：' + message);
    return { ok: false, errors: body && body.errors };
  }

  async function reload() {
    hideBanner();
    var response = await fetch('/api/wbs', { cache: 'no-store' });
    if (!response.ok) { showBanner('error', '重新加载失败：HTTP ' + response.status); return; }
    state.doc = await response.json();
    state.revision = state.doc.meta.revision;
    state.dirty = false;
    state.errorCells = {};
    render();
    showHint('已从服务器重新加载版本 ' + state.revision + '。');
  }

  function exportFileName(date) {
    var now = date || new Date();
    var stamp = String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    return '蓉城战役WBS-' + stamp + '.xlsx';
  }

  async function loadExportWorkbook() {
    var response = await fetch('template.xlsx', { cache: 'no-store' });
    if (!response.ok) throw new Error('模板读取失败 HTTP ' + response.status);
    var buffer = await response.arrayBuffer();
    return Core.buildExportWorkbook(new Uint8Array(buffer), state.doc.tasks);
  }

  async function exportXlsx() {
    try {
      var workbook = await loadExportWorkbook();
      var name = exportFileName();
      global.XLSX.writeFile(workbook, name);
      showBanner('ok', '已按原模板导出 ' + state.doc.tasks.length + ' 行 A–K 数据，文件名 ' + name + '（第 1/2 行与合并单元格保持原样，status 不导出）。');
      return { ok: true, name: name };
    } catch (err) {
      showBanner('error', '导出失败：' + err.message);
      return { ok: false, error: err.message };
    }
  }

  async function checkHealth() {
    var probe = $('health-probe');
    try {
      var response = await fetch('/api/health', { cache: 'no-store' });
      var body = await response.json();
      state.health = body.ok ? 'ok' : 'bad';
      probe.className = 'health-probe ' + (body.ok ? 'ok' : 'bad');
      probe.textContent = body.ok ? '探针：服务正常 · v' + body.revision : '探针：服务异常';
    } catch (err) {
      state.health = 'bad';
      probe.className = 'health-probe bad';
      probe.textContent = '探针：不可达';
    }
  }

  function bindEvents() {
    $('identity-select').addEventListener('change', function (event) {
      chooseIdentity(event.target.value);
    });
    $('search-input').addEventListener('input', function (event) {
      state.filter.q = event.target.value;
      render();
    });
    $('owner-filter').addEventListener('change', function (event) {
      state.filter.owner = event.target.value;
      render();
    });
    $('status-filter').addEventListener('change', function (event) {
      state.filter.status = event.target.value;
      render();
    });
    $('save-btn').addEventListener('click', function () { save(); });
    $('add-row-btn').addEventListener('click', function () { addRow(); });
    $('export-btn').addEventListener('click', function () { exportXlsx(); });
    $('banner-action').addEventListener('click', function () { reload(); });
  }

  async function boot() {
    var response = await fetch('/api/wbs', { cache: 'no-store' });
    if (!response.ok) {
      $('identity-error').textContent = '无法读取数据：HTTP ' + response.status;
      $('identity-error').hidden = false;
      return;
    }
    state.doc = await response.json();
    state.revision = state.doc.meta.revision;
    renderIdentityLayer();
    bindEvents();
    var remembered = null;
    try { remembered = global.localStorage.getItem(IDENTITY_KEY); } catch (e) { remembered = null; }
    if (remembered && state.doc.identities.indexOf(remembered) !== -1) {
      state.identity = remembered;
      $('identity-layer').hidden = true;
      $('workbench').hidden = false;
      render();
      showHint('已按上次选择恢复身份「' + remembered + '」。');
    }
    checkHealth();
    setInterval(checkHealth, 30000);
  }

  global.WBSApp = {
    state: state,
    boot: boot,
    render: render,
    renderIdentityLayer: renderIdentityLayer,
    chooseIdentity: chooseIdentity,
    addRow: addRow,
    deleteRow: deleteRow,
    save: save,
    reload: reload,
    exportXlsx: exportXlsx,
    loadExportWorkbook: loadExportWorkbook,
    exportFileName: exportFileName,
    checkHealth: checkHealth
  };

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
