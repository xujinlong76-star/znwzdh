#!/usr/bin/env node
/**
 * E2E 前置：往被测应用放一份最小可用猫挂件媒体（U-141，2026-11-18）。
 *
 * 为什么需要它：0675e2b 起默认猫只播透明视频，播不了走 WebP → GIF →
 * 藏猫；但 `play-*.webm/.webp/.gif` 三个真实媒体文件是二进制资产、
 * 不进仓库（`.gitignore` 排除、从未进过 git），CI 全新 checkout 下
 * 三者全部 404，`hideCat()` 把整只猫 `display:none`，6 个猫 E2E
 * 用例（half-screen-dock ×2、occlusion-probe ×2、cat-widget :123/:211）
 * 在 CI 里 9/9 全败——本地有媒体的机器上全绿，CI 上必红。
 *
 * 本脚本拷的是 `e2e/fixtures/cat-media/` 里的合成夹具（112×112、2 秒、
 * 红色圆点摆动，见该目录 README），不是真实猫形象；只解决「E2E 里
 * 猫要有东西可播」，不改变生产行为——生产媒体缺失时挂件仍按设计藏猫。
 *
 * 目标写两处：`apps/web/public/xiaomaomao/media/`（Next dev 实际服务
 * 的目录）与 `apps/web-overlay/public/xiaomaomao/media/`（源码真身；
 * 两处都放，overlay 校验才不会把单边多出的文件报成漂移）。
 * 目标目录在 `.gitignore` 里，拷过去的文件不进仓库。
 *
 * 幂等：重复跑只覆盖同名文件。源文件缺失、拷后不存在或为空时非零
 * 退出，不让 E2E 在静默缺媒体的情况下开跑。
 *
 * 调用点：CI（`.github/workflows/ci.yml` 的 test-e2e 作业）与本地
 * （`scripts/e2e-web-server.mjs` 启动 dev-all 之前）调同一脚本。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "e2e", "fixtures", "cat-media");
const TARGETS = [
  join(ROOT, "apps", "web", "public", "xiaomaomao", "media"),
  join(ROOT, "apps", "web-overlay", "public", "xiaomaomao", "media"),
];
const EXPECTED = [
  "play-idle.webm",
  "play-idle.webp",
  "play-idle.gif",
  "play-walk.webm",
  "play-walk.webp",
  "play-walk.gif",
  "play-pounce.webm",
  "play-pounce.webp",
  "play-pounce.gif",
];

function fail(msg) {
  console.error(`[ensure-cat-media] ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC_DIR)) fail(`夹具目录不存在：${SRC_DIR}`);
const missing = EXPECTED.filter((f) => {
  const p = join(SRC_DIR, f);
  return !existsSync(p) || statSync(p).size === 0;
});
if (missing.length) fail(`夹具缺失或为空：${missing.join("、")}（见 e2e/fixtures/cat-media/README.md）`);

for (const dir of TARGETS) {
  mkdirSync(dir, { recursive: true });
  for (const f of EXPECTED) {
    const src = join(SRC_DIR, f);
    const dst = join(dir, f);
    copyFileSync(src, dst);
    if (!existsSync(dst) || statSync(dst).size === 0) fail(`拷入失败或为空：${dst}`);
  }
  const placed = readdirSync(dir).filter((f) => f.startsWith("play-")).sort();
  console.log(`[ensure-cat-media] 已放 ${placed.length} 个文件 → ${dir}`);
}
