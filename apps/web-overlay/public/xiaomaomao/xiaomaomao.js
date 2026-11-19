// 小猫猫网站 AI 助手挂件 v11（合并版）：右下角悬浮的粉色小猫（Muse 当前头像真图），
// 能聊天找站、会说话、会卖萌、会睡觉，还能摸、能喂、能一起玩接星星。
// 默认显示走透明视频（2026-11-18，William 点选）：待机播透明 idle 循环、行走播透明
// walk 循环，视频在播时舞台透明；视频播不了走动画 WebP 兜底（再不行 GIF，最后藏起来），
// 不再回静态图。2026-11-18 删静态图（William 令）：静态姿势图 25 张全部删除，
// 默认猫只播视频；用户上传的自改形象保留（data URL，不依赖静态图文件）。
// v8（2026-11-12，William 指示换皇冠全套新版）：
//   ①默认形象整套换皇冠版——13 张皇冠表情进 POSES（状态映射见 POSES 上方注释），
//   旧形象不删：整套保留为图库「经典 / 经典深色」选项（POSES_CLASSIC / POSES_DARK），
//   老用户的经典存档选择原样有效；默认不再跟随深浅主题换图。
//   （2026-11-18 删静态图：三套静态图已随静态图目录一并删除，旧内置选择静默退化为默认视频。）
//   ②皇冠动画接入——互动时播静音短循环（media/crown-animations/expr-*.webm，探活回退、懒加载、
//   离屏暂停、减动效不播；常驻主态 2026-11-18 起改走透明视频循环，播不了走 WebP 兜底）；带声音版（media/crown-animations/snd-*.mp4）只在
//   用户主动点猫时才播、默认静音，绝不自动外放（petSoundArmed 一次性授权位）。
//   ③深色模式如实登记缺口：皇冠套没有深色变体，不拿浅色图冒充——深色下舞台改走
//   柔和奶油底衬 + 暖金光晕影（CSS html.dark .xm-stage），图本身与浅色模式同一套。
//   ④v7 铁律不回退：控件零遮挡猫本体、悬浮坞按需唤出、图标全套手工 SVG。
// v12（2026-11-13，Lighthouse Wave 1）：静态图曾外置（JS 3.55MB→约 130KB 代码；
//   经典套 1600px 统一缩到 512px，working 单张 1.08MB→约 20KB）；Script 改 lazyOnload；
//   850ms 自动招呼只顺带朗读在用户手势之后（无手势先出气泡、首次 pointerdown/keydown 后补读）；
//   桌面默认 bottom 18px→96px，不再盖住底部栏/回到顶部/页脚版权；移动端 bottom 12px→
//   calc(68px + safe-area)。speak 总开关 store.voice 默认 true 不变。
// v11 合并版（2026-11-12，三方对账）：以主线 v8（皇冠全套 + 媒体包路线 + Simular 复审
//   返工）为基底，合入旁聊线 v9/v10 增量——农历节日补齐 2027/2028、打字时不打扰、回标
//   签页探头招呼、换姿势弹性 pop / 视频淡入 / 气泡尾巴同色 / 舞台焦点环、待机眨眼、
//   双击表演、长按摸猫、舞台键盘可操作。未合入：v9「互动后动画带原声」——基底声音门
//   更严（点猫一次性授权 petSoundArmed + 语音总开关管有声版 + snd→expr 串行回退），
//   冲突处以基底为准；旁聊 v8 的 13 张皇冠图与基底逐张比对为同一套（仅键名不同），
//   状态映射以基底为准。合并后另有 P1 细节提交（心情视频回退链 / 聊天失败情绪反馈 /
//   TIPS 手势教学 / 说话光圈跟随令牌），见其提交说明。
// v7 为交互与图标重做（William 点名：平时看不了猫）：
//   ①平时零遮挡——静止状态只剩猫本体，v5/v6 常驻舞台角的操作格（语音/喂鱼/星星/关闭）
//   与骑角的聊天徽全部撤掉；控件收进猫上方留白处的悬浮坞（.xm-dock，bottom:100%+10px，
//   与舞台纵向零重叠），只在桌面悬停、移动端轻点猫时淡入展开，移开/点别处/闲置 3 秒自动收起，
//   与气泡互斥（气泡出坞必收、坞开气泡不冒），唤出/收起只动坞自身、不挪猫位不闪烁；
//   首次访问自动展示一次当自我介绍（store.hinted 落盘，之后不再自动出）。
//   ②图标全套重做——UI 控件图标一律换手工 inline SVG（24 网格、圆角线条、统一 1.8 线宽、
//   currentColor 吃设计令牌）：聊天/摸猫(爪印)/喂鱼/接星星/语音开/语音关/关闭/换形象/相机/麦克风/
//   卡片箭头/收起角标/游戏星星/飞鱼，不再用 emoji 或字符充当控件图标（台词、表情符号层、
//   节日装饰、粒子属内容与表现层，不在此列）。
//   ③功能与 v6 完全一致：6+6 真图姿势、深色套、拖动（含触摸/钳制）、贴边半藏、自改形象、
//   喂食/接星星/台词/语音输入/聊天面板/成长桥 A12 一个不少；真图 base64 零改动。
// v6 四件规格：①整套形象补齐——深色模式整套深色图（POSES_DARK，512px 编码）自动切换；
//   庆祝视频钩子：public/xiaomaomao/media/ 下放 celebrate.mp4 / dance-1..5.mp4 即自动生效
//   （或用 window.XIAOMAOMAO_MEDIA 指向 CDN），文件不在时跳过视频庆祝（只留气泡/台词），绝不摆假视频；
//   ②可拖动补强——触摸拖动（touch-action:none）、钳制改按根节点真实尺寸、pointercancel 兜底；
//   ③闲时贴边收缩——60 秒不理小猫自动滑到最近的窗口左右边缘半藏（露约半张脸），
//   悬停/点按弹回；聊天面板/游戏开着、拖动中、收起态不缩；
//   ④用户自改形象——聊天面板里从整套在用图挑一张当主形象，或上传自己的图片
//   （浏览器内裁方压缩、≤约 420KB，只存本机 localStorage，可恢复默认；单图时降级为静态主图+既有动效）。
//   AI 生成形象待站点上线接通 AI 图像模型后再做，本版不含。
// v5 为美工升级：设计令牌化（粉色成体系、深浅双主题跟随站点 html.dark）、舞台去扫光去辉光加地面影、
// 操作钮改 2×2 玻璃格内嵌舞台角（不再溢出视口）、聊天钮独立成舞台角徽、面板锚定主列且移动端改贴底 sheet、
// 气泡绝对定位不再撑宽根节点；功能与 v4 完全一致，真图 base64 零改动。设计稿见 znwzdh-bigtech-audit/WIDGET_V5_DESIGN.md。
// 用法：把本文件与 media/ 目录一起放进 Next.js 的 public/xiaomaomao/ 目录（透明视频
// play-*.webm 与兜底 play-*.webp/.gif 在 media/ 下，二进制不进仓库、部署时另放），
// 在根 layout 的 </body> 前加 <Script src="/xiaomaomao/xiaomaomao.js" strategy="lazyOnload" />
//
// 能力（对齐 Muse 本人的用法，做进这只小猫）：
//  - 自由对话找站：聊天面板调站内 POST /api/hub/ai/chat（小猫猫人设 + 站内检索锚定，
//    能下发的站点只出自站内真实收录）；聊天接口不可用时自动退到 /api/hub/ai/find 找站，
//    再不行就本地话术兜底，绝不报错崩页。会话上下文只存页面内存，不落服务端。
//  - 开口说话：Web Speech API 朗读（优先中文女声、音调略高），右上角喇叭开关，设置记住。
//  - 语音输入：聊天面板麦克风按钮（Web Speech 识别），浏览器不支持时按钮根本不出现，不摆假按钮。
//  - 摸猫互动：点猫有反应，连摸情绪递进（卖萌→开心→撒娇），摸太急偶尔会躲开卖个萌。
//  - 喂小鱼干：每天最多 5 条，饱食度随时间真实衰减、喂食回升，面板数字如实显示；吃够了会拒绝。
//  - 接星星小游戏：30 秒接住掉落的星星计分（金星 3 分），最高分存本机，新纪录会庆祝。
//  - 成长联动：只读本机成长档案（navhub.growth.v1），升级/点亮新徽章时庆祝播报；
//    每日首访结合连续访问天数打招呼。只读不写，绝不替用户改成长数据。
//  - 分页面感知：在短剧页聊短剧、/me 聊等级、分类/搜索/收藏页各有对应招呼与小提示（基于路径，不假装读懂页面）。
//  - 时间与节日：早中晚/深夜不同问候；春节/中秋/国庆/圣诞等节日当天有专属台词与头顶小装饰（CSS/emoji 层，不动真图）。
//  - 表情符号层：思考「？」、开心「♪」、惊讶「！」、得意「★」用 CSS 动画浮在头顶，配合姿势切换。
//  - 懂时间会过日子：闲置久了冒俏皮话，深夜或长闲置会打瞌睡冒 Zzz。
//  - 多状态动画：待机/招呼/思考（working）/庆祝（milestone）/卖萌（making）等表情状态切换
//    （有上传形象时交叉淡入淡出；默认走视频/兜底），叠加呼吸浮动、入场弹跳、爱心星星粒子、鼠标靠近探头跟随；
//    动画只用 transform/opacity，prefers-reduced-motion 时自动降级。
//  - 礼仪：可拖动（位置记住）、可收起成小圆标再唤回、移动端缩小不挡内容。
(function () {
  if (document.getElementById('xiaomaomao')) return;
  var base = (document.currentScript && document.currentScript.src || '/xiaomaomao/xiaomaomao.js').replace(/[^/]*$/, '');
  var ASSETS = base; // 拼脚本所在目录前缀（CDN 部署也能跟走）；媒体在 media/ 下
  var CHAT_URL = '/api/hub/ai/chat';
  var FIND_URL = '/api/hub/ai/find';
  /* 请求超时线（2026-11-18，A P1-1/C-04）：对外请求统一 15 秒超时，挂起不再永久卡死。 */
  var REQUEST_TIMEOUT_MS = 15000;
  /* navCache 阴性结果过期时间（2026-11-18，C-09）：导航接口失败一次后 60 秒可重试。 */
  var NAV_CACHE_NEGATIVE_TTL_MS = 60000;
  var STORE_KEY = 'navhub.xiaomaomao.v1';
  var reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 忽略 */ }

  /* ---------- 删静态图（2026-11-18，William 令） ----------
     皇冠/经典/深色三套静态姿势图已随静态图目录一并删除；默认猫只播视频
     （播不了走 WebP→GIF→藏猫兜底链），不再用静态图。
     表情名（main/milestone/making/…）仍作 setPose 的状态名保留——没有自改形象时
     setPose 是空操作，显示由视频/兜底链负责；有上传形象时换图仍走同一张定格图。 */
  function isDarkTheme() {
    try { return document.documentElement.classList.contains('dark'); } catch (e) { return false; }
  }
  var FUN_CYCLE = [
    { pose: 'waking', text: '嗨，我在跟你招手！' },
    { pose: 'making', text: '看，我会变小魔术哦～' },
    { pose: 'milestone', text: '今天也要闪闪发光！' },
    { pose: 'idle', text: '坐下来歇一会儿……' },
    { pose: 'waking', text: '点旁边的聊天钮，可以跟我说话找网站哦' }
  ];
  var TIPS = [
    '点我旁边的聊天钮，说一句话我就能帮你找网站',
    '短剧专区里有免费短剧，追剧党别错过',
    '首页场景包点「换一批」，能看到更多玩法',
    '想做 PPT、剪视频、学英语，跟我说一声就行',
    '做短剧的全套工具我也能给你配齐哦',
    '我会记住你常用的场景，越用越顺手',
    '双击我，我给你表演一个',
    '长按我可以摸摸我'
  ];

  /* ---------- 持久化（只存本机：语音开关 + 拖动位置） ----------
     K2：closed/closedAt 记录亲手收起（收起后 7 天内刷新/跳页仍收着，过期自动恢复展开）。 */
  var store = { voice: true, pos: null, hinted: false, closed: false, closedAt: 0, play: false };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.voice === 'boolean') store.voice = saved.voice;
      if (typeof saved.hinted === 'boolean') store.hinted = saved.hinted;
      if (typeof saved.closed === 'boolean') store.closed = saved.closed;
      if (typeof saved.closedAt === 'number' && saved.closedAt > 0) store.closedAt = saved.closedAt;
      if (typeof saved.play === 'boolean') store.play = saved.play;
      if (saved.pos && typeof saved.pos.left === 'number' && typeof saved.pos.top === 'number') store.pos = saved.pos;
    }
  } catch (e) { reportStorageFailure(e); /* 读不到已存状态时退化为默认（失败已上报，见 reportStorageFailure） */ }
  /* C-13（2026-11-18）：本地存储失败不再静默——每次失败写 console.warn，用户可见提示每会话只写一次。 */
  var storageWarned = false;
  function reportStorageFailure(e) {
    try { if (typeof console !== 'undefined' && console.warn) console.warn('[xiaomaomao] storage failed', e); } catch (err) { /* 忽略 */ }
    if (storageWarned) return;
    try {
      /* msgsEl 在挂件 DOM 建好后才有值；加载期（DOM 未建好）调到这里时先跳过提示，留待下一次失败再提示。 */
      if (typeof msgsEl !== 'undefined' && msgsEl && typeof addNote === 'function') {
        addNote('小提示：本地保存失败了（浏览器存储不可用），收起状态和喂鱼次数这次记不住，刷新后会恢复默认');
        storageWarned = true;
      }
    } catch (err) { /* 忽略 */ }
  }
  function persist() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { reportStorageFailure(e); }
  }

  /* ---------- v4 玩法状态（摸猫/喂食/游戏/成长见证，全存本机同一个键，向后兼容 v3） ---------- */
  var v4 = {
    seenLevel: 0,          // 小猫上次见证到的成长等级（0 = 还没初始化过）
    seenBadges: null,      // 小猫上次见证到的已点亮徽章 id 数组（null = 还没初始化过）
    greetDay: '',          // 节日/连胜招呼当天只说一次
    fishDay: '',           // 喂鱼计数所属日期
    fishCount: 0,          // 今日已喂小鱼干条数（上限 5）
    sat: 62,               // 饱食度 0-100，随时间衰减、喂食回升
    satAt: 0,              // 饱食度上次结算时间戳
    gameBest: 0            // 接星星最高分
  };
  try {
    var sv4 = (saved && typeof saved === 'object') ? saved.v4 : null;
    if (sv4 && typeof sv4 === 'object') {
      if (typeof sv4.seenLevel === 'number' && sv4.seenLevel >= 0) v4.seenLevel = Math.floor(sv4.seenLevel);
      if (Array.isArray(sv4.seenBadges)) v4.seenBadges = sv4.seenBadges.filter(function (x) { return typeof x === 'string'; });
      if (typeof sv4.greetDay === 'string') v4.greetDay = sv4.greetDay;
      if (typeof sv4.fishDay === 'string') v4.fishDay = sv4.fishDay;
      if (typeof sv4.fishCount === 'number' && sv4.fishCount >= 0) v4.fishCount = Math.floor(sv4.fishCount);
      if (typeof sv4.sat === 'number' && isFinite(sv4.sat)) v4.sat = Math.max(0, Math.min(100, sv4.sat));
      if (typeof sv4.satAt === 'number' && sv4.satAt > 0) v4.satAt = sv4.satAt;
      if (typeof sv4.gameBest === 'number' && sv4.gameBest >= 0) v4.gameBest = Math.floor(sv4.gameBest);
    }
  } catch (e) { /* 脏数据静默退化为默认值 */ }
  if (!v4.satAt) v4.satAt = Date.now();
  /* U-99：恢复后立即挂到 store 上——否则加载期/交互路径的裸 persist()
     会把不带 v4 的 store 写回，连续 reload 两次后成长见证永久丢失。 */
  store.v4 = v4;
  function persistV4() { store.v4 = v4; persist(); }
  function todayKeyStr(d) {
    d = d || new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  /* 饱食度：按真实流逝时间衰减（每小时 -5），懒结算，只在喂食/互动时落盘 */
  function currentSat() {
    var elH = (Date.now() - v4.satAt) / 3600000;
    if (elH > 0.2) {
      v4.sat = Math.max(5, v4.sat - elH * 5);
      v4.satAt = Date.now();
    }
    return v4.sat;
  }
  function rollFishDay() {
    var t = todayKeyStr();
    if (v4.fishDay !== t) { v4.fishDay = t; v4.fishCount = 0; persistV4(); }
  }

  /* ---------- v6：用户自改形象（只存本机；2026-11-18 删静态图后只剩 upload=用户上传图的 data URL；
     旧的 builtin 内置选择（皇冠/经典/深色）已随静态图目录删除，旧存档里的内置选择静默退化为默认视频猫） ---------- */
  var avatarPick = null;
  try {
    var savA = (saved && typeof saved === 'object') ? saved.avatar : null;
    if (savA && typeof savA === 'object') {
      if (savA.kind === 'upload' && typeof savA.data === 'string' && savA.data.indexOf('data:image/') === 0 && savA.data.length <= 450000) {
        avatarPick = { kind: 'upload', data: savA.data };
      }
    }
  } catch (e) { /* 脏数据静默退化为默认视频 */ }
  /* U-169：恢复后立即挂到 store 上——否则加载期/交互路径的裸 persist()
     会把不带 avatar 的 store 写回，连续 reload 两次后用户自选形象永久丢失。 */
  store.avatar = avatarPick;
  function persistAvatar() { store.avatar = avatarPick; persist(); }
  /* 取图唯一出口：只有用户上传的自改形象（单张定格图 data URL），没有默认静态图。
     小图标（面板头/收起圆标）默认用待机 WebP（动图）；上传用户优先用自己的图。 */
  function customImageUrl() {
    return (avatarPick && avatarPick.kind === 'upload') ? avatarPick.data : null;
  }
  function iconUrl() {
    var c = customImageUrl();
    return c || ASSETS + 'media/play-idle.webp';
  }
  /* 小图标加载链：WebP → GIF → 清空（不留破图）。img 没 src 时什么都不显示。 */
  function setIconImg(img) {
    if (!img) return;
    try {
      img.onerror = function () {
        try {
          if (img.getAttribute('data-tier') !== 'gif') {
            img.setAttribute('data-tier', 'gif');
            img.src = ASSETS + 'media/play-idle.gif';
          } else {
            img.onerror = null;
            img.removeAttribute('src');
          }
        } catch (e) { /* 忽略 */ }
      };
      img.setAttribute('data-tier', 'webp');
      img.src = iconUrl();
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 语音 ---------- */
  var voiceOn = store.voice;
  function pickVoice() {
    try {
      var voices = window.speechSynthesis.getVoices();
      for (var v = 0; v < voices.length; v++) {
        if (/^zh/i.test(voices[v].lang)) return voices[v];
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = function () { pickVoice(); };
    }
  }
  var speaking = false;
  /* v12：语音须有用户手势（Chrome 对无手势 speak() 记 deprecation）。pointerdown/keydown
     是真激活事件，scroll/mousemove 不算——不用已有的 markActive（它也听滚动）。 */
  var userActivated = false;
  function noteUserActivation() { userActivated = true; }
  try {
    document.addEventListener('pointerdown', noteUserActivation, { passive: true });
    document.addEventListener('keydown', noteUserActivation);
  } catch (e) { /* 忽略 */ }
  function hasUserActivation() {
    if (userActivated) return true;
    try { return !!(navigator.userActivation && navigator.userActivation.hasBeenActive); } catch (e) { return false; }
  }
  function speak(text) {
    if (!voiceOn || !text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      try { window.speechSynthesis.resume(); } catch (e) { /* 忽略 */ }
      var clean = String(text).replace(/[~～]/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 60) {
        var cut = clean.slice(0, 60);
        var p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('，'));
        clean = p > 12 ? cut.slice(0, p + 1) : cut;
      }
      var u = new SpeechSynthesisUtterance(clean);
      u.lang = 'zh-CN';
      u.pitch = 1.35;
      u.rate = 1.04;
      var voice = pickVoice();
      if (voice) u.voice = voice;
      u.onstart = function () { speaking = true; stageEl.classList.add('xm-speaking'); showEmo('♪'); };
      u.onend = u.onerror = function () { speaking = false; stageEl.classList.remove('xm-speaking'); };
      window.speechSynthesis.speak(u);
    } catch (e) { speaking = false; /* 不支持或被拦截时静默 */ }
  }
  function stopSpeak() {
    speaking = false;
    stageEl.classList.remove('xm-speaking');
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ } }
  }

  /* ---------- v7 图标库：全套手工 inline SVG（24 网格 / 圆角线条 / 线宽 1.8 / currentColor 吃令牌色） ----------
     UI 控件只许用这里的图标，不许再拿 emoji 或字符充数；尺寸由各容器 CSS 决定，SVG 本身不写死宽高。 */
  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  var ICONS = {
    /* 聊天：圆角气泡 + 三点（在说话） */
    chat: SVG_OPEN + '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="8.4" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.6" cy="11.5" r="1" fill="currentColor" stroke="none"/></svg>',
    /* 摸猫：实心爪印（四趾 + 掌垫，与线条图标同视觉重量） */
    paw: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="4.9" cy="10.6" r="1.8"/><circle cx="8.6" cy="6.3" r="2"/><circle cx="15.4" cy="6.3" r="2"/><circle cx="19.1" cy="10.6" r="1.8"/><path d="M12 11.4c2.8 0 5.3 2.2 5.3 4.7 0 1.9-1.4 3.1-3.2 3.1-1 0-1.5-.3-2.1-.3s-1.1.3-2.1.3c-1.8 0-3.2-1.2-3.2-3.1 0-2.5 2.5-4.7 5.3-4.7z"/></svg>',
    /* 喂鱼：鱼身 + 分叉尾 + 眼点 */
    fish: SVG_OPEN + '<path d="M20.8 12c-2.4 3.3-5.5 5-9.1 5-3.2 0-6-1.6-7.9-4.1-.3-.4-.3-1 0-1.4C5.7 8.6 8.5 7 11.7 7c3.6 0 6.7 1.7 9.1 5z"/><path d="M4.6 9.4 7.4 12l-2.8 2.6"/><circle cx="16.9" cy="10.7" r="1" fill="currentColor" stroke="none"/></svg>',
    /* 游戏：圆角五角星 */
    star: SVG_OPEN + '<path d="M12 3.8l2.4 5 5.5.7-4.1 3.8 1.1 5.4L12 16l-4.9 2.7 1.1-5.4L4.1 9.5l5.5-.7z"/></svg>',
    /* 游戏里掉落的星星（内容图形，填色版）：普通 / 金色 */
    starSoft: '<svg viewBox="0 0 24 24" fill="#ffd166" stroke="#eda33a" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.8l2.4 5 5.5.7-4.1 3.8 1.1 5.4L12 16l-4.9 2.7 1.1-5.4L4.1 9.5l5.5-.7z"/></svg>',
    starGold: '<svg viewBox="0 0 24 24" fill="#ffb703" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.8l2.4 5 5.5.7-4.1 3.8 1.1 5.4L12 16l-4.9 2.7 1.1-5.4L4.1 9.5l5.5-.7z"/><circle cx="9.2" cy="9.6" r="1.1" fill="#ffe9a8" stroke="none"/></svg>',
    /* 语音开：喇叭（实心）+ 两道声波 */
    volOn: SVG_OPEN + '<path d="M11 5.2 6.6 9H3.2v6h3.4L11 18.8z" fill="currentColor" stroke="none"/><path d="M15.2 9.4a3.8 3.8 0 0 1 0 5.2"/><path d="M17.9 7a7.6 7.6 0 0 1 0 10"/></svg>',
    /* 语音关：喇叭 + 叉 */
    volOff: SVG_OPEN + '<path d="M11 5.2 6.6 9H3.2v6h3.4L11 18.8z" fill="currentColor" stroke="none"/><path d="M15.8 9.8l4.4 4.4M20.2 9.8l-4.4 4.4"/></svg>',
    /* 关闭：两条圆角斜线 */
    close: SVG_OPEN + '<path d="M6 6l12 12M18 6L6 18"/></svg>',
    /* 换形象：相框 + 太阳 + 山峦 */
    image: SVG_OPEN + '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.2 17.3 10 12l3.4 2.9L17 11.4l2.8 2.9"/></svg>',
    /* 麦克风：胶囊话筒 + 支架 + 底座 */
    mic: SVG_OPEN + '<rect x="9" y="2.8" width="6" height="11" rx="3"/><path d="M5.6 11.2a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.6V21"/></svg>',
    /* 相机：机身 + 镜头（上传图片钮） */
    camera: SVG_OPEN + '<path d="M4 8.2h2.8L8.7 5.6h6.6L17.2 8.2H20a1.2 1.2 0 0 1 1.2 1.2V17a1.8 1.8 0 0 1-1.8 1.8H4.6A1.8 1.8 0 0 1 2.8 17V9.4A1.2 1.2 0 0 1 4 8.2z"/><circle cx="12" cy="13.2" r="3.3"/></svg>',
    /* 卡片箭头：向右 */
    arrow: SVG_OPEN + '<path d="M4.5 12h14M13 6l6 6-6 6"/></svg>',
    /* 归位：逆时针回转箭头（K4 一键回默认位置） */
    reset: SVG_OPEN + '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    /* 游乐场：鼠标指针 + 两道追风线（追鼠标开关，互动玩法第一批 Top 3） */
    chase: SVG_OPEN + '<path d="M5.5 3.2 19 10.6l-6.3 1.6L9.8 19z" fill="currentColor" stroke="none"/><path d="M3.5 19.8h4M5 15.8h2.5"/></svg>'
  };

  /* ---------- DOM 骨架 ---------- */
  var css =
    /* v5 设计令牌：颜色/阴影/缓动收敛成变量，深色只换令牌值（站点 .dark 挂在 html 上） */
    '#xiaomaomao{--xm-accent:#f4507e;--xm-accent-deep:#d6336c;--xm-ink:#77243f;--xm-ink-soft:#b06a84;--xm-surface:rgba(255,255,255,.94);--xm-solid:#fffafc;--xm-chip:rgba(255,240,245,.92);--xm-ring:rgba(214,51,108,.16);--xm-stage-ring:#ffd9e7;--xm-shadow-panel:0 24px 48px -12px rgba(43,10,24,.25),0 4px 12px rgba(43,10,24,.08);--xm-shadow-pop:0 8px 20px -6px rgba(43,10,24,.22);--xm-ease:cubic-bezier(.16,1,.3,1);--xm-spring:cubic-bezier(.34,1.56,.64,1);position:fixed;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(112px + env(safe-area-inset-bottom,0px));z-index:60;font-family:inherit;color:var(--xm-ink);-webkit-tap-highlight-color:transparent}' +
    'html.dark #xiaomaomao{--xm-accent:#ff7096;--xm-accent-deep:#ff8fab;--xm-ink:#f7e3ea;--xm-ink-soft:#d8a7ba;--xm-surface:rgba(30,27,38,.93);--xm-solid:#1e1b26;--xm-chip:rgba(255,112,150,.13);--xm-ring:rgba(255,255,255,.10);--xm-stage-ring:rgba(255,255,255,.14);--xm-shadow-panel:0 24px 48px -12px rgba(0,0,0,.7),0 4px 12px rgba(0,0,0,.4);--xm-shadow-pop:0 8px 20px -6px rgba(0,0,0,.55)}' +
    '#xiaomaomao.xm-enter{animation:xmPop .32s var(--xm-spring)}' +
    '@keyframes xmPop{0%{transform:scale(.9) translateY(10px);opacity:0}100%{transform:scale(1) translateY(0);opacity:1}}' +
    '#xiaomaomao button:focus-visible,#xiaomaomao a:focus-visible{outline:2px solid var(--xm-accent);outline-offset:2px}' +
    /* 主列：宽度恒定 = 舞台宽，气泡与面板都相对它定位，几何不再随气泡文字漂移 */
    '#xiaomaomao .xm-main-col{position:relative;width:112px}' +
    /* 气泡（绝对定位，不再参与根宽度计算） */
    '#xiaomaomao .xm-bubble{position:absolute;right:-4px;bottom:calc(100% + 12px);width:max-content;max-width:248px;background:var(--xm-surface);-webkit-backdrop-filter:blur(12px) saturate(1.5);backdrop-filter:blur(12px) saturate(1.5);border:1px solid var(--xm-ring);border-radius:16px;padding:8px 12px;min-height:55px;font-size:13px;line-height:1.5;color:var(--xm-accent-deep);box-shadow:var(--xm-shadow-pop);opacity:0;transform:translateY(6px) scale(.95);transform-origin:bottom right;transition:opacity .24s var(--xm-ease),transform .24s var(--xm-ease);pointer-events:none;word-break:break-word;z-index:9}' +
    '#xiaomaomao .xm-bubble.xm-show{opacity:1;transform:translateY(0) scale(1)}' +
    '#xiaomaomao .xm-bubble:after{content:"";position:absolute;right:36px;bottom:-5px;width:10px;height:10px;background:var(--xm-surface);border-right:1px solid var(--xm-ring);border-bottom:1px solid var(--xm-ring);transform:rotate(45deg)}' +
    /* 舞台：去扫光、去辉光、去粗描边；加一枚地面影，让猫「坐」在页面上 */
    '#xiaomaomao .xm-wrap{position:relative;width:112px;height:112px}' +
    '#xiaomaomao .xm-wrap:after{content:"";position:absolute;left:10%;right:10%;bottom:-8px;height:14px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(43,10,24,.32),rgba(43,10,24,0) 70%);filter:blur(3px);z-index:0;animation:xmShadow 5.2s ease-in-out infinite;pointer-events:none}' +
    'html.dark #xiaomaomao .xm-wrap:after{background:radial-gradient(ellipse at center,rgba(0,0,0,.55),rgba(0,0,0,0) 70%)}' +
    '@keyframes xmShadow{0%,100%{transform:scaleX(1);opacity:.75}50%{transform:scaleX(.9);opacity:.55}}' +
    '#xiaomaomao .xm-stage{position:absolute;inset:0;z-index:1;border-radius:30%;overflow:hidden;background:#fff;border:1px solid var(--xm-stage-ring);box-shadow:var(--xm-shadow-pop);cursor:pointer;animation:xmFloat 5.2s ease-in-out infinite}' +
    /* C-03：视频首帧加载态——脉冲 + 「加载中…」文案，首帧就绪/兜底/停播时摘掉 */
    '#xiaomaomao.xm-loading .xm-stage{animation:xmLoading 1.1s ease-in-out infinite}' +
    '#xiaomaomao.xm-loading .xm-stage::after{content:"加载中…";position:absolute;left:50%;bottom:6px;transform:translateX(-50%);font-size:11px;color:var(--xm-muted);white-space:nowrap;z-index:3}' +
    '@keyframes xmLoading{0%,100%{opacity:1}50%{opacity:.55}}' +
    /* v8：皇冠图是白底、没有深色变体——深色模式给舞台换柔和奶油底衬 + 暖金光晕影，
       让白底猫像一张暖色贴纸落在深色页上，而不是一块生硬的白方块；收起圆标同理。 */
    'html.dark #xiaomaomao .xm-stage{background:linear-gradient(155deg,#fff9ec 0%,#ffeef2 100%);border-color:rgba(255,196,120,.55);box-shadow:0 16px 34px -12px rgba(255,176,102,.45),var(--xm-shadow-pop)}' +
    'html.dark #xiaomaomao .xm-tab{background:#fff6e6;border-color:rgba(255,196,120,.55)}' +
    '@keyframes xmFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}' +
    /* 说话态：环形脉动（动效映射语义），不再旋转摇晃；P1：光圈改吃 --xm-accent 令牌（color-mix），深浅色自动跟随 */
    '#xiaomaomao .xm-stage.xm-speaking{animation:xmSpeak 1.6s ease-in-out infinite}' +
    '@keyframes xmSpeak{0%,100%{transform:translateY(0);box-shadow:var(--xm-shadow-pop),0 0 0 0 color-mix(in srgb, var(--xm-accent) 35%, transparent)}50%{transform:translateY(-2px);box-shadow:var(--xm-shadow-pop),0 0 0 7px transparent}}' +
    '#xiaomaomao .xm-lean{position:absolute;inset:0;transition:transform .32s var(--xm-ease);will-change:transform}' +
    '#xiaomaomao .xm-lean img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 18%;opacity:0;transition:opacity .32s var(--xm-ease);pointer-events:none;user-select:none;-webkit-user-drag:none}' +
    '#xiaomaomao .xm-lean img.xm-on{opacity:1}' +
    '#xiaomaomao .xm-lean img.xm-pop{animation:xmPosePop .38s var(--xm-spring)}' +
    '@keyframes xmPosePop{0%{transform:scale(.94)}55%{transform:scale(1.025)}100%{transform:scale(1)}}' +
    '#xiaomaomao .xm-wrap.xm-happy{animation:xmBounce .55s var(--xm-spring)}' +
    '@keyframes xmBounce{0%{transform:translateY(0) scale(1)}35%{transform:translateY(-13px) scale(1.05)}70%{transform:translateY(2px) scale(.98)}100%{transform:translateY(0) scale(1)}}' +
    '#xiaomaomao .xm-wrap.xm-sleep .xm-stage{animation-duration:8.5s;box-shadow:0 10px 22px -8px rgba(43,10,24,.25)}' +
    '#xiaomaomao .xm-zzz{position:absolute;top:-8px;right:-4px;z-index:5;pointer-events:none;display:none}' +
    '#xiaomaomao .xm-wrap.xm-sleep .xm-zzz{display:block}' +
    '#xiaomaomao .xm-zzz span{position:absolute;color:var(--xm-accent-deep);font-weight:700;opacity:0;text-shadow:0 1px 6px rgba(255,255,255,.95);animation:xmZzz 2.6s ease-in-out infinite}' +
    'html.dark #xiaomaomao .xm-zzz span{text-shadow:0 1px 6px rgba(0,0,0,.85)}' +
    '#xiaomaomao .xm-zzz span:nth-child(1){font-size:15px;right:0;top:0}' +
    '#xiaomaomao .xm-zzz span:nth-child(2){font-size:19px;right:12px;top:-12px;animation-delay:.85s}' +
    '#xiaomaomao .xm-zzz span:nth-child(3){font-size:24px;right:26px;top:-26px;animation-delay:1.7s}' +
    '@keyframes xmZzz{0%{opacity:0;transform:translateY(6px) rotate(-6deg)}30%{opacity:1}100%{opacity:0;transform:translateY(-16px) rotate(8deg)}}' +
    '#xiaomaomao .xm-fx{position:absolute;inset:-30px;pointer-events:none;z-index:6;overflow:visible}' +
    '#xiaomaomao .xm-fx i{position:absolute;left:50%;top:38%;font-style:normal;opacity:0;animation:xmFly .95s ease-out forwards;text-shadow:0 2px 8px rgba(255,255,255,.85)}' +
    '@keyframes xmFly{0%{opacity:0;transform:translate(-50%,-50%) scale(.4) rotate(0deg)}18%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1.15) rotate(var(--rr))}}' +
    /* v7 操作区：悬浮坞——平时完全收起（opacity 0 + visibility hidden，零遮挡、不可点、不可聚焦）；
       展开时悬在猫上方留白处：bottom:calc(100% + 10px) 与舞台纵向零重叠，默认右对齐向左长，
       猫靠左时由 alignPanel 加 .xm-fan-r 翻向右。按钮入场走 xmDockIn（fill backwards + 逐个延迟，
       像从猫身上荡开），退场随坞整体淡出；聊天钮只用渐变主色区分主次，不再骑角放大。 */
    '#xiaomaomao .xm-dock{position:absolute;right:-4px;bottom:calc(100% + 10px);display:flex;width:max-content;max-width:calc(100vw - 24px);flex-direction:row-reverse;gap:6px;padding:6px;border-radius:999px;background:var(--xm-surface);-webkit-backdrop-filter:blur(14px) saturate(1.5);backdrop-filter:blur(14px) saturate(1.5);border:1px solid var(--xm-ring);box-shadow:var(--xm-shadow-pop);z-index:11;opacity:0;visibility:hidden;transform:translateY(8px) scale(.96);transform-origin:bottom right;transition:opacity .22s var(--xm-ease),transform .22s var(--xm-ease),visibility 0s linear .22s;pointer-events:none}' +
    '#xiaomaomao .xm-dock.xm-fan-r{right:auto;left:-4px;transform-origin:bottom left}' +
    '#xiaomaomao .xm-dock{flex-wrap:wrap}' +
    '#xiaomaomao .xm-growth-chip{flex:0 0 100%;display:none;align-items:center;justify-content:center;gap:4px;padding:2px 6px 0;font-size:11px;line-height:1.35;color:var(--xm-ink-soft);white-space:nowrap;letter-spacing:.02em}' +
    '#xiaomaomao .xm-growth-chip.xm-on{display:flex}' +
    '#xiaomaomao.xm-ctl .xm-dock{opacity:1;visibility:visible;transform:translateY(0) scale(1);transition:opacity .22s var(--xm-ease),transform .22s var(--xm-ease);pointer-events:auto}' +
    '#xiaomaomao .xm-btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 2px 6px rgba(43,10,24,.10);transition:transform .14s var(--xm-ease),background .12s var(--xm-ease),box-shadow .12s var(--xm-ease),filter .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-dock .xm-btn{opacity:0;transition:opacity .18s var(--xm-ease),transform .14s var(--xm-ease),background .12s var(--xm-ease),box-shadow .12s var(--xm-ease),filter .12s var(--xm-ease)}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn{opacity:1;animation:xmDockIn .26s var(--xm-spring) backwards}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn:nth-child(2){animation-delay:.03s}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn:nth-child(3){animation-delay:.06s}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn:nth-child(4){animation-delay:.09s}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn:nth-child(5){animation-delay:.12s}' +
    '#xiaomaomao.xm-ctl .xm-dock .xm-btn:nth-child(6){animation-delay:.15s}' +
    '@keyframes xmDockIn{0%{opacity:0;transform:translateY(10px) scale(.55)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
    '#xiaomaomao .xm-btn:hover{transform:translateY(-1px);background:var(--xm-solid);box-shadow:0 5px 12px rgba(43,10,24,.18)}' +
    '#xiaomaomao .xm-btn:active{transform:scale(.93)}' +
    '#xiaomaomao .xm-btn svg{width:20px;height:20px;flex:none;display:block}' +
    '#xiaomaomao .xm-chat-btn{background:linear-gradient(135deg,#c2185b,#d81b60);color:#fff;border-color:transparent;box-shadow:0 6px 14px -4px rgba(244,80,126,.5)}' +
    '#xiaomaomao .xm-chat-btn:hover{background:linear-gradient(135deg,#c2185b,#d81b60);filter:brightness(1.07)}' +
    /* 收起小圆标：加深度投影，浅底上不再隐形 */
    '#xiaomaomao .xm-tab{display:none;width:58px;height:58px;border-radius:50%;overflow:visible;border:2px solid var(--xm-stage-ring);background:#fff;cursor:pointer;padding:0;box-shadow:var(--xm-shadow-pop);position:relative;transition:transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-tab:hover{transform:scale(1.06)}' +
    '#xiaomaomao .xm-tab img{width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:50% 15%;display:block}' +
    /* v7：收起角标由「聊」字改成 SVG 气泡角标（与全套图标同风格） */
    '#xiaomaomao .xm-tab-badge{position:absolute;right:-2px;bottom:-2px;width:20px;height:20px;border-radius:50%;background:var(--xm-accent);border:2px solid var(--xm-solid);display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none}' +
    '#xiaomaomao .xm-tab-badge svg{width:11px;height:11px;display:block}' +
    'html.dark #xiaomaomao .xm-tab-badge{background:#d6336c}' +
    '#xiaomaomao.xm-closed .xm-tab{display:block}' +
    '#xiaomaomao.xm-closed .xm-main-col{display:none}' +
    /* K5：站内弹窗打开时猫暂隐/降层（.xm-behind-modal），免得压住弹窗与发送按钮 */
    '#xiaomaomao.xm-behind-modal{z-index:30;opacity:0;pointer-events:none;transition:opacity .2s var(--xm-ease)}' +
    /* 聊天面板：锚定主列左侧 14px，玻璃面 + 1px 环 + 中性深影 */
    '#xiaomaomao .xm-panel{position:absolute;bottom:0;right:calc(100% + 14px);width:336px;max-width:calc(100vw - 156px);height:min(508px,66vh);display:none;flex-direction:column;background:var(--xm-surface);-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);border:1px solid var(--xm-ring);border-radius:20px;box-shadow:var(--xm-shadow-panel);overflow:hidden;transform-origin:bottom right;z-index:10}' +
    '#xiaomaomao.xm-open .xm-panel{display:flex;animation:xmPanelIn .24s var(--xm-ease) both}' +
    '@keyframes xmPanelIn{0%{opacity:0;transform:scale(.97) translateY(8px)}100%{opacity:1;transform:scale(1) translateY(0)}}' +
    '#xiaomaomao .xm-panel.xm-left{right:auto;left:calc(100% + 14px);transform-origin:bottom left}' +
    '#xiaomaomao .xm-p-head{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid var(--xm-ring);color:var(--xm-ink);flex:none}' +
    '#xiaomaomao .xm-p-head img{width:34px;height:34px;border-radius:50%;object-fit:cover;object-position:50% 15%;border:2px solid var(--xm-accent)}' +
    '#xiaomaomao .xm-p-title{font-size:14px;font-weight:600;line-height:1.25}' +
    '#xiaomaomao .xm-p-sub{font-size:11.5px;color:var(--xm-ink-soft);font-weight:400}' +
    '#xiaomaomao .xm-p-head .xm-hbtn{margin-left:auto;width:28px;height:28px;border-radius:50%;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-ink);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s var(--xm-ease),transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-p-head .xm-hbtn:hover{background:var(--xm-solid)}' +
    '#xiaomaomao .xm-p-head .xm-hbtn:active{transform:scale(.93)}' +
    '#xiaomaomao .xm-p-head .xm-hbtn + .xm-hbtn{margin-left:0}' +
    '#xiaomaomao .xm-hbtn svg{width:15px;height:15px;display:block}' +
    '#xiaomaomao .xm-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin;scrollbar-color:var(--xm-ring) transparent}' +
    '#xiaomaomao .xm-msgs::-webkit-scrollbar{width:5px}#xiaomaomao .xm-msgs::-webkit-scrollbar-thumb{background:var(--xm-ring);border-radius:3px}' +
    '#xiaomaomao .xm-m{max-width:88%;padding:8px 11px;font-size:13.5px;line-height:1.6;border-radius:16px;word-break:break-word;animation:xmMsgIn .2s var(--xm-ease) both}' +
    '@keyframes xmMsgIn{0%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:translateY(0)}}' +
    '#xiaomaomao .xm-m-u{align-self:flex-end;background:linear-gradient(135deg,var(--xm-accent),#ff8fab);color:#fff;border-bottom-right-radius:6px}' +
    '#xiaomaomao .xm-m-a{align-self:flex-start;background:var(--xm-solid);border:1px solid var(--xm-ring);color:var(--xm-ink);border-bottom-left-radius:6px;box-shadow:0 2px 8px rgba(43,10,24,.06)}' +
    '#xiaomaomao .xm-note{align-self:flex-start;font-size:11px;color:var(--xm-ink-soft);margin-top:-4px}' +
    '#xiaomaomao .xm-dots{display:inline-flex;gap:4px;padding:2px 2px}' +
    '#xiaomaomao .xm-dots i{width:7px;height:7px;border-radius:50%;background:var(--xm-accent);animation:xmDot 1s ease-in-out infinite}' +
    '#xiaomaomao .xm-dots i:nth-child(2){animation-delay:.15s}#xiaomaomao .xm-dots i:nth-child(3){animation-delay:.3s}' +
    '@keyframes xmDot{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-5px);opacity:1}}' +
    '#xiaomaomao .xm-cards{display:flex;flex-direction:column;gap:7px;align-self:flex-start;width:94%;animation:xmMsgIn .2s var(--xm-ease) both}' +
    '#xiaomaomao .xm-card{display:flex;align-items:center;gap:9px;padding:8px 10px;background:var(--xm-solid);border:1px solid var(--xm-ring);border-radius:14px;text-decoration:none;transition:transform .12s var(--xm-ease),box-shadow .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-card:hover{transform:translateY(-1px);box-shadow:var(--xm-shadow-pop)}' +
    '#xiaomaomao .xm-mono{flex:none;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#ff8fab,#ffc2d4);color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center}' +
    '#xiaomaomao .xm-card-t{font-size:13.5px;font-weight:600;color:var(--xm-ink);line-height:1.3}' +
    '#xiaomaomao .xm-card-r{font-size:12px;color:var(--xm-ink-soft);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '#xiaomaomao .xm-card-go{flex:none;color:var(--xm-accent);font-size:16px;font-weight:700}' +
    '#xiaomaomao .xm-card-go svg{width:17px;height:17px;display:block}' +
    '#xiaomaomao .xm-sugs{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;animation:xmMsgIn .2s var(--xm-ease) both}' +
    '#xiaomaomao .xm-sug{display:inline-flex;align-items:center;min-height:30px;padding:4px 11px;border-radius:999px;background:var(--xm-chip);border:1px solid var(--xm-ring);color:var(--xm-accent-deep);font-size:12.5px;text-decoration:none;cursor:pointer;transition:background .12s var(--xm-ease),transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-sug:hover{background:var(--xm-solid)}' +
    '#xiaomaomao .xm-sug:active{transform:scale(.96)}' +
    '#xiaomaomao .xm-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 9px;flex:none}' +
    '#xiaomaomao .xm-form{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--xm-ring);flex:none;align-items:center}' +
    '#xiaomaomao .xm-input{flex:1;min-width:0;height:40px;border-radius:999px;border:1px solid var(--xm-ring);padding:0 15px;font-size:14px;color:var(--xm-ink);outline:none;background:var(--xm-chip)}' +
    '#xiaomaomao .xm-input:focus{border-color:var(--xm-accent);box-shadow:0 0 0 3px rgba(244,80,126,.18)}' +
    '#xiaomaomao .xm-input::placeholder{color:var(--xm-ink-soft)}' +
    '#xiaomaomao .xm-send{flex:none;height:40px;padding:0 17px;border:none;border-radius:999px;background:linear-gradient(135deg,#c2185b,#d81b60);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px -4px rgba(244,80,126,.45);transition:transform .12s var(--xm-ease),filter .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-send:hover{filter:brightness(1.05)}' +
    '#xiaomaomao .xm-send:active{transform:scale(.96)}' +
    '#xiaomaomao .xm-send:disabled{opacity:.55;cursor:default;box-shadow:none;filter:saturate(.4)}' +
    /* 表情符号层 / 节日装饰 / 躲闪 / 喂鱼 / 麦克风 / 接星星（沿用 v4 类名与行为，只换令牌） */
    '#xiaomaomao .xm-emo{position:absolute;top:-18px;left:0;z-index:8;font-size:23px;font-weight:700;color:var(--xm-accent-deep);opacity:0;pointer-events:none;text-shadow:0 2px 8px rgba(255,255,255,.95)}' +
    'html.dark #xiaomaomao .xm-emo{text-shadow:0 2px 8px rgba(0,0,0,.7)}' +
    '#xiaomaomao .xm-emo.xm-emo-show{animation:xmEmo 1.5s var(--xm-ease) forwards}' +
    '@keyframes xmEmo{0%{opacity:0;transform:translateY(7px) scale(.5) rotate(-10deg)}25%{opacity:1;transform:translateY(0) scale(1.18) rotate(5deg)}70%{opacity:1}100%{opacity:0;transform:translateY(-15px) scale(1) rotate(0deg)}}' +
    '#xiaomaomao .xm-deco{position:absolute;top:-20px;right:-2px;z-index:8;font-size:20px;display:none;pointer-events:none;animation:xmFloat 5.2s ease-in-out infinite;filter:drop-shadow(0 3px 5px rgba(43,10,24,.25))}' +
    '#xiaomaomao .xm-wrap.xm-dodge .xm-stage{animation:xmDodge .45s var(--xm-ease)}' +
    '@keyframes xmDodge{0%{transform:translateX(0)}30%{transform:translateX(15px) rotate(3deg)}60%{transform:translateX(-6px) rotate(-1deg)}100%{transform:translateX(0)}}' +
    '#xiaomaomao .xm-fx i.xm-fish-i{animation:xmFish .72s ease-in forwards;font-size:22px;color:#3aa7c7}' +
    '#xiaomaomao .xm-fx i.xm-fish-i svg{width:24px;height:24px;display:block}' +
    '@keyframes xmFish{0%{opacity:0;transform:translate(-50%,-30px) rotate(-26deg) scale(.7)}30%{opacity:1}100%{opacity:0;transform:translate(-50%,30px) rotate(12deg) scale(1.05)}}' +
    '#xiaomaomao .xm-fish-btn{position:relative}' +
    '#xiaomaomao .xm-fish-n{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;border-radius:8px;background:var(--xm-accent);color:#fff;font-size:9px;font-weight:700;line-height:15px;text-align:center;padding:0 3px;box-shadow:0 0 0 1.5px var(--xm-solid),0 2px 6px rgba(244,80,126,.5)}' +
    '#xiaomaomao .xm-mic{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-ink);font-size:16px;cursor:pointer;padding:0;line-height:1;transition:transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-mic:active{transform:scale(.93)}' +
    '#xiaomaomao .xm-mic svg{width:20px;height:20px;display:block}' +
    '#xiaomaomao .xm-mic.xm-mic-live{background:var(--xm-chip);border-color:var(--xm-accent);animation:xmMicPulse 1.2s ease-in-out infinite}' +
    '@keyframes xmMicPulse{0%,100%{box-shadow:0 0 0 0 rgba(244,80,126,.4)}50%{box-shadow:0 0 0 6px rgba(244,80,126,0)}}' +
    '#xiaomaomao .xm-game{position:absolute;bottom:0;right:calc(100% + 14px);width:336px;max-width:calc(100vw - 156px);height:min(436px,62vh);display:none;flex-direction:column;background:var(--xm-surface);-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);border:1px solid var(--xm-ring);border-radius:20px;box-shadow:var(--xm-shadow-panel);overflow:hidden;transform-origin:bottom right;z-index:10}' +
    '#xiaomaomao .xm-game.xm-on{display:flex;animation:xmPanelIn .24s var(--xm-ease) both}' +
    '#xiaomaomao .xm-game.xm-left{right:auto;left:calc(100% + 14px);transform-origin:bottom left}' +
    '#xiaomaomao .xm-g-head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid var(--xm-ring);color:var(--xm-ink);flex:none;font-size:14px;font-weight:700}' +
    '#xiaomaomao .xm-g-head .xm-hbtn{margin-left:auto;width:28px;height:28px;border-radius:50%;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-ink);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s var(--xm-ease),transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-g-head .xm-hbtn:hover{background:var(--xm-solid)}' +
    '#xiaomaomao .xm-g-head .xm-hbtn:active{transform:scale(.93)}' +
    '#xiaomaomao .xm-g-hud{display:flex;gap:14px;padding:7px 12px;font-size:12.5px;color:var(--xm-accent-deep);background:var(--xm-chip);flex:none}' +
    '#xiaomaomao .xm-g-hud b{color:var(--xm-accent);font-size:14px}' +
    '#xiaomaomao .xm-g-area{position:relative;flex:1;overflow:hidden;background:linear-gradient(180deg,#fff0f6,#ffe3ee)}' +
    'html.dark #xiaomaomao .xm-g-area{background:linear-gradient(180deg,rgba(255,112,150,.10),rgba(255,112,150,.05))}' +
    '#xiaomaomao .xm-g-star{position:absolute;width:42px;height:42px;margin-left:-21px;border:none;background:transparent;cursor:pointer;padding:0;animation:xmFall linear forwards;line-height:1;filter:drop-shadow(0 2px 5px rgba(255,150,180,.55))}' +
    '#xiaomaomao .xm-g-star svg{width:30px;height:30px;display:block;margin:6px auto 0}' +
    '#xiaomaomao .xm-g-title{display:inline-flex;align-items:center;gap:6px}' +
    '#xiaomaomao .xm-g-title svg{width:17px;height:17px;color:var(--xm-accent)}' +
    '@keyframes xmFall{from{transform:translateY(0) rotate(-8deg)}to{transform:translateY(var(--fall,440px)) rotate(46deg)}}' +
    '#xiaomaomao .xm-g-pop{position:absolute;font-size:14px;font-weight:700;color:var(--xm-accent);pointer-events:none;animation:xmEmo .8s ease-out forwards;z-index:3}' +
    '#xiaomaomao .xm-g-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;background:var(--xm-surface);text-align:center;padding:18px;z-index:4}' +
    '#xiaomaomao .xm-g-center .xm-g-big{font-size:19px;font-weight:700;color:var(--xm-accent-deep)}' +
    '#xiaomaomao .xm-g-center .xm-g-sub{font-size:13px;color:var(--xm-ink-soft);line-height:1.55}' +
    '#xiaomaomao .xm-g-start{height:40px;padding:0 22px;border:none;border-radius:999px;background:linear-gradient(135deg,var(--xm-accent),#ff8fab);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px -4px rgba(244,80,126,.45);transition:transform .12s var(--xm-ease),filter .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-g-start:hover{filter:brightness(1.05)}' +
    '#xiaomaomao .xm-g-start:active{transform:scale(.96)}' +
    /* 移动端：面板改贴底 sheet（猫留在右下不被遮），全部控件永远在屏内 */
    /* v6：触摸拖动——不让浏览器把拖猫手势抢去滚页面 */
    '#xiaomaomao .xm-stage{touch-action:none}' +
    /* v6：贴边收缩——transform 只动根节点，拖动坐标（left/top）与面板锚定都不受影响 */
    '#xiaomaomao{transition:transform .45s var(--xm-ease)}' +
    '#xiaomaomao.xm-docked .xm-bubble{display:none}' +
    /* P1-1：输入聚焦静默态——根节点整体不可见、不可点（只改显隐，不动 left/top） */
    '#xiaomaomao.xm-quiet{opacity:0;visibility:hidden;pointer-events:none}' +
    /* v6：庆祝视频层（盖在猫本体上方，舞台圆角裁剪；无视频文件时永不出现）
       互动玩法第一批（2026-11-18）：object-fit 改 contain——视频按「整只猫完整入镜、
       四周留白边」生成，cover 会裁边；舞台是 1:1 方形、视频也是 1:1，contain 与 cover
       同屏显示，但 contain 保证任何比例的视频都不裁猫。 */
    '#xiaomaomao .xm-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2;display:none;pointer-events:none}' +
    '#xiaomaomao .xm-video.xm-on{display:block;animation:xmVideoIn .38s var(--xm-ease) both}' +
    '@keyframes xmVideoIn{from{opacity:0}to{opacity:1}}' +
    /* 互动玩法第一批 Top 3（2026-11-18）：游乐场模式。舞台在游乐场态下去掉白底/描边/
       圆角裁剪——视频本身已按「整只猫完整入镜、四周留白边」生成，舞台再裁角会裁到猫；
       命中区收成猫身椭圆（.xm-hit，透明四角不再挡页面按钮——「猫绝不挡按钮」，见
       playFindFreeSpot）；视频 object-fit:contain（见 .xm-video），容器按视频比例
       （舞台是 1:1 方形、视频也是 1:1）。双视频交叉淡化：.xm-clip 常驻显示、靠 opacity
       淡入淡出；喂猫待命时舞台亮一圈粉色光环。 */
    '#xiaomaomao.xm-play .xm-stage{background:transparent;border-color:transparent;box-shadow:none;border-radius:0;overflow:visible;animation:none;pointer-events:none}' +
    /* 默认显示走透明视频（2026-11-18）：视频在播时舞台去白底/描边/圆角裁剪、
       自改形象层藏进视频后面；视频不在/播不了时类名摘掉，兜底态（xm-has-fallback）
       接管舞台；两者都没有时猫直接藏起来（见 hideCat），不回静态白圆。
       深色奶油底衬不能压过视频态，另写一条深色覆盖。 */
    '#xiaomaomao.xm-has-video .xm-stage{background:transparent;border-color:transparent;box-shadow:none;border-radius:0;overflow:visible}' +
    'html.dark #xiaomaomao.xm-has-video .xm-stage{background:transparent;border-color:transparent;box-shadow:none}' +
    '#xiaomaomao.xm-has-video .xm-lean{opacity:0;transition:opacity .28s var(--xm-ease)}' +
    /* 删静态图 + WebP 兜底（2026-11-18，William 点选 WebP）：视频播不了时舞台改播
       动画 WebP（再不行 GIF），兜底态舞台同样去白底/描边/圆角、藏起自改形象层，
       与视频态同款透明舞台；兜底图 object-fit:contain，整只猫完整入镜不裁边。 */
    '#xiaomaomao .xm-fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2;display:none;pointer-events:none}' +
    '#xiaomaomao .xm-fallback.xm-on{display:block}' +
    '#xiaomaomao .xm-still{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2;display:none;pointer-events:none}' +
    '#xiaomaomao .xm-still.xm-on{display:block}' +
    '#xiaomaomao.xm-has-fallback .xm-stage{background:transparent;border-color:transparent;box-shadow:none;border-radius:0;overflow:visible}' +
    'html.dark #xiaomaomao.xm-has-fallback .xm-stage{background:transparent;border-color:transparent;box-shadow:none}' +
    '#xiaomaomao.xm-has-fallback .xm-lean{opacity:0;transition:opacity .28s var(--xm-ease)}' +
    '#xiaomaomao .xm-hit{display:none;position:absolute;left:6%;top:6%;width:88%;height:88%;border-radius:50%;pointer-events:auto;z-index:3}' +
    '#xiaomaomao.xm-play .xm-hit{display:block}' +
    /* 2026-11-18 审计抓到：只把舞台设 pointer-events:none 不够——.xm-wrap 本身是
       默认可点的，透明四角照样盖住页面按钮（elementFromPoint 落在 DIV.xm-wrap 上）。
       游乐场态下整个 wrap 都不接指针，只留命中椭圆与收起角标可点。 */
    '#xiaomaomao.xm-play .xm-wrap{pointer-events:none}' +
    '#xiaomaomao.xm-play .xm-mini-close{pointer-events:auto}' +
    '#xiaomaomao .xm-video.xm-clip{display:block;opacity:0;transition:opacity .28s var(--xm-ease)}' +
    '#xiaomaomao .xm-video.xm-clip.xm-on{opacity:1}' +
    '#xiaomaomao .xm-wrap.xm-roll{animation:xmRoll .95s var(--xm-ease)}' +
    '@keyframes xmRoll{0%{transform:rotate(0deg)}35%{transform:rotate(200deg) translateY(-14px)}70%{transform:rotate(330deg)}100%{transform:rotate(360deg)}}' +
    '#xiaomaomao.xm-eat-ready .xm-stage{box-shadow:0 0 0 3px var(--xm-accent),var(--xm-shadow-pop)}' +
    '#xiaomaomao .xm-stage:focus-visible{outline:2px solid var(--xm-accent);outline-offset:3px}' +
    /* P1-1：猫身常驻收起角标——「收起小猫猫」不再只藏在默认隐藏的坞里，
       不点猫也看得见、点得到；聊天面板开着时隐藏（面板自有收起钮）。 */
    '#xiaomaomao .xm-mini-close{position:absolute;top:-7px;right:-7px;width:26px;height:26px;min-width:26px;border-radius:50%;z-index:7;box-shadow:0 2px 8px rgba(43,10,24,.20)}' +
    '#xiaomaomao .xm-mini-close svg{width:14px;height:14px}' +
    '#xiaomaomao.xm-open .xm-mini-close{display:none}' +
    /* v6：换形象视图（面板内与消息区互斥显示） */
    '#xiaomaomao .xm-look{display:none;flex:1;flex-direction:column;min-height:0}' +
    '#xiaomaomao .xm-panel.xm-looking .xm-look{display:flex}' +
    '#xiaomaomao .xm-panel.xm-looking .xm-msgs,#xiaomaomao .xm-panel.xm-looking .xm-chips,#xiaomaomao .xm-panel.xm-looking .xm-form{display:none}' +
    '#xiaomaomao .xm-look-bar{display:flex;align-items:center;padding:11px 12px 2px;font-size:13.5px;font-weight:700;color:var(--xm-ink)}' +
    '#xiaomaomao .xm-look-back{margin-left:auto;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-ink);font-size:12px;cursor:pointer}' +
    '#xiaomaomao .xm-look-back:hover{background:var(--xm-solid)}' +
    '#xiaomaomao .xm-look-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 12px;overflow-y:auto;scrollbar-width:thin}' +
    '#xiaomaomao .xm-look-item{border:2px solid var(--xm-ring);border-radius:14px;padding:3px;background:var(--xm-solid);cursor:pointer;font:inherit}' +
    '#xiaomaomao .xm-look-item:hover{transform:translateY(-1px)}' +
    '#xiaomaomao .xm-look-item:active{transform:scale(.96)}' +
    '#xiaomaomao .xm-look-item img{width:100%;aspect-ratio:1;object-fit:cover;object-position:50% 18%;border-radius:10px;display:block;pointer-events:none}' +
    '#xiaomaomao .xm-look-item span{display:block;font-size:10.5px;color:var(--xm-ink-soft);text-align:center;padding:3px 0 1px;white-space:nowrap;overflow:hidden}' +
    '#xiaomaomao .xm-look-item.xm-sel{border-color:var(--xm-accent);box-shadow:0 0 0 2px rgba(244,80,126,.25)}' +
    '#xiaomaomao .xm-look-foot{padding:2px 12px 12px;display:flex;flex-direction:column;gap:8px;flex:none}' +
    '#xiaomaomao .xm-look-act{height:38px;border-radius:999px;border:1px solid var(--xm-ring);background:var(--xm-chip);color:var(--xm-accent-deep);font-size:13px;font-weight:700;cursor:pointer;font:inherit}' +
    '#xiaomaomao .xm-look-act:hover{background:var(--xm-solid)}' +
    '#xiaomaomao .xm-look-act svg{width:16px;height:16px;vertical-align:-3px;margin-right:5px}' +
    '#xiaomaomao .xm-look-act:active{transform:scale(.97)}' +
    '@media (max-width:640px){#xiaomaomao{right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(68px + env(safe-area-inset-bottom,0px))}#xiaomaomao .xm-main-col{width:88px}#xiaomaomao .xm-wrap{width:88px;height:88px}#xiaomaomao .xm-dock{gap:5px;padding:5px;bottom:calc(100% + 8px);width:auto}#xiaomaomao .xm-dock .xm-btn{width:34px;height:34px}#xiaomaomao .xm-dock .xm-btn svg{width:19px;height:19px}#xiaomaomao .xm-bubble{max-width:min(248px,calc(100vw - 130px));font-size:12.5px}#xiaomaomao .xm-panel,#xiaomaomao .xm-game{position:fixed;left:12px;right:12px;width:auto;max-width:none;bottom:calc(104px + env(safe-area-inset-bottom,0px))}#xiaomaomao .xm-panel.xm-left,#xiaomaomao .xm-game.xm-left{left:12px;right:12px}#xiaomaomao .xm-panel{height:min(508px,62vh)}#xiaomaomao .xm-game{height:min(436px,58vh)}}' +
    /* P1-1：市场页窄屏自动收起态——根节点整体滑出视口右侧（transform 只写位移，
       不动 left/top、不覆盖用户拖动位置；圆标本体随根节点一起出视口，点按与包围盒都不再挡页面元素）。
       Q1 返工：位移量不用固定值——拖动过的猫 left 不同，固定 70px 会留一部分在视口内；
       收起时按实时矩形算进 --xm-park-x（见 syncMarketPark）。
       回落值 calc(100vw + 12px)：只有 JS 量取抛错时才走；按视口宽算，从任何 left 出发
       都能整只滑出视口（旧 calc(100% + 12px) 按自身宽度算，只对默认位置成立）。 */
    '@media (max-width:640px){#xiaomaomao.xm-parked{transform:translateX(var(--xm-park-x,calc(100vw + 12px)))}}' +
    /* P2-16：页脚避让放宽到 ≤1023px——页脚 md（≥768px）起改右对齐行布局，版权行贴右缘，
       猫在 640–1023px 默认 bottom 112px（K1 悬浮栈规范，与桌面默认同值；原 4.5rem+18px
       =90px 会蹭胶囊顶部），拖动过的猫会直接盖住版权行与备案链接；滚到底时沿用 P1-1 的收起
       位移（--xm-park-x 实时量取），
       与 ≤640px 同款滑出视口。顶部收起（y≤30，防盖搜索行）仍只在 ≤640px 生效，见 syncMarketPark。 */
    '@media (min-width:641px) and (max-width:1023px){#xiaomaomao.xm-parked{transform:translateX(var(--xm-park-x,calc(100vw + 12px)))}}' +
    /* 半屏下沉栏避让（Batch 3 第 12 项 BLOCK 修复）：640–1024px 首页底部有 56px 高的常驻栏
       （HalfScreenDock，z-40），猫默认 bottom:18px 会整只盖住栏右侧、.xm-lean 拦截指针，
       栏的关闭 × 完全点不到。媒体规则只抬未拖动过的默认位置：拖动后行内 left/top +
       right/bottom:auto 会覆盖样式表的 bottom（top 与 bottom 同时设置时 top 优先），
       拖过的猫以用户自选位置为准，这里不用 !important 去压用户的位置；
       60 秒闲置贴边只写 transform（横向），抬高后仍成立；面板/游戏/坞都相对猫根节点
       定位（bottom:0 / bottom:100%+10px），随猫一起抬高、仍在视口内。
       区间与栏的显隐区间 [640,1024) 逐字对齐（max-width:1023px）；放在 ≤640 规则之后，
       640px 整点处以本规则为准（≤640 规则会把 bottom 写回 68px）。 */
    '@media (min-width:640px) and (max-width:1023px){#xiaomaomao{bottom:calc(112px + env(safe-area-inset-bottom,0px))}}' +
    '@media (prefers-reduced-motion: reduce){#xiaomaomao *,#xiaomaomao{animation-duration:.01s !important;animation-iteration-count:1 !important;transition-duration:.01s !important}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.id = 'xiaomaomao';
  root.innerHTML =
    '<div class="xm-main-col">' +
      '<div class="xm-bubble" aria-live="polite"></div>' +
      '<div class="xm-wrap">' +
        '<div class="xm-fx"></div>' +
        '<div class="xm-zzz"><span>z</span><span>z</span><span>Z</span></div>' +
        '<div class="xm-stage" role="button" aria-label="小猫猫，点我玩一玩" title="小猫猫"><div class="xm-hit" aria-hidden="true"></div><div class="xm-lean">' +
          '<img class="xm-img-a" alt="小猫猫"><img class="xm-img-b" alt="" aria-hidden="true">' +
        '</div></div>' +
        /* P1-1：猫身常驻收起角标（S-3），与坞里的关闭钮共用 collapseCat */
        '<button class="xm-btn xm-mini-close" type="button" title="收起小猫猫" aria-label="收起小猫猫">' + ICONS.close + '</button>' +
      '</div>' +
      /* v7：悬浮坞挂在主列里、舞台之外（猫上方留白处），平时隐藏；DOM 顺序=聊天/摸猫/语音/关闭，
         喂鱼与接星星钮由 JS 插到关闭钮之前；flex row-reverse 让聊天钮始终贴猫那一端 */
      '<div class="xm-dock" role="toolbar" aria-label="小猫猫的操作按钮">' +
        '<button class="xm-btn xm-chat-btn" type="button" title="跟小猫猫聊天找站" aria-label="跟小猫猫聊天找站">' + ICONS.chat + '</button>' +
        '<button class="xm-btn xm-pet-btn" type="button" title="摸摸小猫猫" aria-label="摸摸小猫猫">' + ICONS.paw + '</button>' +
        '<button class="xm-btn xm-voice-btn" type="button" title="开关小猫语音" aria-label="开关小猫语音">' + ICONS.volOn + '</button>' +
        '<button class="xm-btn xm-close-btn" type="button" title="先把小猫收起来" aria-label="收起小猫猫">' + ICONS.close + '</button>' +
      '</div>' +
      '<div class="xm-panel" role="dialog" aria-modal="true" aria-label="小猫猫聊天">' +
        '<div class="xm-p-head"><img alt=""><div><div class="xm-p-title">小猫猫</div><div class="xm-p-sub">AI 找站小助手 · 只推站内收录</div></div>' +
        '<button class="xm-hbtn xm-look-btn" type="button" title="换个伙伴形象" aria-label="换个伙伴形象">' + ICONS.image + '</button>' +
        '<button class="xm-hbtn xm-voice-btn" type="button" title="开关小猫语音" aria-label="开关小猫语音">' + ICONS.volOn + '</button>' +
        '<button class="xm-hbtn xm-p-close" type="button" title="收起聊天" aria-label="收起聊天">' + ICONS.close + '</button></div>' +
        '<div class="xm-look">' +
          '<div class="xm-look-bar"><span>我的伙伴形象</span><button class="xm-look-back" type="button">返回聊天</button></div>' +
          '<div class="xm-look-grid"></div>' +
          '<div class="xm-look-foot">' +
            '<button class="xm-look-act xm-look-upload" type="button">' + ICONS.camera + '上传我的图片</button>' +
            '<button class="xm-look-act xm-look-default" type="button">恢复默认形象</button>' +
            '<input class="xm-look-file" type="file" accept="image/*" hidden>' +
            '<div class="xm-note xm-look-note">从整套在用图里挑一张，或者上传你自己的图。只保存在这台设备的浏览器里，不会上传到任何地方。</div>' +
          '</div>' +
        '</div>' +
        '<div class="xm-msgs"></div>' +
        '<div class="xm-chips">' +
          '<button class="xm-sug" type="button" data-q="我想看免费短剧">看免费短剧</button>' +
          '<button class="xm-sug" type="button" data-q="我想做短剧，有什么工具">做短剧工具</button>' +
          '<button class="xm-sug" type="button" data-q="推荐做 PPT 的网站">做 PPT</button>' +
          '<button class="xm-sug" type="button" data-q="学英语用什么网站好">学英语</button>' +
          '<button class="xm-sug" type="button" data-q="AI 生图工具有哪些">AI 生图</button>' +
        '</div>' +
        '<form class="xm-form"><input class="xm-input" type="text" maxlength="200" placeholder="想找什么，跟小猫猫说…" aria-label="想找什么，跟小猫猫说"><button class="xm-send" type="submit">发送</button></form>' +
      '</div>' +
    '</div>' +
    '<button class="xm-tab" type="button" title="叫出小猫猫" aria-label="叫出小猫猫"><img alt="小猫猫"><span class="xm-tab-badge" aria-hidden="true">' + ICONS.chat + '</span></button>';
  document.body.appendChild(root);
  /* K2：启动时恢复持久收起态——7 天内收起过则仍收着（圆标可唤回）；超过 7 天
     自动过期恢复展开（关一次不等于永久消失）。自动收起（syncMarketPark 的
     autoClosed）不走这条：它只在本页滚动时生效，不落盘。 */
  (function () {
    var CLOSED_TTL = 7 * 24 * 3600 * 1000;
    if (!store.closed) return;
    if (!store.closedAt) { store.closedAt = Date.now(); persist(); }
    else if (Date.now() - store.closedAt > CLOSED_TTL) {
      store.closed = false; store.closedAt = 0; persist();
      return;
    }
    root.classList.add('xm-closed');
    setIconImg(root.querySelector('.xm-tab img')); /* B-04：启动恢复收起态时才给圆标设 src */
  })();

  var wrapEl = root.querySelector('.xm-wrap');
  var stageEl = root.querySelector('.xm-stage');
  var leanEl = root.querySelector('.xm-lean');
  var bubbleEl = root.querySelector('.xm-bubble');
  var fxEl = root.querySelector('.xm-fx');
  var panelEl = root.querySelector('.xm-panel');
  var msgsEl = root.querySelector('.xm-msgs');
  var inputEl = root.querySelector('.xm-input');
  var sendBtn = root.querySelector('.xm-send');
  var imgA = root.querySelector('.xm-img-a');
  var imgB = root.querySelector('.xm-img-b');
  /* B-04：启动时不给面板头像与收起圆标设 WebP src（首屏不拉 3.7MB 兜底图）；
     面板头像在打开面板时、收起圆标在收起与启动恢复收起态时才懒加载。 */

  /* ---------- 姿势状态机（双层交叉淡入淡出） ----------
     2026-11-18 删静态图：默认姿势图已删；这条换图路径只服务用户上传的自改形象
     （单张定格图，叫什么名字都显示同一张，与旧行为一致）。没有自改形象时 setPose
     是空操作，显示由视频/WebP/GIF 兜底链负责。 */
  var currentPose = 'main';
  var frontImg = imgA, backImg = imgB;
  (function () {
    var cu = customImageUrl();
    if (cu) { imgA.src = cu; imgA.classList.add('xm-on'); }
  })();
  function setPose(name) {
    if (!avatarPick || avatarPick.kind !== 'upload' || name === currentPose) return;
    currentPose = name;
    var url = avatarPick.data;
    var done = false;
    var swap = function () {
      if (done) return;
      done = true;
      backImg.src = url;
      backImg.classList.add('xm-on');
      if (!reducedMotion) {
        backImg.classList.remove('xm-pop');
        void backImg.offsetWidth;
        backImg.classList.add('xm-pop');
        var popImg = backImg;
        window.setTimeout(function () { popImg.classList.remove('xm-pop'); }, 420);
      }
      frontImg.classList.remove('xm-on');
      var t = frontImg; frontImg = backImg; backImg = t;
    };
    var probe = new Image();
    probe.onload = swap;
    probe.onerror = function () { /* 图缺失时保持当前显示，不露破图 */ };
    probe.src = url;
    if (probe.complete && probe.naturalWidth > 0) swap();
  }
  /* ---------- v6：形象刷新（换形象/站点深浅主题切换时统一重绘三处用图） ---------- */
  var lastDark = isDarkTheme();
  function refreshAvatarImages() {
    lastDark = isDarkTheme();
    /* B-04：只动已加载过的图标——没设过 src 的不提前拉取 WebP 兜底。 */
    var headImg = root.querySelector('.xm-p-head img');
    if (headImg && headImg.hasAttribute('src')) setIconImg(headImg);
    var tabImg = root.querySelector('.xm-tab img');
    if (tabImg && tabImg.hasAttribute('src')) setIconImg(tabImg);
    var cu = customImageUrl();
    if (cu) frontImg.src = cu;
    else frontImg.removeAttribute('src');
  }
  try {
    new MutationObserver(function () {
      if (isDarkTheme() !== lastDark) refreshAvatarImages();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* 无 MutationObserver 的老环境：刷新页面即按新主题生效 */ }

  /* ---------- 粒子 ---------- */
  var FX_CHARS = ['♥', '★', '✦', '❤', '✿'];
  var FX_COLORS = ['#ff5d8f', '#ff8fab', '#ffb703', '#ffabc6', '#e75480'];
  function burst(n) {
    if (reducedMotion) return;
    for (var k = 0; k < (n || 9); k++) {
      var s = document.createElement('i');
      s.textContent = FX_CHARS[Math.floor(Math.random() * FX_CHARS.length)];
      s.style.color = FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)];
      s.style.fontSize = (11 + Math.random() * 11) + 'px';
      s.style.setProperty('--tx', (Math.random() * 130 - 65) + 'px');
      s.style.setProperty('--ty', (-(30 + Math.random() * 85)) + 'px');
      s.style.setProperty('--rr', (Math.random() * 160 - 80) + 'deg');
      s.style.animationDelay = (Math.random() * 0.12) + 's';
      fxEl.appendChild(s);
      (function (el) { window.setTimeout(function () { el.remove(); }, 1250); })(s);
    }
  }
  function happyBounce() {
    if (reducedMotion) return;
    wrapEl.classList.remove('xm-happy');
    void wrapEl.offsetWidth;
    wrapEl.classList.add('xm-happy');
  }

  /* ---------- v6：庆祝视频钩子（文件就位即生效，不在时安静回退图片庆祝） ----------
     约定文件（相对挂件脚本目录）：media/celebrate.mp4、media/dance-1.mp4 … dance-5.mp4。
     也可用 window.XIAOMAOMAO_MEDIA = { celebrate: url, dances: [url, …] } 指向 CDN。
     每会话每文件只探活一次（HEAD）；自改形象或减动效时不播视频。
     v8 扩充：皇冠动画两套——静音短循环 media/crown-animations/expr-<名>.webm（VP9，≤300KB，
     互动时播、循环约 6.5 秒收）；带声音版 media/crown-animations/snd-<名>.mp4（v5 最萌版音效）
     只许用户主动点猫时播（见 petCat 的 petSoundArmed），默认静音、绝不自动外放；页面切后台/
     猫滚出视口立即停播（离屏直接移除）。复审返工：videoSeq 取消令牌防滞后冒播、回调绑实例
     防串台、语音总开关管有声版、有声开播先停 TTS 防叠音。XIAOMAOMAO_MEDIA.videos 可按名覆盖任意一条的地址。
     媒体包路线：动画是二进制文件，走不了 GitHub 文本快照推送，不进仓库；部署时把媒体包
     media/crown-animations/ 整个放到 public/xiaomaomao/media/ 下（见媒体包 README），
     文件不在时探活失败自动跳过（只留气泡/台词），绝不报错、不留白。 */
  var MEDIA_BASE = base + 'media/';
  var MEDIA_BASE_CROWN = base + 'media/crown-animations/';
  var mediaProbe = {};
  function mediaUrl(name) {
    try {
      var o = window.XIAOMAOMAO_MEDIA;
      if (o && typeof o === 'object') {
        if (o.videos && typeof o.videos[name] === 'string') return o.videos[name];
        if (name === 'celebrate' && typeof o.celebrate === 'string') return o.celebrate;
        var m = /^dance-(\d)$/.exec(name);
        if (m && Array.isArray(o.dances) && typeof o.dances[+m[1] - 1] === 'string') return o.dances[+m[1] - 1];
      }
    } catch (e) { /* 忽略 */ }
    if (name.indexOf('expr-') === 0) return MEDIA_BASE_CROWN + name + '.webm';
    if (name.indexOf('snd-') === 0) return MEDIA_BASE_CROWN + name + '.mp4';
    return MEDIA_BASE + name + '.mp4';
  }
  var PROBE_TIMEOUT_MS = 5000; /* 探活 HEAD 超时：5 秒不回即判失败（C-01 / A P1-5） */
  var PROBE_NEGATIVE_TTL_MS = 30000; /* 探活阴性结果只缓存 30 秒，过期重探（C-01 / A P1-5） */
  var mediaProbeFailedAt = {}; /* url -> 上次探活阴性结果的时间戳（毫秒） */
  function fetchWithTimeout(url, opts) {
    /* fetch + 超时竞速：超时返回 null（不等底层请求，只是不再等它）。
       全文件无 AbortController——不用它，省得老环境再分支。 */
    opts = opts || {};
    try {
      return Promise.race([
        window.fetch(url, opts.fetchOpts || {}),
        new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, opts.ms || PROBE_TIMEOUT_MS); })
      ]).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  var MEDIA_MANIFEST_VERSION = 1; /* 媒体清单版本：清单 version 与它不符即部署不同步（C-02） */
  var mediaManifestExtras = null; /* 清单 extras 的文件名列表（未就绪时为 null，供 C-08 门控用） */
  var mediaManifestStatus = null; /* 清单核对结果（诊断用，见 window.XIAOMAOMAO_MEDIA_STATUS） */
  function checkMediaManifest() {
    /* 启动时核对媒体清单：版本不符/文件缺失只写 console.warn + 暴露诊断状态，不拦猫；
       清单缺失（老部署）记 manifest: false，照常走探活链。 */
    var status = { manifest: false, version: 0, expected: 0, missing: [], checkedAt: Date.now() };
    mediaManifestStatus = status;
    try { window.XIAOMAOMAO_MEDIA_STATUS = { mediaManifestStatus: status }; } catch (e) { /* 忽略 */ }
    fetchWithTimeout(base + 'media-manifest.json', { ms: PROBE_TIMEOUT_MS }).then(function (r) {
      if (!r || !r.ok) { status.manifest = false; return; }
      return r.json().then(function (m) {
        status.manifest = true;
        status.version = (m && m.version) || 0;
        var files = (m && m.files) || {};
        var names = Object.keys(files);
        status.expected = names.length;
        if (status.version !== MEDIA_MANIFEST_VERSION) {
          console.warn('[xiaomaomao] media manifest version mismatch: got ' + status.version + ', expected ' + MEDIA_MANIFEST_VERSION);
        }
        mediaManifestExtras = Array.isArray(m.extras) ? m.extras.slice() : [];
        names.forEach(function (name) {
          probeMedia(MEDIA_BASE + name).then(function (ok) {
            if (!ok) {
              status.missing.push(name);
              console.warn('[xiaomaomao] media missing (manifest): ' + name);
            }
          });
        });
      });
    }).catch(function () { status.manifest = false; });
  }
  function probeMedia(url) {
    var failedAt = mediaProbeFailedAt[url];
    if (failedAt && Date.now() - failedAt < PROBE_NEGATIVE_TTL_MS) return Promise.resolve(false);
    if (failedAt) { delete mediaProbeFailedAt[url]; delete mediaProbe[url]; }
    if (!mediaProbe[url]) {
      try {
        mediaProbe[url] = fetchWithTimeout(url, { fetchOpts: { method: 'HEAD' }, ms: PROBE_TIMEOUT_MS })
          .then(function (r) {
            var ok = !!(r && r.ok);
            if (!ok) { mediaProbeFailedAt[url] = Date.now(); delete mediaProbe[url]; }
            return ok;
          });
      } catch (e) { mediaProbe[url] = Promise.resolve(false); }
    }
    return mediaProbe[url];
  }
  var videoEl = null, videoHideT = 0, videoSeq = 0; /* v8 复审返工：videoSeq 是视频取消令牌——每次停播 +1，滞后的探活链凭令牌丢弃，休眠/收起/切后台后视频不再冒出来 */
  function stopCelebVideo() {
    videoSeq++;
    window.clearTimeout(videoHideT);
    if (videoEl) {
      try { videoEl.pause(); } catch (e) { /* 忽略 */ }
      videoEl.remove();
      videoEl = null;
    }
  }
  function showCelebVideo(url, opts) {
    opts = opts || {};
    /* v8 复审返工：入口复核当前状态——探活期间休眠/收起/切后台/换形象了就不再挂视频 */
    if (reducedMotion || avatarPick || sleeping) return;
    try { if (document.hidden || root.classList.contains('xm-closed')) return; } catch (e) { /* 忽略 */ }
    stopCelebVideo();
    try {
      var el = document.createElement('video'); /* v8 复审返工：回调只许动自己的实例，旧视频的 play().catch / ended / error 再串不了新视频的台 */
      videoEl = el;
      el.className = 'xm-video xm-on';
      el.muted = !opts.sound;
      if (opts.sound) { try { el.volume = 0.9; } catch (e) { /* 忽略 */ } }
      if (opts.loop) el.loop = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('preload', 'metadata');
      try { el.disablePictureInPicture = true; } catch (e) { /* 忽略 */ }
      el.src = url;
      var onEnd = function () { if (videoEl === el) stopCelebVideo(); };
      el.addEventListener('ended', onEnd);
      el.addEventListener('error', onEnd);
      stageEl.appendChild(el);
      try {
        /* 有声视频真正开播时先停 TTS，别让猫叫和朗读叠音；探活失败没播出来时 TTS 不受影响 */
        if (opts.sound) stopSpeak();
        var p = el.play();
        if (p && p.catch) p.catch(function () {
          /* 带声音自动播放被浏览器拦下时降级静音播，不让动画也没了 */
          if (videoEl === el && opts.sound) {
            try { el.muted = true; var p2 = el.play(); if (p2 && p2.catch) p2.catch(function () { /* 留首帧 */ }); } catch (e) { /* 忽略 */ }
          }
        });
      } catch (e) { /* 无头/受限环境静默 */ }
      videoHideT = window.setTimeout(function () { if (videoEl === el) stopCelebVideo(); }, opts.ms || 9000);
    } catch (e) { stopCelebVideo(); }
  }
  function celebFileShipped(name) {
    /* 庆祝/表情视频只播确实发版的文件：显式覆盖（XIAOMAOMAO_MEDIA）放行；
       否则查清单 extras（mediaManifestExtras 未就绪时为 null，一律不放行——不发 HEAD）。 */
    try {
      var o = window.XIAOMAOMAO_MEDIA;
      if (o && o.videos && typeof o.videos[name] === 'string') return true;
      if (o && o.celebrate && typeof o.celebrate[name] === 'string') return true;
      if (o && o.dances && typeof o.dances[name] === 'string') return true;
    } catch (e) { /* 忽略 */ }
    if (!mediaManifestExtras) return false;
    var tail = mediaUrl(name).split('/').pop();
    return mediaManifestExtras.indexOf(tail) !== -1;
  }
  function tryCelebVideo(names, opts, seq) {
    names = (names || []).filter(celebFileShipped);
    if (!names.length) return;
    if (typeof seq !== 'number') seq = videoSeq;
    var url = mediaUrl(names[0]);
    probeMedia(url).then(function (ok) {
      if (seq !== videoSeq) return; /* 期间被停播或新触发顶掉：旧链丢弃 */
      if (ok) showCelebVideo(url, opts);
      else tryCelebVideo(names.slice(1), opts, seq);
    });
  }
  function celebrateVideo(kind) {
    if (reducedMotion || avatarPick) return;
    try {
      var o = window.XIAOMAOMAO_MEDIA;
      if (o && (typeof o.celebrate === 'string' || Array.isArray(o.dances))) {
        var dances = ['dance-1', 'dance-2', 'dance-3', 'dance-4', 'dance-5'];
        var start = Math.floor(Math.random() * dances.length);
        var rotated = dances.slice(start).concat(dances.slice(0, start));
        tryCelebVideo(kind === 'record' ? rotated.concat(['celebrate']) : ['celebrate'].concat(rotated), { loop: true, ms: 6500 });
        return;
      }
    } catch (e) { /* 忽略，走皇冠动画 */ }
    /* v8：没有外部覆盖时，庆祝改播皇冠静音动画（开心大笑为主，纪录时轮换机灵/眨眼） */
    tryCelebVideo(kind === 'record' ? ['expr-clever', 'expr-happy', 'expr-wink'] : ['expr-happy', 'expr-clever'], { loop: true, ms: 6500 });
  }
  /* v8：按表情播动画——静音短循环；withSound=true 时播带声音版（只许点猫链路传 true）。
     同一套守卫：减动效/自改形象/睡着时不播；文件不在探活回退，安静无视频。 */
  function playExprVideo(exprKey, withSound) {
    if (reducedMotion || avatarPick || sleeping) return;
    /* v8 复审返工：语音总开关管着有声版——关了语音只播静音版；snd 探活失败回退同名静音版
       （webm 本身无音轨，沿用 sound 选项播它也不会出声）。 */
    /* P1（合并后细节）：心情视频补齐回退链——原静音版只探单个文件、失败就没视频；
       现在目标文件探活失败时串行回退到庆祝链的 expr-happy（皇冠套里 celebrate 的等价
       动画）；有声版在既有 snd→expr 回退之后同样续上这一环。 */
    var silentChain = ['expr-' + exprKey];
    if (exprKey !== 'happy') silentChain.push('expr-happy');
    if (withSound && voiceOn) tryCelebVideo(['snd-' + exprKey].concat(silentChain), { sound: true, ms: 10500 });
    else tryCelebVideo(silentChain, { loop: true, ms: 6500 });
  }
  /* ---------- 互动玩法第一批 Top 3（2026-11-18）：追鼠标+扑光标 / 点猫三级 / 拖链接喂猫 ----------
     猫的显示全部用生成的视频（William 2026-11-18 01:16 定）：游乐场态常驻主态是透明视频
     循环，视频文件不在时走 WebP 兜底。视频是整段渲染的：追鼠标时播走路循环、扑时
     播扑的一段、静止时播待机循环；表情不叠加在走路视频上（静止态才换表情视频）。
     取景规矩（2026-11-18 01:37 定）：所有视频整只猫完整入镜、四周留白边、不裁脚不裁尾；
     显示一律 object-fit:contain、容器按视频比例（见 .xm-video 与 .xm-play 规则），
     不得裁掉猫的任何部分。
     文件约定（public/xiaomaomao/media/，二进制媒体包不进仓库、部署时另放）：
     play-idle.webm（待机透明循环）、play-walk.webm（走路透明循环）、
     play-pounce.webm（扑透明一段）。window.XIAOMAOMAO_MEDIA.videos 可按名覆盖任意一条
     （演示页就这么指到同目录的透明 WebM）；被显式覆盖的地址视为可信、跳过 HEAD 探活
     （file:// 演示页发不出 HEAD，但 <video> 能直接播本地文件）。 */
  var PLAY_CLIPS = { idle: 'play-idle.webm', walk: 'play-walk.webm', pounce: 'play-pounce.webm' };
  var FAVORITE_ADDED_EVENT = 'navhub:favorite-added';
  var FEED_LINK_EVENT = 'navhub:feed-link';
  function playClipUrl(name) {
    try {
      var o = window.XIAOMAOMAO_MEDIA;
      if (o && o.videos && typeof o.videos['play-' + name] === 'string') {
        return { url: o.videos['play-' + name], trusted: true };
      }
    } catch (e) { /* 忽略 */ }
    return { url: MEDIA_BASE + PLAY_CLIPS[name], trusted: false };
  }
  var WALK_SEAM_LEAD = 0.35; /* B-03：走路循环近尾 0.35 秒时换路重播，交叉淡化盖住首尾跳变 */
  var clipA = null, clipB = null, clipVisible = null, clipCurrent = '', clipSeq = 0;
  var VIDEO_LOAD_TIMEOUT_MS = 8000; /* 视频首帧加载超时：8 秒不到首帧即判加载失败（C-03） */
  var videoLoadT = 0; /* 首帧看门狗定时器（C-03） */
  function ensureClipEls() {
    if (clipA) return;
    clipA = document.createElement('video');
    clipB = document.createElement('video');
    [clipA, clipB].forEach(function (v) {
      v.className = 'xm-video xm-clip';
      v.muted = true;
      v.loop = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.setAttribute('preload', 'auto');
      try { v.disablePictureInPicture = true; } catch (e) { /* 忽略 */ }
      stageEl.appendChild(v);
      /* 默认视频回退：解码出错即走兜底——idle 出错判死走 WebP，非 idle 出错回 idle
         （探活只验文件在不在，解码失败要靠 error 事件兜底；静态图已删，不回静态）。 */
      v.addEventListener('error', function () {
        if (clipVisible !== v || !clipCurrent) return;
        if (clipCurrent === 'idle') { markVideoDead('network'); showFallback('idle'); }
        else playClip('idle');
      });
      /* B-03：走路循环接缝——首帧侧脸闭眼、尾帧正脸睁眼张口，帧间差大，
         快播完时换路重播，用另一路从 0 交叉淡化盖住跳变；只管走路循环，不管待机/扑。 */
      v.addEventListener('timeupdate', function () {
        try {
          if (clipVisible !== v || !v.loop) return;
          if (clipCurrent === 'walk' && v.duration && v.duration - v.currentTime < WALK_SEAM_LEAD) {
            playClip('walk', { forceSwap: true });
          }
        } catch (e) { /* 忽略 */ }
      });
    });
    clipVisible = clipA;
  }
  /* 播一段游乐场视频：双视频交叉淡化（A/B 轮换，一段淡入、一段淡出）；loop 默认循环，
     扑的那一段传 {loop:false} 只播一次。视频路已死时直接走 WebP 兜底；文件不在时走
     WebP 兜底，不报错、不留白。 */
  function playClip(name, opts) {
    opts = opts || {};
    if (!PLAY_CLIPS[name]) name = 'idle';
    if (videoDead) {
      /* 判死可恢复：网络原因且超过重试窗口时清掉重探；能力原因永不自动重试 */
      if (videoDeadReason === 'network' && videoDeadAt && Date.now() - videoDeadAt > VIDEO_DEAD_RETRY_MS) clearVideoDead();
      else { showFallback(name); return; }
    }
    if (clipCurrent === name && clipVisible && !opts.forceSwap) {
      try {
        clipVisible.loop = opts.loop !== false;
        if (opts.loop === false) {
          clipVisible.currentTime = 0;
          var p0 = clipVisible.play();
          if (p0 && p0.catch) p0.catch(function () { /* 留首帧 */ });
        } else if (clipVisible.paused) {
          /* C-07：同名快路径——收起→唤回后视频已暂停，loop 循环段直接续播 */
          var p1 = clipVisible.play();
          if (p1 && p1.catch) p1.catch(function () { /* 留首帧 */ });
        }
      } catch (e) { /* 忽略 */ }
      /* C-03 补修（2026-11-18 接续）：快路径是同一路已加载的视频，首帧已在就不用挂
         加载态——否则收起→唤回后 xm-loading 永久残留（“加载中…”一直显示在播着的视频底下，
         p6 探针实测）；首帧未到（readyState < 2）时不动，等 markVideoReady/看门狗处理。 */
      if (clipVisible.readyState >= 2) { clearTimeout(videoLoadT); root.classList.remove('xm-loading'); }
      return;
    }
    ensureClipEls();
    var seq = ++clipSeq;
    var next = (clipVisible === clipA) ? clipB : clipA;
    var cur = clipVisible;
    /* B-03：接缝换路时旧路从上次暂停处（~2.45s）续播会跳变，先归零再 show。 */
    if (opts.forceSwap) { try { next.currentTime = 0; } catch (e) { /* 忽略 */ } }
    var resolved = playClipUrl(name);
    var show = function () {
      if (seq !== clipSeq) return;
      try {
        next.loop = opts.loop !== false;
        next.classList.add('xm-on');
        if (cur) cur.classList.remove('xm-on');
        clipVisible = next;
        clipCurrent = name;
        var p = next.play();
        if (p && p.catch) p.catch(function () { /* 自动播放被拦时留首帧 */ });
        markVideoReady(next, seq);
        /* C-03 看门狗：首帧 8 秒不到即判加载失败。readyState >= 2 时首帧已在，
           直接放过；超时时 idle 判死走兜底，非 idle 回 idle。 */
        clearTimeout(videoLoadT);
        if (next.readyState >= 2) { /* 首帧已在，不布看门狗 */ }
        else {
          videoLoadT = window.setTimeout(function () {
            if (seq !== clipSeq || next.readyState >= 2) return;
            if (name === 'idle') { markVideoDead('network'); showFallback('idle'); }
            else playClip('idle');
          }, VIDEO_LOAD_TIMEOUT_MS);
        }
        /* 淡化结束后停掉旧一路：只留可见的一路解码，省电。300ms 略长于 .xm-clip
           的 .28s 透明度过渡，淡化期间两路短暂同播是刻意的；seq 守卫防后一次
           切换把刚换回来的路误停（A→B→A 时旧定时器不再碰已可见的路）。 */
        if (cur && cur !== next) {
          window.setTimeout(function () {
            try {
              if (seq === clipSeq && clipVisible !== cur && !cur.paused) cur.pause();
            } catch (e) { /* 忽略 */ }
          }, 300);
        }
      } catch (e) { /* 无头/受限环境静默 */ }
    };
    if (next.src && resolved.url && next.src.indexOf(resolved.url) !== -1) { show(); return; }
    if (resolved.trusted) {
      next.src = resolved.url;
      next.addEventListener('error', function onErr() {
        next.removeEventListener('error', onErr);
        if (seq !== clipSeq) return;
        if (name === 'idle') { markVideoDead('network'); showFallback('idle'); }
        else playClip('idle');
      });
      show();
      return;
    }
    probeMedia(resolved.url).then(function (ok) {
      if (seq !== clipSeq) return;
      if (!ok) {
        if (name !== 'idle') { playClip('idle'); return; }
        markVideoDead('network');
        showFallback('idle');
        return;
      }
      next.src = resolved.url;
      show();
    });
  }
  function stopClips() {
    clipSeq++;
    clearTimeout(videoLoadT); /* 停播也清看门狗（C-03） */
    root.classList.remove('xm-loading'); /* 加载态摘掉（C-03） */
    hideFallback(); /* 兜底图也一起藏（自改形象/收起/换态时不留 WebP/GIF） */
    if (stillImg) stillImg.classList.remove('xm-on'); /* B-01：静态首帧也一起藏 */
    root.classList.remove('xm-has-video'); /* 视频停了，透明舞台摘掉（静态姿势图已删，不回静态） */
    [clipA, clipB].forEach(function (v) {
      if (!v) return;
      try { v.pause(); } catch (e) { /* 忽略 */ }
      v.classList.remove('xm-on');
    });
    clipVisible = null;
    clipCurrent = '';
  }

  /* ---------- 默认显示走透明视频（2026-11-18） ----------
     待机播 idle 透明循环；行走/散步沿用游乐场 walk 循环（追/漫步已调 playClip('walk')）。
     检测办法：canPlayType('video/webm; codecs="vp9"')——能解 VP9 WebM 的浏览器都解得动
     它的 alpha 面（Chrome/Edge/Firefox）；Safari 不认 VP9（返回空串）→ 视频路判死，
     走动画 WebP 兜底（2026-11-18 删静态图，不再回静态）。
     这是编解码支持检测，不是逐像素 alpha 探针；真机 Safari 未覆盖。
     文件不在/加载失败/解码出错 → playClip 探活失败或 error 事件 → 视频路判死 → WebP 兜底。 */
  function supportsVp9Alpha() {
    try {
      var v = document.createElement('video');
      return !!(v && v.canPlayType && v.canPlayType('video/webm; codecs="vp9"'));
    } catch (e) { return false; }
  }
  var ambientVideo = false; /* 默认视频在播 */
  function ambientEligible() {
    return !reducedMotion && !avatarPick && supportsVp9Alpha() &&
      !root.classList.contains('xm-closed');
  }
  function startAmbientVideo() {
    if (avatarPick || root.classList.contains('xm-closed')) return false;
    if (reducedMotion) { ambientVideo = true; showStillFrame('idle'); return true; }
    if (!supportsVp9Alpha()) {
      /* Safari 不认 VP9：视频路直接判死，走动画 WebP 兜底 */
      markVideoDead('capability');
      ambientVideo = true;
      showFallback('idle');
      return true;
    }
    ambientVideo = true;
    root.classList.add('xm-loading'); /* C-03：视频路起播即挂加载态，首帧就绪/兜底时摘 */
    playClip('idle');
    return true;
  }
  function stopAmbientVideo() {
    ambientVideo = false;
    if (!play.on) stopClips();
  }
  /* 视频暂停/续播（贴边/离屏/切后台/收起时省电）：只动当前可见的那一路；
     兜底图是 <img> 动图，display:none 即暂停；续播只在游乐场或默认视频在播时才续，
     兜底态不无故开播。 */
  function pauseClips() {
    try { if (clipVisible && !clipVisible.paused) clipVisible.pause(); } catch (e) { /* 忽略 */ }
    try { if (fallbackImg) fallbackImg.classList.remove('xm-on'); } catch (e) { /* 忽略 */ }
  }
  function resumeClips() {
    try {
      if (clipVisible && clipVisible.paused && clipCurrent && (play.on || ambientVideo) && !document.hidden) {
        var p = clipVisible.play();
        if (p && p.catch) p.catch(function () { /* 留首帧 */ });
      }
    } catch (e) { /* 忽略 */ }
    try {
      if (fallbackCurrent && !fallbackDead && (play.on || ambientVideo) && !document.hidden && fallbackImg) fallbackImg.classList.add('xm-on');
    } catch (e) { /* 忽略 */ }
  }
  /* 视频有首帧才算真在播：透明类（舞台透明+藏兜底图）只在首帧就绪后挂，
     之前是默认白圆舞台，不闪破图；error/停播时由 stopClips 摘掉。 */
  function videoAlphaLooksBad(v) {
    /* C-05：首帧四角 alpha 采样——96×96 canvas 上画一帧，四角 alpha 都 > 16
       说明底色不透明（丢了透明底）；取不到上下文/跨域受限时返回 false（不误杀）。 */
    try {
      var c = document.createElement('canvas');
      c.width = 96; c.height = 96;
      var ctx = c.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(v, 0, 0, 96, 96);
      var corners = [[2, 2], [93, 2], [2, 93], [93, 93]];
      for (var i = 0; i < corners.length; i++) {
        var a = ctx.getImageData(corners[i][0], corners[i][1], 1, 1).data[3];
        if (a <= 16) return false; /* 有一个角透明即底还在 */
      }
      return true;
    } catch (e) { return false; }
  }
  function markVideoReady(v, seq) {
    var on = function () {
      clearTimeout(videoLoadT); /* 首帧到了，看门狗撤下（C-03） */
      root.classList.remove('xm-loading'); /* 加载态摘掉（C-03） */
      if (seq === clipSeq && clipVisible === v) {
        /* C-03 补修（2026-11-18 接续）：看门狗已判死时迟到的首帧不再把兜底换回视频——
           否则“判死却在播”，videoDead 仍 true 而视频已上台；判死后恢复走既有路径
           （60 秒网络重试/唤回 revive/hideCat 30 秒定时器），不另开新路。 */
        if (videoDead) return;
        /* C-05 补修（2026-11-18 接续）：readyState >= 2 / loadeddata 时 drawImage
           仍可能抓到未解出的空帧（角全透明），不透明视频会漏网（p5 探针三轮 2 过 1 败）。
           有 requestVideoFrameCallback 时在首个呈现帧上采样（1 帧内），1 秒未呈现
           则直接采样兜底（自动播放被拦时不至于永远不上台）；无 rVFC 时直接采样（旧行为）。 */
        if (v.requestVideoFrameCallback) {
          var done = false;
          try {
            v.requestVideoFrameCallback(function () { if (!done) { done = true; sample(); } });
          } catch (e) { sample(); return; }
          window.setTimeout(function () { if (!done) { done = true; sample(); } }, 1000);
          return;
        }
        sample();
      }
    };
    /* 首帧采样（C-05）：四个角都不透明说明丢了透明底，判死走 WebP；否则挂透明类上台。
       sampled 保证只采一次（rVFC 回调与 1 秒兜底定时器至多一个生效）。 */
    var sampled = false;
    var sample = function () {
      if (sampled || seq !== clipSeq || clipVisible !== v) return;
      sampled = true;
      if (videoDead) return;
      if (videoAlphaLooksBad(v)) { markVideoDead('alpha'); showFallback(clipCurrent || 'idle'); return; }
      hideFallback(); root.classList.add('xm-has-video');
    };
    try {
      if (v.readyState >= 2) on();
      else v.addEventListener('loadeddata', on, { once: true });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 删静态图后的兜底链（2026-11-18，William 点选 WebP） ----------
     视频播不了（Safari 不认 VP9 / 文件缺失 / 解码失败）→ 动画 WebP；
     WebP 也失败 → GIF；GIF 也失败 → 猫直接藏起来（hideCat），绝不回静态图。
     三段状态（idle/walk/pounce）共用这条链：playClip 在视频路已死时直接改走这里。
     兜底文件约定（public/xiaomaomao/media/，二进制不进仓库、部署时另放）：
     play-{idle,walk,pounce}.webp（动画 WebP，v2 已验透明）/
     play-{idle,walk,pounce}.gif（更老 Safari 的第二兜底）。
     window.XIAOMAOMAO_MEDIA.fallbacks 可按名覆盖任意一条的地址（与 videos 同款信任规则）。 */
  var PLAY_FALLBACKS = { idle: 'play-idle.webp', walk: 'play-walk.webp', pounce: 'play-pounce.webp' };
  var PLAY_FALLBACK_GIFS = { idle: 'play-idle.gif', walk: 'play-walk.gif', pounce: 'play-pounce.gif' };
  var videoDead = false; /* 视频路已死：VP9 不支持或 idle 探活/解码失败，此后 playClip 直接走兜底 */
  var VIDEO_DEAD_RETRY_MS = 60000; /* 视频路判死后 60 秒才允许自动重试（C-01） */
  var videoDeadAt = 0; /* 判死的时间戳（毫秒） */
  var videoDeadReason = ''; /* 判死原因：'capability'（VP9 不支持，永不重试）|'network'（探活/加载/解码失败，可重试）|'alpha'（四角采样判死，不自动重试） */
  function markVideoDead(reason) {
    videoDead = true;
    videoDeadAt = Date.now();
    videoDeadReason = reason || 'network';
  }
  function clearVideoDead() {
    videoDead = false;
    videoDeadAt = 0;
    videoDeadReason = '';
    /* 判死期间记下的阴性探活一并清掉，下次重试真实探活 */
    mediaProbeFailedAt = {};
  }
  function reviveVideoOnWake() {
    /* 用户亲手唤回/点猫：网络原因判死的视频路立即重试一次（不等 60 秒窗口） */
    if (!videoDead || videoDeadReason !== 'network') return false;
    clearVideoDead();
    return true;
  }
  var fallbackImg = null, fallbackCurrent = '', fallbackTier = '', fallbackDead = false;
  function fallbackUrl(name, tier) {
    try {
      var o = window.XIAOMAOMAO_MEDIA;
      if (o && o.fallbacks && typeof o.fallbacks['play-' + name] === 'string') return o.fallbacks['play-' + name];
    } catch (e) { /* 忽略 */ }
    return MEDIA_BASE + (tier === 'gif' ? PLAY_FALLBACK_GIFS[name] : PLAY_FALLBACKS[name]);
  }
  function ensureFallbackImg() {
    if (fallbackImg) return;
    fallbackImg = document.createElement('img');
    fallbackImg.className = 'xm-fallback';
    fallbackImg.setAttribute('aria-hidden', 'true');
    fallbackImg.alt = '';
    fallbackImg.addEventListener('error', function () {
      /* WebP 失败 → GIF；GIF 也失败 → 藏猫。只对当前在播的兜底生效。 */
      if (!fallbackCurrent || fallbackDead) return;
      if (fallbackTier === 'webp') {
        fallbackTier = 'gif';
        fallbackImg.src = fallbackUrl(fallbackCurrent, 'gif');
      } else {
        fallbackDead = true;
        hideCat();
      }
    });
    stageEl.appendChild(fallbackImg);
  }
  var HIDE_CAT_RETRY_MS = 30000; /* 兜底全灭后 30 秒自动重试一次视频路（C-06） */
  function hideCat() {
    /* 兜底全灭：不再直接藏猫——收成圆标（用户可点圆标唤回），控制台留可定位的错误，
       30 秒后在圆标态自动重试一次视频路；自改形象用户不受影响（只在兜底链里调）。 */
    console.warn('[xiaomaomao] all media fallbacks failed, collapsing to tab and retrying in 30s');
    root.classList.remove('xm-loading');
    stopClips();
    collapseCat();
    window.setTimeout(function () {
      if (!root.classList.contains('xm-closed')) return; /* 已展开就不打扰 */
      /* C-06 补修（2026-11-18 接续）：圆标态下 startAmbientVideo 会因 xm-closed
         直接返回，旧写法只清判死、从不真正重探——重试是空操作（p3 探针两轮实测：
         35 秒内日志里只有初始探活那 1 个 HEAD）。改为先真实探活一次：通了才清判死
         （下次唤回即可播视频），不通则保持判死；能力/alpha 原因不自动重试。 */
      if (videoDeadReason !== 'network') return;
      probeMedia(MEDIA_BASE + PLAY_CLIPS.idle).then(function (ok) {
        if (!root.classList.contains('xm-closed')) return;
        if (ok) { clearVideoDead(); fallbackDead = false; }
      });
    }, HIDE_CAT_RETRY_MS);
  }
  function showFallback(name) {
    if (avatarPick || fallbackDead) return false;
    if (!PLAY_FALLBACKS[name]) name = 'idle';
    stopClips();
    ensureFallbackImg();
    fallbackCurrent = name;
    fallbackTier = 'webp';
    fallbackImg.src = fallbackUrl(name, 'webp');
    fallbackImg.classList.add('xm-on');
    root.classList.add('xm-has-fallback');
    return true;
  }
  function hideFallback() {
    if (fallbackImg) fallbackImg.classList.remove('xm-on');
    root.classList.remove('xm-has-fallback');
    fallbackCurrent = '';
  }
  /* B-01：减动效静态首帧——prefers-reduced-motion 时不播视频，离屏加载 WebP
     兜底图的第 0 帧画到 canvas 再以 PNG 显示（真冻结，不推进动画时间线、
     不建 video 元素、不耗解码）；WebP 冻不住 → 同款冻结 GIF → 再不行藏猫。 */
  var stillImg = null;
  function showStillFrame(name, tier) {
    tier = tier || 'webp';
    var probe = new Image();
    probe.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = probe.naturalWidth || probe.width || 1;
        c.height = probe.naturalHeight || probe.height || 1;
        var ctx = c.getContext('2d');
        if (!ctx) { hideCat(); return; }
        ctx.drawImage(probe, 0, 0);
        var url = c.toDataURL('image/png');
        if (!stillImg) {
          stillImg = document.createElement('img');
          stillImg.className = 'xm-still';
          stillImg.setAttribute('aria-hidden', 'true');
          stillImg.alt = '';
          stageEl.appendChild(stillImg);
        }
        stillImg.src = url;
        stillImg.classList.add('xm-on');
        root.classList.add('xm-has-video'); /* 静态首帧也是真猫，舞台透明、不留白圆 */
      } catch (e) { hideCat(); }
    };
    probe.onerror = function () {
      if (tier === 'webp') showStillFrame(name, 'gif');
      else hideCat();
    };
    probe.src = fallbackUrl(name, tier);
    return true;
  }

  /* ---------- 追鼠标 + 扑光标（Top 1） ----------
     状态机：idle（待机循环）→ chase（走路循环追光标）→ pounce（扑的一段，限速触发）
     → catch（挠痒→打哈欠→睡着三段收尾，oneko 同款）→ idle。光标 8 秒不动时猫自己
     满屏散步（随机挑点走过去）；20 秒没人理就打哈欠睡着（走现有 goSleep）。
     诚实边界：挠痒/打哈欠/睡着三段收尾当前用待机视频 + 气泡实现（静态姿势已删），专用视频后补；
     猫只能在页面视口里走，上不了桌面。 */
  var play = { on: false, mode: 'idle', tx: 0, ty: 0, raf: 0, lastPtr: 0, px: 0, py: 0, pv: 0, wanderT: 0, sleepT: 0, _lastTick: 0 };
  var PLAY_CHASE_SPEED = 260; /* px/s */
  var PLAY_POUNCE_SPEED = 700; /* px/s：扑的那一下冲刺 */
  var PLAY_CATCH_DIST = 90;
  var PLAY_POUNCE_DIST = 240;
  var PLAY_POUNCE_VELOCITY = 900; /* px/s：光标甩得快才扑 */
  var PLAY_POUNCE_MS = 5000; /* B-02：扑收尾等 5 秒——扑视频抽帧时序：1s 下蹲、4s 扑跃姿势、5s 坐回；旧 1600ms 只播到 0.81s 就切走 */
  var PLAY_WANDER_AFTER = 8000;
  var PLAY_SLEEP_AFTER = 20000;
  function playRootRect() { return root.getBoundingClientRect(); }
  function playSetPos(left, top) {
    var r = playRootRect();
    var maxL = Math.max(4, window.innerWidth - (r.width || 112) - 4);
    var maxT = Math.max(4, window.innerHeight - (r.height || 112) - 4);
    root.style.left = Math.max(4, Math.min(maxL, left)) + 'px';
    root.style.top = Math.max(4, Math.min(maxT, top)) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }
  function playCatCenter() {
    var r = playRootRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width || 112, h: r.height || 112 };
  }
  /* 猫绝不挡按钮：落点检查——把猫根节点临时设 pointer-events:none，用
     elementFromPoint 看落点中心与四角下面是什么；是可点元素（且不在挂件内）
     就按九宫格找空位；实在没空位就原地不动。 */
  var PLAY_AVOID_SELECTOR = 'a,button,input,select,textarea,[role="button"],[tabindex]';
  function playPointBlocked(x, y) {
    var prev = root.style.pointerEvents;
    root.style.pointerEvents = 'none';
    var pts = [[x, y], [x - 40, y - 40], [x + 40, y - 40], [x - 40, y + 40], [x + 40, y + 40]];
    var blocked = false;
    try {
      for (var i = 0; i < pts.length && !blocked; i++) {
        var el = document.elementFromPoint(pts[i][0], pts[i][1]);
        if (!el || root.contains(el)) continue;
        if (el.closest && el.closest(PLAY_AVOID_SELECTOR)) blocked = true;
      }
    } catch (e) { /* 忽略 */ }
    root.style.pointerEvents = prev;
    return blocked;
  }
  function playFindFreeSpot(x, y) {
    var tries = [[0, 0], [0, -70], [0, 70], [-70, 0], [70, 0], [-70, -70], [70, -70], [-70, 70], [70, 70]];
    for (var i = 0; i < tries.length; i++) {
      var nx = x + tries[i][0], ny = y + tries[i][1];
      if (nx < 60 || ny < 60 || nx > window.innerWidth - 60 || ny > window.innerHeight - 60) continue;
      if (!playPointBlocked(nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }
  var playCatchTimers = [];
  function playCancelCatch() {
    for (var i = 0; i < playCatchTimers.length; i++) window.clearTimeout(playCatchTimers[i]);
    playCatchTimers = [];
  }
  /* 扑的收尾定时器单独放（不进 playCatchTimers）：playOnPointerMove 每来一次
     pointermove 就调 playCancelCatch()，放进去会被下一移动清掉，猫就永远卡在扑的姿势。
     2026-11-18 审计抓到：扑的视频只露 0.25 秒就被 playTick 的到点分支切成抓——
     猫以 700px/s 扑过去，150px 的距离 0.25 秒就到；收尾定时器按扑视频弧线取 5 秒。 */
  var pouncePlayingFn = null; /* B-02：等扑视频真正开播才起算收尾定时器的监听 */
  function playCancelPounce() {
    if (play.pounceT) { window.clearTimeout(play.pounceT); play.pounceT = 0; }
    if (pouncePlayingFn) {
      [clipA, clipB].forEach(function (v) { try { if (v) v.removeEventListener('playing', pouncePlayingFn); } catch (e) { /* 忽略 */ } });
      pouncePlayingFn = null;
    }
  }
  /* 抓到光标的三段收尾（oneko 同款）：挠痒 → 打哈欠 → 睡着。专用视频后补，
     当前用待机视频 + 姿势 + 气泡实现，不编新视频。 */
  function playCatch() {
    if (play.mode === 'catch') return;
    play.mode = 'catch';
    playCancelCatch();
    playClip('idle');
    happyBounce();
    burst(3);
    showEmo('♪');
    setPose('making');
    showBubble('抓到啦，嘿嘿～', true);
    playCatchTimers.push(window.setTimeout(function () {
      if (!play.on || sleeping) return;
      setPose('idle');
      showEmo('z');
      showBubble('哈～有点困了', false);
    }, 1800));
    playCatchTimers.push(window.setTimeout(function () {
      if (!play.on || sleeping) return;
      goSleep();
      play.mode = 'idle';
      playClip('idle');
    }, 4800));
  }
  function playPounce() {
    if (play.mode === 'pounce') return;
    play.mode = 'pounce';
    playCancelCatch();
    playCancelPounce();
    playClip('pounce', { loop: false });
    showEmo('！');
    showBubble('看我扑！', false);
    /* B-02：收尾定时器从扑视频真正开播才起算——playClip 要先探活再加载，
       从调 playPounce 起算会把 1–2 秒加载时间也算进去，视频只播到 3.4 秒
       就被切走，到不了 4 秒的扑跃姿势。playing 事件只认扑的那一路。
       兜底：视频若加载失败、playing 一直不响，8 秒后仍收尾，不卡在扑态。 */
    pouncePlayingFn = function (ev) {
      var v = ev.target;
      if (!v || (v.currentSrc || v.src || '').indexOf('play-pounce') === -1) return;
      playCancelPounce(); /* 先摘监听并清兜底定时器，再起真正的收尾定时器 */
      play.pounceT = window.setTimeout(function () {
        if (!play.on || sleeping || play.mode !== 'pounce') return;
        play.mode = 'idle';
        playCatch();
      }, PLAY_POUNCE_MS);
    };
    [clipA, clipB].forEach(function (v) { if (v) v.addEventListener('playing', pouncePlayingFn); });
    play.pounceT = window.setTimeout(function () {
      if (!play.on || sleeping || play.mode !== 'pounce') return;
      play.mode = 'idle';
      playCatch();
    }, PLAY_POUNCE_MS + 3000);
  }
  function playScheduleWander() {
    window.clearTimeout(play.wanderT);
    window.clearTimeout(play.sleepT);
    play.wanderT = window.setTimeout(function () {
      if (!play.on || sleeping || root.classList.contains('xm-open')) return;
      var x = 80 + Math.random() * Math.max(40, window.innerWidth - 160);
      var y = 80 + Math.random() * Math.max(40, window.innerHeight - 160);
      var spot = playFindFreeSpot(x, y);
      if (!spot) return;
      play.tx = spot.x;
      play.ty = spot.y;
      play.mode = 'wander';
      playClip('walk');
    }, PLAY_WANDER_AFTER);
    play.sleepT = window.setTimeout(function () {
      if (!play.on || sleeping || root.classList.contains('xm-open')) return;
      setPose('idle');
      showBubble('哈～有点困了，我先眯一会儿', false);
      goSleep();
      play.mode = 'idle';
      playClip('idle');
    }, PLAY_SLEEP_AFTER);
  }
  function playTick(now) {
    if (!play.on || sleeping) { play.raf = 0; return; }
    play.raf = requestAnimationFrame(playTick);
    var dt = play._lastTick ? Math.min(100, Math.max(0, now - play._lastTick)) : 16;
    play._lastTick = now;
    /* C-11：面板开着猫站住别动——循环继续、位置不动，关面板自动续跑；
       不杀循环，免得关面板后无重启源。 */
    if (root.classList.contains('xm-open')) return;
    if (play.mode !== 'chase' && play.mode !== 'wander' && play.mode !== 'pounce') return;
    var speed = play.mode === 'pounce' ? PLAY_POUNCE_SPEED : PLAY_CHASE_SPEED;
    var c = playCatCenter();
    var dx = play.tx - c.x, dy = play.ty - c.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 10) {
      if (play.mode === 'chase') playCatch();
      else if (play.mode === 'wander') { play.mode = 'idle'; playClip('idle'); playScheduleWander(); }
      else if (play.mode === 'pounce') {
        /* 扑到了：停住，等 5 秒的扑定时器收尾再抓——别立刻切抓，
           否则扑视频只露 0.25 秒（700px/s 扑 150px 只要 0.25 秒），用户根本看不到扑。 */
        return;
      }
      return;
    }
    var step = speed * dt / 1000;
    var nx = c.x + (dx / dist) * Math.min(step, dist);
    var ny = c.y + (dy / dist) * Math.min(step, dist);
    playSetPos(nx - c.w / 2, ny - c.h / 2);
  }
  function playEnsureLoop() {
    if (!play.raf) {
      play._lastTick = 0;
      play.raf = requestAnimationFrame(playTick);
    }
  }
  function playOnPointerMove(ev) {
    if (!play.on) return;
    if (sleeping) wakeUp(false);
    markActive(); /* 玩猫也是活动：别让 3 分钟全局睡眠半路把猫睡过去 */
    var now = Date.now();
    var nx = ev.clientX, ny = ev.clientY;
    if (play.px || play.py) {
      var d = Math.sqrt((nx - play.px) * (nx - play.px) + (ny - play.py) * (ny - play.py));
      var dt = Math.max(1, now - play.lastPtr);
      play.pv = (d / dt) * 1000;
    }
    play.px = nx;
    play.py = ny;
    play.lastPtr = now;
    if (drag && drag.moved) return;
    if (root.classList.contains('xm-open') || root.classList.contains('xm-closed')) return;
    playCancelCatch();
    var c = playCatCenter();
    var dist = Math.sqrt((nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y));
    var spot = playFindFreeSpot(nx, ny);
    play.tx = spot ? spot.x : nx;
    play.ty = spot ? spot.y : ny;
    if (play.mode === 'pounce') { playEnsureLoop(); playScheduleWander(); return; }
    if (dist <= PLAY_CATCH_DIST) {
      if (play.mode === 'chase') playCatch();
    } else if (play.pv > PLAY_POUNCE_VELOCITY && dist < PLAY_POUNCE_DIST) {
      playPounce();
    } else {
      if (play.mode !== 'chase') { play.mode = 'chase'; playClip('walk'); }
    }
    playEnsureLoop();
    playScheduleWander();
  }
  document.addEventListener('pointermove', playOnPointerMove, { passive: true });
  /* 游乐场开关：开 = 猫进游乐场态（透明视频常驻、追鼠标），关 = 回角落静态态。
     减动效用户不开游乐场；开时先弹回贴边/唤回收起态；漫步不写 store.pos（不覆盖
     用户拖过的位置），关时按 store.pos 或默认右下角归位。 */
  function setPlayMode(on) {
    if (reducedMotion) on = false;
    if (play.on === on) return;
    play.on = on;
    store.play = on;
    persist();
    var btn = root.querySelector('.xm-play-btn');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      if (docked) undock();
      if (root.classList.contains('xm-closed')) root.classList.remove('xm-closed');
      /* A P1-3：亲手开游乐场 = 明确要猫出来——清掉持久收起并写盘，
         否则刷新后开机自启把收起读回来，收起粘不住。 */
      if (store.closed) { store.closed = false; store.closedAt = 0; persist(); }
      root.classList.remove('xm-parked');
      root.classList.add('xm-play');
      /* C-12：睡眠态唤醒时可能补发了排队的升级庆祝——已补发就不再出
         通用“好耶”招呼，庆祝优先（庆祝自带气泡）。 */
      var celebrated = false;
      if (sleeping) celebrated = wakeUp(false);
      var r = playRootRect();
      playSetPos(r.left, r.top);
      play.mode = 'idle';
      playClip('idle');
      playEnsureLoop();
      playScheduleWander();
      if (!celebrated) showBubble('好耶，陪我玩吧～我会追着你的鼠标跑！', true);
    } else {
      playCancelCatch();
      playCancelPounce();
      window.clearTimeout(play.wanderT);
      window.clearTimeout(play.sleepT);
      if (play.raf) { try { cancelAnimationFrame(play.raf); } catch (e) { /* 忽略 */ } play.raf = 0; }
      /* 游乐场关掉回默认视频（不是回静态）：默认视频开不起来才停视频 */
      if (!startAmbientVideo()) stopClips();
      root.classList.remove('xm-play');
      root.classList.remove('xm-eat-ready');
      if (store.pos) applySavedPos();
      else { root.style.left = ''; root.style.top = ''; root.style.right = ''; root.style.bottom = ''; }
      alignPanel();
      showBubble('好啦，我回角落待着～', false);
    }
  }

  /* ---------- 拖链接喂猫收藏（Top 3，本站独有玩法） ----------
     把页面上的链接拖到猫身上 = 按真实收藏接口收进导航站。流程：
     dragstart 记下被拖的 <a href> → 拖到猫身上时亮圈待命 → drop 时先发可取消的
     navhub:feed-link 事件（页面可接手；没人接手才走默认流程）→ 按 URL 在导航数据里
     找 siteId（/api/home/navigation 懒加载一次、本会话缓存）→ POST /api/hub/favorites
     （走 BFF 代理：浏览器侧只带 X-Navhub-Anon-Id，签名由服务端补；中枢回 {favorite,
     existed}，201 新收藏、200 已存在）。身份沿用站内同一套键（navhub.userId 优先、
     navhub.anonId 其次）；不自己造身份，没身份就实话实说等页面加载完。链接不在收录
     里、接口报错、已收藏过，全部如实报，绝不假装收藏成功。收藏成功后发
     navhub:favorite-added（成长档按统一规则落账，挂件本身不写成长数据）。 */
  var dragLink = null;
  var feedBusy = false;
  /* C-09（2026-11-18）：navCache 阴性结果 60 秒过期——导航接口抖动一次不再禁用整会话喂猫；
     阳性结果仍整会话缓存；拉取进行中不重复发请求。 */
  var navCache = null;       // Promise<导航数据|null>
  var navCacheAt = 0;        // 上次拉取开始时间（Date.now）
  var navCacheEmpty = false; // 上次拉取结果是否为空
  function navCacheIsStale() {
    return !!navCache && navCacheEmpty && (Date.now() - navCacheAt > NAV_CACHE_NEGATIVE_TTL_MS);
  }
  document.addEventListener('dragstart', function (ev) {
    dragLink = null;
    try {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (a && a.href) dragLink = { url: a.href, title: (a.textContent || a.href).trim().slice(0, 60) || a.href };
    } catch (e) { dragLink = null; }
  }, true);
  document.addEventListener('dragend', function () {
    dragLink = null;
    root.classList.remove('xm-eat-ready');
  });
  function feedUrlKey(u) {
    try {
      var x = new URL(u);
      return (x.origin + x.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch (e) {
      return String(u || '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    }
  }
  function feedFindSiteId(url) {
    if (!navCache || navCacheIsStale()) {
      navCacheAt = Date.now();
      navCacheEmpty = false;
      /* 导航拉取同样 15 秒超时：否则挂起时 promise 永不落定，60 秒过期逻辑等不到阴性结果。 */
      navCache = fetchWithTimeoutAbort('/api/home/navigation', { credentials: 'same-origin' }, REQUEST_TIMEOUT_MS)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (data) { navCacheEmpty = !data; return data; });
    }
    return navCache.then(function (data) {
      if (!data || !Array.isArray(data.navigationItems)) return { found: false, noData: true };
      var want = feedUrlKey(url);
      var queue = data.navigationItems.slice();
      while (queue.length) {
        var it = queue.shift();
        if (!it) continue;
        if (it.href && feedUrlKey(it.href) === want && it.id) return { found: true, siteId: it.id, title: it.title || '' };
        if (Array.isArray(it.subCategories)) queue.push.apply(queue, it.subCategories);
        if (Array.isArray(it.items)) queue.push.apply(queue, it.items);
        if (Array.isArray(it.children)) queue.push.apply(queue, it.children);
      }
      return { found: false, noData: false };
    });
  }
  function feedLink(link) {
    if (!link || !link.url || feedBusy) return;
    feedBusy = true;
    root.classList.remove('xm-eat-ready');
    var handled = false;
    try {
      var ev = new CustomEvent(FEED_LINK_EVENT, { cancelable: true, detail: { url: link.url, title: link.title || link.url } });
      window.dispatchEvent(ev);
      handled = ev.defaultPrevented;
    } catch (e) { handled = false; }
    if (handled) {
      feedBusy = false;
      showBubble('好嘞，这条交给页面处理啦～', false);
      return;
    }
    var identity = null;
    try {
      identity = window.localStorage.getItem('navhub.userId') || window.localStorage.getItem('navhub.anonId');
    } catch (e) { identity = null; }
    if (!identity) {
      feedBusy = false;
      showEmo('？');
      showBubble('我的身份还没生成，等页面加载完再喂我～', false);
      return;
    }
    playClip('pounce', { loop: false });
    showBubble('啊呜……让我嚼一嚼这条链接～', false);
    feedFindSiteId(link.url).then(function (res) {
      if (!res.found) {
        feedBusy = false;
        showEmo('？');
        showBubble(res.noData ? '导航数据刚才没接通，稍后再喂我一次试试～' : '这条链接不在收录里，猫吃不到——先用站内搜索把它找出来吧', false);
        playClip('idle');
        return;
      }
      return window.fetch('/api/hub/favorites', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Navhub-Anon-Id': identity },
        body: JSON.stringify({ siteId: res.siteId })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
      }).then(function (out) {
        feedBusy = false;
        var ok = (out.status === 200 || out.status === 201) && out.body && out.body.favorite;
        var already = ok && out.body.existed === true;
        if (ok) {
          happyBounce();
          burst(6);
          showEmo('♥');
          setPose('milestone');
          showBubble(already ? '这条已经在你的收藏里啦，不用再喂一遍～' : '啊呜～「' + (res.title || link.title || link.url) + '」已收进你的收藏！', true);
          try {
            window.dispatchEvent(new CustomEvent(FAVORITE_ADDED_EVENT, { detail: { siteId: res.siteId } }));
          } catch (e) { /* 忽略 */ }
          window.setTimeout(function () { if (currentPose === 'milestone' && !sleeping) setPose('main'); }, 2600);
        } else {
          showEmo('？');
          showBubble('收藏接口现在不让喂（' + (out.body && (out.body.error || out.body.message) ? String(out.body.error || out.body.message).slice(0, 40) : 'HTTP ' + out.status) + '），再试一次看看', false);
        }
        playClip('idle');
      });
    }).catch(function () {
      feedBusy = false;
      showEmo('？');
      showBubble('收藏接口现在连不上，再试一次看看', false);
      playClip('idle');
    });
  }
  stageEl.addEventListener('dragover', function (ev) {
    if (!dragLink) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) { /* 忽略 */ }
    root.classList.add('xm-eat-ready');
  });
  stageEl.addEventListener('dragleave', function () {
    root.classList.remove('xm-eat-ready');
  });
  stageEl.addEventListener('drop', function (ev) {
    var link = dragLink;
    if (!link) {
      try {
        var u = (ev.dataTransfer && (ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain'))) || '';
        if (u) link = { url: u.split('\n')[0].trim(), title: u.split('\n')[0].trim() };
      } catch (e) { /* 忽略 */ }
    }
    if (!link || !link.url) return;
    ev.preventDefault();
    dragLink = null;
    markActive();
    feedLink(link);
  });
  /* 演示页/外部集成句柄（只读开关 + 状态，不碰挂件内部状态机之外的东西） */
  try {
    window.XIAOMAOMAO = window.XIAOMAOMAO || {};
    window.XIAOMAOMAO.togglePlay = function (on) { setPlayMode(typeof on === 'boolean' ? on : !play.on); return play.on; };
    window.XIAOMAOMAO.playing = function () { return play.on; };
    window.XIAOMAOMAO.feedLink = function (url, title) { feedLink({ url: url, title: title || url }); };
  } catch (e) { /* 忽略 */ }

  /* v8：离屏/切后台停播——猫滚出视口就暂停，切到别的标签页直接收视频（声音版尤其不许在后台响）
     默认视频同款：离屏/切后台暂停当前那一路，回来再续播（静态态不无故开播）。 */
  try {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) {
            if (videoEl) stopCelebVideo(); /* v8 复审返工：离屏直接移除，别让暂停定格盖住后面的兜底图 */
            pauseClips();
          } else resumeClips();
        }
      }, { threshold: 0.05 }).observe(stageEl);
    }
  } catch (e) { /* 老环境无 IO：靠 9 秒兜底收尾 */ }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { stopCelebVideo(); pauseClips(); } else resumeClips(); });

  /* ---------- 气泡（打字机） ---------- */
  var typeTimer = null, bubbleHideTimer = null;
  function showBubble(text, speakIt) {
    /* P1-1：页内输入聚焦期间不冒新气泡——自动招呼/提示/庆祝一律抑制；
       用户主动操作（点猫/摸猫/喂食/唤回）发生时焦点不在页内输入框上，
       userTyping 为 false，不受影响。 */
    if (userTyping) return;
    hideControls(); /* v7：气泡与悬浮坞互斥——猫说话时坞先退场，不许两样东西一起围着猫 */
    if (root.classList.contains('xm-open')) return;
    window.clearTimeout(bubbleHideTimer);
    window.clearInterval(typeTimer);
    bubbleEl.classList.add('xm-show');
    if (reducedMotion || !text) {
      bubbleEl.textContent = text || '';
    } else {
      bubbleEl.textContent = '';
      var idx = 0;
      typeTimer = window.setInterval(function () {
        idx += 1;
        bubbleEl.textContent = text.slice(0, idx);
        if (idx >= text.length) window.clearInterval(typeTimer);
      }, 26);
    }
    if (speakIt) speak(text);
    /* P1-1：单次气泡 4.5 秒消失（验收 ≤5 秒，计时起点即 showBubble 入口，含打字机动画余量） */
    bubbleHideTimer = window.setTimeout(hideBubble, 4500);
  }
  function hideBubble() {
    window.clearInterval(typeTimer);
    bubbleEl.classList.remove('xm-show');
  }

  /* c3001：开场招呼先量一下——气泡会大面积盖住正文卡片/可点元素时跳过本次自动招呼。
     只拦 850ms 自动招呼：用户主动点猫/摸猫/喂食触发的气泡不受影响；猫还在原地，点猫照常聊天。
     量法：文案先放进未显示的气泡（透明但仍有布局尺寸），按锚定位置算出显示后的矩形
     （右缘 = 猫右缘 + 4px，下缘 = 猫顶 - 12px），再与 <main> 内的链接/按钮/文章/卡片求交。
     2026-11-18 :123（390px 首页招呼 15 秒未出）：旧阈值“任一方向重叠 >4px 即拦”太严——
     首页右下角三个 44px 悬浮钮（回到顶部/超级搜索/微工具箱）各占气泡面积仅约 12%，
     也会把招呼拦死。改判“单个元素重叠面积占气泡面积 >25% 才拦”：小悬浮钮不再拦，
     整宽卡片/搜索框等大面积遮挡仍拦（c3001 桌面 221×55 气泡盖卡片案仍被拦住）。
     U-161（2026-11-18 :123 续）：390px 首页招呼仍被拦——探针（HEAD d4bf700d，
     390×844 两轮一致）气泡 248×56（x[134,382] y[620,676]），元凶是 ChatGPT
     卡片容器 DIV.nav-card-deferred（重叠 98.39%）及其 A.absolute.inset-0
     全幅链接（97.98%）；标题链接 23.98%、44px 悬浮钮各 12.36% 均不到线。
     纯排除卡片容器会使 c3001 回归——c3001 元凶同为卡片容器（.nav-card-glow，
     桌面 1686px），且导航卡容器同时挂 nav-card-deferred 与 nav-card-glow
     两类名（navigation-card.tsx rich/standard 两变体）。故分支条件：只在窄屏
     （≤640px，与 isNarrowViewport / P1-1 市场收起同断点）排除“整卡背景式”
     元素——卡片容器本身与其 absolute inset-0 全幅链接；桌面端卡片照常计入，
     c3001 不丢。法理：窄屏单列布局下卡片顶恒在 604，任何“卡片计入”的门控都
     永拦招呼，与 :123 要求直接冲突；且气泡 pointer-events:none，不挡点击。
     非 deferred 的 .nav-card-glow 卡片（如 hero deck）任何宽度下都照常计入。 */
  function autoGreetWouldCoverContent() {
    var main = document.querySelector('main');
    if (!bubbleEl || !main) return false;
    var bw = bubbleEl.offsetWidth, bh = bubbleEl.offsetHeight;
    /* U-141（2026-11-18）：量不到尺寸 ≠ 不遮挡。气泡零尺寸只发生在猫被藏
       （hideCat 后 root display:none，气泡无布局尺寸）、收起态
       （.xm-docked .xm-bubble{display:none}）或样式未就绪时——此时无法
       证明“不盖正文”，放行招呼只会把文案留在看不见的气泡里（:123 旧断言
       toHaveText('') 就是这么失败的）。零尺寸按“判定不了”处理：跳过
       本次自动招呼，不放行。正常可见的猫气泡有 min-height:55px，走不到这支。 */
    if (!bw || !bh) return true;
    var catRect = root.getBoundingClientRect();
    var rect = { left: catRect.right + 4 - bw, top: catRect.top - 12 - bh, right: catRect.right + 4, bottom: catRect.top - 12 };
    var bubbleArea = bw * bh;
    /* U-161：窄屏才排除整卡背景式元素（见上）。自包含量法：不复用后文定义的
       isNarrowViewport()（契约测试从源码抠出本函数单测，函数外无定义会抛错）；
       断点与之同为 ≤640px。量不到宽度时默认按桌面算（卡片计入，保 c3001）。 */
    var narrowViewport = false;
    try {
      if (typeof window !== 'undefined' && window.matchMedia) narrowViewport = window.matchMedia('(max-width: 640px)').matches;
      else if (typeof window !== 'undefined') narrowViewport = window.innerWidth <= 640;
    } catch (e) { narrowViewport = false; }
    /* U-161：“整卡背景式”元素 = .nav-card-deferred 卡片容器本身，及其内部的
       absolute inset-0 全幅链接。量不到 class 时当普通元素计入（fail-closed）。 */
    function isFullCardBackground(el) {
      try {
        var cl = el.classList;
        if (!cl || !cl.contains) return false;
        if (cl.contains('nav-card-deferred')) return true;
        if (el.tagName === 'A' && cl.contains('absolute') && cl.contains('inset-0') &&
            el.closest && el.closest('.nav-card-deferred')) return true;
      } catch (e) { /* 量不到就计入 */ }
      return false;
    }
    var els = main.querySelectorAll('a, button, [role="button"], article, .nav-card-glow');
    for (var i = 0; i < els.length; i++) {
      if (narrowViewport && isFullCardBackground(els[i])) continue;
      var r = els[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var ix = Math.min(r.right, rect.right) - Math.max(r.left, rect.left);
      var iy = Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top);
      if (ix <= 0 || iy <= 0) continue;
      if (ix * iy > bubbleArea * 0.25) return true;
    }
    return false;
  }

  /* ---------- 时间与作息 ---------- */
  function hourNow() { return new Date().getHours(); }
  function isNight() { var h = hourNow(); return h >= 23 || h < 6; }
  function greetingText() {
    var h = hourNow();
    if (h >= 5 && h < 8) return '早上好呀，我是小猫猫，点旁边的聊天钮、想找点什么跟我说';
    if (h >= 8 && h < 11) return '你好，我是小猫猫，点旁边的聊天钮、想找什么网站跟我说';
    if (h >= 11 && h < 14) return '中午好，我是小猫猫，吃饱了来逛逛不？';
    if (h >= 14 && h < 18) return '下午好，我是小猫猫，点旁边的聊天钮、找站问我呀';
    if (h >= 18 && h < 23) return '晚上好，我是小猫猫，点旁边的聊天钮、今晚想看点什么跟我说';
    return '夜深啦，我是小猫猫，找完早点休息哦';
  }

  /* ---------- v4：节日（公历用 md，农历节日写死 2026/2027 日期，过期自动不触发） ---------- */
  var FESTIVALS = [
    { md: '01-01', name: '元旦', deco: '🎆', line: '新年快乐！新的一年，小猫猫陪你一起找好网站' },
    { ymd: '2026-02-16', name: '除夕', deco: '🧨', line: '除夕啦！年夜饭吃好没？小猫猫给你拜个早年' },
    { ymd: '2026-02-17', name: '春节', deco: '🧧', line: '过年好！小猫猫给你拜年啦，红包……就免啦，陪你逛网站' },
    { ymd: '2027-02-05', name: '除夕', deco: '🧨', line: '除夕啦！年夜饭吃好没？小猫猫给你拜个早年' },
    { ymd: '2027-02-06', name: '春节', deco: '🧧', line: '过年好！小猫猫给你拜年啦，红包……就免啦，陪你逛网站' },
    { ymd: '2026-03-03', name: '元宵节', deco: '🏮', line: '元宵节快乐！吃汤圆了没，圆圆满满一整年' },
    { ymd: '2026-04-05', name: '清明', deco: '🌿', line: '清明时节，踏青正好，回来我陪你逛逛' },
    { md: '05-01', name: '劳动节', deco: '🌷', line: '劳动节快乐！放假就好好歇着，找站的活交给我' },
    { md: '06-01', name: '儿童节', deco: '🎈', line: '儿童节快乐！大小朋友都要开开心心的' },
    { ymd: '2026-06-19', name: '端午节', deco: '🐲', line: '端午安康！粽子是甜的还是咸的呀？' },
    { ymd: '2026-08-19', name: '七夕', deco: '💫', line: '七夕快乐！今晚的星星特别亮，许个愿吧' },
    { md: '09-10', name: '教师节', deco: '📚', line: '教师节，谢谢每一位教过我们的人' },
    { ymd: '2026-09-25', name: '中秋节', deco: '🥮', line: '中秋快乐！月亮圆圆的，记得吃月饼哦' },
    { md: '10-01', name: '国庆节', deco: '🎊', line: '国庆快乐！假期想去哪玩？我帮你找攻略' },
    { ymd: '2026-10-18', name: '重阳节', deco: '🍂', line: '重阳节，记得给家里长辈打个电话哦' },
    { ymd: '2027-02-20', name: '元宵节', deco: '🏮', line: '元宵节快乐！吃汤圆了没，圆圆满满一整年' },
    { ymd: '2027-04-05', name: '清明', deco: '🌿', line: '清明时节，踏青正好，回来我陪你逛逛' },
    { ymd: '2027-06-09', name: '端午节', deco: '🐲', line: '端午安康！粽子是甜的还是咸的呀？' },
    { ymd: '2027-08-08', name: '七夕', deco: '💫', line: '七夕快乐！今晚的星星特别亮，许个愿吧' },
    { ymd: '2027-09-15', name: '中秋节', deco: '🥮', line: '中秋快乐！月亮圆圆的，记得吃月饼哦' },
    { ymd: '2027-10-08', name: '重阳节', deco: '🍂', line: '重阳节，记得给家里长辈打个电话哦' },
    { ymd: '2028-01-25', name: '除夕', deco: '🧨', line: '除夕啦！年夜饭吃好没？小猫猫给你拜个早年' },
    { ymd: '2028-01-26', name: '春节', deco: '🧧', line: '过年好！小猫猫给你拜年啦，红包……就免啦，陪你逛网站' },
    { ymd: '2028-02-09', name: '元宵节', deco: '🏮', line: '元宵节快乐！吃汤圆了没，圆圆满满一整年' },
    { ymd: '2028-04-04', name: '清明', deco: '🌿', line: '清明时节，踏青正好，回来我陪你逛逛' },
    { ymd: '2028-05-28', name: '端午节', deco: '🐲', line: '端午安康！粽子是甜的还是咸的呀？' },
    { ymd: '2028-08-26', name: '七夕', deco: '💫', line: '七夕快乐！今晚的星星特别亮，许个愿吧' },
    { ymd: '2028-10-03', name: '中秋节', deco: '🥮', line: '中秋快乐！月亮圆圆的，记得吃月饼哦' },
    { ymd: '2028-10-26', name: '重阳节', deco: '🍂', line: '重阳节，记得给家里长辈打个电话哦' },
    { md: '10-31', name: '万圣节', deco: '🎃', line: '万圣节到啦，不给糖就……陪你找网站！' },
    { md: '12-24', name: '平安夜', deco: '🔔', line: '平安夜快乐，愿你今晚有个好梦' },
    { md: '12-25', name: '圣诞节', deco: '🎄', line: '圣诞快乐！小猫猫就是你的圣诞礼物本物啦' }
  ];
  function festivalToday() {
    var now = new Date();
    var ymd = todayKeyStr(now);
    var md = ymd.slice(5);
    for (var i = 0; i < FESTIVALS.length; i++) {
      if (FESTIVALS[i].ymd && FESTIVALS[i].ymd === ymd) return FESTIVALS[i];
      if (FESTIVALS[i].md && FESTIVALS[i].md === md) return FESTIVALS[i];
    }
    return null;
  }

  /* ---------- v4：分页面感知（只看路径给对应招呼，不假装读懂页面内容） ---------- */
  function pageTopic() {
    var p = '';
    try { p = window.location.pathname || ''; } catch (e) { /* 忽略 */ }
    if (p.indexOf('/videos') === 0 || p.indexOf('/category/duanju') === 0 || p.indexOf('/category/short-drama') === 0) {
      return { greet: '追剧时间到！我是小猫猫，免费短剧我熟，点我帮你找', tip: '想找免费短剧，跟我说一声，我带你去红果、DramaWave' };
    }
    if (p.indexOf('/me') === 0) {
      return { greet: '来看看你的成长啦？等级和徽章都在这儿，我陪你一起攒', tip: '挂机也能涨经验，在页面多停一会儿，我陪着你' };
    }
    if (p.indexOf('/category/') === 0) {
      return { greet: '这个分类里好东西不少，拿不准点我，我帮你挑', tip: '这个分类拿不准选哪个？点我聊天，我按你的用途帮你挑' };
    }
    if (p.indexOf('/search') === 0) {
      return { greet: '搜不到想要的？告诉我，我用 AI 帮你找', tip: '搜索没找到？点我用一句话描述，我用 AI 帮你找' };
    }
    if (p.indexOf('/favorites') === 0) {
      return { greet: '你的收藏都在这儿啦，常回来看看呀', tip: '收藏的站点点开就能用，常用的还可以设成浏览器首页哦' };
    }
    if (p.indexOf('/collections') === 0) {
      return { greet: '合集里都是成套的好站，慢慢挑，不着急', tip: '合集是成套的工具链，做一件事要用的站都配齐了' };
    }
    return null;
  }

  /* 入场招呼的优先级：节日（当天一次）> 连胜（当天一次）> 分页招呼 > 时段招呼 */
  function composeGreeting() {
    var today = todayKeyStr();
    var f = festivalToday();
    if (f && v4.greetDay !== today) {
      v4.greetDay = today; persistV4();
      return f.line;
    }
    var g = readGrowth();
    if (g && v4.greetDay !== today) {
      var st = streakOf(g);
      if (st >= 2) {
        v4.greetDay = today; persistV4();
        return '你已经连续来 ' + st + ' 天啦🔥 小猫猫都记住你了，今天想找点什么？';
      }
    }
    if (window.location.pathname !== '/') {
      var pt = pageTopic();
      if (pt) return pt.greet;
    }
    return greetingText();
  }
  var lastActive = Date.now();
  /* C-15：850ms 内用户动过手（点/按）就跳过本次自动招呼，别跟用户点的气泡抢文案。
     滚动不算——滚动不触发气泡，无竞态。 */
  var userActed = false;
  var lastTipAt = 0, tipIdx = 0, sleeping = false, funIdx = 0, greeted = false;
  function markActive() { lastActive = Date.now(); }
  ['pointerdown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { userActed = true; markActive(); }, { passive: true });
  });
  document.addEventListener('scroll', markActive, { passive: true });
  function wakeUp(fromUser) {
    if (!sleeping) return false;
    sleeping = false;
    wrapEl.classList.remove('xm-sleep');
    setPose('main');
    /* C-12：唤醒后补发排队的升级庆祝；已补发就不再出通用“我醒啦”，庆祝优先。 */
    var celebrated = flushPendingCelebration();
    if (fromUser && !celebrated) showBubble('唔……我醒啦！想找什么跟我说', true);
    return celebrated;
  }
  function goSleep() {
    if (sleeping || root.classList.contains('xm-open')) return;
    sleeping = true;
    playCancelPounce();
    hideBubble();
    stopSpeak();
    stopCelebVideo();
    setPose('idle');
    wrapEl.classList.add('xm-sleep');
  }
  /* v9（合并版）：用户在页面输入框打字时猫保持安静；切走又回来（>=90 秒）时探头招呼，每 10 分钟至多一次 */
  var userTyping = false, hiddenAt = 0, lastBackGreetAt = 0;
  document.addEventListener('focusin', function (ev) {
    var t = ev.target;
    userTyping = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    /* P1-1：页内输入聚焦时猫整体静默（气泡收掉、根节点不可见不可点），
       失焦即恢复；猫自家聊天输入框（#xiaomaomao 内）不触发。 */
    if (userTyping && t && !root.contains(t)) {
      hideBubble();
      root.classList.add('xm-quiet');
    }
  });
  document.addEventListener('focusout', function () {
    userTyping = false;
    /* 焦点在输入框之间直跳时 focusout 先于下一个 focusin 到达：150ms 后
       再看 activeElement，仍在输入框里就保持静默，免得闪烁。 */
    window.setTimeout(function () {
      var ae = document.activeElement;
      var stillTyping = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) && !root.contains(ae));
      if (!stillTyping) root.classList.remove('xm-quiet');
    }, 150);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    var away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (away < 90000 || sleeping || userTyping) return;
    if (root.classList.contains('xm-open') || root.classList.contains('xm-closed')) return;
    if (Date.now() - lastBackGreetAt < 600000) return;
    lastBackGreetAt = Date.now();
    markActive();
    setPose('working');
    showBubble('你回来啦！刚刚去哪儿玩了，我陪你继续逛～', false);
    window.setTimeout(function () {
      if (!sleeping && !root.classList.contains('xm-open') && currentPose === 'working') setPose('main');
    }, 3200);
  });
  window.setInterval(function () {
    if (root.classList.contains('xm-open') || root.classList.contains('xm-closed')) return;
    var idleFor = Date.now() - lastActive;
    if (idleFor > 180000 || (isNight() && idleFor > 60000)) { goSleep(); return; }
    if (sleeping) return;
    if (!userTyping && !ctlShown && idleFor > 50000 && Date.now() - lastTipAt > 58000) {
      lastTipAt = Date.now();
      showBubble(TIPS[tipIdx % TIPS.length], false);
      tipIdx += 1;
      happyBounce();
    }
  }, 5000);

  /* ---------- 鼠标靠近探头跟随（仅精细指针） ---------- */
  var leanRaf = 0;
  try {
    if (window.matchMedia('(pointer: fine)').matches && !reducedMotion) {
      document.addEventListener('mousemove', function (ev) {
        if (leanRaf) return;
        leanRaf = window.requestAnimationFrame(function () {
          leanRaf = 0;
          var r = stageEl.getBoundingClientRect();
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          var dx = ev.clientX - cx, dy = ev.clientY - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 280 && dist > 1) {
            var tx = Math.max(-5, Math.min(5, dx * 0.022));
            var ty = Math.max(-4, Math.min(4, dy * 0.022));
            var rr = Math.max(-4.5, Math.min(4.5, dx * 0.018));
            leanEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotate(' + rr + 'deg) scale(1.03)';
          } else {
            leanEl.style.transform = '';
          }
        });
      }, { passive: true });
    }
  } catch (e) { /* 忽略 */ }

  /* ---------- 拖动（区分点击与拖动） ---------- */
  var drag = null;
  stageEl.addEventListener('pointerdown', function (ev) {
    if (docked) undock(); // 贴边半藏时先弹回，再按弹回后的几何记拖动原点
    drag = { x: ev.clientX, y: ev.clientY, moved: false };
    var r = root.getBoundingClientRect();
    drag.ox = r.left; drag.oy = r.top;
    drag.w = r.width || 112; drag.h = r.height || 112;
  });
  document.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 7) { drag.moved = true; hideControls(); }
    if (drag.moved) {
      var maxL = Math.max(4, window.innerWidth - (drag.w || 112) - 4);
      var maxT = Math.max(4, window.innerHeight - (drag.h || 112) - 4);
      var left = Math.max(4, Math.min(maxL, drag.ox + dx));
      var top = Math.max(4, Math.min(maxT, drag.oy + dy));
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      alignPanel();
    }
  }, { passive: true });
  document.addEventListener('pointerup', function () {
    if (drag && drag.moved) {
      var r = root.getBoundingClientRect();
      store.pos = { left: r.left, top: r.top };
      persist();
    }
    window.setTimeout(function () { drag = null; }, 0);
  });
  document.addEventListener('pointercancel', function () { drag = null; });
  function applySavedPos() {
    if (!store.pos) return;
    var rw = root.offsetWidth || 112, rh = root.offsetHeight || 112;
    var left = Math.max(4, Math.min(Math.max(4, window.innerWidth - rw - 4), store.pos.left));
    var top = Math.max(4, Math.min(Math.max(4, window.innerHeight - rh - 4), store.pos.top));
    root.style.left = left + 'px';
    root.style.top = top + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }
  /* K4：一键归位——清掉已存拖动位置并摘掉行内定位，回到样式表的默认右下角。
     先 undock（贴边写的是行内 transform，会压过定位）；只清位置，不管形象。 */
  function resetCatPos() {
    if (docked) undock();
    store.pos = null;
    persist();
    root.style.left = '';
    root.style.top = '';
    root.style.right = '';
    root.style.bottom = '';
    root.style.transform = '';
    hideControls();
    alignPanel();
    showBubble('好啦，我回右下角待着～', true);
  }
  function alignPanel() {
    var r = root.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    if (cx < 380) panelEl.classList.add('xm-left'); else panelEl.classList.remove('xm-left');
    /* v7：悬浮坞同理——猫靠左（左侧放不下一条坞）时翻向右展开 */
    var dock = root.querySelector('.xm-dock');
    if (dock) { if (cx < 300) dock.classList.add('xm-fan-r'); else dock.classList.remove('xm-fan-r'); }
  }
  window.addEventListener('resize', function () {
    undock();
    if (!store.pos) return;
    applySavedPos();
    alignPanel();
  });
  applySavedPos();
  alignPanel();

  /* ---------- v6：闲时贴边收缩（60 秒不理小猫 → 滑到最近的左右边缘半藏，露约半张脸） ----------
     冲突规则（先想清再写）：聊天面板开着不缩（xm-open）；游戏开着不缩；收起成圆标不缩
     （圆标本身已是最小态）；拖动中不缩；聊天请求中（busy）不缩；页面不可见不缩。
     睡觉与贴边互不干涉：睡着了也可以贴边，Zzz 跟着走；点/悬停先弹回，唤醒仍走原 click 链。
     贴边只写 transform，不动 left/top——拖动保存的位置分毫不变，弹回即原位。 */
  var docked = false, dockSide = 'right', xmLastAct = Date.now();
  /* K3：两个闲置时钟是分开的——lastActive（markActive，滚动也算，喂睡觉/闲聊气泡）
     与 xmLastAct（只认与猫的真实交互，喂 60 秒贴边）；滚动从来不重置贴边计时，
     报告里“K3 前提”经代码+实测证伪，见轮次记录。新增 lastScrollAt/xmHovering，
     喂下面的“滚动停止 8 秒自动半藏”。 */
  var lastScrollAt = Date.now(), xmHovering = false;
  var SCROLL_STOP_DOCK_AFTER = 8000;
  var DOCK_AFTER = 60000;
  function noteXmAct() { xmLastAct = Date.now(); }
  function dockBlocked() {
    return docked || root.classList.contains('xm-open') || root.classList.contains('xm-closed') ||
      gameEl.classList.contains('xm-on') || !!busy || !!document.hidden ||
      (typeof play === 'object' && play !== null && play.on); /* 互动玩法：游乐场模式下不贴边（用户在主动玩猫） */
  }
  function doDock() {
    if (dockBlocked()) return;
    var r = root.getBoundingClientRect();
    var w = r.width || 112;
    dockSide = (r.left + w / 2) < window.innerWidth / 2 ? 'left' : 'right';
    var shift = Math.max(0, Math.round(w * 0.48));
    root.style.transform = 'translateX(' + (dockSide === 'left' ? -shift : shift) + 'px)';
    docked = true;
    root.classList.add('xm-docked');
    pauseClips(); /* 默认视频：贴边半藏即停播，不在半藏态白白解码 */
    hideBubble();
  }
  function undock() {
    if (!docked) return;
    docked = false;
    root.classList.remove('xm-docked');
    root.style.transform = '';
    resumeClips(); /* 弹回：视频续播 */
    noteXmAct();
  }
  window.setInterval(function () {
    if (!docked && Date.now() - xmLastAct > DOCK_AFTER) { doDock(); return; }
    /* K3：滚动停止 8 秒后也半藏——读右下角内容时猫别一直挡着。悬停猫时不缩
       （xmHovering，用户正摸猫/看坞）；面板/游戏/聊天中不缩（doDock 自带
       dockBlocked 守门）。xmLastAct 也要满 8 秒：刚弹回就缩走是骚扰。 */
    if (!docked && !xmHovering && (window.scrollY || 0) > 300 &&
        Date.now() - lastScrollAt > SCROLL_STOP_DOCK_AFTER &&
        Date.now() - xmLastAct > SCROLL_STOP_DOCK_AFTER) doDock();
  }, 4000);
  /* v13：向下滚动浏览时贴边收起，免得猫盖住卡片（与 FloatingQuickNav 的
     下滑淡出同款思路）。只在向下滚动且滚过 300px 时触发；弹回靠悬停/轻点
     （既有 undock），向上滚动不自动弹回，避免来回跳。doDock 自带
     dockBlocked 守门（聊天/游戏/收起态不缩），重复调用无害。 */
  var lastScrollY = window.scrollY || 0;
  window.addEventListener('scroll', function () {
    lastScrollAt = Date.now(); /* K3：记最后滚动时刻，喂“滚动停止 8 秒自动半藏” */
    var y = window.scrollY || 0;
    var down = y > lastScrollY + 4;
    lastScrollY = y;
    if (down && y > 300) doDock();
    syncMarketPark(); /* P1-1：滚动即重新判断市场页收起/露出 */
  }, { passive: true });

  /* ---------- P1-1：市场页窄屏自动收起（390px 下猫身盖住搜索框右端） ----------
     /marketplace 窄屏（≤640px，与 CSS 媒体规则同断点）时，猫自动收进圆标并整体
     滑出视口右侧（.xm-parked，只写 transform 位移、不动 left/top、不覆盖用户
     已保存的拖动位置）；滚过搜索行（scrollY>60）后露出圆标入口（仍收起态，
     点圆标唤回），滚回顶部或滚到底（页脚/回到顶部正处猫的高度）时重新收走。
     离开市场页时自动收起的状态原样恢复；用户亲手唤回/收起后本页不再自动收。
     面板/游戏/聊天请求开着时不自动收（parkBlocked，复用 dockBlocked 的守门语义）。
     P2-16：滚到底分支放宽到 ≤1023px（页脚避让，见 isFooterParkViewport 与 641–1023px
     的 .xm-parked 媒体规则）；顶部收起与位移量取逻辑（竞态修复）一字未动。 */
  var autoParked = false, autoClosed = false, userUnparked = false, marketPath = '';
  function isNarrowViewport() {
    try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return window.innerWidth <= 640; }
  }
  /* P2-16：页脚避让的收起范围放宽到 ≤1023px（页脚 md 起右对齐，猫几乎贴着版权行）。
     只放宽「滚到底」分支；顶部收起（y≤30，防盖搜索行）仍只在窄屏生效。 */
  function isFooterParkViewport() {
    try { return window.matchMedia('(max-width: 1023px)').matches; } catch (e) { return window.innerWidth <= 1023; }
  }
  function nearPageBottom() {
    try {
      var de = document.documentElement;
      return (window.scrollY || 0) + window.innerHeight >= de.scrollHeight - 2;
    } catch (e) { return false; }
  }
  function parkBlocked() {
    return root.classList.contains('xm-open') ||
      (typeof gameEl !== 'undefined' && gameEl && gameEl.classList.contains('xm-on')) ||
      !!busy || !!document.hidden ||
      (typeof play === 'object' && play !== null && play.on); /* 互动玩法：游乐场模式下不自动收起 */
  }
  /* Q1 返工：清除收起位移变量（解除收起/离开市场页时调用；未设变量时 CSS 回落到 calc(100vw + 12px)）。 */
  function clearParkX() {
    try { root.style.removeProperty('--xm-park-x'); } catch (e) { /* 忽略 */ }
  }
  function syncMarketPark() {
    var p = '';
    try { p = window.location.pathname || ''; } catch (e) { /* 忽略 */ }
    var onMarket = p === '/marketplace' || p.indexOf('/marketplace/') === 0;
    if (!onMarket || !isFooterParkViewport()) {
      if (autoParked) { autoParked = false; root.classList.remove('xm-parked'); clearParkX(); }
      if (autoClosed) { autoClosed = false; root.classList.remove('xm-closed'); }
      marketPath = onMarket ? p : '';
      return;
    }
    if (marketPath !== p) { marketPath = p; userUnparked = false; }
    if (parkBlocked() || userUnparked) return;
    var y = window.scrollY || 0;
    /* P2-16：顶部收起（y≤30）仍只在窄屏生效（防盖搜索行是窄屏问题）；滚到底收起放宽到
       ≤1023px（页脚避让）。窄屏下本条件与 P1-1 原式逐字等价，≤640px 行为零变化。 */
    if ((y <= 30 && isNarrowViewport()) || nearPageBottom()) {
      if (docked) undock(); /* 贴边写的是行内 transform，会压过 .xm-parked 的位移，先清掉 */
      if (!root.classList.contains('xm-closed')) { root.classList.add('xm-closed'); autoClosed = true; }
      /* 竞态修复（独立复审问题 1）+ 视口变宽重算（问题 2）：每次进入收起区都重算位移。
         量取前临时关掉过渡并强制回流——#xiaomaomao 有 .45s transform 过渡，快速下滚
         回顶时量到的是过渡中的 left，位移会算小、猫留一部分在视口内；已收起时先暂时
         摘掉 xm-parked 再量（否则量到的是已位移后的 left）。关过渡、摘类、量取都在
         同一任务内同步完成，不会产生中间帧；已收起态重算时先把新位移落到位再恢复过渡，
         避免猫扫过屏幕；首次收起恢复过渡后再加类，滑出动画仍正常走。
         视口变宽后旧 parkX 会不够，拖动过的猫会重新进入视口，所以已收起态也要重算。 */
      var wasParked = root.classList.contains('xm-parked');
      if (!wasParked) { hideBubble(); hideControls(); }
      var prevTransition = '';
      try {
        prevTransition = root.style.transition;
        root.style.transition = 'none';
        if (wasParked) root.classList.remove('xm-parked');
        void root.offsetWidth; /* 强制回流：渲染位置回到自然锚点 */
        var parkX = Math.ceil(window.innerWidth - root.getBoundingClientRect().left + 12);
        root.style.setProperty('--xm-park-x', parkX + 'px');
        if (wasParked) {
          root.classList.add('xm-parked');
          void root.offsetWidth; /* 过渡关闭时把新位移落到位，再恢复过渡 */
        }
      } catch (e) { /* 忽略，保留旧值或回落到 CSS 默认值 */ }
      root.style.transition = prevTransition;
      if (!root.classList.contains('xm-parked')) root.classList.add('xm-parked');
      autoParked = true;
    } else if (y > 60 && autoParked) {
      root.classList.remove('xm-parked');
      clearParkX();
      autoParked = false;
    } else if (y <= 30 && !isNarrowViewport() && autoParked) {
      /* P2-16：平板跳回顶部（回到顶部按钮直达 y=0，不经过 y>60 的露出分支）时放回圆标，
         否则猫会一直收在视口外。只清位移、不碰 xm-closed（仍是收起态圆标，点圆标唤回）。 */
      root.classList.remove('xm-parked');
      clearParkX();
      autoParked = false;
    }
  }
  /* 软路由（Next.js Link）不重载脚本：history 变化与视口变化后重新同步一次。 */
  window.addEventListener('popstate', syncMarketPark);
  try {
    var _xmPushState = history.pushState, _xmReplaceState = history.replaceState;
    if (_xmPushState) history.pushState = function () { var r = _xmPushState.apply(this, arguments); syncMarketPark(); return r; };
    if (_xmReplaceState) history.replaceState = function () { var r = _xmReplaceState.apply(this, arguments); syncMarketPark(); return r; };
  } catch (e) { /* 忽略 */ }
  var _xmResizeT = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(_xmResizeT);
    _xmResizeT = window.setTimeout(syncMarketPark, 200);
  });
  root.addEventListener('pointerenter', function () {
    xmHovering = true; /* K3：悬停猫时“滚动停止 8 秒自动半藏”不触发 */
    var wasDocked = docked;
    if (docked) undock();
    noteXmAct();
    /* v7：贴边弹回的那次进入只弹回、不顺带出坞（免得猫刚弹回来又被坞围住） */
    if (!wasDocked) showControls(true);
  });
  root.addEventListener('pointerdown', function () { noteXmAct(); }, true);

  /* ---------- K5：站内弹窗打开时猫暂隐/降层 ----------
     信号（站内已有模式，见 ui/overlay.tsx 注释）：浮层根节点挂
     role="dialog" + aria-modal="true"；Radix Dialog 同款。猫自家面板也在
     #xiaomaomao 内且无 aria-modal，判定里排除它。
     超级搜索有两种打开路径：open-spotlight 事件（FloatingQuickNav 的按钮）
     与键盘直开（gateway 直接挂载）——前者靠事件立即降层，后者靠下面的
     MutationObserver 捕获挂载；关闭一律靠观察器捕获卸载。 */
  var spotlightOpen = false;
  function anySiteModalOpen() {
    try {
      var els = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
      for (var i = 0; i < els.length; i++) {
        if (!root.contains(els[i])) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }
  function syncModalDim() {
    var domOpen = anySiteModalOpen();
    if (!domOpen) spotlightOpen = false; /* 弹窗都卸了，open-spotlight 的乐观位也清掉 */
    root.classList.toggle('xm-behind-modal', domOpen || spotlightOpen);
  }
  window.addEventListener('open-spotlight', function () {
    spotlightOpen = true;
    syncModalDim();
    /* 兜底：600ms 内没挂上弹窗（网关加载失败），乐观位过期、猫恢复 */
    window.setTimeout(syncModalDim, 600);
  });
  try {
    var _xmModalObs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') { syncModalDim(); return; }
        if (m.type === 'attributes' && (m.attributeName === 'aria-modal' || m.attributeName === 'data-state')) { syncModalDim(); return; }
      }
    });
    _xmModalObs.observe(document.body, { childList: true, attributes: true, subtree: true, attributeFilter: ['aria-modal', 'data-state'] });
  } catch (e) { /* 无 MutationObserver 的环境下降级：只靠 open-spotlight 事件 */ }

  /* ---------- v7：控件按需唤出（平时零遮挡） ----------
     参考系：Shimeji 角色本体零控件（菜单全在右键）；live2d-widget 工具栏 opacity 0、
     悬停容器才淡入且立在角色身侧；AssistiveTouch 闲置自动变淡、点开才出菜单。
     本站落法：静止只剩猫；桌面悬停 / 移动端轻点猫 → 坞在猫上方留白处淡入展开；
     鼠标移开（350ms 宽限）、点页面别处、Esc、或闲置 3 秒 → 自动收起。
     面板/游戏开着、收起态时坞不出（各有自己的界面）；与气泡互斥（showBubble 里先收坞）。
     唤出/收起只切 root 的 .xm-ctl 类，猫的 left/top/transform 一概不碰，不跳位不闪烁。 */
  var dockEl = root.querySelector('.xm-dock');
  var ctlShown = false, ctlTimer = 0, ctlLeaveTimer = 0;
  var CTL_HIDE_AFTER = 3000;
  var coarsePointer = false;
  try { coarsePointer = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* 忽略 */ }
  function ctlBlocked() {
    return root.classList.contains('xm-open') || root.classList.contains('xm-closed') ||
      (typeof gameEl !== 'undefined' && gameEl && gameEl.classList.contains('xm-on'));
  }
  function showControls(fromUser) {
    if (ctlBlocked()) return;
    /* C-14：气泡与坞双向互斥——用户亲手唤坞先收气泡再开坞；自动提示
       （首访 1500ms hint，无参调用）遇气泡在显示时直接不开，免得腰斩
       850ms 首访招呼。悬停/轻点是用户动作，仍可唤坞。 */
    if (root.querySelector('.xm-bubble.xm-show')) {
      if (!fromUser) return;
      hideBubble();
    }
    window.clearTimeout(ctlLeaveTimer);
    root.classList.add('xm-ctl');
    ctlShown = true;
    scheduleCtlHide();
  }
  function hideControls() {
    window.clearTimeout(ctlTimer);
    window.clearTimeout(ctlLeaveTimer);
    if (ctlShown) root.classList.remove('xm-ctl');
    ctlShown = false;
  }
  function scheduleCtlHide() {
    window.clearTimeout(ctlTimer);
    ctlTimer = window.setTimeout(hideControls, CTL_HIDE_AFTER);
  }
  root.addEventListener('pointerleave', function () {
    xmHovering = false; /* K3：指针离开猫，滚动停止计时恢复生效 */
    if (!ctlShown) return;
    window.clearTimeout(ctlTimer);
    ctlLeaveTimer = window.setTimeout(hideControls, 350);
  });
  document.addEventListener('pointerdown', function (ev) {
    if (ctlShown && !root.contains(ev.target)) hideControls();
  }, true);
  /* B-08：焦点陷阱——Tab 在模态容器内首尾循环，不漏到页面背后；焦点若在容器外，
     拉回首项。换形象页（display:none）的元素用 getClientRects() 过滤掉。 */
  var lastFocusBeforeModal = null; /* B-08：打开模态前记触发焦点，关闭时还回去 */
  function trapTabIn(container, ev) {
    if (!container) return;
    var items = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
    var focusable = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].getClientRects().length) focusable.push(items[i]);
    }
    if (!focusable.length) { ev.preventDefault(); return; }
    var first = focusable[0], last = focusable[focusable.length - 1];
    var active = document.activeElement;
    if (ev.shiftKey && active === first) { last.focus(); ev.preventDefault(); }
    else if (!ev.shiftKey && active === last) { first.focus(); ev.preventDefault(); }
    else if (container.contains(active)) { /* 容器内正常 Tab，不干预 */ }
    else { first.focus(); ev.preventDefault(); }
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      /* B-08：Esc 按游戏 > 面板 > 坞的优先级关闭，不再只收坞。 */
      if (gameEl && gameEl.classList.contains('xm-on')) { closeGame(); return; }
      if (root.classList.contains('xm-open')) { closePanel(); return; }
      hideControls();
      return;
    }
    if (ev.key === 'Tab') {
      /* B-08：面板/游戏开着时 Tab 困在模态里，不漏到页面背后。 */
      if (gameEl && gameEl.classList.contains('xm-on')) { trapTabIn(gameEl, ev); return; }
      if (root.classList.contains('xm-open')) { trapTabIn(panelEl, ev); }
    }
  });
  /* 坞内有动静（点按/聚焦）就续命 3 秒，不会在手边自己消失 */
  dockEl.addEventListener('pointerdown', function () { if (ctlShown) scheduleCtlHide(); });
  dockEl.addEventListener('focusin', function () { if (ctlShown) scheduleCtlHide(); });

  /* ---------- v4：摸猫互动（连摸情绪递进，摸太急偶尔躲开） ---------- */
  var petChain = 0, petLastAt = 0, interacted = false;
  /* v8：带声音动画的唯一授权位——只有点猫本体（桌面）或坞里摸猫钮的真实点击才置 true，
     petCat 消费一次即清零；程序内调用（如面板流程）永远静音，绝不自动外放。 */
  var petSoundArmed = false;
  var PET_WARM = ['嘿嘿，摸到我啦', '嗯～这儿，舒服', '我在陪你呀，摸摸头', '爪爪给你摸一下', '呼噜呼噜……'];
  var PET_HAPPY = ['哇，好开心！', '继续继续，不要停～', '你最好啦，蹭蹭', '开心到冒泡泡啦'];
  var PET_MAX = ['爱你爱你！今天的份已经超标啦', '心都要化掉啦，你太会摸了', '呜哇，被宠上天了'];
  var PET_HUNGRY = ['摸摸好开心……肚子有点饿了，喂我条小鱼干嘛', '嘿嘿，顺便说一句，我想吃小鱼干了'];
  var PET_DODGE = ['哎呀，痒痒啦！', '嘿，没摸着～', '慢一点点嘛，吓我一跳'];
  function petCat() {
    interacted = true;
    var withSound = petSoundArmed; petSoundArmed = false;
    var now = Date.now();
    petChain = (now - petLastAt < 3200) ? petChain + 1 : 1;
    petLastAt = now;
    if (petChain >= 5 && Math.random() < 0.3) {
      petChain = 0;
      wrapEl.classList.remove('xm-dodge');
      void wrapEl.offsetWidth;
      wrapEl.classList.add('xm-dodge');
      showEmo('！');
      setPose('surprised'); /* v8：躲开配惊喜脸（03），不再只靠 CSS 抖一下 */
      playExprVideo('surprised', false);
      showBubble(pickOne(PET_DODGE), true);
      window.setTimeout(function () { wrapEl.classList.remove('xm-dodge'); }, 500);
      window.setTimeout(function () {
        if (!sleeping && !root.classList.contains('xm-open') && currentPose === 'surprised') setPose('main');
      }, 2600);
      return;
    }
    var pose, line, emo;
    if (petChain === 1) {
      /* 点猫三级 ladder（互动玩法第一批 Top 3）：第 1 下抬头看你 */
      pose = 'working';
      emo = '？';
      line = '嗯？叫我吗～';
    } else if (petChain === 2) {
      /* 第 2 下开心回应 */
      pose = 'making';
      burst(6);
      emo = '♥';
      line = (currentSat() < 35 && Math.random() < 0.35) ? pickOne(PET_HUNGRY) : pickOne(PET_WARM);
    } else if (petChain === 3) {
      /* 第 3 下打滚：打滚视频后补，当前用走路视频 + 原地转圈近似（.xm-roll），不编视频 */
      pose = 'milestone';
      emo = '★';
      line = '看我打滚～呼噜呼噜';
      playClip('walk');
      wrapEl.classList.remove('xm-roll');
      void wrapEl.offsetWidth;
      wrapEl.classList.add('xm-roll');
      window.setTimeout(function () { wrapEl.classList.remove('xm-roll'); playClip('idle'); }, 1000);
    } else {
      pose = 'milestone';
      burst(11);
      emo = '♪';
      line = pickOne(petChain >= 5 ? PET_MAX : PET_HAPPY);
    }
    setPose(pose);
    showEmo(emo);
    /* v8：摸猫动画——卖萌播眨眼、撒娇播开心大笑；点猫进来的播带声音版，其余静音 */
    playExprVideo(pose === 'milestone' ? 'happy' : 'wink', withSound);
    happyBounce();
    showBubble(line, true);
    window.setTimeout(function () {
      if (!sleeping && !root.classList.contains('xm-open') && currentPose === pose) setPose('main');
    }, 3800);
  }
  /* v10（合并版）：生命力与互动细节——待机眨眼、双击放动画、长按摸猫、键盘可操作 */
  window.setInterval(function () {
    if (reducedMotion || sleeping || document.hidden || userTyping) return;
    if (currentPose !== 'main' || root.classList.contains('xm-open') || root.classList.contains('xm-closed')) return;
    if (Math.random() > 0.75) return;
    setPose('making');
    window.setTimeout(function () {
      if (!sleeping && currentPose === 'making' && !root.classList.contains('xm-open')) setPose('main');
    }, 340);
  }, 4200);
  stageEl.addEventListener('dblclick', function (ev) {
    ev.preventDefault();
    if (sleeping) { wakeUp(true); return; }
    markActive();
    happyBounce();
    showEmo('♪');
    /* 基底无单一 playVideo 入口：庆祝家族走 celebrateVideo、心情动画走 playExprVideo（静音） */
    var moods = ['shy', 'yawn', 'grumpy', 'teary', 'pleading', 'sleepy'];
    if (Math.random() < 0.5) celebrateVideo('levelup');
    else playExprVideo(moods[Math.floor(Math.random() * moods.length)], false);
  });
  var pressT = 0, longPetAt = 0;
  stageEl.addEventListener('pointerdown', function () {
    window.clearTimeout(pressT);
    pressT = window.setTimeout(function () {
      if (drag && drag.moved) return;
      if (sleeping) { wakeUp(true); return; }
      if (root.classList.contains('xm-open')) return;
      longPetAt = Date.now();
      petCat();
    }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
    stageEl.addEventListener(evt, function () { window.clearTimeout(pressT); });
  });
  stageEl.setAttribute('tabindex', '0');
  stageEl.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    stageEl.click();
  });
  stageEl.addEventListener('click', function () {
    if (drag && drag.moved) return;
    if (!coarsePointer && longPetAt && Date.now() - longPetAt < 800) { longPetAt = 0; markActive(); return; }
    markActive();
    if (sleeping) { wakeUp(true); return; }
    if (root.classList.contains('xm-open')) return;
    /* v7：触摸设备没有悬停——轻点猫只负责唤出/收起坞，摸猫走坞里的爪印钮，
       免得每点一次猫又出气泡又出坞、两样东西打架 */
    if (coarsePointer) {
      if (ctlShown) hideControls(); else showControls(true);
      return;
    }
    petSoundArmed = true; /* v8：桌面点猫本体＝主动点猫，这次摸猫的动画可以带声音 */
    petCat();
  });

  /* ---------- 按钮：语音 / 收起 / 唤回 ---------- */
  function syncVoiceBtns() {
    var icon = voiceOn ? ICONS.volOn : ICONS.volOff;
    var btns = root.querySelectorAll('.xm-voice-btn');
    for (var i = 0; i < btns.length; i++) btns[i].innerHTML = icon;
  }
  var voiceBtns = root.querySelectorAll('.xm-voice-btn');
  for (var vi = 0; vi < voiceBtns.length; vi++) {
    voiceBtns[vi].addEventListener('click', function (ev) {
      ev.stopPropagation();
      voiceOn = !voiceOn;
      store.voice = voiceOn;
      persist();
      syncVoiceBtns();
      if (!voiceOn) { stopSpeak(); if (videoEl) { try { videoEl.muted = true; } catch (e) { /* 忽略 */ } } } /* v8 复审返工：关语音也静掉正在播的有声视频 */
      else if (!root.classList.contains('xm-open')) showBubble('声音打开啦', true);
    });
  }
  syncVoiceBtns();
  /* P1-1：收起（坞内关闭钮与猫身常驻角标共用）——游戏开着先关游戏，
     再收进圆标；注意：亲手收起不锁存 userUnparked，下次滚动到顶部/底部时仍会触发自动收起，
     滚过搜索行后圆标露出分支也照常生效。 */
  function collapseCat() {
    hideControls();
    if (gameEl && gameEl.classList.contains('xm-on')) closeGame();
    /* A P1-3/C-10：收起即关游乐场——rAF/定时器停掉，store.play 写盘 false，
       否则游乐场在圆标后面继续跑、刷新又自启，收起粘不住。 */
    if (play.on) setPlayMode(false);
    root.classList.add('xm-closed');
    setIconImg(root.querySelector('.xm-tab img')); /* B-04：收起成圆标时才给圆标设 src */
    root.classList.remove('xm-open');
    hideBubble();
    stopSpeak();
    stopCelebVideo(); /* v8 复审返工：收起即停视频，滞后的探活链凭令牌丢弃 */
    pauseClips(); /* 默认视频：收起成圆标即停播，不在圆标里白白解码 */
    autoClosed = false;
    autoParked = false;
    userUnparked = false;
    /* K2：亲手收起要落盘，否则刷新就回来（旧 bug：collapseCat 不调 persist）。 */
    store.closed = true;
    store.closedAt = Date.now();
    persist();
  }
  root.querySelector('.xm-close-btn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    collapseCat();
  });
  root.querySelector('.xm-mini-close').addEventListener('click', function (ev) {
    ev.stopPropagation();
    collapseCat();
  });
  /* v7：坞里的摸猫钮——桌面点猫本体也能摸，这颗给触摸设备和爱用按钮的人 */
  root.querySelector('.xm-pet-btn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    markActive();
    if (sleeping) { wakeUp(true); return; }
    if (root.classList.contains('xm-open')) return;
    petSoundArmed = true; /* 坞里摸猫钮也是用户主动点猫：这次摸猫可以带声音 */
    petCat();
  });
  root.querySelector('.xm-tab').addEventListener('click', function () {
    root.classList.remove('xm-closed');
    root.classList.remove('xm-parked'); /* P1-1：亲手唤回即解除市场页自动收起 */
    autoParked = false;
    autoClosed = false;
    userUnparked = true; /* 本页不再自动收走 */
    /* K2：亲手唤回即清掉持久收起，下次加载正常展开。 */
    store.closed = false;
    store.closedAt = 0;
    persist();
    markActive();
    /* C-12：唤回后补发排队的升级庆祝；已补发就不再出通用“我回来啦”与
       waking 姿势，庆祝优先（庆祝自带 milestone 姿势与气泡）。 */
    var celebrated = wakeUp(false) || flushPendingCelebration();
    /* 唤回：游乐场开着续播游乐场那一路，否则默认视频续上（已在播时是空操作） */
    if (play.on) resumeClips(); else { reviveVideoOnWake(); startAmbientVideo(); }
    if (!celebrated) {
      setPose('waking');
      happyBounce();
      burst(7);
      showBubble(greeted ? '我回来啦，想找什么？' : greetingText(), true);
      window.setTimeout(function () { if (currentPose === 'waking') setPose('main'); }, 3200);
    }
  });

  /* ---------- 聊天面板 ---------- */
  var history = [];
  var busy = false;
  var chatted = false;
  function openPanel() {
    undock();
    hideControls();
    lastFocusBeforeModal = document.activeElement; /* B-08：记触发焦点，关闭时还回去（收坞不挪焦点，放其后仍是开面板前的焦点） */
    closeLook();
    root.classList.add('xm-open');
    setIconImg(root.querySelector('.xm-p-head img')); /* B-04：面板头像懒加载，打开面板时才设 src */
    root.classList.remove('xm-closed');
    hideBubble();
    markActive();
    wakeUp(false);
    root.querySelector('.xm-chat-btn').classList.remove('xm-pulse');
    setPose('making');
    /* C-11：面板打开时猫站住别走——游乐场在跑就切待机视频，腿别空踩。 */
    if (play.on && (play.mode === 'chase' || play.mode === 'wander' || play.mode === 'pounce')) playClip('idle');
    alignPanel();
    if (!chatted) {
      chatted = true;
      addCatText('你好呀，我是小猫猫！找网站是我的强项，比如「想看免费短剧」「要做 PPT 的工具」「学英语的网站」，直接打字告诉我就行。也可以问我某个分类里有什么、场景包怎么用。');
    }
    /* C-12：开面板时补发排队的升级庆祝（面板开着走 addCatText，不弹气泡；
       睡眠态已在上面 wakeUp 里补发过，这里是空操作，不重复）。 */
    flushPendingCelebration();
    window.setTimeout(function () { try { inputEl.focus({ preventScroll: true }); } catch (e) { inputEl.focus(); } }, 120);
  }
  function closePanel() {
    root.classList.remove('xm-open');
    closeLook();
    setPose('main');
    markActive();
    /* B-08：焦点还给打开面板前的位置。触发钮在坞里、坞收起时 visibility:hidden、
       直接 focus() 会静默失败——先唤出坞再聚焦；唤不出时退回猫舞台（tabindex=0）。
       合入注：showControls 已改 showControls(fromUser)（状态线），无参是自动提示
       会直接 return，这里须传 true 才是亲手唤坞。 */
    if (lastFocusBeforeModal && lastFocusBeforeModal.focus) {
      try {
        if (dockEl && dockEl.contains(lastFocusBeforeModal)) showControls(true);
        lastFocusBeforeModal.focus();
        if (document.activeElement !== lastFocusBeforeModal) stageEl.focus();
      } catch (e) { try { stageEl.focus(); } catch (e2) { /* 忽略 */ } }
    }
    lastFocusBeforeModal = null;
    /* C-11：关面板按游乐场模式续播——追/漫步续走路视频，扑态按待机续
       （扑自身的定时器会收尾，不抢它的收尾）。 */
    if (play.on) { if (play.mode === 'chase' || play.mode === 'wander') playClip('walk'); else playClip('idle'); }
  }
  root.querySelector('.xm-chat-btn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (root.classList.contains('xm-open')) closePanel(); else openPanel();
  });
  root.querySelector('.xm-p-close').addEventListener('click', function (ev) {
    ev.stopPropagation();
    closePanel();
  });

  function scrollMsgs() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function addUserText(text) {
    var d = document.createElement('div');
    d.className = 'xm-m xm-m-u';
    d.textContent = text;
    msgsEl.appendChild(d);
    scrollMsgs();
  }
  function addCatText(text) {
    var d = document.createElement('div');
    d.className = 'xm-m xm-m-a';
    d.textContent = text;
    msgsEl.appendChild(d);
    scrollMsgs();
    return d;
  }
  function addNote(text) {
    var d = document.createElement('div');
    d.className = 'xm-note';
    d.textContent = text;
    msgsEl.appendChild(d);
    scrollMsgs();
  }
  function addCards(sites) {
    if (!sites || !sites.length) return;
    var box = document.createElement('div');
    box.className = 'xm-cards';
    sites.slice(0, 6).forEach(function (s) {
      var a = document.createElement('a');
      a.className = 'xm-card';
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      var mono = document.createElement('span');
      mono.className = 'xm-mono';
      mono.textContent = (s.title || '站').slice(0, 1);
      var mid = document.createElement('span');
      var t = document.createElement('div');
      t.className = 'xm-card-t';
      t.textContent = s.title || s.url;
      var r = document.createElement('div');
      r.className = 'xm-card-r';
      r.textContent = s.reason || s.description || '站内收录站点，点开就能用';
      mid.appendChild(t); mid.appendChild(r);
      var go = document.createElement('span');
      go.className = 'xm-card-go';
      go.innerHTML = ICONS.arrow;
      a.appendChild(mono); a.appendChild(mid); a.appendChild(go);
      box.appendChild(a);
    });
    msgsEl.appendChild(box);
    scrollMsgs();
  }
  function addSuggestions(cats) {
    if (!cats || !cats.length) return;
    var box = document.createElement('div');
    box.className = 'xm-sugs';
    cats.slice(0, 3).forEach(function (c) {
      var a = document.createElement('a');
      a.className = 'xm-sug';
      a.href = '/category/' + (c.slug || c.id);
      a.textContent = '去「' + c.title + '」分类看看';
      box.appendChild(a);
    });
    msgsEl.appendChild(box);
    scrollMsgs();
  }
  function addThinking() {
    var d = document.createElement('div');
    d.className = 'xm-m xm-m-a';
    d.innerHTML = '<span class="xm-dots"><i></i><i></i><i></i></span>';
    msgsEl.appendChild(d);
    scrollMsgs();
    return d;
  }

  /* A P1-1 / C-04（2026-11-18）：带超时的 fetch——AbortController 到时 abort，并用 Promise.race
     再兜一层，保证即使底层 fetch 不响应 abort 信号，调用方仍在 ms 内拿到拒绝，不永久挂起。
     合入注（2026-11-18）：与视频线的 fetchWithTimeout（超时返回 null、供探活/清单用）
     同名但语义相反（这里超时是拒绝 + abort），故改名 fetchWithTimeoutAbort，免得后定义
     覆盖前定义、把探活的超时语义改掉。 */
  function fetchWithTimeoutAbort(url, options, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var opts = {};
    if (options) { for (var k in options) { if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k]; } }
    if (ctrl) opts.signal = ctrl.signal;
    var timer = null;
    var timeoutP = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('fetch timeout after ' + ms + 'ms'));
      }, ms);
    });
    return Promise.race([window.fetch(url, opts), timeoutP]).then(
      function (res) { window.clearTimeout(timer); return res; },
      function (err) { window.clearTimeout(timer); if (ctrl) ctrl.abort(); throw err; }
    );
  }
  function postJson(url, body) {
    return fetchWithTimeoutAbort(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, REQUEST_TIMEOUT_MS).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }
  function finishWithReply(reply, sites, cats, degraded) {
    busy = false;
    sendBtn.disabled = false;
    if (reply) {
      history.push({ role: 'assistant', content: reply });
      if (history.length > 10) history = history.slice(-10);
    }
    if (sites && sites.length) {
      setPose('milestone');
      happyBounce();
      burst(10);
      window.setTimeout(function () { if (currentPose === 'milestone') setPose('making'); }, 3600);
    } else {
      setPose('making');
    }
    if (degraded === 'unconfigured') addNote('小提示：AI 还没配置密钥，现在是本地检索在帮你找');
    else if (degraded === 'quota') addNote('小提示：今天的 AI 额度用完了，现在是本地检索结果');
    else if (degraded) addNote('小提示：AI 暂时忙，我先用本地检索帮你找');
    if (reply) speak(reply);
  }
  function sendChat(text) {
    var q = (text || '').trim();
    if (!q || busy) return;
    busy = true;
    // 成长桥（A12）：只发事件、不碰成长档案；站内 GrowthTracker 监听后按既有规则记 ai_chat 经验。
    try { window.dispatchEvent(new CustomEvent('navhub:ai-chat-used')); } catch (e) { /* 事件发不出不影响聊天 */ }
    sendBtn.disabled = true;
    markActive();
    noteXmAct();
    wakeUp(false);
    addUserText(q);
    inputEl.value = '';
    var sentHistory = history.slice();
    history.push({ role: 'user', content: q });
    setPose('working');
    showEmo('？');
    var think = addThinking();
    postJson(CHAT_URL, { message: q, history: sentHistory })
      .then(function (data) {
        think.remove();
        if (!data || data.ok !== true) throw new Error('bad chat response');
        addCatText(data.reply || '我找到这些啦，点开就能用。');
        addCards(data.recommendations || []);
        addSuggestions(data.categorySuggestions || []);
        finishWithReply(data.reply || '', data.recommendations || [], data.categorySuggestions || [], data.degraded || null);
      })
      .catch(function () {
        // 聊天接口不可用时退到结构化找站，再不行才本地话术——永远不让访客看到报错。
        postJson(FIND_URL, { query: q })
          .then(function (data) {
            think.remove();
            if (!data || data.ok !== true) throw new Error('bad find response');
            var recs = (data.recommendations && data.recommendations.length)
              ? data.recommendations
              : (data.steps || []).reduce(function (acc, st) { return acc.concat(st.sites || []); }, []);
            addCatText(data.notice || '我帮你找到了这些，点开就能用。');
            addCards(recs);
            addSuggestions(data.categorySuggestions || []);
            finishWithReply(data.notice || '', recs, data.categorySuggestions || [], 'error');
          })
          .catch(function () {
            think.remove();
            addCatText('哎呀，我这会儿有点迷糊，没能帮你找成。你可以先去首页的「AI 智能找站」试试，或者等会儿再喊我。');
            finishWithReply('', [], [], 'error');
            /* P1（合并后细节）：聊天彻底失败时猫要有情绪反馈——切委屈泪汪汪陪着用户，
               不只是面板里一行文字（finishWithReply 会先切 making，这里再覆盖为 teary） */
            setPose('teary');
            window.setTimeout(function () {
              if (!sleeping && currentPose === 'teary') setPose('main');
            }, 3800);
          });
      });
  }
  root.querySelector('.xm-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    sendChat(inputEl.value);
  });
  var chipBtns = root.querySelectorAll('.xm-chips .xm-sug');
  for (var ci = 0; ci < chipBtns.length; ci++) {
    chipBtns[ci].addEventListener('click', function () {
      sendChat(this.getAttribute('data-q'));
    });
  }

  /* ---------- v4：表情符号层 + 节日装饰（CSS/emoji 覆盖层，不动真图） ---------- */
  var emoEl = document.createElement('div');
  emoEl.className = 'xm-emo';
  emoEl.setAttribute('aria-hidden', 'true');
  wrapEl.appendChild(emoEl);
  function showEmo(ch) {
    if (reducedMotion || !emoEl) return;
    emoEl.textContent = ch;
    emoEl.classList.remove('xm-emo-show');
    void emoEl.offsetWidth;
    emoEl.classList.add('xm-emo-show');
  }
  var decoEl = document.createElement('div');
  decoEl.className = 'xm-deco';
  decoEl.setAttribute('aria-hidden', 'true');
  wrapEl.appendChild(decoEl);
  function showDeco(ch) { decoEl.textContent = ch; decoEl.style.display = 'block'; }

  /* ---------- v4：成长联动（只读 navhub.growth.v1，规则与站内 growth.ts 同口径复刻） ---------- */
  var GROWTH_KEY = 'navhub.growth.v1';
  /* v2 起引擎落盘时顺手写只读摘要（等级/连胜/今日三槽/冻结卡），挂件优先读摘要不复刻任务逻辑 */
  var GROWTH_SUMMARY_KEY = 'navhub.growth.summary.v1';
  var LEVELS4 = [
    { level: 1, title: '初来乍到小奶猫', xp: 0 }, { level: 2, title: '好奇小猫', xp: 60 },
    { level: 3, title: '探险小猫', xp: 180 }, { level: 4, title: '铃铛收藏家', xp: 360 },
    { level: 5, title: '夜行捕手', xp: 600 }, { level: 6, title: '云端漫游猫', xp: 950 },
    { level: 7, title: '星空领航猫', xp: 1400 }, { level: 8, title: '传说大猫猫', xp: 2000 },
    { level: 9, title: '浅滩试水猫', xp: 2900 }, { level: 10, title: '鱼干品鉴师', xp: 4000 },
    { level: 11, title: '深海垂钓猫', xp: 5300 }, { level: 12, title: '月光守夜猫', xp: 6800 },
    { level: 13, title: '云端长老猫', xp: 8500 }, { level: 14, title: '星图绘制者', xp: 10500 },
    { level: 15, title: '银河放牧猫', xp: 13000 }, { level: 16, title: '导航守护神猫', xp: 16000 }
  ];
  function readGrowthSummary() {
    try {
      var raw = window.localStorage.getItem(GROWTH_SUMMARY_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      return s;
    } catch (e) { return null; }
  }
  function readGrowth() {
    var base = { totalXp: 0, features: {}, categories: [], scenes: [], activeDates: [], dramaDates: [], dayStates: {}, idleTotalMinutes: 0, homepageClaimedAt: null };
    try {
      var raw = window.localStorage.getItem(GROWTH_KEY);
      if (!raw) return base;
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || Array.isArray(p)) return base;
      var strArr = function (x) { return Array.isArray(x) ? x.filter(function (s) { return typeof s === 'string'; }) : []; };
      return {
        totalXp: (typeof p.totalXp === 'number' && isFinite(p.totalXp) && p.totalXp >= 0) ? Math.floor(p.totalXp) : 0,
        features: (p.features && typeof p.features === 'object' && !Array.isArray(p.features)) ? p.features : {},
        categories: strArr(p.categories), scenes: strArr(p.scenes),
        activeDates: strArr(p.activeDates), dramaDates: strArr(p.dramaDates),
        dayStates: (p.dayStates && typeof p.dayStates === 'object' && !Array.isArray(p.dayStates)) ? p.dayStates : {},
        idleTotalMinutes: (typeof p.idleTotalMinutes === 'number' && isFinite(p.idleTotalMinutes) && p.idleTotalMinutes >= 0) ? Math.floor(p.idleTotalMinutes) : 0,
        homepageClaimedAt: typeof p.homepageClaimedAt === 'string' ? p.homepageClaimedAt : null
      };
    } catch (e) { return base; }
  }
  function levelOf(xp) {
    var cur = LEVELS4[0];
    for (var i = 0; i < LEVELS4.length; i++) if (xp >= LEVELS4[i].xp) cur = LEVELS4[i];
    return cur;
  }
  function streakOf(p) {
    // v2：优先读引擎摘要（04:00 切日 + 冻结/抢救口径都在引擎里算好）
    var sum = readGrowthSummary();
    if (sum && typeof sum.streak === 'number') return sum.streak;
    // 回退（档案还是 v1 或摘要未生成）：点亮日 ∪ 垫付/抢救日，休息日透明
    var present = {};
    p.activeDates.forEach(function (d) { present[d] = 1; });
    Object.keys(p.dayStates || {}).forEach(function (k) {
      var s = p.dayStates[k];
      if (s === 'lit' || s === 'frozen' || s === 'rescued') present[k] = 1;
      else if (s === 'rest') present[k] = 2;
    });
    var cursor = new Date();
    if (!present[todayKeyStr(cursor)]) cursor.setDate(cursor.getDate() - 1);
    var n = 0, guard = 0;
    while (guard < 4000) {
      var v = present[todayKeyStr(cursor)];
      if (v === 1) n += 1;
      else if (v === 2) { /* 休息日透明 */ }
      else break;
      cursor.setDate(cursor.getDate() - 1);
      guard += 1;
    }
    return n;
  }
  function featCount(p, k) { var f = p.features[k]; return (f && typeof f.count === 'number') ? f.count : 0; }
  function badgesOf(p) {
    var used = Object.keys(p.features).length;
    var st = streakOf(p);
    var defs = [
      { id: 'first-step', title: '第一步', icon: '🐾', ok: used >= 1 },
      { id: 'ai-helper', title: 'AI 找站新手', icon: '🔍', ok: featCount(p, 'ai_find') >= 1 },
      { id: 'cat-talk', title: '猫语者', icon: '💬', ok: featCount(p, 'ai_chat') >= 1 },
      { id: 'scene-explorer', title: '场景探索者', icon: '🧭', ok: p.scenes.length >= 5 },
      { id: 'scene-master', title: '场景大师', icon: '🎒', ok: p.scenes.length >= 12 },
      { id: 'category-explorer', title: '分类漫游者', icon: '🗺️', ok: p.categories.length >= 5 },
      { id: 'category-master', title: '全站通', icon: '🌏', ok: p.categories.length >= 10 },
      { id: 'drama-fan', title: '追剧达人', icon: '🎬', ok: p.dramaDates.length >= 3 },
      { id: 'collector', title: '收藏家', icon: '⭐', ok: featCount(p, 'favorite_add') >= 5 },
      { id: 'streak-3', title: '三天打卡', icon: '🔥', ok: st >= 3 },
      { id: 'streak-7', title: '一周不断档', icon: '🏆', ok: st >= 7 },
      { id: 'idle-buddy', title: '陪伴时光', icon: '🌙', ok: p.idleTotalMinutes >= 60 },
      { id: 'homepage-guardian', title: '首页守护者', icon: '🏠', ok: p.homepageClaimedAt !== null }
    ];
    return defs.filter(function (d) { return d.ok; });
  }
  var growthChipEl = null;
  function refreshGrowthChip() {
    if (!growthChipEl) return;
    var s = readGrowthSummary();
    if (!s || typeof s.level !== 'number') { growthChipEl.classList.remove('xm-on'); return; }
    var tierIcon = s.level <= 4 ? '🐾' : s.level <= 8 ? '🔔' : s.level <= 12 ? '🐟' : '👑';
    var dots = (s.dots || []).map(function (d) { return d ? '●' : '○'; }).join('');
    growthChipEl.textContent =
      tierIcon + ' Lv.' + s.level +
      (s.streak > 0 ? ' · 连胜 ' + s.streak + ' 天' : '') +
      (dots ? ' · 今日 ' + dots : '') +
      (s.freezeCards > 0 ? ' · ❄' + s.freezeCards : '') +
      (s.chestAvailable ? ' · 🎁可开' : '');
    growthChipEl.classList.add('xm-on');
  }
  /* C-12/A P1-2：收起/睡眠时到的升级庆祝先排队，不写盘见证、不丢弃；
     唤回/唤醒后由 flushPendingCelebration 补发。队列只活在内存里——
     刷新后见证未推进，9.5 秒复查会重新算出同一批增量再排队，不丢。 */
  var pendingCelebration = null;
  function celebrateGrowth(text) {
    undock();
    setPose('milestone');
    happyBounce();
    burst(14);
    celebrateVideo('levelup');
    showEmo('★');
    showBubble(text, true);
    window.setTimeout(function () {
      if (currentPose === 'milestone' && !root.classList.contains('xm-open')) setPose('main');
    }, 4200);
  }
  function flushPendingCelebration() {
    if (!pendingCelebration) return false;
    if (root.classList.contains('xm-closed') || sleeping) return false;
    var p = pendingCelebration;
    pendingCelebration = null;
    /* 见证在补发时才写盘——补发前见证不动，复查会重新算出同一批增量覆盖队列。 */
    v4.seenLevel = Math.max(v4.seenLevel, p.level);
    v4.seenBadges = p.ids;
    persistV4();
    if (root.classList.contains('xm-open')) { addCatText(p.text); return true; }
    celebrateGrowth(p.text);
    return true;
  }
  function checkGrowth(announce) {
    var p = readGrowth();
    refreshGrowthChip();
    var lv = levelOf(p.totalXp);
    var earned = badgesOf(p);
    var ids = earned.map(function (b) { return b.id; });
    if (v4.seenBadges === null) {
      v4.seenLevel = lv.level;
      v4.seenBadges = ids;
      persistV4();
      return;
    }
    if (!announce) return;
    var newOnes = earned.filter(function (b) { return v4.seenBadges.indexOf(b.id) < 0; });
    var leveled = lv.level > v4.seenLevel;
    if (!leveled && !newOnes.length) return;
    var parts = [];
    if (leveled) parts.push('哇！你升级啦：Lv.' + lv.level + '「' + lv.title + '」🎉');
    if (newOnes.length) {
      parts.push('新徽章点亮：' + newOnes.slice(0, 2).map(function (b) { return b.icon + '「' + b.title + '」'; }).join('、') + (newOnes.length > 2 ? ' 等 ' + newOnes.length + ' 枚' : '') + '！');
    }
    var text = parts.join(' ');
    if (root.classList.contains('xm-open')) {
      v4.seenLevel = Math.max(v4.seenLevel, lv.level);
      v4.seenBadges = ids;
      persistV4();
      addCatText(text);
      return;
    }
    if (root.classList.contains('xm-closed') || sleeping) {
      /* C-12：收起/睡眠时不写盘见证、不丢弃——排队等唤回/唤醒后补发。
         下次复查会重新算出同一批增量覆盖队列，不重复、不丢失。 */
      pendingCelebration = { text: text, level: lv.level, ids: ids };
      return;
    }
    v4.seenLevel = Math.max(v4.seenLevel, lv.level);
    v4.seenBadges = ids;
    persistV4();
    celebrateGrowth(text);
  }
  function initGrowthWatch() {
    checkGrowth(false);
    try { window.addEventListener('navhub:growth-updated', function () { checkGrowth(true); }); } catch (e) { /* 忽略 */ }
    try {
      window.addEventListener('storage', function (e) {
        if (e && e.key === GROWTH_KEY) checkGrowth(true);
      });
    } catch (e) { /* 忽略 */ }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkGrowth(true);
    });
  }

  /* ---------- v4：喂小鱼干（每日 5 条，饱食度真实衰减/回升，吃够会拒绝） ---------- */
  var FEED_LINES = ['好香！小鱼干最好吃啦', '咔哧咔哧……嗯，满足', '谢谢投喂，今天也元气满满', '一条小鱼干，快乐一整天'];
  var dockBox = root.querySelector('.xm-dock');
  var closeBtnEl = root.querySelector('.xm-close-btn');
  // 成长等级行：坞内第一行（整行宽，不遮猫本体），只读引擎摘要
  var chipEl = document.createElement('div');
  chipEl.className = 'xm-growth-chip';
  chipEl.setAttribute('aria-hidden', 'true');
  dockBox.insertBefore(chipEl, dockBox.firstChild);
  growthChipEl = chipEl;
  refreshGrowthChip();
  var fishBtn = document.createElement('button');
  fishBtn.className = 'xm-btn xm-fish-btn';
  fishBtn.type = 'button';
  fishBtn.innerHTML = ICONS.fish + '<span class="xm-fish-n"></span>';
  fishBtn.setAttribute('aria-label', '喂小猫猫吃小鱼干');
  var fishNEl = fishBtn.querySelector('.xm-fish-n');
  dockBox.insertBefore(fishBtn, closeBtnEl);
  var gameBtn = document.createElement('button');
  gameBtn.className = 'xm-btn xm-game-btn';
  gameBtn.type = 'button';
  gameBtn.innerHTML = ICONS.star;
  gameBtn.title = '和小猫猫玩接星星';
  gameBtn.setAttribute('aria-label', '和小猫猫玩接星星');
  dockBox.insertBefore(gameBtn, closeBtnEl);
  /* K4：一键归位钮（与喂鱼/接星星同款插入位置：关闭钮之前）。拖乱位置后点它
     即回默认右下角，并清掉已存拖动位置（见 resetCatPos）。 */
  var resetBtn = document.createElement('button');
  resetBtn.className = 'xm-btn xm-reset-btn';
  resetBtn.type = 'button';
  resetBtn.innerHTML = ICONS.reset;
  resetBtn.title = '把小猫放回右下角';
  resetBtn.setAttribute('aria-label', '把小猫放回右下角');
  dockBox.insertBefore(resetBtn, closeBtnEl);
  resetBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    markActive();
    resetCatPos();
  });
  /* 互动玩法第一批 Top 3：游乐场开关（与喂鱼/接星星/归位同款插入位置：关闭钮之前）。
     aria-pressed 反映开关态；点它进/出游乐场（追鼠标 + 扑光标 + 满屏散步）。 */
  var playBtn = document.createElement('button');
  playBtn.className = 'xm-btn xm-play-btn';
  playBtn.type = 'button';
  playBtn.innerHTML = ICONS.chase;
  playBtn.title = '跟小猫猫一起玩（追鼠标）';
  playBtn.setAttribute('aria-label', '跟小猫猫一起玩（追鼠标）');
  playBtn.setAttribute('aria-pressed', 'false');
  dockBox.insertBefore(playBtn, closeBtnEl);
  playBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    markActive();
    setPlayMode(!play.on);
  });
  function updateFishBtn() {
    rollFishDay();
    var left = Math.max(0, 5 - v4.fishCount);
    fishNEl.textContent = left;
    fishNEl.style.display = left > 0 ? 'block' : 'none';
    fishBtn.title = left > 0 ? ('喂小猫猫吃小鱼干（今天还剩 ' + left + ' 条）') : '今天的小鱼干喂完啦，明天再来';
  }
  function feedFish() {
    interacted = true;
    markActive();
    if (sleeping) { wakeUp(true); return; }
    if (root.classList.contains('xm-open')) return;
    rollFishDay();
    if (v4.fishCount >= 5) {
      setPose('idle');
      showBubble('今天的小鱼干吃够啦，明天再喂我哦～（饱食度 ' + Math.round(currentSat()) + '%）', true);
      window.setTimeout(function () {
        if (currentPose === 'idle' && !sleeping) setPose('main');
      }, 2600);
      updateFishBtn();
      return;
    }
    v4.fishCount += 1;
    v4.sat = Math.min(100, currentSat() + 22);
    v4.satAt = Date.now();
    persistV4();
    updateFishBtn();
    var f = document.createElement('i');
    f.className = 'xm-fish-i';
    f.innerHTML = ICONS.fish;
    fxEl.appendChild(f);
    window.setTimeout(function () { f.remove(); }, 820);
    setPose('making');
    playExprVideo('shy', false); /* v8：喂鱼配害羞脸红动画（04），静音短循环 */
    happyBounce();
    window.setTimeout(function () {
      if (sleeping) return;
      setPose('milestone');
      burst(8);
      showEmo('♥');
    }, 430);
    var line = v4.sat >= 96 ? '嗝～吃饱饱啦，谢谢你！' : pickOne(FEED_LINES);
    showBubble(line + '（饱食度 ' + Math.round(v4.sat) + '%）', true);
    window.setTimeout(function () {
      if (!sleeping && !root.classList.contains('xm-open') && currentPose === 'milestone') setPose('main');
    }, 3400);
  }
  fishBtn.addEventListener('click', function (ev) { ev.stopPropagation(); feedFish(); });
  updateFishBtn();

  /* ---------- v4：接星星小游戏（30 秒计分，金星 3 分，最高分存本机） ---------- */
  var gameEl = document.createElement('div');
  gameEl.className = 'xm-game';
  gameEl.setAttribute('role', 'dialog');
  gameEl.setAttribute('aria-modal', 'true');
  gameEl.setAttribute('aria-label', '接星星小游戏');
  gameEl.innerHTML =
    '<div class="xm-g-head"><span class="xm-g-title">' + ICONS.star + '接星星</span><button class="xm-hbtn xm-g-close" type="button" title="关掉游戏" aria-label="关掉游戏">' + ICONS.close + '</button></div>' +
    '<div class="xm-g-hud"><span>得分 <b class="xm-g-score">0</b></span><span>时间 <b class="xm-g-time">30</b> 秒</span><span>最高 <b class="xm-g-best">0</b></span></div>' +
    '<div class="xm-g-area">' +
    '<div class="xm-g-center"><div class="xm-g-big">接住掉下来的星星！</div><div class="xm-g-sub">30 秒里点中星星得分，金色星星 3 分。<br>最高分会记在这台设备上。</div><button class="xm-g-start" type="button">开始游戏</button></div>' +
    '</div>';
  root.querySelector('.xm-main-col').appendChild(gameEl);
  var gArea = gameEl.querySelector('.xm-g-area');
  var gScoreEl = gameEl.querySelector('.xm-g-score');
  var gTimeEl = gameEl.querySelector('.xm-g-time');
  var gBestEl = gameEl.querySelector('.xm-g-best');
  var gCenter = gameEl.querySelector('.xm-g-center');
  var gBig = gameEl.querySelector('.xm-g-big');
  var gSub = gameEl.querySelector('.xm-g-sub');
  var gStartBtn = gameEl.querySelector('.xm-g-start');
  var game = { on: false, score: 0, left: 30, spawnT: 0, tickT: 0, stars: [] };
  function gHud() {
    gScoreEl.textContent = game.score;
    gTimeEl.textContent = Math.max(0, Math.ceil(game.left));
    gBestEl.textContent = v4.gameBest;
  }
  function clearStars() {
    game.stars.slice().forEach(function (s) {
      window.clearTimeout(s._t);
      s.remove();
    });
    game.stars = [];
  }
  function endGame(finished) {
    if (game.tickT) window.clearInterval(game.tickT);
    if (game.spawnT) window.clearInterval(game.spawnT);
    game.tickT = 0;
    game.spawnT = 0;
    game.on = false;
    clearStars();
    if (finished) {
      var isBest = game.score > v4.gameBest;
      if (isBest) { v4.gameBest = game.score; persistV4(); }
      gBig.textContent = '时间到！';
      gSub.innerHTML = '你接住了 <b>' + game.score + '</b> 分' + (isBest && game.score > 0 ? '，新纪录！🎉' : '，最高纪录 ' + v4.gameBest + ' 分');
      gStartBtn.textContent = '再来一局';
      gCenter.style.display = 'flex';
      if (isBest && game.score > 0) {
        setPose('milestone');
        burst(12);
        showEmo('★');
        celebrateVideo('record');
        window.setTimeout(function () {
          if (currentPose === 'milestone' && !root.classList.contains('xm-open')) setPose('main');
        }, 3000);
      }
    }
    gHud();
  }
  function spawnStar() {
    if (!game.on) return;
    var s = document.createElement('button');
    s.type = 'button';
    s.className = 'xm-g-star';
    var gold = Math.random() < 0.18;
    s.innerHTML = gold ? ICONS.starGold : ICONS.starSoft;
    s.setAttribute('aria-label', '星星，点我接住它');
    var w = gArea.clientWidth || 300;
    s.style.left = (24 + Math.random() * Math.max(10, w - 48)) + 'px';
    s.style.top = '-44px';
    var dur = 2100 + Math.random() * 1100;
    s.style.animationDuration = dur + 'ms';
    s.style.setProperty('--fall', ((gArea.clientHeight || 300) + 80) + 'px');
    var val = gold ? 3 : 1;
    var done = false;
    var kill = function (scored) {
      if (done) return;
      done = true;
      window.clearTimeout(s._t);
      var idx = game.stars.indexOf(s);
      if (idx >= 0) game.stars.splice(idx, 1);
      if (scored) {
        game.score += val;
        gHud();
        var pop = document.createElement('span');
        pop.className = 'xm-g-pop';
        pop.textContent = '+' + val;
        pop.style.left = s.style.left;
        pop.style.top = '42%';
        gArea.appendChild(pop);
        window.setTimeout(function () { pop.remove(); }, 850);
      }
      s.remove();
    };
    s.addEventListener('click', function () { kill(true); });
    s._t = window.setTimeout(function () { kill(false); }, dur + 40);
    game.stars.push(s);
    gArea.appendChild(s);
  }
  function startGame() {
    endGame(false);
    game.on = true;
    game.score = 0;
    game.left = 30;
    gCenter.style.display = 'none';
    gHud();
    spawnStar();
    game.spawnT = window.setInterval(spawnStar, 620);
    game.tickT = window.setInterval(function () {
      game.left -= 0.25;
      gTimeEl.textContent = Math.max(0, Math.ceil(game.left));
      if (game.left <= 0) endGame(true);
    }, 250);
    setPose('milestone');
    happyBounce();
    window.setTimeout(function () { if (currentPose === 'milestone') setPose('main'); }, 1600);
  }
  function openGame() {
    interacted = true;
    markActive();
    undock();
    hideControls();
    if (root.classList.contains('xm-open')) closePanel();
    root.classList.remove('xm-closed');
    wakeUp(false);
    hideBubble();
    if (panelEl.classList.contains('xm-left')) gameEl.classList.add('xm-left');
    else gameEl.classList.remove('xm-left');
    if (!game.on) {
      gBig.textContent = '接住掉下来的星星！';
      gSub.innerHTML = '30 秒里点中星星得分，金色星星 3 分。<br>最高分会记在这台设备上。';
      gStartBtn.textContent = '开始游戏';
      gCenter.style.display = 'flex';
    }
    lastFocusBeforeModal = document.activeElement; /* B-08：记触发焦点，关闭时还回去 */
    gameEl.classList.add('xm-on');
    gHud();
    /* B-08：开局前聚焦开始按钮，进行中聚焦关闭钮。 */
    try { if (game.on) gameEl.querySelector('.xm-g-close').focus(); else gStartBtn.focus(); } catch (e) { /* 忽略 */ }
  }
  function closeGame() {
    endGame(false);
    gameEl.classList.remove('xm-on');
    /* B-08：焦点还给打开游戏前的位置（同 closePanel：触发钮在坞里，先唤出坞再聚焦）。
       合入注：showControls 已改 showControls(fromUser)（状态线），这里须传 true。 */
    if (lastFocusBeforeModal && lastFocusBeforeModal.focus) {
      try {
        if (dockEl && dockEl.contains(lastFocusBeforeModal)) showControls(true);
        lastFocusBeforeModal.focus();
        if (document.activeElement !== lastFocusBeforeModal) stageEl.focus();
      } catch (e) { try { stageEl.focus(); } catch (e2) { /* 忽略 */ } }
    }
    lastFocusBeforeModal = null;
  }
  gStartBtn.addEventListener('click', startGame);
  gameEl.querySelector('.xm-g-close').addEventListener('click', function (ev) {
    ev.stopPropagation();
    closeGame();
  });
  gameBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (gameEl.classList.contains('xm-on')) closeGame();
    else openGame();
  });

  /* ---------- v4：语音输入（不支持的浏览器不创建按钮，绝不摆假按钮） ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    var micBtn = document.createElement('button');
    micBtn.className = 'xm-mic';
    micBtn.type = 'button';
    micBtn.innerHTML = ICONS.mic;
    micBtn.title = '语音输入：点一下直接说话找站';
    micBtn.setAttribute('aria-label', '语音输入');
    root.querySelector('.xm-form').insertBefore(micBtn, sendBtn);
    var rec = null, listening = false;
    micBtn.addEventListener('click', function () {
      if (listening && rec) {
        try { rec.stop(); } catch (e) { /* 忽略 */ }
        return;
      }
      try {
        rec = new SR();
        rec.lang = 'zh-CN';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = function (ev) {
          var t = '';
          try { t = ev.results[0][0].transcript || ''; } catch (e) { /* 忽略 */ }
          if (t) {
            inputEl.value = t;
            sendChat(t);
          }
        };
        rec.onerror = function (ev) {
          if (ev && ev.error === 'not-allowed') addNote('麦克风权限没开，用打字也可以找我～');
          else if (ev && ev.error === 'no-speech') addNote('没听清，再点一次麦克风试试');
          else if (ev && ev.error === 'audio-capture') addNote('没找到麦克风，用打字找我吧');
        };
        rec.onend = function () {
          listening = false;
          micBtn.classList.remove('xm-mic-live');
        };
        rec.start();
        listening = true;
        micBtn.classList.add('xm-mic-live');
      } catch (e) { /* 识别不可用时静默，打字通道不受影响 */ }
    });
  }

  /* ---------- v4：分页面小提示（进页 26 秒后、没互动过才冒一次） ---------- */
  window.setTimeout(function () {
    if (interacted || sleeping || userTyping) return; /* P1-1：输入聚焦时不冒提示气泡 */
    if (root.classList.contains('xm-open') || root.classList.contains('xm-closed')) return;
    if (document.hidden) return;
    var pt = pageTopic();
    if (pt) {
      showBubble(pt.tip, false);
      happyBounce();
    }
  }, 26000);

  /* ---------- v6：用户自改形象（图库挑选 + 上传，全存本机） ---------- */
  var lookEl = root.querySelector('.xm-look');
  var lookGrid = root.querySelector('.xm-look-grid');
  var lookFile = root.querySelector('.xm-look-file');
  var lookNote = root.querySelector('.xm-look-note');
  /* 2026-11-18 删静态图：内置图库（皇冠/经典/深色）已随静态图删除；图库只剩
     「默认视频」与用户上传。旧存档里的内置选择静默退化为默认视频猫。 */
  function showLookNote(t) { if (lookNote) lookNote.textContent = t; }
  function selLookKey() {
    if (!avatarPick) return 'def';
    return 'U';
  }
  function renderLook() {
    lookGrid.innerHTML = '';
    var items = [{ key: 'def', label: '默认视频', thumb: ASSETS + 'media/play-idle.webp' }];
    if (avatarPick && avatarPick.kind === 'upload') items.push({ key: 'U', label: '我的上传', thumb: avatarPick.data });
    var sk = selLookKey();
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xm-look-item' + (it.key === sk ? ' xm-sel' : '');
      b.setAttribute('data-look', it.key);
      var im = document.createElement('img');
      im.src = it.thumb;
      im.alt = '';
      var sp = document.createElement('span');
      sp.textContent = it.label;
      b.appendChild(im);
      b.appendChild(sp);
      b.addEventListener('click', function () { pickLook(it.key); });
      lookGrid.appendChild(b);
    });
  }
  function persistAvatarChecked() {
    persistAvatar();
    try {
      var back = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
      if (!avatarPick) return !!(back && !back.avatar);
      return !!(back && back.avatar && back.avatar.kind === 'upload' && back.avatar.data === avatarPick.data);
    } catch (e) { return false; }
  }
  function pickLook(key) {
    var prev = avatarPick;
    if (key === 'def') avatarPick = null;
    else if (key === 'U') { if (!prev || prev.kind !== 'upload') return; }
    else return; /* 2026-11-18 删静态图：内置图库选择已取消，未知键直接忽略 */
    if (!persistAvatarChecked()) {
      avatarPick = prev;
      persistAvatar();
      showLookNote('浏览器存不下这个选择，先恢复成刚才的啦');
      return;
    }
    stopCelebVideo(); /* v8 复审返工：换形象即停视频，滞后的探活链凭令牌丢弃 */
    refreshAvatarImages();
    renderLook();
    showLookNote(avatarPick ? '好啦，以后就用这个形象陪你～' : '恢复默认啦，视频猫回来咯');
    /* 默认视频：用户选了单张形象就停默认视频，恢复默认再播 */
    if (avatarPick) stopAmbientVideo(); else startAmbientVideo();
  }
  function encodeSquareImage(img, size, q) {
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var w = img.naturalWidth || img.width || size, h = img.naturalHeight || img.height || size;
    var side = Math.min(w, h);
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    var out = null;
    try { out = canvas.toDataURL('image/webp', q); } catch (e) { /* 忽略 */ }
    if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', q);
    return out;
  }
  function openLook() { renderLook(); panelEl.classList.add('xm-looking'); }
  function closeLook() { panelEl.classList.remove('xm-looking'); }
  root.querySelector('.xm-look-btn').addEventListener('click', function (ev) { ev.stopPropagation(); openLook(); });
  root.querySelector('.xm-look-back').addEventListener('click', function (ev) { ev.stopPropagation(); closeLook(); });
  root.querySelector('.xm-look-default').addEventListener('click', function () { pickLook('def'); });
  root.querySelector('.xm-look-upload').addEventListener('click', function () { lookFile.click(); });
  lookFile.addEventListener('change', function () {
    var file = lookFile.files && lookFile.files[0];
    lookFile.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { showLookNote('这个文件不是图片哦，换一张试试'); return; }
    var objUrl = null;
    try { objUrl = URL.createObjectURL(file); } catch (e) { /* 忽略 */ }
    if (!objUrl) { showLookNote('这张图读不了，换一张试试'); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var data = encodeSquareImage(img, 256, 0.85);
        var tries = 0;
        while (data.length > 420000 && tries < 3) {
          tries++;
          data = encodeSquareImage(img, 256 - tries * 48, 0.8 - tries * 0.08);
        }
        try { URL.revokeObjectURL(objUrl); } catch (e) { /* 忽略 */ }
        if (!data || data.length > 450000) { showLookNote('这张图压缩完还是太大，换一张小一点的吧'); return; }
        var prev = avatarPick;
        avatarPick = { kind: 'upload', data: data };
        if (!persistAvatarChecked()) {
          avatarPick = prev;
          persistAvatar();
          showLookNote('浏览器空间不够，这张图存不下，换张小一点的');
          return;
        }
        stopCelebVideo(); /* v8 复审返工：换形象即停视频，滞后的探活链凭令牌丢弃 */
        stopAmbientVideo(); /* 上传了自己的图：默认视频停，用户形象优先 */
        refreshAvatarImages();
        renderLook();
        showLookNote('存好啦！这张图只在这台设备上陪你～');
      } catch (e) {
        showLookNote('这张图处理不了，换一张试试');
      }
    };
    img.onerror = function () {
      try { URL.revokeObjectURL(objUrl); } catch (e) { /* 忽略 */ }
      showLookNote('这张图读不了，换一张试试');
    };
    img.src = objUrl;
  });

  /* ---------- 入场 ---------- */
  root.classList.add('xm-enter');
  checkMediaManifest(); /* C-02：启动时核对媒体清单，缺失只告警、不拦猫 */
  /* v7：控件平时藏起来，新访客可能不知道猫能点——首次访问时坞自动展示一次当自我介绍
     （1.5 秒后淡入、按 3 秒规则自己收起），store.hinted 落盘，之后永不自动出 */
  if (!store.hinted) {
    store.hinted = true;
    persist();
    window.setTimeout(function () {
      if (!root.classList.contains('xm-open') && !root.classList.contains('xm-closed') && !docked) showControls();
    }, 1500);
  }
  var festToday = festivalToday();
  if (festToday) showDeco(festToday.deco);
  initGrowthWatch();
  /* P1-1：市场页窄屏进页即自动收起（须在 850ms 招呼前生效，招呼的
     !xm-closed 守门会顺带跳过它）。 */
  syncMarketPark();
  window.setTimeout(function () { burst(8); }, 380);
  window.setTimeout(function () {
    greeted = true;
    /* C-15：850ms 内用户动过手（点/按）就跳过本次自动招呼——别跟用户点的气泡抢文案。 */
    if (userActed) return;
    if (!root.classList.contains('xm-open') && !root.classList.contains('xm-closed')) {
      setPose('waking');
      /* v12：850ms 招呼多半还没手势——先出气泡不读；首次手势后补读一次（且仅当气泡还在时）。 */
      var greetText = composeGreeting();
      /* c3001：先把文案放进未显示的气泡再量——会盖住正文卡片就跳过本次自动招呼（猫还在，点猫照常聊天）。 */
      bubbleEl.textContent = greetText;
      if (autoGreetWouldCoverContent()) {
        bubbleEl.textContent = '';
      } else {
        showBubble(greetText, hasUserActivation());
        if (!hasUserActivation()) {
          var speakGreet = function () {
            document.removeEventListener('pointerdown', speakGreet);
            document.removeEventListener('keydown', speakGreet);
            if (greetText && root.querySelector('.xm-bubble.xm-show')) speak(greetText);
          };
          document.addEventListener('pointerdown', speakGreet, { passive: true });
          document.addEventListener('keydown', speakGreet);
        }
      }
      window.setTimeout(function () { if (currentPose === 'waking' && !sleeping) setPose('main'); }, 3400);
    }
  }, 850);
  /* 跨会话的升级/新徽章：等招呼说完再庆祝，不抢戏 */
  window.setTimeout(function () { checkGrowth(true); }, 9500);
  /* 互动玩法第一批：演示页用 window.XIAOMAOMAO_PLAY = true 开局进游乐场；
     否则按用户上次的选择（store.play）恢复。减动效用户不自动开。 */
  if (!reducedMotion && (window.XIAOMAOMAO_PLAY === true || store.play)) {
    /* A P1-3：回调内再查一次收起——1200ms 内用户刚收起过就不再自启，
       只查外层条件防不住这个竞态。 */
    window.setTimeout(function () { if (store.closed) return; setPlayMode(true); }, 1200);
  }
  /* 默认显示走透明视频（2026-11-18）：游乐场没开时也播 idle 透明循环；减动效/
     自改形象/收起态时不播；不支持 VP9 透明/文件不在时走 WebP 兜底，不报错、不留白。 */
  window.setTimeout(function () { if (!play.on) startAmbientVideo(); }, 600);
})();
