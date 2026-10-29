/**
 * [AI-5] 语义通道「相似度下限」离线标定。
 *
 * 用仓库里已缓存的 bge-small-zh-v1.5（data/models）算真实相似度分布：
 *  - relevant：查询与人工标注的相关站点标题/描述
 *  - noise：查询与其余站点的相似度
 * 输出各阈值下的「相关保留率 / 噪声放行数 / 噪声最高分」，用于选默认值。
 *
 * 运行：node deliverables/ai5-vector-2026-10-30/calibration/measure-threshold.mts
 * 只读本地模型缓存（allowRemote=false），不联网、不连数据库。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbeddingService, siteEmbeddingText } from "../../../packages/ai/src/embedding.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "results");
mkdirSync(OUT, { recursive: true });

interface Site {
  id: string;
  title: string;
  description: string;
  url: string;
}

const sites: Site[] = [
  { id: "github", title: "GitHub", description: "全球最大的代码托管与协作平台", url: "https://github.com" },
  { id: "gitee", title: "Gitee 码云", description: "国内代码托管与 DevOps 平台", url: "https://gitee.com" },
  { id: "zhihu", title: "知乎", description: "中文问答社区，有问题就会有答案", url: "https://zhihu.com" },
  { id: "bilibili", title: "哔哩哔哩 B站", description: "年轻人的视频社区，番剧与弹幕", url: "https://bilibili.com" },
  { id: "taobao", title: "淘宝", description: "综合网络购物平台，万能的淘宝", url: "https://taobao.com" },
  { id: "jd", title: "京东", description: "自营电商，数码家电快速配送", url: "https://jd.com" },
  { id: "pdd", title: "拼多多", description: "社交拼团购物，百亿补贴", url: "https://pinduoduo.com" },
  { id: "douban", title: "豆瓣", description: "书影音评分与兴趣小组社区", url: "https://douban.com" },
  { id: "xiaohongshu", title: "小红书", description: "生活方式分享社区，种草与攻略", url: "https://xiaohongshu.com" },
  { id: "weibo", title: "微博", description: "社交媒体与热点新闻广场", url: "https://weibo.com" },
  { id: "baidu", title: "百度", description: "中文搜索引擎", url: "https://baidu.com" },
  { id: "netease-music", title: "网易云音乐", description: "在线音乐播放与歌单推荐", url: "https://music.163.com" },
  { id: "qq-music", title: "QQ音乐", description: "正版音乐曲库与在线试听", url: "https://y.qq.com" },
  { id: "juejin", title: "掘金", description: "开发者技术社区，前端后端文章", url: "https://juejin.cn" },
  { id: "csdn", title: "CSDN", description: "中文IT技术博客与问答", url: "https://csdn.net" },
  { id: "stackoverflow", title: "Stack Overflow", description: "程序员问答社区，解决编程问题", url: "https://stackoverflow.com" },
  { id: "mdn", title: "MDN Web Docs", description: "Web 前端开发文档，HTML CSS JavaScript", url: "https://developer.mozilla.org" },
  { id: "runoob", title: "菜鸟教程", description: "编程入门教程，前端后端数据库", url: "https://runoob.com" },
  { id: "ruanyifeng", title: "阮一峰的网络日志", description: "技术博客与每周科技动态", url: "https://ruanyifeng.com" },
  { id: "v2ex", title: "V2EX", description: "程序员与创意工作者的社区", url: "https://v2ex.com" },
  { id: "sspai", title: "少数派", description: "高效工作与数字生活指南", url: "https://sspai.com" },
  { id: "36kr", title: "36氪", description: "科技创投媒体与商业资讯", url: "https://36kr.com" },
  { id: "huxiu", title: "虎嗅网", description: "商业与科技深度报道", url: "https://huxiu.com" },
  { id: "lianjia", title: "链家", description: "二手房与租房房源平台", url: "https://lianjia.com" },
  { id: "ctrip", title: "携程旅行", description: "机票酒店与旅游度假预订", url: "https://ctrip.com" },
  { id: "12306", title: "12306", description: "中国铁路火车票官方购票网站", url: "https://12306.cn" },
  { id: "amap", title: "高德地图", description: "地图导航与实时路况", url: "https://amap.com" },
  { id: "dianping", title: "大众点评", description: "本地生活与餐厅点评", url: "https://dianping.com" },
  { id: "meituan", title: "美团", description: "外卖订餐与本地生活服务", url: "https://meituan.com" },
  { id: "eleme", title: "饿了么", description: "网上订外卖与生鲜配送", url: "https://ele.me" },
  { id: "dedao", title: "得到", description: "知识付费课程与听书", url: "https://dedao.cn" },
  { id: "geektime", title: "极客时间", description: "IT 技术专栏与视频课程", url: "https://time.geekbang.org" },
  { id: "figma", title: "Figma", description: "在线 UI 设计与团队协作工具", url: "https://figma.com" },
  { id: "notion", title: "Notion", description: "笔记、文档与项目管理一体化工具", url: "https://notion.so" },
  { id: "canva", title: "Canva 可画", description: "在线平面设计与海报模板", url: "https://canva.cn" },
  { id: "chatgpt", title: "ChatGPT", description: "OpenAI 的 AI 对话助手", url: "https://chat.openai.com" },
  { id: "claude", title: "Claude", description: "Anthropic 的 AI 助手，长文本写作", url: "https://claude.ai" },
  { id: "midjourney", title: "Midjourney", description: "AI 绘画与图像生成工具", url: "https://midjourney.com" },
  { id: "tongyi", title: "通义千问", description: "阿里云的大语言模型助手", url: "https://tongyi.aliyun.com" },
  { id: "deepseek", title: "DeepSeek", description: "开源大模型与 AI 编程助手", url: "https://deepseek.com" },
  { id: "copilot", title: "GitHub Copilot", description: "AI 编程助手，代码补全", url: "https://github.com/features/copilot" },
  { id: "kuaidi", title: "快递100", description: "快递单号查询与物流跟踪", url: "https://kuaidi100.com" },
  { id: "weather", title: "中国天气网", description: "天气预报与气象预警", url: "https://weather.com.cn" },
  { id: "youku", title: "优酷", description: "在线视频与影视剧播放", url: "https://youku.com" },
  { id: "douyin", title: "抖音", description: "短视频与直播平台", url: "https://douyin.com" },
  { id: "ximalaya", title: "喜马拉雅", description: "音频播客与有声书", url: "https://ximalaya.com" },
  { id: "alipay", title: "支付宝", description: "移动支付与生活缴费", url: "https://alipay.com" },
  { id: "aliyun", title: "阿里云", description: "云服务器与云数据库服务", url: "https://aliyun.com" },
  { id: "tencent-cloud", title: "腾讯云", description: "云计算、云主机与对象存储", url: "https://cloud.tencent.com" },
  { id: "kdocs", title: "金山文档", description: "多人协作在线文档与表格", url: "https://kdocs.cn" },
];

const cases: Array<{ query: string; relevant: string[] }> = [
  { query: "写代码的地方", relevant: ["github", "gitee"] },
  { query: "代码托管", relevant: ["github", "gitee"] },
  { query: "前端开发文档", relevant: ["mdn", "runoob"] },
  { query: "学编程的教程", relevant: ["runoob", "geektime"] },
  { query: "程序员社区", relevant: ["v2ex", "juejin", "stackoverflow"] },
  { query: "问问题找答案", relevant: ["zhihu", "stackoverflow"] },
  { query: "看视频弹幕", relevant: ["bilibili"] },
  { query: "短视频", relevant: ["douyin", "bilibili"] },
  { query: "网上购物", relevant: ["taobao", "jd", "pdd"] },
  { query: "买数码产品", relevant: ["jd", "taobao"] },
  { query: "买菜外卖", relevant: ["meituan", "eleme"] },
  { query: "评分看电影", relevant: ["douban"] },
  { query: "美妆穿搭种草", relevant: ["xiaohongshu"] },
  { query: "听歌", relevant: ["netease-music", "qq-music"] },
  { query: "听播客", relevant: ["ximalaya"] },
  { query: "火车票", relevant: ["12306"] },
  { query: "订酒店机票", relevant: ["ctrip"] },
  { query: "租房买房", relevant: ["lianjia"] },
  { query: "找餐厅", relevant: ["dianping"] },
  { query: "地图导航", relevant: ["amap"] },
  { query: "查快递", relevant: ["kuaidi"] },
  { query: "今天天气", relevant: ["weather"] },
  { query: "在线设计海报", relevant: ["canva", "figma"] },
  { query: "UI 设计工具", relevant: ["figma", "canva"] },
  { query: "记笔记软件", relevant: ["notion", "kdocs"] },
  { query: "AI 聊天助手", relevant: ["chatgpt", "claude", "tongyi"] },
  { query: "AI 画图", relevant: ["midjourney"] },
  { query: "AI 写代码", relevant: ["copilot", "deepseek"] },
  { query: "云服务器", relevant: ["aliyun", "tencent-cloud"] },
  { query: "科技新闻", relevant: ["36kr", "huxiu"] },
  { query: "效率工具", relevant: ["sspai", "notion"] },
  { query: "技术博客", relevant: ["ruanyifeng", "csdn", "juejin"] },
  { query: "知识付费课程", relevant: ["dedao", "geektime"] },
  { query: "手机支付", relevant: ["alipay"] },
  { query: "看电影电视剧", relevant: ["youku", "bilibili"] },
  { query: "新闻热点", relevant: ["weibo", "36kr"] },
  { query: "搜索资料", relevant: ["baidu"] },
];

const embedding = createEmbeddingService({
  allowRemote: false,
  useWorker: false,
  cacheDir: "./data/models",
  dtype: "q8",
  dim: 512,
  model: "Xenova/bge-small-zh-v1.5",
  endpoint: "https://hf-mirror.com",
});

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i += 1) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i]! / n;
  return out;
}

const siteTexts = sites.map((s) => siteEmbeddingText(s));
const siteVecs = (await embedding.encodeBatch(siteTexts)).map(normalize);
const queryVecs = (await embedding.encodeBatch(cases.map((c) => c.query))).map(normalize);

const relevant: number[] = [];
const noise: number[] = [];
const perQuery: Array<Record<string, unknown>> = [];

for (let qi = 0; qi < cases.length; qi += 1) {
  const qv = queryVecs[qi]!;
  const scored = sites.map((s, si) => {
    let dot = 0;
    const sv = siteVecs[si]!;
    for (let i = 0; i < sv.length; i += 1) dot += qv[i]! * sv[i]!;
    return { id: s.id, sim: dot };
  });
  scored.sort((a, b) => b.sim - a.sim);
  const relSet = new Set(cases[qi]!.relevant);
  let bestRel = -Infinity;
  let bestNoise = -Infinity;
  for (const row of scored) {
    if (relSet.has(row.id)) {
      relevant.push(row.sim);
      bestRel = Math.max(bestRel, row.sim);
    } else {
      noise.push(row.sim);
      bestNoise = Math.max(bestNoise, row.sim);
    }
  }
  perQuery.push({
    query: cases[qi]!.query,
    relevant: cases[qi]!.relevant,
    top5: scored.slice(0, 5),
    bestRel,
    bestNoise,
  });
}

function quantile(arr: number[], p: number): number {
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return Number(a[idx]!.toFixed(4));
}

const thresholds = [0, 0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const sweep = thresholds.map((t) => {
  const keptRel = relevant.filter((s) => s >= t).length;
  const keptNoise = noise.filter((s) => s >= t).length;
  const queriesWithNoRel = perQuery.filter((q) => {
    const relSet = new Set(q.relevant as string[]);
    const top = (q.top5 as Array<{ id: string; sim: number }>).filter((r) => r.sim >= t);
    return !top.some((r) => relSet.has(r.id));
  }).length;
  return {
    threshold: t,
    relevantKeptPct: Number(((keptRel / relevant.length) * 100).toFixed(1)),
    noiseKept: keptNoise,
    noiseKeptPct: Number(((keptNoise / noise.length) * 100).toFixed(2)),
    queriesWithNoRelevantInTop5: queriesWithNoRel,
  };
});

const report = {
  model: "Xenova/bge-small-zh-v1.5",
  sites: sites.length,
  queries: cases.length,
  relevantPairs: relevant.length,
  noisePairs: noise.length,
  relevant: {
    min: quantile(relevant, 0),
    p10: quantile(relevant, 0.1),
    p25: quantile(relevant, 0.25),
    median: quantile(relevant, 0.5),
    p75: quantile(relevant, 0.75),
    max: quantile(relevant, 1),
  },
  noise: {
    min: quantile(noise, 0),
    p25: quantile(noise, 0.25),
    median: quantile(noise, 0.5),
    p75: quantile(noise, 0.75),
    p90: quantile(noise, 0.9),
    p95: quantile(noise, 0.95),
    max: quantile(noise, 1),
  },
  sweep,
  perQuery,
};

writeFileSync(resolve(OUT, "threshold-calibration.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ relevant: report.relevant, noise: report.noise, sweep }, null, 2));
await embedding.close?.();
