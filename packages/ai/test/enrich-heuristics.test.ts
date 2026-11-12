/**
 * enrich 启发式路径覆盖：heuristicCategory / heuristicTags / heuristicFacets /
 * constrainCategoryToWhitelist / stripCodeFence。
 *
 * 这组纯函数是 LLM 不可用时的全部降级逻辑，此前只有 heuristicCategory/
 * heuristicTags 的间接覆盖（且集中在 ai.test.ts 的 enrichUrl 集成用例里），
 * 分面推断与白名单约束的分支基本没有断言。
 */
import { describe, expect, it } from "vitest";
import {
  constrainCategoryToWhitelist,
  heuristicCategory,
  heuristicFacets,
  heuristicTags,
  stripCodeFence,
} from "../src/enrich.ts";

describe("heuristicCategory（加权关键词 + 标题加成）", () => {
  it("加权胜过计数：AI 强信号压过开发弱信号", () => {
    expect(heuristicCategory("GitHub Copilot AI 代码补全")).toBe("AI 工具");
  });

  it("各大类目都能命中", () => {
    expect(heuristicCategory("Docker 部署服务器运维")).toBe("开发运维");
    expect(heuristicCategory("Figma 设计素材配色")).toBe("设计资源");
    expect(heuristicCategory("在线课程学习教程")).toBe("学习教育");
    expect(heuristicCategory("bilibili 视频动漫直播")).toBe("影音娱乐");
    expect(heuristicCategory("天气预报外卖快递")).toBe("生活服务");
    expect(heuristicCategory("办公协作日程待办")).toBe("效率办公");
  });

  it("无命中时返回未分类", () => {
    expect(heuristicCategory("一个不知名的东西")).toBe("未分类");
    expect(heuristicCategory("")).toBe("未分类");
  });

  it("标题命中获得额外加成，能翻转正文的判定", () => {
    // 正文只有「代码」一个开发信号（2 分）
    expect(heuristicCategory("代码")).toBe("开发运维");
    // 同样正文，标题带 AI 强信号（3+3，标题加成各 +1.5）后 AI 胜出
    expect(heuristicCategory("代码", "AI 大模型助手")).toBe("AI 工具");
  });

  it("拉丁词用词边界：ai 不命中 email，ui 不命中 build", () => {
    expect(heuristicCategory("email 工具")).toBe("未分类");
    expect(heuristicCategory("build 工具")).toBe("未分类");
    expect(heuristicCategory("ai 工具")).toBe("AI 工具");
    expect(heuristicCategory("ui 设计")).toBe("设计资源");
  });
});

describe("heuristicTags", () => {
  it("规则命中词 + 拉丁词都被收进标签", () => {
    const tags = heuristicTags("GitHub Copilot AI 代码补全工具");
    expect(tags).toContain("github");
    expect(tags).toContain("copilot");
    expect(tags).toContain("ai");
    expect(tags).toContain("代码");
  });

  it("拉丁词少于 3 字符不收录；总量上限 8 个", () => {
    const tags = heuristicTags("ab cd ef");
    expect(tags).toEqual([]);
    const many = heuristicTags(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
    );
    expect(many).toHaveLength(8);
  });

  it("空文本返回空数组", () => {
    expect(heuristicTags("")).toEqual([]);
  });
});

