/**
 * drama-featured.json 新鲜度哨兵（U-378 小步）。
 *
 * parseDramaFeatured 读顶层 updatedAt：超过 DRAMA_FEATURED_MAX_AGE_DAYS（3 天）
 * 未更新即 updatedAtStale，实盘文件组断言它为 false——过期即红。
 * N = 3 的理由见 src/lib/drama-featured.ts（历史最大更新间隔 2 天 + 1 天宽限）。
 *
 * R7 证伪（2026-11-22）：实盘 updatedAt 2026-11-18，距今 4 天 > 3 天，
 * “实盘文件”一组在证伪运行时红，证明哨兵真会拦；中步真正重核 18 部剧
 * 并刷新数据后它转绿。不要只改时间戳把它哄绿——那是假新鲜度。
 */
import { describe, expect, it } from "vitest";
import {
  DRAMA_FEATURED_MAX_AGE_DAYS,
  dramaFeaturedAgeDays,
  isDramaFeaturedUpdatedAtStale,
  loadDramaFeatured,
  parseDramaFeatured,
  parseDramaFeaturedUpdatedAt,
} from "../src/lib/drama-featured.ts";

// 固定“今天”= 2026-11-22（UTC 午夜 = 北京时间 11-22 08:00，上海日历日同为 11-22）；纯函数组不依赖真实时钟。
const NOW = Date.UTC(2026, 10, 22);
const DAY_MS = 86_400_000;
const isoDate = (utcMs: number): string =>
  new Date(utcMs).toISOString().slice(0, 10);
const daysAgo = (n: number): string => isoDate(NOW - n * DAY_MS);

const goodEntry = {
  title: "示例剧",
  platformSiteId: "nav-557388e01d50",
  platformTitle: "红果短剧",
  url: "https://example.com/drama",
  linkNote: "剧目页",
  episodesKnown: 10,
  totalEpisodes: null,
  check: { kind: "none", reason: "示例：剧目页不含集数" },
};

function rawWithUpdatedAt(updatedAt: unknown) {
  return { version: 1, updatedAt, dramas: [goodEntry] };
}

