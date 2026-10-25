/**
 * /admin/data/restore 的结构守卫。
 *
 * 这个页面补的是一个长期缺口（恢复此前只能手工 curl），所以守卫的重点不是
 * 视觉细节，而是**几条一旦丢失就会造成真实损害的行为**：
 *
 *   1. 必须有「预演 → 确认 → 执行」三段，不能一步到位。
 *      恢复是整库写操作，直接给一个「一键恢复」按钮，误触的代价太大。
 *   2. 执行必须以 `dryRun=false` 调用、预演必须以 `dryRun=true` 调用——
 *      写反了就是「点了预演结果真写了库」，而界面上看不出来。
 *   3. 失败态必须如实描述「回滚了没有」。同步路径是单事务（真回滚），
 *      异步路径是分片提交（已写入的**不会**回滚）——两种说反都是误导。
 *
 * 分层原则见 docs/TESTING-CONVENTIONS.md：这里是字符串级事实，秒级可查；
 * 「点了之后到底发了什么请求」由 e2e/admin-restore*.spec.ts 覆盖。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const PAGE_PATH = "src/app/admin/data/restore/page.tsx";
const PAGE = overlaySource(PAGE_PATH);

/**
 * 剥掉注释后的源码。
 *
 * 守卫断言「不能出现 X」时必须用它：注释里为了解释「为什么不用 setInterval」
 * 会真的写出 `setInterval`，直接对全文断言就会自己把自己判红——本仓已经在
 * `sitelist-metadata-honesty` 上踩过一次（TESTING-CONVENTIONS 第 4 条）。
 */
const CODE_ONLY = PAGE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("恢复页面：结构与端点契约", () => {
  it("是客户端组件（要读本地文件与状态）", () => {
    expect(PAGE.startsWith("'use client'")).toBe(true);
  });

  it("预演走 dryRun=true，执行走 dryRun=false（写反等于预演就落库）", () => {
    expect(PAGE).toContain("/api/backup/restore?dryRun=true");
    expect(PAGE).toContain("/api/backup/restore?dryRun=false");
    // 两个端点各出现一次，且 dryRun=false 只能在 runRestore 里
    expect(PAGE.match(/dryRun=true/g)?.length).toBe(1);
    expect(PAGE.match(/dryRun=false/g)?.length).toBe(1);
  });

  it("执行前必须有勾选确认，且确认状态参与按钮可用性判断", () => {
    expect(PAGE).toContain('id="confirm-restore"');
    expect(PAGE).toContain("canRestore");
    expect(PAGE).toMatch(/const canRestore = Boolean\(backup && preview && confirmed\)/);
  });

  it("文件输入与确认框都有可访问名关联（field-names 守卫的同一口径）", () => {
    expect(PAGE).toContain('htmlFor="backup-file"');
    expect(PAGE).toContain('id="backup-file"');
    expect(PAGE).toContain('htmlFor="confirm-restore"');
  });

  it("同步失败态如实说明「已整体回滚」，并把 reason 类别翻成人话", () => {
    expect(PAGE).toContain("已整体回滚");
    expect(PAGE).toContain("REASON_TEXT");
    expect(PAGE).toContain("duplicate_key");
    expect(PAGE).toContain("foreign_key");
    // 错误必须落在 role=alert 上，读屏用户才能被通知
    expect(PAGE).toMatch(/role="alert"/);
  });

  it("成功态展示耗时与索引补齐状态（这两个字段是新加的可观测面）", () => {
    expect(PAGE).toContain("durationMs");
    expect(PAGE).toContain("reindexQueued");
  });
});

