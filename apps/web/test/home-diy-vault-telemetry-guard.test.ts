/**
 * 云端金库埋点：一次把「有没有人在用」问出来（2026-10-25 run44）。
 *
 * 真实缺口（本轮 §3 实测）：events 791 行里 kind LIKE '%vault%'|'%diy%'|'%backup%' 命中 0 行、
 * user_vault_sync 0 行 —— 推送、拉取、永久删除跑没跑通过、有多少人撞到 VAULT_CLEARED，
 * 全都答不上来。要补的不是日志而是漏斗，而漏斗的前提是每条分支各落一次、
 * 且词表两侧一致。
 *
 * 本文件锁四层：
 *   1. 词表：客户端联合类型与服务端白名单逐字一致（服务端不在名单里直接 400，
 *      两侧各自扩自己的就等于埋点静默失效）；
 *   2. 分支码：「云端没有备份」与「这次没查到」在数据上必须是两个值 ——
 *      旧实现两者共用 hasCloudVault:false，中枢一挂就被读成「没人同步过」；
 *   3. 上报点：弹窗每条业务分支各一次，且成功后的复查不重复计入分母；
 *   4. 隐私：埋点正文只有 kind/outcome/code/anonId，密文、条数、主密码一律不上。
 * 镜像到 apps/web/test 后由根 vitest 执行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-vaulttrack01234567'));
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }));

const { trackVaultEvent, vaultTelemetryVocabulary } = await import('../src/lib/navhub-api');
const {
  checkCloudVaultStatus,
  clearCloudVault,
  importEncryptedDIYConfig,
  syncToCloudVault,
  syncFromCloudVault,
  vaultPullOutcome,
  vaultStatusOutcome,
} = await import('../src/lib/modular/home-diy-io');

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的源文件；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p));
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）');
  return hit;
}

/**
 * 从服务端源码里抠出一个 `as const` 数组的字面量集合。
 *
 * 只在「拿不到运行期导出」时才读源码：telemetry.ts 的白名单是路由闭包里的局部常量，
 * 不导出（导出它等于给生产代码加一个只为测试存在的公共 API）。
 */
function constArrayLiterals(source: string, declaration: string): string[] {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`找不到声明：${declaration}`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error(`声明不是数组字面量：${declaration}`);
  return [...source.slice(open, close).matchAll(/"([a-z_]+)"|'([a-z_]+)'/g)].map((m) => m[1] ?? m[2]!);
}

const originalFetch = globalThis.fetch;
let vaultCalls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];

/**
 * 按 URL 前缀分派的 fetch 桩：金库读写走 /api/hub/vault/sync，埋点走 /api/hub/events。
 * 记录每一次调用，这样「有没有上报」「上报了什么」是断言出来的，不是读源码猜出来的。
 */
function stubFetch(handler: (url: string, init: any) => { status: number; body: unknown }) {
  vaultCalls = [];
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(input);
    vaultCalls.push({
      url,
      method: String(init?.method ?? 'GET'),
      body: typeof init?.body === 'string' ? init.body : '',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const res = handler(url, init);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => JSON.stringify(res.body),
      json: async () => res.body,
    } as unknown as Response;
  }) as typeof fetch;
}

const events = () => vaultCalls.filter((c) => c.url.includes('/events'));
const lastEventBody = () => JSON.parse(events().at(-1)!.body) as Record<string, unknown>;

beforeEach(() => {
  mockedGetIdentity.mockReturnValue('anon-vaulttrack01234567');
  // trackVaultEvent 的 `typeof window === 'undefined'` 是 SSR 护栏，不是业务分支。
  // 根 vitest 跑在 node 环境里，不点亮这个开关就只能读源码猜「有没有上报」。
  ;(globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as { window?: unknown }).window;
});

describe('词表两侧一致（服务端白名单是唯一真相源）', () => {
  const server = readFileSync(resolve(HERE, '..', '..', 'api', 'src', 'routes', 'telemetry.ts'), 'utf8');

  it('kind：客户端四个 vault_* 全部在服务端 EVENT_KINDS 白名单内', () => {
    const serverKinds = constArrayLiterals(server, 'const EVENT_KINDS = [');
    for (const kind of vaultTelemetryVocabulary.kinds) {
      expect(serverKinds, `服务端未登记 kind：${kind}`).toContain(kind);
    }
    expect([...vaultTelemetryVocabulary.kinds]).toEqual(['vault_status', 'vault_sync', 'vault_pull', 'vault_delete']);
  });

  it('outcome：两侧集合完全相等（谁多谁少都算漂移）', () => {
    const serverOutcomes = constArrayLiterals(server, 'const EVENT_OUTCOMES = [').sort();
    expect([...vaultTelemetryVocabulary.outcomes].sort()).toEqual(serverOutcomes);
  });

  it('原因码全部 ≤32 字符 —— 服务端 code 的长度上限就是这条约束', () => {
    for (const code of vaultTelemetryVocabulary.codes) {
      expect(code.length, `原因码超出 32 字符：${code}`).toBeLessThanOrEqual(32);
    }
  });
});

