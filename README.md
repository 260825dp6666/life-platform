# 个人生活平台 · Life Platform

一个**纯静态、零依赖、零构建**的个人生活平台：多板块（首页 / 日历 / 理财复盘 / 预留板块）
+ 月历视图 + 每日记录只读展示。
把文件推到 GitHub 仓库、开启 GitHub Pages，就能公网访问，无需服务器、无需登录、无需维护。

- **v1.1 范围**：首页概览、日历（点选日期查看当日内容）、理财复盘板块、占位板块（习惯打卡 / 健康）
- **技术栈**：原生 HTML / CSS / JavaScript，无框架、无 npm、无构建步骤
- **页面路由**：hash 路由（`#/home`、`#/calendar`、`#/finance`、`#/about` …），仍是**唯一一个 `index.html`**
- **数据源**：`data/entries.json`（生活记录）、`data/finance.json`（理财复盘），手工编辑，前端只读
- **权威文档**：[docs/design-v1.1.md](docs/design-v1.1.md)（当前页面设计规格）、
  [docs/requirements.md](docs/requirements.md)（需求与发布约束）、
  [docs/data-schema.md](docs/data-schema.md)（生活记录数据格式）

---

## 1. 目录结构

```
<repo-root>/
├── index.html                 # 唯一页面：多板块 hash 路由外壳
├── assets/
│   ├── style.css              # 唯一样式表
│   ├── app.js                 # 唯一脚本：路由、加载数据、渲染日历 / 当日内容 / 理财复盘
│   └── data-samples.js        # 本地预览用的示例数据（file:// 打开时的兜底，不是真实数据）
├── data/
│   ├── entries.json           # 生活记录数据源（前端只读）
│   └── finance.json           # 理财复盘数据源（前端只读）
├── docs/
│   ├── design-v1.1.md         # 页面设计规格（板块结构、交互、视觉、验收清单）
│   ├── requirements.md        # 需求与技术方案
│   └── data-schema.md         # 生活记录数据格式定义
├── .github/
│   └── workflows/
│       └── pages.yml          # GitHub Actions：发布仓库根目录到 Pages
├── .gitignore
└── README.md                  # 本文件
```

> **无构建产物**：仓库里的文件**就是**发布内容，不存在 `dist/` 之类的中间目录。

---

## 2. 本地预览

### 2.1 推荐：起一个本地 HTTP 服务

页面用 `fetch()` 读取 `data/entries.json` 与 `data/finance.json`。浏览器对 `file://` 协议下的
`fetch()` 普遍有 CORS 限制，**直接双击 `index.html` 在部分浏览器里可能读不到数据**
（此时页面会退回示例数据并显示「本地预览模式」横幅，不会白屏）。

在仓库根目录任选一条命令启动本地服务，然后浏览器打开提示的地址：

```bash
# Python 3
python -m http.server 8080

# Node.js（若已安装，无需额外依赖）
npx --yes serve -l 8080 .

# PHP
php -S localhost:8080
```

打开 <http://localhost:8080/> 即可。**不要用 8000 端口**，避免与其他本地服务冲突。

### 2.2 备选：直接双击打开

直接双击 `index.html` 时，页面会尽力加载；若浏览器拦截了 `file://` 下的 `fetch`，
页面会显示**「本地预览模式」**横幅，用 `assets/data-samples.js` 里的示例数据把界面渲染出来
（横幅明确说明这不是真实数据），你是想先看界面效果时可以用这种方式。

### 2.3 板块与地址

| 板块 | 地址 | 状态 |
| --- | --- | --- |
| 首页 | `#/home`（默认） | 已可用 |
| 日历 | `#/calendar`，某天 `#/calendar/2025-06-14` | 已可用 |
| 理财复盘 | `#/finance`，某月 `#/finance/2025-06` | 已可用 |
| 习惯打卡 | `#/habits` | 占位（规划中） |
| 健康 | `#/health` | 占位（规划中） |
| 关于 | `#/about` | 已可用 |

未知地址会回落首页。

---

## 3. 如何新增一条记录

v1.1 不支持在页面上新增，采用**手工编辑 JSON** 的方式。

### 3.1 生活记录 `data/entries.json`

1. 用编辑器打开 `data/entries.json`。
2. 在 `entries` 数组**末尾**追加一个对象：

   ```json
   { "date": "2025-06-15", "title": "今天的标题", "note": "备注内容", "tags": ["生活"] }
   ```

3. **注意 JSON 语法**（最容易出错的地方）：
   - 数组元素之间用逗号分隔，**最后一个元素后面不能有逗号**；
   - 字符串里的换行必须写成 `\n`，双引号必须转义为 `\"`；
   - 文件必须是纯 JSON：不能有注释、不能用单引号。
4. 保存后刷新页面验证；控制台会输出记录总数。

字段的完整定义（必填性、长度上限、日期格式、校验规则）见
[docs/data-schema.md](docs/data-schema.md)；该文档提供了可直接复制的合法示例片段。

### 3.2 理财复盘 `data/finance.json`

1. 用编辑器打开 `data/finance.json`。
2. 在 `reviews` 数组**末尾**追加：

   ```json
   {
     "date": "2025-07-10",
     "pnl": 260.0,
     "pnlPct": 1.15,
     "actions": ["买入 沪深300ETF 1000 份 @ 3.900"],
     "note": "按计划执行，没有追高。",
     "tags": ["纪律"]
   }
   ```

