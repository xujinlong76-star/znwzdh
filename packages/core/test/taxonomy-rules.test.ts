/**
 * 类目命名与挂载规则测试。
 *
 * 这里的用例全部来自仓库实测词表（docs/anchor-text-categories.csv 的备注列、
 * 装包时代的 106 个平铺根、回收站里 100 个悬空类目 id），
 * 而不是凭空构造：规则挡不住真实 offender 就等于没写。
 */
import { describe, expect, it } from "vitest";
import {
  BANNED_CATEGORY_AXES,
  CATEGORY_TITLE_MAX_UNITS,
  assertAttachableLeaf,
  assertCategoryName,
  categoryBannedAxisHit,
  categoryNameViolations,
  categorySlug,
  categoryTitleUnits,
  looksLikeUuid,
} from "@navhub/core";

describe("categoryTitleUnits：视觉宽度口径", () => {
  it("汉字 1 个单位、半角 0.5 个单位", () => {
    expect(categoryTitleUnits("前端开发")).toBe(4);
    expect(categoryTitleUnits("AI 工具")).toBe(3.5);
    expect(categoryTitleUnits("数据集成 ETL")).toBe(6);
  });

  it("上限 7 能容下新树最长名，挡得住旧名", () => {
    expect(CATEGORY_TITLE_MAX_UNITS).toBe(7);
    for (const name of ["应用与密钥安全", "选题与热点数据", "项目与研发管理", "思维导图与白板", "权威与政务发布"]) {
      expect(categoryTitleUnits(name)).toBeLessThanOrEqual(CATEGORY_TITLE_MAX_UNITS);
    }
    expect(categoryTitleUnits("国产化信创与私有云")).toBeGreaterThan(CATEGORY_TITLE_MAX_UNITS);
    expect(categoryTitleUnits("开源项目与自托管替代方案")).toBeGreaterThan(CATEGORY_TITLE_MAX_UNITS);
    // 「邮件与 Newsletter」= 9 个单位，超宽；registry 里定名「邮件与简报」正是这个规则的结果
    expect(categoryTitleUnits("邮件与 Newsletter")).toBeGreaterThan(CATEGORY_TITLE_MAX_UNITS);
  });
});

describe("禁用轴：把轴写进树的历史 offender 必须全部命中", () => {
  const offenders: Array<[string, string]> = [
    ["AI工具包", "audience"],
    ["投资者工具包", "audience"],
    ["自媒体工具包", "audience"],
    ["热门AI工具", "freshness"],
    ["常用推荐", "freshness"],
    ["最新网址", "freshness"],
    ["英文与海外媒体", "language"],
    ["港台与海外华文媒体", "language"],
    ["国产化信创与私有云", "language"],
    ["开源自托管与替代方案", "pricing"],
    ["图标字体与素材库免费版", "pricing"],
    ["Windows 与 macOS 客户端", "platform"],
    ["小程序与网页版工具", "platform"],
  ];

  for (const [title, axis] of offenders) {
    it(`拒绝「${title}」（${axis} 轴）`, () => {
      const hit = categoryBannedAxisHit(title);
      expect(hit, title).not.toBeNull();
      expect(hit!.axis.axis).toBe(axis);
    });
  }

  it("主题里的「海外/国际」不算语言轴（新树靠它命名，见文件头注释）", () => {
    for (const title of ["海外流媒体", "海外与远程", "国际媒体", "跨境海淘"]) {
      expect(categoryBannedAxisHit(title), title).toBeNull();
    }
  });

  it("新树的根名全部合规", () => {
    const roots = [
      "AI 工具", "前端开发", "后端与云", "运维与安全", "开发者资源", "设计与创意", "效率办公",
      "数据与分析", "学习成长", "学术科研", "资讯媒体", "内容创作", "职业招聘", "金融财经",
      "影音娱乐", "游戏电竞", "消费生活", "公共服务", "未分类",
    ];
    for (const title of roots) expect(assertCategoryName({ title }), title).toBeUndefined();
  });

  it("轴清单不被悄悄放宽", () => {
    expect(BANNED_CATEGORY_AXES.map((a) => a.axis).sort()).toEqual(
      ["audience", "freshness", "language", "platform", "pricing"],
    );
  });
});

describe("assertCategoryName", () => {
  it("英文名超长单独报错", () => {
    const violations = categoryNameViolations({ title: "前端开发", titleEn: "A".repeat(41) });
    expect(violations.map((v) => v.rule)).toEqual(["en_too_long"]);
  });

  it("超长 + 违规轴会同时报出来", () => {
    const violations = categoryNameViolations({ title: "国产化信创与私有云" });
    expect(violations.map((v) => v.rule).sort()).toEqual(["banned_axis", "too_long"]);
  });

  it("空标题只报 empty", () => {
    expect(categoryNameViolations({ title: "   " }).map((v) => v.rule)).toEqual(["empty"]);
    expect(() => assertCategoryName({ title: "" })).toThrow(/不能为空/);
  });

  it("报错文案带着路（分面键名要出现在信息里）", () => {
    expect(() => assertCategoryName({ title: "热门AI工具" })).toThrow(/facets|合集|排序/);
  });
});

describe("assertAttachableLeaf：站点只挂叶子", () => {
  it("一级根被拒", () => {
    expect(() => assertAttachableLeaf({ id: "cat-ai", title: "AI 工具", parentId: null })).toThrow(/一级根/);
  });

  it("叶子通过；类目不存在时报错而不是静默挂空", () => {
    expect(assertAttachableLeaf({ id: "leaf-1", title: "对话助手", parentId: "cat-ai" })).toBeUndefined();
    expect(() => assertAttachableLeaf(null)).toThrow(/不存在/);
  });
});

describe("categorySlug", () => {
  it("优先英文名的 ASCII slug", () => {
    expect(categorySlug("Frontend Development", "前端开发")).toBe("frontend-development");
    expect(categorySlug("AI Tools", "AI 工具")).toBe("ai-tools");
  });

  it("没有英文名时退拼音全拼，中文标题本身不会进 URL", () => {
    const slug = categorySlug(null, "语言学习");
    expect(slug).toBe("yuyanxuexi");
    expect(/[^\x00-\x7f]/.test(slug)).toBe(false);
  });

  it("& 读作 and，收尾不留裸连字符，长度封顶", () => {
    expect(categorySlug("Design & Creative", "设计与创意")).toBe("design-and-creative");
    expect(categorySlug("AI 工具 --", "x")).toBe("ai");
    expect(categorySlug("x".repeat(200), "x").length).toBeLessThanOrEqual(60);
    expect(categorySlug("- -", "x")).toBe("x");
  });

  it("纯符号标题走拼音兜底，兜底也空时用 category", () => {
    expect(categorySlug("", "！")).toBe("category");
  });
});

describe("looksLikeUuid", () => {
  it("只认标准 8-4-4-4-12 形态", () => {
    expect(looksLikeUuid("3f2a1b6c-9d4e-4f70-8a2b-1c2d3e4f5a6b")).toBe(true);
    expect(looksLikeUuid("3F2A1B6C-9D4E-4F70-8A2B-1C2D3E4F5A6B")).toBe(true);
    expect(looksLikeUuid("frontend-development")).toBe(false);
    expect(looksLikeUuid("cat-ai")).toBe(false);
    expect(looksLikeUuid("")).toBe(false);
  });
});
