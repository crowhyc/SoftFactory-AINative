'use strict';
/* WC-001 蓉城战役 WBS 工作系统 —— 前端（身份选择 / 权限矩阵 / 行内编辑 / 本地导出）。 */
(function (global) {
  var PM = '项目负责人';
  var DATE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
  var DATE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
  /* CH-10：五阶段独立进度（phases.<key>，取值见 PHASES）。 */
  var PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
  var PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
  var PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
  var PHASE_HEADERS = ['设计进度', '开发进度', '测试进度', '产品进度', '演示准备进度'];
  /* 五色映射：未开始=灰、已开始=蓝、已完成=绿、延期=红、阻塞=黄。 */
  var PHASE_HEX = { '未开始': '9E9E9E', '已开始': '2F80ED', '已完成': '27AE60', '延期': 'E74C3C', '阻塞': 'FFD400' };
  var PHASE_TEXT = { '未开始': 'FFFFFF', '已开始': 'FFFFFF', '已完成': 'FFFFFF', '延期': 'FFFFFF', '阻塞': '3A2E00' };
  var FIELD_LABELS = {
    id: '序号',
    level1: '一级', level2: '二级', task: '任务项', owner: '负责人', demo: '是否演示范围',
    note: '进展说明',
    'dates.design': '设计', 'dates.dev': '开发', 'dates.test': '测试', 'dates.product': '产品', 'dates.demo_prep': '演示准备'
  };
  PHASE_KEYS.forEach(function (key) {
    FIELD_LABELS['phases.' + key] = PHASE_HEADERS[PHASE_KEYS.indexOf(key)];
    FIELD_LABELS['phases.' + key + '.status'] = PHASE_HEADERS[PHASE_KEYS.indexOf(key)];
  });
  var STRUCT_FIELDS = ['level1', 'level2', 'task', 'owner'];
  var MAX_LEN = { level1: 200, level2: 200, task: 300, owner: 40, demo: 20, note: 20000 };
  /* CH-8：K 进展说明摘要长度（约 80 字符）、面板占位文案与窄视口断点。 */
  var NOTE_SUMMARY_LIMIT = 80;
  var NOTE_PLACEHOLDER = '点击打开编辑';
  var NOTE_PLACEHOLDER_READONLY = '点击查看进展说明';
  var NOTE_NARROW_QUERY = '(max-width: 768px)';
  var IDENTITY_KEY = 'wbs.identity';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  var EXPORT_COL_COUNT = 11;
  var HISTORY_TZ = 'Asia/Shanghai';
  var IDENTITY_MAX_LEN = 20;
  /* CH-13：日报不再产出 xlsx，改为「一键可复制的关键信息文本」弹层（只含阻塞、延期）。
     xlsx 组装（两 sheet、A 列宽、自动换行修补）与其常量已随 CH-13 从导出路径整体移除。 */
  var DAILY_COPY_OK = '已复制，可直接粘贴到微信';
  var DAILY_COPY_FAIL = '复制失败：请手动选择文本后复制。';

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
    if (field.indexOf('phases.') === 0) {
      var phases = task.phases || {};
      var value = phases[field.slice(7)];
      return value == null ? '' : String(value);
    }
    return task[field] == null ? '' : String(task[field]);
  }

  function writeField(task, field, value) {
    if (field.indexOf('dates.') === 0) {
      task.dates = task.dates || {};
      task.dates[field.slice(6)] = value;
      return;
    }
    if (field.indexOf('phases.') === 0) {
      task.phases = task.phases || {};
      task.phases[field.slice(7)] = value;
      return;
    }
    task[field] = value;
  }

  function filterTasks(tasks, filter) {
    var q = ((filter && filter.q) || '').trim().toLowerCase();
    var owner = (filter && filter.owner) || '';
    return tasks.filter(function (task) {
      if (owner && task.owner !== owner) return false;
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

  /* ------------------------------------------------------- WBS 导出辅助 */

  /* 时区下的「今天」YYYY-MM-DD。 */
  function todayInTz(tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || HISTORY_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (err) {
      var offset = new Date(Date.now() + 8 * 3600000);
      return offset.toISOString().slice(0, 10);
    }
  }

  /* 时区下的 YYYY-MM-DD HH:mm:ss。 */
  function formatInTz(iso, tz) {
    var at = new Date(iso);
    if (isNaN(at.getTime())) return iso == null ? '' : String(iso);
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: tz || HISTORY_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      }).format(at);
    } catch (err) {
      return at.toISOString();
    }
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

  /** A–K 为原模板 11 列（含 E 是否演示范围），L–P 为 CH-10 追加的五个阶段进度列。 */
  var EXPORT_PHASE_FIRST_COL = EXPORT_COL_COUNT;                       // L（0 基索引 11）
  var EXPORT_TOTAL_COL_COUNT = EXPORT_COL_COUNT + PHASE_KEYS.length;   // P（16 列）

  /** 仅覆写 A3:K(3+n-1)（其余原文不动），在 K 之后追加五个进度列（文字 + 填充色），
   *  清空原数据区超出新行数的残留，并把 !ref 扩到 Q 列（供「导出日期」标签右移落位）。 */
  function applyExportRows(worksheet, rows, startRow, tasks) {
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
      for (var c2 = 0; c2 < EXPORT_TOTAL_COL_COUNT; c2 += 1) {
        var addr = addrOf(r, c2);
        if (worksheet[addr]) delete worksheet[addr];
      }
    }
    if (Array.isArray(tasks)) applyExportPhases(worksheet, tasks, first);
    var lastRow = Math.max(originalLastRow, first + rows.length - 1);
    worksheet['!ref'] = 'A1:' + colName(EXPORT_TOTAL_COL_COUNT) + lastRow; // Q 列用于「导出日期」标签
    return lastRow;
  }

  /** CH-10：行 2 写五进度列表头，数据区写状态文字并尝试填充对应颜色。 */
  function applyExportPhases(worksheet, tasks, first) {
    var headerStyle = worksheet['K2'] && worksheet['K2'].s;
    PHASE_KEYS.forEach(function (key, index) {
      var header = { t: 's', v: PHASE_HEADERS[index] };
      if (headerStyle !== undefined) header.s = headerStyle;
      worksheet[addrOf(2, EXPORT_PHASE_FIRST_COL + index)] = header;
    });
    tasks.forEach(function (task, rowIndex) {
      PHASE_KEYS.forEach(function (key, index) {
        var value = (task && task.phases) ? task.phases[key] : '';
        var text = value == null ? '' : String(value);
        var cell = { t: 's', v: text };
        var rgb = PHASE_HEX[text];
        if (rgb) cell.s = { patternType: 'solid', fgColor: { rgb: rgb }, bgColor: { indexed: 64 } };
        worksheet[addrOf(first + rowIndex, EXPORT_PHASE_FIRST_COL + index)] = cell;
      });
    });
  }

  /** 导出构建：页面导出与作者自测走同一实现，消除缺陷 D-1 的双路径差异。
   *  必须用 cellStyles:true 读模板：SheetJS 社区版仅在该选项下解析模板 !cols，
   *  否则 XLSX.write 不写 <cols>，A–K 列宽（尤其 K 列 47.259...）在导出文件中丢失。 */
  function buildExportWorkbook(templateBytes, tasks) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('XLSX 未加载');
    var workbook = XLSX.read(templateBytes, { type: 'array', cellStyles: true });
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    applyExportRows(sheet, exportRows(tasks), 3, tasks);
    stampExportLabel(sheet, new Date());
    return workbook;
  }

  /** CH-6 / CH-10：导出日期标签（Asia/Shanghai，精确到分钟）。
   *  CH-10 起 K 之后追加 5 个进度列，标签随新列右移到最后一个排序列之后的 Q1；内容与格式不变。 */
  function stampExportLabel(sheet, at) {
    var when = (at instanceof Date) ? at.toISOString() : String(at);
    sheet[addrOf(1, EXPORT_TOTAL_COL_COUNT)] = { t: 's', v: '导出日期：' + formatInTz(when, HISTORY_TZ).slice(0, 16) };
  }

  /* ---------------- CH-10：进度列颜色填充（最小 ZIP 级修补） ----------------
   * 随包 SheetJS 0.18.5 社区版读得到单元格样式、却不在写出时生成 <fills>/cellXfs，
   * 且 !ref 之外的单元格会被丢弃。因此这里不走旁路：仍用同一份 Core.buildExportWorkbook
   * 生成工作表，再以「不压缩写盘」得到 STORED 的 xlsx 字节，只在两处做最小修补：
   *   a) xl/styles.xml：追加 5 个纯色 fill 与对应 cellXfs（未开始灰 / 已开始蓝 / 已完成绿 / 延期红 / 阻塞黄）；
   *   b) xl/worksheets/sheet1.xml：给 L–P 数据区单元格加 s="<xf>"。
   * 其余条目逐字节保持不变；重新封装时统一用 STORED 与正确的 CRC32/长度，仍是合法 zip。
   * 零新增依赖、不联网。 */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var value = n;
      for (var bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      table[n] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8Encode(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    var escaped = unescape(encodeURIComponent(text));
    var out = new Uint8Array(escaped.length);
    for (var i = 0; i < escaped.length; i += 1) out[i] = escaped.charCodeAt(i) & 0xFF;
    return out;
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
    var text = '';
    for (var i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(text));
  }

  /* 读 STORED zip 的全部条目（按中央目录顺序）。非 STORED 时抛错，由调用方回落。 */
  function readStoredZip(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('xlsx zip 缺少 EOCD');
    var count = view.getUint16(eocd + 10, true);
    var pointer = view.getUint32(eocd + 16, true);
    var entries = [];
    for (var n = 0; n < count; n += 1) {
      if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('xlsx zip 中央目录异常');
      var method = view.getUint16(pointer + 10, true);
      var size = view.getUint32(pointer + 20, true);
      var nameLen = view.getUint16(pointer + 28, true);
      var extraLen = view.getUint16(pointer + 30, true);
      var commentLen = view.getUint16(pointer + 32, true);
      var localOffset = view.getUint32(pointer + 42, true);
      var name = utf8Decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
      var localNameLen = view.getUint16(localOffset + 26, true);
      var localExtraLen = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + localNameLen + localExtraLen;
      if (method !== 0) throw new Error('xlsx 条目为压缩存储，无法修补：' + name);
      entries.push({ name: name, data: bytes.subarray(dataStart, dataStart + size) });
      pointer += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function writeStoredZip(entries) {
    var locals = [];
    var central = [];
    var offset = 0;
    entries.forEach(function (entry) {
      var name = utf8Encode(entry.name);
      var data = entry.data;
      var crc = crc32(data);
      var header = new Uint8Array(30 + name.length);
      var hv = new DataView(header.buffer);
      hv.setUint32(0, 0x04034b50, true);
      hv.setUint16(4, 20, true);
      hv.setUint16(6, 0, true);
      hv.setUint16(8, 0, true);
      hv.setUint16(10, 0, true);
      hv.setUint16(12, 0x21, true);
      hv.setUint32(14, crc, true);
      hv.setUint32(18, data.length, true);
      hv.setUint32(22, data.length, true);
      hv.setUint16(26, name.length, true);
      header.set(name, 30);
      locals.push(header, data);

      var directory = new Uint8Array(46 + name.length);
      var dv = new DataView(directory.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint16(14, 0x21, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, data.length, true);
      dv.setUint32(24, data.length, true);
      dv.setUint16(28, name.length, true);
      dv.setUint32(42, offset, true);
      directory.set(name, 46);
      central.push(directory);
      offset += header.length + data.length;
    });
    var centralSize = central.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    var out = new Uint8Array(offset + centralSize + 22);
    var at = 0;
    locals.concat(central).forEach(function (chunk) { out.set(chunk, at); at += chunk.length; });
    out.set(eocd, at);
    return out;
  }

  /** 给 L–P 进度列数据区单元格补上颜色填充样式（其余条目逐字节保留）。 */
  function patchPhaseStyles(bytes, tasks, first) {
    var entries = readStoredZip(bytes);
    var fills = '';
    var xfs = '';
    PHASES.forEach(function (phase, index) {
      fills += '<fill><patternFill patternType="solid"><fgColor rgb="FF' + PHASE_HEX[phase] +
        '"/><bgColor indexed="64"/></patternFill></fill>';
      xfs += '<xf numFmtId="0" fontId="0" fillId="' + (index + 2) + '" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>';
    });
    var firstRow = first || 3;
    entries.forEach(function (entry) {
      if (entry.name === 'xl/styles.xml') {
        var styles = utf8Decode(entry.data)
          .replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, function (all, count, body) {
            return '<fills count="' + (Number(count) + PHASES.length) + '">' + body + fills + '</fills>';
          })
          .replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, function (all, count, body) {
            return '<cellXfs count="' + (Number(count) + PHASES.length) + '">' + body + xfs + '</cellXfs>';
          });
        entry.data = utf8Encode(styles);
        return;
      }
      if (entry.name === 'xl/worksheets/sheet1.xml') {
        var sheet = utf8Decode(entry.data);
        tasks.forEach(function (task, rowIndex) {
          PHASE_KEYS.forEach(function (key, columnIndex) {
            var value = (task && task.phases) ? task.phases[key] : '';
            var xf = PHASES.indexOf(value) + 1;
            if (!xf) return;
            var ref = addrOf(firstRow + rowIndex, EXPORT_PHASE_FIRST_COL + columnIndex);
            var pattern = new RegExp('<c r="' + ref + '"([^>]*?)(\\/?)>');
            sheet = sheet.replace(pattern, function (all, attrs, selfClose) {
              if (/(^|\s)s="\d+"/.test(attrs)) return all;
              return '<c r="' + ref + '"' + attrs + ' s="' + xf + '"' + selfClose + '>';
            });
          });
        });
        entry.data = utf8Encode(sheet);
      }
    });
    return writeStoredZip(entries);
  }

  /** 导出字节：同一份 Core.buildExportWorkbook → 不压缩写出 → 进度列上色。 */
  function exportBytes(templateBytes, tasks) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('XLSX 未加载');
    var workbook = buildExportWorkbook(templateBytes, tasks);
    var raw = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: false });
    try {
      return patchPhaseStyles(new Uint8Array(raw), tasks, 3);
    } catch (err) {
      /* 修补失败不改变导出语义：回落到未上色但 A–K 保真的文件。 */
      return new Uint8Array(raw);
    }
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
      /* CH-10：前端只校验五阶段进度（旧 status 已不由前端编辑，其合法性由服务端兜底）。 */
      PHASE_KEYS.forEach(function (key) {
        var phase = (task.phases || {})[key];
        if (PHASES.indexOf(phase) === -1) push(id, 'phases.' + key, PHASE_LABELS[key] + '进度必须是 ' + PHASES.join(' / ') + ' 之一');
      });
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


  /* ------------------------------------------------------------------
   * CH-8：进展说明 —— 摘要（去 Markdown 纯文本）与自研 Markdown 子集渲染器。
   * 渲染器支持 H1–H3 / 粗体 / 斜体 / 删除线 / 行内代码 / 代码块 / 引用 /
   * 有序·无序列表 / 链接；其余语法按纯文本显示。
   * 安全边界：所有文本都以 createTextNode 写入 DOM（等效「先转义再插入」），
   *          从不使用 innerHTML，原始 HTML 一律原样显示、不执行；
   *          图片语法（![...](...)）不解析、不加载，只作为安全文本落地，
   *          渲染与页面加载阶段都不对外发任何请求。
   * ------------------------------------------------------------------ */

  /** 去 Markdown 标记并合并为单行；超长按 limit 字符截断（加省略号）。 */
  function noteSummary(note, limit) {
    var max = limit == null ? NOTE_SUMMARY_LIMIT : limit;
    var text = String(note == null ? '' : note).replace(/\r\n?/g, '\n');
    if (text.trim() === '') return '';
    text = text.replace(/^\s{0,3}(?:```|~~~)[^\n]*$/gm, ' ');        // 代码围栏行（保留代码内容）
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, function (all, alt) { return alt || ''; }); // 图片 → alt 文本
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');             // 链接 → 只留文字
    text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '');                   // 标题符
    text = text.replace(/^\s{0,3}>\s?/gm, '');                        // 引用符
    text = text.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '');        // 列表符
    text = text.replace(/(\*\*\*|\*\*|\*|___|__|~~)([^\s\*_~]+?)\1/g, '$2'); // 成对强调标记
    text = text.replace(/[`*~]/g, '');                                // 残留标记符
    text = text.replace(/\s+/g, ' ').trim();
    var chars = Array.from(text);
    if (chars.length > max) text = chars.slice(0, max).join('') + '…';
    return text;
  }

  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 行内语法 → 节点。全部文本走 createTextNode，天然转义。 */
  function appendInline(parent, source, doc) {
    var text = String(source == null ? '' : source);
    var buffer = '';
    var flush = function () {
      if (buffer !== '') { parent.appendChild(doc.createTextNode(buffer)); buffer = ''; }
    };
    var wrap = function (tag, value, className) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      appendInline(node, value, doc);
      return node;
    };
    var index = 0;
    while (index < text.length) {
      var rest = text.slice(index);
      var match;
      if ((match = /^!\[[^\]]*\]\([^)\n]*\)/.exec(rest))) {          // 图片：原样文本，不解析不加载
        buffer += match[0];
        index += match[0].length;
        continue;
      }
      if ((match = /^`([^`\n]+)`/.exec(rest))) { flush(); parent.appendChild(wrap('code', match[1])); index += match[0].length; continue; }
      if ((match = /^\*\*([^\n]+?)\*\*/.exec(rest))) { flush(); parent.appendChild(wrap('strong', match[1])); index += match[0].length; continue; }
      if ((match = /^__([^\n]+?)__/.exec(rest))) { flush(); parent.appendChild(wrap('strong', match[1])); index += match[0].length; continue; }
      if ((match = /^\*([^\n*]+?)\*/.exec(rest))) { flush(); parent.appendChild(wrap('em', match[1])); index += match[0].length; continue; }
      if ((match = /^_([^\n_]+?)_/.exec(rest))) { flush(); parent.appendChild(wrap('em', match[1])); index += match[0].length; continue; }
      if ((match = /^~~([^\n]+?)~~/.exec(rest))) { flush(); parent.appendChild(wrap('del', match[1])); index += match[0].length; continue; }
      if ((match = /^\[([^\]\n]*)\]\(([^)\n]*)\)/.exec(rest))) {     // 链接：外链一律新窗口 + noopener
        flush();
        var link = doc.createElement('a');
        link.setAttribute('href', match[2]);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        appendInline(link, match[1], doc);
        parent.appendChild(link);
        index += match[0].length;
        continue;
      }
      buffer += text.charAt(index);
      index += 1;
    }
    flush();
    return parent;
  }

  function isBlockStart(line) {
    return /^\s*$/.test(line) || /^\s{0,3}(?:```|~~~)/.test(line) || /^\s{0,3}#{1,3}\s/.test(line) ||
      /^\s{0,3}>/.test(line) || /^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(line);
  }

  function appendParagraphs(parent, lines, doc) {
    var buffer = [];
    var flush = function () {
      if (!buffer.length) return;
      var p = doc.createElement('p');
      buffer.forEach(function (line, index) {
        if (index > 0) p.appendChild(doc.createElement('br'));
        appendInline(p, line, doc);
      });
      parent.appendChild(p);
      buffer = [];
    };
    lines.forEach(function (line) {
      if (/^\s*$/.test(line)) { flush(); return; }
      var heading = /^\s{0,3}(#{1,6})\s*(.*)$/.exec(line);
      if (heading && heading[1].length <= 3) {
        flush();
        var h = doc.createElement('h' + heading[1].length);
        appendInline(h, heading[2], doc);
        parent.appendChild(h);
        return;
      }
      buffer.push(line);
    });
    flush();
  }

  /** Markdown 子集 → DocumentFragment（doc 缺省用当前文档；纯逻辑测试可注入 jsdom 文档）。 */
  function renderNoteMarkdown(markdown, doc) {
    var documentNode = doc || (typeof document === 'undefined' ? null : document);
    if (!documentNode) throw new Error('缺少 document');
    var fragment = documentNode.createDocumentFragment();
    var lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
    var index = 0;
    while (index < lines.length) {
      var line = lines[index];
      var fence = /^\s{0,3}(```|~~~)/.exec(line);
      if (fence) {
        var codeLines = [];
        index += 1;
        while (index < lines.length && !/^\s{0,3}(?:```|~~~)\s*$/.test(lines[index])) { codeLines.push(lines[index]); index += 1; }
        if (index < lines.length) index += 1;
        var pre = documentNode.createElement('pre');
        var code = documentNode.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        fragment.appendChild(pre);
        continue;
      }
      if (/^\s*$/.test(line)) { index += 1; continue; }
      var heading = /^\s{0,3}(#{1,6})\s*(.*)$/.exec(line);
      if (heading && heading[1].length <= 3) {
        var level = heading[1].length;
        var h = documentNode.createElement('h' + level);
        appendInline(h, heading[2], documentNode);
        fragment.appendChild(h);
        index += 1;
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        var quoteLines = [];
        while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
          index += 1;
        }
        var quote = documentNode.createElement('blockquote');
        appendParagraphs(quote, quoteLines, documentNode);
        fragment.appendChild(quote);
        continue;
      }
      var listMatch = /^\s{0,3}([-*+]|\d+[.)])\s+/.exec(line);
      if (listMatch) {
        var ordered = /\d/.test(listMatch[1]);
        var list = documentNode.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          var item = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
          if (!item) break;
          var li = documentNode.createElement('li');
          appendInline(li, item[2], documentNode);
          list.appendChild(li);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      var paragraphLines = [];
      while (index < lines.length && !isBlockStart(lines[index])) { paragraphLines.push(lines[index]); index += 1; }
      appendParagraphs(fragment, paragraphLines, documentNode);
    }
    return fragment;
  }

  var Core = {
    PM: PM,
    DATE_KEYS: DATE_KEYS,
    PHASE_KEYS: PHASE_KEYS,
    PHASES: PHASES,
    PHASE_LABELS: PHASE_LABELS,
    PHASE_HEADERS: PHASE_HEADERS,
    PHASE_HEX: PHASE_HEX,
    PHASE_TEXT: PHASE_TEXT,
    EXPORT_TOTAL_COL_COUNT: EXPORT_TOTAL_COL_COUNT,
    applyExportPhases: applyExportPhases,
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
    stampExportLabel: stampExportLabel,
    exportBytes: exportBytes,
    patchPhaseStyles: patchPhaseStyles,
    readStoredZip: readStoredZip,
    writeStoredZip: writeStoredZip,
    crc32: crc32,
    DAILY_COPY_OK: DAILY_COPY_OK,
    DAILY_COPY_FAIL: DAILY_COPY_FAIL,
    todayInTz: todayInTz,
    formatInTz: formatInTz,
    parseRange: parseRange,
    NOTE_SUMMARY_LIMIT: NOTE_SUMMARY_LIMIT,
    NOTE_PLACEHOLDER: NOTE_PLACEHOLDER,
    NOTE_PLACEHOLDER_READONLY: NOTE_PLACEHOLDER_READONLY,
    noteSummary: noteSummary,
    renderNoteMarkdown: renderNoteMarkdown,
    escapeText: escapeText,
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
    filter: { q: '', owner: '' },
    errorCells: {},
    health: null,
    editingRows: {},
    notePanel: { open: false, taskId: null, original: '', readonly: false, dirty: false, tab: 'edit' },
    /* CH-13：日报文本弹层。 */
    dailyPanel: { open: false },
    dailyText: ''
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
    $('identity-add').hidden = !canAddIdentity();
  }

  /* 身份选择页尚无「当前身份」，因此以最近一次选中的身份判断是否展示「新增人员」入口。 */
  function rememberedIdentity() {
    try { return global.localStorage.getItem(IDENTITY_KEY) || ''; } catch (e) { return ''; }
  }

  function canAddIdentity() {
    return isPM(state.identity) || isPM(rememberedIdentity());
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
    state.editingRows = {};
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
    if (state.errorCells[cellKey(task.id, field)]) td.classList.add('cell-error');
    // 行编辑态：可编辑的文本类字段常显编辑器（点击只读单元格仍给中文提示）。
    if (editable && state.editingRows[task.id]) {
      td.classList.add('editing');
      var editor = buildEditor(field, readField(task, field));
      bindEditorChange(editor, task, field);
      td.appendChild(editor);
      return td;
    }
    td.textContent = readField(task, field);
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

  /* 编辑器构件：与既有 startEdit 共用，行编辑态与单元格编辑态外观一致。 */
  function buildEditor(field, value) {
    var editor;
    if (field.indexOf('phases.') === 0) {
      editor = createPhaseSelect(field, value);
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
    } else {
      editor = document.createElement('input');
      editor.type = 'text';
      editor.value = value;
    }
    editor.setAttribute('data-edit-field', field);
    return editor;
  }

  /* CH-10 五档阶段下拉：常显控件；选项与当前值都带对应颜色（未开始灰 / 已开始蓝 / 已完成绿 / 延期红 / 阻塞黄）。 */
  function createPhaseSelect(field, value) {
    var select = document.createElement('select');
    var current = PHASES.indexOf(value) === -1 ? PHASES[0] : value;
    select.className = 'phase-select phase-block phase-' + (value || PHASES[0]);
    select.setAttribute('data-edit-field', field);
    select.setAttribute('data-phase', field.slice(7));
    select.setAttribute('data-phase-value', current);
    PHASES.forEach(function (phase) {
      var option = document.createElement('option');
      option.value = phase;
      option.textContent = phase;
      option.className = 'phase-' + phase;
      select.appendChild(option);
    });
    select.value = current;
    return select;
  }

  /* 常显控件（日期 / 阶段进度 / 负责人）与行编辑态共用的提交逻辑：change 即写入草稿。 */
  function bindEditorChange(editor, task, field) {
    editor.addEventListener('change', function () {
      var next = editor.value;
      var previous = readField(task, field);
      if (next === previous) return;
      writeField(task, field, next);
      state.dirty = true;
      state.errorCells = {};
      task.__dirty = true;
      showHint('已修改第 ' + task.id + ' 行的「' + fieldLabel(field) + '」，点击“保存”提交到服务器。');
      render();
    });
    editor.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && field !== 'note') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        var previous = readField(task, field);
        editor.value = previous;
        editor.blur();
      }
    });
  }

  function markErrorCell(td, task, field) {
    if (state.errorCells[cellKey(task.id, field)]) td.classList.add('cell-error');
  }

  /* 日期列：常显 <input type=date>；其下方常显 CH-10 五档阶段进度下拉（可编辑则联动，只读则 disabled）。
     无权限行点击仍给中文提示（沿用既有行为）。 */
  function buildDateCell(task, key) {
    var field = 'dates.' + key;
    var phaseField = 'phases.' + key;
    var td = document.createElement('td');
    var editable = canEditField(state.identity, task, field);
    var phaseEditable = canEditField(state.identity, task, phaseField);
    td.className = 'cell cell-date ' + (editable ? 'editable' : 'locked');
    td.setAttribute('data-id', task.id);
    td.setAttribute('data-field', field);
    var input = document.createElement('input');
    input.type = 'date';
    input.className = 'date-input';
    input.value = readField(task, field);
    input.setAttribute('data-edit-field', field);
    if (editable) bindEditorChange(input, task, field);
    else input.disabled = true;
    td.appendChild(input);

    var phaseWrap = document.createElement('div');
    phaseWrap.className = 'phase-cell' + (phaseEditable ? ' editable' : ' locked');
    phaseWrap.setAttribute('data-id', task.id);
    phaseWrap.setAttribute('data-field', phaseField);
    phaseWrap.setAttribute('title', PHASE_LABELS[key] + '进度：' + (readField(task, phaseField) || PHASES[0]));
    var select = createPhaseSelect(phaseField, readField(task, phaseField));
    if (phaseEditable) bindEditorChange(select, task, phaseField);
    else select.disabled = true;
    phaseWrap.appendChild(select);
    markErrorCell(phaseWrap, task, phaseField);
    if (!phaseEditable) phaseWrap.addEventListener('click', function (event) { event.stopPropagation(); showReadOnlyHint(task, phaseField); });
    td.appendChild(phaseWrap);

    markErrorCell(td, task, field);
    if (!editable) td.addEventListener('click', function () { showReadOnlyHint(task, field); });
    return td;
  }

  /* K 列「进展说明」：显示去 Markdown 的纯文本摘要（单行截断），整格可点击打开大尺寸编辑器。 */
  function buildNoteCell(task) {
    var td = document.createElement('td');
    var editable = canEditField(state.identity, task, 'note');
    td.className = 'cell cell-note ' + (editable ? 'editable note-editable' : 'locked note-locked');
    td.setAttribute('data-id', task.id);
    td.setAttribute('data-field', 'note');
    var note = readField(task, 'note');
    var summary = noteSummary(note);
    td.setAttribute('data-note-empty', summary ? 'false' : 'true');
    td.setAttribute('title', summary || (editable ? NOTE_PLACEHOLDER : NOTE_PLACEHOLDER_READONLY));

    var text = document.createElement('span');
    text.className = 'note-summary' + (summary ? '' : ' note-placeholder');
    text.textContent = summary || (editable ? NOTE_PLACEHOLDER : NOTE_PLACEHOLDER_READONLY);
    td.appendChild(text);

    /* 有编辑权限的行给出「点击打开编辑」样式提示；只读行给出预览提示。 */
    if (summary) {
      var action = document.createElement('span');
      action.className = 'note-action';
      action.textContent = editable ? NOTE_PLACEHOLDER : '点击查看';
      td.appendChild(action);
    }

    markErrorCell(td, task, 'note');
    td.addEventListener('click', function () { openNotePanel(task.id); });
    return td;
  }

  /* 负责人列：项目负责人下拉＝人员池；普通负责人只读（文本 + 点击提示）。 */
  function buildOwnerCell(task) {
    var td = document.createElement('td');
    var editable = canEditField(state.identity, task, 'owner');
    td.className = 'cell cell-owner ' + (editable ? 'editable' : 'locked');
    td.setAttribute('data-id', task.id);
    td.setAttribute('data-field', 'owner');
    if (editable) {
      var select = createOwnerSelect(task);
      td.appendChild(select);
    } else {
      td.textContent = readField(task, 'owner');
      td.addEventListener('click', function () { showReadOnlyHint(task, 'owner'); });
    }
    markErrorCell(td, task, 'owner');
    return td;
  }

  function createOwnerSelect(task) {
    var select = document.createElement('select');
    select.className = 'owner-select';
    select.setAttribute('data-edit-field', 'owner');
    state.doc.identities.forEach(function (identity) {
      var option = document.createElement('option');
      option.value = identity;
      option.textContent = identity;
      select.appendChild(option);
    });
    select.value = readField(task, 'owner');
    bindEditorChange(select, task, 'owner');
    return select;
  }

  function startEdit(td, task, field, className) {
    var editor = buildEditor(field, readField(task, field));

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
    if (state.editingRows[task.id]) tr.classList.add('row-editing');

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
    tr.appendChild(buildCell(task, 'task', 'cell-task'));
    tr.appendChild(buildOwnerCell(task));
    /* CH-9：网页不渲染「是否演示范围」列，也不提供任何编辑入口；数据字段 demo 原样保留（导出/日报仍含原值）。 */
    DATE_KEYS.forEach(function (key) { tr.appendChild(buildDateCell(task, key)); });
    tr.appendChild(buildNoteCell(task));
    /* CH-10：旧全局「状态」列已从网页移除，阶段进度随各日期列下方的五档下拉呈现。 */

    var opCell = document.createElement('td');
    opCell.className = 'cell cell-op';
    var editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-mini';
    editButton.setAttribute('data-edit-row', task.id);
    editButton.textContent = state.editingRows[task.id] ? '完成' : '编辑';
    editButton.addEventListener('click', function () { toggleRowEdit(task); });
    opCell.appendChild(editButton);
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
    $('add-person-btn').hidden = !isPM(state.identity);
    updateSession();
  }

  function addRow() {
    if (!isPM(state.identity)) { showHint('仅「项目负责人」可以新增行。'); return; }
    var task = {
      id: nextTaskId(state.doc.tasks),
      level1: '', level2: '', task: '', owner: state.doc.identities[0] === PM ? state.doc.identities[1] : state.doc.identities[0],
      demo: '', dates: { design: '', dev: '', test: '', product: '', demo_prep: '' },
      phases: { design: '未开始', dev: '未开始', test: '未开始', product: '未开始', demo_prep: '未开始' },
      note: '', status: '未开始', __dirty: true
    };
    state.doc.tasks.push(task);
    state.dirty = true;
    state.errorCells = {};
    state.editingRows[task.id] = true;
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

  /* 该行对当前身份是否存在可编辑字段（普通负责人：仅「负责人 == 自己」的行）。 */
  function rowEditable(task) {
    return canEditField(state.identity, task, 'note') || canEditField(state.identity, task, 'phases.design') ||
      canEditField(state.identity, task, 'level1');
  }

  /* 操作列「编辑」：进入 / 退出该行行编辑态（可编辑文本字段常显编辑器）。 */
  function toggleRowEdit(task) {
    if (!rowEditable(task)) {
      showHint('当前身份「' + state.identity + '」对第 ' + task.id + ' 行只读（仅“负责人 == 自己”的行可编辑）。');
      return { ok: false, readOnly: true };
    }
    if (state.editingRows[task.id]) {
      delete state.editingRows[task.id];
      showHint('第 ' + task.id + ' 行已退出行编辑态（改动仍在草稿中，点击“保存”提交）。');
    } else {
      state.editingRows[task.id] = true;
      showHint('第 ' + task.id + ' 行已进入行编辑态：可直接修改各列，改完点击“保存”提交。');
    }
    render();
    return { ok: true, editing: !!state.editingRows[task.id] };
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
    var payload = documentPayload();
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

  /* -------------------------------------------------- CH-8 进展说明面板 */

  function findTask(id) {
    var found = null;
    (state.doc.tasks || []).forEach(function (task) { if (task.id === id) found = task; });
    return found;
  }

  /* 提交给服务端的整套文档（沿用既有契约：meta.name / identities / tasks，不新增字段）。 */
  function documentPayload() {
    return {
      meta: { name: state.doc.meta.name },
      identities: state.doc.identities.slice(),
      tasks: state.doc.tasks.map(function (task) {
        var clean = {};
        Object.keys(task).forEach(function (key) { if (key !== '__dirty') clean[key] = task[key]; });
        return clean;
      })
    };
  }

  function isNarrowViewport() {
    return typeof global.matchMedia === 'function' && global.matchMedia(NOTE_NARROW_QUERY).matches;
  }

  function noteMessage(text, isError, isOk) {
    var el = $('note-msg');
    el.textContent = text || '';
    el.hidden = !text;
    el.className = 'note-msg' + (isError ? ' error' : (isOk ? ' ok' : ''));
  }

  function noteCountText(value) {
    var length = String(value == null ? '' : value).length;
    return length + ' / ' + MAX_LEN.note + ' 字符' + (length > MAX_LEN.note ? '（超长，无法提交）' : '');
  }

  /* 预览：自研 Markdown 子集渲染，全部文本走 createTextNode（无 innerHTML）。 */
  function renderNotePreview() {
    var host = $('note-preview');
    var value = $('note-input').value;
    host.textContent = '';
    if (String(value).trim() === '') {
      var empty = document.createElement('p');
      empty.className = 'note-preview-empty';
      empty.textContent = '（暂无进展说明）';
      host.appendChild(empty);
      return host;
    }
    host.appendChild(Core.renderNoteMarkdown(value, document));
    return host;
  }

  /* 桌面：左「编辑」右「预览」双栏；窄视口：全屏 + 「编辑 / 预览」标签切换。 */
  function syncNotePanelLayout() {
    var panel = state.notePanel;
    var narrow = isNarrowViewport();
    var readonly = !!panel.readonly;
    var tab = readonly ? 'preview' : (panel.tab || 'edit');
    var dialog = $('note-dialog');
    dialog.setAttribute('data-narrow', narrow ? 'true' : 'false');
    dialog.setAttribute('data-tab', tab);
    $('note-tabs').hidden = !narrow || readonly;
    $('note-edit-pane').hidden = readonly || (narrow && tab === 'preview');
    $('note-preview-pane').hidden = narrow && tab === 'edit' && !readonly;
    $('note-tab-edit').className = 'note-tab' + (tab === 'edit' ? ' active' : '');
    $('note-tab-preview').className = 'note-tab' + (tab === 'preview' ? ' active' : '');
    return { narrow: narrow, tab: tab, readonly: readonly };
  }

  function setNoteTab(tab) {
    state.notePanel.tab = tab === 'preview' ? 'preview' : 'edit';
    return syncNotePanelLayout();
  }

  function syncNoteDirty() {
    var panel = state.notePanel;
    var input = $('note-input');
    input.classList.toggle('over-limit', input.value.length > MAX_LEN.note);
    $('note-count').textContent = noteCountText(input.value);
    if (!panel.open || panel.readonly) return false;
    panel.dirty = input.value !== panel.original;
    $('note-dialog').classList.toggle('note-dirty', panel.dirty);
    return panel.dirty;
  }

  function openNotePanel(id) {
    var task = findTask(id);
    if (!task) { showHint('未找到任务 ' + id + '，无法打开进展说明。'); return { ok: false, error: 'missing' }; }
    var editable = canEditField(state.identity, task, 'note');
    var note = readField(task, 'note');
    state.notePanel = {
      open: true, taskId: task.id, original: note, readonly: !editable, dirty: false,
      tab: editable ? 'edit' : 'preview'
    };
    var input = $('note-input');
    input.value = note;
    var dialog = $('note-dialog');
    dialog.classList.toggle('readonly', !editable);
    dialog.setAttribute('data-task', task.id);
    $('note-title').textContent = '进展说明 · ' + task.id + (task.task ? ' ' + task.task : '');
    $('note-meta').textContent = editable
      ? '可编辑（当前身份：' + state.identity + '）'
      : '只读预览（当前身份「' + state.identity + '」对第 ' + task.id + ' 行无编辑权限）';
    $('note-save').hidden = !editable;
    $('note-cancel').textContent = editable ? '取消' : '关闭';
    noteMessage('', false);
    $('note-confirm').hidden = true;
    $('note-panel').hidden = false;
    renderNotePreview();
    syncNoteDirty();
    syncNotePanelLayout();
    if (editable) { try { input.focus(); } catch (err) { /* 忽略 */ } }
    showHint(editable
      ? '已打开第 ' + task.id + ' 行的进展说明编辑器（Markdown 子集，仅点“保存”才提交）。'
      : '第 ' + task.id + ' 行对当前身份只读，以预览方式展示进展说明。');
    return { ok: true, taskId: task.id, readonly: !editable };
  }

  function closeNotePanel() {
    var wasOpen = state.notePanel.open;
    $('note-confirm').hidden = true;
    $('note-panel').hidden = true;
    $('note-dialog').classList.remove('note-dirty', 'readonly');
    state.notePanel = { open: false, taskId: null, original: '', readonly: false, dirty: false, tab: 'edit' };
    if (wasOpen) showHint('已关闭进展说明面板（未保存的编辑内容已丢弃）。');
    return { ok: true };
  }

  /* 关闭请求：有未保存内容 → 先给「取消 / 继续退出」确认；否则直接关闭。 */
  function requestCloseNotePanel() {
    var panel = state.notePanel;
    if (!panel.open) return { ok: true, closed: true };
    if (panel.readonly) { closeNotePanel(); return { ok: true, closed: true, readonly: true }; }
    if (syncNoteDirty()) {
      $('note-confirm').hidden = false;
      showHint('进展说明有未保存的修改，请在确认框中选择「取消」或「继续退出」。');
      return { ok: false, confirm: true };
    }
    closeNotePanel();
    return { ok: true, closed: true };
  }

  function cancelNoteConfirm() {
    $('note-confirm').hidden = true;
    showHint('已取消关闭，编辑内容仍保留在面板中（点“保存”才会提交）。');
    return { ok: true, kept: true };
  }

  function confirmExitNotePanel() {
    $('note-confirm').hidden = true;
    closeNotePanel();
    return { ok: true, closed: true, discarded: true };
  }

  /* 仅「保存」把进展说明写回服务端；沿用既有 PUT /api/wbs（If-Match + 原子写 + 409 语义）。 */
  async function saveNote() {
    var panel = state.notePanel;
    if (!panel.open) return { ok: false, error: 'closed' };
    if (panel.readonly) {
      var readonlyMsg = '当前身份「' + state.identity + '」对该行只读，无法提交进展说明。';
      noteMessage(readonlyMsg, true);
      showBanner('warn', readonlyMsg);
      return { ok: false, error: 'readonly' };
    }
    var task = findTask(panel.taskId);
    if (!task) return { ok: false, error: 'missing' };
    var value = $('note-input').value;
    if (value.length > MAX_LEN.note) {
      var tooLong = '进展说明长度超过 ' + MAX_LEN.note + ' 个字符（当前 ' + value.length + ' 个），未提交。';
      noteMessage(tooLong, true);
      showBanner('error', tooLong);
      return { ok: false, error: 'too_long', length: value.length };
    }
    if (value === panel.original) {
      noteMessage('进展说明没有改动，未提交。', true);
      return { ok: false, error: 'unchanged' };
    }

    writeField(task, 'note', value);
    task.__dirty = true;
    state.dirty = true;
    state.errorCells = {};
    var response;
    try {
      response = await fetch('/api/wbs', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(state.revision),
          'X-Identity': encodeURIComponent(String(state.identity))
        },
        body: JSON.stringify(documentPayload())
      });
    } catch (err) {
      noteMessage('保存失败：无法连接服务（' + err.message + '）', true);
      showBanner('error', '保存失败：无法连接服务（' + err.message + '）');
      return { ok: false, error: 'network' };
    }
    if (response.status === 200) {
      var result = await response.json();
      state.revision = result.revision;
      state.doc.meta.revision = result.revision;
      state.doc.tasks.forEach(function (item) { delete item.__dirty; });
      state.dirty = false;
      state.errorCells = {};
      panel.original = value;
      panel.dirty = false;
      render();
      var success = '第 ' + task.id + ' 行进展说明已保存，服务器版本号已更新为 ' + result.revision + '。';
      noteMessage(success + '（页面、API、磁盘三端一致）', false, true);
      showBanner('ok', '保存成功：' + success);
      return { ok: true, revision: result.revision, note: value };
    }
    if (response.status === 409) {
      var conflict = await response.json().catch(function () { return null; });
      var current = conflict && conflict.current != null ? conflict.current : '未知';
      panel.dirty = true;
      showBanner('warn', '版本冲突：服务器当前版本为 ' + current + '，你的保存基于版本 ' + state.revision +
        '，已拒绝覆盖。请重新加载后再改。', true);
      noteMessage('版本冲突，未提交（服务器版本 ' + current + '）；请先关闭面板，再点横幅「重新加载」后重做修改。', true);
      return { ok: false, conflict: true, current: current };
    }
    var body = await response.json().catch(function () { return null; });
    var detail = body && body.errors
      ? body.errors.slice(0, 3).map(function (error) { return '[' + error.id + '] ' + error.field + '：' + error.message; }).join('；')
      : 'HTTP ' + response.status;
    showBanner('error', '服务器拒绝了这次保存（HTTP ' + response.status + '）：' + detail);
    noteMessage('保存被服务器拒绝：' + detail, true);
    return { ok: false, errors: body && body.errors };
  }

  function exportFileName(date) {
    var now = date || new Date();
    var stamp = String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    return '蓉城战役WBS-' + stamp + '.xlsx';
  }

  /* -------------------------------------------------- 日报文本弹层（CH-13） */

  async function fetchHistory(dateStr) {
    var url = '/api/history?tz=' + encodeURIComponent(HISTORY_TZ) + '&date=' + encodeURIComponent(dateStr);
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('变更历史读取失败 HTTP ' + response.status);
    return response.json();
  }

  /* CH-13：日报数据源仍为 /api/daily（服务端汇总逻辑保留），取其中的 text 作为弹层文本。 */
  async function fetchDaily(dateStr) {
    var url = '/api/daily?tz=' + encodeURIComponent(HISTORY_TZ) + '&date=' + encodeURIComponent(dateStr);
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('日报数据读取失败 HTTP ' + response.status);
    return response.json();
  }

  /* CH-13：点「导出日报」不再生成/下载 xlsx，改为打开只读文本弹层（内容 = /api/daily 的关键信息文本）。
     弹层内没有任何下载行为（无 blob、无 a[download]、无 xlsx 组装调用）。 */
  async function exportDailyReport() {
    var dateStr = todayInTz(HISTORY_TZ);
    try {
      var daily = await fetchDaily(dateStr);
      if (!daily || !daily.text || typeof daily.text.body !== 'string' || daily.text.body === '') {
        throw new Error('服务端未返回日报文本');
      }
      var text = daily.text.body;
      openDailyPanel(text);
      return { ok: true, date: dateStr, text: text, daily: daily };
    } catch (err) {
      showBanner('error', '日报打开失败：' + err.message);
      return { ok: false, error: err.message };
    }
  }

  /* 打开弹层：展示文本与复制到剪贴板的文本是同一份字符串（state.dailyText 与 DOM 同步写入）。 */
  function openDailyPanel(text) {
    var body = text == null ? '' : String(text);
    state.dailyText = body;
    var block = $('daily-text');
    block.textContent = body;
    showDailyMsg('');
    $('daily-panel').hidden = false;
    state.dailyPanel.open = true;
    try { $('daily-copy').focus(); } catch (e) { /* 忽略 */ }
    return { ok: true, text: body };
  }

  /* 关闭弹层：只读展示、不涉及未保存内容，不影响工作台既有未保存编辑状态。 */
  function closeDailyPanel() {
    if (!$('daily-panel').hidden) $('daily-panel').hidden = true;
    state.dailyPanel.open = false;
    showDailyMsg('');
    return { ok: true };
  }

  function showDailyMsg(text) {
    var node = $('daily-msg');
    node.textContent = text;
    node.className = 'daily-msg' + (text === DAILY_COPY_OK || text === '' ? '' : ' error');
    node.hidden = !text;
  }

  /* 复制：优先 navigator.clipboard.writeText，失败时「选择 + document.execCommand('copy')」兜底。 */
  async function copyDailyText() {
    var text = $('daily-text').textContent == null ? '' : String($('daily-text').textContent);
    var copied = false;
    var clipboard = global.navigator && global.navigator.clipboard;
    if (text !== '' && clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(text);
        copied = true;
      } catch (err) {
        copied = false;
      }
    }
    if (!copied) copied = legacyCopyText(text);
    showDailyMsg(copied ? DAILY_COPY_OK : DAILY_COPY_FAIL);
    return { ok: copied, text: text, message: copied ? DAILY_COPY_OK : DAILY_COPY_FAIL };
  }

  /* 兜底：临时只读 textarea 全选 + execCommand('copy')；不影响弹层展示内容与选区。 */
  function legacyCopyText(text) {
    var body = text == null ? '' : String(text);
    if (body === '') return false;
    var area = null;
    try {
      area = document.createElement('textarea');
      area.value = body;
      area.setAttribute('readonly', 'readonly');
      area.setAttribute('aria-hidden', 'true');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.left = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, body.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      return !!ok;
    } catch (err) {
      return false;
    } finally {
      if (area && area.parentNode) area.parentNode.removeChild(area);
    }
  }

  /* ------------------------------------------------------------ 新增人员 */

  function openAddPersonPanel() {
    if (!canAddIdentity()) { showHint('仅「项目负责人」可以新增人员。'); return { ok: false }; }
    $('new-person-msg').hidden = true;
    $('new-person-name').value = '';
    $('add-person-panel').hidden = false;
    try { $('new-person-name').focus(); } catch (e) { /* 忽略 */ }
    return { ok: true };
  }

  function closeAddPersonPanel() { $('add-person-panel').hidden = true; }

  /* 校验：非空、去重、长度 1–20；返回错误文案或 null。 */
  function identityInputError(rawName, identities) {
    var name = String(rawName == null ? '' : rawName).trim();
    if (name === '') return '姓名不能为空。';
    if (name.length > IDENTITY_MAX_LEN) return '姓名长度需为 1–' + IDENTITY_MAX_LEN + ' 个字符（当前 ' + name.length + ' 个）。';
    if ((identities || []).indexOf(name) !== -1) return '「' + name + '」已在人员池中，请勿重复添加。';
    return null;
  }

  /* 人员池落盘：复用既有 PUT /api/wbs（原子写 + If-Match 版本保护），不携带未保存的任务草稿。 */
  async function persistIdentities() {
    for (var attempt = 0; attempt < 3; attempt += 1) {
      var current;
      try {
        current = await fetch('/api/wbs', { cache: 'no-store' });
      } catch (err) {
        return { ok: false, message: '无法连接服务（' + err.message + '）' };
      }
      if (!current.ok) return { ok: false, message: 'HTTP ' + current.status };
      var doc = await current.json();
      var payload = {
        meta: { name: doc.meta && doc.meta.name },
        identities: state.doc.identities.slice(),
        tasks: doc.tasks
      };
      var put;
      try {
        put = await fetch('/api/wbs', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(doc.meta.revision),
            'X-Identity': encodeURIComponent(String(state.identity || rememberedIdentity() || ''))
          },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        return { ok: false, message: '无法连接服务（' + err.message + '）' };
      }
      if (put.status === 200) {
        var result = await put.json();
        state.revision = result.revision;
        if (state.doc && state.doc.meta) state.doc.meta.revision = result.revision;
        updateSession();
        return { ok: true, revision: result.revision };
      }
      if (put.status !== 409) {
        var body = await put.json().catch(function () { return null; });
        var detail = body && body.errors && body.errors.length ? body.errors[0].message : 'HTTP ' + put.status;
        return { ok: false, message: detail };
      }
    }
    return { ok: false, message: '版本冲突重试 3 次仍失败，请重新加载后再试' };
  }

  async function confirmAddPerson() {
    var message = $('new-person-msg');
    message.hidden = true;
    var fail = function (text) {
      message.textContent = text;
      message.hidden = false;
      showHint('新增人员未通过：' + text);
      return { ok: false, error: text };
    };
    if (!canAddIdentity()) return fail('仅「项目负责人」可以新增人员。');
    var name = String($('new-person-name').value == null ? '' : $('new-person-name').value).trim();
    var invalid = identityInputError(name, state.doc.identities);
    if (invalid) return fail(invalid);

    state.doc.identities.push(name);
    state.editingRows = {};
    renderIdentityLayer();
    render();
    closeAddPersonPanel();
    var saved = await persistIdentities();
    if (saved.ok) {
      showBanner('ok', '已新增人员「' + name + '」，人员池已保存到服务器（版本 ' + saved.revision + '）；身份切换、负责人下拉、筛选下拉已同步。');
    } else {
      showBanner('warn', '已在本页加入「' + name + '」，但保存到服务器失败：' + saved.message + '。');
    }
    showHint('人员池现有 ' + state.doc.identities.length + ' 人：' + state.doc.identities.join(' / '));
    return { ok: saved.ok, name: name, revision: saved.revision, message: saved.message };
  }

  /* 返回首页：保留当前身份，回到身份选择页（列表随人员池同步）。 */
  function backHome() {
    hideBanner();
    state.editingRows = {};
    closeAddPersonPanel();
    $('identity-error').hidden = true;
    if (state.doc) renderIdentityLayer();
    $('workbench').hidden = true;
    $('identity-layer').hidden = false;
    return { ok: true, identities: state.doc ? state.doc.identities.slice() : [] };
  }

  async function loadExportWorkbook() {
    var response = await fetch('template.xlsx', { cache: 'no-store' });
    if (!response.ok) throw new Error('模板读取失败 HTTP ' + response.status);
    var buffer = await response.arrayBuffer();
    return Core.buildExportWorkbook(new Uint8Array(buffer), state.doc.tasks);
  }

  var EXPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /* 导出下载：优先交给测试接缝（自测脚本用于取回字节），否则用 Blob + <a download> 本地下载。
     全程不发任何外部请求。 */
  function downloadExport(bytes, name) {
    if (typeof global.WBS_DOWNLOAD_HOOK === 'function') { global.WBS_DOWNLOAD_HOOK(bytes, name); return; }
    var blob = new Blob([bytes], { type: EXPORT_MIME });
    var url = global.URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 0);
  }

  async function exportXlsx() {
    try {
      var response = await fetch('template.xlsx', { cache: 'no-store' });
      if (!response.ok) throw new Error('模板读取失败 HTTP ' + response.status);
      var buffer = new Uint8Array(await response.arrayBuffer());
      var bytes = Core.exportBytes(buffer, state.doc.tasks);
      var name = exportFileName();
      state.lastExport = { name: name, bytes: bytes };
      downloadExport(bytes, name);
      showBanner('ok', '已按原模板导出 ' + state.doc.tasks.length + ' 行 A–K 数据 + K 后 5 个阶段进度列（含颜色），文件名 ' + name +
        '（第 1/2 行与合并单元格保持原样；demo 原值保留，旧 status 不导出）。');
      return { ok: true, name: name, bytes: bytes };
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
    $('save-btn').addEventListener('click', function () { save(); });
    $('add-row-btn').addEventListener('click', function () { addRow(); });
    $('export-btn').addEventListener('click', function () { exportXlsx(); });
    $('daily-btn').addEventListener('click', function () { exportDailyReport(); });
    /* CH-13 日报文本弹层：复制 / 关闭 / Esc。 */
    $('daily-copy').addEventListener('click', function () { copyDailyText(); });
    $('daily-close').addEventListener('click', function () { closeDailyPanel(); });
    $('add-person-btn').addEventListener('click', function () { openAddPersonPanel(); });
    $('identity-add-btn').addEventListener('click', function () { openAddPersonPanel(); });
    $('new-person-confirm').addEventListener('click', function () { confirmAddPerson(); });
    $('new-person-cancel').addEventListener('click', function () { closeAddPersonPanel(); });
    $('new-person-name').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); confirmAddPerson(); }
      if (event.key === 'Escape') { event.preventDefault(); closeAddPersonPanel(); }
    });
    $('home-btn').addEventListener('click', function () { backHome(); });
    $('banner-action').addEventListener('click', function () { reload(); });

    /* CH-8 进展说明面板：关闭 / 保存 / 移动端标签 / 未保存确认 / Ctrl·Cmd+Enter / Esc。 */
    $('note-close').addEventListener('click', function () { requestCloseNotePanel(); });
    $('note-cancel').addEventListener('click', function () { requestCloseNotePanel(); });
    $('note-save').addEventListener('click', function () { saveNote(); });
    $('note-tab-edit').addEventListener('click', function () { setNoteTab('edit'); });
    $('note-tab-preview').addEventListener('click', function () { setNoteTab('preview'); });
    $('note-confirm-cancel').addEventListener('click', function () { cancelNoteConfirm(); });
    $('note-confirm-exit').addEventListener('click', function () { confirmExitNotePanel(); });
    $('note-input').addEventListener('input', function () { renderNotePreview(); syncNoteDirty(); });
    $('note-input').addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); saveNote(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestCloseNotePanel(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      /* CH-13：日报弹层在最上层，Esc 先关它（只读展示，无需确认）。 */
      if (!$('daily-panel').hidden) { event.preventDefault(); closeDailyPanel(); return; }
      if (!$('note-confirm').hidden) { event.preventDefault(); cancelNoteConfirm(); return; }
      if (!state.notePanel.open) return;
      event.preventDefault();
      requestCloseNotePanel();
    });
    global.addEventListener('resize', function () { if (state.notePanel.open) syncNotePanelLayout(); });
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
    toggleRowEdit: toggleRowEdit,
    rowEditable: rowEditable,
    save: save,
    reload: reload,
    exportXlsx: exportXlsx,
    exportDailyReport: exportDailyReport,
    openDailyPanel: openDailyPanel,
    closeDailyPanel: closeDailyPanel,
    copyDailyText: copyDailyText,
    legacyCopyText: legacyCopyText,
    fetchHistory: fetchHistory,
    fetchDaily: fetchDaily,
    openAddPersonPanel: openAddPersonPanel,
    closeAddPersonPanel: closeAddPersonPanel,
    confirmAddPerson: confirmAddPerson,
    identityInputError: identityInputError,
    persistIdentities: persistIdentities,
    canAddIdentity: canAddIdentity,
    backHome: backHome,
    loadExportWorkbook: loadExportWorkbook,
    downloadExport: downloadExport,
    exportFileName: exportFileName,
    checkHealth: checkHealth,
    openNotePanel: openNotePanel,
    closeNotePanel: closeNotePanel,
    requestCloseNotePanel: requestCloseNotePanel,
    cancelNoteConfirm: cancelNoteConfirm,
    confirmExitNotePanel: confirmExitNotePanel,
    saveNote: saveNote,
    setNoteTab: setNoteTab,
    renderNotePreview: renderNotePreview,
    syncNoteDirty: syncNoteDirty,
    syncNotePanelLayout: syncNotePanelLayout,
    isNarrowViewport: isNarrowViewport,
    findTask: findTask,
    documentPayload: documentPayload
  };

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
