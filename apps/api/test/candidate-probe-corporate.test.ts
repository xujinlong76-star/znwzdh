/**
 * U-429：候选探活接线——301/302 终点为 corporate/企业站域名时记「未证实」。
 *
 * 锁的是 `candidate-probe.ts` 对 `probe-policy.ts` 新条目的接线（不只是 policy
 * 纯函数本身）：guardedFetch 跟随重定向后终点是 corporate.jd.com/home、状态 200，
 * 探活必须返回 unverified，而不是把终点 200 当成「内容检测通过」判 verified。
 *
 * 真实旧错：裸 https://www.jd.com 从本机网络 301 到 corporate.jd.com/home，
 * 终点 686 字节 JoyGen 壳页；旧逻辑只看终点状态码 + 正文停放词，壳页无停放词，
 * 于是把企业官网判成商城存活。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hoisted = vi.hoisted(() => ({
  result: null as {
    finalUrl: string;
    status: number;
    contentType: string | null;
    body: string;
    truncated: boolean;
    bytes: number;
    redirects: string[];
  } | null,
}));

vi.mock("@navhub/ai", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    guardedFetch: async () => {
      if (!hoisted.result) throw new Error("测试未设置 guardedFetch 返回");
      return hoisted.result;
    },
  };
});

const { probeCandidateUrl } = await import("../src/candidate-probe.ts");

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-candidate-corporate-"));
  // 探活缓存落到临时目录，不碰仓库 data/。
  process.env.NAVHUB_PROBE_CACHE_PATH = join(dir, "probe-cache.json");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  // isolate:false 卫生：本文件跨模块 mock 了 @navhub/ai，必须清掉模块缓存。
  vi.resetModules();
});

const JOYGEN_SHELL =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>JoyGen</title></head><body><div id="root"></div></body></html>';

const RICH_PAGE =
  "<html><head><title>正常商城</title></head><body>" +
  "<p>这里是商品列表，有很多商品介绍文字，价格优惠，品质保障，配送及时，轻松购物。</p>".repeat(20) +
  "</body></html>";

describe("候选探活：企业站终点记未证实（U-429）", () => {
  it("真实旧错：www.jd.com → corporate.jd.com/home、终点 200，判 unverified 而非 verified", async () => {
    hoisted.result = {
      finalUrl: "https://corporate.jd.com/home",
      status: 200,
      contentType: "text/html",
      body: JOYGEN_SHELL,
      truncated: false,
      bytes: JOYGEN_SHELL.length,
      redirects: ["https://corporate.jd.com/home"],
    };
    const r = await probeCandidateUrl("https://www.jd.com");
    expect(r.grade).toBe("unverified");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("未证实");
    expect(r.reason).toContain("corporate.jd.com");
  });

  it("对照：无重定向、终点即原站且内容正常，仍判 verified", async () => {
    hoisted.result = {
      finalUrl: "https://ok.example/",
      status: 200,
      contentType: "text/html",
      body: RICH_PAGE,
      truncated: false,
      bytes: RICH_PAGE.length,
      redirects: [],
    };
    const r = await probeCandidateUrl("https://ok.example/");
    expect(r.grade).toBe("verified");
    expect(r.ok).toBe(true);
  });
});
