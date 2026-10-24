/**
 * 云端金库 409 的守卫：两种成因必须两种说法、两种下一步。
 *
 * 真实缺陷（2026-10-25 run38/run39 复核，服务端 6504a7d 早已分开回码）：
 *   - 中枢 PUT /api/vault/sync 在 409 里给 code ∈ {VAULT_CLEARED, VERSION_CONFLICT} 与 hint，
 *     但旧客户端把两者压成同一句「云端金库已被其它设备更新，请先从云端拉取」；
 *   - 云端已被清除（或已在别处注销）时那份内容**根本不存在**，照建议去拉取只能拿到空，
 *     于是用户困在「推送失败 → 拉取为空 → 再推送失败」的空循环里（WCAG 3.3.1 / 3.3.3）。
 * 本文件锁住：code/hint 透传、未知码不硬塞分支、按 current 回退判别，
 * 以及弹窗必须按 kind 分别给可执行动作（重建 v0 / 先拉取）。
 * 镜像到 apps/web/test 后由根 vitest 执行。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-guard0123456789ab'));
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }));
vi.mock('../src/lib/vault', () => ({
  encryptGenericPayload: async () => ({ cipherTextBase64: 'Z3VhcmQ=', ivHex: 'aa', saltHex: 'bb' }),
  decryptGenericPayload: async () => {
    throw new Error('本用例不该解密');
  },
}));

const { saveCloudVault } = await import('../src/lib/navhub-api');
const { syncToCloudVault } = await import('../src/lib/modular/home-diy-io');

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p));
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）');
  return hit;
}

const originalFetch = globalThis.fetch;

/** 用固定 409 回执替换 fetch */
function stubConflict(body: unknown): void {
  globalThis.fetch = (async () => ({
    ok: false,
    status: 409,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockedGetIdentity.mockReturnValue('anon-guard0123456789ab');
});

describe('saveCloudVault：把 409 的 code 与 hint 原样穿上来', () => {
  it('VAULT_CLEARED → code 保留、current=null、hint 不被丢弃', async () => {
    stubConflict({
      error: '云端金库已被清除：本机版本号对应的云端备份已不存在',
      code: 'VAULT_CLEARED',
      current: null,
      hint: '如确认以本机配置重建云端金库，请以 version=0 重新推送',
    });
    const res = await saveCloudVault('anon-guard0123456789ab', '{}', 3);
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.code).toBe('VAULT_CLEARED');
    expect(res.current).toBeNull();
    expect(res.hint).toContain('version=0');
  });

  it('VERSION_CONFLICT → code 与云端当前版本号一起上来', async () => {
    stubConflict({
      error: '版本冲突：云端金库已被其它设备更新',
      code: 'VERSION_CONFLICT',
      current: { version: 7, updatedAt: 1_700_000_000_000 },
      hint: '请先从云端拉取并合并最新内容，再以返回的版本号重新推送',
    });
    const res = await saveCloudVault('anon-guard0123456789ab', '{}', 3);
    expect(res.code).toBe('VERSION_CONFLICT');
    expect(res.current?.version).toBe(7);
  });

  it('中枢将来新增的未知 code 不得被塞进已知分支', async () => {
    stubConflict({ error: '金库正在被另一台设备写入', code: 'VAULT_LOCKED', current: { version: 2, updatedAt: 1 } });
    const res = await saveCloudVault('anon-guard0123456789ab', '{}', 0);
    expect(res.conflict).toBe(true);
    expect(res.code).toBeUndefined();
  });
});

describe('syncToCloudVault：两种冲突给两种下一步', () => {
  it('云端已被清除 → kind=vault-cleared，建议是重建而不是拉取', async () => {
    stubConflict({
      error: '云端金库已被清除：本机版本号对应的云端备份已不存在',
      code: 'VAULT_CLEARED',
      current: null,
      hint: '如确认以本机配置重建云端金库，请以 version=0 重新推送',
    });
    const res = await syncToCloudVault({} as never, 'passw0rd', 3);
    expect(res.success).toBe(false);
    expect(res.conflictKind).toBe('vault-cleared');
    expect(res.currentVersion).toBeNull();
    expect(res.suggestion).toContain('version=0');
    // 旧缺陷锚点：这一支绝不能再出现「请先从云端拉取」
    expect(res.suggestion).not.toContain('请先「从云端拉取」');
  });

  it('真并发写冲突 → kind=version-conflict，带云端版本号并引导先拉取', async () => {
    stubConflict({
      error: '版本冲突：云端金库已被其它设备更新',
      code: 'VERSION_CONFLICT',
      current: { version: 7, updatedAt: 1_700_000_000_000 },
      hint: '请先从云端拉取并合并最新内容，再以返回的版本号重新推送',
    });
    const res = await syncToCloudVault({} as never, 'passw0rd', 3);
    expect(res.conflictKind).toBe('version-conflict');
    expect(res.currentVersion).toBe(7);
    expect(res.suggestion).toContain('拉取');
  });

  it('旧中枢不回 code 时按 current 回退判别，两种结果仍可分辨', async () => {
    stubConflict({ error: '冲突', current: null });
    const cleared = await syncToCloudVault({} as never, 'passw0rd', 3);
    expect(cleared.conflictKind).toBe('vault-cleared');

    stubConflict({ error: '冲突', current: { version: 4, updatedAt: 1 } });
    const concurrent = await syncToCloudVault({} as never, 'passw0rd', 0);
    expect(concurrent.conflictKind).toBe('version-conflict');
    expect(concurrent.currentVersion).toBe(4);
    expect(concurrent.suggestion).toBeTruthy();
  });
});

describe('弹窗分流（源码级钉子）', () => {
  const dialog = () => readFileSync(overlayFile('src/components/home-diy-backup-dialog.tsx'), 'utf8');

  it('两种 kind 各有标题与动作，且内联引导是可播报的 role=status', () => {
    const src = dialog();
    expect(src).toContain("kind === 'vault-cleared' ? '云端金库已被清除'");
    expect(src).toContain('云端金库已被其它设备更新');
    expect(src).toContain('role="status"');
    expect(src).toContain('vaultConflict.kind === \'vault-cleared\'');
    // 重建入口真的带 version=0，而不是只在文案里说说
    expect(src).toContain('handleCloudUpload(0)');
  });

  it('上传按钮不得把点击事件当成 expectedVersion 传进去', () => {
    const src = dialog();
    expect(src).not.toContain('onClick={handleCloudUpload}');
    expect(src).toContain('onClick={() => void handleCloudUpload()}');
  });

  it('io 层不得再回到单一折叠文案', () => {
    const io = readFileSync(overlayFile('src/lib/modular/home-diy-io.ts'), 'utf8');
    expect(io).not.toContain("error: '云端金库已被其它设备更新。请先「从云端拉取」确认最新内容，再重新推送，避免覆盖别人的修改。'");
    expect(io).toContain("CloudVaultConflictKind");
  });
});
