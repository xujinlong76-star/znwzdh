/**
 * `check-rate-limit-exemption.mjs` 的取数与判定层（单独成文件只为了能被单测驱动：
 * 判定逻辑要对着「假中枢 + 假前端」跑，而不是一台真预览站）。
 */

import { sitemapEntries } from '../check-isr-routes.mjs';

const DEFAULTS = {
  apiBase: 'http://127.0.0.1:8787',
  webBase: 'http://localhost:3000',
  tokenEnv: 'NAVHUB_INTERNAL_TOKEN',
  hammer: '60',
  pages: '20',
  minMiss: '8',
  timeout: '15000',
  // 首趟全是 HIT 时，等过 revalidate 窗口再逼一次真·重渲染（秒）。0 = 关闭复探。
  // 默认 75 > 收录页的 revalidate=60（site/[id]/page.tsx:52），留出时钟抖动。
  grace: '75',
  // STALE 只是「触发了后台再生」，成没成功要等一等再看（秒）。
  settle: '5',
};

export function argvParse(argv) {
  const valueOf = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const num = (name, dflt) => {
    const n = Number(valueOf(name) ?? dflt);
    return Number.isFinite(n) && n > 0 ? n : Number(dflt);
  };
  // 允许显式 0 的数值项（0 在这里是「关掉这一步」的语义，不是缺省）
  const numZero = (name, dflt) => {
    const raw = valueOf(name);
    if (raw === null) return Number(dflt);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : Number(dflt);
  };
  const trim = (s) => String(s).replace(/\/+$/, '');
  return {
    apiBase: trim(valueOf('api-base') ?? DEFAULTS.apiBase),
    webBase: trim(valueOf('web-base') ?? DEFAULTS.webBase),
    tokenEnv: valueOf('token-env') ?? DEFAULTS.tokenEnv,
    hammer: num('public-hammer', DEFAULTS.hammer),
    pages: num('pages', DEFAULTS.pages),
    minMiss: num('min-miss', DEFAULTS.minMiss),
    timeoutMs: num('timeout', DEFAULTS.timeout),
    graceSec: numZero('revalidate-grace', DEFAULTS.grace),
    settleSec: numZero('revalidate-settle', DEFAULTS.settle),
  };
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchOnce(url, { headers = {}, method = 'GET', timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': 'NavHub-RateLimit-Check/1.0', ...headers },
      redirect: 'manual',
      signal: controller.signal,
    });
    // 只在「正文本身就是证据」时读体：HTML 用来判壳，XML 用来取 sitemap 条目。
    // 429/5xx 的响应体不是证据，读它只会把无关内容带进日志。
    const contentType = res.headers.get('content-type') ?? '';
    const text =
      res.ok && (/text\/html/i.test(contentType) || /application\/(xml|json)/i.test(contentType))
        ? await res.text()
        : '';
    return {
      status: res.status,
      cacheState: res.headers.get('x-nextjs-cache') ?? '',
      body: text,
    };
  } catch (err) {
    return { status: 0, cacheState: '', body: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 串行打满一个额度窗口。
 *
 * 为什么不并发：并发时「第几次开始 429」取决于调度，日志里的数字没有意义，
 * 而这条检查的全部价值就在那个数字上。串行慢一点，但 CI 里就几十次请求。
 */
export async function hammer(url, { count, headers = {}, timeoutMs = 15000 } = {}) {
  const statuses = new Map();
  let status429 = 0;
  let otherNon2xx = 0;
  let first429At = null;
  for (let i = 1; i <= count; i += 1) {
    const r = await fetchOnce(url, { headers, timeoutMs });
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    if (r.status === 429) {
      status429 += 1;
      if (first429At === null) first429At = i;
    } else if (r.status < 200 || r.status >= 300) {
      otherNon2xx += 1;
    }
  }
  return { statuses, status429, otherNon2xx, first429At };
}

export function summarizeStatuses(statuses) {
  return [...statuses.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, n]) => `${code}×${n}`)
    .join(' ') || '无响应';
}

