/**
 * B 方案（健康巡检 DNS 改造）任务层回归：注入解析器 + 金丝雀自检 + 跳过语义。
 *
 * 全部用假解析器，不触网：
 *   - 金丝雀域名 example.com 由假解析器回答；
 *   - 站点主机名一律用 .invalid 后缀，假解析器按主机名分流。
 *
 * 锁三件事：
 *   1. 注入解析器失败/超时 → 跳过该站，不写库、不记失败、不标 broken；
 *   2. 金丝雀失败（返回 198.18.x / 解析失败）→ 整轮直接失败，不探活、不标 broken；
 *   3. 解析成功但落到受保护网段（blocked-ip）→ 仍按失败记（跳过逻辑不吞拦截）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { handleHealthCheck } from "../src/jobs/tasks/health-check.task.ts";
import type { JobRunHandle, PatrolSelection } from "../src/jobs.ts";
import { PATROL_DNS_CANARY_HOST, type DnsResolverLike } from "@navhub/ai";

let dir: string;
let ctx: AppContext;
let catId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-patrol-dns-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  const cat = await ctx.repo.createCategory({ id: "cat-patrol-dns", title: "巡检 DNS 测试分类", sort: 1, source: "api" } as never);
  catId = cat.id;
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

const fakeRun = (): JobRunHandle => ({
  jobId: "test-patrol-dns",
  kind: "health_check",
  signal: new AbortController().signal,
  deadlineAt: 0,
  shouldStop: () => false,
});

async function makeSite(url: string): Promise<string> {
  const site = await ctx.repo.createSite({ url, title: "巡检 DNS 测试站", categoryId: catId } as never);
  return site.id;
}

function selectionFor(siteId: string, targets: Awaited<ReturnType<AppContext["repo"]["listSites"]>>): PatrolSelection {
  const picked = targets.filter((s) => s.id === siteId);
  return {
    targets: picked as unknown as PatrolSelection["targets"],
    quota: { backfill: 0, refresh: 1 },
    picked: { backfill: 0, refresh: 1 },
    depth: { unchecked: 0, checked: 1 },
  };
}

async function runOne(siteId: string, resolver: DnsResolverLike): Promise<void> {
  const targets = await ctx.repo.listSites();
  await handleHealthCheck(ctx, {}, fakeRun(), async () => selectionFor(siteId, targets), {
    dnsResolver: resolver,
  });
}

/** 金丝雀放行、站点解析失败 → 跳过，不写库。 */
const skipResolver: DnsResolverLike = {
  lookup: async (host: string) => {
    if (host === PATROL_DNS_CANARY_HOST) return [{ address: "93.184.215.14" }];
    throw new Error("resolver down");
  },
};

/** 金丝雀返回 198.18.x → 整轮失败。 */
const poisonedCanaryResolver: DnsResolverLike = {
  lookup: async () => [{ address: "198.18.92.130" }],
};

/** 金丝雀解析失败 → 整轮失败。 */
const failingCanaryResolver: DnsResolverLike = {
  lookup: async () => {
    throw new Error("resolver down");
  },
};

/** 金丝雀放行、站点解析到受保护网段 → 仍按失败记，不跳过。 */
const blockedSiteResolver: DnsResolverLike = {
  lookup: async (host: string) => {
    if (host === PATROL_DNS_CANARY_HOST) return [{ address: "93.184.215.14" }];
    return [{ address: "198.18.92.130" }];
  },
};

describe("注入解析器失败 → 跳过该站", () => {
  it("不写库、不记失败、不标 broken", async () => {
    const siteId = await makeSite("https://dns-skip-test.invalid/");
    await runOne(siteId, skipResolver);
    const after = await ctx.repo.getSite(siteId);
    expect(after!.status).toBe("active");
    expect(await ctx.repo.getConsecutiveFailures(siteId)).toBe(0);
    expect(after!.health?.lastCheckedAt).toBeNull();
    expect(await ctx.repo.recentHealthChecks(siteId, 5)).toHaveLength(0);
  });
});

describe("金丝雀失败 → 整轮直接失败", () => {
  it("金丝雀返回 198.18.x 时抛错且不探活", async () => {
    const siteId = await makeSite("https://dns-canary-poisoned.invalid/");
    await expect(runOne(siteId, poisonedCanaryResolver)).rejects.toThrow(/金丝雀自检失败/);
    expect(await ctx.repo.getConsecutiveFailures(siteId)).toBe(0);
    expect(await ctx.repo.recentHealthChecks(siteId, 5)).toHaveLength(0);
  });

  it("金丝雀解析失败时抛错且不探活", async () => {
    const siteId = await makeSite("https://dns-canary-failing.invalid/");
    await expect(runOne(siteId, failingCanaryResolver)).rejects.toThrow(/金丝雀自检失败/);
    expect(await ctx.repo.getConsecutiveFailures(siteId)).toBe(0);
    expect(await ctx.repo.recentHealthChecks(siteId, 5)).toHaveLength(0);
  });
});

describe("blocked-ip 不走跳过", () => {
  it("解析成功但落到受保护网段时仍按失败记（cf +1，health 有行）", async () => {
    const siteId = await makeSite("https://dns-blocked-test.invalid/");
    await runOne(siteId, blockedSiteResolver);
    const after = await ctx.repo.getSite(siteId);
    expect(after!.status).toBe("active"); // 第 1 次失败不到阈值
    expect(await ctx.repo.getConsecutiveFailures(siteId)).toBe(1);
    const rows = await ctx.repo.recentHealthChecks(siteId, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toContain("受保护网段");
  });
});
