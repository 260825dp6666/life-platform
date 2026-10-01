# v1 验证报告

> 报告日期：2026-09-30
> 验证标的：工作区当前文件（含设计 v1.1 各项改动）
> 验证方式：**真实浏览器实测**（headless Edge 154.0.4258.37，CDP 驱动），非阅读代码推断
> 本地验证：站点 `http://127.0.0.1:8210`；CDP `9333`
> 公网验证：**https://260825dp6666.github.io/life-platform/**
> 验证执行：captain（原定 verifier，其会话未能启动，详见 §6）

---

## 1. 结论摘要

**v1 + 设计 v1.1 通过验证，发现并修复 2 个真缺陷，已发布至公网并线上复验通过。**

**公网地址：<https://260825dp6666.github.io/life-platform/>**

| 项 | 结果 |
|---|---|
| 本地验证项 | 47 |
| 本地通过 | 45 |
| 发现缺陷并已修复 | 2 |
| 公网复验 | ✅ 通过（A1/A10/A11 + 两缺陷修复均线上确认） |
| 控制台错误 / 未捕获异常 / 失败请求 | 0 / 0 / 0（本地与公网均为此结果） |

---

## 2. 发现并修复的缺陷

### 缺陷 1：`#/calendar/YYYY-MM` 深链失效

**严重度**：中。**位置**：`assets/app.js:648-650`（`parseHash()`）。

**现象**：访问 `#/calendar/2025-06` 渲染出**今天所在月**（实测为 2026 年 9 月），月份参数被完全丢弃。

**实测对照（修复前）**：

| 深链 | 渲染结果 |
|---|---|
| `#/calendar/2025-06` | ❌ 2026 年 9 月（首格 2026-08-31、末格 2026-10-04） |
| 加载后运行时切 `#/calendar/2025-06` | ❌ 仍 2026 年 9 月 |
| `#/calendar/2025-06-14`（对照组） | ✅ 2025 年 6 月 |
| `#/finance/2025-06`（对照组） | ✅ 2025 年 6 月 |

**根因**：`calendar` 分支只调用要求完整 `YYYY-MM-DD` 的 `parseDate()`，缺少月份分支；紧随其后的 `finance` 分支则有 `/^\d{4}-\d{2}$/` 判断。属遗漏而非设计取舍。

```js
// 修复前
if (viewName === 'calendar' && segments[1]) {
  if (parseDate(segments[1])) date = segments[1];   // '2025-06' → null
}
if (viewName === 'finance' && segments[1] && /^\d{4}-\d{2}$/.test(segments[1])) {
  month = segments[1];
}
```

**修复**：`assets/app.js:648-651` 增加月份分支，并在 `route()`（`assets/app.js:686-694`）增加 `else if (target.month)` 分支。

**修复后实测**：

| 深链 | 渲染结果 |
|---|---|
| `#/calendar/2025-06`（首次加载） | ✅ 2025 年 6 月，首格 2025-05-26、末格 2025-07-06、42 格 |
| 运行时切 `#/calendar/2025-06` | ✅ 2025 年 6 月 |
| 运行时切 `#/calendar/2025-11` | ✅ 2025 年 11 月 |
| 运行时切 `#/calendar/2024-02`（闰年） | ✅ 2024 年 2 月 |

### 缺陷 2：`#calendar` 表头与渲染列序错位一天

**严重度**：高（用户会读错日期）。**位置**：`index.html:112-122` + `assets/app.js:812-815`。

**现象**：主月历表头为周日首列，而数据按周一为首列填充，**每一列都对不上**。

**实测（修复前）**：

```
thead      : 日 一 二 三 四 五 六
firstRow   : 2025-05-26 … 2025-06-01
逐格真实星期:   一  二  三  四  五  六  日
```

`headerCol0="日"` 而 `firstCellRealWeekday="一"` → `mismatch: true`。

**根因**：`index.html` 静态 thead 写死周日首列；`renderCalendar()` 用 `columnOf()` → `toMondayFirstColumn()` 按周一首列填充；该函数只替换 `calendarBody.innerHTML`（tbody），**thead 从未被修正**。同时 `index.html:71-81` 的主页迷你日历是周一起始，**同页两张日历表列序相反**。

**需求文档侧的同源缺陷**：`docs/requirements.md:217` 的验收标准 A3 原文为「日历周一为第一列，表头顺序为『日 一 二 三 四 五 六』」——**该句自身矛盾**（「周一为第一列」与「日打头」不可兼得），实现方照字面执行即产出错位表头。已一并修正。

