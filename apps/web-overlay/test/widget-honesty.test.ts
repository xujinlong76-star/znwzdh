/**
 * 仪表盘小卡的「不许编数据」保证。
 *
 * 真实缺陷（两个都在引擎监控 / 趋势小卡上）：
 *  1. metrics-widget 探活失败时依然显示绿色呼吸灯「中枢在线」，
 *     并用 `stats?.sites ?? 50` 把站点数**编**成 50 —— 假的绿灯比没有数据更危险，
 *     用户会据此认为系统正常而不去排查；
 *  2. trending-widget 在中枢不可用时把 4 条硬编码站点渲染成
 *     「今日技术飙升热度榜」，与真实榜单样式完全一致，没有任何标注。
 *     （同目录的天气 / RSS 小卡早就标了「演示数据」，这里漏了。）
 *
 * 所以这里锁两件事：hub-health.ts 的判定结果（纯函数），
 * 以及两个组件源码里不许再出现「填默认值 / 不标注」的写法。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeHealth, type HubHealthLike } from "../src/lib/hub-health";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const full: HubHealthLike = {
  ok: true,
  mode: "standard",
  capabilities: { semantic: true, fts: true },
  stats: { sites: 128, categories: 12, tags: 340 },
};

describe("describeHealth：拿不到的数据一律说未知", () => {
  it("探测中 → probing 态，且不宣称任何能力", () => {
    const s = describeHealth(null, false, true);
    expect(s.tone).toBe("probing");
    expect(s.label).toBe("探测中...");
    expect(s.sitesLabel).not.toMatch(/\d/);
  });

  it("探活失败 → offline，且绝不显示「中枢在线」", () => {
    const s = describeHealth(null, true, false);
    expect(s.tone).toBe("offline");
    expect(s.label).toBe("中枢离线");
    expect(s.label).not.toContain("在线");
    expect(s.sitesLabel).toBe("站点统计不可用");
    expect(s.engineLabel).toBe("引擎架构未知");
  });

  it("即使 failed 为假但从来没拿到 health，也不能当成在线", () => {
    expect(describeHealth(null, false, false).tone).toBe("offline");
    expect(describeHealth(undefined, false, false).tone).toBe("offline");
  });

  it("中枢返回 ok:false → 异常态，而不是在线", () => {
    const s = describeHealth({ ok: false, mode: "lite" }, false, false);
    expect(s.tone).toBe("offline");
    expect(s.label).toBe("中枢异常");
    expect(s.semanticLabel).toBe("能力状态未知");
  });

  it("健康时如实展示统计与能力", () => {
    const s = describeHealth(full, false, false);
    expect(s.tone).toBe("online");
    expect(s.label).toBe("中枢在线");
    expect(s.sitesLabel).toBe("收录 128 个站点");
    expect(s.engineLabel).toBe("PG + pgvector");
    expect(s.semanticLabel).toBe("向量 KNN 就绪");
  });

  it("缺少 stats 时写「站点数未知」，绝不填默认数字（回归：曾用 ?? 50）", () => {
    const s = describeHealth({ ok: true }, false, false);
    expect(s.sitesLabel).toBe("站点数未知");
    expect(s.sitesLabel).not.toMatch(/\d/);
  });

  it("脏统计值（NaN / 负数 / 字符串 / 小数以外）也视为未知", () => {
    for (const bad of [Number.NaN, -1, "128", null, undefined, Number.POSITIVE_INFINITY]) {
      const s = describeHealth({ ok: true, stats: { sites: bad as number } }, false, false);
      expect(s.sitesLabel).toBe("站点数未知");
    }
    expect(describeHealth({ ok: true, stats: { sites: 0 } }, false, false).sitesLabel).toBe("收录 0 个站点");
  });

  it("引擎与语义能力：未知就是未知，不猜默认值", () => {
    expect(describeHealth({ ok: true }, false, false).engineLabel).toBe("引擎架构未知");
    expect(describeHealth({ ok: true, mode: "lite" }, false, false).engineLabel).toBe("lite");
    expect(describeHealth({ ok: true, capabilities: { semantic: false } }, false, false).semanticLabel).toBe(
      "关键词+拼音",
    );
    expect(describeHealth({ ok: true }, false, false).semanticLabel).toBe("关键词+拼音");
  });

  it("任意脏输入都不抛异常", () => {
    for (const dirty of [{}, { ok: true, stats: {} }, { stats: null }, { capabilities: null }]) {
      expect(() => describeHealth(dirty as HubHealthLike, false, false)).not.toThrow();
    }
  });
});

describe("组件源码：不许编造在线状态 / 不许不标注演示数据", () => {
  const metrics = readFileSync(overlayFile("src/components/modular/modules/metrics-widget.tsx"), "utf8");
  const trending = readFileSync(overlayFile("src/components/modular/modules/trending-widget.tsx"), "utf8");

  it("引擎监控小卡：状态与统计都来自 describeHealth，禁止默认值兜底", () => {
    expect(metrics).toContain("describeHealth(health, failed, loading)");
    expect(metrics).toContain("setFailed(true)");
    // 回归守卫：曾经的 `stats?.sites ?? 50` 把站点数编成 50
    expect(metrics).not.toMatch(/stats\?\.sites\s*\?\?/);
    expect(metrics).not.toContain("?? 50");
  });

  it("引擎监控小卡：不再硬编码绿色在线胶囊", () => {
    // 状态文案必须来自 status.label，源码里不该再出现无条件写死的「中枢在线」
    expect(metrics).not.toMatch(/>\s*\{\s*loading\s*\?\s*'探测中\.\.\.'\s*:\s*'中枢在线'\s*\}/);
    expect(metrics).toContain("status.label");
    expect(metrics).toContain("TONE_DOT[status.tone]");
  });

  it("趋势小卡：兜底列表必须打上「演示数据」标记", () => {
    expect(trending).toContain("演示数据");
    expect(trending).toContain("setDemo(true)");
    expect(trending).toContain("DEMO_SITES");
    // 兜底数据只允许出现在 DEMO_SITES 常量里，不许再内联两份重复清单
    expect(trending.match(/Next\.js 15/g)?.length).toBe(1);
  });
});
