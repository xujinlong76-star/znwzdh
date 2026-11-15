/**
 * 全网热榜源注册表 + 逐源解析器。
 *
 * William 拍板口径（2026-11-11）：全量聚合——能聚的平台都聚上；个别明确
 * 禁抓的源用其公开接口或官方榜单页尽量补齐；只存标题 + 链接 + 热度值
 * + 来源侧摘要原文（现阶段仅知乎官方接口返回 Summary），不搬运正文。逐源登记「方式与依据」，拿不到的源如实登记未覆盖及原因，
 * 绝不用造假数据充数。
 *
 * 每个 covered 源的解析器都有真实响应 fixture 守着
 *（apps/api/test/fixtures/hotlist/，2026-11-11 实测录制），源站改版
 * 打破形状时解析器抛错 → 刷新任务把该源标 failed 并保留旧缓存，
 * 不会把坏数据写进榜单。
 */

export interface HotlistItem {
  rank: number;
  title: string;
  url: string;
  hotValue: number | null;
  hotLabel: string | null;
  /**
   * 知乎官方接口返回的配图与摘要：解析器原样返回（与样例逐字核对）；
   * 摘要（summary）入库保存到 hotlist_entries.summary（P0-1 步骤 A），
   * 配图仍丢弃——热榜只存标题 + 链接 + 热度 + 来源侧摘要，不存正文、不存图片
   * （见 packages/store/src/repository/hotlist.ts 头注）。
   */
  thumbnailUrl?: string | null;
  summary?: string | null;
}

export interface HotlistSourceDef {
  id: string;
  name: string;
  /** 平台热榜官方页（前端「去看完整榜单」的落点，也是覆盖依据） */
  homeUrl: string;
  /** 采集方式与依据（登记给运维与复核看，不是营销文案） */
  basis: string;
  covered: boolean;
  /** covered=false 时必填：为什么没覆盖（实测结论，不许写「暂无」） */
  uncoveredReason?: string;
  endpoint?: string;
  /** 静态头，或每次请求时现算的头（知乎需要每请求的秒级时间戳 + Bearer 密钥） */
  headers?: Record<string, string> | (() => Record<string, string>);
  parse?: (json: unknown) => HotlistItem[];
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("响应不是 JSON 对象");
  return v as Record<string, unknown>;
}

function asArray(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error("响应字段不是数组");
  return v;
}