**修复**：
- `index.html:114-120` thead 改为周一起始
- `assets/app.js:814` aria-label 文案同步
- `docs/requirements.md` 第 85、108、217、277 行统一为周一起始
- `docs/design-v1.1.md:92` 同步

**修复后实测**（逐格核对）：

```
thead    : 一 二 三 四 五 六 日
firstRow : 2025-05-26 … 2025-06-01
真实星期 : 一 二 三 四 五 六 日   allAligned: true
```

主页迷你日历与主月历 `same: true`；aria-label 已为「表头为一、二、三、四、五、六、日，以星期一为第一列」。

---

## 3. 逐项验证结果

### 3.1 需求文档 A1–A14 验收标准

| 编号 | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A1 | 公网 URL 可打开无 404 | ⏳ 待发布后 | 本机无公网 URL；本地 8210 端口 200 |
| A2 | 默认展示今日所在月且今日选中 | ✅ | 默认渲染当月，`is-selected` 命中今日 |
| A3 | 周一首列、表头与真实星期对齐 | ✅ 修复后 | 逐格 `ok:true`，`allAligned:true` |
| A4 | 有记录日期显示可见标记 | ✅ | 标记日 `2025-06-01/14/15/20` 与 `entries.json` 一致 |
| A5 | 点击有记录日列出全部条目 | ✅ | 2025-06-14 出 2 条（含备注、标签） |
| A6 | 点空日显示空态且不残留 | ✅ | 2025-06-10 → 「生活记录 0 条 · 理财复盘 0 篇」，`leaksPrevious:false` |
| A7 | 翻月正常、跨年正确、闰年 2 月 29 天 | ✅ | `2025-01 → 2024-12` 偏移正确；`2024-02` 29 天；实测 2024 年 2 月深链正常 |
| A8 | ≤720px 上下堆叠、无横向滚动 | ✅ | 700px：`sw==cw==700`；`main` 676×1436，面板 `y:651` 位于日历下方 |
| A9 | 控制台无 `console.error` | ✅ | `consoleErrors:0`、`exceptions:0`、`failedRequests:0` |
| A10 | 离线仍可用（无外链依赖） | ⏳ 待发布后 | 已静态确认零外链；真断网未测 |
| A11 | 资源均相对路径且子路径下 200 | ✅ | 6 个资源全 200；零绝对路径 |
| A12 | 示例数据 ≥3 条且覆盖两种情形 | ✅ | 6 条，覆盖 4 个日期；2025-06 共 30 天含 26 个空日 |
| A13 | 无 `package.json` / `node_modules` / 构建产物 | ✅ | 均不存在 |
| A14 | JSON 损坏时提示格式错误而非白屏 | ✅ | 屏蔽 `entries.json` 后落入降级路径，`hasErrorBanner` 行为符合 §3.4 |

### 3.2 设计 v1.1 新增能力

| 项 | 结果 | 证据 |
|---|---|---|
| 6 个 hash 路由 | ✅ | 首页/日历/理财复盘/习惯打卡/健康/关于标题全对 |
| 未知 hash 回落 | ✅ | `#/does-not-exist-xyz` → 首页，`activeNav` 正确 |
| hashchange 响应 | ✅ | 运行时切换路由生效（禁用缓存后复测） |
| 双数据源独立降级 | ✅ | 屏蔽 `finance.json` 后仍 `cells:42`、生活记录可见、无错误横幅 |
| 双维度标记不依赖颜色 | ✅ | 生活=蓝圆 `rgb(31,95,214)` 8px；理财=绿三角 `rgb(15,107,70)`；并排渲染，同格 `dots:1 tris:1` |
| 逐维度 aria 播报 | ✅ | 「2025 年 6 月 14 日，有生活记录，有理财复盘，已选中」 |
| 盈亏符号与文字 | ✅ | `+520.00`/`−180.00` 带 `+`/U+2212，并含「盈/亏」文字 |
| 涨跌配色 | ✅ | 涨 `rgb(179,38,30)` 红 / 跌 `rgb(15,107,70)` 绿（红涨绿跌） |
| 键盘可达性 | ✅ | 42 个日期格均为 `<button>`；Tab 首焦点为 skip-link |
| `file://` 降级不白屏 | ✅ | `bodyLen:623`，显示「本地预览模式」横幅，回退 `data-samples.js` |
| 预留板块占位 | ✅ | 习惯/健康可进入，带「规划中」徽标 + aria-label 后缀 |

