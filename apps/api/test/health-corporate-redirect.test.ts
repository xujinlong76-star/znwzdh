/**
 * U-429：站点巡检接线——301/302 终点为 corporate/企业站域名时记「未证实」。
 *
 * 锁的是 `health-check.task.ts` 对 `probe-policy.ts` 新条目的接线：巡检抓
 * https://www.jd.com，终点 200 但落在 corporate.jd.com/home（企业官网壳页），
 * 本次巡检必须记 ok=false + 未证实原因，而不是把终点 200 当成健康。
 *
 * 抓取层用 mock（不触网）；判定走真实 handleHealthCheck + 真实 SQLite。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hoisted = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@navhub/ai", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    guardedFetch: async (url: string) => {
      hoisted.calls++;
      if (url.includes("jd.com")) {
        const shell =
          '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>JoyGen</title></head><body><div id="root"></div></body></html>';
        return {
          finalUrl: "https://corporate.jd.com/home",
          status: 200,
          contentType: "text/html",
          body: shell,
          truncated: false,
          bytes: shell.length,
          redirects: ["https://corporate.jd.com/home"],
        };
      }
      const page =
        "<html><head><title>正常站点</title></head><body>" +
        "<p>这里是正常站点内容，有很多文字介绍，足够通过正文量判定。</p>".repeat(20) +
        "</body></html>";
      return {
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        body: page,
        truncated: false,
        bytes: page.length,
        redirects: [],
      };
    },
  };
});

const { createContext } = await import("../src/context.ts");
const { loadConfig } = await import("../src/config.ts");
const { handleHealthCheck } = await import("../src/jobs/tasks/health-check.task.ts");
import type { AppContext } from "../src/context.ts";
import type { JobRunHandle, PatrolSelection } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-health-corporate-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: true, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  await import("@navhub/ai");
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  // isolate:false 卫生：本文件跨模块 mock 了 @navhub/ai，必须清掉模块缓存。
  vi.resetModules();
});

function fakeRun(): JobRunHandle {
  return {
    jobId: "test-health-corporate",
    kind: "health_check",
    signal: new AbortController().signal,
    deadlineAt: 0,
    shouldStop: () => false,
  };
}

describe("站点巡检：企业站终点记未证实（U-429）", () => {
  it("www.jd.com 落到 corporate.jd.com/home：ok=false、原因写明未证实、首轮不标 broken", async () => {
    const cat = await ctx.repo.createCategory({ id: "cat-corp", title: "企业站终点", sort: 1, source: "api" } as never);
    const jd = await ctx.repo.createSite({ url: "https://www.jd.com", title: "京东", categoryId: cat.id } as never);
    const okSite = await ctx.repo.createSite({ url: "https://ok.example/", title: "正常站", categoryId: cat.id } as never);

    const targets = (await ctx.repo.listSites()).filter((s) => [jd.id, okSite.id].includes(s.id));
    const selection: PatrolSelection = {
      targets: targets as unknown as PatrolSelection["targets"],
      quota: { backfill: 0, refresh: 2 },
      picked: { backfill: 0, refresh: 2 },
      depth: { unchecked: 0, checked: 2 },
    };
    await handleHealthCheck(ctx, {}, fakeRun(), async () => selection);

    const jdAfter = await ctx.repo.getSite(jd.id);
    expect(jdAfter!.health!.ok).toBe(false);
    expect(jdAfter!.health!.httpStatus).toBe(200);
    expect(jdAfter!.health!.error).toContain("未证实");
    expect(jdAfter!.health!.error).toContain("corporate.jd.com");
    expect(jdAfter!.status).toBe("active"); // 首轮失败不到 broken 阈值

    const okAfter = await ctx.repo.getSite(okSite.id);
    expect(okAfter!.health!.ok).toBe(true);
  });
});