describe("drama-featured 新鲜度哨兵：纯函数", () => {
  it("N = 3 天（历史最大更新间隔 2 天 + 1 天宽限）", () => {
    expect(DRAMA_FEATURED_MAX_AGE_DAYS).toBe(3);
  });

  it("updatedAt 只收合法日期：日期归一化、非法为 null", () => {
    expect(parseDramaFeaturedUpdatedAt("2026-11-18")).toBe("2026-11-18");
    // 带时区的 ISO 时间按 Asia/Shanghai 取日（本站日期口径）。
    expect(parseDramaFeaturedUpdatedAt("2026-11-18T10:00:00+08:00")).toBe(
      "2026-11-18",
    );
    expect(parseDramaFeaturedUpdatedAt("2026-11-18T00:30:00+08:00")).toBe(
      "2026-11-18",
    );
    expect(parseDramaFeaturedUpdatedAt("2026-11-17T23:30:00Z")).toBe(
      "2026-11-18",
    );
    expect(parseDramaFeaturedUpdatedAt("not-a-date")).toBeNull();
    expect(parseDramaFeaturedUpdatedAt("2026-02-30")).toBeNull();
    expect(parseDramaFeaturedUpdatedAt("2026-13-01")).toBeNull();
    expect(parseDramaFeaturedUpdatedAt("")).toBeNull();
    expect(parseDramaFeaturedUpdatedAt(123)).toBeNull();
    expect(parseDramaFeaturedUpdatedAt(undefined)).toBeNull();
  });

  it("天数按 Asia/Shanghai 自然日算：今天 0 天、3 天整新鲜、4 天过期", () => {
    expect(dramaFeaturedAgeDays(daysAgo(0), NOW)).toBe(0);
    expect(dramaFeaturedAgeDays(daysAgo(3), NOW)).toBe(3);
    expect(dramaFeaturedAgeDays(daysAgo(4), NOW)).toBe(4);
    expect(dramaFeaturedAgeDays(null, NOW)).toBeNull();
    // 未来日期为负数，不算过期（不惩罚时钟偏差）。
    expect(dramaFeaturedAgeDays(isoDate(NOW + DAY_MS), NOW)).toBe(-1);
  });

  it("时区回归：北京时间 11-22 凌晨仍算 11-22，不许按 UTC 少算一天", () => {
    // 2026-11-22 03:19 CST = UTC 11-21 19:19。UTC 口径下 11-18 只隔 3 天
    // （新鲜），上海口径隔 4 天（过期）；本站日期口径是后者，R7 第一轮
    // 曾因此全绿——哨兵没红不是数据新鲜，是时区算错了。
    const cstEarlyMorning = Date.parse("2026-11-22T03:19:26+08:00");
    expect(dramaFeaturedAgeDays("2026-11-18", cstEarlyMorning)).toBe(4);
    expect(
      isDramaFeaturedUpdatedAtStale("2026-11-18", cstEarlyMorning),
    ).toBe(true);
    expect(
      parseDramaFeatured(rawWithUpdatedAt("2026-11-18"), cstEarlyMorning)
        .updatedAtStale,
    ).toBe(true);
  });

  it("过期判定：3 天整新鲜、4 天过期、缺失/非法按过期处理", () => {
    expect(isDramaFeaturedUpdatedAtStale(daysAgo(0), NOW)).toBe(false);
    expect(isDramaFeaturedUpdatedAtStale(daysAgo(3), NOW)).toBe(false);
    expect(isDramaFeaturedUpdatedAtStale(daysAgo(4), NOW)).toBe(true);
    expect(isDramaFeaturedUpdatedAtStale(null, NOW)).toBe(true);
  });

  it("parseDramaFeatured：新鲜数据绿、过期数据红，但哨兵不丢剧目行", () => {
    const fresh = parseDramaFeatured(rawWithUpdatedAt(daysAgo(0)), NOW);
    expect(fresh.updatedAt).toBe("2026-11-22");
    expect(fresh.updatedAtStale).toBe(false);
    expect(fresh.dramas).toHaveLength(1);
    expect(fresh.skipped).toBe(0);

    const boundary = parseDramaFeatured(rawWithUpdatedAt(daysAgo(3)), NOW);
    expect(boundary.updatedAtStale).toBe(false);

    const stale = parseDramaFeatured(rawWithUpdatedAt(daysAgo(4)), NOW);
    expect(stale.updatedAt).toBe("2026-11-18");
    expect(stale.updatedAtStale).toBe(true);
    // 哨兵只报过期：剧目照常解析，不因此少一部。
    expect(stale.dramas).toHaveLength(1);
    expect(stale.skipped).toBe(0);
  });

  it("parseDramaFeatured：updatedAt 缺失/非法时 stale 为 true", () => {
    expect(parseDramaFeatured({ dramas: [goodEntry] }, NOW).updatedAt).toBeNull();
    expect(
      parseDramaFeatured({ dramas: [goodEntry] }, NOW).updatedAtStale,
    ).toBe(true);
    expect(
      parseDramaFeatured(rawWithUpdatedAt("not-a-date"), NOW).updatedAtStale,
    ).toBe(true);
    expect(parseDramaFeatured(null, NOW)).toEqual({
      dramas: [],
      skipped: 0,
      updatedAt: null,
      updatedAtStale: true,
    });
  });
});

describe("drama-featured 新鲜度哨兵：实盘文件", () => {
  it("drama-featured.json 的 updatedAt 在 3 天内（过期即红）", () => {
    const loaded = loadDramaFeatured();
    // 不 pin 具体日期：中步刷新数据后 updatedAt 会变，只要新鲜就绿。
    // R7 证伪日（2026-11-22）实盘 updatedAt 为 2026-11-18，已 4 天，本组红。
    expect(loaded.updatedAt).not.toBeNull();
    expect(
      loaded.updatedAtStale,
      `drama-featured.json 已过期：updatedAt ${loaded.updatedAt}，` +
        `距今 ${dramaFeaturedAgeDays(loaded.updatedAt)} 天，` +
        `超过 ${DRAMA_FEATURED_MAX_AGE_DAYS} 天上限——` +
        `请中步重核 18 部剧并刷新数据，不要只改时间戳`,
    ).toBe(false);
    expect(loaded.dramas).toHaveLength(18);
  });
});
