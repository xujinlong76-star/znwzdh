import { describe, expect, it } from "vitest";
import { processNavigationSubItem } from "@/lib/data-loader";

/**
 * health 透传口径（2026-11-25 首屏瘦身）。
 *
 * 背景：navigation.json 的 4823 条站点记录里，每条都带一个全空的 health 对象
 * {ok:false, httpStatus:null, latencyMs:null, redirectTo:null, error:null, lastCheckedAt:null}，
 * 合计 527KB，占首页 RSC flight（2.03MB）的 26%。
 *
 * 依据：siteHealthState()（lib/site-health.ts:106）对 lastCheckedAt 为空的输入
 * 直接返回 null——无徽标、无 title、不进「只看失效」筛选。即「未巡检的 health」
 * 在所有消费方眼里等价于「没有 health」。因此只透传真有巡检事实的那一份。
 */
describe("processNavigationSubItem：health 只在真有巡检事实时透传", () => {
  const base = { id: "s1", title: "站", href: "https://a.com", enabled: true };

  it("全空 health（lastCheckedAt 为空）被裁掉：与 siteHealthState(null) 等价", () => {
    const out = processNavigationSubItem({
      ...base,
      health: { ok: false, httpStatus: null, latencyMs: null, redirectTo: null, error: null, lastCheckedAt: null },
    });
    expect(out.health).toBeUndefined();
  });

  it("完全缺省 health 时仍是 undefined（不被凭空造出）", () => {
    const out = processNavigationSubItem(base);
    expect(out.health).toBeUndefined();
  });

  it("有巡检事实（lastCheckedAt 有值）的 health 原样透传，一个字段都不动", () => {
    const health = { ok: true, httpStatus: 200, latencyMs: 321, redirectTo: null, error: null, lastCheckedAt: 1795000000000 };
    const out = processNavigationSubItem({ ...base, health });
    expect(out.health).toEqual(health);
  });

  it("裁剪前后 siteHealthState 结论一致（回归锚点：不许因裁剪改变任何徽标）", async () => {
    const { siteHealthState } = await import("@/lib/site-health");
    const empty = { ok: false, httpStatus: null, latencyMs: null, redirectTo: null, error: null, lastCheckedAt: null };
    expect(siteHealthState(processNavigationSubItem({ ...base, health: empty }).health)).toBe(
      siteHealthState(empty),
    );
  });
});
