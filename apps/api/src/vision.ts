/**
 * 站点截图理解（vision）：Playwright 截图 + 多模态模型分析。
 *
 * 设计取舍：
 *
 *  1. **诚实降级**：截图依赖 Chromium 二进制。没装浏览器时**明确报
 *     `vision_unavailable` 并给出安装命令**，绝不返回编造的分类/标签
 *     （那会让运营把假数据当真，是本仓库反复治理过的同类问题）。
 *  2. **不落盘**：截图只在内存里以 base64 data URL 传给模型（已实测 Agnes
 *     接受 data URL 并计入 image_tokens）。避免为一次性分析引入截图存储、
 *     清理任务与隐私面。
 *  3. **SSRF 与抓取同策略**：目标 URL 走 `assertUrlShape` + `resolveAndCheck`，
 *     私网/环回/元数据地址一律拒绝（与富化抓取共用一套判定）。
 *  4. **用量照记**：分析调用走 `callLlm`，scenario = "vision"，
 *     观测面板能看到截图理解用了多少 token、多慢。
 */
import { assertUrlShape, resolveAndCheck } from "@navhub/ai";
import type { FetchGuardOptions } from "@navhub/ai";

/** 浏览器不可用（未安装 / 启动失败）：调用方应回 503 而不是 500 */
export class VisionUnavailableError extends Error {
  readonly code = "vision_unavailable";
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = "VisionUnavailableError";
  }
}

export interface ScreenshotResult {
  /** data:image/jpeg;base64,... */
  dataUrl: string;
  bytes: number;
  tookMs: number;
  /** 实际渲染的最终地址（可能被重定向） */
  finalUrl: string;
}

const MAX_SHOT_BYTES = 600 * 1024;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * 探测截图能力。
 *
 * 只检查「包能加载 + 浏览器可执行文件存在」，不启动浏览器（毫秒级）。
 * 生产镜像里应在构建期 `npx playwright install --with-deps chromium`。
 */
export async function visionAvailability(): Promise<{ available: boolean; reason?: string }> {
  try {
    const mod = (await import("@playwright/test")) as {
      chromium?: { executablePath?: () => string };
    };
    const execPath = mod.chromium?.executablePath?.();
    if (!execPath) return { available: false, reason: "playwright 未提供 chromium" };
    const { existsSync } = await import("node:fs");
    if (!existsSync(execPath)) {
      return {
        available: false,
        reason: `Chromium 未安装（期望路径：${execPath}）。请在部署环境执行 npx playwright install --with-deps chromium`,
      };
    }
    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason: `Playwright 不可用：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 截取站点首屏（1280×800，JPEG q70，约 60–200KB） */
export async function captureSiteScreenshot(
  rawUrl: string,
  guard: Partial<FetchGuardOptions> = {},
): Promise<ScreenshotResult> {
  // 1. SSRF：与富化抓取同一套判定（私网、环回、元数据地址一律拒绝）
  const target = assertUrlShape(rawUrl);
  await resolveAndCheck(target, { ...(guard as FetchGuardOptions) });

  const startedAt = Date.now();
  let browser: any = null;
  try {
    const mod = (await import("@playwright/test")) as {
      chromium: {
        launch: (opts: Record<string, unknown>) => Promise<{
          newPage: (opts?: Record<string, unknown>) => Promise<{
            setViewportSize: (s: { width: number; height: number }) => Promise<void>;
            goto: (url: string, opts?: Record<string, unknown>) => Promise<{ url: () => string } | null>;
            waitForTimeout: (ms: number) => Promise<void>;
            screenshot: (opts: Record<string, unknown>) => Promise<Buffer>;
          }>;
          close: () => Promise<void>;
        }>;
        executablePath?: () => string;
      };
    };
    const execPath = mod.chromium.executablePath?.();
    const { existsSync } = await import("node:fs");
    if (!execPath || !existsSync(execPath)) {
      throw new VisionUnavailableError(
        "截图能力不可用",
        `Chromium 未安装（期望路径：${execPath ?? "未知"}）。请执行 npx playwright install --with-deps chromium`,
      );
    }

    browser = await mod.chromium.launch({
      headless: true,
      // 容器内以 root 运行时 Chromium 需要关闭沙箱；本机非 root 也可用
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.setViewportSize(VIEWPORT);
    // goto 的返回值带着**跳转后的最终地址**：目标站常见 http→https、补 /zh-CN/
    // 或落到登录页。直接回填 target 会把「看的是哪个页面」记错，后续排查/审计
    // 都对不上实际截图内容。
    const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    const finalUrl = response?.url?.() || target.toString();
    /**
     * 重定向落点必须再过一次 SSRF 守卫，且要在截图之前：
     * 初始 URL 校验通过后，目标站仍可用 302 把浏览器带到 169.254.169.254 或内网管理台。
     * 这里拦不住「请求已经发出」，但能保证内网页面内容不会进入截图、更不会传给模型。
     */
    await resolveAndCheck(new URL(finalUrl), { ...(guard as FetchGuardOptions) });
    // 给首屏字体/图片一点稳定时间（不追求 fullPage，首屏就够判断站点形态）
    await page.waitForTimeout(900);
    const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });

    if (buf.byteLength > MAX_SHOT_BYTES) {
      // 1280×800 JPEG q70 正常在 200KB 内；超限说明页面极复杂，降质重拍一次
      const smaller = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
      return {
        dataUrl: `data:image/jpeg;base64,${smaller.toString("base64")}`,
        bytes: smaller.byteLength,
        tookMs: Date.now() - startedAt,
        finalUrl,
      };
    }

    return {
      dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
      bytes: buf.byteLength,
      tookMs: Date.now() - startedAt,
      finalUrl,
    };
  } catch (err) {
    if (err instanceof VisionUnavailableError) throw err;
    throw new VisionUnavailableError(
      "截图失败",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        /* 关闭失败不影响已取得的截图；进程会随请求结束回收 */
      });
    }
  }
}

/** 截图理解的输出契约 */
export interface SiteVisionAnalysis {
  title: string;
  description: string;
  category: string;
  tags: string[];
  /** 模型对截图内容的简短描述（便于人工核对「它到底看到了什么」） */
  visualSummary: string;
}

export const VISION_PROMPT = [
  "你是网址导航站的编辑。根据这张网站首屏截图，判断该站点的用途并输出严格 JSON（不要 markdown 代码块）：",
  '{ "title": "站点本名", "description": "中文一句话概括用途，30~80 字", "category": "简短中文分类", "tags": ["3~6 个短标签"], "visualSummary": "你在截图里看到的主要内容，20~40 字" }',
  "要求：只依据截图可见内容判断，不要编造截图里没有的信息；如果截图是登录墙/空白/错误页，visualSummary 要如实说明。",
].join("\n");
