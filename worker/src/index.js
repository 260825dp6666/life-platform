/**
 * 个人生活平台 · 签到同步 Worker
 * ------------------------------------------------------------------
 * 用途：把「每日签到」从浏览器本地存储搬到云端，实现多设备同步。
 *
 * 存储：Cloudflare KV（键 GAOKAO_CHECKINS，值为 JSON 数组）
 * 鉴权：一个自定义口令（环境变量 SYNC_TOKEN），客户端通过
 *       `X-Sync-Token` 请求头携带。
 *
 * 为什么需要它：纯静态站无法安全地在浏览器里直接写云端存储——
 * 任何写操作都需要一个秘密，而站点是公开的，密钥写进前端就等于
 * 公开。用 Worker 把密钥留在服务端，前端只拿一个可撤销的口令。
 *
 * 接口：
 *   GET  /          -> { ok, days:[...], total, updatedAt }
 *   POST /checkin   -> body { date:"YYYY-MM-DD", token }
 *                      幂等：同一天重复提交不重复计数
 *   POST /reset     -> body { token }   清空（谨慎）
 */

// GET /            -> { ok, days:[...], total, updatedAt }
// POST /checkin     -> body { date:"YYYY-MM-DD", token }
//                     幂等：同一天重复提交不重复计数
// POST /reset       -> body { token }   清空（谨慎）

const KEY = 'GAOKAO_CHECKINS';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 未绑定 KV 时的内存兜底，保证本地调试与误配置下依然可用。
 * 生产环境必须绑定 KV，否则进程重启即丢数据。
 */
const memory = { days: [], updatedAt: null };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

/** 校验一个日期是否真实存在于公历（防 2026-02-30 这类假日期） */
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function authorized(req, tokenFromBody, env) {
  var expected = env && env.SYNC_TOKEN ? String(env.SYNC_TOKEN) : '';
  if (!expected) return false;
  var provided = req.headers.get('X-Sync-Token') || tokenFromBody || '';
  return provided === expected;
}

async function readDays(env) {
  var ns = env && env[KEY];
  if (!ns) {
    return { days: memory.days.slice(), updatedAt: memory.updatedAt, memory: true };
  }
  var raw = await ns.get(KEY, 'json');
  if (!raw) return { days: [], updatedAt: null };
  var days = Array.isArray(raw.days) ? raw.days.filter(function (d) { return DATE_RE.test(d); }) : [];
  return { days: days, updatedAt: raw.updatedAt || null };
}

async function writeDays(env, days, updatedAt) {
  var ns = env && env[KEY];
  var sorted = Array.from(new Set(days)).sort();
  if (!ns) {
    memory.days = sorted;
    memory.updatedAt = updatedAt;
    return sorted;
  }
  await ns.put(KEY, JSON.stringify({ days: sorted, updatedAt: updatedAt }));
  return sorted;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return json({ ok: true });

    // ---- 读取签到记录（无需鉴权，数据本身不含隐私） ----
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/checkins')) {
      const { days, updatedAt } = await readDays(env);
      return json({ ok: true, days, total: days.length, updatedAt });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: '仅支持 GET / POST' }, 405);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
    }

    if (!authorized(request, body.token, env)) {
      return json({ ok: false, error: '口令不正确' }, 401);
    }

    // ---- 签到 ----
    if (url.pathname === '/checkin') {
      const date = String(body.date || '');
      if (!isRealDate(date)) {
        return json({ ok: false, error: '日期格式不正确或不是真实公历日：' + date }, 400);
      }
      const { days } = await readDays(env);
      if (days.indexOf(date) !== -1) {
        return json({ ok: true, already: true, days, total: days.length });
      }
      const updatedAt = new Date().toISOString();
      const saved = await writeDays(env, days.concat([date]), updatedAt);
      return json({ ok: true, already: false, days: saved, total: saved.length, updatedAt });
    }

    // ---- 清空 ----
    if (url.pathname === '/reset') {
      const saved = await writeDays(env, [], new Date().toISOString());
      return json({ ok: true, days: saved, total: 0 });
    }

    return json({ ok: false, error: '未知路径：' + url.pathname }, 404);
  },
};