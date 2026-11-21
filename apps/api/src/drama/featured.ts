/**
 * 短剧精选数据（drama-featured.json）的服务端读取。
 *
 * 校验规则与前端 apps/web-overlay/src/lib/drama-featured.ts 保持一致：
 * 坏行跳过并计数、上限 18 部。剧名归一化与 drama_key 必须与前端
 * lib/watchlist.ts 的 dramaKeyFor 完全一致，否则检查器算出的键
 * 对不上用户关注的键——改算法时两边要一起改。
 */
import { existsSync, readFileSync} from "node:fs";
import { dirname, join, resolve} from "node:path";
import { fileURLToPath} from "node:url";

export type DramaCheckKind = "migu-list" | "wikipedia" | "ranking" | "zongyimi-subject" | "soduanju-subject" | "none";

export interface DramaCheck {
 kind: DramaCheckKind;
 url?: string;
 titleMatch?: string;
 reason?: string;
}

export type DramaLinkNote = "剧目页" | "榜单页" | "报道页" | "百科页";

export interface DramaFeatured {
 title: string;
 platformSiteId: string;
 platformTitle: string;
 url: string;
 linkNote: DramaLinkNote;
 episodesKnown: number | null;
 totalEpisodes: number | null;
 /** 题材标签（核实过的才填；详情页首个标签 chip 为主 题材；没核实的留空）。 */
 genres?: string[];
 check: DramaCheck;
}

export const DRAMA_FEATURED_MAX = 18;

/**
 * 新鲜度哨兵（U-378 小步，与前端 apps/web-overlay/src/lib/drama-featured.ts
 * 保持一致，改算法时两边一起改）：drama-featured.json 顶层的 updatedAt
 * 是“热门”榜单上次被人工复核 / 刷新的日期；短剧日更、榜单声称当日热度，
 * 超过 N 天不更新即视为过期，测试里红。
 *
 * N = 3 的理由（2026-11-22 定）：本文件自身的维护节律里，两次更新之间
 * 最长只隔 2 天（updatedAt 2026-11-14 → 11-15 → 11-17 → 11-18）；新集
 * 检查任务每天跑一轮（intervalMs 86_400_000）；N 取历史最大间隔 2 天 +
 * 1 天宽限，3 天整仍算新鲜，第 4 天起过期。实盘现状 updatedAt 2026-11-18，
 * 截至 2026-11-22 已 4 天，哨兵应红——绿它的办法是中步真正重核 18 部剧
 * 并刷新数据，不是改这个数字、不是只改时间戳。updatedAt 只有日粒度，
 * 按 Asia/Shanghai 自然日算整天数（本站日期口径，见 brief.ts
 * BRIEF_TIME_ZONE / drama/calendar.ts：源站是中国站、榜单日期是北京时间；
 * 按 UTC 算会在北京时间上午少算一天——2026-11-22 03:19 CST 是 UTC 11-21，
 * UTC 口径下 11-18 只算 3 天，上海口径算 4 天，后者才符合实盘判断）；
 * 缺失 / 非法按过期处理（fail-closed）。
 */
export const DRAMA_FEATURED_MAX_AGE_DAYS = 3;

const DAY_MS = 86_400_000;

/** 本站日期口径：now 落在 Asia/Shanghai 的哪一天（YYYY-MM-DD），与 brief/calendar 一致。 */
const shanghaiDateFmt = new Intl.DateTimeFormat("en-CA", {
 timeZone: "Asia/Shanghai",
 year: "numeric",
 month: "2-digit",
 day: "2-digit",
});

function shanghaiDateKey(now: Date | number): string {
 return shanghaiDateFmt.format(new Date(now));
}

