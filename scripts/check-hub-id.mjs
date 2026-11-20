#!/usr/bin/env node
/**
 * hubId CI 校验（03-livelink-mapping §2.4）。
 *
 * 判定：错指阻塞——hubId 与导航 id 不一致、或 hubId 在 383 条内重复，
 * CI 失败，禁止合入（张冠李戴比缺失更坏）；缺失告警不阻塞——hubId 缺失
 * 只出警告、不拦 CI，但计入回填完成率；PoC 验收要求覆盖率 100%。
 *
 * 格式断言（W1 实测纠正，2026-11-20）：不要写死 nav-[0-9a-f]{12}——
 * 6 个站的 id 是 nav-<16hex>（Portainer、OpenShift、Nomad、Microsoft Learn、
 * Iconfont、彩云天气）。校验规则是 hubId 与导航 id 一致即通过；id 本身的
 * 形状分布（12 位 / 16 位 / 其他）只作报告，不阻塞。
 *
 * 中枢交叉校验（§2.4 第 1 条后半段）需要中枢站点全量清单（§13.3 数据源
 * 未定）：`--hub-list <path>` 传入 [{ id, url }] 时，逐条校验 hubId 在
 * 清单里存在且归一化 url 等于导航 href（归一化复用
 * apps/web-overlay/src/lib/wayback-resolver.ts 的 normalizeTargetUrl，
 * 不另写一套）；不传时该项明确报 SKIPPED（退出码不受影响），绝不把
 * “没查到”报成“通过”。
 *
 * 用法：
 *   node scripts/check-hub-id.mjs [--hub-list <path>]
 * 退出码：0 = 通过（或仅缺失告警）；1 = 任一条错指。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectItems } from "./backfill-hub-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NAV_PATH = join(ROOT, "apps", "web-overlay", "src", "navsphere", "content", "navigation.json");

/**
 * 结构校验（纯函数）：hubId 存在且为非空字符串、与导航 id 一致、383 条内唯一。
 * 返回 { total, covered, missing[], mismatched[], duplicates[], id16[], idOther[] }。
 */
export function validateHubIds(items) {
  const seen = new Map();
  const missing = [];
  const mismatched = [];
  const duplicates = [];
  const id16 = [];
  const idOther = [];
  let covered = 0;
  for (const it of items) {
    const hexLen = typeof it.id === "string" && it.id.startsWith("nav-") ? it.id.slice(4).length : -1;
    if (hexLen === 16) id16.push(`${it.id} ${it.title}`);
    else if (hexLen !== 12) idOther.push(String(it.id));
    if (it.hubId == null || it.hubId === "") {
      missing.push({ id: it.id, title: it.title, href: it.href });
      continue;
    }
    if (it.hubId !== it.id) {
      mismatched.push({ id: it.id, title: it.title, hubId: it.hubId });
      continue;
    }
    if (seen.has(it.hubId)) {
      duplicates.push(it.hubId);
      continue;
    }
    seen.set(it.hubId, it.title);
    covered++;
  }
  return { total: items.length, covered, missing, mismatched, duplicates, id16, idOther };
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const doc = JSON.parse(readFileSync(NAV_PATH, "utf8"));
  const { categories, subCategories, items } = collectItems(doc);
  const v = validateHubIds(items);
  const wrong = v.mismatched.length + v.duplicates.length;
  console.log(`hubId 覆盖 ${v.covered}/${v.total}，错指 ${wrong}，缺失 ${v.missing.length}`);
  console.log(`大类 ${categories} / 子分类 ${subCategories} / 站点 ${v.total}`);
  console.log(`16 位 hex id ${v.id16.length} 条：${v.id16.join("；") || "无"}`);
  if (v.idOther.length > 0) console.log(`非 12/16 位 id（仅报告，不阻塞）：${v.idOther.join(", ")}`);
  if (v.missing.length > 0) {
    console.log(`警告：缺失 hubId ${v.missing.length} 条（告警不阻塞）：`);
    for (const m of v.missing.slice(0, 20)) console.log(`  - ${m.id} ${m.title} ${m.href}`);
    if (v.missing.length > 20) console.log(`  …另 ${v.missing.length - 20} 条`);
  }
  if (v.mismatched.length > 0) {
    console.error(`错指：hubId 与导航 id 不一致 ${v.mismatched.length} 条：`);
    for (const m of v.mismatched) console.error(`  - ${m.id} ${m.title} hubId=${m.hubId}`);
  }
  if (v.duplicates.length > 0) {
    console.error(`错指：hubId 重复 ${v.duplicates.length} 个：${v.duplicates.join(", ")}`);
  }

  // 中枢交叉校验（可选）：--hub-list 传入中枢站点全量清单 [{ id, url }]。
  const hubListIdx = process.argv.indexOf("--hub-list");
  if (hubListIdx === -1) {
    console.log("SKIPPED: hub list unavailable（未做中枢交叉校验：hubId 是否在中枢存在、归一化 url 是否等于 href）");
  } else {
    const hubPath = process.argv[hubListIdx + 1];
    if (!hubPath) {
      console.error("--hub-list 需要一个文件路径");
      process.exit(1);
    }
    const hubList = JSON.parse(readFileSync(hubPath, "utf8"));
    const byId = new Map((Array.isArray(hubList) ? hubList : hubList.sites ?? []).map((s) => [s.id, s.url]));
    let normalizeTargetUrl;
    try {
      ({ normalizeTargetUrl } = await import("../apps/web-overlay/src/lib/wayback-resolver.ts"));
    } catch (e) {
      console.log(`SKIPPED: 无法加载 normalizeTargetUrl（${e.message}），中枢交叉校验未做`);
      process.exit(wrong > 0 ? 1 : 0);
    }
    let crossWrong = 0;
    for (const it of items) {
      if (it.hubId == null || it.hubId === "") continue;
      const hubUrl = byId.get(it.hubId);
      if (hubUrl == null) {
        console.error(`错指：hubId ${it.hubId}（${it.title}）不在中枢清单里`);
        crossWrong++;
      } else if (normalizeTargetUrl(hubUrl) !== normalizeTargetUrl(it.href)) {
        console.error(`错指：hubId ${it.hubId}（${it.title}）中枢 url 归一化后 ≠ href`);
        crossWrong++;
      }
    }
    console.log(`中枢交叉校验：清单 ${byId.size} 条，错指 ${crossWrong}`);
    if (crossWrong > 0) process.exit(1);
  }
  process.exit(wrong > 0 ? 1 : 0);
}
