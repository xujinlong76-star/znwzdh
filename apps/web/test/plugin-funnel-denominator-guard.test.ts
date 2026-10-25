/**
 * 安装漏斗分母守卫（2026-10-25 run48）。
 *
 * 真实缺口（本轮 §3 实测，data/navhub.db 只读，795 行 events）：
 *   kind=plugin_install_click 3 行、plugin_install_success 18 行、plugin_uninstall 13 行。
 *   分母比分子小 6 倍，而 packages/store/src/repository/plugins.ts 的 getPluginFunnel
 *   正把 clickToInstall = installs / installClicks 作为指标对外产出 —— 数字不是"难看"，
 *   是数学上不成立。
 *
 * 根因不在服务端，在客户端的上报位置：全仓只有 plugin-card.tsx 的按钮处理函数发
 * click，而 installPlugin 还有三条入口（安装确认弹窗、「已安装」管家页、离线包导入页）
 * 各自调同一个接口却从不发分母；卡片那条还在「打开弹窗」时就发了一次 —— 于是
 * 分子（服务端每次真装成功都发）永远比合法分母多。
 *
 * 本文件锁三层：
 *   1. 接线：每次安装/卸载「尝试」恰好上报一次 click，且发生在请求之前 ——
 *      请求失败、重复安装都要计，否则分母又小于分子；
 *   2. 通道：sendBeacon 返回 false（载荷被丢弃）或抛错时必须落到 fetch 兜底，
 *      这是分母静默少计的第二条路；
 *   3. 绕道：接口路径只允许出现在 navhub-api.ts 的包装函数里，组件不得自行 fetch
 *      /install（新增了入口却绕过包装 = 又丢掉分母），也不得自行发 click 类型。
 * 镜像到 apps/web/test 后由根 vitest 执行。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-funneldenom01234567'));
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }));

const { installPlugin, trackPluginEvent, uninstallPlugin } = await import('../src/lib/navhub-api');

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的源文件；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p));
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）');
  return hit;
}

const originalFetch = globalThis.fetch;
let calls: { url: string; body: string; headers: Record<string, string> }[] = [];

/**
 * fetch 桩：安装/卸载走 /api/hub/plugins/:slug/(un)install，埋点走 /api/hub/events。
 * 按 URL 分派响应码，这样「失败请求」与「成功请求」下的分母计数都是断言出来的。
 */
function stubFetch(opts: { installStatus?: number } = {}) {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init?.body === 'string' ? init.body : '',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const status = url.includes('/events') ? 204 : (opts.installStatus ?? 200);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (url.includes('/events') ? '' : JSON.stringify({ success: true, alreadyInstalled: true })),
      json: async () => ({ success: true, alreadyInstalled: true }),
    } as unknown as Response;
  }) as typeof fetch;
}

const clickEvents = () =>
  calls
    .filter((c) => c.url.includes('/events'))
    .map((c) => JSON.parse(c.body) as { kind: string; pluginSlug?: string; anonId?: string });

const installRequests = () => calls.filter((c) => /\/plugins\/[^/]+\/(un)?install/.test(c.url));

beforeEach(() => {
  mockedGetIdentity.mockReturnValue('anon-funneldenom01234567');
  // trackPluginEvent 的 `typeof window === 'undefined'` 是 SSR 护栏；根 vitest 在 node
  // 环境跑，不点亮它就等于永远测不到上报分支。
  ;(globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
});

describe('每次安装/卸载尝试恰好计一次分母', () => {
  it('安装：一条 click + 一条请求，且 click 在请求之前', async () => {
    stubFetch();
    await installPlugin('pet-care-pack');
    expect(installRequests()).toHaveLength(1);
    const clicks = clickEvents();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ kind: 'plugin_install_click', pluginSlug: 'pet-care-pack' });
    expect(calls.findIndex((c) => c.url.includes('/events'))).toBeLessThan(
      calls.findIndex((c) => /\/install/.test(c.url)),
    );
  });

  it('请求失败也要计：分母是「尝试」，不是「成功」', async () => {
    stubFetch({ installStatus: 500 });
    await expect(installPlugin('legal-compliance-pack')).rejects.toBeTruthy();
    const clicks = clickEvents();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].kind).toBe('plugin_install_click');
  });

  it('重复安装（服务端不发 success）仍计一次：否则 click 永远追不上分子', async () => {
    stubFetch();
    await installPlugin('pet-care-pack');
    await installPlugin('pet-care-pack');
    expect(clickEvents().filter((e) => e.kind === 'plugin_install_click')).toHaveLength(2);
    expect(installRequests()).toHaveLength(2);
  });

  it('卸载：一条 plugin_uninstall_click，身份与请求一致', async () => {
    stubFetch();
    await uninstallPlugin('pet-care-pack');
    const clicks = clickEvents();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({
      kind: 'plugin_uninstall_click',
      pluginSlug: 'pet-care-pack',
      anonId: 'anon-funneldenom01234567',
    });
    expect(installRequests()).toHaveLength(1);
  });

  it('显式传入的 identity 同时用于请求与埋点：不能一次动作两个身份', async () => {
    stubFetch();
    await installPlugin('pet-care-pack', 'user-77');
    expect(clickEvents()[0].anonId).toBe('user-77');
    expect(installRequests()[0].headers['X-Navhub-Anon-Id']).toBe('user-77');
  });

  it('SSR 阶段（没有 window）一个字都不上报', () => {
    stubFetch();
    delete (globalThis as { window?: unknown }).window;
    trackPluginEvent('plugin_install_click', 'pet-care-pack');
    expect(calls).toHaveLength(0);
  });
});

