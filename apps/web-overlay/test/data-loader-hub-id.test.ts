/**
 * data-loader 的 hubId 透传（03 §2.3 步骤 2、§8 第 20 项）。
 *
 * 白名单静默丢字段是活链打通最容易踩的坑：navigation.json 的条目带 hubId，
 * 但 processNavigationSubItem / slimNavigationItem 任一处忘加都会把它裁掉，
 * 且无报错。这里锁三件事：
 *   1. hubId 原样透传（不转换、不归一化），与 health 同款；
 *   2. 没有 hubId 时保持 undefined，不硬造值；
 *   3. 其余字段行为不变（health / tags / videoConfig 既有语义不被顺手破坏）。
 */
import { describe, expect, it } from "vitest";

import { processNavigationSubItem } from "@/lib/data-loader";

describe("processNavigationSubItem：hubId 透传", () => {
  it("hubId 原样透传（12 位与 16 位 id 同款）", () => {
    const out12 = processNavigationSubItem({
      id: "nav-da02af4f6414",
      title: "ChatGPT",
      href: "https://chatgpt.com",
      enabled: true,
      hubId: "nav-da02af4f6414",
    });
    expect(out12.hubId).toBe("nav-da02af4f6414");

    // 16 位 hex id（Portainer 等 6 站）不得被格式假设误杀
    const out16 = processNavigationSubItem({
      id: "nav-037d194bcc9a5df7",
      title: "Portainer",
      href: "https://www.portainer.io",
      enabled: true,
      hubId: "nav-037d194bcc9a5df7",
    });
    expect(out16.hubId).toBe("nav-037d194bcc9a5df7");
  });

  it("没有 hubId 时保持 undefined（不硬造值、不拿 id 补）", () => {
    const out = processNavigationSubItem({
      id: "nav-aaaaaaaaaaaa",
      title: "示例站",
      href: "https://example.com/",
      enabled: true,
    });
    expect(out.hubId).toBeUndefined();
  });

  it("其余字段行为不变（health / tags 仍透传）", () => {
    const out = processNavigationSubItem({
      id: "nav-bbbbbbbbbbbb",
      title: "带健康站",
      href: "https://example.com/",
      enabled: true,
      hubId: "nav-bbbbbbbbbbbb",
      tags: ["测试"],
      health: { ok: true, latencyMs: 120, httpStatus: 200, lastCheckedAt: 1700000000000 },
    });
    expect(out.tags).toEqual(["测试"]);
    expect(out.health).toEqual({ ok: true, latencyMs: 120, httpStatus: 200, lastCheckedAt: 1700000000000 });
    expect(out.hubId).toBe("nav-bbbbbbbbbbbb");
  });
});
