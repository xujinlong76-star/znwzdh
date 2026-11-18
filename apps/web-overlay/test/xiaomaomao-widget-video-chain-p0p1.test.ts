/**
 * 小猫猫挂件视频链 P0+P1 守卫（2026-11-18，William 点选「P0 + P1 全修」）：
 *
 *  C-01（P0）：videoDead 粘性 + 探活阴性缓存——判死可复位，阴性探活 30 秒过期。
 *  C-02（P0）：部署同步校验——媒体清单 media-manifest.json + 启动时版本/存在性握手。
 *  A P1-5：探活 HEAD 无超时且失败结果永久缓存——5 秒超时 + 阴性 30 秒过期（与 C-01 同批）。
 *  C-03：兜底链无加载超时、无加载态——视频首帧 8 秒超时 + xm-loading 加载态。
 *  C-05：canPlayType 只认编解码不认 alpha——首帧四角 alpha 采样，丢 alpha 即判死。
 *  C-06：hideCat 终局不可逆——兜底全灭改收成圆标 + 控制台报错 + 30 秒后重试。
 *  C-07：playClip 同名快路径不恢复已暂停视频——快路径里暂停了就 play()。
 *  C-08：庆祝/表情视频链文件根本不存在——只探活清单 extras 或显式覆盖里的文件。
 *
 * 写法与既有 7 文件同款：源码断言（不引 jsdom——本仓库未装 jsdom，加依赖超出本线范围），
 * 读 overlay 侧的挂件源码；行为由浏览器 CDP 探针验（见 VERIFICATION.md）。
 * 每项先在旧代码上跑红证伪（R7），实现后转绿。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

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

const WIDGET = readFileSync(join(overlayRoot(), "public/xiaomaomao/xiaomaomao.js"), "utf8");

/** 取某个函数体（从 `function name(` 起 len 个字符，够断言用） */
function fnBody(name: string, len = 1600): string {
  const at = WIDGET.indexOf("function " + name + "(");
  expect(at, "找不到函数 " + name).toBeGreaterThan(-1);
  return WIDGET.slice(at, at + len);
}

/** 从某个标记起取一段源码 */
function sliceFrom(marker: string, len: number): string {
  const at = WIDGET.indexOf(marker);
  expect(at, "找不到标记 " + marker).toBeGreaterThan(-1);
  return WIDGET.slice(at, at + len);
}

/** 取某个 CSS 规则体（选择器第一次出现处的大括号内容） */
function cssRule(selector: string): string {
  const at = WIDGET.indexOf(selector + "{");
  expect(at, "找不到 CSS 规则 " + selector).toBeGreaterThan(-1);
  const end = WIDGET.indexOf("}", at);
  return WIDGET.slice(at, end);
}

