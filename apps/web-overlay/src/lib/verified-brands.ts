/**
 * 已核实官网品牌（50 家起始名单，用户 2026-11-24 已确认“就按这份做”）。
 *
 * 来源：workspace/.jarvis/idea-executions/83b4ab3a-99d1-404f-8285-2135438dfd10/scratch/50-brand-list.md
 * 核查日期统一 2026-11-24；每家逐个打开官网本身页面实测，不凭搜索摘要。
 * 这份表只收这 50 家，不扩；仿冒候选绝不进这张表，也不进搜索结果。
 *
 * 诚实口径：
 * - canonicalDomain 是核实过的规范官网域名，卡片与比对页只认它；
 * - source 是核查时打开的官网 URL，逐字照抄名单，不改写；
 * - note 只写核实中发现的事实（例如小红书品牌改为 rednote、曾跳转至
 *   www.rednote.com/login）；没核实的留空，不许编；
 * - 匹配只认品牌名与 aliases 的精确命中（查询末尾的“官网”/“官方”先去掉
 *   再匹配），含糊的查询不给官方卡，
 *   宁可不显示也不错认——核实的官网零误拦、仿冒零误认是同一条线。
 */

export interface VerifiedBrand {
  /** 品牌名（照抄名单） */
  name: string;
  /** 核实过的规范官网域名（不含协议、不含路径） */
  canonicalDomain: string;
  /** 供搜索匹配的别名：英文名、常用简称；只收无歧义的 */
  aliases: string[];
  /** 核查日期（ISO 日期） */
  checkedAt: string;
  /** 核查时打开的官网 URL（逐字照抄名单） */
  source: string;
  /** 核实备注；无则留空 */
  note?: string;
}

export const VERIFIED_BRANDS_CHECKED_AT = "2026-11-24";