/**
 * 经 web 层抓收录页：这是「壳」唯一能被观察到的地方（中枢侧只看状态码）。
 * 壳的判据与 --live 门禁同一把尺：200 + 自己声明 noindex，或 200 但正文没有 <h1>。
 *
 * 这里**刻意不带**内部凭据：凭据是 web 的 SSR 取数层自己加的（lib/server/hub.ts），
 * 脚本扮的是爬虫/浏览器。带上它就等于把「豁免是否只作用于服务端取数」这件事测没了。
 */
export async function probePage(opts) {
  const out = {
    sitemapPaths: 0,
    total: 0,
    ok200: 0,
    shells: 0,
    badStatus: 0,
    badStatusList: [],
    miss: 0,
  };
  const sitemap = await fetchOnce(`${opts.webBase}/sitemap.xml`, { timeoutMs: opts.timeoutMs });
  if (sitemap.status !== 200) {
    out.error = `sitemap.xml HTTP ${sitemap.status}`;
    return out;
  }
  const paths = [
    ...new Set(
      sitemapEntries(sitemap.body)
        .map((e) => e.path)
        .filter((p) => p.startsWith('/site/')),
    ),
  ];
  out.sitemapPaths = paths.length;
  // 取尾部而非头部：CI 的 --live 门禁固定抽族内前几个（不带 --rotate 时），
  // 尾部那些页更可能还没被任何一轮缓存命中过，才是真正的「现渲染」。
  const sample = paths.slice(-Math.min(opts.pages, paths.length));
  out.sample = sample;
  for (const path of sample) {
    const r = await fetchOnce(`${opts.webBase}${path}`, { timeoutMs: opts.timeoutMs });
    out.total += 1;
    if (r.status === 200) {
      out.ok200 += 1;
      const shell = /noindex/i.test(r.body) || !/<h1[\s>]/i.test(r.body);
      if (shell) out.shells += 1;
      if (!/^(HIT|STALE)$/i.test(r.cacheState)) out.miss += 1;
    } else {
      out.badStatus += 1;
      if (out.badStatusList.length < 3) out.badStatusList.push(`${path} → ${r.status}`);
    }
  }
  return out;
}

/**
 * 对**已知**的一批路径复探一次，逐页留底（阶段 3b 的状态机判据要用页与页之间的对照）。
 * 判壳的尺和 probePage 同一把，不另立标准。
 */
export async function probeSet(opts, paths) {
  const out = [];
  for (const path of paths) {
    const r = await fetchOnce(`${opts.webBase}${path}`, { timeoutMs: opts.timeoutMs });
    out.push({
      path,
      status: r.status,
      cacheState: r.cacheState,
      shell: r.status === 200 && (/noindex/i.test(r.body) || !/<h1[\s>]/i.test(r.body)),
    });
  }
  return out;
}

/**
 * 阶段 3b 的判据：把「过期后到底有没有再生成成功」读成一个数。
 *
 * Next 的 ISR 在 revalidate 到期后先给旧快照（STALE）并**在后台**再生，
 * 而后台再生失败时旧数据原样保留 —— 所以只看一趟头部分不清
 * 「豁免真的在取数路径上起了作用」和「取数被 429 挡住、一直在保旧」。
 * 因此：一趟里同步产出（MISS/无头部）算证据；只触发（STALE）的要等一等再看，
 * 复探回到 HIT 才算再生成功；仍是 STALE/MISS 空的就是失败。
 */
export function countRegenerated(first, second) {
  const again = new Map((second ?? []).map((r) => [r.path, r]));
  let ok = 0;
  let keptStale = 0;
  let shells = 0;
  for (const r of first) {
    if (/^(HIT)$/i.test(r.cacheState)) continue; // 没过期 ⇒ 这一页没参与再生
    if (r.shell) shells += 1;
    if (!/^(STALE)$/i.test(r.cacheState)) {
      ok += 1; // MISS / PRODUCED / 空：同步重渲染，直接就是证据
      continue;
    }
    const next = again.get(r.path);
    if (next && /^HIT$/i.test(next.cacheState)) ok += 1;
    else {
      keptStale += 1;
      if (next?.shell) shells += 1;
    }
  }
  return { ok, keptStale, shells };
}
