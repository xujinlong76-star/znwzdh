import { describe, expect, it } from "vitest";
import { backfillText, collectItems, planBackfill } from "./backfill-hub-id.mjs";
import { validateHubIds } from "./check-hub-id.mjs";

/**
 * hubId 回填与校验测试（03 §8 第 20 项：回填脚本 dry-run 测试、
 * check-hub-id 错指/缺失/唯一性测试）。
 *
 * 覆盖 W1 实测 verdict 的两点：情况一 hubId = id；6 条 16 位 hex id
 *（Portainer、OpenShift、Nomad、Microsoft Learn、Iconfont、彩云天气）
 * 不得被 12 位格式断言误杀。
 */

function fixtureDoc() {
  return {
    navigationItems: [
      {
        id: "reg-test",
        title: "测试类",
        subCategories: [
          {
            id: "reg-sub",
            title: "测试子类",
            items: [
              { id: "nav-da02af4f6414", title: "ChatGPT", href: "https://chatgpt.com" },
              { id: "nav-037d194bcc9a5df7", title: "Portainer", href: "https://www.portainer.io" },
              { id: "nav-aaaaaaaaaaaa", title: "示例站", href: "https://example.com/" },
            ],
          },
        ],
      },
    ],
  };
}

describe("planBackfill（情况一：hubId = id）", () => {
  it("dry-run 计划：3 条待回填，16 位 id 识别为 Portainer", () => {
    const plan = planBackfill(fixtureDoc());
    expect(plan).toMatchObject({
      categories: 1,
      subCategories: 1,
      total: 3,
      wouldSet: 3,
      alreadySet: 0,
      conflicts: [],
      duplicates: [],
      badIds: [],
    });
    expect(plan.id16).toEqual(["nav-037d194bcc9a5df7 Portainer"]);
  });

  it("已回填的计入 alreadySet；hubId 与 id 不一致计入冲突", () => {
    const doc = fixtureDoc();
    doc.navigationItems[0].subCategories[0].items[0].hubId = "nav-da02af4f6414";
    doc.navigationItems[0].subCategories[0].items[1].hubId = "nav-000000000000";
    const plan = planBackfill(doc);
    expect(plan.wouldSet).toBe(1);
    expect(plan.alreadySet).toBe(1);
    expect(plan.conflicts).toEqual([
      { id: "nav-037d194bcc9a5df7", title: "Portainer", hubId: "nav-000000000000" },
    ]);
  });

  it("重复 id 与非法 id 被检出", () => {
    const doc = fixtureDoc();
    doc.navigationItems[0].subCategories[0].items.push({
      id: "nav-da02af4f6414",
      title: "重复站",
      href: "https://dup.example/",
    });
    doc.navigationItems[0].subCategories[0].items.push({
      id: "weird-id",
      title: "非法站",
      href: "https://bad.example/",
    });
    const plan = planBackfill(doc);
    expect(plan.duplicates).toEqual(["nav-da02af4f6414"]);
    expect(plan.badIds).toEqual(["weird-id"]);
  });
});

describe("backfillText（手术式行插入，保留其余字节）", () => {
  it("每条 id 行后插入同缩进 hubId 行，其余内容逐字节不变", () => {
    const raw = [
      "{",
      '  "navigationItems": [',
      "    {",
      '      "id": "reg-test",',
      '      "subCategories": [',
      "        {",
      '          "items": [',
      "            {",
      '              "id": "nav-da02af4f6414",',
      '              "title": "ChatGPT",',
      '              "href": "https://chatgpt.com"',
      "            },",
      "            {",
      '              "id": "nav-037d194bcc9a5df7",',
      '              "title": "Portainer",',
      '              "href": "https://www.portainer.io"',
      "            }",
      "          ]",
      "        }",
      "      ]",
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n");
    const plan = planBackfill(JSON.parse(raw));
    expect(plan.total).toBe(2);
    const next = backfillText(raw, plan);
    expect(next).toContain('"id": "nav-da02af4f6414",\n              "hubId": "nav-da02af4f6414",');
    expect(next).toContain('"id": "nav-037d194bcc9a5df7",\n              "hubId": "nav-037d194bcc9a5df7",');
    // 其余行逐行一致：只多了 2 行 hubId
    expect(next.split("\n").length).toBe(raw.split("\n").length + 2);
    const after = planBackfill(JSON.parse(next));
    expect(after.wouldSet).toBe(0);
    expect(after.alreadySet).toBe(2);
  });

  it("id 行数与站点数不一致时拒绝", () => {
    expect(() => backfillText('{"id": "nav-da02af4f6414",}', { total: 2 })).toThrow(/不一致/);
  });
});

describe("validateHubIds（错指阻塞、缺失告警）", () => {
  it("全部 hubId = id 时覆盖 3/3，16 位 id 通过", () => {
    const { items } = collectItems(fixtureDoc());
    for (const it of items) it.hubId = it.id;
    const v = validateHubIds(items);
    expect(v).toMatchObject({ total: 3, covered: 3, missing: [], mismatched: [], duplicates: [] });
    expect(v.id16).toEqual(["nav-037d194bcc9a5df7 Portainer"]);
  });

  it("缺失计入 missing（告警）；不一致计入 mismatched（错指）；重复计入 duplicates（错指）", () => {
    const { items } = collectItems(fixtureDoc());
    items[0].hubId = items[0].id; // 对
    items[1].hubId = "nav-000000000000"; // 错指
    // items[2] 缺失
    const v = validateHubIds(items);
    expect(v.covered).toBe(1);
    expect(v.missing).toHaveLength(1);
    expect(v.mismatched).toHaveLength(1);
    expect(v.duplicates).toHaveLength(0);

    const dup = collectItems(fixtureDoc()).items;
    dup[0].hubId = dup[0].id;
    dup[1].hubId = dup[1].id;
    dup[2].id = dup[0].id; // 与第 1 条同 id（hubId = id 时，重复 hubId 只可能来自重复 id）
    dup[2].hubId = dup[0].id;
    const v2 = validateHubIds(dup);
    expect(v2.duplicates).toEqual(["nav-da02af4f6414"]);
    expect(v2.covered).toBe(2);
  });
});
