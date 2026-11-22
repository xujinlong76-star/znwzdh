/**
 * 搜索引擎前缀直达：登录墙化 URL 不得回流（2026-11-17 P1-4）。
 *
 * 实测结论（curl，本机出口，q=react）：
 * - Libraries.io !librariesio：https://libraries.io/search?q={q} 200 落
 *   https://libraries.io/login —— 登录页，替换为 Deps.dev（Google 开源依赖洞察，
 *   https://deps.dev/search?q={q} 200，标题 Open Source Insights，无登录词）。
 * - You.com !you：https://you.com/search?q={q} 200 落
 *   https://you.com/signin?redirectUrl=%2Fsearch%3Fq%3Dreact —— 登录页，替换为
 *   Qwant（https://www.qwant.com/?q={q} 200，标题 react – Qwant Search）。
 * - 大众点评 !dianping：https://www.dianping.com/search/keyword/1/0_{q} 200 落
 *   https://account.dianping.com/pclogin —— 登录页；移动端 m.dianping.com 同样落
 *   mlogin；美团 web 搜索 https://www.meituan.com/s/{q} 已在 Q-16～Q-19 证实 404 且
 *   进 RETIRED 清单，i.meituan.com 落 verify.meituan.com 验证码墙——无可 curl 核实的
 *   免登录替代地址，按任务要求只删不换：引擎已下掉，中文生活包 37→36 个引擎，
 *   组合包描述里的 37/75/77 已同步改为 36/74/76。
 * - CNKI !cnki：kns.cnki.net:443 本机出口 TLS 后空回复（000，两次复核；同出口
 *   www.cnki.net 302 正常，系 kns 主机层面的出口不可达，非全站宕机）；替换为同库官方
 *   海外版 https://oversea.cnki.net/kns8s/defaultresult/index?kw={q}（200，标题
 *   Search-CNKI，48KB 结果页，无登录词），引擎与 !cnki 前缀保留。
 * - Gemini !gemini：gemini.google.com 本机出口全路径 000（主页亦 000，google.com
 *   正常 302，系该主机出口不可达）；且 Google 官方帮助明确未登录仅能用部分功能，
 *   完整功能/保存活动须 Google 账号登录，?q= 直达问答不在匿名可用范围内。替换为
 *   Duck.ai（https://duck.ai/?q={q} 200，标题 Duck.ai by DuckDuckGo. Private AI
 *   chat. Free.，匿名免费 AI 对话、无需账号）。
 *
 * 全量基线（2026-11-17，191 条逐条 curl）：除上述 4 条登录墙外，无其他引擎落登录页；
 * 微博 !weibo 落 passport.weibo.com/visitor（Sina Visitor System 游客通行页，页内无
 * 登录/登录表单词，浏览器环境下自动发游客身份跳回搜索结果，curl 无法执行其 JS 跳转，
 * 故保留、待浏览器复查）；其余 403/429 均为站方机器人墙（Cloudflare / sorry / 验证码），
 * 最终 URL 仍在搜索站内，不是登录页；百度/OpenAlex/bioRxiv 搜索路径 000 但首页 200，
 * 系出口路径级抖动，非死链。
 *
 * U-470（2026-11-22，只删不换）：!pwc（Papers with Code 301 到 HF trending 且查
 * 询词被丢弃；候选 HF Papers 搜索亦经实测无效）与 !phind（搜索服务 2026-01-16 已关
 * 停，YC 标 inactive）两引擎已下掉，总量 190→188，旧 URL/前缀/主机进退役清单防回流。
 * !jd（京东搜索）同批核实：Chrome UA 下 curl 落 cfe.m.jd.com 风控页（标题「京东验证」），
 * 系数据中心出口反爬、未证实真实用户浏览器同样受阻，故只记录、不改。
 *
 * 本测试只做静态断言（不联网）：登录墙标记、退役 URL/主机、替换 URL 收录、引擎数。
 */
import { describe, expect, it } from "vitest";
import { seedPluginDefs } from "../src/seed-plugins.ts";
import type { SearchPackPayload } from "@navhub/core";

/** 2026-11-17 P1-4 证实登录墙化、已下架或替换的旧检索 URL。U-470（2026-11-22）追加
 *  两条已证实死亡的旧检索 URL（!pwc 301 丢查询词、!phind 服务已关停）。 */
