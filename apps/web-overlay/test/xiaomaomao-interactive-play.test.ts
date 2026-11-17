/**
 * 小猫猫互动玩法第一批 Top 3 守卫（2026-11-18）：
 *
 *  1. 追鼠标 + 扑光标：透明视频三段（待机/走路/扑）声明齐全；游乐场态舞台去白底/
 *     去圆角裁剪，视频 object-fit:contain、容器按视频比例（猫完整入镜、不裁脚不裁尾）；
 *     猫绝不挡按钮（命中椭圆 + 落点避让）。
 *  2. 点猫三级 ladder：1 下抬头、2 下开心、3 下打滚（打滚视频后补，当前走路视频+
 *     转圈近似，不编视频）；躲开分支（≥5 下 30%）保留。
 *  3. 拖链接喂猫收藏：走真实收藏接口（BFF /api/hub/favorites，中枢回 {favorite,
 *     existed}，201 新收藏、200 已存在），URL 按导航数据解析 siteId，身份沿用站内键，
 *     失败如实报；成功发 navhub:favorite-added，成长档由 GrowthTracker 统一落账。
 *
 * 与 v7 守卫同款写法：源码断言（不引 jsdom），读 overlay 侧的挂件与成长代码。
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
const TRACKER = readFileSync(join(overlayRoot(), "src/components/growth/growth-tracker.tsx"), "utf8");
const GROWTH_LAZY = readFileSync(join(overlayRoot(), "src/lib/growth-lazy.ts"), "utf8");

/** 取某个 CSS 规则体（选择器第一次出现处的大括号内容） */
function cssRule(selector: string): string {
  const at = WIDGET.indexOf(selector + "{");
  expect(at, "找不到 CSS 规则 " + selector).toBeGreaterThan(-1);
  const end = WIDGET.indexOf("}", at);
  return WIDGET.slice(at, end);
}

describe("Top 1 追鼠标 + 扑光标：视频三段", () => {
  it("透明视频三段声明齐全（待机/走路/扑，VP9 WebM）", () => {
    expect(WIDGET).toContain("var PLAY_CLIPS = { idle: 'play-idle.webm', walk: 'play-walk.webm', pounce: 'play-pounce.webm' };");
    expect(WIDGET).toContain("function playClip(name, opts)");
    expect(WIDGET).toContain("var clipA = null, clipB = null");
    expect(WIDGET).toContain("xm-video xm-clip");
  });

  it("视频显示不裁猫：object-fit:contain、游乐场态舞台去白底去圆角裁剪", () => {
    const video = cssRule("#xiaomaomao .xm-video");
    expect(video).toContain("object-fit:contain");
    expect(video).not.toContain("object-fit:cover");
    const stage = cssRule("#xiaomaomao.xm-play .xm-stage");
    expect(stage).toContain("background:transparent");
    expect(stage).toContain("border-radius:0");
    expect(stage).toContain("overflow:visible");
  });

  it("追鼠标状态机齐全：走路追、限速扑、抓到三段收尾", () => {
    expect(WIDGET).toContain("PLAY_CHASE_SPEED");
    expect(WIDGET).toContain("PLAY_POUNCE_VELOCITY");
    expect(WIDGET).toContain("playClip('walk')");
    expect(WIDGET).toContain("playClip('pounce', { loop: false })");
    expect(WIDGET).toContain("function playPounce()");
    expect(WIDGET).toContain("function playCatch()");
    expect(WIDGET).toContain("document.addEventListener('pointermove', playOnPointerMove");
  });

  it("扑要让人看得见：扑的收尾定时器单独放（不进 playCatchTimers，否则下次移动就清掉），扑到后停住等 1.6 秒再抓", () => {
    expect(WIDGET).toContain("play.pounceT = window.setTimeout(function ()");
    expect(WIDGET).toContain("function playCancelPounce()");
    expect(WIDGET).toContain("play.mode !== 'pounce') return;");
    // 到点分支只停住、不立刻 playCatch（否则 700px/s 扑 150px 只要 0.25 秒，扑视频一闪而过）
    const arrival = WIDGET.slice(WIDGET.indexOf("else if (play.mode === 'pounce') {"), WIDGET.indexOf("else if (play.mode === 'pounce') {") + 260);
    expect(arrival).not.toContain("playCatch()");
  });
});

