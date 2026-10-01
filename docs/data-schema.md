# 数据格式定义 — `data/entries.json`

- 版本：v1.0（对应平台 v1）
- 状态：**权威定义**。实现、示例数据与校验规则一律以本文档为准。
- 上位文档：`docs/requirements.md`

---

## 1. 文件位置与用途

| 项 | 值 |
|---|---|
| 路径 | `data/entries.json`（相对仓库根，**大小写敏感**） |
| 引用方式 | `./data/entries.json`（前端必须使用相对路径，见 requirements 第 5 节） |
| 编码 | UTF-8 **无 BOM** |
| 用途 | v1 全站的**唯一**数据来源；前端只读 |
| 写入方 | v1 由人工手工编辑；前端不得写入 |

---

## 2. JSON Schema

### 2.1 顶层结构

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.local/life-platform/entries.schema.json",
  "title": "LifePlatformEntries",
  "type": "object",
  "required": ["schemaVersion", "entries"],
  "additionalProperties": true,
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "minimum": 1,
      "description": "数据结构版本号，v1 固定为 1。新增不兼容字段时递增。"
    },
    "updatedAt": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
      "description": "可选。数据最后手工编辑日期，YYYY-MM-DD。仅用于页脚展示。"
    },
    "entries": {
      "type": "array",
      "description": "每日记录条目列表。v1 允许为空数组。",
      "items": { "$ref": "#/$defs/entry" }
    }
  },
  "$defs": {
    "entry": {
      "type": "object",
      "required": ["date", "title"],
      "additionalProperties": true,
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "记录日期，本地日历日期，YYYY-MM-DD。必须是真实存在的公历日期。"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "记录标题，单行，不可为空。"
        },
        "note": {
          "type": "string",
          "maxLength": 5000,
          "default": "",
          "description": "备注正文。可多行（JSON 中写为 \\n）。允许为空字符串或省略。"
        },
        "tags": {
          "type": "array",
          "maxItems": 12,
          "default": [],
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20,
            "pattern": "^[^\\s#]+$"
          },
          "description": "标签列表。不带 # 前缀，无空白字符。省略等价于空数组。"
        }
      }
    }
  }
}
```

### 2.2 字段说明表

| 字段 | 层级 | 必填 | 类型 | 约束 | 缺省行为 |
|---|---|---|---|---|---|
| `schemaVersion` | 顶层 | ✅ | integer | v1 固定 `1` | 缺失 → 视为数据格式不符预期，仍按 0 条渲染并提示 |
| `updatedAt` | 顶层 | ❌ | string | `YYYY-MM-DD` | 缺失 → 页脚不显示更新日期 |
| `entries` | 顶层 | ✅ | array | 元素为 entry | 缺失或非数组 → 视为 0 条记录 + 提示「数据格式不符合预期」 |
| `date` | entry | ✅ | string | `YYYY-MM-DD`，必须真实存在 | 非法 → **跳过该条**并 `console.warn` |
| `title` | entry | ✅ | string | 1–120 字符，单行 | 缺失/空 → **跳过该条**并 `console.warn` |
| `note` | entry | ❌ | string | ≤5000 字符，可多行 | 缺失 → 面板不渲染备注区 |
| `tags` | entry | ❌ | array\<string\> | ≤12 个，每个 1–20 字符，不含 `#` 与空白 | 缺失 → 视作 `[]`，面板不渲染标签区 |

### 2.3 约定与约束

1. **日期是本地日历日期，不含时区信息。** 严禁写成 `2025-06-14T00:00:00Z` 或 `2025/06/14`。
   前端**禁止**用 `new Date("2025-06-14")` 做日期比较——该写法在不同引擎中存在 UTC 解析差异，必须按字符串或按 `(year, month-1, day)` 本地构造 `Date` 处理。
