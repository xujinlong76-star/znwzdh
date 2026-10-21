/**
 * 标签 slug 双实现 Parity 守卫。
 *
 * 背景：客户端 `tagSlug`（apps/web-overlay/src/lib/seo/tag-slug.ts）是
 * store 侧 `slugify`（packages/store/src/repository/dialect.ts）的手工
 * 镜像——web 包没有 @navhub/store 依赖，跨包 import 不通，只能复制。
 * 复制的风险是漂移：一旦两侧行为分叉，sitemap / 标签云 / 卡片三处的
 * 标签 URL 形态就会不一致，同内容双 URL，canonical 白做。
 *
 * 这个测试把「不许漂移」变成红灯：改任何一侧，这里立刻失败。
 * 语料覆盖真实标签形态（纯中文 / 中英混排 / 符号 / 空白 / 空串）与
 * 脏输入（emoji、连字、制表符），不只测 happy path。
 */
import { describe, expect, it } from "vitest";

import { slugify } from "../packages/store/src/repository/dialect.ts";
import { tagSlug } from "../apps/web-overlay/src/lib/seo/tag-slug.ts";

const CORPUS = [
  // 真实标签形态
  "开源",
  "天气",
  "前端开发",
  "AI 编程",
  "AI 工具",
  "Web3 工具",
  "VS Code",
  "GitHub",
  "Node.js",
  "C++",
  "设计 工具",
  "混合 abc 中文 123",
  // 空白与大小写
  "  Design   Tools  ",
  "UPPER",
  "Tab\tSep",
  // 符号（应被剥掉）
  "a/b:c",
  "AI, 工具!",
  "a_b",
  "---",
  // 空与兜底
  "",
  "   ",
  "!!!",
  "。。。",
  // 脏输入
  "👀emoji",
  "ﬂow",
];

describe("tagSlug ↔ store slugify parity", () => {
  it.each(CORPUS)("%s", (name) => {
    expect(tagSlug(name)).toBe(slugify(name));
  });

  it("语料本身有区分度（不是全空串，真在比对行为）", () => {
    const outputs = new Set(CORPUS.map((s) => slugify(s)));
    // 至少产出好几种不同结果，否则 it.each 等于反复断言同一个值
    expect(outputs.size).toBeGreaterThanOrEqual(10);
  });
});