describe("heuristicFacets", () => {
  it("开源仓库：pricing open_source、form library、platform web", () => {
    const f = heuristicFacets("https://github.com/foo/bar", "开源代码库 MIT License");
    expect(f.pricing).toEqual(["open_source"]);
    expect(f.form).toContain("library");
    expect(f.platform).toContain("web");
  });

  it("付费模式三档：freemium / free 互斥分支", () => {
    expect(heuristicFacets("https://x.com", "基础免费增值订阅制").pricing).toEqual(["freemium"]);
    expect(heuristicFacets("https://x.com", "100% 免费使用").pricing).toEqual(["free"]);
    expect(heuristicFacets("https://x.com", "一个普通工具").pricing).toBeUndefined();
  });

  it("平台分支：ios / android / macos / windows / linux / extension", () => {
    expect(heuristicFacets("https://x.com", "iPhone App Store 应用").platform).toContain("ios");
    expect(heuristicFacets("https://x.com", "安卓 Google Play").platform).toContain("android");
    expect(heuristicFacets("https://x.com", "macOS 客户端").platform).toContain("macos");
    expect(heuristicFacets("https://x.com", "Windows Win11 桌面").platform).toContain("windows");
    expect(heuristicFacets("https://x.com", "Linux 发行版").platform).toContain("linux");
    expect(heuristicFacets("https://x.com", "Chrome 插件扩展").platform).toContain("extension");
    // 无任何平台信号时也总有 web 兜底
    expect(heuristicFacets("https://x.com", "纯文本").platform).toEqual(["web"]);
  });

  it("形态分支：api / cli / self_hosted / saas 兜底", () => {
    expect(heuristicFacets("https://x.com", "提供 API 与 SDK 接口").form).toContain("api");
    expect(heuristicFacets("https://x.com", "命令行终端工具").form).toContain("cli");
    expect(heuristicFacets("https://x.com", "支持 Docker 自托管部署").form).toContain("self_hosted");
    expect(heuristicFacets("https://x.com", "一个在线服务").form).toContain("saas");
  });

  it("语言：中文文本或 zh lang → zh，否则 en", () => {
    expect(heuristicFacets("https://x.com", "中文站点", "zh-CN").language).toEqual(["zh"]);
    expect(heuristicFacets("https://x.com", "中文站点").language).toEqual(["zh"]);
    expect(heuristicFacets("https://x.com", "english site").language).toEqual(["en"]);
  });

  it("场景分支：dev / design / ai / content / productivity / ops；无命中时不设 scene", () => {
    const f = heuristicFacets(
      "https://x.com",
      "代码开发设计 UI 人工智能 GPT 写作博客协同表格运维监控",
    );
    expect(f.scene).toEqual(
      expect.arrayContaining(["dev", "design", "ai", "content", "productivity", "ops"]),
    );
    expect(heuristicFacets("https://x.com", "天气").scene).toBeUndefined();
  });
});

describe("constrainCategoryToWhitelist（S-8 白名单约束）", () => {
  it("未提供白名单时保持原值；空串/缺失返回 null", () => {
    expect(constrainCategoryToWhitelist("AI 工具")).toBe("AI 工具");
    expect(constrainCategoryToWhitelist("AI 工具", [])).toBe("AI 工具");
    expect(constrainCategoryToWhitelist(null, ["AI 工具"])).toBeNull();
    expect(constrainCategoryToWhitelist("   ", ["AI 工具"])).toBeNull();
  });

  it("规则 1：完全相等（去空白、大小写不敏感）返回白名单原始写法", () => {
    expect(constrainCategoryToWhitelist(" ai工具 ", ["AI 工具", "开发运维"])).toBe("AI 工具");
  });

  it("规则 2：模型输出包含白名单项时返回该项", () => {
    expect(constrainCategoryToWhitelist("开发工具 / AI 编程", ["AI 编程", "设计资源"])).toBe("AI 编程");
  });

  it("规则 3：模型输出被白名单项包含且唯一命中时返回该项；多命中返回 null", () => {
    expect(constrainCategoryToWhitelist("AI", ["AI 工具", "开发运维"])).toBe("AI 工具");
    expect(constrainCategoryToWhitelist("AI", ["AI 工具", "AI 编程"])).toBeNull();
  });

  it("规则 4：无任何命中返回 null", () => {
    expect(constrainCategoryToWhitelist("美食菜谱", ["AI 工具", "开发运维"])).toBeNull();
  });
});

describe("stripCodeFence", () => {
  it("剥掉 ```json 代码块", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("剥掉无语言标记的代码块；行内代码块提取 JSON", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('好的，这是结果：```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("无代码块时按首尾大括号提取；纯文本原样返回", () => {
    expect(stripCodeFence('说明文字 {"a":1} 结束')).toBe('{"a":1}');
    expect(stripCodeFence("plain text")).toBe("plain text");
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});