/** 接受 YYYY-MM-DD 或 ISO 日期时间；返回归一化的日期（YYYY-MM-DD，ISO 时间按 Asia/Shanghai 取日），非法返回 null。 */
export function parseDramaFeaturedUpdatedAt(value: unknown): string | null {
 if (typeof value !== "string") return null;
 const text = value.trim();
 if (text.length === 0) return null;
 const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
 if (dateOnly !== null) {
 const year = Number(dateOnly[1]);
 const month = Number(dateOnly[2]);
 const day = Number(dateOnly[3]);
 const ms = Date.UTC(year, month - 1, day);
 const check = new Date(ms);
 if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
 return null;
}
 return text;
}
 const ms = Date.parse(text);
 if (!Number.isFinite(ms)) return null;
 return shanghaiDateKey(ms);
}

/** updatedAt 距 now 的整天数（Asia/Shanghai 自然日之差）；updatedAt 缺失 / 非法返回 null；未来日期为负数。 */
export function dramaFeaturedAgeDays(updatedAt: string | null, now: Date | number = new Date()): number | null {
 if (updatedAt === null) return null;
 const updatedMs = Date.parse(`${updatedAt}T00:00:00.000Z`);
 if (!Number.isFinite(updatedMs)) return null;
 const nowMs = Date.parse(`${shanghaiDateKey(now)}T00:00:00.000Z`);
 return Math.floor((nowMs - updatedMs) / DAY_MS);
}

/** 超过 DRAMA_FEATURED_MAX_AGE_DAYS 天未更新、或 updatedAt 缺失 / 非法，即过期。 */
export function isDramaFeaturedUpdatedAtStale(updatedAt: string | null, now: Date | number = new Date()): boolean {
 const age = dramaFeaturedAgeDays(updatedAt, now);
 return age === null || age > DRAMA_FEATURED_MAX_AGE_DAYS;
}

/** 与前端 lib/watchlist.ts 的 normalizeDramaTitle 保持一致（不要改算法）。 */
export function normalizeDramaTitle(title: string): string {
 return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 与前端 lib/watchlist.ts 的 dramaKeyFor 保持一致。 */
export function dramaKeyFor(platformSiteId: string, title: string): string {
 return `${platformSiteId}::${normalizeDramaTitle(title)}`;
}

const CHECK_KINDS: ReadonlySet<string> = new Set([
 "migu-list",
 "wikipedia",
 "ranking",
 "zongyimi-subject",
 "soduanju-subject",
 "none",
]);
const LINK_NOTES: ReadonlySet<string> = new Set([
 "剧目页",
 "榜单页",
 "报道页",
 "百科页",
]);

function isHttps(value: unknown): value is string {
 return typeof value === "string" && value.startsWith("https://");
}

function isEpisodeCount(value: unknown): value is number | null {
 return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100000);
}

export function parseDramaFeatured(value: unknown, now: Date | number = new Date()): { dramas: DramaFeatured[]; skipped: number; updatedAt: string | null; updatedAtStale: boolean } {
 const updatedAt = (value !== null && typeof value === "object" && !Array.isArray(value)) ? parseDramaFeaturedUpdatedAt((value as Record<string, unknown>).updatedAt) : null;
 const updatedAtStale = isDramaFeaturedUpdatedAtStale(updatedAt, now);
 const list = (value as { dramas?: unknown} | null)?.dramas;
 if (!Array.isArray(list)) return { dramas: [], skipped: 0, updatedAt, updatedAtStale };
 const dramas: DramaFeatured[] = [];
 let skipped = 0;
 for (const item of list) {
 if (dramas.length >= DRAMA_FEATURED_MAX) break;
 const row = item as Record<string, unknown>;
 const check = row?.check as Record<string, unknown> | undefined;
 const kind = typeof check?.kind === "string"? check.kind: "";
 const valid =
 row!== null && typeof row === "object" &&
 typeof row.title === "string" && row.title.trim().length > 0 && row.title.length <= 80 &&
 typeof row.platformSiteId === "string" && row.platformSiteId.length > 0 &&
 typeof row.platformTitle === "string" && row.platformTitle.length > 0 &&
 isHttps(row.url) &&
 typeof row.linkNote === "string" && LINK_NOTES.has(row.linkNote) &&
 isEpisodeCount(row.episodesKnown) &&
 isEpisodeCount(row.totalEpisodes) &&
 (row.totalEpisodes === null || row.episodesKnown === null || ((row.totalEpisodes as number) >= (row.episodesKnown as number))) &&
 check!== undefined && typeof check === "object" &&
 CHECK_KINDS.has(kind) &&
 (kind === "none"? typeof check.reason === "string" && check.reason.length > 0: isHttps(check.url));
 if (!valid) {
 skipped += 1;
 continue;
}
 dramas.push({
 title: row.title as string,
 platformSiteId: row.platformSiteId as string,
 platformTitle: row.platformTitle as string,
 url: row.url as string,
 linkNote: row.linkNote as DramaLinkNote,
 episodesKnown: row.episodesKnown as number | null,
 totalEpisodes: row.totalEpisodes as number | null,
 check: {
 kind: kind as DramaCheckKind,
 url: typeof check.url === "string"? check.url: undefined,
 titleMatch: typeof check.titleMatch === "string"? check.titleMatch: undefined,
 reason: typeof check.reason === "string"? check.reason: undefined,
},
});
}
 return { dramas, skipped, updatedAt, updatedAtStale };
}

