/**
 * 候选探活失败分类的契约测试。
 *
 * 锁的是一条全仓通用口径：**慢 ≠ 死**。
 *
 * 历史缺陷（本轮修复）：`probeCandidateUrl` 的 catch 分支把任何异常都判成 `dead`，
 * 并把 `err.message` 原样当原因返回。于是：
 *   1. 超时的候选在界面上显示「不可达」——把「这次没测到」说成了「站点已确认下线」，
 *      与深检层「超时置信度只有 0.5、不等同死链」的口径自相矛盾；
 *   2. 运营看到的原因是 `This operation was aborted` / `fetch failed` 这类英文原文，
 *      既看不懂，也分不出该重试还是该放弃。
 *
 * 这些断言不触网：分类是纯函数，只吃「耗时 + 异常」。
 */
import { describe, expect, it } from "vitest";
import { classifyProbeFailure, classifyProbeStatus } from "../src/routes/plugin-audit.ts";

const TIMEOUT = 2500;

describe("候选探活失败分类：慢 ≠ 死", () => {
  it("超时判「未能验证」，不判「不可达」，并说明慢不等于死", () => {
    const r = classifyProbeFailure("https://slow.example/", new Error("This operation was aborted"), TIMEOUT, TIMEOUT);
    expect(r.grade).toBe("unverified");
    expect(r.reason).toContain("未响应");
    expect(r.reason).toContain("慢不等于死");
  });

  it("耗时逼近超时上限时，即便错误消息看不出超时也判「未能验证」", () => {
    const r = classifyProbeFailure("https://slow.example/", new Error("socket hang up"), TIMEOUT * 0.99, TIMEOUT);
    expect(r.grade).toBe("unverified");
  });

  it("连接被重置判「未能验证」，不当成已死", () => {
    const r = classifyProbeFailure("https://flaky.example/", new Error("fetch failed"), 120, TIMEOUT);
    expect(r.grade).toBe("unverified");
    expect(r.reason).toContain("连接中断");
  });

  it("原始英文错误不外泄（原因必须是可读中文）", () => {
    const r = classifyProbeFailure("https://flaky.example/", new Error("getaddrinfo ENOTFOUND x"), 80, TIMEOUT);
    expect(r.reason).not.toMatch(/ENOTFOUND|fetch failed|aborted/i);
  });

  it("域名不解析判「不可达」——这是明确证据", () => {
    const r = classifyProbeFailure("https://gone.example/", new Error("DNS 解析失败: gone.example"), 60, TIMEOUT);
    expect(r.grade).toBe("dead");
    expect(r.reason).toContain("域名无法解析");
  });

  it("端口拒绝判「不可达」", () => {
    const r = classifyProbeFailure("https://x.example/", new Error("connect ECONNREFUSED 1.2.3.4:443"), 40, TIMEOUT);
    expect(r.grade).toBe("dead");
    expect(r.reason).toContain("连接被拒绝");
  });

  it("证书无效判「不可达」（浏览器同样会拦）", () => {
    const r = classifyProbeFailure(
      "https://x.example/",
      new Error("unable to verify the first certificate"),
      90,
      TIMEOUT,
    );
    expect(r.grade).toBe("dead");
    expect(r.reason).toContain("证书无效");
  });

  it("跳转成环判「不可达」", () => {
    const r = classifyProbeFailure("https://x.example/", new Error("重定向次数超过 3 次"), 200, TIMEOUT);
    expect(r.grade).toBe("dead");
    expect(r.reason).toContain("重定向次数过多");
  });

  it("指向内网被判「不可达」，并说明是拒绝探测而非站点下线", () => {
    const r = classifyProbeFailure("http://127.0.0.1/", new Error("目标是受保护网段: 127.0.0.1"), 10, TIMEOUT);
    expect(r.grade).toBe("dead");
    expect(r.reason).toContain("拒绝探测");
  });
});

/**
 * 状态码这一半同样锁口径：**5xx ≠ 站点已死**。
 *
 * 原本的实现是 `if (res.status >= 400) return dead`，于是一个只是暂时过载的
 * 503 站点会被写成「不可达（站点已确认下线）」，并在候选排序里掉到停放页之后
 * （GRADE_RANK: unverified 2 > suspicious 1 > dead 0）。
 * 503 恰恰证明域名和端口都在应答——这不是死，是「这一刻不好用」。
 */
describe("候选探活状态码分类：5xx 不等于站点已死", () => {
  it("503 判「未能验证」而不是「不可达」", () => {
    const r = classifyProbeStatus(503);
    expect(r?.grade).toBe("unverified");
    expect(r?.reason).toContain("服务端暂时不可用");
    expect(r?.reason).toContain("不等于站点已死");
    expect(r?.reason).not.toContain("不可达");
  });

  it.each([500, 502, 504])("%i 同样只算「未能验证」", (code) => {
    expect(classifyProbeStatus(code)?.grade).toBe("unverified");
  });

  it("408 请求超时也不判死", () => {
    expect(classifyProbeStatus(408)?.grade).toBe("unverified");
  });

  it.each([404, 410, 451])("%i 才是「不可达」——页面确定不存在", (code) => {
    const r = classifyProbeStatus(code);
    expect(r?.grade).toBe("dead");
    expect(r?.reason).toContain("不存在");
  });

  it("400 只是「请求被拒绝」，同样不下死亡结论", () => {
    const r = classifyProbeStatus(400);
    expect(r?.grade).toBe("unverified");
    expect(r?.reason).toContain("未能确认可用性");
  });

  it("1xx–3xx 不是失败，返回 null 交回调用方继续做内容判定", () => {
    expect(classifyProbeStatus(200)).toBeNull();
    expect(classifyProbeStatus(301)).toBeNull();
  });
});
