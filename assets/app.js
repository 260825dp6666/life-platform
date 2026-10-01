/* ==========================================================================
 * 个人生活平台 v1.1 — app.js
 * 板块路由 + 月历 + 当日内容（生活记录 / 理财复盘）+ 理财复盘板块
 *
 * 设计依据：docs/design-v1.1.md
 * 数据依据：docs/data-schema.md（entries）、docs/design-v1.1.md §6.2（finance）
 *
 * 约定（继承 v1，不得违反）：
 *  - 数据源：./data/entries.json 与 ./data/finance.json（相对路径，兼容 Pages 子路径）
 *  - 零依赖、零构建、零外链、零写入请求（前端严格只读）
 *  - 日期一律按字符串或本地构造 new Date(y, m-1, d) 处理，
 *    严禁 new Date("YYYY-MM-DD")（UTC 解析差异）
 *  - 任何数据问题都不得导致白屏或未捕获异常
 *  - 控制台不得出现 console.error（容错一律用 console.warn）
 * ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------ 常量 ---- */

  var DATA_URL = './data/entries.json';
  var FINANCE_URL = './data/finance.json';

  var VIEW_KEY_PREFIX = 'life-platform:last-view-';
  var VIEW_MEMORY_ENABLED = false; // 关闭：每次打开都落到首页，行为可预期

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MAX_TITLE = 120;
  var MAX_NOTE = 5000;
  var MAX_TAGS = 12;
  var MAX_TAG_LEN = 20;
  var MAX_ACTIONS = 20;
  var MAX_ACTION_LEN = 200;

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var DEFAULT_VIEW = 'home';
  var KNOWN_VIEWS = ['home', 'calendar', 'finance', 'habits', 'health', 'about'];

  /** 预留板块的文案（与 index.html 中的占位内容保持一致） */
  var RESERVED_META = {
    habits: {
      title: '习惯打卡',
      summary: '规划方向：连续打卡天数、完成率、周视图；数据计划 ./data/habits.json',
      hint: '路线图见 docs/requirements.md 第 7 节 v3。'
    },
    health: {
      title: '健康',
      summary: '规划方向：体重、睡眠、运动频次的每日记录与趋势；数据计划 ./data/health.json',
      hint: '图表在零依赖前提下用原生 SVG 绘制。'
    }
  };

  /* -------------------------------------------------------- DOM 引用 ---- */

  var bannerSlot = document.getElementById('banner-slot');

  var homeDateText = document.getElementById('home-date-text');
  var homeWeekday = document.getElementById('home-weekday');
  var homeSummary = document.getElementById('home-summary');
  var homeContent = document.getElementById('home-content');
  var homeContentCount = document.getElementById('home-content-count');
  var miniBody = document.getElementById('mini-calendar-body');
  var miniMonthLabel = document.getElementById('mini-month-label');
  var miniLegend = document.getElementById('mini-legend');
  var homeOpenCalendar = document.getElementById('home-open-calendar');

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
  var panelSummaryLine = document.getElementById('day-summary-line');
  var panelBody = document.getElementById('day-panel-body');

  var finSummary = document.getElementById('finance-summary');
  var finList = document.getElementById('finance-list');
  var finPrevBtn = document.getElementById('fin-prev-month');
  var finNextBtn = document.getElementById('fin-next-month');
  var finResetBtn = document.getElementById('fin-reset-month');
  var finMonthLabel = document.getElementById('fin-month-label');

  var footerStats = document.getElementById('footer-stats');
  var aboutVersion = document.getElementById('about-version');

  var navLinks = [].slice.call(document.querySelectorAll('.topnav-link'));

  /* --------------------------------------------------------- 运行状态 ---- */

  var currentView = null;

  /** 当前展示的月份：{ y, m } */
  var view = null;
  /** 当前选中日：'YYYY-MM-DD' 或 null */
  var selectedDate = null;

  /** 生活记录：Map<'YYYY-MM-DD', entry[]> */
  var entriesByDate = new Map();
  var entryCount = 0;
  var entriesUpdatedAt = null;
  var entriesState = 'loading'; // loading | ok | failed
  var entriesError = null;
  var skippedEntries = 0;
  var usingSampleEntries = false;

  /** 理财复盘：Map<'YYYY-MM-DD', review[]> */
  var reviewsByDate = new Map();
  var reviewCount = 0;
  var financeUpdatedAt = null;
  var financeState = 'loading';
  var financeError = null;
  var skippedReviews = 0;
  var usingSampleFinance = false;

  /** 理财板块当前浏览的月份：{ y, m } */
  var financeView = null;
  /** 最近一次复盘所在月份：{ y, m } | null */
  var financeLatest = null;

  /* -------------------------------------------------------- 日期工具 ---- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toKey(y, m, d) { return String(y) + '-' + pad2(m) + '-' + pad2(d); }

  function todayKey() {
    var now = new Date();
    return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function todayParts() {
    var now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
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
    var probe = new Date(y, mo - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
      return null;
    }
    return { y: y, m: mo, d: d };
  }

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  /** 单元格索引（0=周日 … 6=周六）→ 展示列索引（0=周一 … 6=周日） */
  function toMondayFirstColumn(weekday) { return (weekday + 6) % 7; }

  function columnOf(y, m, d) { return toMondayFirstColumn(new Date(y, m - 1, d).getDay()); }

  function shiftMonth(y, m, delta) {
    var total = y * 12 + (m - 1) + delta;
    return { y: Math.floor(total / 12), m: (total % 12) + 1 };
  }

  function formatMonthLabel(y, m) { return y + ' 年 ' + m + ' 月'; }

  function formatHumanDate(key) {
    var p = parseDate(key);
    if (!p) return key;
    return p.y + ' 年 ' + p.m + ' 月 ' + p.d + ' 日';
  }

  function weekdayName(key) {
    var p = parseDate(key);
    if (!p) return '';
    return WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()];
  }

  /** 金额格式化：1234.5 → "1,234.50"；null → null */
  function formatMoney(value) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    var neg = value < 0;
    var abs = Math.abs(value);
    var fixed = abs.toFixed(2);
    var parts = fixed.split('.');
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intPart + '.' + parts[1];
  }

  /** 百分比格式化：1.86 → "+1.86%"；null → null */
  function formatPct(value) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    var sign = value > 0 ? '+' : (value < 0 ? '-' : '');
    return sign + Math.abs(value).toFixed(2) + '%';
  }

  /** 盈亏展示对象：{ text, cls, label }，负号用 U+2212 更清晰 */
  function pnlLabel(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return { text: '—', cls: 'pnl pnl-flat', label: '未记录' };
    }
    if (value > 0) return { text: '+' + formatMoney(value), cls: 'pnl pnl-gain', label: '盈' };
    if (value < 0) return { text: '\u2212' + formatMoney(Math.abs(value)), cls: 'pnl pnl-loss', label: '亏' };
    return { text: formatMoney(0), cls: 'pnl pnl-flat', label: '持平' };
  }

  /* ------------------------------------------------ localStorage 记忆 ---- */
  /* 允许用途：记住上次浏览月份；任何失败都静默降级。 */

  function rememberMonth(viewKey, y, m) {
    if (!VIEW_MEMORY_ENABLED) return;
    try {
      window.localStorage.setItem(VIEW_KEY_PREFIX + viewKey, y + '-' + pad2(m));
    } catch (err) {
      /* 隐私模式 / 禁用 storage：静默降级 */
    }
  }

  function readRememberedMonth(viewKey) {
    if (!VIEW_MEMORY_ENABLED) return null;
    try {
      var raw = window.localStorage.getItem(VIEW_KEY_PREFIX + viewKey);
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

  /* -------------------------------------------------------- 提示与横幅 ---- */

  function setFailure(messageHtml) {
    failureSlot.innerHTML = '';
    if (!messageHtml) return;
    var box = document.createElement('div');
    box.className = 'notice notice-error';
    box.setAttribute('role', 'alert');
    box.innerHTML = messageHtml;
    failureSlot.appendChild(box);
  }

  function setBanner(kind, title, body) {
    bannerSlot.innerHTML = '';
    if (!kind) return;
    var box = document.createElement('div');
    box.className = 'banner banner-' + kind;
    box.setAttribute('role', 'status');

    var t = document.createElement('span');
    t.className = 'banner-title';
    t.textContent = title;
    box.appendChild(t);

    if (body) {
      var b = document.createElement('span');
      b.className = 'banner-body';
      b.textContent = body;
      box.appendChild(b);
    }
    bannerSlot.appendChild(box);
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

  /* -------------------------------------------------- 生活记录：解析 ---- */

  function normalizeEntry(raw, index) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[life-platform] entries 已跳过第 ' + index + ' 条：不是对象。');
      skippedEntries++;
      return null;
    }

    var parsed = parseDate(raw.date);
    if (!parsed) {
      console.warn(
        '[life-platform] entries 已跳过第 ' + index + ' 条：date 非法（需为真实存在的 YYYY-MM-DD），实际值 = ' +
        JSON.stringify(raw.date)
      );
      skippedEntries++;
      return null;
    }

    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      console.warn(
        '[life-platform] entries 已跳过第 ' + index + ' 条：title 缺失、非字符串或为空，实际值 = ' +
        JSON.stringify(raw.title)
      );
      skippedEntries++;
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
   * @returns {{ok:true, list:Array, updatedAt:string|null, warn:string|null}
   *          |{ok:false, kind:'parse'|'shape', reason:string}}
   */
  function parseEntriesPayload(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, kind: 'shape', reason: '顶层不是 JSON 对象' };
    }

    var rawEntries = payload.entries;
    var warn = null;

    if (!Array.isArray(rawEntries)) {
      warn = '数据格式不符合预期：顶层 entries 字段缺失或不是数组。';
      rawEntries = [];
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'schemaVersion')) {
      console.warn('[life-platform] entries 缺少 schemaVersion，仍按 v1 解析。');
    } else if (!Number.isInteger(payload.schemaVersion)) {
      console.warn(
        '[life-platform] entries 的 schemaVersion 不是整数（' +
        JSON.stringify(payload.schemaVersion) + '），仍按 v1 解析。'
      );
    }

    var list = [];
    for (var i = 0; i < rawEntries.length; i++) {
      var item = normalizeEntry(rawEntries[i], i);
      if (item) list.push(item);
    }

    if (list.length === 0 && rawEntries.length > 0) {
      console.warn(
        '[life-platform] entries 共 ' + rawEntries.length + ' 条，全部被跳过，请检查数据格式。'
      );
    }

    return {
      ok: true,
      list: list,
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

  /* -------------------------------------------------- 理财复盘：解析 ---- */

  function normalizeReview(raw, index) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[life-platform] finance 已跳过第 ' + index + ' 条：不是对象。');
      skippedReviews++;
      return null;
    }

    var parsed = parseDate(raw.date);
    if (!parsed) {
      console.warn(
        '[life-platform] finance 已跳过第 ' + index + ' 条：date 非法，实际值 = ' + JSON.stringify(raw.date)
      );
      skippedReviews++;
      return null;
    }

    var pnl = typeof raw.pnl === 'number' && isFinite(raw.pnl) ? raw.pnl : null;
    var pnlPct = typeof raw.pnlPct === 'number' && isFinite(raw.pnlPct) ? raw.pnlPct : null;

    var actions = [];
    if (Array.isArray(raw.actions)) {
      for (var i = 0; i < raw.actions.length && actions.length < MAX_ACTIONS; i++) {
        var a = raw.actions[i];
        if (typeof a !== 'string') continue;
        a = a.trim();
        if (!a) continue;
        actions.push(a.slice(0, MAX_ACTION_LEN));
      }
    }

    var note = typeof raw.note === 'string' ? raw.note : '';

    var tags = [];
    if (Array.isArray(raw.tags)) {
      for (var k = 0; k < raw.tags.length && tags.length < MAX_TAGS; k++) {
        var t = raw.tags[k];
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
      pnl: pnl,
      pnlPct: pnlPct,
      actions: actions,
      note: note.slice(0, MAX_NOTE),
      tags: tags
    };
  }

  /**
   * @returns {{ok:true, list:Array, updatedAt:string|null, warn:string|null}
   *          |{ok:false, kind:'parse'|'shape', reason:string}}
   */
  function parseFinancePayload(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, kind: 'shape', reason: '顶层不是 JSON 对象' };
    }

    var rawReviews = payload.reviews;
    var warn = null;

    if (!Array.isArray(rawReviews)) {
      warn = '数据格式不符合预期：顶层 reviews 字段缺失或不是数组。';
      rawReviews = [];
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'schemaVersion')) {
      console.warn('[life-platform] finance 缺少 schemaVersion，仍按 v1 解析。');
    }

    var list = [];
    for (var i = 0; i < rawReviews.length; i++) {
      var item = normalizeReview(rawReviews[i], i);
      if (item) list.push(item);
    }

    if (list.length === 0 && rawReviews.length > 0) {
      console.warn(
        '[life-platform] finance 共 ' + rawReviews.length + ' 条，全部被跳过，请检查数据格式。'
      );
    }

    return {
      ok: true,
      list: list,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      warn: warn
    };
  }

  function applyReviews(list) {
    reviewsByDate = new Map();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var bucket = reviewsByDate.get(r.date);
      if (bucket) bucket.push(r);
      else reviewsByDate.set(r.date, [r]);
    }
    reviewCount = list.length;

    financeLatest = null;
    for (var j = 0; j < list.length; j++) {
      var p = parseDate(list[j].date);
      if (!p) continue;
      if (!financeLatest || p.y > financeLatest.y ||
          (p.y === financeLatest.y && p.m > financeLatest.m)) {
        financeLatest = { y: p.y, m: p.m };
      }
    }
  }

  function dataFailureText(url, err) {
    if (err && err.isParse) {
      return '数据文件格式错误：JSON 解析失败（' + err.message + '）';
    }
    if (err && err.isHttp) {
      return '数据加载失败：请求 ' + url + ' 返回 ' + err.message + '（文件不存在或路径错误）。';
    }
    return '数据加载失败：无法读取 ' + url + '。' + (err && err.message ? '（' + err.message + '）' : '');
  }

  /** 把 Promise 拒绝原因归一成 {isParse,isHttp,message}，且绝不把原始 Error 泄漏到界面 */
  function normalizeFetchError(err) {
    if (err && err.isHttp) return err;
    var msg = err && err.message ? err.message : String(err);
    var wrapped = new Error(msg);
    wrapped.isParse = true;
    return wrapped;
  }

  function fetchJson(url) {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('当前浏览器不支持 fetch'));
    }
    return window.fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status + ' ' + res.statusText);
        err.isHttp = true;
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  /** 预览模式：file:// 或 fetch 失败时，回退到 ./assets/data-samples.js 中的示例数据 */
  function samplePayload(section) {
    var s = window.LIFE_SAMPLES;
    if (!s || typeof s !== 'object') return null;
    var payload = s[section];
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  }

  function loadEntries() {
    return fetchJson(DATA_URL).then(
      function (payload) {
        var result = parseEntriesPayload(payload);
        if (!result.ok) {
          entriesState = 'failed';
          entriesError = result.kind === 'parse'
            ? '数据文件格式错误：JSON 解析失败（' + result.reason + '）'
            : '数据格式不符合预期：' + result.reason;
          return;
        }
        applyEntries(result.list);
        entriesUpdatedAt = result.updatedAt;
        entriesState = 'ok';
        entriesError = result.warn;
        usingSampleEntries = false;
      },
      function (err) {
        var fallback = samplePayload('entries');
        if (fallback) {
          var r2 = parseEntriesPayload(fallback);
          if (r2.ok) {
            applyEntries(r2.list);
            entriesUpdatedAt = r2.updatedAt;
            entriesState = 'ok';
            entriesError = null;
            usingSampleEntries = true;
            return;
          }
        }
        entriesState = 'failed';
        entriesError = dataFailureText(DATA_URL, normalizeFetchError(err));
      }
    );
  }

  function loadFinance() {
    return fetchJson(FINANCE_URL).then(
      function (payload) {
        var result = parseFinancePayload(payload);
        if (!result.ok) {
          financeState = 'failed';
          financeError = result.kind === 'parse'
            ? '数据文件格式错误：JSON 解析失败（' + result.reason + '）'
            : '数据格式不符合预期：' + result.reason;
          return;
        }
        applyReviews(result.list);
        financeUpdatedAt = result.updatedAt;
        financeState = 'ok';
        financeError = result.warn;
        usingSampleFinance = false;
      },
      function (err) {
        var fallback = samplePayload('finance');
        if (fallback) {
          var r2 = parseFinancePayload(fallback);
          if (r2.ok) {
            applyReviews(r2.list);
            financeUpdatedAt = r2.updatedAt;
            financeState = 'ok';
            financeError = null;
            usingSampleFinance = true;
            return;
          }
        }
        financeState = 'failed';
        financeError = dataFailureText(FINANCE_URL, normalizeFetchError(err));
      }
    );
  }

  function loadAll() {
    return Promise.all([loadEntries(), loadFinance()]);
  }

  /* ------------------------------------------------------------ 路由 ---- */

  function parseHash() {
    var raw = window.location.hash || '';
    if (raw.indexOf('#/') === 0) raw = raw.slice(2);
    else if (raw.indexOf('#') === 0) raw = raw.slice(1);

    var segments = raw.split('/').filter(function (s) { return s !== ''; });
    var viewName = segments[0] ? segments[0].toLowerCase() : DEFAULT_VIEW;
    if (KNOWN_VIEWS.indexOf(viewName) === -1) viewName = DEFAULT_VIEW;

    var date = null;
    var month = null;
    if (viewName === 'calendar' && segments[1]) {
      if (/^\d{4}-\d{2}$/.test(segments[1])) month = segments[1];
      else if (parseDate(segments[1])) date = segments[1];
    }
    if (viewName === 'finance' && segments[1] && /^\d{4}-\d{2}$/.test(segments[1])) {
      month = segments[1];
    }

    return { view: viewName, date: date, month: month };
  }

  function showView(viewName, focusTitle) {
    var sections = document.querySelectorAll('.view');
    for (var i = 0; i < sections.length; i++) {
      sections[i].hidden = sections[i].id !== 'view-' + viewName;
    }

    for (var k = 0; k < navLinks.length; k++) {
      var link = navLinks[k];
      var isCurrent = link.getAttribute('data-view') === viewName;
      link.classList.toggle('is-current', isCurrent);
      if (isCurrent) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }

    currentView = viewName;

    if (focusTitle) {
      var title = document.getElementById('view-' + viewName + '-title');
      if (title) {
        try { title.focus({ preventScroll: true }); } catch (err) { /* 老浏览器忽略 */ }
      }
    }
  }

  function route(focusTitle) {
    var target = parseHash();
    var viewName = target.view;

    if (viewName === 'calendar') {
      if (target.date) {
        var p = parseDate(target.date);
        view = { y: p.y, m: p.m };
        selectedDate = target.date;
      } else if (target.month) {
        view = { y: Number(target.month.slice(0, 4)), m: Number(target.month.slice(5, 7)) };
      }
      renderCalendar();
      renderPanel();
    } else if (viewName === 'finance') {
      if (target.month) {
        financeView = { y: Number(target.month.slice(0, 4)), m: Number(target.month.slice(5, 7)) };
      } else if (!financeView) {
        var today = todayParts();
        financeView = financeLatest ? { y: financeLatest.y, m: financeLatest.m } : { y: today.y, m: today.m };
      }
      renderFinance();
    } else if (viewName === 'home') {
      renderHome();
    }

    updateAboutVersion();
    showView(viewName, focusTitle);
  }

  /* -------------------------------------------------------- 日历渲染 ---- */

  function dayState(key, isOutside) {
    var hasEntry = entriesByDate.has(key);
    var hasReview = reviewsByDate.has(key);
    var isToday = key === todayKey();
    var isSelected = key === selectedDate;
    return {
      hasEntry: hasEntry,
      hasReview: hasReview,
      isToday: isToday,
      isSelected: isSelected,
      isOutside: isOutside
    };
  }

  function dayAriaLabel(key, st) {
    var parts = [formatHumanDate(key)];
    if (st.isOutside) {
      parts.push('非本月');
      return parts.join('，');
    }
    if (st.hasEntry && st.hasReview) parts.push('有生活记录，有理财复盘');
    else if (st.hasEntry) parts.push('有生活记录');
    else if (st.hasReview) parts.push('有理财复盘');
    else parts.push('无记录');
    if (st.isToday) parts.push('今天');
    if (st.isSelected) parts.push('已选中');
    return parts.join('，');
  }

  function buildMarkRow(st) {
    var row = document.createElement('span');
    row.className = 'day-mark-row';
    row.setAttribute('aria-hidden', 'true');

    if (st.hasEntry) {
      var dot = document.createElement('span');
      dot.className = 'day-dot';
      row.appendChild(dot);
    }
    if (st.hasReview) {
      var tri = document.createElement('span');
      tri.className = 'day-tri';
      row.appendChild(tri);
    }
    return row;
  }

  function buildDayCell(key, dayNum, isOutside) {
    var cell = document.createElement('td');
    cell.className = 'cell';

    var st = dayState(key, isOutside);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    if (st.hasEntry) btn.className += ' has-entry';
    if (st.hasReview) btn.className += ' has-review';
    if (st.isToday) btn.className += ' is-today';
    if (st.isSelected) btn.className += ' is-selected';
    if (isOutside) btn.className += ' is-outside';

    btn.dataset.date = key;
    btn.setAttribute('aria-label', dayAriaLabel(key, st));

    if (isOutside) {
      btn.disabled = true;
    } else {
      btn.setAttribute('aria-pressed', st.isSelected ? 'true' : 'false');
    }

    var num = document.createElement('span');
    num.className = 'day-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = String(dayNum);
    btn.appendChild(num);

    if (st.hasEntry || st.hasReview) {
      btn.appendChild(buildMarkRow(st));
    }

    if (st.isToday) {
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
    if (!view) return;
    var y = view.y;
    var m = view.m;

    monthLabel.textContent = formatMonthLabel(y, m);
    calendarCaption.textContent = y + ' 年 ' + m + ' 月月历';
    calendarEl.setAttribute(
      'aria-label',
      y + ' 年 ' + m + ' 月月历。表头为一、二、三、四、五、六、日，以星期一为第一列。圆点表示有生活记录，三角表示有理财复盘。'
    );

    var firstColumn = columnOf(y, m, 1);
    var totalDays = daysInMonth(y, m);
    var prev = shiftMonth(y, m, -1);
    var next = shiftMonth(y, m, 1);
    var prevTotal = daysInMonth(prev.y, prev.m);
    var nextTotal = daysInMonth(next.y, next.m);

    var rowCount = Math.ceil((firstColumn + totalDays) / 7);
    var fragment = document.createDocumentFragment();
    var cellCount = 0;

    for (var r = 0; r < rowCount; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < 7; c++) {
        var dayNum;
        var key;

        if (cellCount < firstColumn) {
          dayNum = prevTotal - (firstColumn - cellCount) + 1;
          key = toKey(prev.y, prev.m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, true));
        } else if (cellCount < firstColumn + totalDays) {
          dayNum = cellCount - firstColumn + 1;
          key = toKey(y, m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, false));
        } else {
          dayNum = cellCount - firstColumn - totalDays + 1;
          key = toKey(next.y, next.m, dayNum);
          tr.appendChild(buildDayCell(key, dayNum, true));
        }
        cellCount++;
      }
      fragment.appendChild(tr);
    }

    calendarBody.innerHTML = '';
    calendarBody.appendChild(fragment);
  }

  /* ------------------------------------------------------ 内容渲染 ---- */

  function buildEntryNode(entry) {
    var li = document.createElement('li');
    li.className = 'entry';

    var h4 = document.createElement('h4');
    h4.className = 'entry-title';
    h4.textContent = entry.title;
    li.appendChild(h4);

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

  function buildGroupHead(name, countText) {
    var head = document.createElement('div');
    head.className = 'day-group-head';

    var n = document.createElement('span');
    n.className = 'day-group-name';
    n.textContent = name;
    head.appendChild(n);

    var c = document.createElement('span');
    c.className = 'day-group-count';
    c.textContent = countText;
    head.appendChild(c);

    return head;
  }

  /**
   * 构建「某一天的内容栈」：生活记录分组 + 理财复盘分组。
   * @returns {{node:DocumentFragment, entryN:number, reviewN:number}}
   */
  function buildDayContent(dateKey, options) {
    var opts = options || {};
    var frag = document.createDocumentFragment();
    var entries = entriesByDate.get(dateKey) || [];
    var reviews = reviewsByDate.get(dateKey) || [];
    var entryN = entriesState === 'failed' ? 0 : entries.length;
    var reviewN = financeState === 'failed' ? 0 : reviews.length;

    // 「回到日历」按钮需要知道日期，用 data 属性挂在 section 上
    if (entryN > 0) {
      var g1 = document.createElement('section');
      g1.className = 'day-group';
      g1.appendChild(buildGroupHead('生活记录', entryN + ' 条', false));

      var ul = document.createElement('ul');
      ul.className = 'entries';
      for (var i = 0; i < entries.length; i++) ul.appendChild(buildEntryNode(entries[i]));
      g1.appendChild(ul);
      frag.appendChild(g1);
    } else if (entriesState === 'failed' && !opts.compact) {
      var gErr = document.createElement('section');
      gErr.className = 'day-group';
      gErr.appendChild(buildGroupHead('生活记录', '加载失败', false));
      gErr.appendChild(buildEmptyState('生活记录加载失败', entriesError || '无法读取 ./data/entries.json。'));
      frag.appendChild(gErr);
    }

    if (reviewN > 0) {
      var g2 = document.createElement('section');
      g2.className = 'day-group is-finance';
      g2.appendChild(buildGroupHead('理财复盘', reviewN + ' 篇', true));

      var list = document.createElement('div');
      list.className = 'review-list';
      for (var j = 0; j < reviews.length; j++) {
        list.appendChild(buildReviewCard(reviews[j], { compact: true }));
      }
      g2.appendChild(list);

      var row = document.createElement('div');
      row.className = 'review-actions-row';
      var jump = document.createElement('a');
      jump.className = 'btn btn-ghost';
      jump.href = '#/finance/' + dateKey.slice(0, 7);
      jump.textContent = '在理财复盘板块中查看 →';
      row.appendChild(jump);
      g2.appendChild(row);
      frag.appendChild(g2);
    } else if (financeState === 'failed' && !opts.compact) {
      var gErr2 = document.createElement('section');
      gErr2.className = 'day-group is-finance';
      gErr2.appendChild(buildGroupHead('理财复盘', '加载失败', true));
      gErr2.appendChild(buildEmptyState('理财复盘加载失败', financeError || '无法读取 ./data/finance.json。'));
      frag.appendChild(gErr2);
    }

    if (!frag.childNodes.length) {
      frag.appendChild(
        buildEmptyState(
          '这一天还没有任何记录',
          '新增方式：手工编辑 data/entries.json（生活记录）或 data/finance.json（理财复盘），保存后刷新页面。'
        )
      );
    }

    return { node: frag, entryN: entryN, reviewN: reviewN };
  }

  function buildReviewCard(review, options) {
    var opts = options || {};
    var card = document.createElement('article');
    card.className = 'review-card';

    var head = document.createElement('div');
    head.className = 'review-card-head';

    var d = document.createElement('span');
    d.className = 'review-card-date';
    d.textContent = review.date;
    head.appendChild(d);

    var w = document.createElement('span');
    w.className = 'review-card-weekday';
    w.textContent = weekdayName(review.date);
    head.appendChild(w);

    var metrics = document.createElement('span');
    metrics.className = 'review-card-metrics';

    var pnl = pnlLabel(review.pnl);
    var pnlEl = document.createElement('span');
    pnlEl.className = pnl.cls;
    pnlEl.textContent = pnl.text;
    metrics.appendChild(pnlEl);

    var lbl = document.createElement('span');
    lbl.className = 'pnl-label';
    lbl.textContent = pnl.label;
    metrics.appendChild(lbl);

    if (review.pnlPct !== null) {
      var pct = document.createElement('span');
      pct.className = 'pnl ' + (review.pnl > 0 ? 'pnl-gain' : (review.pnl < 0 ? 'pnl-loss' : 'pnl-flat'));
      pct.textContent = formatPct(review.pnlPct);
      metrics.appendChild(pct);
    }

    head.appendChild(metrics);
    card.appendChild(head);

    var body = document.createElement('div');
    body.className = 'review-body';

    if (review.actions.length) {
      var blk = document.createElement('div');
      var t1 = document.createElement('div');
      t1.className = 'review-block-title';
      t1.textContent = '操作记录';
      blk.appendChild(t1);

      var ul = document.createElement('ul');
      ul.className = 'review-actions';
      for (var i = 0; i < review.actions.length; i++) {
        var li = document.createElement('li');
        li.textContent = review.actions[i];
        ul.appendChild(li);
      }
      blk.appendChild(ul);
      body.appendChild(blk);
    }

    if (review.note) {
      var blk2 = document.createElement('div');
      var t2 = document.createElement('div');
      t2.className = 'review-block-title';
      t2.textContent = '心得';
      blk2.appendChild(t2);

      var p = document.createElement('p');
      p.className = 'review-note';
      p.textContent = review.note;
      blk2.appendChild(p);
      body.appendChild(blk2);
    }

    if (body.childNodes.length) card.appendChild(body);

    if (review.tags.length) {
      var ul2 = document.createElement('ul');
      ul2.className = 'entry-tags';
      for (var k = 0; k < review.tags.length; k++) {
        var tagLi = document.createElement('li');
        tagLi.className = 'tag';
        tagLi.textContent = review.tags[k];
        ul2.appendChild(tagLi);
      }
      card.appendChild(ul2);
    }

    if (opts.compact) {
      var row = document.createElement('div');
      row.className = 'review-actions-row';
      var back = document.createElement('a');
      back.className = 'btn btn-ghost';
      back.href = '#/calendar/' + review.date;
      back.textContent = '在日历中查看这一天 →';
      row.appendChild(back);
      card.appendChild(row);
    }

    return card;
  }

  /* ------------------------------------------------------ 当日面板 ---- */

  function renderPanel() {
    panelBody.innerHTML = '';
    panelSummaryLine.textContent = '';

    if (!selectedDate) {
      panelHeading.textContent = '当日内容';
      panelDate.textContent = '—';
      panelBody.appendChild(
        buildEmptyState('尚未选中日期', '在左侧月历中点击任意一天查看当日内容。')
      );
      return;
    }

    panelHeading.textContent = weekdayName(selectedDate) + '的内容';
    panelDate.textContent = selectedDate;

    var built = buildDayContent(selectedDate, { compact: false });
    panelSummaryLine.textContent =
      '生活记录 ' + built.entryN + ' 条 · 理财复盘 ' + built.reviewN + ' 篇';

    panelBody.appendChild(built.node);
  }

  /* -------------------------------------------------------- 首页 ---- */

  function renderMiniCalendar() {
    if (!view) return;
    var y = view.y;
    var m = view.m;

    miniMonthLabel.textContent = formatMonthLabel(y, m);

    var firstColumn = columnOf(y, m, 1);
    var totalDays = daysInMonth(y, m);
    var prev = shiftMonth(y, m, -1);
    var next = shiftMonth(y, m, 1);
    var prevTotal = daysInMonth(prev.y, prev.m);
    var nextTotal = daysInMonth(next.y, next.m);
    var rowCount = Math.ceil((firstColumn + totalDays) / 7);

    var frag = document.createDocumentFragment();
    var cellCount = 0;
    var entryDays = 0;
    var reviewDays = 0;

    for (var r = 0; r < rowCount; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < 7; c++) {
        var td = document.createElement('td');
        var span = document.createElement('span');
        span.className = 'mini-day';

        var dayNum;
        var key;
        var isOutside = false;

        if (cellCount < firstColumn) {
          dayNum = prevTotal - (firstColumn - cellCount) + 1;
          key = toKey(prev.y, prev.m, dayNum);
          isOutside = true;
        } else if (cellCount < firstColumn + totalDays) {
          dayNum = cellCount - firstColumn + 1;
          key = toKey(y, m, dayNum);
        } else {
          dayNum = cellCount - firstColumn - totalDays + 1;
          key = toKey(next.y, next.m, dayNum);
          isOutside = true;
        }
        cellCount++;

        var st = dayState(key, isOutside);
        if (!isOutside && st.hasEntry) entryDays++;
        if (!isOutside && st.hasReview) reviewDays++;

        if (isOutside) span.className += ' is-outside';
        if (!isOutside && st.hasEntry) span.className += ' has-entry';
        if (!isOutside && st.hasReview) span.className += ' has-review';
        if (st.isToday) span.className += ' is-today';
        if (st.isSelected) span.className += ' is-selected';

        var num = document.createElement('span');
        num.textContent = String(dayNum);
        span.appendChild(num);

        if (!isOutside && (st.hasEntry || st.hasReview)) {
          var row2 = document.createElement('span');
          row2.className = 'mini-mark-row';
          if (st.hasEntry) {
            var dot = document.createElement('span');
            dot.className = 'mini-dot';
            row2.appendChild(dot);
          }
          if (st.hasReview) {
            var tri = document.createElement('span');
            tri.className = 'mini-tri';
            row2.appendChild(tri);
          }
          span.appendChild(row2);
        }

        td.appendChild(span);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }

    miniBody.innerHTML = '';
    miniBody.appendChild(frag);
    miniLegend.textContent = '本月 ' + entryDays + ' 个有记录日 · ' + reviewDays + ' 个复盘日';
  }

  function renderHome() {
    var t = todayParts();
    var key = todayKey();

    homeDateText.textContent = t.y + ' 年 ' + t.m + ' 月 ' + t.d + ' 日';
    homeWeekday.textContent = weekdayName(key);

    var eN = entriesState === 'failed' ? 0 : (entriesByDate.get(key) || []).length;
    var rN = financeState === 'failed' ? 0 : (reviewsByDate.get(key) || []).length;

    var parts = [];
    parts.push('今天有 ' + eN + ' 条生活记录');
    parts.push(rN + ' 篇理财复盘');
    homeSummary.textContent = parts.join(' · ');

    homeContent.innerHTML = '';
    homeContent.appendChild(buildDayContent(key, { compact: true }).node);
    homeContentCount.textContent = '生活 ' + eN + ' · 理财 ' + rN;

    renderMiniCalendar();

    homeOpenCalendar.href = '#/calendar/' + key;
  }

  /* ---------------------------------------------------- 理财复盘板块 ---- */

  function monthKey(p) { return p.y + '-' + pad2(p.m); }

  function monthReviews(y, m) {
    var prefix = y + '-' + pad2(m);
    var list = [];
    reviewsByDate.forEach(function (bucket, date) {
      if (date.slice(0, 7) === prefix) {
        for (var i = 0; i < bucket.length; i++) list.push(bucket[i]);
      }
    });
    list.sort(function (a, b) {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return 0;
    });
    return list;
  }

  function renderFinance() {
    if (!financeView) {
      var t = todayParts();
      financeView = financeLatest ? { y: financeLatest.y, m: financeLatest.m } : { y: t.y, m: t.m };
    }

    finMonthLabel.textContent = formatMonthLabel(financeView.y, financeView.m);
    finList.innerHTML = '';
    finSummary.innerHTML = '';

    if (financeState === 'failed') {
      var box = document.createElement('div');
      box.className = 'notice notice-error';
      box.setAttribute('role', 'alert');
      box.textContent = financeError || '理财复盘数据加载失败。';
      finSummary.appendChild(box);
      finSummary.className = 'summary-bar';
      finList.appendChild(
        buildEmptyState('无法显示复盘', '修复 ./data/finance.json 后刷新页面即可恢复；日历与生活记录不受影响。')
      );
      return;
    }

    var list = monthReviews(financeView.y, financeView.m);
    var total = 0;
    var counted = 0;
    var gains = 0;
    var losses = 0;
    var flat = 0;

    for (var i = 0; i < list.length; i++) {
      var pnl = list[i].pnl;
      if (typeof pnl === 'number' && isFinite(pnl)) {
        total += pnl;
        counted++;
        if (pnl > 0) gains++;
        else if (pnl < 0) losses++;
        else flat++;
      }
    }

    finSummary.className = 'summary-bar';

    var item1 = document.createElement('div');
    item1.className = 'summary-item';
    var l1 = document.createElement('span');
    l1.className = 'summary-label';
    l1.textContent = financeView.m + ' 月累计盈亏';
    var v1 = document.createElement('span');
    var tp = pnlLabel(counted > 0 ? total : null);
    v1.className = 'summary-value is-large ' + (tp.cls.indexOf('pnl-gain') !== -1 ? 'pnl-gain'
      : (tp.cls.indexOf('pnl-loss') !== -1 ? 'pnl-loss' : 'pnl-flat'));
    v1.textContent = tp.text + (counted > 0 ? ' ' + tp.label : '');
    item1.appendChild(l1);
    item1.appendChild(v1);
    finSummary.appendChild(item1);

    var item2 = document.createElement('div');
    item2.className = 'summary-item';
    var l2 = document.createElement('span');
    l2.className = 'summary-label';
    l2.textContent = '盈 / 亏 / 持平 天数';
    var v2 = document.createElement('span');
    v2.className = 'summary-value';
    v2.textContent = gains + ' / ' + losses + ' / ' + flat;
    item2.appendChild(l2);
    item2.appendChild(v2);
    finSummary.appendChild(item2);

    var item3 = document.createElement('div');
    item3.className = 'summary-item';
    var l3 = document.createElement('span');
    l3.className = 'summary-label';
    l3.textContent = '复盘天数';
    var v3 = document.createElement('span');
    v3.className = 'summary-value';
    v3.textContent = list.length + ' 天';
    item3.appendChild(l3);
    item3.appendChild(v3);
    finSummary.appendChild(item3);

    var item4 = document.createElement('div');
    item4.className = 'summary-item';
    var l4 = document.createElement('span');
    l4.className = 'summary-label';
    l4.textContent = '有盈亏记录的天数';
    var v4 = document.createElement('span');
    v4.className = 'summary-value';
    v4.textContent = counted + ' 天';
    item4.appendChild(l4);
    item4.appendChild(v4);
    finSummary.appendChild(item4);

    if (!list.length) {
      finList.appendChild(
        buildEmptyState(
          '本月还没有复盘记录',
          '在 ./data/finance.json 的 reviews 数组中新增一条（字段见 docs/design-v1.1.md §6.2），保存后刷新页面。'
        )
      );
      return;
    }

    for (var k = 0; k < list.length; k++) {
      finList.appendChild(buildReviewCard(list[k], { compact: false }));
    }
  }

  /* -------------------------------------------------------- 页脚 ---- */

  function updateFooter() {
    var text;
    var isError = entriesState === 'failed' || financeState === 'failed';

    if (entriesState === 'loading' || financeState === 'loading') {
      text = '正在加载数据…';
    } else {
      var months = new Set();
      entriesByDate.forEach(function (_v, k) { months.add(k.slice(0, 7)); });
      reviewsByDate.forEach(function (_v, k) { months.add(k.slice(0, 7)); });

      var e = entriesState === 'failed'
        ? '生活记录：加载失败'
        : '生活记录 ' + entryCount + ' 条';
      var f = financeState === 'failed'
        ? '理财复盘：加载失败'
        : '理财复盘 ' + reviewCount + ' 篇';

      text = e + ' · ' + f + ' · 覆盖 ' + months.size + ' 个月份';

      if (usingSampleEntries || usingSampleFinance) {
        text += ' · 本地预览示例数据';
      }

      var latest = entriesUpdatedAt && parseDate(entriesUpdatedAt) ? entriesUpdatedAt : null;
      var latestFin = financeUpdatedAt && parseDate(financeUpdatedAt) ? financeUpdatedAt : null;
      if (latest || latestFin) {
        text += ' · 数据最后更新：' + [latest, latestFin].filter(Boolean).join(' / ');
      }

      if (entriesState === 'failed' && entriesError) text += ' · ' + entriesError;
      if (financeState === 'failed' && financeError) text += ' · ' + financeError;
      if (skippedEntries > 0) text += ' · 已跳过 ' + skippedEntries + ' 条无效生活记录';
      if (skippedReviews > 0) text += ' · 已跳过 ' + skippedReviews + ' 条无效复盘';
    }

    footerStats.textContent = text;
    var footer = document.querySelector('.site-footer');
    if (footer) footer.classList.toggle('is-error', isError);
  }

  function updateAboutVersion() {
    if (!aboutVersion) return;
    aboutVersion.textContent =
      'app.js v1.1 · 设计依据 docs/design-v1.1.md · 当前视图 #/' + (currentView || DEFAULT_VIEW);
  }

  function refreshAll() {
    renderCalendar();
    renderPanel();
    renderHome();
    renderFinance();
    updateFooter();
  }

  /* ---------------------------------------------------------- 交互 ---- */

  function selectDate(key) {
    var parsed = parseDate(key);
    if (!parsed) return;

    selectedDate = key;

    if (parsed.y !== view.y || parsed.m !== view.m) {
      view = { y: parsed.y, m: parsed.m };
      rememberMonth('calendar', view.y, view.m);
    }

    renderCalendar();
    renderPanel();
    renderHome();
  }

  function goToMonth(y, m) {
    view = { y: y, m: m };
    rememberMonth('calendar', y, m);
    selectedDate = null;
    renderCalendar();
    renderPanel();
    renderHome();
  }

  function stepMonth(delta) {
    var target = shiftMonth(view.y, view.m, delta);
    goToMonth(target.y, target.m);
  }

  function goToday() {
    var key = todayKey();
    var p = parseDate(key);
    view = { y: p.y, m: p.m };
    rememberMonth('calendar', view.y, view.m);
    selectedDate = key;
    renderCalendar();
    renderPanel();
    renderHome();
    if (window.location.hash !== '#/calendar/' + key) {
      window.location.hash = '#/calendar/' + key;
    }
    try { panelEl.focus({ preventScroll: true }); } catch (err) { /* 忽略 */ }
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

    if (target.getFullYear() !== view.y || target.getMonth() + 1 !== view.m) {
      view = { y: target.getFullYear(), m: target.getMonth() + 1 };
      rememberMonth('calendar', view.y, view.m);
      renderCalendar();
    }

    var nextCell = calendarBody.querySelector('.day[data-date="' + targetKey + '"]');
    if (nextCell && !nextCell.disabled) {
      nextCell.focus();
      selectDate(targetKey);
    }
  }

  function stepFinanceMonth(delta) {
    var target = shiftMonth(financeView.y, financeView.m, delta);
    financeView = { y: target.y, m: target.m };
    renderFinance();
    var targetHash = '#/finance/' + monthKey(financeView);
    if (window.location.hash !== targetHash) window.location.hash = targetHash;
  }

  function bindEvents() {
    prevBtn.addEventListener('click', function () { stepMonth(-1); });
    nextBtn.addEventListener('click', function () { stepMonth(1); });
    todayBtn.addEventListener('click', goToday);

    calendarEl.addEventListener('click', handleCalendarClick);
    calendarEl.addEventListener('keydown', handleCalendarKeydown);

    finPrevBtn.addEventListener('click', function () { stepFinanceMonth(-1); });
    finNextBtn.addEventListener('click', function () { stepFinanceMonth(1); });
    finResetBtn.addEventListener('click', function () {
      var t = todayParts();
      financeView = financeLatest ? { y: financeLatest.y, m: financeLatest.m } : { y: t.y, m: t.m };
      renderFinance();
      var targetHash = '#/finance/' + monthKey(financeView);
      if (window.location.hash !== targetHash) window.location.hash = targetHash;
    });

    window.addEventListener('hashchange', function () { route(true); });

    document.addEventListener('keydown', function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;
      if (currentView !== 'calendar') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;
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
    var today = todayParts();
    var remembered = readRememberedMonth('calendar');

    if (remembered && remembered.y === today.y && remembered.m === today.m) {
      view = { y: remembered.y, m: remembered.m };
    } else {
      view = { y: today.y, m: today.m };
    }
    selectedDate = todayKey();
  }

  function announceDataState() {
    if (usingSampleEntries || usingSampleFinance) {
      setBanner(
        'preview',
        '本地预览模式',
        '正在显示 ./assets/data-samples.js 中的示例数据，不是 data/ 下的真实数据。' +
        '请用本地 HTTP 服务打开以查看真实数据（参见 README 第 2 节）。'
      );
      return;
    }

    if (entriesState === 'failed' || financeState === 'failed') {
      var html = '';
      if (entriesState === 'failed') {
        html += '<p><strong>' + (entriesError || '生活记录加载失败') + '</strong></p>';
      }
      if (financeState === 'failed') {
        html += '<p><strong>' + (financeError || '理财复盘加载失败') + '</strong></p>';
      }
      html += '<p>月历仍可正常翻月；修复数据文件后刷新页面即可恢复。两个数据源互不影响。</p>';
      if (currentView === 'calendar' || currentView === 'finance') {
        setFailure(html + localFileHint());
      }
      setBanner('preview', '数据异常', '有数据源加载失败，页面已降级运行（详见下方提示）。');
      return;
    }

    setFailure('');
    setBanner('', '', '');
  }

  function init() {
    if (!calendarBody || !panelBody || !footerStats || !homeContent) return;

    initialState();
    bindEvents();

    // 先出骨架，绝不白屏
    refreshAll();
    route(false);

    loadAll().then(function () {
      refreshAll();
      route(false);
      announceDataState();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
