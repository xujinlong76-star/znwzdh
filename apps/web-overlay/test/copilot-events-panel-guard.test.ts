/**
 * copilot 遥测消费方的前端钉子（2026-10-27 run85b）。
 *
 * 上一轮的账本缺口是「kind=copilot / copilot_cancel 全仓只写不读」。
 * 写侧有 apps/api/test/copilot-cancel.test.ts 钉着，读侧是跨包的三段链
 * （store 聚合 → API 路由 → 面板），任何一段被删掉都不会有编译错误，
 * 只会在管理端悄悄变回「看不到取消数」——所以在这里按源码文本钉住。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const overlay = (p: string) => readFileSync(resolve(ROOT, 'apps/web-overlay', p), 'utf8');
const store = (p: string) => readFileSync(resolve(ROOT, 'packages/store', p), 'utf8');

describe('copilot 取消读数的展示链路', () => {
  it('store 侧聚合函数按两个 kind 取数，并解析 meta.waited_ms', () => {
    const src = store('src/repository/events.ts');
    expect(src).toContain('export async function copilotEventSummary');
    expect(src).toContain("kind IN ('copilot', 'copilot_cancel')");
    expect(src).toContain('meta.waited_ms');
    expect(src).toContain('cancelStage');
  });

  it('聚合函数从包入口具名导出（Repository 类不在本轮改动范围内）', () => {
    const idx = store('src/index.ts');
    expect(idx).toMatch(/export \{[^}]*copilotEventSummary[^}]*\} from "\.\/repository\/events\.ts"/);
  });

  it('中枢侧暴露只读管理端点，窗口走统一的 parseTimeWindow', () => {
    const src = overlay('src/app/api/hub/[...path]/route.ts');
    expect(src, '代理是路径透传，不该出现写死的 copilot 端点').not.toContain('/api/admin/copilot/events');
    const stats = readFileSync(resolve(ROOT, 'apps/api/src/routes/stats.ts'), 'utf8');
    expect(stats).toContain('"/api/admin/copilot/events"');
    expect(stats).toContain('copilotEventSummary(ctx.repo, days)');
    expect(stats).toContain('parseTimeWindow(req.query as Record<string, unknown>, "days", 7, 1, 90)');
  });

  it('面板调用该端点，并把取消率与放弃前等待时长渲染出来', () => {
    const panel = overlay('src/components/ai/ai-observability-panel.tsx');
    expect(panel).toContain('/api/admin/copilot/events?days=');
    expect(panel).toContain('copilot.cancelRate');
    expect(panel).toContain('copilot.waitMs.p50');
    expect(panel).toContain('copilot.cancelStage.pre_llm');
    // 无样本必须写「无样本」，不能渲染成 0.0%（0 会被读成「没人取消」）
    expect(panel).toContain("'无样本'");
  });

  it('面板读取失败只降级这一块，不把整张模型大盘抹掉', () => {
    const panel = overlay('src/components/ai/ai-observability-panel.tsx');
    expect(panel).toContain('copilotError');
    expect(panel).toMatch(/hubGet<HubCopilotEventSummary>/);
    expect(panel, '取消读数与大盘读数各自独立 catch').toMatch(/\.catch\(\(err: unknown\) =>/);
  });
});
