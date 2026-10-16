/**
 * navhub-api 路径归一化测试（vitest 风格）。
 *
 * 锁定双重前缀 BUG 的回归：'/api/search' 不得生成 '/api/hub/api/search'。
 * 该 bug 曾导致搜索结果/标签/榜单/站点详情/管理面板数据全部静默为空
 * （404 被各调用方的 catch 吞掉，UI 只显示空态）。
 */
import { describe, expect, it } from "vitest";
import { hubUrl } from "../src/lib/navhub-api";

describe("hubUrl", () => {
  it("'/api/search' 归一为 /api/hub/search（不产生双重前缀）", () => {
    expect(hubUrl("/api/search?q=AI")).toBe("/api/hub/search?q=AI");
    expect(hubUrl("/api/sites/abc-123")).toBe("/api/hub/sites/abc-123");
  });

  it("不带 /api 前缀的路径同样可用", () => {
    expect(hubUrl("/search?q=x")).toBe("/api/hub/search?q=x");
    expect(hubUrl("/health")).toBe("/api/hub/health");
  });

  it("admin 页面的 '/api/hub/jobs' 旧写法不重复 hub", () => {
    expect(hubUrl("/api/hub/jobs?limit=50")).toBe("/api/hub/jobs?limit=50");
    expect(hubUrl("/api/hub/admin/stats/trends?days=30")).toBe("/api/hub/admin/stats/trends?days=30");
  });

  it("查询串保持完整", () => {
    expect(hubUrl("/api/rank/trending?limit=20")).toBe("/api/hub/rank/trending?limit=20");
    expect(hubUrl("/api/events?anonId=anon-1")).toBe("/api/hub/events?anonId=anon-1");
  });

  it("恰好 '/api/hub/' 不误伤", () => {
    expect(hubUrl("/api/hub/")).toBe("/api/hub/");
  });
});
