import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import path from "path";

const db = new Database(path.resolve("data/navhub.db"));

// T1 顶级权威站点（国家级政务、全球科技巨头、顶流大模型、顶尖高校/顶刊、国际组织、核心金融基础设施）：基础分 93 - 98
const TIER1_DOMAINS = new Set([
  // 国家部委、央行、最高法/检、权威政务平台
  "gov.cn", "court.gov.cn", "spp.gov.cn", "mps.gov.cn", "mfa.gov.cn", "samr.gov.cn",
  "nhsa.gov.cn", "chinatax.gov.cn", "pbccrc.org.cn", "pbc.gov.cn", "csrc.gov.cn",
  "12333.gov.cn", "12348.gov.cn", "12377.cn", "creditchina.gov.cn", "chinamoney.com.cn",
  "scs.gov.cn", "cncaprc.gov.cn", "codac.org.cn", "redcross.org.cn", "moa.gov.cn",
  "chsi.com.cn", "neea.edu.cn", "12306.cn", "chinapost.com.cn", "weather.com.cn",
  "stats.gov.cn", "cnipa.gov.cn", "customs.gov.cn", "miit.gov.cn", "moe.gov.cn",
  // 国际组织与标准机构
  "un.org", "who.int", "wto.org", "imf.org", "worldbank.org", "oecd.org", "unesco.org",
  "w3.org", "ietf.org", "iso.org", "ieee.org", "acm.org", "apache.org", "linuxfoundation.org",
  "cncf.io", "owasp.org", "mozilla.org", "wikipedia.org", "wikimedia.org", "archive.org",
  // 全球科技巨头与顶级 AI / 开发基础设施
  "github.com", "google.com", "apple.com", "microsoft.com", "amazon.com", "aws.amazon.com",
  "openai.com", "chatgpt.com", "anthropic.com", "claude.ai", "deepseek.com", "moonshot.cn",
  "doubao.com", "chatglm.cn", "zhipuai.cn", "x.ai", "perplexity.ai", "huggingface.co",
  "midjourney.com", "runwayml.com", "stability.ai", "suno.com", "elevenlabs.io",
  "cursor.com", "cursor.sh", "vercel.com", "cloudflare.com", "docker.com", "kubernetes.io",
  "python.org", "nodejs.org", "rust-lang.org", "go.dev", "typescriptlang.org", "react.dev",
  "vuejs.org", "angular.dev", "svelte.dev", "nextjs.org", "kernel.org", "linux.org",
  "postgresql.org", "mysql.com", "redis.io", "mongodb.com", "elastic.co", "kafka.apache.org",
  "prometheus.io", "grafana.com", "terraform.io", "gitlab.com", "stackoverflow.com",
  "npmjs.com", "pypi.org", "crates.io", "pkg.go.dev", "maven.org", "jetbrains.com",
  // 国内科技巨头与国家级媒体
  "baidu.com", "qq.com", "tencent.com", "weixin.qq.com", "taobao.com", "tmall.com",
  "jd.com", "pinduoduo.com", "bilibili.com", "douyin.com", "kuaishou.com", "weibo.com",
  "zhihu.com", "xiaohongshu.com", "meituan.com", "ctrip.com", "didiglobal.com",
  "xinhuanet.com", "news.cn", "people.com.cn", "cctv.com", "chinanews.com.cn", "gmw.cn",
  "aliyun.com", "alibaba.com", "cloud.tencent.com", "huaweicloud.com", "huawei.com",
  "volcengine.com", "xiaomi.com", "xfyun.cn", "bytedance.com", "163.com", "sina.com.cn",
  // 顶级期刊、科研库与核心金融机构
  "nature.com", "science.org", "cell.com", "thelancet.com", "nejm.org", "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov", "nih.gov", "nasa.gov", "cern.ch", "home.cern", "cas.cn",
  "cnki.net", "scholar.google.com", "semanticscholar.org",
  "icbc.com.cn", "ccb.com", "boc.cn", "abchina.com", "bankcomm.com", "cmbchina.com",
  "sse.com.cn", "szse.cn", "bse.cn", "hkex.com.hk", "sge.com.cn", "shfe.com.cn",
  "cffex.com.cn", "czce.com.cn", "dce.com.cn", "chinabond.com.cn", "unionpay.com", "alipay.com"
]);