function countOf(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

describe("C-01 / A P1-5：探活超时与阴性缓存过期、videoDead 可复位", () => {
  it("探活 HEAD 有 5 秒超时（fetchWithTimeout 兜底）", () => {
    expect(WIDGET).toContain("PROBE_TIMEOUT_MS = 5000");
    expect(WIDGET).toContain("function fetchWithTimeout(");
    expect(fnBody("probeMedia")).toContain("fetchWithTimeout");
  });

  it("探活阴性结果只缓存 30 秒（mediaProbeFailedAt + TTL，过期重探）", () => {
    expect(WIDGET).toContain("PROBE_NEGATIVE_TTL_MS = 30000");
    expect(WIDGET).toContain("mediaProbeFailedAt");
    const probe = fnBody("probeMedia");
    expect(probe).toContain("PROBE_NEGATIVE_TTL_MS");
    expect(probe).toContain("mediaProbeFailedAt");
  });

  it("四处判死都走 markVideoDead，不再裸写 videoDead = true", () => {
    expect(WIDGET).toContain("function markVideoDead(");
    expect(WIDGET).toContain("function clearVideoDead(");
    // 全文件只剩 markVideoDead 体内一处 videoDead = true（声明 var videoDead = false 另计）
    expect(countOf(WIDGET, "videoDead = true")).toBe(1);
    expect(countOf(WIDGET, "videoDead = false")).toBe(2); // 声明 + clearVideoDead
    expect(fnBody("ensureClipEls")).toContain("markVideoDead('network')");
    expect(fnBody("startAmbientVideo")).toContain("markVideoDead('capability')");
    expect(fnBody("playClip", 2800)).toContain("markVideoDead('network')");
  });

  it("判死带原因：能力原因永不自动重试，网络原因才进重试窗口", () => {
    expect(WIDGET).toContain("VIDEO_DEAD_RETRY_MS = 60000");
    expect(fnBody("markVideoDead")).toContain("videoDeadReason");
    const play = fnBody("playClip", 2800);
    expect(play).toContain("videoDeadReason === 'network'");
    expect(play).toContain("VIDEO_DEAD_RETRY_MS");
    expect(play).toContain("clearVideoDead()");
  });

  it("用户亲手唤回时立即重试视频路（不等 60 秒窗口）", () => {
    expect(WIDGET).toContain("function reviveVideoOnWake(");
    expect(fnBody("reviveVideoOnWake")).toContain("clearVideoDead()");
    const tab = sliceFrom("root.querySelector('.xm-tab').addEventListener('click'", 1200);
    expect(tab).toContain("reviveVideoOnWake()");
  });

  it("清判死时一并清掉阴性探活缓存（下次重试真实探活）", () => {
    const clear = fnBody("clearVideoDead");
    expect(clear).toContain("videoDead = false");
    expect(clear).toContain("mediaProbeFailedAt");
  });
});

describe("C-02：媒体清单与版本握手", () => {
  it("清单文件在仓库里（元数据可进仓库，二进制仍不进）", () => {
    expect(existsSync(join(overlayRoot(), "public/xiaomaomao/media-manifest.json")), "media-manifest.json 不在仓库里").toBe(true);
  });

  it("清单版本 1、9 文件齐全、字节数与 v2 验证记录一致、extras 为空", () => {
    const manifest = JSON.parse(readFileSync(join(overlayRoot(), "public/xiaomaomao/media-manifest.json"), "utf8"));
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.files).sort()).toEqual([
      "play-idle.gif", "play-idle.webm", "play-idle.webp",
      "play-pounce.gif", "play-pounce.webm", "play-pounce.webp",
      "play-walk.gif", "play-walk.webm", "play-walk.webp",
    ]);
    expect(manifest.files["play-idle.webm"].bytes).toBe(7731786);
    expect(manifest.files["play-walk.webm"].bytes).toBe(2446199);
    expect(manifest.files["play-pounce.webm"].bytes).toBe(4873967);
    expect(manifest.files["play-idle.webp"].bytes).toBe(3701196);
    expect(manifest.files["play-walk.webp"].bytes).toBe(1902394);
    expect(manifest.files["play-pounce.webp"].bytes).toBe(2055790);
    expect(manifest.files["play-idle.gif"].bytes).toBe(6810091);
    expect(manifest.files["play-walk.gif"].bytes).toBe(3282073);
    expect(manifest.files["play-pounce.gif"].bytes).toBe(6239057);
    for (const name of Object.keys(manifest.files)) {
      expect(manifest.files[name].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.extras).toEqual([]);
  });

  it("挂件启动时核对清单（入场段调 checkMediaManifest）", () => {
    expect(WIDGET).toContain("MEDIA_MANIFEST_VERSION = 1");
    expect(WIDGET).toContain("function checkMediaManifest(");
    expect(WIDGET).toContain("media-manifest.json");
    const entry = sliceFrom("/* ---------- 入场 ---------- */", 3000);
    expect(entry).toContain("checkMediaManifest();");
  });

  it("版本不符/文件缺失写 console.warn 并暴露诊断状态", () => {
    const check = fnBody("checkMediaManifest", 2600);
    expect(check).toContain("console.warn");
    expect(check).toContain("XIAOMAOMAO_MEDIA_STATUS");
    expect(check).toContain("mediaManifestStatus");
    expect(check).toContain("missing");
  });

  it("清单缺失不拦猫（老部署无清单时只记状态、照常走探活链）", () => {
    const check = fnBody("checkMediaManifest", 2600);
    expect(check).toContain("manifest: false");
  });
});