export const VERIFIED_BRANDS: VerifiedBrand[] = [
  { name: "ChatGPT", canonicalDomain: "chatgpt.com", aliases: ["chatgpt", "chatgpt.com", "gpt"], checkedAt: "2026-11-24", source: "https://chatgpt.com" },
  { name: "DeepSeek", canonicalDomain: "deepseek.com", aliases: ["deepseek", "深度求索", "deepseek.com"], checkedAt: "2026-11-24", source: "https://deepseek.com", note: "品牌官网主域是 deepseek.com；chat.deepseek.com 只是其官方对话入口，不是主域。" },
  { name: "Claude", canonicalDomain: "claude.ai", aliases: ["claude", "claude.ai"], checkedAt: "2026-11-24", source: "https://claude.ai" },
  { name: "Kimi", canonicalDomain: "www.kimi.com", aliases: ["kimi", "www.kimi.com"], checkedAt: "2026-11-24", source: "https://www.kimi.com", note: "规范域名带 www，裸域会跳转至 www。" },
  { name: "通义千问", canonicalDomain: "qianwen.aliyun.com", aliases: ["通义千问", "qianwen", "千问", "qianwen.aliyun.com"], checkedAt: "2026-11-24", source: "https://qianwen.aliyun.com" },
  { name: "豆包", canonicalDomain: "www.doubao.com", aliases: ["豆包", "doubao", "www.doubao.com"], checkedAt: "2026-11-24", source: "https://www.doubao.com", note: "规范域名带 www，裸域会跳转至 www。" },
  { name: "Gemini", canonicalDomain: "gemini.google.com", aliases: ["gemini", "gemini.google.com"], checkedAt: "2026-11-24", source: "https://gemini.google.com" },
  { name: "Midjourney", canonicalDomain: "midjourney.com", aliases: ["midjourney", "midjourney.com"], checkedAt: "2026-11-24", source: "https://midjourney.com" },
  { name: "GitHub", canonicalDomain: "github.com", aliases: ["github", "github.com"], checkedAt: "2026-11-24", source: "https://github.com" },
  { name: "npm", canonicalDomain: "npmjs.com", aliases: ["npm", "npmjs.com"], checkedAt: "2026-11-24", source: "https://npmjs.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
  { name: "Stack Overflow", canonicalDomain: "stackoverflow.com", aliases: ["stack overflow", "stackoverflow", "stackoverflow.com"], checkedAt: "2026-11-24", source: "https://stackoverflow.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
  { name: "Vercel", canonicalDomain: "vercel.com", aliases: ["vercel", "vercel.com"], checkedAt: "2026-11-24", source: "https://vercel.com" },
  { name: "Docker Hub", canonicalDomain: "hub.docker.com", aliases: ["docker hub", "dockerhub", "docker", "hub.docker.com"], checkedAt: "2026-11-24", source: "https://hub.docker.com" },
  { name: "Python", canonicalDomain: "python.org", aliases: ["python", "python.org"], checkedAt: "2026-11-24", source: "https://python.org" },
  { name: "Node.js", canonicalDomain: "nodejs.org", aliases: ["node.js", "nodejs", "node", "nodejs.org"], checkedAt: "2026-11-24", source: "https://nodejs.org" },
  { name: "Hugging Face", canonicalDomain: "huggingface.co", aliases: ["hugging face", "huggingface", "huggingface.co"], checkedAt: "2026-11-24", source: "https://huggingface.co" },
  { name: "Figma", canonicalDomain: "www.figma.com", aliases: ["figma", "www.figma.com"], checkedAt: "2026-11-24", source: "https://figma.com", note: "规范域名带 www，裸域会跳转至 www。" },
  { name: "Canva", canonicalDomain: "www.canva.com", aliases: ["canva", "www.canva.com"], checkedAt: "2026-11-24", source: "https://www.canva.com" },
  { name: "Notion", canonicalDomain: "www.notion.com", aliases: ["notion", "www.notion.com"], checkedAt: "2026-11-24", source: "https://www.notion.com" },
  { name: "飞书", canonicalDomain: "www.feishu.cn", aliases: ["飞书", "feishu", "www.feishu.cn"], checkedAt: "2026-11-24", source: "https://www.feishu.cn", note: "境外访问会分流至 larksuite.com，规范域名不变。" },
  { name: "腾讯文档", canonicalDomain: "docs.qq.com", aliases: ["腾讯文档", "docs.qq.com"], checkedAt: "2026-11-24", source: "https://docs.qq.com" },
  { name: "金山文档", canonicalDomain: "www.kdocs.cn", aliases: ["金山文档", "kdocs", "www.kdocs.cn"], checkedAt: "2026-11-24", source: "https://www.kdocs.cn" },
  { name: "淘宝", canonicalDomain: "www.taobao.com", aliases: ["淘宝", "taobao", "www.taobao.com", "tb", "淘宝网"], checkedAt: "2026-11-24", source: "https://www.taobao.com" },
  { name: "京东", canonicalDomain: "www.jd.com", aliases: ["京东", "jd", "www.jd.com", "jingdong"], checkedAt: "2026-11-24", source: "https://www.jd.com", note: "自当前出口访问会跳至英文企业站 corporate.jd.com，规范域名不变。" },
  { name: "拼多多", canonicalDomain: "www.pinduoduo.com", aliases: ["拼多多", "pinduoduo", "www.pinduoduo.com", "pdd"], checkedAt: "2026-11-24", source: "https://www.pinduoduo.com" },
  { name: "天猫", canonicalDomain: "www.tmall.com", aliases: ["天猫", "tmall", "www.tmall.com"], checkedAt: "2026-11-24", source: "https://www.tmall.com" },
  { name: "支付宝", canonicalDomain: "www.alipay.com", aliases: ["支付宝", "alipay", "www.alipay.com"], checkedAt: "2026-11-24", source: "https://www.alipay.com" },
  { name: "亚马逊", canonicalDomain: "www.amazon.com", aliases: ["亚马逊", "amazon", "www.amazon.com"], checkedAt: "2026-11-24", source: "https://www.amazon.com" },
  { name: "Temu", canonicalDomain: "www.temu.com", aliases: ["temu", "www.temu.com"], checkedAt: "2026-11-24", source: "https://www.temu.com" },
  { name: "微信", canonicalDomain: "weixin.qq.com", aliases: ["微信", "weixin", "wechat", "weixin.qq.com"], checkedAt: "2026-11-24", source: "https://weixin.qq.com" },
  { name: "微博", canonicalDomain: "www.weibo.com", aliases: ["微博", "weibo", "www.weibo.com"], checkedAt: "2026-11-24", source: "https://www.weibo.com" },
  { name: "小红书", canonicalDomain: "www.xiaohongshu.com", aliases: ["小红书", "xiaohongshu", "rednote", "www.xiaohongshu.com", "xhs"], checkedAt: "2026-11-24", source: "https://www.xiaohongshu.com", note: "页面品牌已改为 rednote，一次实测跳转终点为 www.rednote.com/login；规范官网域名仍为 www.xiaohongshu.com。" },
  { name: "哔哩哔哩", canonicalDomain: "www.bilibili.com", aliases: ["哔哩哔哩", "bilibili", "b站", "www.bilibili.com", "bili"], checkedAt: "2026-11-24", source: "https://www.bilibili.com" },
  { name: "抖音", canonicalDomain: "www.douyin.com", aliases: ["抖音", "douyin", "www.douyin.com"], checkedAt: "2026-11-24", source: "https://www.douyin.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
  { name: "快手", canonicalDomain: "www.kuaishou.com", aliases: ["快手", "kuaishou", "www.kuaishou.com"], checkedAt: "2026-11-24", source: "https://www.kuaishou.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
  { name: "爱奇艺", canonicalDomain: "www.iqiyi.com", aliases: ["爱奇艺", "iqiyi", "www.iqiyi.com", "爱奇", "奇艺"], checkedAt: "2026-11-24", source: "https://www.iqiyi.com" },
  { name: "腾讯视频", canonicalDomain: "v.qq.com", aliases: ["腾讯视频", "v.qq.com"], checkedAt: "2026-11-24", source: "https://v.qq.com" },
  { name: "铁路12306", canonicalDomain: "www.12306.cn", aliases: ["铁路12306", "12306", "www.12306.cn"], checkedAt: "2026-11-24", source: "https://www.12306.cn" },
  { name: "高德地图", canonicalDomain: "www.amap.com", aliases: ["高德地图", "高德", "amap", "www.amap.com"], checkedAt: "2026-11-24", source: "https://www.amap.com" },
  { name: "携程旅行", canonicalDomain: "www.ctrip.com", aliases: ["携程旅行", "携程", "ctrip", "www.ctrip.com"], checkedAt: "2026-11-24", source: "https://www.ctrip.com" },
  { name: "滴滴出行", canonicalDomain: "www.didiglobal.com", aliases: ["滴滴出行", "滴滴", "didi", "www.didiglobal.com"], checkedAt: "2026-11-24", source: "https://www.didiglobal.com", note: "didi.cn 只是母公司北京小桔科技的占位页，无滴滴出行服务内容，不应作为官网。" },
  { name: "百度地图", canonicalDomain: "map.baidu.com", aliases: ["百度地图", "map.baidu.com"], checkedAt: "2026-11-24", source: "https://map.baidu.com" },
  { name: "研招网", canonicalDomain: "yz.chsi.com.cn", aliases: ["研招网", "研招", "yz.chsi.com.cn"], checkedAt: "2026-11-24", source: "https://yz.chsi.com.cn" },
  { name: "中国知网", canonicalDomain: "www.cnki.net", aliases: ["中国知网", "知网", "cnki", "www.cnki.net"], checkedAt: "2026-11-24", source: "https://www.cnki.net", note: "在本机出口 IP 下会跳至 oversea.cnki.net，规范域名不变。" },
  { name: "知乎", canonicalDomain: "www.zhihu.com", aliases: ["知乎", "zhihu", "www.zhihu.com"], checkedAt: "2026-11-24", source: "https://www.zhihu.com" },
  { name: "力扣 LeetCode", canonicalDomain: "leetcode.cn", aliases: ["力扣", "leetcode", "leetcode.cn"], checkedAt: "2026-11-24", source: "https://leetcode.cn" },
  { name: "中国政府网", canonicalDomain: "www.gov.cn", aliases: ["中国政府网", "政府网", "www.gov.cn"], checkedAt: "2026-11-24", source: "https://www.gov.cn" },
  { name: "国家税务局", canonicalDomain: "www.chinatax.gov.cn", aliases: ["国家税务局", "税务局", "chinatax", "www.chinatax.gov.cn"], checkedAt: "2026-11-24", source: "https://www.chinatax.gov.cn" },
  { name: "豆瓣", canonicalDomain: "www.douban.com", aliases: ["豆瓣", "douban", "www.douban.com"], checkedAt: "2026-11-24", source: "https://www.douban.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
  { name: "36氪", canonicalDomain: "www.36kr.com", aliases: ["36氪", "36kr", "www.36kr.com"], checkedAt: "2026-11-24", source: "https://www.36kr.com", note: "核查时未能直读页面标题（反爬/安全检测所致），域名已凭响应与归属确认。" },
];

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 按查询找已核实品牌。只认精确命中（品牌名或别名，忽略大小写、
 * 去首尾空格）；匹配前先去掉查询末尾的“官网”/“官方”再精确匹配
 * （如“chatgpt官网”→“chatgpt”）。含糊、多义、无命中一律返回 null，
 * 宁可不显示官方卡也不错认；不做子串/包含匹配。
 */
export function findVerifiedBrandByQuery(query: string): VerifiedBrand | null {
  let q = normalizeToken(query);
  if (!q) return null;
  // 去掉末尾的“官网”/“官方”后缀；只剩后缀本身时不去掉（仍返回 null）。
  while (q.length > 2 && (q.endsWith("官网") || q.endsWith("官方"))) {
    q = q.slice(0, -2).trim();
  }
  if (!q) return null;
  return (
    VERIFIED_BRANDS.find(
      (b) => normalizeToken(b.name) === q || b.aliases.some((a) => normalizeToken(a) === q),
    ) ?? null
  );
}

/** 按域名精确找已核实品牌（只认规范域名本身，不认子域、不认近似域）。 */
export function getVerifiedBrandByDomain(host: string): VerifiedBrand | null {
  const h = normalizeToken(host);
  if (!h) return null;
  return VERIFIED_BRANDS.find((b) => b.canonicalDomain === h) ?? null;
}
