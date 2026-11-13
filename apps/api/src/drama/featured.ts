/**
 * 短剧精选数据（drama-featured.json）的服务端读取。
 *
 * 校验规则与前端 apps/web-overlay/src/lib/drama-featured.ts 保持一致：
 * 坏行跳过并计数、上限 12 部。剧名归一化与 drama_key 必须与前端
 * lib/watchlist.ts 的 dramaKeyFor 完全一致，否则检查器算出的键
 * 对不上用户关注的键——改算法时两边要一起改。
 */
import { existsSync, readFileSync} from "node:fs";
import { dirname, join, resolve} from "node:path";
import { fileURLToPath} from "node:url";

export type DramaCheckKind = "migu-list" | "wikipedia" | "ranking" | "none";

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
 check: DramaCheck;
}

export const DRAMA_FEATURED_MAX = 12;

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

export function parseDramaFeatured(value: unknown): { dramas: DramaFeatured[]; skipped: number} {
 const list = (value as { dramas?: unknown} | null)?.dramas;
 if (!Array.isArray(list)) return { dramas: [], skipped: 0};
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
 return { dramas, skipped};
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
}

/** 读数据文件并校验；文件缺失或 JSON 损坏时返回空列表与错误，不抛错。 */
export function loadDramaFeaturedForCheck(options: LoadDramaFeaturedOptions = {}): {
 dramas: DramaFeatured[];
 skipped: number;
 path: string | null;
 error?: string;
} {
 const readFile = options.readFile?? ((path: string) => readFileSync(path, "utf8"));
 const path = options.featuredPath?? (options.repoRoot? join(options.repoRoot, FEATURED_REL_PATH): resolveDramaFeaturedPath());
 if (!path) return { dramas: [], skipped: 0, path: null, error: "找不到 drama-featured.json"};
 let raw: string;
 try {
 raw = readFile(path);
} catch (error) {
 return { dramas: [], skipped: 0, path, error: error instanceof Error? error.message: String(error)};
}
 let parsed: unknown;
 try {
 parsed = JSON.parse(raw);
} catch (error) {
 return { dramas: [], skipped: 0, path, error: error instanceof Error? error.message: String(error)};
}
 const { dramas, skipped} = parseDramaFeatured(parsed);
 return { dramas, skipped, path};
}