const FEATURED_REL_PATH = "apps/web-overlay/src/navsphere/content/drama-featured.json";

/** 按 NAVHUB_REPO_ROOT、工作目录、本模块位置依次找数据文件，不存在返回 null。 */
export function resolveDramaFeaturedPath(): string | null {
 const candidates: string[] = [];
 const envRoot = process.env.NAVHUB_REPO_ROOT;
 if (envRoot) candidates.push(join(envRoot, FEATURED_REL_PATH));
 let dir = resolve(process.cwd());
 for (let i = 0; i < 6; i++) {
 candidates.push(join(dir, FEATURED_REL_PATH));
 const parent = dirname(dir);
 if (parent === dir) break;
 dir = parent;
}
 candidates.push(join(dirname(fileURLToPath(import.meta.url)), "../../../", FEATURED_REL_PATH));
 for (const candidate of candidates) {
 if (existsSync(candidate)) return candidate;
}
 return null;
}

export interface LoadDramaFeaturedOptions {
 readFile?: (path: string) => string;
 featuredPath?: string;
 repoRoot?: string;
 /** 仅供测试注入“今天”，默认真实当前时间。 */
 now?: Date | number;
}

/** 读数据文件并校验；文件缺失或 JSON 损坏时返回空列表与错误，不抛错。 */
export function loadDramaFeaturedForCheck(options: LoadDramaFeaturedOptions = {}): {
 dramas: DramaFeatured[];
 skipped: number;
 path: string | null;
 updatedAt: string | null;
 updatedAtStale: boolean;
 error?: string;
} {
 const readFile = options.readFile?? ((path: string) => readFileSync(path, "utf8"));
 const path = options.featuredPath?? (options.repoRoot? join(options.repoRoot, FEATURED_REL_PATH): resolveDramaFeaturedPath());
 const now = options.now?? new Date();
 if (!path) return { dramas: [], skipped: 0, path: null, updatedAt: null, updatedAtStale: true, error: "找不到 drama-featured.json"};
 let raw: string;
 try {
 raw = readFile(path);
} catch (error) {
 return { dramas: [], skipped: 0, path, updatedAt: null, updatedAtStale: true, error: error instanceof Error? error.message: String(error)};
}
 let parsed: unknown;
 try {
 parsed = JSON.parse(raw);
} catch (error) {
 return { dramas: [], skipped: 0, path, updatedAt: null, updatedAtStale: true, error: error instanceof Error? error.message: String(error)};
}
 const { dramas, skipped, updatedAt, updatedAtStale } = parseDramaFeatured(parsed, now);
 return { dramas, skipped, path, updatedAt, updatedAtStale };
}
