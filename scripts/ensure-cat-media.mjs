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
 *
 * U-443（2026-11-26）：普通开发栈（`pnpm dev:all`）从不调本脚本，全新
 * checkout 下 `public/xiaomaomao/media/` 为空、9 个媒体全 404，猫被
 * hideCat() 藏掉（图谱复核两线在 dev 栈上实测）。`scripts/dev-all.mjs`
 * 启动前以 `--fill-missing` 调本脚本：只补缺失文件，绝不覆盖已有的
 * 真实媒体——夹具只有 3–6KB、真实媒体 ≥1.9MB（见 media-manifest.json），
 * 以 100KB 划线；已放过夹具的（尺寸与夹具一致）也不重写。生产行为
 * 不变：生产媒体缺失时挂件仍按设计藏猫，本脚本只解决开发栈的可用媒体。
 *
 * `NAVHUB_CAT_MEDIA_TARGETS`（逗号分隔，相对路径按仓库根解析）可覆盖
 * 写出目录，仅供测试用；正常调用不设此变量，走默认两处。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "e2e", "fixtures", "cat-media");
const DEFAULT_TARGETS = [
  join(ROOT, "apps", "web", "public", "xiaomaomao", "media"),
  join(ROOT, "apps", "web-overlay", "public", "xiaomaomao", "media"),
];
const TARGETS = process.env.NAVHUB_CAT_MEDIA_TARGETS
  ? process.env.NAVHUB_CAT_MEDIA_TARGETS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => resolve(ROOT, p))
  : DEFAULT_TARGETS;
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

/**
 * U-443：--fill-missing 下，目标文件达到此尺寸即视为真实媒体、绝不覆盖。
 * 夹具 3–6KB，真实媒体 ≥1.9MB，100KB 把两者干净分开。
 */
const FILL_MISSING_MIN_REAL_BYTES = 100_000;
const FILL_MISSING = process.argv.includes("--fill-missing");

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
  let copied = 0;
  let skipped = 0;
  for (const f of EXPECTED) {
    const src = join(SRC_DIR, f);
    const dst = join(dir, f);
    if (FILL_MISSING && existsSync(dst)) {
      const dstSize = statSync(dst).size;
      // 真实媒体（≥100KB）或已放过的夹具（尺寸一致）：一律不碰。
      if (dstSize >= FILL_MISSING_MIN_REAL_BYTES || dstSize === statSync(src).size) {
        skipped++;
        continue;
      }
    }
    copyFileSync(src, dst);
    if (!existsSync(dst) || statSync(dst).size === 0) fail(`拷入失败或为空：${dst}`);
    copied++;
  }
  if (FILL_MISSING) {
    const present = readdirSync(dir).filter((f) => f.startsWith("play-")).sort();
    console.log(
      `[ensure-cat-media] 补缺 ${copied} 个、跳过 ${skipped} 个已有文件 → ${dir}（共 ${present.length} 个 play-*）`
    );
  } else {
    const placed = readdirSync(dir).filter((f) => f.startsWith("play-")).sort();
    console.log(`[ensure-cat-media] 已放 ${placed.length} 个文件 → ${dir}`);
  }
}
