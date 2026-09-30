/* ==========================================================================
 * 个人生活平台 v1 — app.js
 * 月历视图 + 当日记录面板（只读展示）
 *
 * 约定（见 docs/requirements.md / docs/data-schema.md）：
 *  - 数据源：./data/entries.json（相对路径，兼容 GitHub Pages 子路径 /<repo>/）
 *  - 零依赖、零构建、零网络请求（除同源数据文件本身）、零内联数据副本
 *  - v1 严格只读：无任何写入 UI、无任何写请求
 *  - 日期一律按「字符串」或本地构造 new Date(y, m-1, d) 处理，
 *    严禁 new Date("YYYY-MM-DD")（UTC 解析差异）
 *  - 任何数据问题都不得导致白屏或未捕获异常（验收 A14）
 * ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------ 常量 ---- */

  var DATA_URL = './data/entries.json';
  var DRAFT_MONTH_KEY = 'life-platform:last-view-month:v1'; // 可选记忆，失败静默降级
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MAX_TITLE = 120;
  var MAX_NOTE = 5000;
  var MAX_TAGS = 12;
  var MAX_TAG_LEN = 20;

  /* -------------------------------------------------------- DOM 引用 ---- */

  var calendarEl = document.getElementById('calendar');
  var calendarBody = document.getElementById('calendar-body');
  var calendarCaption = document.getElementById('calendar-caption');
  var monthLabel = document.getElementById('month-label');
  var prevBtn = document.getElementById('prev-month');
  var nextBtn = document.getElementById('next-month');
  var todayBtn = document.getElementById('today-btn');
  var failureSlot = document.getElementById('failure-slot');
  var panelEl = document.getElementById('day-panel');
  var panelHeading = document.getElementById('day-panel-heading');
  var panelDate = document.getElementById('day-panel-date');
  var panelBody = document.getElementById('day-panel-body');
  var footerStats = document.getElementById('footer-stats');

  /* --------------------------------------------------------- 运行状态 ---- */

  /** 当前展示的月份：{ y: number, m: number(1-12) } */
  var view = null;
  /** 当前选中日：'YYYY-MM-DD' 或 null */
  var selectedDate = null;
  /** Map<'YYYY-MM-DD', entry[]> —— 展示顺序即数组原顺序 */
  var entriesByDate = new Map();
  /** 有效条目总数 */
  var entryCount = 0;
  /** 顶层 updatedAt，用于页脚 */
  var updatedAt = null;
  /** 数据加载状态 */
  var dataState = 'loading'; // loading | ok | failed
  /** 数据错误描述（null 表示无错误） */
  var dataError = null;
  /** 是否有条目因脏数据被跳过 */
  var skippedCount = 0;

  /* -------------------------------------------------------- 日期工具 ---- */

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toKey(y, m, d) {
    return String(y) + '-' + pad2(m) + '-' + pad2(d);
  }

  function todayKey() {
    var now = new Date();
    return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  /**
   * 解析 YYYY-MM-DD。
   * @returns {{y:number,m:number,d:number}|null} 非法或非真实公历日返回 null
   */
  function parseDate(value) {
    if (typeof value !== 'string') return null;
    var m = DATE_RE.exec(value);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > 31) return null;
    // 用本地构造回读，排除 2 月 30 日等不存在的日期
    var probe = new Date(y, mo - 1, d);
    if (
      probe.getFullYear() !== y ||
      probe.getMonth() !== mo - 1 ||
      probe.getDate() !== d
    ) {
      return null;
    }
    return { y: y, m: mo, d: d };
  }

  /** 某年某月的天数（真实公历，含闰年） */
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  /** 单元格索引（0=周日 … 6=周六）→ 展示列索引（0=周一 … 6=周日） */
  function toMondayFirstColumn(weekday) {
    return (weekday + 6) % 7;
  }

  /** 展示列索引（0=周一 … 6=周日） */
  function columnOf(y, m, d) {
    return toMondayFirstColumn(new Date(y, m - 1, d).getDay());
  }

  function shiftMonth(y, m, delta) {
    var total = y * 12 + (m - 1) + delta;
    return { y: Math.floor(total / 12), m: (total % 12) + 1 };
  }

  function formatMonthLabel(y, m) {
    return y + ' 年 ' + m + ' 月';
  }

  function formatHumanDate(key) {
    var p = parseDate(key);
    if (!p) return key;
    return p.y + ' 年 ' + p.m + ' 月 ' + p.d + ' 日';
  }

  function weekdayName(key) {
    var p = parseDate(key);
    if (!p) return '';
    return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][
      new Date(p.y, p.m - 1, p.d).getDay()
    ];
  }

  /* ------------------------------------------------ localStorage 记忆 ---- */
  /* v1 唯一允许用途：记住上次浏览月份；任何失败都静默降级。 */

  function rememberMonth(y, m) {
    try {
      window.localStorage.setItem(DRAFT_MONTH_KEY, y + '-' + pad2(m));
    } catch (err) {
      /* 隐私模式 / 禁用 storage：静默降级，不影响功能 */
    }
  }

  function readRememberedMonth() {
    try {
      var raw = window.localStorage.getItem(DRAFT_MONTH_KEY);
      var m = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null;
      if (!m) return null;
      var y = Number(m[1]);
      var mo = Number(m[2]);
      if (mo < 1 || mo > 12) return null;
      return { y: y, m: mo };
    } catch (err) {
      return null;
    }
  }

  /* -------------------------------------------------------- 数据加载 ---- */

  function setFailure(messageHtml) {
    failureSlot.innerHTML = '';
    if (!messageHtml) return;
    var box = document.createElement('div');
    box.className = 'notice notice-error';
    box.setAttribute('role', 'alert');
    box.innerHTML = messageHtml;
    failureSlot.appendChild(box);
  }

  function localFileHint() {
    if (window.location.protocol !== 'file:') return '';
    return (
      '<p><strong>你正在用 file:// 直接打开本页。</strong>' +
      '浏览器普遍禁止 file:// 下的 fetch 读取本地文件，因此数据无法自动加载。' +
      '请改用本地 HTTP 服务打开，例如在仓库根目录执行 ' +
      '<code>python -m http.server 8080</code>，然后访问 ' +
      '<code>http://localhost:8080/</code>；或按 README 说明操作。</p>'
    );
  }

  /**
   * 校验并归一化单个条目。
   * @returns {{date:string,title:string,note:string,tags:string[]}|null}
   */
  function normalizeEntry(raw, index) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[life-platform] 已跳过第 ' + index + ' 条记录：不是对象。');
      skippedCount++;
      return null;
    }

    var parsed = parseDate(raw.date);
    if (!parsed) {
      console.warn(
        '[life-platform] 已跳过第 ' + index + ' 条记录：date 非法（需为真实存在的 YYYY-MM-DD），实际值 = ' +
        JSON.stringify(raw.date)
      );
      skippedCount++;
      return null;
    }

    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      console.warn(
        '[life-platform] 已跳过第 ' + index + ' 条记录：title 缺失、非字符串或为空，实际值 = ' +
        JSON.stringify(raw.title)
      );
      skippedCount++;
      return null;
    }

    var note = typeof raw.note === 'string' ? raw.note : '';

    var tags = [];
    if (Array.isArray(raw.tags)) {
      for (var i = 0; i < raw.tags.length && tags.length < MAX_TAGS; i++) {
        var t = raw.tags[i];
        if (typeof t !== 'string') continue;
        t = t.trim();
        if (!t) continue;
        if (t.length > MAX_TAG_LEN) continue;
        if (/#/.test(t) || /\s/.test(t)) continue;
        if (tags.indexOf(t) !== -1) continue;
        tags.push(t);
      }
    }

    return {
      date: String(raw.date),
      title: raw.title.trim().slice(0, MAX_TITLE),
      note: note.slice(0, MAX_NOTE),
      tags: tags
    };
  }

  /**
   * 解析文本 → 归一化结果。
   * @returns {{ok:true, entries:Array, updatedAt:string|null, warn:string|null}
   *          |{ok:false, kind:'parse'|'shape', reason:string}}
   */
  function parsePayload(text) {
    var payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        kind: 'parse',
        reason: err && err.message ? err.message : String(err)
      };
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, kind: 'shape', reason: '顶层不是 JSON 对象' };
    }

    var rawEntries = payload.entries;
    var warn = null;

    if (!Array.isArray(rawEntries)) {
      // docs/data-schema.md §4.3：缺失或非数组 → 视作 0 条 + 提示
      warn = '数据格式不符合预期：顶层 entries 字段缺失或不是数组。';
      rawEntries = [];
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, 'schemaVersion') &&
      !Number.isInteger(payload.schemaVersion)
    ) {
      console.warn(
        '[life-platform] schemaVersion 不是整数（' +
        JSON.stringify(payload.schemaVersion) +
        '），仍按 v1 解析。'
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'schemaVersion')) {
      console.warn('[life-platform] 缺少 schemaVersion，仍按 v1 解析。');
    }

    var list = [];
    for (var i = 0; i < rawEntries.length; i++) {
      var item = normalizeEntry(rawEntries[i], i);
      if (item) list.push(item);
    }

    if (list.length === 0 && rawEntries.length > 0) {
      console.warn(
        '[life-platform] entries 中共 ' + rawEntries.length + ' 条记录，全部被跳过，请检查数据格式。'
      );
    }

    return {
      ok: true,
      entries: list,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      warn: warn
    };
  }

  function applyEntries(list) {
    entriesByDate = new Map();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var bucket = entriesByDate.get(e.date);
      if (bucket) bucket.push(e);
      else entriesByDate.set(e.date, [e]);
    }
    entryCount = list.length;
  }

  function loadData() {
    var hasFetch = typeof window.fetch === 'function';
    if (!hasFetch) {
      dataState = 'failed';
      dataError = '当前浏览器不支持 fetch，无法加载数据文件。';
      return Promise.resolve();
    }

    return window
      .fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status + ' ' + res.statusText);
          err.isHttp = true;
          err.status = res.status;
          throw err;
        }
        return res.text();
      })
      .then(function (text) {
        var result = parsePayload(text);
        if (!result.ok) {
          dataState = 'failed';
          dataError =
            result.kind === 'parse'
              ? '数据文件格式错误：JSON 解析失败（' + result.reason + '）'
              : '数据格式不符合预期：' + result.reason;
          return;
        }
        applyEntries(result.entries);
        updatedAt = result.updatedAt;
        dataState = 'ok';
        dataError = result.warn;
      })
      .catch(function (err) {
        dataState = 'failed';
        if (err && err.isHttp) {
          dataError = '数据加载失败：请求 ' + DATA_URL + ' 返回 ' + err.message + '（文件不存在或路径错误）。';
        } else {
          dataError =
            '数据加载失败：无法读取 ' + DATA_URL + '。' +
            (err && err.message ? '（' + err.message + '）' : '');
        }
      });
  }

  /* -------------------------------------------------------- 日历渲染 ---- */

  function dayAriaLabel(key, hasEntry, isToday, isSelected, isOutside) {
    var text = formatHumanDate(key);
    var parts = [text];
    if (isOutside) {
      parts.push('非本月');
      return parts.join('，');
    }
    parts.push(hasEntry ? '有记录' : '无记录');
    if (isToday) parts.push('今天');
    if (isSelected) parts.push('已选中');
    return parts.join('，');
  }

  function buildDayCell(key, dayNum, hasEntry, isOutside) {
    var cell = document.createElement('td');
    cell.className = 'cell';

    var isToday = key === todayKey();
    var isSelected = key === selectedDate;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    if (hasEntry) btn.className += ' has-entry';
    if (isToday) btn.className += ' is-today';
    if (isSelected) btn.className += ' is-selected';
    if (isOutside) btn.className += ' is-outside';

    btn.dataset.date = key;
    btn.setAttribute(
      'aria-label',
      dayAriaLabel(key, hasEntry, isToday, isSelected, isOutside)
    );

    if (isOutside) {
      btn.disabled = true;
    } else {
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }

    var num = document.createElement('span');
    num.className = 'day-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = String(dayNum);
    btn.appendChild(num);

    if (hasEntry) {
      var dot = document.createElement('span');
      dot.className = 'day-dot';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);
    }

    if (isToday) {
      var badge = document.createElement('span');
      badge.className = 'day-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '今';
      btn.appendChild(badge);
    }

    cell.appendChild(btn);
    return cell;
  }

  function renderCalendar() {
    var y = view.y;
    var m = view.m;

    monthLabel.textContent = formatMonthLabel(y, m);
    calendarCaption.textContent = y + ' 年 ' + m + ' 月月历';
    calendarEl.setAttribute(
      'aria-label',
      y + ' 年 ' + m + ' 月月历。表头为日、一、二、三、四、五、六，以星期一为第一列。'
    );

    var firstColumn = columnOf(y, m, 1);
    var totalDays = daysInMonth(y, m);
    var prev = shiftMonth(y, m, -1);
    var next = shiftMonth(y, m, 1);
    var prevTotal = daysInMonth(prev.y, prev.m);
    var nextTotal = daysInMonth(next.y, next.m);

    var rowCount = Math.ceil((firstColumn + totalDays) / 7);
    var tbody = document.createDocumentFragment();
    var cellCount = 0;

    for (var r = 0; r < rowCount; r++) {
      var tr = document.createElement('tr');

      for (var c = 0; c < 7; c++) {
        var dayNum;
        var key;

        if (cellCount < firstColumn) {
          // 上月补位
          dayNum = prevTotal - (firstColumn - cellCount) + 1;
          key = toKey(prev.y, prev.m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, entriesByDate.has(key), true));
        } else if (cellCount < firstColumn + totalDays) {
          dayNum = cellCount - firstColumn + 1;
          key = toKey(y, m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, entriesByDate.has(key), false));
        } else {
          // 下月补位
          dayNum = cellCount - firstColumn - totalDays + 1;
          key = toKey(next.y, next.m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, entriesByDate.has(key), true));
        }

        cellCount++;
      }

      tbody.appendChild(tr);
    }

    calendarBody.innerHTML = '';
    calendarBody.appendChild(tbody);
  }

  /* ------------------------------------------------------ 记录面板 ---- */

  function buildEntryNode(entry) {
    var li = document.createElement('li');
    li.className = 'entry';

    var h3 = document.createElement('h3');
    h3.className = 'entry-title';
    h3.textContent = entry.title;
    li.appendChild(h3);

    if (entry.note) {
      var p = document.createElement('p');
      p.className = 'entry-note';
      p.textContent = entry.note;
      li.appendChild(p);
    }

    if (entry.tags.length) {
      var ul = document.createElement('ul');
      ul.className = 'entry-tags';
      for (var i = 0; i < entry.tags.length; i++) {
        var tagLi = document.createElement('li');
        tagLi.className = 'tag';
        tagLi.textContent = entry.tags[i];
        ul.appendChild(tagLi);
      }
      li.appendChild(ul);
    }

    return li;
  }

  function buildEmptyState(title, hint) {
    var box = document.createElement('div');
    box.className = 'empty-state';

    var t = document.createElement('span');
    t.className = 'empty-title';
    t.textContent = title;
    box.appendChild(t);

    if (hint) {
      var h = document.createElement('span');
      h.className = 'empty-hint';
      h.textContent = hint;
      box.appendChild(h);
    }

    return box;
  }

  function updateFooter() {
    var text;
    var isError = dataState === 'failed';

    if (dataState === 'loading') {
      text = '正在加载数据…';
    } else if (isError) {
      text = '数据异常：' + (dataError || '未知错误');
    } else {
      text = '共 ' + entryCount + ' 条记录';
      var months = new Set();
      entriesByDate.forEach(function (_v, k) {
        months.add(k.slice(0, 7));
      });
      text += ' · 覆盖 ' + months.size + ' 个月份';
      if (updatedAt && parseDate(updatedAt)) {
        text += ' · 数据最后更新：' + updatedAt;
      }
      if (dataError) {
        text += ' · ' + dataError;
      }
      if (skippedCount > 0) {
        text += ' · 已跳过 ' + skippedCount + ' 条无效记录';
      }
    }

    footerStats.textContent = text;
    document.querySelector('.site-footer').classList.toggle('is-error', isError);
  }

  function renderPanel() {
    panelBody.innerHTML = '';

    if (!selectedDate) {
      panelHeading.textContent = '记录';
      panelDate.textContent = '—';
      panelBody.appendChild(
        buildEmptyState('尚未选中日期', '在左侧月历中点击任意一天查看当日记录。')
      );
      return;
    }

    panelHeading.textContent = weekdayName(selectedDate) + '的记录';
    panelDate.textContent = selectedDate;

    if (dataState === 'failed') {
      panelBody.appendChild(
        buildEmptyState(
          '数据加载失败',
          (dataError || '无法读取数据文件。') + ' 月历仍可正常翻月。'
        )
      );
      return;
    }

    var list = entriesByDate.get(selectedDate) || [];

    if (!list.length) {
      panelBody.appendChild(
        buildEmptyState(
          '这一天还没有记录',
          '新增记录的方式：手工编辑 data/entries.json 后刷新页面，详见 README 或 docs/requirements.md 第 4 节。'
        )
      );
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'entries';
    for (var i = 0; i < list.length; i++) {
      ul.appendChild(buildEntryNode(list[i]));
    }
    panelBody.appendChild(ul);
  }

  /* ---------------------------------------------------------- 交互 ---- */

  function renderAll() {
    renderCalendar();
    renderPanel();
    updateFooter();
  }

  function selectDate(key) {
    var parsed = parseDate(key);
    if (!parsed) return;

    selectedDate = key;

    // 若选中的日期不在当前展示月，则自动翻到该月（仅在程序化选中时发生）
    if (parsed.y !== view.y || parsed.m !== view.m) {
      view = { y: parsed.y, m: parsed.m };
      rememberMonth(view.y, view.m);
    }

    renderAll();
  }

  function goToMonth(y, m, keepSelection) {
    view = { y: y, m: m };
    rememberMonth(y, m);

    if (!keepSelection) {
      // 保持选中日不变；仅当选中日不在展示月且用户未点击日格时保留原选中（面板继续显示该日）
      // 为符合「翻月不残留上一天内容」的要求，翻月时清空选中并提示
      selectedDate = null;
      renderAll();
      return;
    }
    renderAll();
  }

  function stepMonth(delta) {
    var target = shiftMonth(view.y, view.m, delta);
    goToMonth(target.y, target.m, false);
  }

  function goToday() {
    var key = todayKey();
    var p = parseDate(key);
    view = { y: p.y, m: p.m };
    rememberMonth(view.y, view.m);
    selectedDate = key;
    renderAll();
    try {
      panelEl.focus({ preventScroll: true });
    } catch (err) {
      /* 老浏览器不支持 options 参数，忽略 */
    }
  }

  function handleCalendarClick(event) {
    var btn = event.target.closest ? event.target.closest('.day') : null;
    if (!btn || !calendarBody.contains(btn)) return;
    if (btn.disabled) return;
    selectDate(btn.dataset.date);
  }

  function handleCalendarKeydown(event) {
    var btn = event.target.closest ? event.target.closest('.day') : null;
    if (!btn || btn.disabled) return;

    var key = event.key;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      selectDate(btn.dataset.date);
      return;
    }

    var p = parseDate(btn.dataset.date);
    if (!p) return;

    var deltaDays = 0;
    if (key === 'ArrowLeft') deltaDays = -1;
    else if (key === 'ArrowRight') deltaDays = 1;
    else if (key === 'ArrowUp') deltaDays = -7;
    else if (key === 'ArrowDown') deltaDays = 7;
    else return;

    event.preventDefault();
    var target = new Date(p.y, p.m - 1, p.d + deltaDays);
    var targetKey = toKey(target.getFullYear(), target.getMonth() + 1, target.getDate());

    if (
      target.getFullYear() !== view.y ||
      target.getMonth() + 1 !== view.m
    ) {
      view = { y: target.getFullYear(), m: target.getMonth() + 1 };
      rememberMonth(view.y, view.m);
      renderAll();
    }

    var nextBtn2 = calendarBody.querySelector('.day[data-date="' + targetKey + '"]');
    if (nextBtn2 && !nextBtn2.disabled) {
      nextBtn2.focus();
      selectDate(targetKey);
    }
  }

  function bindEvents() {
    prevBtn.addEventListener('click', function () { stepMonth(-1); });
    nextBtn.addEventListener('click', function () { stepMonth(1); });
    todayBtn.addEventListener('click', goToday);

    calendarEl.addEventListener('click', handleCalendarClick);
    calendarEl.addEventListener('keydown', handleCalendarKeydown);

    document.addEventListener('keydown', function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return; // 日格内已有导航
      if (event.key === 'PageUp') {
        event.preventDefault();
        stepMonth(-1);
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        stepMonth(1);
      }
    });
  }

  /* ---------------------------------------------------------- 启动 ---- */

  function initialState() {
    var today = parseDate(todayKey());
    var remembered = readRememberedMonth();

    // docs/requirements.md §3.3：默认展示今日所在月并选中今日；
    // 该规则优先级高于任何记忆状态（若今日的月份与记忆月份不同，以今日为准）。
    if (remembered && remembered.y === today.y && remembered.m === today.m) {
      view = { y: remembered.y, m: remembered.m };
    } else {
      view = { y: today.y, m: today.m };
    }
    selectedDate = todayKey();
  }

  function init() {
    if (!calendarBody || !panelBody || !footerStats) return;

    initialState();
    bindEvents();

    // 第一次渲染：即使数据未加载完成也先出日历骨架，绝不白屏
    renderAll();

    loadData().then(function () {
      renderAll();
      if (dataState === 'failed') {
        setFailure(
          '<p><strong>' + dataError + '</strong></p>' +
          '<p>月历仍可正常翻月；修复数据文件后刷新页面即可恢复。</p>' +
          localFileHint()
        );
      } else if (dataError) {
        setFailure('<p>' + dataError + '</p>');
      } else if (skippedCount > 0) {
        setFailure(
          '<p>数据已加载，但有 ' + skippedCount +
          ' 条记录因格式不合法被跳过（详见浏览器控制台）。</p>'
        );
      } else {
        setFailure('');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