3. 字段说明（完整定义见 [docs/design-v1.1.md](docs/design-v1.1.md) 第 6.2 节）：

   | 字段 | 必填 | 说明 |
   | --- | --- | --- |
   | `date` | 是 | `YYYY-MM-DD`，必须是真实存在的公历日期；**同一天可写多条** |
   | `pnl` | 否 | 当日盈亏金额（元），可为负数；**不填就写 `null`**（表示当天没记账，与「盈亏为 0」不是一回事） |
   | `pnlPct` | 否 | 当日盈亏百分比，例如 `1.15` 表示 `+1.15%`；不填写 `null` |
   | `actions` | 否 | 操作记录字符串数组，每条一句话 |
   | `note` | 否 | 复盘心得，可以写多行（用 `\n`） |
   | `tags` | 否 | 标签字符串数组，用于分类；不能含空格或 `#` |

4. 保存 → 刷新页面 → 切到「理财复盘」板块或点日历上带 ▲ 的日子核对。

> **提示**：`date` 必须是真实存在的公历日期，格式固定为 `YYYY-MM-DD`（例如 `2025-06-14`），
> 不要写成 `2025/06/14` 或带时区的 `2025-06-14T00:00:00Z`。
> 格式不合法的条目会被**跳过**并在浏览器控制台输出 `console.warn` 提示，
> 其余条目照常显示，页面不会白屏。

---

## 4. 发布到 GitHub Pages

### 4.1 首次准备

1. 在 GitHub 上新建一个仓库（建议 **public**；私有仓库需要 Pro/Team 才能用 Pages）。
2. 关联远程并推送 `main` 分支：

   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

   > 本机没有 `gh` CLI，推送使用 HTTPS + Personal Access Token（PAT），或配置 SSH key。
   > 使用 PAT 时把密码位置填 token 即可；建议用 `git credential manager` 记住凭据。

### 4.2 开启 Pages（二选一）

**方式 A：GitHub Actions（本仓库已配置，推荐）**

仓库已包含 [.github/workflows/pages.yml](.github/workflows/pages.yml)，推送 `main` 即自动部署。
只需设置一次来源：

1. 仓库 **Settings → Pages**；
2. **Source** 选择 **GitHub Actions**；
3. 之后每次推送到 `main`，Actions 会自动把仓库根目录发布上线；
   也可在 **Actions → Deploy static site to GitHub Pages → Run workflow** 手动触发。

**方式 B：Deploy from a branch（不用 Actions 时的兜底方案）**

1. 仓库 **Settings → Pages**；
2. **Source** 选择 **Deploy from a branch**；
3. **Branch** 选 `main`，目录选 **`/ (root)`**；
4. 保存。

### 4.3 访问地址

```
https://<your-username>.github.io/<your-repo>/
```

首次部署需要 **1–3 分钟**。仓库 Settings → Pages 页面上会显示最终地址和部署状态。

### 4.4 遇到 404 时的排查顺序

1. Pages 是否已经开启（Settings → Pages 有绿色成功提示）；
2. **仓库可见性**：私有仓库发布 Pages 需要 GitHub **Pro/Team/Enterprise**；免费账号必须把仓库设为 **Public**，
   否则 Actions 里 `Configure Pages` 这一步会直接失败（表现为整个 workflow 红色 ✗）；
3. 是否访问了**带仓库名前缀的完整路径**（个人站是 `/<repo>/`，不要访问域名根）；
4. Actions 的最近一次运行是否成功（红色的 ✗ 点进去看日志）；
5. 文件名**大小写**是否一致（Pages 跑在大小写敏感的文件系统上，`Data/Entries.json` ≠ `data/entries.json`）；
6. 资源路径是否误用了**绝对路径**（`/assets/style.css` 会指向域名根导致 404，
   必须写成相对路径 `./assets/style.css`）；
7. 部署刚完成时 CDN 可能还没刷新，等 1 分钟再用**无痕窗口**试。

---

## 5. 缓存说明

GitHub Pages 会缓存静态资源。如果推送后页面/数据没变化：

- 用 **Ctrl+F5**（macOS：**Cmd+Shift+R**）强制刷新；
- 或开无痕窗口访问，排除本地缓存干扰；
- 数据文件本身以 `cache: 'no-cache'` 方式请求，正常刷新即可拿到最新数据。

---

## 6. 为什么是零依赖

- **离线可用**：没有任何 CDN / 外链字体 / 图标库，断网也能完整使用；
- **零维护**：没有 npm 依赖，不会因为依赖升级而构建失败；
- **可审计**：仓库里只有几个纯文本文件，任何时候都能读懂、随时能改。

因此仓库中**不应该出现** `package.json`、`node_modules/`、锁文件或构建产物目录；
若你的编辑器或工具生成了它们，它们已被 `.gitignore` 排除，不会被提交。

> 理财复盘板块的「▲ 三角」、日历圆点、「盈 / 亏」标记**全部用 CSS 画**，没有引入任何图标字体或图片。

---

## 7. 后续迭代路线

- **v1（已完成）**：日历 + 每日记录只读展示，手工编辑 JSON
- **v1.1（当前）**：多板块结构（首页 / 日历 / 理财复盘 / 预留板块）、日历双维度标记、理财复盘板块
- **v2**：站点内新增 / 编辑记录（localStorage 草稿 + 导入导出，或接入 GitHub API）
- **v3**：把占位板块做实（习惯打卡、健康），数据分文件、独立 schema、统计视图
- **v4+**：全文搜索、PWA 离线安装、主题与暗色模式等

详见 [docs/requirements.md](docs/requirements.md) 第 7 节与 [docs/design-v1.1.md](docs/design-v1.1.md)。