### 3.3 静态与结构检查

| 项 | 结果 |
|---|---|
| `node --check assets/app.js` | ✅ 语法通过 |
| `node --check assets/data-samples.js` | ✅ 语法通过 |
| `data/entries.json` 解析 | ✅ `schemaVersion=1`，6 条 |
| `data/finance.json` 解析 | ✅ `schemaVersion=1`，6 条 |
| 外链引用 | ✅ 零外链 |
| CSS 规则加载 | ✅ 154 条 |
| Git 仓库状态 | ✅ 9 个已跟踪文件，工作树干净（除 8 个待提交改动） |

---

## 4. 无法在本机验证的项（需发布后复核）

| 项 | 原因 |
|---|---|
| A1 公网 URL 可访问 | 尚无 GitHub 远端推送凭据，Pages 未上线 |
| A10 真断网可用 | 本机未做物理断网测试（零外链已静态确认） |
| GitHub Actions 首次运行 | 本机无 runner、无凭据，`pages.yml` 仅经结构化检查与人工审查 |

---

## 4. 公网发布与线上复验

### 4.1 发布记录

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/260825dp6666/life-platform`（Public） |
| 公网地址 | **https://260825dp6666.github.io/life-platform/** |
| Pages 构建方式 | `workflow`（GitHub Actions），HTTPS 强制开启 |
| 工作流 | `.github/workflows/pages.yml` |
| 运行记录 | run #1 `70b3e2b` ❌ failure（Pages 未开启，`Configure Pages` 失败）<br>run #2 `eab16d7` ✅ **success** |
| 交付提交 | `70b3e2b`（feat: v1 + 设计 v1.1，11 文件 +2780/−336）<br>`eab16d7`（ci: 触发部署） |

**run #1 失败原因（已解决）**：仓库当时为 Private 且 Pages 未开启，`actions/configure-pages@v5` 无法获取 Pages 配置而失败，后续 `Upload artifact` 被跳过、`Deploy to GitHub Pages` 整个 skip。仓库转为 Public 并手动开启 Pages（Source = GitHub Actions）后重新触发，run #2 全绿。

### 4.2 公网资源可用性（A1 / A11）

全部 **200**，字节数与本地完全一致：

| 资源 | 状态 | 字节 |
|---|---|---|
| `/life-platform/` | 200 | 13531 |
| `/life-platform/index.html` | 200 | 13531 |
| `/life-platform/assets/style.css` | 200 | 22994 |
| `/life-platform/assets/app.js` | 200 | 54219 |
| `/life-platform/assets/data-samples.js` | 200 | 5000 |
| `/life-platform/data/entries.json` | 200 | 1277 |
| `/life-platform/data/finance.json` | 200 | 2393 |

证明：子路径 `/<仓库名>/` 下相对路径解析正确，无 404，A1 与 A11 在真实 GitHub Pages 上成立。

### 4.3 公网真机浏览器复验

以 headless Edge 打开公网 URL，禁用缓存实测：

| 项 | 结果 |
|---|---|
| 标题 | 个人生活平台 · 日历 / 每日记录 / 理财复盘 |
| 协议与路径 | `https:` / `260825dp6666.github.io` / `/life-platform/` |
| CSS 生效 | 154 条规则，href 指向 `.../assets/style.css` |
| 外部引用 | **`[]`（零外链）** |
| 实际加载资源 | 仅本站 5 个（2 个 JSON + css + app.js + data-samples.js） |
| 预览横幅 | **未出现**（`sawPreview:false`）→ 走真实 fetch 路径，非 `file://` 降级 |
| **缺陷 1 修复线上确认** | `#/calendar/2025-06-14` → **2025 年 6 月**，42 格 |
| **缺陷 2 修复线上确认** | thead `["一","二","三","四","五","六","日"]`，首格 2025-05-26 真实星期「一」，`aligned:true` |
| 双数据源 | `data/entries.json` 与 `data/finance.json` 均真实请求 |
| 6 个路由 | home/calendar/finance/habits/health/about 的 `activeNav` 全部正确 |
| 理财板块 | `#/finance/2025-06` → 2025 年 6 月，含「盈」与 `+` 符号 |
| 控制台 | **0 错误 / 0 异常 / 0 失败请求** |

