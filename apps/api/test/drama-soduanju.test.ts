/**
 * 搜短剧详情页解析测试（U-D3）。
 *
 * 固件说明：完结样本的 meta 行与徽章逐字取自 2026-11-17 实测的真实详情页
 * （王妈 86 集、卖掉养老房 64 集、人下魂魂 75 集）；连载样本是合成的——
 * “更新至第 N 集”写法尚未观测到真实样本（探针 10 样本均为已完结），
 * 仅作备用模式的防卫性覆盖。
 */
import { describe, expect, it } from "vitest";
import { parseSoduanjuSubject } from "../src/drama/soduanju.ts";

/** 真实详情页的 meta 行骨架（class 与分隔符逐字保留）。 */
function detailHtml(opts: {
  title: string;
  episodesLine: string;
  date: string;
  finished: boolean;
}): string {
  return (
    `<div class="card mt-4 px-4 py-4 sm:px-5">` +
    `<h2 class="text-xl font-semibold text-slate-900 dark:text-navy-50 lg:text-2xl">${opts.title}</h2>` +
    `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-navy-300">` +
    `<span>红果短剧</span>` +
    `<span class="text-slate-300 dark:text-navy-500">·</span><span>${opts.episodesLine}</span>` +
    `<span class="text-slate-300 dark:text-navy-500">·</span><span>${opts.date}</span>` +
    `<span class="text-slate-300 dark:text-navy-500">·</span><span>总时长 2小时46分</span>` +
    `</div></div>` +
    (opts.finished
      ? `<div class="mt-2 flex items-center justify-between text-xs">` +
        `<span class="font-medium text-primary dark:text-accent-light">已完结</span>` +
        `<span class="text-slate-400 dark:text-navy-300">红果短剧</span></div>`
      : "") +
    // 真实页里“全 N 集”会出现两次（meta 行 + 标题区），值相同。
    `<div>${opts.episodesLine}</div>`
  );
}

describe("parseSoduanjuSubject", () => {
  it("已完结剧：全集数 + finished + 上映日（王妈 86 集，真实值）", () => {
    const info = parseSoduanjuSubject(
      detailHtml({
        title: "王妈在顾家当保姆后全家只会搞笑了",
        episodesLine: "全 86 集",
        date: "2026-10-09",
        finished: true,
      }),
    );
    expect(info).toEqual({ episodes: 86, finished: true, releasedAt: "2026-10-09" });
  });

  it("已完结剧：卖掉养老房 64 集、人下魂魂 75 集（真实值）", () => {
    expect(
      parseSoduanjuSubject(
        detailHtml({ title: "卖掉养老房那天，我重获新生", episodesLine: "全 64 集", date: "2026-10-20", finished: true }),
      ),
    ).toEqual({ episodes: 64, finished: true, releasedAt: "2026-10-20" });
    expect(
      parseSoduanjuSubject(
        detailHtml({ title: "人下魂魂老爹我一路青云", episodesLine: "全 75 集", date: "2026-09-18", finished: true }),
      ),
    ).toEqual({ episodes: 75, finished: true, releasedAt: "2026-09-18" });
  });

  it("连载剧备用模式：更新至第 N 集（合成样本，未观测到真实样本）", () => {
    const info = parseSoduanjuSubject(
      detailHtml({
        title: "合成连载剧",
        episodesLine: "更新至第 12 集",
        date: "2026-11-01",
        finished: false,
      }),
    );
    expect(info).toEqual({ episodes: 12, finished: false, releasedAt: null });
  });

  it("同一页多个不一致集数时返回 null（不挑一个当真的）", () => {
    const html =
      `<span>全 86 集</span><span>·</span><span>2026-10-09</span>` +
      `<div>相关推荐：全 50 集</div>`;
    expect(parseSoduanjuSubject(html)).toBeNull();
  });

  it("空壳详情页（无集数）返回 null", () => {
    expect(
      parseSoduanjuSubject(
        `<html><head><title>满院亲戚第七季</title></head><body><h2>满院亲戚第七季</h2></body></html>`,
      ),
    ).toBeNull();
  });

  it("没有上映日时 releasedAt 为 null，集数照常返回", () => {
    const html =
      `<span class="font-medium text-primary dark:text-accent-light">已完结</span>` +
      `<span>全 30 集</span>`;
    expect(parseSoduanjuSubject(html)).toEqual({
      episodes: 30,
      finished: true,
      releasedAt: null,
    });
  });
});
