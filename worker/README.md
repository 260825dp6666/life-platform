# 签到云同步（Cloudflare Workers + KV）

## 它解决什么问题

「高考总攻」板块的**每日签到**原本只存在浏览器 `localStorage` 里——换设备、清缓存都会丢。
本目录提供一个可选的云端同步后端，把签到记录存到 Cloudflare KV，多设备登录同一口令即可共享。

**未部署时站点行为不变**：签到仍只存本机，同步入口自动隐藏。

---

## 为什么需要 Worker（而不是直接用免费 JSON 服务）

纯静态站无法安全地在浏览器里直接写云端存储：

| 尝试 | 结果 |
|---|---|
| `jsonstorage.net` 免密创建 | 实测返回 `{"error":"Create operation requires API key."}`，文档宣称的「no authentication required」已过时 |
| JSONBin 前端直连 | 官方文档明确警告：前端暴露 Master Key 会让别人「carry any operation on your JSONBin records」 |
| GitHub API | 本机凭据是 `gho_` 开头的 OAuth token，写进网页等于把账号钥匙挂在公网 |

核心矛盾是：**写操作必然需要一个秘密，而站点是公开的**。Worker 把秘密留在服务端，
前端只持有一个可随时撤销、随时更换的同步口令。

---

## 目录结构

```
worker/
├── src/index.js           Worker 主逻辑（鉴权 / 读 / 签到 / 清空）
├── wrangler.toml.example  配置模板
└── wrangler.toml          你的实际配置（不入库，含 namespace id）
```

---

## 部署步骤

### 1. 注册 Cloudflare

打开 <https://dash.cloudflare.com/sign-up>，用邮箱注册即可，**免费额度**足够
（Workers 免费 10 万次/天，KV 免费 10 万次读/天 + 1000 次写/天）。

### 2. 登录 wrangler

```powershell
cd C:\Users\Agent\DSH\工作台\worker
npx wrangler login
```

浏览器会弹出授权页，点「Allow」。

### 3. 创建 KV 命名空间

```powershell
npx wrangler kv namespace create GAOKAO_CHECKINS
```

命令会返回一段配置，形如：

```toml
[[kv_namespaces]]
binding = "GAOKAO_CHECKINS"
id = "06779da6940b4319896cdc2930a66223"
```

### 4. 写好 wrangler.toml

把 `wrangler.toml.example` 复制为 `wrangler.toml`，并填入上一步的 `id`：

```toml
name = "life-platform-checkin-sync"
main = "src/index.js"
compatibility_date = "2026-10-11"

[[kv_namespaces]]
binding = "GAOKAO_CHECKINS"
id = "粘贴上一步返回的真实 id"

[observability]
enabled = false
```

### 5. 设置同步口令

```powershell
npx wrangler secret put SYNC_TOKEN
```

会提示输入，**自己定一个口令**（建议 12 位以上随机串）。
这串口令不写进任何文件，前端也不保存，只有你在浏览器里输入一次。

### 6. 部署

```powershell
npx wrangler deploy
```

成功后输出形如：

```
Uploaded life-platform-checkin-sync
Deployed life-platform-checkin-sync triggers
  https://life-platform-checkin-sync.<你的子域>.workers.dev
Current Version ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**记下这个地址**，下一步要用。

### 7. 填入站点并发布

打开 `assets/app.js`，把第 47 行的空字符串改成你的 Worker 地址：

```js
var GK_SYNC_ENDPOINT = 'https://life-platform-checkin-sync.<你的子域>.workers.dev';
```

提交推送，Pages 会自动重新部署：

```powershell
git add assets/app.js
git -c user.name=260825dp6666 -c user.email=dp6666@agent.qq.com commit -m "feat(gaokao): 接入签到云同步（Cloudflare Worker + KV）"
git push origin main
```

### 8. 在设备上配置口令

打开站点 → 高考总攻 → 签到区下方会出现「同步口令」输入框（此前隐藏），
填入第 5 步设置的口令，点「保存并同步」。

**每台新设备都要输入一次**，之后自动同步。

---

## 接口说明

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/` | 否 | 读取全部签到日期，返回 `{ok, days, total, updatedAt}` |
| POST | `/checkin` | 是 | 签到 `{date, token}`，**幂等**（同一天重复提交不重复计数） |
| POST | `/reset` | 是 | 清空全部记录，谨慎使用 |

鉴权方式二选一：请求头 `X-Sync-Token` 或 body 里的 `token` 字段。

---

## 数据与隐私

- 存储内容：**仅签到日期列表**（如 `["2026-10-05","2026-10-09"]`），不含任何个人信息。
- 不存：错题内容、学习进度、3500 词练习记录。
- 存放位置：Cloudflare 全球边缘网络，静态加密。
- 读取无需口令（日期不敏感），**但写入需要口令**。因为 KV 没有公开目录，
  知道地址也无法遍历。

---

## 常见问题

**Q：忘记口令了怎么办？**
重新执行 `npx wrangler secret put SYNC_TOKEN` 换一个，然后各设备重新输入。
**已有数据不会丢**——口令只控制访问，数据在 KV 里。

**Q：想清空签到记录？**
浏览器控制台执行 `fetch('你的Worker地址/reset', {method:'POST', headers:{'Content-Type':'application/json','X-Sync-Token':'你的口令'}, body:'{"token":"你的口令"}'})`，
或站点内操作。

**Q：免费额度够用吗？**
远远够。每人每天签到 1 次写入，1 万天也才 1 万次写入，远低于 KV 免费额度 1000 次/天。

**Q：Worker 免费吗？**
是。Workers 与 KV 在免费额度内不产生费用。

**Q：同步会拖慢签到吗？**
不会。签到先写本机（立即生效），再后台推送云端，云端失败也不影响本机记录。

---

## 本地调试

```powershell
cd worker
# 创建 .dev.vars，内容：SYNC_TOKEN=你的测试口令
npx wrangler dev --local --port 8787
```

本地模式下 KV 用内存模拟（进程重启即丢），适合验证接口逻辑。