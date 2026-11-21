#!/usr/bin/env node
/**
 * codeql-triage.mjs — CodeQL 警报一键全景盘点
 *
 * 用途：拉取本仓库全部 state=open 的 CodeQL 警报，按三维度分组统计，
 * 输出 Markdown 审计报告，让人用 20% 工作量批量清掉 80% 同类重复警报。
 *
 * 用法：
 *   node scripts/codeql-triage.mjs [--repo owner/repo] [--out report.md] [--dependabot]
 *
 *   --repo        目标仓库，默认 xujinlong76-star/znwzdh
 *   --out         把 Markdown 报告写入该文件（同时打印到 stdout）
 *   --dependabot  额外拉取 Dependabot 警报并附在报告末尾
 *
 * 认证（按顺序取第一个可用的，令牌绝不打印）：
 *   1. 环境变量 GH_TOKEN 或 GITHUB_TOKEN
 *   2. `gh auth token`（gh CLI 已登录时）
 *   3. git credential store（`git credential fill` 取 host=github.com 的 password，
 *      即本机细粒度 PAT muse-vm-push）
 *
 * 权限要求（缺了会 403，脚本会把缺失项写进报告、绝不编造数字）：
 *   - 细粒度 PAT：仓库权限「Code scanning alerts: Read」
 *     （Dependabot 另需「Dependabot alerts: Read」）
 *   - 经典 PAT：scope `security_events: read`
 *   本机 PAT（muse-vm-push，仅 Contents 读写）目前缺这两项，见报告末尾的
 *   「权限缺口」一节；补权限后重跑即可出真实数字。
 *
 * 依赖：Node >= 18（全局 fetch），零第三方依赖。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO_DEFAULT = 'xujinlong76-star/znwzdh';
const API = 'https://api.github.com';

// ---------------------------------------------------------------- token ----
function tokenFromEnv() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function tokenFromGh() {
  try {
    const out = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } catch {
    return '';
  }
}

function tokenFromGitCredential() {
  try {
    const input = 'protocol=https\nhost=github.com\n';
    const out = execFileSync('git', ['credential', 'fill'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const m = out.match(/^password=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function resolveToken() {
  const fromEnv = tokenFromEnv();
  if (fromEnv) return { token: fromEnv, source: 'GH_TOKEN/GITHUB_TOKEN 环境变量' };
  const fromGh = tokenFromGh();
  if (fromGh) return { token: fromGh, source: 'gh auth token' };
  const fromGit = tokenFromGitCredential();
  if (fromGit) return { token: fromGit, source: 'git credential store（本机细粒度 PAT）' };
  return { token: '', source: '' };
}

// ------------------------------------------------------------- fetching ----
async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'znwzdh-codeql-triage',
    },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, headers: res.headers, body, text };
}

function nextPageLink(headers) {
  const link = headers.get('link') || '';
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/** 拉取全部 open 警报；返回 { alerts } 或 { error }（不抛错，调用方写进报告）。 */
async function fetchAllAlerts(repo, token, kind) {
  const path = kind === 'dependabot'
    ? `/repos/${repo}/dependabot/alerts?state=open&per_page=100`
    : `/repos/${repo}/code-scanning/alerts?state=open&per_page=100`;
  const alerts = [];
  let url = API + path;
  while (url) {
    const { status, headers, body, text } = await fetchJson(url, token);
    if (status === 403) {
      return { error: { status, kind: 'forbidden', message: (body && body.message) || text.slice(0, 200) } };
    }
    if (status === 404) {
      return { error: { status, kind: 'not-found', message: (body && body.message) || text.slice(0, 200) } };
    }
    if (status === 401) {
      return { error: { status, kind: 'unauthorized', message: (body && body.message) || text.slice(0, 200) } };
    }
    if (status !== 200 || !Array.isArray(body)) {
      return { error: { status, kind: 'unexpected', message: (body && body.message) || text.slice(0, 200) } };
    }
    alerts.push(...body);
    url = nextPageLink(headers);
  }
  return { alerts };
}

// ----------------------------------------------------------- categorizing --
/** 文件归属分类：生产代码 / 脚本工具 / 测试用例 / 其他。 */
function categorizeFile(path) {
  if (!path) return 'other';
  const p = path.toLowerCase();
  const isTest = /(^|\/)(test|__tests__)\//.test(p)
    || /\.test\.[cm]?[jt]sx?$/.test(p)
    || /\.spec\.[cm]?[jt]sx?$/.test(p);
  if (isTest) return 'test';
  if (p.startsWith('scripts/')) return 'scripts';
  if (p.startsWith('apps/') || p.startsWith('packages/') || p.startsWith('extensions/')) return 'production';
  return 'other';
}