2. **同一天允许多条记录。** 不要求唯一；v1 按数组顺序展示，不排序。
3. **数组顺序即展示顺序。** 建议人工维护时按日期升序追加，便于阅读；前端不得依赖该顺序做逻辑。
4. **`schemaVersion` 为整数**，不是字符串 `"1"`。
5. **顶层与 entry 均允许额外字段**（`additionalProperties: true`），便于后续演进；v1 前端忽略未知字段。
6. **文件保持纯 JSON**，不得包含注释、尾随逗号、单引号字符串。
7. 若某日期在 `entries` 中不存在 → 该日为**空日**，面板显示空态文案（见 requirements 3.2 C）。

---

## 3. 示例数据（可直接复制的完整文件）

以下为 `data/entries.json` 的**完整、合法**示例，共 **6 条**记录，覆盖 4 个日期，其余日期为空日，符合 v1 验收项 A12。

```json
{
  "schemaVersion": 1,
  "updatedAt": "2025-06-15",
  "entries": [
    {
      "date": "2025-06-01",
      "title": "开始记录生活",
      "note": "搭建了个人生活平台的第一版。\n目标是每天写一点，哪怕只有一句话。",
      "tags": ["生活", "里程碑"]
    },
    {
      "date": "2025-06-01",
      "title": "整理书桌",
      "note": "把散落的资料归档到三个文件夹：工作、学习、生活。",
      "tags": ["整理"]
    },
    {
      "date": "2025-06-14",
      "title": "晨跑 5 公里",
      "note": "配速 6'10\"，天气多云，感觉比上周轻松不少。",
      "tags": ["健康", "运动"]
    },
    {
      "date": "2025-06-14",
      "title": "读《人月神话》30 页",
      "note": "「向进度落后的项目中增加人手，只会让进度更加落后。」",
      "tags": ["阅读", "软件工程"]
    },
    {
      "date": "2025-06-15",
      "title": "和家人视频通话",
      "note": "聊了一个小时，说好下个月回去一趟。",
      "tags": ["家人"]
    },
    {
      "date": "2025-06-20",
      "title": "季度复盘",
      "note": "三件事做成了：记录习惯、每周运动 3 次、读完 2 本书。",
      "tags": ["复盘", "目标"]
    }
  ]
}
```

### 3.1 示例覆盖情况说明（用于验收 A4 / A5 / A6 / A12）

| 日期 | 条目数 | 用于验证的展示情形 |
|---|---|---|
| `2025-06-01` | 2 | **有记录 · 多条目**：面板需列出两条，顺序与数组中一致 |
| `2025-06-14` | 2 | **有记录 · 多条目**：验证备注含引号、含长文本 |
| `2025-06-15` | 1 | **有记录 · 单条目**：验证单条渲染 |
| `2025-06-20` | 1 | **有记录 · 单条目**：验证月末日期 |
| `2025-06-02` ~ `2025-06-13`、`2025-06-16` ~ `2025-06-19`、`2025-06-21` ~ `2025-06-30` | 0 | **空日**：面板显示空态文案，且不残留上一天内容 |
| `2025-06` 以外所有月份 | 0 | **整月空**：翻月后日历无标记点，面板为空态 |

### 3.2 最小合法文件（边界示例）

`entries` 允许为空数组，此时页面应正常渲染并全部显示为空日：

```json
{
  "schemaVersion": 1,
  "entries": []
}
```

### 3.3 单条最小合法记录（省略可选字段）

```json
{
  "date": "2025-07-01",
  "title": "新的一月"
}
```

解析结果等价于：`note = ""`、`tags = []`。

---

## 4. 解析与降级规则（实现必须遵守）

按顺序执行：

1. `fetch('./data/entries.json')`
   - 抛错或 HTTP 非 2xx → 记录面板显示「数据加载失败」，页脚显示原因摘要，**日历仍可用**。
2. `JSON.parse(responseText)`
   - 抛错 → 提示「**数据文件格式错误**」，日历仍可用（全月无标记）。
