/**
 * GitHub 热力小卡的取数/算分保证。
 *
 * 这张卡片以前整块是 `Math.sin` 造的假贡献记录，默认用户名写死且界面上改不了。
 * 重写后数字来自公开事件 API，所以要把「API 边界决定了文案能说什么」的那些规则钉住：
 *  1. 提交数按**本地**日期归集（按 UTC 切片会把晚间 push 记到前一天）；
 *  2. 矩阵周日对齐、今天所在列的尾巴是 future 空格，不参与总数与打卡；
 *  3. 今天还没过完，0 次不算断签；
 *  4. 拿满 300 条且最早一条仍在 90 天窗内 = 事件流被截断，必须能报出来；
 *  5. 404/403/429/202/网络异常各自有独立 reason，组件才能诚实显示而不是退回假数据。
 */
import { describe, expect, it } from "vitest";

import {
  HEATMAP_WEEKS,
  aggregatePushCommits,
  buildHeatmap,
  fetchPublicPushEvents,
  isValidGithubUsername,
  levelFor,
  levelThresholds,
  localDateKey,
  simulateCounts,
} from "../src/lib/modular/github-heatmap";

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 相对某个 now 往前推 n 天的本地日期键 */
function daysBefore(now: Date, n: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - n);
  return localDateKey(d);
}

function pushEvent(createdIso: string, commitCount: number): Record<string, unknown> {
  return {
    type: "PushEvent",
    created_at: createdIso,
    payload: { commits: Array.from({ length: commitCount }, (_, i) => ({ sha: String(i) })) },
  };
}