const CATEGORY_LABEL = {
  production: '生产代码（apps/、packages/、extensions/）',
  scripts: '脚本工具（scripts/）',
  test: '测试用例（*.test.*、test/）',
  other: '其他',
};

function groupCount(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function mdTable(rows, headers) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

// ---------------------------------------------------------------- report ---
function buildReport({ repo, fetchedAt, alerts, error, tokenSource, dependabot }) {
  const lines = [];
  lines.push(`# CodeQL 警报全景盘点 — ${repo}`);
  lines.push('');
  lines.push(`- 盘点时间：${fetchedAt}`);
  lines.push(`- 认证来源：${tokenSource || '（未找到令牌）'}`);
  lines.push(`- 数据来源：GitHub REST API \`GET /repos/${repo}/code-scanning/alerts?state=open\``);
  lines.push('');

  if (error) {
    lines.push('## ⚠️ 本次未取到真实警报数据（权限缺口，非 0 条）');
    lines.push('');
    lines.push(`- API 返回：HTTP ${error.status}（${error.kind}）`);
    lines.push(`- 报错原文：\`${error.message}\``);
    lines.push('- 含义：本机令牌没有读 CodeQL 警报的权限，**不是警报已清零**。');
    lines.push('');
    lines.push('### 补权限后重跑');
    lines.push('');
    lines.push('1. 细粒度 PAT（推荐，仓库级最小权限）：GitHub → Settings → Developer settings →');
    lines.push('   Personal access tokens → Fine-grained tokens → 选中本机 PAT → Repository permissions →');
    lines.push('   **Code scanning alerts: Read-only**（Dependabot 另需 **Dependabot alerts: Read-only**）→ Save。');
    lines.push('2. 或经典 PAT：建 token 时勾选 scope **`security_events: read`**。');
    lines.push('3. 重跑：`node scripts/codeql-triage.mjs --out docs/security/codeql-triage-report-YYYY-MM-DD.md`');
    lines.push('');
    lines.push('> 以下分组统计为空是因为本次未取到数据，**不是真实数字**。补权限后重跑，本节会被真实统计替换。');
    lines.push('');
    lines.push('## 严重程度分布');
    lines.push('');
    lines.push('（未取到数据）');
    lines.push('');
    lines.push('## 规则 ID Top 重复项');
    lines.push('');
    lines.push('（未取到数据）');
    lines.push('');
    lines.push('## 文件归属分类');
    lines.push('');
    lines.push('（未取到数据）');
    lines.push('');
    if (dependabot) {
      lines.push('## Dependabot 警报');
      lines.push('');
      lines.push(`（${dependabot.error ? `未取到：HTTP ${dependabot.error.status}，${dependabot.error.message}` : `共 ${dependabot.alerts.length} 条` }）`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push('脚本：`scripts/codeql-triage.mjs`（零第三方依赖，Node >= 18）。');
    return lines.join('\n');
  }

  const total = alerts.length;
  lines.push(`## 总览`);
  lines.push('');
  lines.push(`- **open 警报总数：${total} 条**`);
  lines.push('');

  // 严重程度
  const bySeverity = groupCount(alerts, (a) => (a.rule && a.rule.security_severity_level) || 'unknown');
  lines.push('## 严重程度分布');
  lines.push('');
  lines.push(mdTable(bySeverity.map(([sev, n]) => [sev, String(n), `${((n / total) * 100).toFixed(1)}%`]), ['严重程度', '条数', '占比']));
  lines.push('');

  // 规则 ID
  const byRule = groupCount(alerts, (a) => (a.rule && a.rule.id) || 'unknown');
  lines.push('## 规则 ID Top 重复项（80/20：先清 Top 项）');
  lines.push('');
  lines.push(mdTable(byRule.slice(0, 20).map(([rule, n], i) => [String(i + 1), `\`${rule}\``, String(n), `${((n / total) * 100).toFixed(1)}%`]), ['#', '规则 ID', '条数', '占比']));
  lines.push('');
  const top5 = byRule.slice(0, 5).reduce((s, [, n]) => s + n, 0);
  lines.push(`> Top 5 规则合计 ${top5} 条，占总数 ${((top5 / total) * 100).toFixed(1)}%。先修这 5 类，等于清掉大半重复警报。`);
  lines.push('');

  // 文件归属
  const byCategory = groupCount(alerts, (a) => categorizeFile(a.most_recent_instance && a.most_recent_instance.location && a.most_recent_instance.location.path));
  lines.push('## 文件归属分类');
  lines.push('');
  lines.push(mdTable(byCategory.map(([cat, n]) => [CATEGORY_LABEL[cat] || cat, String(n), `${((n / total) * 100).toFixed(1)}%`]), ['分类', '条数', '占比']));
  lines.push('');
  lines.push('> 清零顺序建议：生产代码优先（真实风险）→ 脚本工具 → 测试用例（多为断言写法问题，见 codeql-config 说明）。');
  lines.push('');

  // 严重 × 分类交叉
  lines.push('## 严重程度 × 文件分类（定位高危生产代码）');
  lines.push('');
  const cross = new Map();
  for (const a of alerts) {
    const sev = (a.rule && a.rule.security_severity_level) || 'unknown';
    const cat = categorizeFile(a.most_recent_instance && a.most_recent_instance.location && a.most_recent_instance.location.path);
    const k = `${sev} / ${CATEGORY_LABEL[cat] || cat}`;
    cross.set(k, (cross.get(k) || 0) + 1);
  }
  lines.push(mdTable([...cross.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, String(n)]), ['组合', '条数']));
  lines.push('');

  // 明细（按规则聚类，便于批量修）
  lines.push('## 明细（按规则 ID 聚类，同一规则放一起修）');
  lines.push('');
  for (const [rule] of byRule) {
    const items = alerts.filter((a) => ((a.rule && a.rule.id) || 'unknown') === rule);
    lines.push(`### \`${rule}\`（${items.length} 条）`);
    lines.push('');
    for (const a of items) {
      const loc = a.most_recent_instance && a.most_recent_instance.location;
      const where = loc ? `${loc.path}:${loc.start_line || ''}` : '（无位置）';
      const sev = (a.rule && a.rule.security_severity_level) || 'unknown';
      lines.push(`- [#${a.number}](${a.html_url}) \`${where}\` — ${sev}`);
    }
    lines.push('');
  }

  if (dependabot) {
    lines.push('## Dependabot 警报');
    lines.push('');
    if (dependabot.error) {
      lines.push(`未取到：HTTP ${dependabot.error.status}，${dependabot.error.message}`);
    } else {
      lines.push(`共 ${dependabot.alerts.length} 条 open 漏洞：`);
      lines.push('');
      for (const d of dependabot.alerts) {
        const pkg = d.dependency && d.dependency.package ? d.dependency.package.name : 'unknown';
        const sev = (d.security_advisory && d.security_advisory.severity) || 'unknown';
        const ghsa = (d.security_advisory && d.security_advisory.ghsa_id) || '';
        lines.push(`- [#${d.number}](${d.html_url}) \`${pkg}\` — ${sev} ${ghsa}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('脚本：`scripts/codeql-triage.mjs`（零第三方依赖，Node >= 18）。');
  return lines.join('\n');
}

// ------------------------------------------------------------------ main ---
function parseArgs(argv) {
  const opts = { repo: REPO_DEFAULT, out: '', dependabot: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) opts.out = argv[++i];
    else if (argv[i] === '--dependabot') opts.dependabot = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node scripts/codeql-triage.mjs [--repo owner/repo] [--out report.md] [--dependabot]');
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { token, source } = resolveToken();
  if (!token) {
    console.error('找不到 GitHub 令牌：请设置 GH_TOKEN，或 gh auth login，或在 git credential store 里存 PAT。');
    process.exit(2);
  }
  const fetchedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' CST';
  const res = await fetchAllAlerts(opts.repo, token, 'code-scanning');
  let dependabot = null;
  if (opts.dependabot) {
    dependabot = await fetchAllAlerts(opts.repo, token, 'dependabot');
  }
  const report = buildReport({
    repo: opts.repo,
    fetchedAt,
    alerts: res.alerts || [],
    error: res.error || null,
    tokenSource: source,
    dependabot,
  });
  console.log(report);
  if (opts.out) {
    writeFileSync(opts.out, report, 'utf8');
    console.error(`\n报告已写入 ${opts.out}`);
  }
  if (res.error) process.exit(3);
}

main().catch((err) => {
  console.error('盘点脚本异常：', err && err.message ? err.message : err);
  process.exit(1);
});