3. 校验顶层：
   - 非对象，或 `entries` 不存在 / 不是数组 → 视作 0 条，提示「数据格式不符合预期」。
   - `schemaVersion` 缺失或不是整数 → `console.warn`，但继续按 v1 解析（向前兼容）。
4. 逐条校验 entry（**单条失败不影响其他条目**）：
   - `date` 不匹配 `^\d{4}-\d{2}-\d{2}$` 或不是真实公历日期 → 跳过并 `console.warn`，警告文案需含该条目在数组中的下标。
   - `title` 缺失或非字符串或去除首尾空白后为空 → 跳过并 `console.warn`。
   - `note` 非字符串 → 视为 `""`（不跳过）。
   - `tags` 非数组 → 视为 `[]`；数组内非字符串或空串元素 → 过滤掉该元素（不跳过整条）。
5. 校验通过的条目按 `date` 建立索引：`Map<string, entry[]>`，值保持原数组相对顺序。
6. 若加载后有效条目数为 0 且原始 `entries` 长度 > 0 → 控制台额外输出一条汇总警告（说明全部条目均被跳过）。

> 任何情况下**不得**因为数据问题导致整页白屏或抛出未捕获异常（验收 A14）。

---

## 5. 校验清单（人工审查用）

对任何一份 `entries.json`，逐项确认：

- [ ] 文件以 `{` 开头、以 `}` 结尾，UTF-8 无 BOM
- [ ] `schemaVersion` 存在且为整数 `1`
- [ ] `entries` 存在且为数组
- [ ] 每个元素都有 `date` 和 `title`
- [ ] 所有 `date` 均为 `YYYY-MM-DD` 且真实存在（注意闰年 2 月 29 日）
- [ ] 无尾随逗号（最后一个数组元素 / 对象属性后）
- [ ] 所有字符串使用双引号
- [ ] 换行写作 `\n`，双引号写作 `\"`
- [ ] `tags` 内元素不带 `#`、无空白、无重复
- [ ] 至少包含 3 条示例记录（v1 验收 A12）

可用的本地语法检查（任选其一）：

```
python -c "import json;json.load(open('data/entries.json',encoding='utf-8'));print('OK')"
```
```
node -e "JSON.parse(require('fs').readFileSync('data/entries.json','utf8'));console.log('OK')"
```

---

## 6. 版本演进约定

| schemaVersion | 变更 | 兼容性 |
|---|---|---|
| 1 | 初始版本：`schemaVersion` / `updatedAt` / `entries[date,title,note,tags]` | — |
| 2（v2 迭代，尚未定义） | 预计新增 `id`、`createdAt`、`updatedAt`（条目级）等可选字段 | **向后兼容**：v1 读取端忽略未知字段，仍可工作；无需递增 `schemaVersion` |
| 3（v3 迭代，尚未定义） | 多模块拆分为 `data/habits.json`、`data/health.json`、`data/finance.json`，各自独立 `schemaVersion` | 迁移方案在 v3 阶段单独定义 |

**递增 `schemaVersion` 的触发条件**：删除了既有字段、改变了既有字段的语义或类型、或将可选字段改为必填字段。仅新增可选字段**不**递增版本。

---

## 7. 相关文档（v1.1 增量）

v1.1（多板块 + 理财复盘）**未改动本文档定义的 `entries.json` 格式**，`schemaVersion` 仍为 `1`。

- 新增的数据文件 `data/finance.json`（理财复盘）使用**独立 schema**，字段定义见
  [`design-v1.1.md`](design-v1.1.md) 第 6.2 节。
- 页面结构、板块路由、日历双维度标记（圆点 = 生活记录、▲ = 理财复盘）等设计约束见
  [`design-v1.1.md`](design-v1.1.md)。
- 本文档第 3 节对 `entries.json` 的所有校验规则**继续有效**，前端对两个数据文件采用同样的
  「逐条跳过无效数据 + `console.warn` 提示 + 不白屏」容错策略。