describe("aggregatePushCommits：只认真实 PushEvent 的 commits", () => {
  it("按本地日期归集，非 PushEvent / 脏数据逐条忽略", () => {
    const events = [
      pushEvent("2026-10-10T08:00:00Z", 3),
      { type: "WatchEvent", created_at: "2026-10-10T09:00:00Z", payload: { action: "started" } },
      { type: "PushEvent", created_at: "not-a-date", payload: { commits: [{}] } },
      { type: "PushEvent", created_at: "2026-10-10T10:00:00Z" },
      { type: "PushEvent", created_at: "2026-10-10T11:00:00Z", payload: { commits: "oops" } },
      { type: "PushEvent", created_at: "2026-10-10T12:00:00Z", payload: { commits: [] } },
      null,
      "junk",
    ];
    const counts = aggregatePushCommits(events);
    // 只有第一条有效：3 次提交，其它脏输入不能崩也不能计 0 之外的数
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(3);
    expect(counts.size).toBe(1);
  });

  it("同一天多个 push 累加", () => {
    const counts = aggregatePushCommits([
      pushEvent("2026-10-10T01:00:00Z", 2),
      pushEvent("2026-10-10T23:00:00Z", 5),
      pushEvent("2026-10-11T02:00:00Z", 1),
    ]);
    expect(counts.get(localDateKey(new Date("2026-10-10T01:00:00Z")))).toBeGreaterThanOrEqual(2);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("跨本地午夜的晚间提交记在本机日期，不能按 UTC 切片", () => {
    const ts = "2026-10-20T23:30:00Z";
    const local = localDateKey(new Date(ts));
    const utc = ts.slice(0, 10);
    const counts = aggregatePushCommits([pushEvent(ts, 4)]);
    expect(counts.has(local)).toBe(true);
    // 只有当本机时区让两种表示确实不同时才断言「不是 UTC 那天」，
    // 在 UTC 机器上这条断言没有意义，不能假通过。
    if (local !== utc) expect(counts.has(utc)).toBe(false);
  });

  it("空输入返回空表而不是抛错", () => {
    expect(aggregatePushCommits([]).size).toBe(0);
  });
});

describe("levelThresholds / levelFor：色阶按这份数据自己的分布", () => {
  it("无活动 → 退回 [1,2,3]，全 0 数据不会得到 level>0", () => {
    expect(levelThresholds([])).toEqual([1, 2, 3]);
    expect(levelFor(0, levelThresholds([0, 0, 0]))).toBe(0);
  });

  it("阈值严格递增，即使全部同值", () => {
    const t = levelThresholds([5, 5, 5, 5, 5]);
    expect(t[0]).toBeLessThan(t[1]);
    expect(t[1]).toBeLessThan(t[2]);
    expect(t[0]).toBeGreaterThanOrEqual(1);
  });

  it("档位边界：<=t1 为 1，>t3 为 4", () => {
    const t = levelThresholds([1, 2, 4, 8, 20]);
    expect(levelFor(0, t)).toBe(0);
    expect(levelFor(t[0], t)).toBe(1);
    expect(levelFor(t[0] + 1, t)).toBeLessThanOrEqual(2);
    expect(levelFor(t[2], t)).toBe(3);
    expect(levelFor(t[2] + 1, t)).toBe(4);
    for (const c of [1, 2, 4, 8, 20]) expect(levelFor(c, t)).toBeGreaterThan(0);
  });
});

describe("buildHeatmap：周日对齐 + future 格不参与统计", () => {
  const now = new Date(2026, 9, 15, 13, 45); // 固定「今天」，避免测试随真实日期漂移

  it("列 0 行 0 是周日，今天在最后一列的 getDay() 行", () => {
    const data = buildHeatmap(new Map(), { now });
    expect(data.weeks.length).toBe(HEATMAP_WEEKS);
    expect(parseKey(data.weeks[0][0].date).getDay()).toBe(0);
    const last = data.weeks[data.weeks.length - 1];
    const todayCell = last[now.getDay()];
    expect(todayCell.date).toBe(localDateKey(now));
    expect(todayCell.future ?? false).toBe(false);
    // 今天之后到本周结束都是 future 占位
    for (let d = now.getDay() + 1; d < 7; d++) expect(last[d].future).toBe(true);
  });

  it("future 日期即使 counts 里有也不计总数/活跃天", () => {
    const futureKey = daysBefore(now, -2); // 今天往后 2 天，落在同一列的尾巴
    const counts = new Map([
      [futureKey, 9],
      [daysBefore(now, 1), 2],
    ]);
    const data = buildHeatmap(counts, { now });
    expect(data.totalCommits).toBe(2);
    expect(data.activeDays).toBe(1);
    expect(data.coveredTo).toBe(localDateKey(now));
    expect(data.weeks.flat().find((c) => c.date === futureKey)?.count).toBe(0);
  });

  it("今天 0 次不算断签；隔一天才断", () => {
    const withActivity = new Map([
      [daysBefore(now, 1), 1],
      [daysBefore(now, 2), 3],
    ]);
    expect(buildHeatmap(withActivity, { now }).currentStreak).toBe(2);

    const gap = new Map([
      [daysBefore(now, 1), 1],
      [daysBefore(now, 3), 3],
    ]);
    expect(buildHeatmap(gap, { now }).currentStreak).toBe(1);

    const none = new Map([[daysBefore(now, 5), 4]]);
    expect(buildHeatmap(none, { now }).currentStreak).toBe(0);
  });

  it("longestStreak 取最长连续段，totalCommits/maxDaily 与数据一致", () => {
    const counts = new Map<string, number>([
      [daysBefore(now, 10), 1],
      [daysBefore(now, 9), 2],
      [daysBefore(now, 8), 7],
      [daysBefore(now, 7), 1],
      [daysBefore(now, 5), 4],
    ]);
    const data = buildHeatmap(counts, { now });
    expect(data.longestStreak).toBe(4);
    expect(data.totalCommits).toBe(15);
    expect(data.maxDaily).toBe(7);
    expect(data.activeDays).toBe(5);
    expect(data.coveredFrom).toBe(daysBefore(now, (HEATMAP_WEEKS - 1) * 7 + now.getDay()));
  });

  it("source 与 truncated 如实透传，默认 live/false", () => {
    const plain = buildHeatmap(new Map(), { now });
    expect(plain.source).toBe("live");
    expect(plain.truncated).toBe(false);
    const demo = buildHeatmap(new Map(), { now, source: "demo", truncated: true });
    expect(demo.source).toBe("demo");
    expect(demo.truncated).toBe(true);
  });

  it("weeks<=0 也至少一列，不返回空矩阵把卡片撑成 0 高", () => {
    expect(buildHeatmap(new Map(), { now, weeks: 0 }).weeks.length).toBe(1);
  });
});

describe("simulateCounts：只用于预览，不许冒充真实日期", () => {
  it("生成的键都在窗口内且不含未来日期", () => {
    const now = new Date(2026, 9, 15);
    const counts = simulateCounts("octocat", { now });
    const todayKey = localDateKey(now);
    for (const key of counts.keys()) expect(key <= todayKey).toBe(true);
    expect(counts.size).toBeGreaterThan(0);
  });

  it("同一用户名同一 offset 结果稳定（不然预览排版每次都在跳）", () => {
    const now = new Date(2026, 9, 15);
    expect([...simulateCounts("octocat", { now }).entries()]).toEqual([
      ...simulateCounts("octocat", { now }).entries(),
    ]);
  });
});

describe("isValidGithubUsername：写坏的名字不能去打 API", () => {
  it("接受 1-39 位字母数字与单个连字符", () => {
    for (const ok of ["octocat", "a", "x".repeat(39), "my-user", "0abc"]) expect(isValidGithubUsername(ok)).toBe(true);
  });

  it("拒绝空串/首尾连字符/连续连字符/非法字符/超长", () => {
    for (const bad of ["", "-foo", "foo-", "fo--oo", "foo_bar", "foo.bar", "用户", "x".repeat(40)]) {
      expect(isValidGithubUsername(bad)).toBe(false);
    }
  });
});

type StubPage = { status?: number; body?: unknown; throw?: boolean };

function stubFetch(pages: StubPage[]): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fn = (async (input: unknown) => {
    urls.push(String(input));
    const page = pages[Math.min(i++, pages.length - 1)];
    if (page.throw) throw new TypeError("failed to fetch");
    const status = page.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => page.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, urls };
}

/** 造 n 条 PushEvent（每条 1 次提交），created_at 相对 now 往前推 daysAgo 天 */
function eventsPage(n: number, daysAgo: number, now: Date): Record<string, unknown>[] {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - daysAgo);
  d.setHours(9, 0, 0, 0);
  return Array.from({ length: n }, () => pushEvent(d.toISOString(), 1));
}

describe("fetchPublicPushEvents：失败原因分档，绝不静默返回空数据", () => {
  const now = new Date(2026, 9, 15);

  it("用户名非法直接拦下，不发请求", async () => {
    const { fn, urls } = stubFetch([{ body: [] }]);
    const res = await fetchPublicPushEvents("fo--o", { fetchImpl: fn, now });
    expect(res).toEqual({ ok: false, reason: "invalid_user" });
    expect(urls).toHaveLength(0);
  });

  it("前后空格不影响命中", async () => {
    const { fn, urls } = stubFetch([{ body: eventsPage(1, 1, now) }]);
    const res = await fetchPublicPushEvents("  octocat  ", { fetchImpl: fn, now });
    expect(res.ok).toBe(true);
    expect(urls[0]).toContain("/users/octocat/events/public");
    expect(urls[0]).toContain("per_page=100");
  });

  it("404 / 403 / 429 / 202 / 其它状态 / 网络异常各自独立 reason", async () => {
    const cases: Array<[number, string]> = [
      [404, "not_found"],
      [403, "rate_limited"],
      [429, "rate_limited"],
      [202, "queued"],
    ];
    for (const [status, reason] of cases) {
      const res = await fetchPublicPushEvents("octocat", { fetchImpl: stubFetch([{ status }]).fn, now });
      expect(res.ok === false && res.reason).toBe(reason);
    }
    const http = await fetchPublicPushEvents("octocat", { fetchImpl: stubFetch([{ status: 500 }]).fn, now });
    expect(http.ok === false && http.reason).toBe("http");
    expect(http.ok === false && http.status).toBe(500);
    const net = await fetchPublicPushEvents("octocat", { fetchImpl: stubFetch([{ throw: true }]).fn, now });
    expect(net.ok === false && net.reason).toBe("network");
  });

  it("响应不是数组按异常处理，不当成「没有提交」", async () => {
    const res = await fetchPublicPushEvents("octocat", { fetchImpl: stubFetch([{ body: {} }]).fn, now });
    expect(res.ok === false && res.reason).toBe("http");
  });

  it("不足一页即停止翻页", async () => {
    const { fn, urls } = stubFetch([{ body: eventsPage(100, 1, now) }, { body: eventsPage(10, 2, now) }]);
    const res = await fetchPublicPushEvents("octocat", { fetchImpl: fn, now });
    expect(urls).toHaveLength(2);
    expect(res.ok === true && res.eventCount).toBe(110);
  });

  it("最多翻 3 页；拿满 300 条且仍在 90 天窗内 = 截断", async () => {
    const { fn, urls } = stubFetch([
      { body: eventsPage(100, 1, now) },
      { body: eventsPage(100, 2, now) },
      { body: eventsPage(100, 3, now) },
      { body: eventsPage(100, 4, now) },
    ]);
    const res = await fetchPublicPushEvents("octocat", { fetchImpl: fn, now });
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain("page=3");
    expect(res.ok === true && res.truncated).toBe(true);
    expect(res.ok === true && res.eventCount).toBe(300);
  });

  it("拿满 300 条但最早一条已超出 90 天窗 → 不算截断", async () => {
    const { fn } = stubFetch([
      { body: eventsPage(100, 1, now) },
      { body: eventsPage(100, 100, now) },
      { body: eventsPage(100, 100, now) },
    ]);
    const res = await fetchPublicPushEvents("octocat", { fetchImpl: fn, now });
    expect(res.ok === true && res.truncated).toBe(false);
  });

  it("成功时给出真实计数与抓取时间戳", async () => {
    const { fn } = stubFetch([{ body: [pushEvent(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9).toISOString(), 4)] }]);
    const res = await fetchPublicPushEvents("octocat", { fetchImpl: fn, now });
    expect(res.ok === true && res.counts.get(localDateKey(now))).toBe(4);
    expect(res.ok === true && res.fetchedAt).toBe(now.getTime());
  });
});