describe("猫绝不挡按钮", () => {
  it("命中区收成猫身椭圆：透明四角不再挡页面按钮", () => {
    const hit = cssRule("#xiaomaomao .xm-hit");
    expect(hit).toContain("border-radius:50%");
    expect(hit).toContain("pointer-events:auto");
    const stage = cssRule("#xiaomaomao.xm-play .xm-stage");
    expect(stage).toContain("pointer-events:none");
    expect(WIDGET).toContain('<div class="xm-hit" aria-hidden="true"></div>');
  });

  it("游乐场态下舞台外框也不挡：wrap 整体 pointer-events:none，只留命中椭圆与收起角标可点", () => {
    const wrap = cssRule("#xiaomaomao.xm-play .xm-wrap");
    expect(wrap).toContain("pointer-events:none");
    const mini = cssRule("#xiaomaomao.xm-play .xm-mini-close");
    expect(mini).toContain("pointer-events:auto");
  });

  it("落点避让：落点下是可点元素就按九宫格找空位，没空位原地不动", () => {
    expect(WIDGET).toContain("function playFindFreeSpot");
    expect(WIDGET).toContain("function playPointBlocked");
    expect(WIDGET).toContain("document.elementFromPoint");
    expect(WIDGET).toContain("var PLAY_AVOID_SELECTOR = 'a,button,input,select,textarea,[role=\"button\"],[tabindex]';");
  });

  it("游乐场模式下贴边/自动收起不打扰玩猫", () => {
    expect(WIDGET).toContain("(typeof play === 'object' && play !== null && play.on); /* 互动玩法：游乐场模式下不贴边");
    expect(WIDGET).toContain("(typeof play === 'object' && play !== null && play.on); /* 互动玩法：游乐场模式下不自动收起");
  });
});

describe("Top 3 点猫三级 ladder", () => {
  it("1 下抬头、2 下开心、3 下打滚三档分明", () => {
    expect(WIDGET).toContain("petChain === 1");
    expect(WIDGET).toContain("petChain === 2");
    expect(WIDGET).toContain("petChain === 3");
    expect(WIDGET).toContain("看我打滚");
    expect(WIDGET).toContain("xm-roll");
    expect(WIDGET).toContain("打滚视频后补");
  });

  it("躲开分支保留（≥5 下 30% 躲开），三级不吃掉原有行为", () => {
    expect(WIDGET).toContain("PET_DODGE");
    expect(WIDGET).toContain("function petCat()");
  });
});

describe("Top 3 拖链接喂猫收藏：真实接口", () => {
  it("走 BFF 收藏接口（/api/hub/favorites），按中枢真实回包 {favorite, existed} 判定", () => {
    expect(WIDGET).toContain("'/api/hub/favorites'");
    expect(WIDGET).toContain("out.body.favorite");
    expect(WIDGET).toContain("out.body.existed");
    expect(WIDGET).toContain("out.status === 201");
  });

  it("URL 按导航数据解析 siteId（懒加载一次、本会话缓存）", () => {
    expect(WIDGET).toContain("'/api/home/navigation'");
    expect(WIDGET).toContain("function feedFindSiteId");
    expect(WIDGET).toContain("it.subCategories");
  });

  it("身份沿用站内键（userId 优先、anonId 其次），不自己造身份", () => {
    expect(WIDGET).toContain("'navhub.userId'");
    expect(WIDGET).toContain("'navhub.anonId'");
  });

  it("拖放接线与事件桥齐全：先发可取消的 feed-link，成功发 favorite-added", () => {
    expect(WIDGET).toContain("stageEl.addEventListener('dragover'");
    expect(WIDGET).toContain("stageEl.addEventListener('drop'");
    expect(WIDGET).toContain("navhub:feed-link");
    expect(WIDGET).toContain("navhub:favorite-added");
  });

  it("成长档由 GrowthTracker 统一落账（挂件本身不写成长数据）", () => {
    expect(GROWTH_LAZY).toContain("export const FAVORITE_ADDED_EVENT = 'navhub:favorite-added'");
    expect(TRACKER).toContain("FAVORITE_ADDED_EVENT");
    expect(TRACKER).toContain("recordGrowthEvent('favorite_add'");
  });
});

describe("游乐场开关与 v7 不回归", () => {
  it("坞里有游乐场开关（aria-pressed 反映开关态），开关落盘", () => {
    expect(WIDGET).toContain("xm-play-btn");
    expect(WIDGET).toContain("ICONS.chase");
    expect(WIDGET).toContain("setPlayMode(!play.on)");
    expect(WIDGET).toContain("closedAt: 0, play: false");
    expect(WIDGET).toContain("window.XIAOMAOMAO.togglePlay");
    expect(WIDGET).toContain("window.XIAOMAOMAO_PLAY");
  });

  it("v7 锚点仍在：摸猫本体与触摸轻点分支", () => {
    expect(WIDGET).toContain("function petCat()");
    expect(WIDGET).toContain("function dockBlocked()");
    expect(WIDGET).toContain("window.matchMedia('(pointer: coarse)')");
  });
});