describe("C-03：视频首帧加载超时与加载态", () => {
  it("视频首帧 8 秒不到即判加载失败（VIDEO_LOAD_TIMEOUT_MS + 看门狗）", () => {
    expect(WIDGET).toContain("VIDEO_LOAD_TIMEOUT_MS = 8000");
    const play = fnBody("playClip", 2800);
    expect(play).toContain("VIDEO_LOAD_TIMEOUT_MS");
    expect(play).toContain("videoLoadT");
    expect(play).toContain("readyState >= 2");
  });

  it("首帧到达清掉看门狗（markVideoReady）", () => {
    expect(fnBody("markVideoReady")).toContain("clearTimeout(videoLoadT)");
  });

  it("加载中有加载态：xm-loading 类 + 脉冲动画 + 加载中文案", () => {
    expect(WIDGET).toContain("xm-loading");
    expect(WIDGET).toContain("@keyframes xmLoading");
    expect(WIDGET).toContain('content:"加载中…"');
    const stage = cssRule("#xiaomaomao.xm-loading .xm-stage");
    expect(stage).toContain("animation:xmLoading");
    expect(fnBody("startAmbientVideo")).toContain("xm-loading");
  });

  it("加载态在首帧就绪/走兜底/停播时摘掉", () => {
    expect(fnBody("markVideoReady")).toContain("xm-loading");
    expect(fnBody("stopClips")).toContain("xm-loading");
    expect(fnBody("hideCat")).toContain("xm-loading");
  });

  it("快路径续播时首帧已在即摘加载态（收起→唤回后不残留“加载中…”）", () => {
    // 2026-11-18 接续补修：startAmbientVideo 挂 xm-loading 后 playClip 走同名快路径
    // 直接 return，从不经过 markVideoReady——首帧已在（readyState >= 2）时须当场摘掉，
    // 否则唤回后“加载中…”一直显示在播着的视频底下（p6 探针实测：stateAfterWake.loading 仍 true）。
    const play = fnBody("playClip", 2800);
    // 合入注（2026-11-18 视觉线 B-03）：playClip 快路径条件加了 && !opts.forceSwap
    //（走路接缝换路时绕过快路径），原 indexOf 串已不存在；行为不变（快路径仍
    // 是同一路已加载的视频，首帧已在即摘加载态），按新条件改写。
    const fast = play.slice(play.indexOf("if (clipCurrent === name && clipVisible && !opts.forceSwap)"), play.indexOf("ensureClipEls();"));
    expect(fast).toContain("readyState >= 2");
    expect(fast).toContain("root.classList.remove('xm-loading')");
    expect(fast).toContain("clearTimeout(videoLoadT)");
  });

  it("看门狗判死后迟到的首帧不再把兜底换回视频（videoDead 守卫）", () => {
    // 2026-11-18 接续补修：看门狗 8 秒判死后、视频迟到 10 秒才到首帧时，
    // markVideoReady 的 on() 仍会把兜底换回视频，但 videoDead 还留着 true
    // （“判死却在播”）；守卫要求判死时直接返回，恢复走既有重试路径。
    const mark = fnBody("markVideoReady");
    expect(mark).toContain("clearTimeout(videoLoadT)"); // 看门狗与加载态仍先清掉
    expect(mark).toContain("if (videoDead) return;");
    const idxDead = mark.indexOf("if (videoDead) return;");
    expect(idxDead).toBeGreaterThan(-1);
    // 守卫在 C-05 采样与挂透明类之前
    expect(mark.indexOf("videoAlphaLooksBad")).toBeGreaterThan(idxDead);
    expect(mark.indexOf("xm-has-video")).toBeGreaterThan(idxDead);
  });
});

describe("C-05：首帧四角 alpha 采样", () => {
  it("有四角采样函数（canvas + getImageData）", () => {
    expect(WIDGET).toContain("function videoAlphaLooksBad(");
    const fn = fnBody("videoAlphaLooksBad");
    expect(fn).toContain("getContext('2d')");
    expect(fn).toContain("getImageData");
    expect(fn).toContain("drawImage");
  });

  it("首帧到达后采样：四个角都不透明即判死走 WebP", () => {
    const mark = fnBody("markVideoReady");
    expect(mark).toContain("videoAlphaLooksBad");
    expect(mark).toContain("markVideoDead('alpha')");
  });

  it("采样失败不误杀（取不到上下文/跨域受限时返回 false）", () => {
    const fn = fnBody("videoAlphaLooksBad");
    expect(countOf(fn, "return false")).toBeGreaterThanOrEqual(2);
  });

  it("首帧采样等呈现帧（requestVideoFrameCallback，防空帧漏判不透明视频）", () => {
    // 2026-11-18 接续补修：readyState >= 2 / loadeddata 时 drawImage 仍可能抓到未解出的
    // 空帧（角全透明），不透明视频会漏网（p5 探针三轮 2 过 1 败）。有 rVFC 时在首个呈现帧
    // 上采样，1 秒未呈现则直接采样兜底；无 rVFC 时直接采样（旧行为）。
    const mark = fnBody("markVideoReady");
    expect(mark).toContain("requestVideoFrameCallback");
    expect(mark).toContain("videoAlphaLooksBad");
    expect(mark).toContain("1000");
    expect(mark).toContain("sampled");
  });
});

