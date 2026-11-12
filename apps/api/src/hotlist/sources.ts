/**
 * 全网热榜源注册表 + 逐源解析器。
 *
 * William 拍板口径（2026-11-11）：全量聚合——能聚的平台都聚上；个别明确
 * 禁抓的源用其公开接口或官方榜单页尽量补齐；只存标题 + 链接 + 热度值，
 * 不搬运正文。逐源登记「方式与依据」，拿不到的源如实登记未覆盖及原因，
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
  headers?: Record<string, string>;
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
 * 2026-11-11 的旧结论（v3 接口 api/v3/feed/topstory/hot-lists/total 实测
 * 401）只针对那条需登录的路径；2026-11-12 复核发现热榜页自身的移动端
 * feed 接口 api.zhihu.com/topstory/hot-list 免登录返回 200（本机浏览器
 * 实测，当日榜首「网传腾讯裁员 15-20%」等条目逐字对上），改用这条。
 * 只取 target.title / target.id（拼站内问题链接）/ detail_text 热度，
 * 响应里的 excerpt 摘要、正文一律不存、不搬运。 */

function parseZhihuHeat(detailText: unknown): number | null {
  if (typeof detailText !== "string") return null;
  const wan = detailText.match(/([\d.]+)\s*万/);
  if (wan) {
    const n = Number(wan[1]);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n * 10000) : null;
  }
  const plain = detailText.match(/([\d.]+)/);
  if (!plain) return null;
  return toHotValue(plain[1]);
}

const ZHIHU_LABEL: Record<string, string> = { boiling: "沸", hot: "热", new: "新" };

function parseZhihu(json: unknown): HotlistItem[] {
  const data = asArray(asRecord(json).data);
  return finish(
    data.map((raw) => {
      const r = asRecord(raw);
      const target = asRecord(r.target);
      // 问题 id 超过 2^53（JSON.parse 后尾数会被舍入），不能走数值 id；
      // 源站给的 target.url 是字符串，末尾的数字 id 精确无损，从这里取
      const urlId = typeof target.url === "string" ? target.url.match(/\/questions\/(\d+)/)?.[1] ?? "" : "";
      const id = urlId || (target.id === undefined || target.id === null ? "" : String(target.id));
      // 标题里常带换行/多空格（源站原样返回），折成单空格再展示
      const title = cleanTitle(target.title).replace(/\s+/g, " ");
      const labelRaw = r.card_label === undefined || r.card_label === null ? null : asRecord(r.card_label).type;
      return {
        title,
        url: id ? `https://www.zhihu.com/question/${encodeURIComponent(id)}` : "",
        hotValue: parseZhihuHeat(r.detail_text),
        hotLabel: typeof labelRaw === "string" ? (ZHIHU_LABEL[labelRaw] ?? null) : null,
      };
    }),
  );
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
      "知乎热榜页移动端 feed 接口 api.zhihu.com/topstory/hot-list，2026-11-12 实测免登录返回 200（此前 2026-11-11 测的 v3 接口 api/v3/feed/topstory/hot-lists/total 返回 401，那条需登录，不用它）；只存标题 + 链接 + 热度，不存 excerpt/正文",
    covered: true,
    endpoint: "https://api.zhihu.com/topstory/hot-list",
    headers: { Referer: "https://www.zhihu.com/", "User-Agent": BROWSER_UA },
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
