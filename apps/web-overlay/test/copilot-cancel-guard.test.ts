/**
 * copilot 长耗时请求的「可见进度 / 可停止 / 可重试 / 可读屏」四条出口，必须在代码里真实存在。
 *
 * 缺陷形态（run63 逐行复核 + run82 §3 实测，data/navhub.db 2026-10-26 21:1x 只读查得）：
 * llm_usage 里 copilot 5 次 2 次失败、ai_chat 3 次 1 次失败，plugin_heal 46 次 29 次失败
 * （平均 15696ms、最大 60007ms）—— 最坏的用户体验是「静默长等 20~60 秒，然后什么也没有」。
 * 而当时的抽屉对一次可能跑两分钟的请求只有一枚静态转圈：
 *   - 没有已等待秒数 ⇒ 分不清「在算」还是「卡死」；
 *   - 没有停止 ⇒ `loading` 期间 textarea/发送一起禁用，唯一出路是刷新页面；
 *   - 失败只落一句被动文案「可直接重试」⇒ 用户得自己把问题重打一遍；
 *   - 全文件 `aria-live|role="status"` = 0 ⇒ 读屏用户连「失败了」都感知不到。
 *
 * 本测试不锁实现细节，只锁**出口存在且接了真信号**。每条都指定了把它变红的消融（§9），
 * 断言不过就改代码，不许放宽断言。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 真源永远是 apps/web-overlay：镜像到 apps/web 只为了被 vitest 跑到 */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const drawer = readFileSync(join(ROOT, "src/components/ai/ai-copilot-drawer.tsx"), "utf8");
const api = readFileSync(join(ROOT, "src/lib/navhub-api.ts"), "utf8");

