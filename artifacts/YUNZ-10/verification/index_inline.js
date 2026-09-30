
(function () {
  'use strict';

  var state = { items: [], summary: [], editingId: null };

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var messageTimer = null;
  function showMessage(text, kind) {
    var box = byId('message');
    box.textContent = text;
    box.className = 'message ' + (kind || 'info');
    box.hidden = false;
    if (messageTimer) { window.clearTimeout(messageTimer); messageTimer = null; }
    if (kind !== 'error') {
      messageTimer = window.setTimeout(function () { box.hidden = true; }, 2600);
    }
  }

  function request(method, path, body) {
    var options = { method: method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (error) { data = null; } }
        if (!response.ok) {
          var reason = (data && data.error) ? data.error : ('HTTP ' + response.status);
          throw new Error(reason);
        }
        return data;
      });
    });
  }

  var api = {
    items: function () { return request('GET', '/api/items'); },
    summary: function () { return request('GET', '/api/summary'); },
    health: function () { return request('GET', '/api/health'); },
    create: function (item) { return request('POST', '/api/items', item); },
    update: function (id, changes) { return request('PUT', '/api/items/' + encodeURIComponent(id), changes); },
    remove: function (id) { return request('DELETE', '/api/items/' + encodeURIComponent(id)); }
  };

  function renderItems() {
    var body = byId('items-body');
    var datalist = byId('category-options');
    body.innerHTML = '';
    byId('item-count').textContent = state.items.length + ' 条';
    byId('items-empty').hidden = state.items.length > 0;

    var categories = {};
    state.items.forEach(function (item) { categories[item.category] = true; });
    datalist.innerHTML = Object.keys(categories).sort().map(function (name) {
      return '<option value="' + escapeHtml(name) + '"></option>';
    }).join('');

    state.items.forEach(function (item) {
      var row = document.createElement('tr');
      if (String(state.editingId) === String(item.id)) {
        row.innerHTML =
          '<td class="mono">' + escapeHtml(item.id) + '</td>' +
          '<td><input class="edit-input" data-field="name" maxlength="200" value="' + escapeHtml(item.name) + '"></td>' +
          '<td><input class="edit-input" data-field="category" maxlength="200" list="category-options" value="' + escapeHtml(item.category) + '"></td>' +
          '<td class="qty"><input class="edit-input" data-field="quantity" type="number" min="0" step="1" value="' + escapeHtml(item.quantity) + '"></td>' +
          '<td class="actions">' +
            '<button type="button" class="small" data-action="save" data-id="' + escapeHtml(item.id) + '">保存</button> ' +
            '<button type="button" class="ghost small" data-action="cancel">取消</button>' +
          '</td>';
      } else {
        row.innerHTML =
          '<td class="mono">' + escapeHtml(item.id) + '</td>' +
          '<td>' + escapeHtml(item.name) + '</td>' +
          '<td>' + escapeHtml(item.category) + '</td>' +
          '<td class="qty">' + escapeHtml(item.quantity) + '</td>' +
          '<td class="actions">' +
            '<button type="button" class="ghost small" data-action="edit" data-id="' + escapeHtml(item.id) + '">编辑</button> ' +
            '<button type="button" class="danger small" data-action="delete" data-id="' + escapeHtml(item.id) + '">删除</button>' +
          '</td>';
      }
      body.appendChild(row);
    });
  }

  function renderSummary() {
    var body = byId('summary-body');
    body.innerHTML = '';
    byId('summary-empty').hidden = state.summary.length > 0;
    state.summary.forEach(function (entry) {
      var row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(entry.category) + '</td>' +
        '<td class="qty">' + escapeHtml(entry.total_quantity) + '</td>';
      body.appendChild(row);
    });
  }

  function reload() {
    return Promise.all([api.items(), api.summary()]).then(function (results) {
      state.items = (results[0] && results[0].items) || [];
      state.summary = (results[1] && results[1].summary) || [];
      renderItems();
      renderSummary();
    });
  }

  function readQuantity(input) {
    var raw = String(input.value).trim();
    if (!/^\d+$/.test(raw)) { throw new Error('数量必须是非负整数'); }
    return parseInt(raw, 10);
  }

  byId('add-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var name = byId('add-name').value.trim();
    var category = byId('add-category').value.trim();
    var quantity;
    if (!name) { showMessage('名称不能为空', 'error'); return; }
    if (!category) { showMessage('类别不能为空', 'error'); return; }
    try { quantity = readQuantity(byId('add-quantity')); }
    catch (error) { showMessage(error.message, 'error'); return; }

    api.create({ name: name, category: category, quantity: quantity }).then(function (created) {
      byId('add-name').value = '';
      byId('add-quantity').value = '1';
      byId('add-name').focus();
      showMessage('已添加：' + created.name, 'ok');
      return reload();
    }).catch(function (error) {
      showMessage('添加失败：' + error.message, 'error');
    });
  });

  byId('items-body').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) { return; }
    var action = button.getAttribute('data-action');
    var id = button.getAttribute('data-id');

    if (action === 'edit') {
      state.editingId = id;
      renderItems();
      var first = byId('items-body').querySelector('input[data-field="name"]');
      if (first) { first.focus(); }
      return;
    }
    if (action === 'cancel') {
      state.editingId = null;
      renderItems();
      return;
    }
    if (action === 'save') {
      var row = button.closest('tr');
      var inputs = row.querySelectorAll('input[data-field]');
      var changes = {};
      try {
        changes.name = inputs[0].value.trim();
        changes.category = inputs[1].value.trim();
        changes.quantity = readQuantity(inputs[2]);
      } catch (error) {
        showMessage(error.message, 'error');
        return;
      }
      if (!changes.name) { showMessage('名称不能为空', 'error'); return; }
      if (!changes.category) { showMessage('类别不能为空', 'error'); return; }
      api.update(id, changes).then(function () {
        state.editingId = null;
        showMessage('已保存修改', 'ok');
        return reload();
      }).catch(function (error) {
        showMessage('保存失败：' + error.message, 'error');
      });
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('确定删除该物品？')) { return; }
      api.remove(id).then(function () {
        if (String(state.editingId) === String(id)) { state.editingId = null; }
        showMessage('已删除', 'ok');
        return reload();
      }).catch(function (error) {
        showMessage('删除失败：' + error.message, 'error');
      });
    }
  });

  byId('refresh').addEventListener('click', function () {
    reload().then(function () { showMessage('已刷新', 'ok'); })
      .catch(function (error) { showMessage('刷新失败：' + error.message, 'error'); });
  });

  api.health().then(function (data) {
    if (data && data.data_file) { byId('data-file').textContent = data.data_file; }
  }).catch(function () { byId('data-file').textContent = '（无法读取）'; });

  reload().catch(function (error) { showMessage('加载失败：' + error.message, 'error'); });
})();