// T2 行业龙头与一线知名平台：基础分 83 - 91
const TIER2_DOMAINS = new Set([
  // 开发者与技术生态龙头
  "leetcode.cn", "leetcode.com", "gitee.com", "juejin.cn", "csdn.net", "v2ex.com",
  "segmentfault.com", "oschina.net", "infoq.cn", "infoq.com", "51cto.com", "cnblogs.com",
  "vite.dev", "vitejs.dev", "webpack.js.org", "rollupjs.org", "esbuild.github.io",
  "turborepo.com", "pnpm.io", "bun.sh", "deno.com", "tailwindcss.com", "sass-lang.com",
  "ant.design", "mui.com", "shadcn.com", "ui.shadcn.com", "radix-ui.com", "element-plus.org",
  "redux.js.org", "zustand-demo.pmnd.rs", "tanstack.com", "playwright.dev", "cypress.io",
  "vitest.dev", "jestjs.io", "storybook.js.org", "sentry.io", "datadoghq.com", "newrelic.com",
  "postman.com", "swagger.io", "insomnia.rest", "apifox.com", "Hoppscotch.io",
  "spring.io", "fastapi.tiangolo.com", "nestjs.com", "expressjs.com", "laravel.com",
  "djangoproject.com", "rubyonrails.org", "dotnet.microsoft.com", "supabase.com", "firebase.google.com",
  "planetscale.com", "neon.tech", "clickhouse.com", "snowflake.com", "databricks.com",
  "airflow.apache.org", "dbt.com", "getdbt.com", "airbyte.com", "fivetran.com",
  "electronjs.org", "tauri.app", "flutter.dev", "reactnative.dev", "uniapp.dcloud.net.cn",
  "codepen.io", "codesandbox.io", "stackblitz.com", "replit.com", "jsfiddle.net",
  "roadmap.sh", "freecodecamp.org", "mdn.io",
  // 设计、办公、效率龙头
  "figma.com", "canva.com", "canva.cn", "adobe.com", "dribbble.com", "behance.net",
  "pinterest.com", "awwwards.com", "zcool.com.cn", "huaban.com", "ui.cn", "uisdc.com",
  "iconfont.cn", "fontawesome.com", "lucide.dev", "heroicons.com", "unsplash.com", "pexels.com",
  "pixabay.com", "shutterstock.com", "gettyimages.com", "vnpg.com", "vcg.com",
  "blender.org", "spline.design", "sketchfab.com", "c4d.com", "maxon.net", "autodesk.com",
  "feishu.cn", "dingtalk.com", "work.weixin.qq.com", "yuque.com", "notion.so", "obsidian.md",
  "wolai.com", "flomoapp.com", "logseq.com", "craft.do", "coda.io", "airtable.com",
  "wps.cn", "shimo.im", "kdocs.cn", "zoom.us", "meeting.tencent.com", "miro.com",
  "xmind.cn", "xmind.app", "processon.com", "excalidraw.com", "tldraw.com",
  "wjx.cn", "jinshuju.net", "typeform.com", "tally.so", "1password.com", "bitwarden.com",
  // 招聘、职场、教育、学术龙头
  "zhipin.com", "51job.com", "zhaopin.com", "liepin.com", "lagou.com", "maimai.cn",
  "linkedin.com", "linkedin.cn", "glassdoor.com", "indeed.com", "levels.fyi", "kanzhun.com",
  "nowcoder.com", "shixiseng.com", "yingjiesheng.com", "upwork.com", "fiverr.com",
  "icourse163.org", "xuetangx.com", "coursera.org", "edx.org", "udacity.com", "udemy.com",
  "khanacademy.org", "duolingo.com", "duolingo.cn", "imooc.com", "geekbang.org", "lanqiao.cn",
  "fenbi.com", "huatu.com", "offcn.com", "koolearn.com", "xdf.cn", "tal.com",
  "wanfangdata.com.cn", "cqvip.com", "webofscience.com", "sciencedirect.com", "springer.com",
  "wiley.com", "jstor.org", "researchgate.net", "orcid.org", "zotero.org", "overleaf.com",
  " connectedpapers.com", "aminer.cn", "scimagojr.com", "letpub.com.cn", "medsci.cn",
  // 媒体、财经、生活、娱乐、游戏龙头
  "caixin.com", "thepaper.cn", "yicai.com", "jiemian.com", "cls.cn", "wallstreetcn.com",
  "eastmoney.com", "10jqka.com.cn", "xueqiu.com", "wind.com.cn", "sina.com", "sohu.com",
  "ifeng.com", "36kr.com", "huxiu.com", "tmtpost.com", "sspai.com", "ifanr.com", "guokr.com",
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "economist.com", "bbc.com", "nytimes.com",
  "tradingview.com", "investing.com", "morningstar.com", "coinmarketcap.com", "coingecko.com",
  "douban.com", "imdb.com", "rottentomatoes.com", "metacritic.com", "themoviedb.org",
  "iqiyi.com", "youku.com", "v.qq.com", "mgtv.com", "netflix.com", "youtube.com",
  "disneyplus.com", "spotify.com", "music.163.com", "y.qq.com", "kugou.com", "kuwo.cn",
  "ximalaya.com", "xiaoyuzhoufm.com", "apple.com", "twitch.tv", "huya.com", "douyu.com",
  "maoyan.com", "taopiaopiao.com", "damai.cn", "gewara.com", "showstart.com", "228.com.cn",
  "steampowered.com", "store.steampowered.com", "epicgames.com", "gog.com", "itch.io",
  "playstation.com", "xbox.com", "nintendo.com", "taptap.cn", "taptap.io", "xiaoheihe.cn",
  "gamersky.com", "3dmgame.com", "ali213.net", "nga.cn", "gcores.com", "ign.com", "gamespot.com",
  "unity.com", "unrealengine.com", "godotengine.org",
  "vip.com", "suning.com", "poizon.com", "smzdm.com", "manmanbuy.com", "xianyu.com",
  "zhuanzhuan.com", "aihuishou.com", "autohome.com.cn", "dongchedi.com", "yiche.com",
  "qunar.com", "fliggy.com", "ly.com", "mafengwo.cn", "qyer.com", "booking.com", "airbnb.com",
  "keep.com", "hupu.com", "zhibo8.com", "dxy.cn", "haodf.com", "guahao.com", "JDhealth.com"
]);

function getDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function deterministicMicroBoost(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 28) / 10; // 0.0 to 2.7
}

function computeSiteWeight(site) {
  const domain = getDomain(site.url);
  let base = 66.0;

  // 1. 权威域名后缀识别
  if (domain.endsWith(".gov.cn") || domain.endsWith(".gov") || domain.endsWith(".mil")) {
    base = 95.5;
  } else if (domain.endsWith(".edu.cn") || domain.endsWith(".edu") || domain.endsWith(".ac.cn") || domain.endsWith(".ac.uk")) {
    base = 89.0;
  } else if (domain.endsWith(".org.cn") || domain.endsWith(".org") || domain.endsWith(".int")) {
    base = 78.0;
  }

  // 2. 权威品牌库匹配
  let matchedTier = 0;
  for (const t1 of TIER1_DOMAINS) {
    const cleanT1 = t1.toLowerCase().replace(/^www\./, "");
    if (domain === cleanT1 || domain.endsWith("." + cleanT1)) {
      base = Math.max(base, 93.5);
      matchedTier = 1;
      break;
    }
  }
  if (!matchedTier) {
    for (const t2 of TIER2_DOMAINS) {
      const cleanT2 = t2.toLowerCase().replace(/^www\./, "");
      if (domain === cleanT2 || domain.endsWith("." + cleanT2)) {
        base = Math.max(base, 84.0);
        matchedTier = 2;
        break;
      }
    }
  }

  // 3. 结构化信号加成：一级/主站首页 vs 深层内页、简短国际域名、HTTPS
  try {
    const u = new URL(site.url);
    if (u.protocol === "https:") base += 0.8;
    if (u.pathname === "/" || u.pathname === "") {
      base += 1.5; // 独立主域名官网加成
    } else if (u.pathname.split("/").filter(Boolean).length === 1) {
      base += 0.6;
    }
    const sld = domain.split(".")[0] || "";
    if (sld.length > 0 && sld.length <= 6) base += 0.9;
  } catch {}

  // 4. 站点特征与确定性微调分（避免同梯队网站全部同分）
  if (site.featured === 1) base += 2.0;
  const visitBonus = Math.min(3.0, Math.log1p(site.visit_count || 0) * 1.0);
  const micro = deterministicMicroBoost(domain + "|" + (site.title || ""));

  const finalWeight = Math.min(99.5, Math.max(55.0, base + visitBonus + micro));
  return Math.round(finalWeight * 10) / 10;
}

export function recompute() {
  console.log("=== 开始执行全站网站权重与展示排序重算 ===");
  const sites = db.prepare("SELECT id, url, title, category_id, featured, visit_count, trend_score FROM sites WHERE deleted_at IS NULL").all();
  console.log(`全库有效站点总数: ${sites.length}`);

  const updateSiteRankStmt = db.prepare("UPDATE sites SET weight = ?, trend_score = ?, featured = ?, sort = ? WHERE id = ?");

  const byCat = new Map();
  for (const s of sites) {
    const weight = computeSiteWeight(s);
    s.weight = weight;
    s.newTrendScore = Math.max(Number(s.trend_score || 0), Math.round((weight / 10) * 100) / 100);
    s.newFeatured = weight >= 93.0 ? 1 : (s.featured || 0);
    if (!byCat.has(s.category_id)) byCat.set(s.category_id, []);
    byCat.get(s.category_id).push(s);
  }

  let totalReordered = 0;
  db.transaction(() => {
    for (const [, catSites] of byCat.entries()) {
      catSites.sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        if (b.newTrendScore !== a.newTrendScore) return b.newTrendScore - a.newTrendScore;
        return (b.visit_count || 0) - (a.visit_count || 0);
      });

      for (let i = 0; i < catSites.length; i++) {
        const s = catSites[i];
        const rankSort = i + 1;
        updateSiteRankStmt.run(s.weight, s.newTrendScore, s.newFeatured, rankSort, s.id);
        totalReordered++;
      }
    }
    db.prepare("UPDATE data_version SET version = version + 1, updated_at = ? WHERE id = 1").run(Date.now());
  })();

  console.log(`分类内权重与排序赋值完成，总计更新: ${totalReordered} 个站点。`);

  const sampleTop = db.prepare("SELECT title, url, weight, trend_score, sort, category_id FROM sites WHERE deleted_at IS NULL ORDER BY weight DESC, sort ASC LIMIT 15").all();
  console.log("\n全网权重最高站点 Top 15 示例:");
  console.table(sampleTop);
}

recompute();