const RETIRED_LOGIN_WALL_URLS = [
  "https://libraries.io/search?q={q}",
  "https://you.com/search?q={q}",
  "https://www.dianping.com/search/keyword/1/0_{q}",
  "https://kns.cnki.net/kns8s/defaultresult/index?kw={q}",
  "https://gemini.google.com/app?q={q}",
  "https://paperswithcode.com/search?q_meta=&q_type=&q={q}",
  "https://www.phind.com/search?q={q}",
] as const;

/** 随旧 URL 一并退役的前缀（替换后前缀随服务改名，旧前缀不得再出现）。U-470 追加 !pwc / !phind。 */
const RETIRED_PREFIXES = ["!dianping", "!librariesio", "!you", "!gemini", "!pwc", "!phind"] as const;

/** 旧 URL 所在主机：同一主机的任何检索 URL 均视为登录墙回流。U-470 追加两已死服务主机。 */
const RETIRED_HOSTS = [
  "libraries.io",
  "you.com",
  "www.dianping.com",
  "m.dianping.com",
  "kns.cnki.net",
  "gemini.google.com",
  "paperswithcode.com",
  "www.phind.com",
] as const;

/** P1-4 替换后收录的新检索 URL（curl 已验证 200 且非登录页）。 */
const REPLACEMENT_SEARCH_URLS = [
  "https://deps.dev/search?q={q}",
  "https://www.qwant.com/?q={q}",
  "https://duck.ai/?q={q}",
  "https://oversea.cnki.net/kns8s/defaultresult/index?kw={q}",
] as const;

/** 登录墙地址特征：出现在收录 URL 里即视为落登录页。 */
const LOGIN_MARKERS = ["login", "signin", "sign-in", "pclogin", "mlogin"] as const;

function collectSearchEngines() {
  const engines: Array<{ slug: string; prefix: string; url: string }> = [];
  for (const def of seedPluginDefs()) {
    if (def.manifest.kind !== "search-pack") continue;
    const payload = def.manifest.payload as SearchPackPayload;
    for (const engine of payload.engines ?? []) {
      engines.push({ slug: def.slug, prefix: engine.prefix, url: engine.searchUrl });
    }
  }
  return engines;
}

describe("搜索引擎前缀直达：登录墙化 URL 不得回流（2026-11-17 P1-4）", () => {
  it("全部收录 URL 不含登录墙标记、不落退役主机", () => {
    for (const engine of collectSearchEngines()) {
      const lower = engine.url.toLowerCase();
      for (const marker of LOGIN_MARKERS) {
        expect(
          lower.includes(marker),
          `${engine.slug} 引擎 ${engine.prefix} 的收录 URL 含登录墙标记「${marker}」：${engine.url}`,
        ).toBe(false);
      }
      const host = new URL(engine.url).hostname.toLowerCase();
      expect(
        RETIRED_HOSTS.includes(host as (typeof RETIRED_HOSTS)[number]),
        `${engine.slug} 引擎 ${engine.prefix} 仍用已证实登录墙化的主机 ${host}：${engine.url}`,
      ).toBe(false);
    }
  });

  it("已证实登录墙化的旧检索 URL 与旧前缀不再出现", () => {
    const engines = collectSearchEngines();
    for (const engine of engines) {
      expect(
        (RETIRED_LOGIN_WALL_URLS as readonly string[]).includes(engine.url),
        `${engine.slug} 引擎 ${engine.prefix} 仍用已下架/替换的登录墙 URL：${engine.url}`,
      ).toBe(false);
      expect(
        (RETIRED_PREFIXES as readonly string[]).includes(engine.prefix.toLowerCase()),
        `${engine.slug} 仍有已退役前缀 ${engine.prefix}（应随服务改名或下架）`,
      ).toBe(false);
    }
  });

  it("替换后的新检索 URL 已收录（防回退）", () => {
    const urls = new Set(collectSearchEngines().map((e) => e.url));
    for (const url of REPLACEMENT_SEARCH_URLS) {
      expect(urls.has(url), `替换后的新检索 URL 未收录：${url}`).toBe(true);
    }
  });

  it("中文生活包 36 个引擎、总量 188 个（大众点评已下架，非 191；U-470 下架 !pwc 与 !phind，非 190）", () => {
    const engines = collectSearchEngines();
    const cn = engines.filter((e) => e.slug === "cn-search-arsenal");
    expect(cn.length, "中文生活包引擎数应为 36（大众点评下架后 37→36）").toBe(36);
    expect(engines.length, "搜索引擎总量应为 188（191 下架 1 个大众点评、U-470 下架 !pwc 与 !phind 各 1 个）").toBe(188);
  });
});