describe('trackVaultEvent：只上报词表，不上报内容', () => {
  it('POST 到 /api/events，带匿名身份 header，body 只有 kind/outcome/code/anonId', () => {
    stubFetch(() => ({ status: 204, body: {} }));
    trackVaultEvent('vault_sync', 'conflict', 'vault_cleared');
    expect(events()).toHaveLength(1);
    const call = events()[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/events');
    expect(call.headers['X-Navhub-Anon-Id']).toBe('anon-vaulttrack01234567');
    expect(Object.keys(lastEventBody()).sort()).toEqual(['anonId', 'code', 'kind', 'outcome']);
  });

  it('不带 code 时 body 里不出现空字段', () => {
    stubFetch(() => ({ status: 204, body: {} }));
    trackVaultEvent('vault_delete', 'deleted');
    expect(Object.keys(lastEventBody()).sort()).toEqual(['anonId', 'kind', 'outcome']);
  });

  it('埋点请求抛错绝不冒泡 —— 金库操作的结果不由观测层决定', () => {
    globalThis.fetch = (() => {
      throw new Error('浏览器拒绝发起请求');
    }) as typeof fetch;
    expect(() => trackVaultEvent('vault_sync', 'failed', 'hub_error')).not.toThrow();
  });
});

describe('对表结果分成三种事实（旧实现只有一种）', () => {
  it('云端返回 vault:null → no_vault（真的没有备份）', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }));
    expect(await checkCloudVaultStatus()).toEqual({ hasCloudVault: false, code: 'no_vault' });
  });

  it('中枢挂了 → check_failed，不得冒充「云端没有备份」', async () => {
    stubFetch(() => ({ status: 503, body: { error: '存储层写入失败' } }));
    // fetch 成功但 !res.ok 时 getJson 会抛 hubError → 走降级回调
    const res = await checkCloudVaultStatus();
    expect(res.hasCloudVault).toBe(false);
    expect(res.code).toBe('check_failed');
  });

  it('取不到本机身份 → no_identity，且一个请求都不发', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }));
    mockedGetIdentity.mockReturnValue('');
    expect(await checkCloudVaultStatus()).toEqual({ hasCloudVault: false, code: 'no_identity' });
    expect(vaultCalls.filter((c) => c.url.includes('/vault/'))).toHaveLength(0);
  });

  it('有金库 → has_vault 并带上版本号', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: { userId: 'x', payload: 'cipher', version: 4, updatedAt: 9 } } }));
    const res = await checkCloudVaultStatus();
    expect(res).toEqual({ hasCloudVault: true, updatedAt: 9, version: 4, code: 'has_vault' });
  });

  it('分母事件把三种事实映射成三种 outcome', () => {
    expect(vaultStatusOutcome('has_vault')).toBe('success');
    expect(vaultStatusOutcome('no_vault')).toBe('empty');
    expect(vaultStatusOutcome('check_failed')).toBe('failed');
    expect(vaultStatusOutcome('no_identity')).toBe('no_identity');
  });

  it('拉取回空记成 empty 而不是 failed', () => {
    expect(vaultPullOutcome(true, 'has_vault')).toBe('success');
    expect(vaultPullOutcome(false, 'no_vault')).toBe('empty');
    expect(vaultPullOutcome(false, 'decrypt_failed')).toBe('failed');
  });
});