describe("异步恢复：阈值、轮询与措辞", () => {
  it("阈值判定用「预演算出的站点数」，不是备份包里的原始条数", () => {
    // 2 万条的包里 1.9 万条是重复 URL 时，实际只写 1000 条，走同步更快
    expect(PAGE).toMatch(/preview\.wouldRestore\.sites > ASYNC_THRESHOLD/);
    // 若写成 backup.sites，重复率高的包会被无谓地推给后台任务
    expect(PAGE).not.toMatch(/backup\.sites > ASYNC_THRESHOLD/);
    expect(PAGE).toContain("const ASYNC_THRESHOLD = 5000");
  });

  it("大包提交异步端点，并按 status 端点轮询", () => {
    expect(PAGE).toContain("/api/backup/restore/async");
    expect(PAGE).toContain("/api/backup/restore/status/");
    expect(PAGE).toContain("hubGet");
  });

  it("状态枚举与服务端一致：是 done，不是 completed", () => {
    expect(PAGE).not.toContain("'completed'");
    expect(PAGE).toContain("'done'");
    expect(PAGE).toContain("TERMINAL_STATUS");
  });

  it("异步失败不得声称回滚（分片已提交，回不去）", () => {
    const jobSection = PAGE.slice(PAGE.indexOf("function JobProgress"));
    expect(jobSection.length).toBeGreaterThan(500);
    expect(jobSection).not.toContain("已整体回滚");
    // 必须反过来明确「已写入的会保留」
    expect(jobSection).toContain("会保留");
  });

  it("预演失败不得声称回滚（一条都没写，说回滚会让人去查脏数据）", () => {
    expect(PAGE).toContain("预演失败，未写入任何数据");
    expect(PAGE).toContain("任务未创建，未写入任何数据");
    // 三种错误必须分开口径，不能都用同一句
    expect(PAGE).toMatch(/errorKind === 'sync'[\s\S]{0,120}已整体回滚/);
  });

  it("轮询在终态自行停止，不无限打服务端", () => {
    // 拆成两条精确断言而不是「跨 N 个字符」：中间插一个函数就会把窗口挤爆
    expect(PAGE).toMatch(/const jobActive = job !== null && !TERMINAL_STATUS\.has\(job\.status\)/);
    expect(PAGE).toMatch(/const pollingJobId = job && jobActive && watching \? job\.jobId : null/);
    expect(PAGE).toContain("clearTimeout");
    // 自调度而不是固定 setInterval：间隔要能被服务端改、能被错误退避
    expect(CODE_ONLY).not.toContain("setInterval");
  });

  it("轮询节奏由服务端指挥，且出错退避、有 10 分钟上限", () => {
    // Retry-After（body 里的 retryAfterMs）优先于本地默认间隔
    expect(PAGE).toContain("retryAfterMs");
    expect(PAGE).toContain("POLL_MAX_INTERVAL_MS");
    expect(PAGE).toMatch(/delay \* 2/);
    expect(PAGE).toContain("POLL_DEADLINE_MS");
    // 到点转后台而不是报失败——任务还在服务端跑
    expect(PAGE).toMatch(/setWatching\(false\)[\s\S]{0,120}setPollNotice/);
  });

  it("无事可做时走 200 分支，不建 0/0 的进度卡", () => {
    // RFC 9110：工作已完成或无需执行时应 200，而不是 202 + 空任务
    expect(PAGE).toContain("nothingToDo");
    expect(PAGE).toMatch(/'nothingToDo' in data/);
  });

  it("进度措辞是「已处理」而不是「已写入」（跳过的不算写入）", () => {
    expect(PAGE).toContain("已处理");
    // 旧措辞会高报：分片级去重会跳过一部分，processed ≠ inserted
    expect(PAGE).not.toMatch(/已写入 <span/);
  });

  it("后台任务未结束时禁止再开一次恢复（两个恢复并发写同一库）", () => {    expect(PAGE).toMatch(/disabled=\{jobActive\}/);
    expect(PAGE).toMatch(/const canRestore = [\s\S]{0,120}!jobActive/);
  });

  it("可以取消运行中的任务，且取消与失败分开措辞", () => {
    // 取消走既有的 job 取消端点，不自造新接口
    expect(PAGE).toContain("/api/jobs/");
    expect(PAGE).toContain("cancelRunningJob");
    expect(PAGE).toContain("取消任务");
    // 取消是用户主动的，不能复用「中断/失败」的说法
    expect(PAGE).toMatch(/const isCancelled = job\.status === 'cancelled'/);
    expect(PAGE).toMatch(/const isFailed = job\.status === 'failed'/);
    expect(PAGE).toContain("已取消");
  });

  it("刷新/换标签后能接上同一个任务（任务在服务端，前端只是重新看）", () => {
    expect(PAGE).toContain("sessionStorage");
    expect(PAGE).toContain("readPersistedJob");
    expect(PAGE).toContain("JOB_TTL_MS");
  });

  it("JSX 文本里不能出现 markdown 星号（会渲染成字面 ** 给用户看）", () => {
    // 同一个缺陷本轮犯了两次（横幅与失败说明各一处），而它在代码 review 里
    // 几乎看不出来——只有跑起来看页面才发现。注释里的 ** 不算（用 CODE_ONLY）。
    expect(CODE_ONLY).not.toContain("**");
  });
});

/**
 * 错误文案来源：共享客户端必须「人话优先」。
 *
 * 恢复页的 409 曾经显示成 `CONFLICT_RESTORE_RUNNING`——中枢明明回了
 * `message: "已有恢复任务在进行（running，1000/6000 条）"`。这条守卫锁住优先级顺序，
 * 避免以后有人为了「透出机器码」把顺序改回去（那对用户没有任何信息量）。
 */
describe("错误文案：message 优先于 error", () => {
  it("hubServerMessage 先看 message，再回退 error", () => {
    const api = overlaySource("src/lib/navhub-api.ts");
    const start = api.indexOf("async function hubServerMessage");
    expect(start).toBeGreaterThan(-1);
    const scope = api.slice(start, start + 1600);
    const messageAt = scope.indexOf("parsed.message");
    const errorAt = scope.indexOf("parsed.error");
    expect(messageAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(-1);
    expect(messageAt).toBeLessThan(errorAt);
  });
});
