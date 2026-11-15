/**
 * 查询纠正（搜索容错纠错 · 第 5 项）。
 *
 * 锁三件事：
 * 1. 别名层：gh/bili 整串与逐 token 替换，大小写不敏感；
 * 2. 编辑距离层：拼音打错（zhihhu/zihhu → 知乎）、首字母错（blbb → 哔哩哔哩）、
 *    中文错别字（简厉 → 简历、知呼 → 知乎）能自动纠，歧义与短词/无关词一律 null；
 * 3. 内置简称表的每条 target 必须是库内真实标题——对种子标题快照逐条核对，
 *    种子里没有的站（Telegram / YouTube / 微信 …）绝不能出现在表里。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveQueryCorrection,
  buildCorrectionKeys,
  type CorrectionSiteKeys,
} from "../src/query-correction.ts";
import { SITE_ALIASES } from "../src/site-aliases.ts";

const ZHIHU: CorrectionSiteKeys = {
  title: "知乎",
  keys: ["知乎", "zhihu", "zh"],
};
const BILIBILI: CorrectionSiteKeys = {
  title: "哔哩哔哩",
  keys: ["哔哩哔哩", "bilibili", "blbl"],
};
const GITHUB: CorrectionSiteKeys = {
  title: "GitHub",
  keys: ["github", "github", "g"],
};
const JIANLI: CorrectionSiteKeys = {
  title: "简历",
  keys: ["简历", "jianli", "jl"],
};
const SITES = [ZHIHU, BILIBILI, GITHUB, JIANLI];

describe("resolveQueryCorrection：别名层（B 表）", () => {
  it("gh → GitHub（大小写不敏感）", () => {
    expect(resolveQueryCorrection("gh", SITES)).toEqual({
      original: "gh",
      corrected: "GitHub",
      reason: "alias",
    });
    expect(resolveQueryCorrection("GH", SITES)?.corrected).toBe("GitHub");
  });

  it("bili → 哔哩哔哩", () => {
    expect(resolveQueryCorrection("bili", SITES)?.corrected).toBe("哔哩哔哩");
    expect(resolveQueryCorrection("bili", SITES)?.reason).toBe("alias");
  });

  it("多词逐 token 替换：gh copilot → GitHub copilot", () => {
    const res = resolveQueryCorrection("gh copilot", SITES);
    expect(res?.corrected).toBe("GitHub copilot");
    expect(res?.reason).toBe("alias");
  });

  it("算子剥离：#开源 gh 只纠 gh，算子拼回", () => {
    const res = resolveQueryCorrection("#开源 gh", SITES);
    expect(res?.corrected).toBe("#开源 GitHub");
    expect(res?.original).toBe("#开源 gh");
  });
});

describe("resolveQueryCorrection：编辑距离层", () => {
  it("拼音打错 zhihhu → 知乎（对 pinyin_full 距离 1）", () => {
    const res = resolveQueryCorrection("zhihhu", SITES);
    expect(res?.corrected).toBe("知乎");
    expect(res?.reason).toBe("pinyin-typo");
  });

  it("拼音打错 zihhu → 知乎（距离 2 可纠）", () => {
    expect(resolveQueryCorrection("zihhu", SITES)?.corrected).toBe("知乎");
  });

  it("首字母错 blbb → 哔哩哔哩（blbl 距离 1）", () => {
    expect(resolveQueryCorrection("blbb", SITES)?.corrected).toBe("哔哩哔哩");
  });

  it("中文错别字：简厉 → 简历、知呼 → 知乎", () => {
    expect(resolveQueryCorrection("简厉", SITES)).toMatchObject({
      corrected: "简历",
      reason: "chinese-typo",
    });
    expect(resolveQueryCorrection("知呼", SITES)?.corrected).toBe("知乎");
  });

  it("中文多一两个字不被长度差剪掉：简厉模板 → 简历模板", () => {
    const res = resolveQueryCorrection("简厉模板", [JIANLI]);
    expect(res?.corrected).toBe("简历模板");
  });

  it("歧义（两候选同距）→ null，不自动跑", () => {
    const ambiguous: CorrectionSiteKeys[] = [
      { title: "GitHub", keys: ["github"] },
      { title: "Githab", keys: ["githab"] },
    ];
    expect(resolveQueryCorrection("githxb", ambiguous)).toBeNull();
  });

  it("短词 ai / qt → null", () => {
    expect(resolveQueryCorrection("ai", SITES)).toBeNull();
    expect(resolveQueryCorrection("qt", SITES)).toBeNull();
  });

  it("完全无关词 → null", () => {
    expect(resolveQueryCorrection("zzzzqq", SITES)).toBeNull();
    expect(resolveQueryCorrection("asdfghjkl", SITES)).toBeNull();
  });

  it("空查询 → null", () => {
    expect(resolveQueryCorrection("   ", SITES)).toBeNull();
  });
});

describe("resolveQueryCorrection：恒等防护（B4）", () => {
  it("精确名查询不谎报纠正：知乎 / ChatGPT → null", () => {
    expect(resolveQueryCorrection("知乎", SITES)).toBeNull();
    const chatgpt: CorrectionSiteKeys[] = [{ title: "ChatGPT", keys: ["chatgpt"] }];
    expect(resolveQueryCorrection("ChatGPT", chatgpt)).toBeNull();
  });

  it("精确别名目标也不谎报：GitHub → null（别名目标就是原词）", () => {
    expect(resolveQueryCorrection("GitHub", SITES)).toBeNull();
  });

  it("仅大小写不同不是恒等：chatgpt → ChatGPT 仍纠", () => {
    const chatgpt: CorrectionSiteKeys[] = [{ title: "ChatGPT", keys: ["chatgpt"] }];
    expect(resolveQueryCorrection("chatgpt", chatgpt)?.corrected).toBe("ChatGPT");
  });
});

describe("resolveQueryCorrection：中文子串距离记真实值（N6）", () => {
  it("距离 2 的子串候选不压过距离 1 的整串候选", () => {
    const sites: CorrectionSiteKeys[] = [
      { title: "简历模板库", keys: ["简历模板库"] },
      { title: "简厉模板库大全", keys: ["简厉模板库大全"] },
    ];
    // 查询对「简历模板库」只有子串命中（窗口「简厉模版库」距离 2），
    // 对「简厉模板库大全」整串距离 1；真实距离下后者唯一最优。
    // 旧实现把子串距离硬编码为 1，两候选同距会被判歧义 → null。
    const res = resolveQueryCorrection("简厉模版库大全", sites);
    expect(res?.corrected).toBe("简厉模板库大全");
  });
});

describe("buildCorrectionKeys：确定性派生（A 层）", () => {
  it("标题 + 拉丁词元 + 域名 host + 拼音键", () => {
    const keys = buildCorrectionKeys({
      title: "GitHub Copilot",
      url: "https://github.com/copilot",
      pinyinFull: "githubcopilot",
      pinyinInitials: "githubcopilot",
    });
    expect(keys).toContain("github copilot");
    expect(keys).toContain("github");
    expect(keys).toContain("copilot");
    expect(keys).toContain("githubcopilot");
  });

  it("中文标题派生拼音键与 host", () => {
    const keys = buildCorrectionKeys({
      title: "知乎",
      url: "https://www.zhihu.com/",
      pinyinFull: "zhihu",
      pinyinInitials: "zh",
    });
    expect(keys).toContain("知乎");
    expect(keys).toContain("zhihu");
    expect(keys).toContain("zh");
  });
});

describe("SITE_ALIASES：target 必须是库内真实标题", () => {
  it("每条 target 都在种子标题快照里（防编造不存在的站）", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const seed = JSON.parse(
      readFileSync(resolve(here, "../../../apps/api/src/seed-data.json"), "utf8"),
    ) as { sites: Array<{ title: string }> };
    const titles = new Set(seed.sites.map((s) => s.title));
    expect(titles.size).toBeGreaterThan(50);
    for (const [alias, target] of Object.entries(SITE_ALIASES)) {
      expect(titles.has(target), `简称 ${alias} 的 target「${target}」不在种子收录标题里`).toBe(true);
    }
    // 种子里没有的站绝不能进表（实施时核对过：无 Telegram / YouTube / 微信）。
    expect(Object.values(SITE_ALIASES)).not.toContain("Telegram");
    expect(Object.values(SITE_ALIASES)).not.toContain("YouTube");
  });
});
