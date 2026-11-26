/**
 * /api/hub/* 代理的取消穿透（候选 2）：用户按「停止」之后，代理不许继续占着中枢连接
 * 等满期限（copilot 这一路是 120 秒），也不许把一次正常取消写成 504 上游超时。
 *
 * 为什么用源码级守卫：route.ts 是 Next 路由处理器，`forward()` 里串着 `auth()`、
 * 身份裁决、签名 cookie 三串副作用，而本仓库根 vitest 跑在 node 环境（没有 jsdom，
 * 也不起真 Next server）。所以这里钉的是**结构 + 顺序**，顺序才是重点——
 * `clientGone` 必须判在 `timedOut` 之前，否则取消在大盘里永远长成一条上游故障。
 * 最后补一条行为测试：证明「合并信号里客户端那一路 abort，真能掐断一个卡死的上游
 * fetch」。整个改动依赖这个底层事实，不能只是假定它成立。
 */
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的真源；镜像副本（apps/web/test 这一份）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return hit;
}

/** 去注释：负向断言不能被注释里的旧写法「匹配上」，正向断言也不该靠注释过关 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = codeOnly(readFileSync(overlayFile("src/app/api/hub/[...path]/route.ts"), "utf8"));

describe("hub 代理源码：客户端那一路必须并进取消上游", () => {
  it("上游 signal 是 deadline 与 request 两路的合并，不是只剩定时器", () => {
    expect(ROUTE).toMatch(/AbortSignal\.any\(\s*\[\s*deadline\.signal\s*,\s*request\.signal\s*\]\s*\)/);
  });

  it("fetch 拿的是合并后的信号；单独挂任何一路都不算穿透", () => {
    const fetchCall = ROUTE.slice(ROUTE.indexOf("await fetch(target"));
    const fetchOptions = fetchCall.slice(0, fetchCall.indexOf("})"));
    expect(fetchOptions).toMatch(/signal:\s*upstreamSignal/);
    // 负向：写回 `signal: deadline.signal` 或 `signal: request.signal` 都会漏掉另一路
    expect(fetchOptions).not.toMatch(/signal:\s*deadline\.signal/);
    expect(fetchOptions).not.toMatch(/signal:\s*request\.signal/);
  });

  it("「客户端走了」判在「等到期限」之前——顺序反了就把取消写成 504", () => {
    const atClientGone = ROUTE.indexOf("request.signal.aborted");
    const atDeadline = ROUTE.indexOf("deadline.signal.aborted");
    expect(atClientGone).toBeGreaterThan(-1);
    expect(atDeadline).toBeGreaterThan(-1);
    expect(atClientGone).toBeLessThan(atDeadline);
    // 取消这一支自己 return，不落到下面 timedOut 的三态文案里
    const clientBranch = ROUTE.slice(atClientGone, ROUTE.indexOf("const timedOut"));
    expect(clientBranch).toMatch(/status:\s*499/);
    expect(clientBranch).toContain("return");
  });

  it("取消不记错误日志、也不给已经消失的客户端补 cookie", () => {
    const clientBranch = ROUTE.slice(ROUTE.indexOf("request.signal.aborted"), ROUTE.indexOf("const timedOut"));
    // 取消是正常操作，console.error 会把每次「停止」都刷成一条前端故障
    expect(clientBranch).toMatch(/console\.info\(/);
    expect(clientBranch).not.toMatch(/console\.error\(/);
    // finish() 唯一的动作是 append set-cookie；连接都断了还补头就是白干 + 拼接风险
    expect(clientBranch).not.toContain("finish(");
  });

  it("取消不许被写成 hub_upstream_timeout / 504 那套对外契约", () => {
    const atClientReturn = ROUTE.indexOf("status: 499");
    const atTimeoutCode = ROUTE.indexOf("hub_upstream_timeout");
    expect(atClientReturn).toBeGreaterThan(-1);
    expect(atTimeoutCode).toBeGreaterThan(-1);
    expect(atClientReturn).toBeLessThan(atTimeoutCode);
    // 取消分支的响应体必须是空的：拼 JSON 给一个不存在的读者，等于把「已取消」谎报成一次完成
    expect(ROUTE.slice(atClientReturn - 260, atClientReturn)).toContain("NextResponse(null");
  });

  it("定时器仍在 finally 里清——合并信号不能把 deadline.clear() 漏掉", () => {
    // 漏掉的话每次取消都留一个最长 120 秒的悬挂 timer，卡死进程退出
    expect(ROUTE).toMatch(/}\s*finally\s*\{\s*deadline\.clear\(\)/);
  });
});

describe("行为：客户端那一路 abort 真能掐断卡死的上游 fetch", () => {
  it("合并信号下 abort ⇒ 立刻 reject；不 abort 则一直 pending", async () => {
    /**
     * 「接受连接但永不回话」的本地网关：这就是中枢卡死的形状。
     * 定时器给 60 秒，所以只有 abort 能让它提前结束——用来说明合并信号里
     * 外部那一路是有效的，而不是被 timeout 那一路吃掉。
     */
    let hits = 0;
    const hub = net.createServer((socket) => {
      hits += 1;
      socket.resume();
    });
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + (hub.address() as net.AddressInfo).port + "/api/copilot/chat";
    try {
      const client = new AbortController();
      const merged = AbortSignal.any([AbortSignal.timeout(60_000), client.signal]);
      const pending = fetch(url, { method: "POST", body: "{}", signal: merged });
      const settled = pending.then(
        () => ({ kind: "resolved" as const }),
        (err: unknown) => ({ kind: "rejected" as const, err: err as { name?: string } }),
      );

      for (let t = 0; t < 300 && hits === 0; t += 10) await new Promise((r) => setTimeout(r, 10));
      expect(hits).toBeGreaterThan(0);

      // 还没 abort 时它确实挂着——否则这条用例什么都没证明
      const racedWhilePending = await Promise.race([
        settled,
        new Promise((r) => setTimeout(() => r("pending"), 50)),
      ]);
      expect(racedWhilePending).toBe("pending");

      client.abort();
      const outcome = await Promise.race([
        settled,
        new Promise((r) => setTimeout(() => r("timeout"), 3_000)),
      ]);
      expect(outcome).not.toBe("timeout");
      expect((outcome as { kind: string }).kind).toBe("rejected");
      expect((outcome as { err: { name?: string } }).err?.name).toBe("AbortError");
    } finally {
      hub.close();
      // 让上面那个 fetch 的 promise 有落点，不留下 unhandled rejection
      await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(200) }).catch(() => undefined);
    }
  });
});