/** 取 `sendCopilotChat` 的函数体（到下一个顶层 export 为止），避免匹配到别处的同名调用 */
function copilotFnBody(src: string): string {
  const start = src.indexOf("export async function sendCopilotChat");
  if (start < 0) throw new Error("navhub-api.ts 里找不到 sendCopilotChat");
  const rest = src.slice(start + "export async function sendCopilotChat".length);
  const end = rest.search(/\nexport (async function|function|const|interface) /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** 取 `handleSend` 函数体：花括号配平，不用行号（改文案就挪行，行号断言会假红） */
function handleSendBody(src: string): string {
  const start = src.indexOf("const handleSend = async");
  if (start < 0) throw new Error("抽屉里找不到 handleSend");
  let depth = 0;
  let i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start, open + 1);
}

describe("sendCopilotChat 必须把取消信号接到底层传输", () => {
  const body = copilotFnBody(api);

  it("options 里声明 signal，并作为 sendJson 的第 4 参传下去", () => {
    expect(body).toMatch(/signal\?:\s*AbortSignal/);
    // sendJson(path, method, body, signal) —— 只有位置对了才叫真接上，写进 body 里不算
    expect(body).toMatch(/sendJson<CopilotChatResponse>\([\s\S]*?,\s*options\?\.signal,?\s*\)/);
  });

  it("请求体里不许夹一个 signal（那是 JSON 字段，不会中断 fetch）", () => {
    const bodyLiteral = /POST",\s*\{([\s\S]*?)\n\s*\}/.exec(body);
    expect(bodyLiteral ? bodyLiteral[1] : "").not.toMatch(/signal/);
  });
});

describe("抽屉：一次请求一个 AbortController，三条路都能中断", () => {
  const send = handleSendBody(drawer);

  it("发起请求前建控制器并透传 signal", () => {
    expect(send).toMatch(/new AbortController\(\)/);
    expect(send).toMatch(/sendCopilotChat\([\s\S]*?signal:\s*controller\.signal/);
  });

  it("停止按钮点下去是真的 abort（不是只藏转圈）", () => {
    expect(drawer).toMatch(/const stopGenerating[\s\S]{0,160}?abortRef\.current\?\.abort\(\)/);
    expect(drawer).toMatch(/onClick=\{stopGenerating\}/);
    // 必须是 type="button"：否则在 <form> 里点它会当成提交，改问法时把表单发出去
    const idx = drawer.indexOf("onClick={stopGenerating}");
    expect(drawer.slice(Math.max(0, idx - 260), idx + 60)).toMatch(/type="button"/);
  });

  it("关抽屉与组件卸载都中断进行中请求", () => {
    expect(drawer).toMatch(/if \(!isOpen\) abortRef\.current\?\.abort\(\)/);
    expect(drawer).toMatch(/useEffect\(\s*\(\) => \(\) => \{[\s\S]{0,80}?abortRef\.current\?\.abort\(\)/);
  });

  it("定时器与控制器在 finally 里一起收掉（否则第二次请求会带着上一次的 tick）", () => {
    expect(send).toMatch(/finally \{[\s\S]*?clearInterval\(tick\)[\s\S]*?abortRef\.current = null[\s\S]*?setLoading\(false\)/);
  });

  it("用户主动停止不记成故障：catch 先看 controller.signal.aborted", () => {
    const catchIdx = send.indexOf("catch (err)");
    expect(catchIdx).toBeGreaterThan(0);
    const abortedCheck = send.indexOf("controller.signal.aborted");
    const degradeCall = send.indexOf("describeDegrade(");
    expect(abortedCheck).toBeGreaterThan(catchIdx);
    expect(degradeCall).toBeGreaterThan(abortedCheck);
  });
});

describe("进度：肉眼看得到的秒数，且不霸占读屏队列", () => {
  it("有 elapsedMs 计时并渲染「已等待 Ns」", () => {
    expect(drawer).toMatch(/setInterval\(\(\) => setElapsedMs\(Date\.now\(\) - startedAt\)/);
    expect(drawer).toMatch(/已等待 \$\{Math\.floor\(elapsedMs \/ 1000\)\}s/);
  });

  it("秒数被 aria-hidden 包住：每秒都播报会把语音缓冲挤爆", () => {
    const idx = drawer.indexOf("已等待 ${Math.floor(elapsedMs / 1000)}s");
    expect(idx).toBeGreaterThan(0);
    expect(drawer.slice(Math.max(0, idx - 200), idx)).toMatch(/aria-hidden="true"/);
  });

  it("超过 NN/g 的 10 秒注意力上限时，文案给出出路", () => {
    expect(drawer).toMatch(/elapsedMs >= 10_000/);
    expect(drawer).toMatch(/可随时停止/);
  });
});

describe("可访问性：状态消息要能被辅助技术播报（WCAG 2.2 SC 4.1.3）", () => {
  it("存在常驻的 role=status + aria-live=polite + aria-atomic=true 播报容器", () => {
    expect(drawer).toMatch(/role="status" aria-live="polite" aria-atomic="true"/);
  });

  it("播报容器不在 loading 条件分支里（live region 必须在内容变化前就存在于 DOM）", () => {
    const at = drawer.indexOf('role="status" aria-live="polite"');
    expect(at).toBeGreaterThan(0);
    // 找出 loading 气泡那一段的起止：从 `{loading && (` 到与之配平的 `)}`
    const open = drawer.indexOf("{loading && (");
    expect(open).toBeGreaterThan(0);
    let depth = 0;
    let close = -1;
    for (let i = open; i < drawer.length; i++) {
      if (drawer[i] === "{") depth++;
      else if (drawer[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(open);
    expect(at < open || at > close).toBe(true);
  });

  it("消息列表的忙碌态与 loading 同步（aria-busy）", () => {
    expect(drawer).toMatch(/aria-busy=\{loading\}/);
  });

  it("停止按钮有可读名字，不只有图标", () => {
    const idx = drawer.indexOf("onClick={stopGenerating}");
    const block = drawer.slice(idx, idx + 420);
    expect(block).toMatch(/<span>停止<\/span>/);
  });
});

describe("重试：把 retryable 变成动作，且只在该出现时出现", () => {
  it("assistant 消息带 retryText 才渲染重试按钮，并按原问题重发", () => {
    expect(drawer).toMatch(/m\.role === 'assistant' && m\.retryText &&/);
    expect(drawer).toMatch(/onClick=\{\(\) => handleSend\(m\.retryText\)\}/);
  });

  it("可重试失败才写 retryText（describeDegrade 的 retryable 是唯一门控）", () => {
    const send = handleSendBody(drawer);
    expect(send).toMatch(/retryText:\s*notice\.retryable \? content : undefined/);
  });

  it("额度用尽 / 未配置密钥不给假出口（ok=false 分支按 degraded 门控）", () => {
    const send = handleSendBody(drawer);
    expect(send).toMatch(/retryText: res\.degraded && res\.degraded !== 'error' \? undefined : content/);
  });

  it("模型调用失败后由站内匹配兜底（degraded=error）仍给出口", () => {
    const send = handleSendBody(drawer);
    expect(send).toMatch(/retryText: res\.degraded === 'error' \? content : undefined/);
  });

  it("不再留下「可直接重试」这种没有按钮的承诺", () => {
    expect(drawer).not.toMatch(/可直接重试/);
  });
});

describe("长请求不锁死输入（§8 禁用态必须解释）", () => {
  it("textarea 不再因 loading 被禁用", () => {
    const ta = /<textarea([\s\S]*?)\/>/.exec(drawer);
    expect(ta ? ta[1] : "").not.toMatch(/disabled=\{loading\}/);
  });

  it("生成中给出可见解释，并挂到输入框的 aria-describedby", () => {
    expect(drawer).toMatch(/id="copilot-busy-hint"/);
    expect(drawer).toMatch(/aria-describedby=\{loading \? 'copilot-busy-hint' : undefined\}/);
    expect(drawer).toMatch(/发送与 Enter 暂时不生效/);
  });

  it("发送按钮的禁用有解释（title）", () => {
    const idx = drawer.indexOf("disabled={!input.trim() || loading}");
    expect(idx).toBeGreaterThan(0);
    expect(drawer.slice(idx, idx + 260)).toMatch(/title=\{loading \?/);
  });
});
