/**
 * 逐文件拷贝（vendor-web.mjs 的核心搬运逻辑，抽成模块以便单测）。
 *
 * 为什么不用 `cpSync(src, dst, { recursive: true })` 一把梭：
 *   - 部分 Windows 环境下递归 cpSync 会 EIO（Access is denied），单文件 cpSync 正常；
 *   - 上游 tarball / 覆盖层目录里若混入安装产物（node_modules 里的目录符号链接），
 *     非递归 cpSync 会抛 "Recursive option not enabled"，CI 的 vendor 步骤会整条挂掉。
 *
 * 因此这里逐条 entry 走，负责三件事：
 *   1. 跳过安装产物（node_modules / .next，任意层级）；
 *   2. 尊重 NavHub 自有文件清单（skipRel）：目标已存在时保留仓库版本，不被上游覆盖；
 *   3. 兜底路径冲突（目录 ↔ 文件）与写入失败重试（Windows Defender/OneDrive filter
 *      驱动会以 errno 0 的怪异错误打断 cpSync 的 unlink 路径，copyFileSync 不吃这套）。
 *
 * 所有会产生副作用、但测试里需要可控的环节（copyFile / cp / sleep / log）
 * 都可以从 options 注入；默认值就是生产行为。
 */
import { mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync, copyFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_ENTRIES = new Set(["node_modules", ".next"]);
const DEFAULT_DEADLINE_MS = 20_000;

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 把 srcDir 的内容逐文件镜像到 dstDir（合并式覆盖，不删除 dstDir 里的其它文件）。
 *
 * @param {string} srcDir 源目录
 * @param {string} dstDir 目标目录
 * @param {object} [options]
 * @param {string} [options.targetRoot=dstDir] 计算 skipRel 相对路径的基准目录
 * @param {Set<string>|null} [options.skipRel=null] 仓库自有文件（相对 targetRoot 的 posix 路径）
 * @param {{count:number}|null} [options.counter=null] 成功拷贝文件数累加器
 * @param {Function} [options.copyFile=copyFileSync] 单文件覆盖写实现
 * @param {Function} [options.cp=cpSync] 符号链接/兜底拷贝实现
 * @param {Function} [options.sleep=defaultSleep] 重试等待（测试里注入 no-op）
 * @param {number} [options.deadlineMs=DEFAULT_DEADLINE_MS] 单文件重试上限
 * @param {Function} [options.log=noop] 日志输出
 */
export function walkAndCopy(srcDir, dstDir, options = {}) {
  const {
    targetRoot = dstDir,
    skipRel = null,
    counter = null,
    copyFile = copyFileSync,
    cp = cpSync,
    sleep = defaultSleep,
    deadlineMs = DEFAULT_DEADLINE_MS,
    log = () => {},
  } = options;

  const relOf = (p) => relative(targetRoot, p).split(sep).join("/");

  const copyOnce = (s, d) => {
    const deadline = Date.now() + deadlineMs;
    let attempt = 0;
    for (;;) {
      try {
        if (attempt > 0) log("[vendor] retry copy " + d + " (attempt " + (attempt + 1) + ")");
        copyFile(s, d);
        return;
      } catch (e) {
        attempt++;
        // 兜底：删掉目标再拷（目标是目录、或 unlink 路径被安全软件干扰时能救回来）。
        const fallbackOk = (() => {
          try {
            rmSync(d, { force: true, recursive: true });
            cp(s, d, { force: true });
            return true;
          } catch {
            return false;
          }
        })();
        if (fallbackOk) return;
        if (Date.now() >= deadline) throw e;
        sleep(Math.min(2000, 200 * attempt));
      }
    }
  };

  const walk = (src, dst) => {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (SKIP_ENTRIES.has(entry.name)) continue;
      const s = join(src, entry.name);
      const d = join(dst, entry.name);
      if (skipRel && skipRel.has(relOf(d)) && existsSync(d)) continue;
      if (entry.isDirectory()) {
        // 目标同名路径若已是文件（上游 / overlay 目录结构变化），先移除，避免 EISDIR。
        try {
          if (!statSync(d).isDirectory()) rmSync(d, { force: true, recursive: true });
        } catch {
          /* 目标不存在：无需处理 */
        }
        walk(s, d);
      } else if (entry.isSymbolicLink()) {
        cp(s, d, { force: true, recursive: true });
        if (counter) counter.count++;
      } else {
        copyOnce(s, d);
        if (counter) counter.count++;
      }
    }
  };

  walk(srcDir, dstDir);
}