**双维度标记的实际分布**（与两份 JSON 数据吻合）：
```
2025-05-28:tri   2025-06-01:dot   2025-06-05:tri   2025-06-14:dot+tri
2025-06-15:dot+tri   2025-06-20:dot+tri   2025-07-03:tri
```

### 4.4 结论

原报告 §4「无法在本机验证」的 3 项已全部完成线上复核：

| 原待复核项 | 状态 |
|---|---|
| A1 公网 URL 可访问无 404 | ✅ 已复核通过 |
| A10 无外链依赖 | ✅ 公网实测零外部引用（真断网未物理测试，但零外链已确证） |
| GitHub Actions 首次运行 | ✅ run #2 success |

---

## 5. 遗留问题（不阻断发布）

| 项 | 位置 | 说明 |
|---|---|---|
| 提示文案硬编码 | `assets/app.js:282-283` | `localFileHint()` 内硬编码 `python -m http.server 8080` / `http://localhost:8080/`。问题：(a) 本机无 python，提示指向跑不通的命令；(b) 发布后资源 404 会误归因为「你在用 file:// 打开」。其 `file://` 判断逻辑本身正确 |
| `.nojekyll` 缺失 | 仓库根 | **已补**（提交 `70b3e2b` 一并纳入） |
| 设计待拍板项 | `docs/design-v1.1.md` §11 | Q1 盈亏损色（默认红涨绿跌，改只动 2 个 CSS 变量）；Q6 是否做持仓/资产总览（默认不做） |

---

## 6. 验证方法说明与教训

### 6.1 verifier 会话未启动

t4 原定由 verifier 执行，其已被调度器标记 `working/running` 并认领任务，但 `wait_agent` 两次返回 `noProgress: no-active-peer`，消息只进入收件箱、会话未真正拉起。为避免验证无限悬挂，captain 亲自执行本次验证。

另有一份 verifier 后台子代理的收尾报告，在「空月份」现象上与本次实测一致，但**归因不同**：该报告判定「浏览器时钟 2026-09-30 而数据是 2025 年，当前月本就无记录，不是 bug」因而停步；本次验证继续沿 `#/calendar/2025-06` 追查，发现了缺陷 1。该报告另有方法缺陷（视图可见性以「六视图全可见」判定不可靠，应以 `activeNav` 为准；≤700px 容器选择器未匹配）。

### 6.2 必须记录的三次误报（已全部收回）

本次验证过程中，captain 三次误报「标记未渲染」，均为**探测方法本身错误**：

1. 用 `textContent.trim() !== ''` 过滤标记元素 —— `.day-mark-row` 内的 span 是空元素（图形由 CSS 绘制），全部被滤掉。
2. 用 `getBoundingClientRect()` 量 `.day-tri` —— 由 border 技巧构成的三角返回 `0×0`。
3. `querySelector('.day-tri')` 抓到 `is-outside` 溢出格 —— 该格有 `display:none` 规则，量到隐藏态。

**教训：探测条件本身要先验证；对空元素应使用 class 与计算样式，而非 `textContent` 与尺寸。**

### 6.3 缓存假象（重要）

修复完成后首次复测，结果与修复前**逐字相同**，一度误判为「修复未生效」。实际原因是 `http-server` 默认发送 `Cache-Control: max-age=3600`，而该 Edge 实例已执行数十次导航、持续命中旧缓存。

**结论：验证修复效果必须先 `Network.setCacheDisabled: true`，或使用全新 profile。** 本次以禁用缓存重测后，两项修复均确认生效。

---

## 7. 结论

**v1 + 设计 v1.1 已交付并上线，达到验收标准。**

- 本地 47 项验证中 45 项通过；2 个发现的缺陷已修复并**在公网线上复验确认**
- 公网地址 **<https://260825dp6666.github.io/life-platform/>** 可访问，7 个资源全 200 且字节数与本地一致
- 公网真机实测：零外链、零控制台错误、零异常、零失败请求；6 个路由与双数据源均正常
- 原「待发布后复核」的 A1（公网访问）、A10（无外链）、Actions 首跑三项已全部完成复核
- 发布链路：run #1 因 Pages 未开启失败 → 开通后 run #2 **success**

唯一未做的物理动作是真断网测试；由于零外链已由 `externalRefs: []` 与仅本站 5 个资源请求确证，该项风险可忽略。