describe("C-06：hideCat 可逆（兜底全灭不再死刑）", () => {
  it("hideCat 不再写 display:none", () => {
    expect(fnBody("hideCat")).not.toContain("style.display");
  });

  it("兜底全灭时收成圆标（调 collapseCat，用户可点圆标唤回）", () => {
    expect(fnBody("hideCat")).toContain("collapseCat()");
  });

  it("控制台留一条可定位的错误", () => {
    const hide = fnBody("hideCat");
    expect(hide).toContain("console.warn");
    expect(hide).toContain("[xiaomaomao]");
  });

  // 2026-11-18 接续改写（R13）：定时器不再调 startAmbientVideo()——圆标态下它因
  // xm-closed 直接返回，重试是空操作；改为先真实探活，通了才清判死。原断言按新行为改写，未删除。
  it("30 秒后自动重试一次视频路（先探活，通了才清判死 + 复位兜底）", () => {
    expect(WIDGET).toContain("HIDE_CAT_RETRY_MS = 30000");
    const hide = fnBody("hideCat");
    expect(hide).toContain("HIDE_CAT_RETRY_MS");
    const timer = hide.slice(hide.indexOf("window.setTimeout"), hide.indexOf("HIDE_CAT_RETRY_MS);"));
    expect(timer).toContain("probeMedia(");
    expect(timer).toContain("clearVideoDead()");
    expect(timer).toContain("fallbackDead = false");
    expect(timer).not.toContain("startAmbientVideo()");
  });

  it("自动重试只在圆标态才跑（不打扰已展开的猫）", () => {
    expect(fnBody("hideCat")).toContain("xm-closed");
  });

  it("30 秒重试先真实探活（圆标态 startAmbientVideo 是空操作，不能只清判死）", () => {
    // 2026-11-18 接续补修：旧写法在定时器里直接 clearVideoDead() + startAmbientVideo()，
    // 但 startAmbientVideo 遇 xm-closed 直接返回——从不发 HEAD，重试是空操作
    // （p3 探针两轮实测：35 秒内日志里只有初始探活那 1 个 HEAD）。
    const hide = fnBody("hideCat");
    expect(hide).toContain("HIDE_CAT_RETRY_MS");
    expect(hide).toContain("probeMedia(");
    expect(hide).toContain("videoDeadReason !== 'network'");
    expect(hide).toContain("clearVideoDead()");
  });
});

describe("C-07：playClip 同名快路径恢复已暂停视频", () => {
  it("快路径里 loop:true 且已暂停时调 play()", () => {
    const play = fnBody("playClip", 2800);
    expect(play).toContain("clipVisible.paused");
    expect(play).toContain("clipVisible.play()");
  });
});

describe("C-08：庆祝/表情视频链不再探活不存在的文件", () => {
  it("tryCelebVideo 先过滤清单外的名字（celebFileShipped）", () => {
    const fn = fnBody("tryCelebVideo");
    expect(fn).toContain("celebFileShipped");
    expect(fn).toContain("filter");
  });

  it("清单 extras 未列出的文件不发 HEAD（门控查 mediaManifestExtras）", () => {
    expect(WIDGET).toContain("function celebFileShipped(");
    expect(fnBody("celebFileShipped")).toContain("mediaManifestExtras");
  });

  it("显式覆盖（XIAOMAOMAO_MEDIA）仍可播（运营者明确指定时不过滤）", () => {
    expect(fnBody("celebFileShipped")).toContain("XIAOMAOMAO_MEDIA");
  });

  it("三处调用点保留（摸猫/双击/喂鱼的反馈仍在，视频部分由门控决定）", () => {
    expect(WIDGET).toContain("function celebrateVideo(");
    expect(WIDGET).toContain("function playExprVideo(");
    expect(WIDGET).toContain("celebrateVideo('levelup')");
  });
});
