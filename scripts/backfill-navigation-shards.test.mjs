/**
 * 导航分片回填脚本的纯函数测试（U-386）：
 * 参数解析（默认 dry-run、--apply、--api-base）与报告摘要渲染。
 * 不发任何网络请求；真实端到端见 apps/api/test/navigation-shard-backfill.test.ts。
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  parseArgs,
  summarizeReport,
  summarizeStatus,
} from "./backfill-navigation-shards.mjs";

const SHARD = "src/navsphere/content/navigation-cat-cat-x.json";
const INDEX = "src/navsphere/content/navigation-index.json";

function report(overrides = {}) {
  return {
    dryRun: true,
    dataVersion: 42,
    sourceVersion: 42,
    totalItems: 2,
    categories: 1,
    writes: [
      { path: SHARD, change: "missing" },
      { path: INDEX, change: "unchanged" },
    ],
    wouldWrite: 1,
    wrote: 0,
    skippedUnchanged: 1,
    empty: false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.NAVHUB_API_URL;
});

describe("parseArgs", () => {
  it("默认 dry-run（不写库），API 默认 127.0.0.1:8787", () => {
    expect(parseArgs(["node", "backfill-navigation-shards.mjs"])).toEqual({
      apply: false,
      apiBase: "http://127.0.0.1:8787",
    });
  });

  it("--apply 才写库；--api-base 覆盖环境变量与默认值", () => {
    process.env.NAVHUB_API_URL = "http://env:8787";
    expect(parseArgs(["node", "x.mjs", "--apply", "--api-base", "http://flag:9999/"])).toEqual({
      apply: true,
      apiBase: "http://flag:9999",
    });
    expect(parseArgs(["node", "x.mjs"])).toEqual({ apply: false, apiBase: "http://env:8787" });
  });
});

describe("summarizeReport", () => {
  it("dry-run：报缺失 1 份、将写入 1 份、明确说未写入", () => {
    const text = summarizeReport(report());
    expect(text).toContain("缺失 1");
    expect(text).toContain(`[missing] ${SHARD}`);
    expect(text).toContain("DRY-RUN：将写入 1 份，未写入");
    expect(text).not.toContain(INDEX + "\n");
  });

  it("apply：报已写入 1 份、跳过无变化 1 份", () => {
    const text = summarizeReport(report({ dryRun: false, wrote: 1 }));
    expect(text).toContain("已写入 1 份，跳过无变化 1 份");
    expect(text).not.toContain("DRY-RUN");
  });

  it("空库：说明不派生空索引、无写入", () => {
    const text = summarizeReport(report({ empty: true, writes: [], wouldWrite: 0 }));
    expect(text).toContain("不派生空索引");
  });
});

describe("summarizeStatus", () => {
  it("fresh 时报缺失/过期均为 0；有回落记录时报出时间与原因", () => {
    const fresh = summarizeStatus({
      dataVersion: 42,
      indexSourceVersion: 42,
      indexPresent: true,
      fresh: true,
      totalItems: 2,
      categories: [],
      missingShards: [],
      staleShards: [],
      lastFallback: null,
    });
    expect(fresh).toContain("fresh=true");
    expect(fresh).toContain("缺失分片 0 份");
    expect(fresh).not.toContain("最近一次读回落");

    const withFallback = summarizeStatus({
      dataVersion: null,
      indexSourceVersion: 42,
      indexPresent: true,
      fresh: false,
      totalItems: 2,
      categories: [],
      missingShards: [],
      staleShards: [INDEX],
      lastFallback: { at: 1700000000000, reason: "分片自愈失败：data_version 取不到", count: 3 },
    });
    expect(withFallback).toContain("最近一次读回落");
    expect(withFallback).toContain("data_version 取不到");
  });
});