function cleanTitle(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toHotValue(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** 条目收口：标题/链接缺一丢弃，同题去重，rank 按源站顺序重排（1 起） */
function finish(items: Array<Omit<HotlistItem, "rank">>, limit = 50): HotlistItem[] {
  const seen = new Set<string>();
  const out: HotlistItem[] = [];
  for (const item of items) {
    if (!item.title || !item.url || seen.has(item.title)) continue;
    seen.add(item.title);
    out.push({ ...item, rank: out.length + 1 });
    if (out.length >= limit) break;
  }
  if (out.length === 0) throw new Error("解析出 0 条有效条目（源站形状可能已变）");
  return out;
}

/* ------------------------------- 微博热搜 ------------------------------- */

function parseWeibo(json: unknown): HotlistItem[] {
  const data = asRecord(asRecord(json).data);
  const realtime = asArray(data.realtime);
  return finish(
    realtime.map((raw) => {
      const r = asRecord(raw);
      const word = cleanTitle(r.word);
      return {
        title: word,
        url: word ? `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}` : "",
        hotValue: toHotValue(r.num),
        hotLabel: cleanTitle(r.label_name) || null,
      };
    }),
  );
}

/* ------------------------------- 百度热搜 ------------------------------- */

function parseBaidu(json: unknown): HotlistItem[] {
  const data = asRecord(asRecord(json).data);
  const cards = asArray(data.cards);
  const raw: Array<Omit<HotlistItem, "rank">> = [];
  for (const cardRaw of cards) {
    const card = asRecord(cardRaw);
    for (const groupRaw of asArray(card.content)) {
      const group = asRecord(groupRaw);
      if (!Array.isArray(group.content)) continue;
      for (const itemRaw of group.content) {
        const item = asRecord(itemRaw);
        raw.push({
          title: cleanTitle(item.word),
          url: cleanTitle(item.url),
          // wise 接口这一档不给数值热度（只有词与链接），如实留 null，不编造
          hotValue: toHotValue(item.hotScore),
          hotLabel: null,
        });
      }
    }
  }
  return finish(raw);
}

/* ------------------------------- 今日头条 ------------------------------- */

function parseToutiao(json: unknown): HotlistItem[] {
  const data = asArray(asRecord(json).data);
  return finish(
    data.map((raw) => {
      const r = asRecord(raw);
      return {
        title: cleanTitle(r.Title),
        url: cleanTitle(r.Url),
        hotValue: toHotValue(r.HotValue),
        hotLabel: cleanTitle(r.Label) || null,
      };
    }),
  );
}

/* -------------------------------- 抖音 --------------------------------- */

function parseDouyin(json: unknown): HotlistItem[] {
  const data = asRecord(asRecord(json).data);
  const wordList = asArray(data.word_list);
  return finish(
    wordList.map((raw) => {
      const r = asRecord(raw);
      const word = cleanTitle(r.word);
      return {
        title: word,
        url: word ? `https://www.douyin.com/search/${encodeURIComponent(word)}` : "",
        hotValue: toHotValue(r.hot_value),
        hotLabel: null,
      };
    }),
  );
}

/* -------------------------------- B站 ---------------------------------- */

function parseBilibili(json: unknown): HotlistItem[] {
  const root = asRecord(json);
  if (root.code !== 0) throw new Error(`B站接口返回 code=${String(root.code)}`);
  const trending = asRecord(asRecord(root.data).trending);
  const list = asArray(trending.list);
  return finish(
    list.map((raw) => {
      const r = asRecord(raw);
      const keyword = cleanTitle(r.keyword) || cleanTitle(r.show_name);
      return {
        title: keyword,
        url: keyword ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}` : "",
        hotValue: toHotValue(r.heat_score),
        hotLabel: null,
      };
    }),
  );
}

/* -------------------------------- 知乎 ---------------------------------
 *
 * 知乎数据开放平台官方 API（developer.zhihu.com/api/v1/content/hot_list，
 * Bearer Access Secret + X-Request-Timestamp 秒级时间戳），2026-11-12
 * 实测 200、30 条；2026-11-15 接线时复测仍为 200、30 条。响应每项只有
 * Title/Url/ThumbnailUrl/Summary 四字段，无数值热度——hotValue 如实留
 * null（与百度 wise 档一致），绝不编造。Url 带
 * utm_medium=openapi_platform&utm_source=<平台分配标识> 追踪参数，
 * 入库前去掉，只留干净问题链接。旧取数口径（移动端 feed 接口
 * api.zhihu.com/topstory/hot-list）已废弃：未走官方开放平台，无密钥、
 * 无额度保障，随时可能被限流，2026-11-15 起不再使用。 */

function parseZhihu(json: unknown): HotlistItem[] {
  const root = asRecord(json);
  if (root.Code !== 0) {
    throw new Error(`知乎接口返回 Code=${String(root.Code)}（${cleanTitle(root.Message)}）`);
  }
  const data = asRecord(root.Data);
  const items = asArray(data.Items);
  return finish(
    items.map((raw) => {
      const r = asRecord(raw);
      return {
        title: cleanTitle(r.Title),
        url: cleanZhihuUrl(r.Url),
        // 官方接口不返回数值热度（2026-11-12 实测：每项只有 Title/Url/ThumbnailUrl/Summary），如实留 null，不编造
        hotValue: null,
        hotLabel: null,
        thumbnailUrl: cleanTitle(r.ThumbnailUrl) || null,
        summary: cleanTitle(r.Summary) || null,
      };
    }),
  );
}

/** 只保留知乎问题页干净链接：去 utm 追踪参数，非法域名/路径直接丢弃该条 */
function cleanZhihuUrl(v: unknown): string {
  const raw = cleanTitle(v);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname !== "www.zhihu.com" || !u.pathname.startsWith("/question/")) return "";
    u.search = "";
    return u.toString();
  } catch {
    return "";
  }
}

/* ------------------------------ 源注册表 -------------------------------- */

export const HOTLIST_SOURCES: readonly HotlistSourceDef[] = [
  {
    id: "weibo",
    name: "微博热搜",
    homeUrl: "https://s.weibo.com/top/summary",
    basis: "微博网页端公开榜单接口 weibo.com/ajax/side/hotSearch（带 Referer），2026-11-11 实测 200、50 条",
    covered: true,
    endpoint: "https://weibo.com/ajax/side/hotSearch",
    headers: { Referer: "https://weibo.com/", "User-Agent": BROWSER_UA },
    parse: parseWeibo,
  },
  {
    id: "baidu",
    name: "百度热搜",
    homeUrl: "https://top.baidu.com/board?tab=realtime",
    basis: "百度风云榜公开接口 top.baidu.com/api/board，2026-11-11 实测 200",
    covered: true,
    endpoint: "https://top.baidu.com/api/board?platform=wise&tab=realtime",
    headers: { "User-Agent": BROWSER_UA },
    parse: parseBaidu,
  },
  {
    id: "toutiao",
    name: "今日头条热榜",
    homeUrl: "https://www.toutiao.com/hot-board/all/",
    basis: "头条网页端公开热榜接口 hot-event/hot-board，2026-11-11 实测 200、50 条",
    covered: true,
    endpoint: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
    headers: { "User-Agent": BROWSER_UA },
    parse: parseToutiao,
  },
  {
    id: "douyin",
    name: "抖音热榜",
    homeUrl: "https://www.douyin.com/hot",
    basis: "抖音网页端公开热榜接口 aweme/v1/web/hot/search/list（带 Referer），2026-11-11 实测 200、50 条",
    covered: true,
    endpoint: "https://www.douyin.com/aweme/v1/web/hot/search/list/",
    headers: { Referer: "https://www.douyin.com/", "User-Agent": BROWSER_UA },
    parse: parseDouyin,
  },
  {
    id: "bilibili",
    name: "B站热搜",
    homeUrl: "https://www.bilibili.com/v/popular/rank/all",
    basis: "B站官方公开接口 api.bilibili.com/x/web-interface/search/square（热搜词榜），2026-11-11 实测 200；robots 禁抓的是网页，不绕过——只用官方 API",
    covered: true,
    endpoint: "https://api.bilibili.com/x/web-interface/search/square?limit=50",
    headers: { "User-Agent": BROWSER_UA },
    parse: parseBilibili,
  },
  {
    id: "zhihu",
    name: "知乎热榜",
    homeUrl: "https://www.zhihu.com/hot",
    basis:
      "知乎数据开放平台官方 API developer.zhihu.com/api/v1/content/hot_list（Bearer Access Secret + X-Request-Timestamp 秒级时间戳），2026-11-12 实测 200、30 条；响应无数值热度，hotValue 留 null（与百度 wise 档一致）；免费额度口径不一（官网 5000/天、第三方 1000/天、开源实测热榜 100/天），按保守 100 次/天估算，每小时 1 次 = 24 次/天；超额后 10 元/千次——熔断，绝不自动转付费",
    covered: true,
    endpoint: "https://developer.zhihu.com/api/v1/content/hot_list?Limit=30",
    headers: () => {
      const secret = (process.env.NAVHUB_ZHIHU_ACCESS_SECRET ?? "").trim();
      if (!secret) {
        throw new Error("知乎热榜未配置 Access Secret（环境变量 NAVHUB_ZHIHU_ACCESS_SECRET 缺失）");
      }
      return {
        Authorization: `Bearer ${secret}`,
        "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
        "Content-Type": "application/json",
      };
    },
    parse: parseZhihu,
  },
  {
    id: "kuaishou",
    name: "快手热榜",
    homeUrl: "https://www.kuaishou.com/?isHome=1",
    basis: "逐源核查：无公开 JSON 榜单接口（2026-11-12 复核）",
    covered: false,
    uncoveredReason:
      "快手无官方公开热榜接口、无免登录取数路径：官网为前端渲染、GraphQL 需会话凭据，2026-11-11 实测连接失败；2026-11-12 复核仍无官方开放接口，只有付费第三方聚合（SandBase / TikHub / Scavio，按调用约 $0.001–0.002/次、需另购 key），未接入——暂未覆盖，等官方开放接口再补",
  },
];

export function hotlistSourceById(id: string): HotlistSourceDef | undefined {
  return HOTLIST_SOURCES.find((s) => s.id === id);
}