describe('sendBeacon 丢弃时必须落到 fetch 兜底', () => {
  let beaconPushes: string[] = [];

  /** beacon 入队单独记账：与 fetch 兜底分开数，才能断言「恰好送达一次」 */
  function beaconStub(returnValue: () => boolean) {
    beaconPushes = [];
    const spy = vi.fn((url: string) => {
      beaconPushes.push(String(url));
      return returnValue();
    });
    vi.stubGlobal('navigator', { sendBeacon: spy });
    return spy;
  }

  it('beacon 入队成功：只送达一次，不再走 fetch（否则分母翻倍）', () => {
    stubFetch();
    const spy = beaconStub(() => true);
    trackPluginEvent('plugin_install_click', 'pet-care-pack');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(beaconPushes).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(0);
  });

  it('beacon 返回 false（载荷被浏览器丢弃）：fetch 兜底补上，分母不静默少计', () => {
    stubFetch();
    const spy = beaconStub(() => false);
    trackPluginEvent('plugin_install_click', 'pet-care-pack');
    expect(spy).toHaveBeenCalledTimes(1);
    const events = calls.filter((c) => c.url.includes('/events'));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].body).kind).toBe('plugin_install_click');
  });

  it('beacon 抛错：同样兜底，且不影响调用方', () => {
    stubFetch();
    vi.stubGlobal('navigator', {
      sendBeacon: vi.fn(() => {
        throw new Error('quota');
      }),
    });
    expect(() => trackPluginEvent('plugin_uninstall_click', 'pet-care-pack')).not.toThrow();
    const events = calls.filter((c) => c.url.includes('/events'));
    expect(events).toHaveLength(1);
  });

  it('没有 beacon 能力的浏览器：走 fetch，一次送达', () => {
    stubFetch();
    vi.stubGlobal('navigator', {});
    trackPluginEvent('plugin_view', 'pet-care-pack');
    expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(1);
  });
});

describe('绕道钉子：接口路径与 click 类型只允许出现在包装函数里', () => {
  /** 递归收集 overlay 源文件（测试读的是源真相，不是 apps/web 镜像） */
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) sources(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  // 镜像副本读的是 apps/web/src —— check-web-overlay 强制它与 overlay/src 逐字一致，
  // 所以两边扫出来的结论必然相同，而绕道一旦出现在任何一侧都会翻红。
  const srcRoot = resolve(HERE, '..', 'src');
  const files = sources(srcRoot);
  expect(files.length, '没扫到任何源文件，路径推导错了').toBeGreaterThan(50);
  const isApiWrapper = (p: string) => basename(p) === 'navhub-api.ts';

  it('/install 与 /uninstall 的 URL 字面量只在 navhub-api.ts 出现', () => {
    const offenders = files
      .filter((p) => !isApiWrapper(p))
      .filter((p) => {
        const s = readFileSync(p, 'utf8');
        return /\/install[`"']/.test(s) || /\/uninstall[`"'$]/.test(s);
      })
      .map((p) => p.replace(/\\/g, '/'));
    expect(offenders, '组件自行 fetch 安装接口会绕开分母').toEqual([]);
  });

  it('组件不再手工发 install/uninstall click（唯一发分母的地方是包装函数）', () => {
    // 扫的是「出现这两个 kind」本身：旧实现把 kind 写在三元表达式里，
    // 只匹配 trackPluginEvent('plugin_install_click' 这种字面首参会漏掉整个三元分支。
    const offenders = files
      .filter((p) => !isApiWrapper(p))
      .filter((p) => /plugin_(install|uninstall)_click/.test(readFileSync(p, 'utf8')))
      .map((p) => p.replace(/\\/g, '/'));
    expect(offenders, '重复发 click 会让分母翻倍，转化率虚低').toEqual([]);
  });

  it('包装函数里 click 上报排在 sendJson 之前', () => {
    const api = readFileSync(overlayFile('src/lib/navhub-api.ts'), 'utf8');
    for (const kind of ['plugin_install_click', 'plugin_uninstall_click']) {
      const at = api.indexOf(`trackPluginEvent('${kind}'`);
      expect(at, `navhub-api.ts 里没有 ${kind}`).toBeGreaterThan(-1);
      const tail = api.slice(at);
      const requestAt = tail.indexOf('return sendJson(');
      expect(requestAt, `${kind} 必须在请求之前上报`).toBeGreaterThan(-1);
    }
  });

  it('两个 click 类型都在服务端 EVENT_KINDS 白名单里（不在就是静默 400）', () => {
    const server = readFileSync(resolve(HERE, '..', '..', 'api', 'src', 'routes', 'telemetry.ts'), 'utf8');
    const start = server.indexOf('const EVENT_KINDS = [');
    expect(start).toBeGreaterThan(-1);
    const list = server.slice(start, server.indexOf(']', start));
    for (const kind of ['plugin_install_click', 'plugin_uninstall_click']) {
      expect(list, `服务端未登记 kind：${kind}`).toContain(kind);
    }
  });
});

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