describe('推送/拉取/删除的分支码', () => {
  const config = { version: 3, customCategories: [] } as any;
  const persist = vi.fn(() => config);

  it('409 VAULT_CLEARED → code=vault_cleared（引导是重建，不是拉取）', async () => {
    stubFetch((url, init) =>
      url.includes('/vault/') && init?.method === 'PUT'
        ? { status: 409, body: { code: 'VAULT_CLEARED', current: null, error: '云端金库已被清除' } }
        : { status: 200, body: { ok: true, vault: null } },
    );
    const res = await syncToCloudVault(config, 'sup3rsecret', 2);
    expect(res.success).toBe(false);
    expect(res.conflictKind).toBe('vault-cleared');
    expect(res.code).toBe('vault_cleared');
  });

  it('409 VERSION_CONFLICT → code=version_conflict', async () => {
    stubFetch((url, init) =>
      url.includes('/vault/') && init?.method === 'PUT'
        ? { status: 409, body: { code: 'VERSION_CONFLICT', current: { version: 7, updatedAt: 1 }, error: '版本冲突' } }
        : { status: 200, body: { ok: true, vault: null } },
    );
    const res = await syncToCloudVault(config, 'sup3rsecret', 2);
    expect(res.code).toBe('version_conflict');
  });

  it('非 2xx 写入 → hub_error（旧实现只有一个中文 error，聚合读不出成因）', async () => {
    stubFetch((url, init) =>
      url.includes('/vault/') && init?.method === 'PUT'
        ? { status: 500, body: { error: '存储层写入失败' } }
        : { status: 200, body: { ok: true, vault: null } },
    );
    const res = await syncToCloudVault(config, 'sup3rsecret', 0);
    expect(res.success).toBe(false);
    expect(res.code).toBe('hub_error');
  });

  it('云端没有备份时拉取 → no_vault，与解密失败分开', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }));
    const res = await syncFromCloudVault('sup3rsecret', persist);
    expect(res.success).toBe(false);
    expect(res.code).toBe('no_vault');
  });

  it('密文包字段缺失 → invalid_cipher_package（不是「密码错」）', async () => {
    const res = await importEncryptedDIYConfig(JSON.stringify({ cipherTextBase64: 'AAA' }), 'sup3rsecret', persist);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('invalid_cipher_package');
  });

  it('密文包不是 JSON → invalid_json', async () => {
    const res = await importEncryptedDIYConfig('{不是json', 'sup3rsecret', persist);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('invalid_json');
  });

  it('主密码不匹配 → decrypt_failed', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        ok: true,
        vault: {
          userId: 'anon-vaulttrack01234567',
          payload: JSON.stringify({
            cipherTextBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            ivHex: '00112233445566778899aabb',
            saltHex: 'ff'.repeat(16),
          }),
          version: 1,
          updatedAt: 1,
        },
      },
    }));
    const res = await syncFromCloudVault('wrongpassphrase', persist);
    expect(res.success).toBe(false);
    expect(res.code).toBe('decrypt_failed');
  });

  it('删除的四种事实各有一个 code 可用：no-identity 与 hub_error 不混', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, deleted: true } }));
    mockedGetIdentity.mockReturnValue('');
    expect(await clearCloudVault()).toEqual({ kind: 'no-identity' });

    stubFetch(() => ({ status: 502, body: { error: '网关不可用' } }));
    mockedGetIdentity.mockReturnValue('anon-vaulttrack01234567');
    const res = await clearCloudVault();
    expect(res.kind).toBe('failed');
  });
});

describe('弹窗上报点（源码级钉子）', () => {
  const dialog = readFileSync(overlayFile('src/components/home-diy-backup-dialog.tsx'), 'utf8');

  it('四个 kind 各有上报，且成功/冲突/失败分支都在', () => {
    for (const kind of ['vault_status', 'vault_sync', 'vault_pull', 'vault_delete']) {
      expect(dialog, `弹窗未上报 ${kind}`).toContain(`trackVaultEvent('${kind}'`);
    }
    expect(dialog).toContain(`trackVaultEvent('vault_sync', 'success')`);
    expect(dialog).toContain(`trackVaultEvent('vault_sync', 'conflict'`);
    expect(dialog).toContain(`trackVaultEvent('vault_sync', 'failed'`);
    expect(dialog).toContain(`trackVaultEvent('vault_pull', 'success')`);
    expect(dialog).toContain(`trackVaultEvent('vault_delete', 'deleted')`);
    expect(dialog).toContain(`trackVaultEvent('vault_delete', 'absent')`);
    expect(dialog).toContain(`trackVaultEvent('vault_delete', 'no_identity'`);
  });

  it('上报顺序：先落事件再弹 toast —— 界面崩了也不该丢掉这次观测', () => {
    const syncBlock = dialog.slice(dialog.indexOf('const res = await syncToCloudVault'), dialog.indexOf('const status = await checkCloudVaultStatus'));
    expect(syncBlock.indexOf('trackVaultEvent')).toBeLessThan(syncBlock.indexOf('toast({'));
  });

  it('推送成功后的复查不得再报一次 vault_status（分母会被同一个人重复计数）', () => {
    expect(dialog).toContain('trackVaultEvent(\'vault_status\'');
    expect(dialog.match(/trackVaultEvent\('vault_status'/g)).toHaveLength(1);
  });

  it('表单校验（主密码太短）不冒充业务分支：早退处没有上报', () => {
    const uploadGuard = dialog.slice(dialog.indexOf('const handleCloudUpload'), dialog.indexOf('setIsSyncingCloud(true)'));
    expect(uploadGuard).not.toContain('trackVaultEvent');
  });

  it('埋点绝不把密文或主密码放进上报参数', () => {
    for (const call of dialog.matchAll(/trackVaultEvent\(([^)]*)\)/g)) {
      expect(call[1]).not.toMatch(/payload|passphrase|encrypted|cipher/i);
    }
  });
});
