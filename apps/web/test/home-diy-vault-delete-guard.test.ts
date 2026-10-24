/**
 * 云端金库删除链路的守卫：四种事实必须四种说法。
 *
 * 真实缺陷（2026-10-24 run36 复核，信号：user_vault_sync 本机 0 行、DIY 面零埋点）：
 *   - 服务端 DELETE /api/vault/sync 老实返回 {ok, deleted}（deleted=false 表示云端本来就没有），
 *     但旧客户端 `deleteCloudVault(): Promise<boolean>` 把任何 2xx 一律折成 true，
 *     于是 UI 能对从未存在过的备份宣称「已删除你的云端备份」；
 *   - `clearCloudVault()` 连「取不到本机身份」（根本没发请求）也返回 false，
 *     与「中枢 500」共用一句失败文案 —— 用户不知道该不该重试。
 * 本文件锁住：四态分流、失败带 status、无身份绝不发请求，以及弹窗源码不得把
 * absent/failed 渲染成成功话术（镜像到 apps/web/test 后由根 vitest 执行）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-guard0123456789ab'));
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }));

const { deleteCloudVault } = await import('../src/lib/navhub-api');
const { clearCloudVault } = await import('../src/lib/modular/home-diy-io');

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的源文件；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p));
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）');
  return hit;
}

interface Recorded {
  url: string;
  method: string;
}

const originalFetch = globalThis.fetch;

/** 固定回执替换 fetch，并记录请求（method + url） */
function stubFetch(status: number, body: string): Recorded[] {
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), method: String(init?.method ?? 'GET') });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockedGetIdentity.mockReturnValue('anon-guard0123456789ab');
});

describe('deleteCloudVault：把服务端回执原样穿上来', () => {
  it('deleted=true → {ok:true,deleted:true}，且真的打 DELETE /api/vault/sync', async () => {
    const calls = stubFetch(200, JSON.stringify({ ok: true, deleted: true }));
    const res = await deleteCloudVault('anon-guard0123456789ab');
    expect(res).toEqual({ ok: true, deleted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/api/hub/vault/sync');
  });

  it('deleted=false（云端本来没有）绝不塌成 true —— 这是旧缺陷的锚点', async () => {
    stubFetch(200, JSON.stringify({ ok: true, deleted: false }));
    const res = await deleteCloudVault('anon-guard0123456789ab');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.deleted).toBe(false);
  });

  it('非 2xx → ok:false 并保留 status 与中枢文案', async () => {
    stubFetch(500, JSON.stringify({ error: '存储层写入失败' }));
    const res = await deleteCloudVault('anon-guard0123456789ab');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.error).toContain('存储层写入失败');
    }
  });
});

describe('clearCloudVault：四种事实四种结果', () => {
  it('真删 → kind=deleted', async () => {
    stubFetch(200, JSON.stringify({ ok: true, deleted: true }));
    expect(await clearCloudVault()).toEqual({ kind: 'deleted' });
  });

  it('云端本来没有 → kind=absent（不得当成删除成功）', async () => {
    stubFetch(200, JSON.stringify({ ok: true, deleted: false }));
    expect(await clearCloudVault()).toEqual({ kind: 'absent' });
  });

  it('取不到身份 → kind=no-identity，并且一个请求都不发', async () => {
    const calls = stubFetch(200, JSON.stringify({ ok: true, deleted: true }));
    mockedGetIdentity.mockReturnValue('');
    expect(await clearCloudVault()).toEqual({ kind: 'no-identity' });
    expect(calls).toHaveLength(0);
  });

  it('请求失败 → kind=failed 带 status，供 UI 说明「可稍后重试」', async () => {
    stubFetch(503, JSON.stringify({ error: '中枢暂时不可用' }));
    const res = await clearCloudVault();
    expect(res.kind).toBe('failed');
    if (res.kind === 'failed') {
      expect(res.status).toBe(503);
      expect(res.error).toContain('中枢暂时不可用');
    }
  });
});

describe('删除入口与话术（源码级钉子）', () => {
  it('工具栏把 clearCloudVault 注入弹窗 —— 否则删除入口依旧不可达', () => {
    const toolbar = readFileSync(overlayFile('src/components/home-diy-toolbar.tsx'), 'utf8');
    expect(toolbar).toContain('clearCloudVault={clearCloudVault}');
  });

  it('弹窗对四种 kind 分别措辞，且 absent / failed 不得出现「已删除」成功话术', () => {
    const dialog = readFileSync(overlayFile('src/components/home-diy-backup-dialog.tsx'), 'utf8');
    expect(dialog).toContain("res.kind === 'deleted'");
    expect(dialog).toContain("res.kind === 'absent'");
    expect(dialog).toContain("res.kind === 'no-identity'");
    const absentBranch = dialog.slice(dialog.indexOf("res.kind === 'absent'"), dialog.indexOf("res.kind === 'no-identity'"));
    expect(absentBranch).toContain('本次请求没有删除任何数据');
    expect(absentBranch).not.toContain('云端金库已永久删除');
    expect(dialog).toContain('此操作不可撤销');
    // 破坏性确认：Cancel 必须排在 Action 前，初始焦点才不会落在「永久删除」上
    expect(dialog.indexOf('<AlertDialogCancel')).toBeLessThan(dialog.indexOf('<AlertDialogAction'));
  });
});
