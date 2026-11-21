/**
 * U-266 绕过声明累计重数脚本自检（U-385）。
 *
 * 钉的是脚本的计数逻辑，不是当时的累计数字本身：--to 固定在已封存的
 * head 上（7779d8db / 23195b0d / 52e919e2 / 66aa7009 / f38deebd），未来新提交不会改写这些断言；
 * 想看当前累计直接跑 `node scripts/count-precommit-bypasses.mjs`。
 *
 * 口径（跟进派单）：--no-verify 与 SKIP_PRECOMMIT 分开计数，SKIP 是否
 * 计入 U-266 待主聊裁决，不擅自扩口径。71 例是审计 U-385 的订正数
 * （52 + 19，算到 23195b0d），不是本脚本的输出——本脚本只给分开计数，
 * 由协调者/主聊按裁决定夺最终写法。
 *
 * 数字来源（2026-11-21 人工逐笔全文核对，与脚本输出一致）：
 *   - 锚点 06429843（含）至 7779d8db：窗口 81 笔，no-verify 19 / skip 54 /
 *     并集 73。雷达 104 轮写的 52 例漏 21 例：94 轮订正的 4 例从未吸入基数
 *     （23680ee、d52a36e、1713331、f8fee97）+ 17 例从未被任何一轮点名；
 *     其中 no-verify 漏 3 例（d52a36e、1713331、4f0c67c8），skip 漏 18 例。
 *   - 7779d8db..23195b0d：窗口 19 笔，no-verify 0 / skip 19 / 并集 19
 *     （审计 U-385 的 19 笔，全为 skip）。
 *   - 23195b0d..52e919e2：窗口 3 笔，no-verify 0 / skip 2 / 并集 2
 *     （39ac383d、d28b4b84，均为“跳过全量预提交检查”；雷达 109 轮
 *     “均非 --no-verify”只验了 --no-verify token，漏了这 2 笔 skip）。
 *   - 故 52e919e2 处累计：no-verify 19 / skip 75 / 并集 94。
 *   - 52e919e2..66aa7009：窗口 26 笔，no-verify 0 / skip 24 / 并集 24
 *     （Batch 1 合流 + 命令面板线；未计入的 2 笔：76e947f8 合并提交、
 *     6ba1c374 PoC 脚手架，全文均无跳过声明，已逐笔核实）。
 *   - 故 66aa7009 处累计：no-verify 19 / skip 99 / 并集 118。
 *   - 66aa7009..f38deebd：窗口 7 笔，no-verify 0 / skip 7 / 并集 7
 *     （健康阈值与门禁厚度同步线；7 笔全为 skip，其中 6ab36d99、
 *     f582c81a 只写英文 "Skip precommit:"——第一版口径漏计此 2 笔，
 *     2026-11-21 19:12 人工读全文发现后补入口径，脚本正则已同步修；
 *     全窗口 grep 复核：此前各段无英文-only 的跳过声明，漏计仅此 2 笔。
 *     本段无未计入提交。）
 *   - 故 f38deebd 处累计：no-verify 19 / skip 106 / 并集 125。
 *   - 三笔刻意排除：a459f176（疑似，未用标准 token）、a44d8212
 *     （顺序问题）、c5a83877（无显式跳过声明）——口径收窄时它们仍
 *     须被排除，否则就是把“疑似”算成“声明”。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/count-precommit-bypasses.mjs");

function recount(args) {
  const out = execFileSync(process.execPath, [SCRIPT, ...args, "--json"], { encoding: "utf8", cwd: ROOT });
  return JSON.parse(out);
}

// 审计 U-385 逐笔核对的 19 笔（7779d8db..23195b0d），全 hash 钉死；全为 skip 类。
const DELTA_19 = [
  "23195b0d01361f65c538462c82efafbcd104058c",
  "24dad21ae2e0612ada0444d576d4753b228cd606",
  "b62cfda4898ada1dfbe737fc8d0f10abbc479aaa",
  "81ee2134e097ad2ff955b3a6ac7aecb348cf35d0",
  "c310bff5e9b244371c168aa64183c62762d15238",
  "8dcbf99fe72100a0b6ee6df0cda1fca6c94e6d35",
  "eea3284c8d75c4c1efa9d31226cadfc2bcf1d561",
  "63cb0275e054155d711777f18ab4c1a87a8ffd87",
  "2ed2efd1ea7776a2cb3f239679adc7a82f3b064c",
  "f0779efff415bc4c00849cb797bec66613b8cecf",
  "7c4af0fc63672cc8fa76f474f774a4bb2444a3c5",
  "c55752a765f53335677fc76ab111958359689b96",
  "b0c314ff04b28c46ed8ea86ece441bcc3defaf32",
  "bd77fb85da8ad7dc4dec0c47af62268948e81218",
  "3e5d4c7786b1c1bc59ae60dccf62991ebc0b71a6",
  "ca98cbc1c890a9ed46b7ea4d7770b376ddda633f",
  "7aa6644b687f50ddf735a4cbd42661a41bc560df",
  "7721624a0203f67bf88e190f39e473ac005d2240",
  "1c20c0ff74fe8aa68d58668d92b09424d5cad88b",
];

// 23195b0d..52e919e2 的 2 笔 skip（39ac383d、d28b4b84），全 hash 钉死。
const DELTA_2_SKIP = [
  "39ac383d",
  "d28b4b84",
];

// 52e919e2..66aa7009 的 24 笔 skip，全 hash 钉死（窗口 26 笔，另 2 笔
// 76e947f8 合并提交与 6ba1c374 全文无跳过声明，已逐笔核实排除）。
const DELTA_24 = [
  "66aa70096f4c82c4f8b581a068d9931a1f347094",
  "174518a4ae4ac371a5e9a0745478fab4a80d0d7a",
  "1aefa9e134fc36c774c04d4565e6f2a7ce78acf6",
  "f3f680088c3efe3c4667611cd51e0df6d36dc9dc",
  "c9464e789ecd91a2e763af0fcb51150facda6f8f",
  "8a3b841a906241d37444a5815e88f7dd273035ad",
  "ae354aa49bcd9fdcda982b3e137459e2dcf8e845",
  "a73e518a7e8ff7c7739d0c8629beaaa6e0e81cf7",
  "9dec891a64ee6f9c29f0a610345fb791e734d388",
  "e2ea8d40bd159fd4f2cdb032a954bc837307c3ac",
  "f6032358c1f9d23e0c7e54101f9dfe5c20e0aeef",
  "7a24ee9587a02f68470759940a619857b8bd50c4",
  "b20835abcc8958867c0962cf39aceb17e6d7ad64",
  "bff548931891d5b77474c15578cd32fea36efeaf",
  "de99a568f0c9ae98e83856fad972496b6ba61a95",
  "ad0929000d60526b68f9f4ec014b99ecc1551588",
  "9d1dbae9eacef117b6bbcc42d85c6a180537fca3",
  "7ec077f9d134f54b778299b6186649c9ff2d3865",
  "e0f933b46573bfea9ab2c6d09a1948343572483f",
  "b8c24019588965cf5930a7f5729b34cd9ef4b0db",
  "7491b22fd7906a5f4fc3c2e52384e7d4bf9ff1dd",
  "f9fc2042653c614a8dabbc0a0c5d0f8c87acaf8c",
  "4155d9980e2c58d7f596c3254e1185ecba5bc67e",
  "ca7fe3964614cd1f446dd6dc4b9fc8d3e0a69880",
];

// 66aa7009..f38deebd 的 7 笔 skip，全 hash 钉死（窗口 7 笔全中；其中
// 6ab36d99、f582c81a 为英文 "Skip precommit:"，第一版口径曾漏计）。
const DELTA_7 = [
  "f38deebdb7ce2d8bff4ddbd078b277373dad3bb6",
  "abc6deeaa2dbf3b6176815ed37440dd1c8efb062",
  "73ed0b615cd0c82b6022dc026d117f458a3acd72",
  "6ab36d99d043f4a59da81bfddeec88ca39cd95fe",
  "f582c81a101429a946d1e4ce245b7cff6b5ee839",
  "e5c676f244b5e016ebdd131827ba52a19ae3e851",
  "46df334d3962ba8ffa69cd21b4122cf87f74cfb6",
];

describe("U-266 绕过声明累计重数（U-385，分开计数）", () => {
  it("锚点累计：--to 7779d8db 得 no-verify 19 / skip 54 / 并集 73", () => {
    const res = recount(["--to", "7779d8db"]);
    expect(res.windowCommits).toBe(81);
    expect(res.noVerify).toBe(19);
    expect(res.skipPrecommit).toBe(54);
    expect(res.both).toBe(0);
    expect(res.union).toBe(73);
    expect(res.total).toBe(73);
  });

  it("锚点累计：--to 23195b0d 得 no-verify 19 / skip 73 / 并集 92", () => {
    const res = recount(["--to", "23195b0d"]);
    expect(res.windowCommits).toBe(100);
    expect(res.noVerify).toBe(19);
    expect(res.skipPrecommit).toBe(73);
    expect(res.union).toBe(92);
  });

  it("锚点累计：--to 52e919e2 得 no-verify 19 / skip 75 / 并集 94", () => {
    const res = recount(["--to", "52e919e2"]);
    expect(res.windowCommits).toBe(103);
    expect(res.noVerify).toBe(19);
    expect(res.skipPrecommit).toBe(75);
    expect(res.union).toBe(94);
  });

  it("增量：--since 7779d8db --to 23195b0d 得 19 例，全为 skip，逐笔与审计一致", () => {
    const res = recount(["--since", "7779d8db", "--to", "23195b0d"]);
    expect(res.windowCommits).toBe(19);
    expect(res.noVerify).toBe(0);
    expect(res.skipPrecommit).toBe(19);
    expect(res.union).toBe(19);
    expect(res.commits.map((c) => c.sha).sort()).toEqual([...DELTA_19].sort());
    // 每笔都有可复核的跳过声明原文摘要，且类别均为 skip-precommit。
    for (const c of res.commits) {
      expect(c.excerpt.length, c.sha).toBeGreaterThan(0);
      expect(c.category, c.sha).toBe("skip-precommit");
    }
  });

  it("增量：--since 23195b0d --to 52e919e2 得 2 例 skip（109 轮漏计的 2 笔）", () => {
    const res = recount(["--since", "23195b0d", "--to", "52e919e2"]);
    expect(res.windowCommits).toBe(3);
    expect(res.noVerify).toBe(0);
    expect(res.skipPrecommit).toBe(2);
    expect(res.union).toBe(2);
    expect(res.commits.map((c) => c.sha.slice(0, 8)).sort()).toEqual([...DELTA_2_SKIP].sort());
    for (const c of res.commits) {
      expect(c.category, c.sha).toBe("skip-precommit");
    }
  });

  it("三笔刻意排除的提交不在计数内", () => {
    const res = recount(["--to", "7779d8db"]);
    const shas = new Set(res.commits.map((c) => c.sha));
    expect(shas.has("a459f176875422bf0b8677a0ce52356ef624facc")).toBe(false);
    expect(shas.has("a44d82129416ab82748a07f2a8dc75a369058d31")).toBe(false);
    expect(shas.has("c5a838773348bda54d49c13acfe68e76c6681102")).toBe(false);
  });

  it("94 轮订正的 4 例在计数内（它们从未吸入 52 基数）", () => {
    const res = recount(["--to", "7779d8db"]);
    const bySha = new Map(res.commits.map((c) => [c.sha, c.category]));
    expect(bySha.get("23680ee58d1482a65dafea96644323111cd7e26c")).toBe("skip-precommit");
    expect(bySha.get("d52a36ec7448c88e457eded189006918bd4b17df")).toBe("no-verify");
    expect(bySha.get("1713331130bd01162d4a84fde158aca0bb652cc6")).toBe("no-verify");
    expect(bySha.get("f8fee976d737b9248d56c589a9fdec8f9614ed32")).toBe("skip-precommit");
  });

  it("锚点累计：--to 66aa7009 得 no-verify 19 / skip 99 / 并集 118", () => {
    const res = recount(["--to", "66aa7009"]);
    expect(res.windowCommits).toBe(129);
    expect(res.noVerify).toBe(19);
    expect(res.skipPrecommit).toBe(99);
    expect(res.union).toBe(118);
  });

  it("锚点累计：--to f38deebd 得 no-verify 19 / skip 106 / 并集 125", () => {
    const res = recount(["--to", "f38deebd"]);
    expect(res.windowCommits).toBe(136);
    expect(res.noVerify).toBe(19);
    expect(res.skipPrecommit).toBe(106);
    expect(res.union).toBe(125);
  });

  it("增量：--since 66aa7009 --to f38deebd 得 7 例，全为 skip（含 2 笔英文 Skip precommit）", () => {
    const res = recount(["--since", "66aa7009", "--to", "f38deebd"]);
    expect(res.windowCommits).toBe(7);
    expect(res.noVerify).toBe(0);
    expect(res.skipPrecommit).toBe(7);
    expect(res.union).toBe(7);
    expect(res.commits.map((c) => c.sha).sort()).toEqual([...DELTA_7].sort());
    for (const c of res.commits) {
      expect(c.excerpt.length, c.sha).toBeGreaterThan(0);
      expect(c.category, c.sha).toBe("skip-precommit");
    }
    // 英文-only 的 2 笔（6ab36d99、f582c81a）确在计数内，口径已补。
    const bySha = new Map(res.commits.map((c) => [c.sha.slice(0, 8), c.excerpt]));
    expect(bySha.get("6ab36d99")).toMatch(/Skip precommit/i);
    expect(bySha.get("f582c81a")).toMatch(/Skip precommit/i);
  });

  it("增量：--since 52e919e2 --to 66aa7009 得 24 例，全为 skip，逐笔钉死", () => {
    const res = recount(["--since", "52e919e2", "--to", "66aa7009"]);
    expect(res.windowCommits).toBe(26);
    expect(res.noVerify).toBe(0);
    expect(res.skipPrecommit).toBe(24);
    expect(res.union).toBe(24);
    expect(res.commits.map((c) => c.sha).sort()).toEqual([...DELTA_24].sort());
    for (const c of res.commits) {
      expect(c.excerpt.length, c.sha).toBeGreaterThan(0);
      expect(c.category, c.sha).toBe("skip-precommit");
    }
  });

  it("109 轮漏计的 2 笔 skip 在 52e919e2 累计内", () => {
    const res = recount(["--to", "52e919e2"]);
    const bySha = new Map(res.commits.map((c) => [c.sha.slice(0, 8), c.category]));
    expect(bySha.get("39ac383d")).toBe("skip-precommit");
    expect(bySha.get("d28b4b84")).toBe("skip-precommit");
  });
});
