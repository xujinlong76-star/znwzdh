import { describe, expect, it } from "vitest";
import {
  countCoveredTerms,
  extractQueryTerms,
  siteTokenSet,
  termCoveredBySite,
} from "../src/cjk.ts";

/**
 * A4「AI 泛词」治理的词元覆盖原语。
 *
 * 背景：引擎二元组 OR 召回 + RRF 只看排名，只命中泛词「ai」的编程工具能靠
 * 字段权重挤进创作场景的尾部。调用方靠这里的覆盖判定把它们沉底，前提是
 * 拆词口径与 buildFtsQuery/buildFtsTokens 严格一致，且分类标题的字回退
 * 只帮「文案没写判别词、但分类对口」的真工具（Leonardo 之于「生图」），
 * 不帮分类八竿子打不着的假朋友（Cursor 之于「生图」）。
 */
describe("extractQueryTerms：与 buildFtsQuery 同口径拆词", () => {
  it("汉字二元组 + 拉丁词小写，去重保序", () => {
    expect(extractQueryTerms("AI 生图")).toEqual(["生图", "ai"]);
    expect(extractQueryTerms("AI 视频生成")).toEqual(["视频", "频生", "生成", "ai"]);
    expect(extractQueryTerms("AI AI 生图 生图")).toEqual(["生图", "ai"]);
  });

  it("单字汉字串保留单字词元", () => {
    expect(extractQueryTerms("猫")).toEqual(["猫"]);
  });

  it("空查询无词元", () => {
    expect(extractQueryTerms("")).toEqual([]);
    expect(extractQueryTerms("！！！")).toEqual([]);
  });
});

describe("siteTokenSet：与写入期 fts_tokens 同口径", () => {
  it("含二元组、单字与拉丁词，统一小写", () => {
    const tokens = siteTokenSet(["Cursor AI 代码编辑器", null, "https://cursor.com"]);
    expect(tokens.has("ai")).toBe(true);
    expect(tokens.has("cursor")).toBe(true);
    expect(tokens.has("编辑")).toBe(true);
  });
});

describe("termCoveredBySite：文本命中或分类标题字回退", () => {
  it("站点文案含判别词二元组 → 覆盖", () => {
    const tokens = siteTokenSet(["即梦AI", "AI 生图与绘画平台"]);
    expect(termCoveredBySite("生图", tokens, "AI 工具 AI 视频生成")).toBe(true);
  });

  it("文案没有判别词、但分类标题凑齐它的字 → 覆盖（Leonardo 案例）", () => {
    const tokens = siteTokenSet(["Leonardo AI", "AI-powered image generation platform"]);
    expect(tokens.has("生图")).toBe(false);
    expect(termCoveredBySite("生图", tokens, "AI 工具 AI 图像生成")).toBe(true);
  });

  it("分类标题凑不齐判别词的字 → 不覆盖（Cursor 案例）", () => {
    const tokens = siteTokenSet(["Cursor", "AI 代码编辑器与编程助手"]);
    expect(termCoveredBySite("生图", tokens, "AI 工具 AI 编程助手")).toBe(false);
    expect(termCoveredBySite("生图", tokens, "AI 工具 模型与数据集")).toBe(false);
  });

  it("拉丁词元不吃分类回退，只认文本命中", () => {
    const tokens = siteTokenSet(["某工具", "一个普通网站"]);
    expect(termCoveredBySite("ppt", tokens, "PPT 模板")).toBe(false);
    expect(termCoveredBySite("ppt", siteTokenSet(["PPT 制作工具"]), null)).toBe(true);
  });

  it("countCoveredTerms 数覆盖到的词元个数", () => {
    const tokens = siteTokenSet(["可灵AI", "AI 视频生成与图生视频"]);
    expect(countCoveredTerms(["视频", "频生", "生成", "生图"], tokens, "AI 工具 AI 视频生成")).toBe(3);
    expect(countCoveredTerms(["生图"], tokens, "AI 工具 AI 视频生成")).toBe(0);
  });
});
