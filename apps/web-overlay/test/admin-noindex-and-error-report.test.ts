/**
 * 批次 L 回归（2026-11-06 深扫 F-4 / F-5）：后台 noindex + 错误边界 render 期副作用。
 *
 * F-4：admin/layout.tsx 的 generateMetadata 缺 robots:{index:false}，而 robots.ts 只写
 *      Disallow: /admin —— 按爬虫规范 Disallow 只阻止抓取、不阻止收录，22 个后台页
 *      仍可能出现在 SERP。auth / me / favorites / preferences 四个 layout 都已有该行。
 * F-5：app/error.tsx 把 reportClientError(...) 写在 useEffect 之外，每次 render 都发一次
 *      网络上报；错误边界常重渲染 → 一个错误放大成 N 个请求，且 render 期副作用在
 *      并发渲染下会被丢弃/重放。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_LAYOUT = readFileSync(resolve(ROOT, "src/app/admin/layout.tsx"), "utf8");
const ERROR_PAGE = readFileSync(resolve(ROOT, "src/app/error.tsx"), "utf8");

describe("后台必须自行退出索引（F-4）", () => {
  it("admin/layout 的 metadata 声明 robots index:false / follow:true", () => {
    expect(ADMIN_LAYOUT).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(ADMIN_LAYOUT).toMatch(/follow:\s*true/);
  });

  it("与项目内其它已正确声明的 layout 口径一致（至少 4 处存在）", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        const p = resolve(d, e);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (e === "layout.tsx") acc.push(p);
      }
      return acc;
    };
    const layouts = walk(resolve(ROOT, "src/app"));
    const withNoindex = layouts.filter((p) => /robots:\s*\{\s*index:\s*false/.test(readFileSync(p, "utf8")));
    // admin + auth + me + favorites + preferences（≥4 即可，防止只剩 admin 一处被误删）
    expect(withNoindex.length).toBeGreaterThanOrEqual(4);
  });
});

describe("错误边界不在 render 期发上报（F-5）", () => {
  it("reportClientError 必须在 useEffect 内部调用", () => {
    const effectStart = ERROR_PAGE.indexOf("useEffect(");
    const reportIdx = ERROR_PAGE.indexOf("reportClientError(");
    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThan(effectStart);
  });

  it("useEffect 依赖数组包含 error（避免漏报）", () => {
    expect(ERROR_PAGE).toMatch(/\}, \[error\]\)/);
  });

  it("不再有顶格的 render 期副作用（旧写法缩进 4 空格且紧跟 effect 闭合）", () => {
    expect(ERROR_PAGE).not.toMatch(/\}, \[error\]\)\n\s{4}reportClientError\(/);
  });
});
