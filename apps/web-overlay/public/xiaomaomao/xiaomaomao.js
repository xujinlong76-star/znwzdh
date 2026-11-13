// 小猫猫网站 AI 助手挂件 v11（合并版）：右下角悬浮的粉色小猫（Muse 当前头像真图 + 同套姿势图），
// 能聊天找站、会说话、会卖萌、会睡觉，还能摸、能喂、能一起玩接星星。
// v8（2026-11-12，William 指示换皇冠全套新版）：
//   ①默认形象整套换皇冠版——13 张皇冠表情进 POSES（状态映射见 POSES 上方注释），
//   旧形象不删：整套保留为图库「经典 / 经典深色」选项（POSES_CLASSIC / POSES_DARK），
//   老用户的经典存档选择原样有效；默认不再跟随深浅主题换图。
//   ②皇冠动画接入——互动时播静音短循环（media/crown-animations/expr-*.webm，探活回退、懒加载、
//   离屏暂停、减动效不播、常驻主态仍是静态图）；带声音版（media/crown-animations/snd-*.mp4）只在
//   用户主动点猫时才播、默认静音，绝不自动外放（petSoundArmed 一次性授权位）。
//   ③深色模式如实登记缺口：皇冠套没有深色变体，不拿浅色图冒充——深色下舞台改走
//   柔和奶油底衬 + 暖金光晕影（CSS html.dark .xm-stage），图本身与浅色模式同一套。
//   ④v7 铁律不回退：控件零遮挡猫本体、悬浮坞按需唤出、图标全套手工 SVG。
// v12（2026-11-13，Lighthouse Wave 1）：姿势图外置 poses/*.webp（JS 3.55MB→约 130KB 代码；
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
//   （或用 window.XIAOMAOMAO_MEDIA 指向 CDN），文件不在时回退既有图片庆祝，绝不摆假视频；
//   ②可拖动补强——触摸拖动（touch-action:none）、钳制改按根节点真实尺寸、pointercancel 兜底；
//   ③闲时贴边收缩——60 秒不理小猫自动滑到最近的窗口左右边缘半藏（露约半张脸），
//   悬停/点按弹回；聊天面板/游戏开着、拖动中、收起态不缩；
//   ④用户自改形象——聊天面板里从整套在用图挑一张当主形象，或上传自己的图片
//   （浏览器内裁方压缩、≤约 420KB，只存本机 localStorage，可恢复默认；单图时降级为静态主图+既有动效）。
//   AI 生成形象待站点上线接通 Agnes 后再做，本版不含。
// v5 为美工升级：设计令牌化（粉色成体系、深浅双主题跟随站点 html.dark）、舞台去扫光去辉光加地面影、
// 操作钮改 2×2 玻璃格内嵌舞台角（不再溢出视口）、聊天钮独立成舞台角徽、面板锚定主列且移动端改贴底 sheet、
// 气泡绝对定位不再撑宽根节点；功能与 v4 完全一致，真图 base64 零改动。设计稿见 znwzdh-bigtech-audit/WIDGET_V5_DESIGN.md。
// 用法：把本文件与 poses/ 目录一起放进 Next.js 的 public/xiaomaomao/ 目录（25 张姿势图为
// poses/*.webp 文件，首屏只拉 main 图，其余空闲时预载；经典套已统一缩到 512px），
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
//  - 多姿势状态动画：待机/招呼/思考（working）/庆祝（milestone）/卖萌（making）姿势图
//    交叉淡入淡出，叠加呼吸浮动、入场弹跳、爱心星星粒子、鼠标靠近探头跟随；
//    动画只用 transform/opacity，prefers-reduced-motion 时自动降级。
//  - 礼仪：可拖动（位置记住）、可收起成小圆标再唤回、移动端缩小不挡内容。
(function () {
  if (document.getElementById('xiaomaomao')) return;
  var base = (document.currentScript && document.currentScript.src || '/xiaomaomao/xiaomaomao.js').replace(/[^/]*$/, '');
  var ASSETS = base; // v12：姿势图已外置到 poses/ 目录，拼脚本所在目录前缀（CDN 部署也能跟走）
  var CHAT_URL = '/api/hub/ai/chat';
  var FIND_URL = '/api/hub/ai/find';
  var STORE_KEY = 'navhub.xiaomaomao.v1';
  var reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 忽略 */ }

  /* ---------- v8：皇冠全套（默认形象，William 2026-11-11 确认启用为 Muse 当前形象） ----------
     状态映射（源文件 xiaomaomao-expressions/crown/singles，512px 编码）：
     main=00 皇冠主图 / milestone=01 开心大笑（庆祝·升级） / making=02 眨眼卖萌（打招呼·摸猫回应） /
     surprised=03 惊喜（摸猫躲开） / shy=04 害羞脸红（喂小鱼干·被夸） / heart=05 爱心眼（收藏成功） /
     waking=06 困困打哈欠（打招呼·刚醒） / grumpy=07 鼓脸小生气（失败提示） / teary=08 委屈泪汪汪（没找到结果） /
     working=09 好奇张望（思考·找站中） / clever=10 机灵侧目（游戏纪录） / pleading=11 委屈垂耳（求再试） /
     idle=12 困困垂耳（待机·瞌睡）。皇冠版没有深色变体：深色模式共用本套，舞台改走柔和奶油底衬
     （见 CSS 的 html.dark .xm-stage 规则），不拿别的图冒充深色版。 */
  var POSES = {
    main: 'poses/crown-main.webp',
    milestone: 'poses/crown-milestone.webp',
    making: 'poses/crown-making.webp',
    surprised: 'poses/crown-surprised.webp',
    shy: 'poses/crown-shy.webp',
    heart: 'poses/crown-heart.webp',
    waking: 'poses/crown-waking.webp',
    grumpy: 'poses/crown-grumpy.webp',
    teary: 'poses/crown-teary.webp',
    working: 'poses/crown-working.webp',
    clever: 'poses/crown-clever.webp',
    pleading: 'poses/crown-pleading.webp',
    idle: 'poses/crown-idle.webp',
  };

  /* ---------- v6 经典套（旧形象，保留作图库可选项：浅色 POSES_CLASSIC / 深色 POSES_DARK） ---------- */
  var POSES_CLASSIC = {
    main: 'poses/classic-main.webp',
    idle: 'poses/classic-idle.webp',
    waking: 'poses/classic-waking.webp',
    working: 'poses/classic-working.webp',
    making: 'poses/classic-making.webp',
    milestone: 'poses/classic-milestone.webp',
  };
  var POSES_DARK = {
    main: 'poses/dark-main.webp',
    idle: 'poses/dark-idle.webp',
    waking: 'poses/dark-waking.webp',
    working: 'poses/dark-working.webp',
    making: 'poses/dark-making.webp',
    milestone: 'poses/dark-milestone.webp',
  };
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

  /* ---------- 持久化（只存本机：语音开关 + 拖动位置） ---------- */
  var store = { voice: true, pos: null, hinted: false };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.voice === 'boolean') store.voice = saved.voice;
      if (typeof saved.hinted === 'boolean') store.hinted = saved.hinted;
      if (saved.pos && typeof saved.pos.left === 'number' && typeof saved.pos.top === 'number') store.pos = saved.pos;
    }
  } catch (e) { /* 隐私模式等场景下静默退化 */ }
  function persist() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
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

  /* ---------- v6：用户自改形象（只存本机；builtin=站内在用图单张，upload=用户上传图的 data URL） ---------- */
  var avatarPick = null;
  try {
    var savA = (saved && typeof saved === 'object') ? saved.avatar : null;
    if (savA && typeof savA === 'object') {
      if (savA.kind === 'builtin' && POSES[savA.pose]) {
        avatarPick = { kind: 'builtin', set: savA.set === 'dark' ? 'dark' : (savA.set === 'crown' ? 'crown' : 'light'), pose: savA.pose };
      } else if (savA.kind === 'builtin' && savA.set !== 'crown' && (POSES_CLASSIC[savA.pose] || POSES_DARK[savA.pose])) {
        /* v8 前的存档只有经典 6 键（都在皇冠键名里同名存在，上面已收）；此处兜底防键名漂移 */
        avatarPick = { kind: 'builtin', set: savA.set === 'dark' ? 'dark' : 'light', pose: savA.pose };
      } else if (savA.kind === 'upload' && typeof savA.data === 'string' && savA.data.indexOf('data:image/') === 0 && savA.data.length <= 450000) {
        avatarPick = { kind: 'upload', data: savA.data };
      }
    }
  } catch (e) { /* 脏数据静默退化为默认全套姿势 */ }
  function persistAvatar() { store.avatar = avatarPick; persist(); }
  /* 取图唯一出口：自改形象（单张定格）> 默认皇冠全套。
     v8 起默认不再按深浅主题换图：皇冠套没有深色变体，深色靠舞台奶油底衬（CSS）；
     经典浅/深两套只在用户从图库主动选了经典图时才用（set=light/dark）。 */
  function poseSetOf(setName) {
    if (setName === 'dark') return POSES_DARK;
    if (setName === 'light') return POSES_CLASSIC;
    return POSES;
  }
  function poseUrl(name) {
    if (avatarPick) {
      if (avatarPick.kind === 'upload') return avatarPick.data;
      var set = poseSetOf(avatarPick.set);
      return ASSETS + (set[avatarPick.pose] || POSES[name] || POSES.main);
    }
    return ASSETS + (POSES[name] || POSES.main);
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
    arrow: SVG_OPEN + '<path d="M4.5 12h14M13 6l6 6-6 6"/></svg>'
  };

  /* ---------- DOM 骨架 ---------- */
  var css =
    /* v5 设计令牌：颜色/阴影/缓动收敛成变量，深色只换令牌值（站点 .dark 挂在 html 上） */
    '#xiaomaomao{--xm-accent:#f4507e;--xm-accent-deep:#d6336c;--xm-ink:#77243f;--xm-ink-soft:#b06a84;--xm-surface:rgba(255,255,255,.94);--xm-solid:#fffafc;--xm-chip:rgba(255,240,245,.92);--xm-ring:rgba(214,51,108,.16);--xm-stage-ring:#ffd9e7;--xm-shadow-panel:0 24px 48px -12px rgba(43,10,24,.25),0 4px 12px rgba(43,10,24,.08);--xm-shadow-pop:0 8px 20px -6px rgba(43,10,24,.22);--xm-ease:cubic-bezier(.16,1,.3,1);--xm-spring:cubic-bezier(.34,1.56,.64,1);position:fixed;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:99990;font-family:inherit;color:var(--xm-ink);-webkit-tap-highlight-color:transparent}' +
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
    '#xiaomaomao .xm-dock{position:absolute;right:-4px;bottom:calc(100% + 10px);display:flex;flex-direction:row-reverse;gap:6px;padding:6px;border-radius:999px;background:var(--xm-surface);-webkit-backdrop-filter:blur(14px) saturate(1.5);backdrop-filter:blur(14px) saturate(1.5);border:1px solid var(--xm-ring);box-shadow:var(--xm-shadow-pop);z-index:11;opacity:0;visibility:hidden;transform:translateY(8px) scale(.96);transform-origin:bottom right;transition:opacity .22s var(--xm-ease),transform .22s var(--xm-ease),visibility 0s linear .22s;pointer-events:none}' +
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
    '#xiaomaomao .xm-chat-btn{background:linear-gradient(135deg,var(--xm-accent),#ff8fab);color:#fff;border-color:transparent;box-shadow:0 6px 14px -4px rgba(244,80,126,.5)}' +
    '#xiaomaomao .xm-chat-btn:hover{background:linear-gradient(135deg,var(--xm-accent),#ff8fab);filter:brightness(1.07)}' +
    /* 收起小圆标：加深度投影，浅底上不再隐形 */
    '#xiaomaomao .xm-tab{display:none;width:58px;height:58px;border-radius:50%;overflow:visible;border:2px solid var(--xm-stage-ring);background:#fff;cursor:pointer;padding:0;box-shadow:var(--xm-shadow-pop);position:relative;transition:transform .12s var(--xm-ease)}' +
    '#xiaomaomao .xm-tab:hover{transform:scale(1.06)}' +
    '#xiaomaomao .xm-tab img{width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:50% 15%;display:block}' +
    /* v7：收起角标由「聊」字改成 SVG 气泡角标（与全套图标同风格） */
    '#xiaomaomao .xm-tab-badge{position:absolute;right:-2px;bottom:-2px;width:20px;height:20px;border-radius:50%;background:var(--xm-accent);border:2px solid var(--xm-solid);display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none}' +
    '#xiaomaomao .xm-tab-badge svg{width:11px;height:11px;display:block}' +
    '#xiaomaomao.xm-closed .xm-tab{display:block}' +
    '#xiaomaomao.xm-closed .xm-main-col{display:none}' +
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
    '#xiaomaomao .xm-send{flex:none;height:40px;padding:0 17px;border:none;border-radius:999px;background:linear-gradient(135deg,var(--xm-accent),#ff8fab);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px -4px rgba(244,80,126,.45);transition:transform .12s var(--xm-ease),filter .12s var(--xm-ease)}' +
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
    /* v6：庆祝视频层（盖在姿势图上方，舞台圆角裁剪；无视频文件时永不出现） */
    '#xiaomaomao .xm-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;display:none;pointer-events:none}' +
    '#xiaomaomao .xm-video.xm-on{display:block;animation:xmVideoIn .38s var(--xm-ease) both}' +
    '@keyframes xmVideoIn{from{opacity:0}to{opacity:1}}' +
    '#xiaomaomao .xm-stage:focus-visible{outline:2px solid var(--xm-accent);outline-offset:3px}' +
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
    '@media (max-width:640px){#xiaomaomao{right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(68px + env(safe-area-inset-bottom,0px))}#xiaomaomao .xm-main-col{width:88px}#xiaomaomao .xm-wrap{width:88px;height:88px}#xiaomaomao .xm-dock{gap:5px;padding:5px;bottom:calc(100% + 8px)}#xiaomaomao .xm-dock .xm-btn{width:34px;height:34px}#xiaomaomao .xm-dock .xm-btn svg{width:19px;height:19px}#xiaomaomao .xm-bubble{max-width:min(248px,calc(100vw - 130px));font-size:12.5px}#xiaomaomao .xm-panel,#xiaomaomao .xm-game{position:fixed;left:12px;right:12px;width:auto;max-width:none;bottom:calc(104px + env(safe-area-inset-bottom,0px))}#xiaomaomao .xm-panel.xm-left,#xiaomaomao .xm-game.xm-left{left:12px;right:12px}#xiaomaomao .xm-panel{height:min(508px,62vh)}#xiaomaomao .xm-game{height:min(436px,58vh)}}' +
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
        '<div class="xm-stage" role="button" aria-label="小猫猫，点我玩一玩" title="小猫猫"><div class="xm-lean">' +
          '<img class="xm-img-a" alt="小猫猫"><img class="xm-img-b" alt="" aria-hidden="true">' +
        '</div></div>' +
      '</div>' +
      /* v7：悬浮坞挂在主列里、舞台之外（猫上方留白处），平时隐藏；DOM 顺序=聊天/摸猫/语音/关闭，
         喂鱼与接星星钮由 JS 插到关闭钮之前；flex row-reverse 让聊天钮始终贴猫那一端 */
      '<div class="xm-dock" role="toolbar" aria-label="小猫猫的操作按钮">' +
        '<button class="xm-btn xm-chat-btn" type="button" title="跟小猫猫聊天找站" aria-label="跟小猫猫聊天找站">' + ICONS.chat + '</button>' +
        '<button class="xm-btn xm-pet-btn" type="button" title="摸摸小猫猫" aria-label="摸摸小猫猫">' + ICONS.paw + '</button>' +
        '<button class="xm-btn xm-voice-btn" type="button" title="开关小猫语音" aria-label="开关小猫语音">' + ICONS.volOn + '</button>' +
        '<button class="xm-btn xm-close-btn" type="button" title="先把小猫收起来" aria-label="收起小猫猫">' + ICONS.close + '</button>' +
      '</div>' +
      '<div class="xm-panel" role="dialog" aria-label="小猫猫聊天">' +
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
  root.querySelector('.xm-p-head img').src = poseUrl('main');
  root.querySelector('.xm-tab img').src = poseUrl('main');

  /* ---------- 姿势状态机（双层交叉淡入淡出） ---------- */
  var currentPose = 'main';
  var frontImg = imgA, backImg = imgB;
  imgA.src = poseUrl('main');
  imgA.classList.add('xm-on');
  function setPose(name) {
    if (!POSES[name] || name === currentPose) return;
    currentPose = name;
    var url = poseUrl(name);
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
    probe.onerror = function () { /* 姿势图缺失时保持当前姿势，不露破图 */ };
    probe.src = url;
    if (probe.complete && probe.naturalWidth > 0) swap();
  }
  function preloadPoses() {
    if (avatarPick) return; // 单图模式无需预载全套
    ['idle', 'waking', 'making', 'milestone', 'working', 'surprised'].forEach(function (k) {
      var im = new Image(); im.src = poseUrl(k);
    });
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(preloadPoses, { timeout: 4000 });
  else window.setTimeout(preloadPoses, 2500);

  /* ---------- v6：形象刷新（换形象/站点深浅主题切换时统一重绘三处用图） ---------- */
  var lastDark = isDarkTheme();
  function refreshAvatarImages() {
    lastDark = isDarkTheme();
    var mainU = poseUrl('main');
    root.querySelector('.xm-p-head img').src = mainU;
    root.querySelector('.xm-tab img').src = mainU;
    frontImg.src = poseUrl(currentPose);
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
     文件不在时探活失败自动回落静态表情，绝不报错、不留白。 */
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
  function probeMedia(url) {
    if (!mediaProbe[url]) {
      try {
        mediaProbe[url] = window.fetch(url, { method: 'HEAD' })
          .then(function (r) { return !!(r && r.ok); })
          .catch(function () { return false; });
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
  function tryCelebVideo(names, opts, seq) {
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
  /* v8：离屏/切后台停播——猫滚出视口就暂停，切到别的标签页直接收视频（声音版尤其不许在后台响） */
  try {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting && videoEl) stopCelebVideo(); /* v8 复审返工：离屏直接移除，别让暂停定格盖住后面的静态姿势 */
        }
      }, { threshold: 0.05 }).observe(stageEl);
    }
  } catch (e) { /* 老环境无 IO：靠 9 秒兜底收尾 */ }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopCelebVideo(); });

  /* ---------- 气泡（打字机） ---------- */
  var typeTimer = null, bubbleHideTimer = null;
  function showBubble(text, speakIt) {
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
    bubbleHideTimer = window.setTimeout(hideBubble, 6500);
  }
  function hideBubble() {
    window.clearInterval(typeTimer);
    bubbleEl.classList.remove('xm-show');
  }

  /* ---------- 时间与作息 ---------- */
  function hourNow() { return new Date().getHours(); }
  function isNight() { var h = hourNow(); return h >= 23 || h < 6; }
  function greetingText() {
    var h = hourNow();
    if (h >= 5 && h < 8) return '早上好呀，我是小猫猫，新的一天想找点什么？';
    if (h >= 8 && h < 11) return '你好，我是小猫猫，想找什么网站跟我说';
    if (h >= 11 && h < 14) return '中午好，我是小猫猫，吃饱了来逛逛不？';
    if (h >= 14 && h < 18) return '下午好，我是小猫猫，找站问我呀';
    if (h >= 18 && h < 23) return '晚上好，我是小猫猫，今晚想看点什么？';
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
  var lastTipAt = 0, tipIdx = 0, sleeping = false, funIdx = 0, greeted = false;
  function markActive() { lastActive = Date.now(); }
  ['pointerdown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, markActive, { passive: true });
  });
  document.addEventListener('scroll', markActive, { passive: true });
  function wakeUp(fromUser) {
    if (!sleeping) return;
    sleeping = false;
    wrapEl.classList.remove('xm-sleep');
    setPose('main');
    if (fromUser) showBubble('唔……我醒啦！想找什么跟我说', true);
  }
  function goSleep() {
    if (sleeping || root.classList.contains('xm-open')) return;
    sleeping = true;
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
  });
  document.addEventListener('focusout', function () { userTyping = false; });
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
    if (!userTyping && idleFor > 50000 && Date.now() - lastTipAt > 58000) {
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
  var DOCK_AFTER = 60000;
  function noteXmAct() { xmLastAct = Date.now(); }
  function dockBlocked() {
    return docked || root.classList.contains('xm-open') || root.classList.contains('xm-closed') ||
      gameEl.classList.contains('xm-on') || !!busy || !!document.hidden;
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
    hideBubble();
  }
  function undock() {
    if (!docked) return;
    docked = false;
    root.classList.remove('xm-docked');
    root.style.transform = '';
    noteXmAct();
  }
  window.setInterval(function () {
    if (!docked && Date.now() - xmLastAct > DOCK_AFTER) doDock();
  }, 4000);
  root.addEventListener('pointerenter', function () {
    var wasDocked = docked;
    if (docked) undock();
    noteXmAct();
    /* v7：贴边弹回的那次进入只弹回、不顺带出坞（免得猫刚弹回来又被坞围住） */
    if (!wasDocked) showControls();
  });
  root.addEventListener('pointerdown', function () { noteXmAct(); }, true);

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
  function showControls() {
    if (ctlBlocked()) return;
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
    if (!ctlShown) return;
    window.clearTimeout(ctlTimer);
    ctlLeaveTimer = window.setTimeout(hideControls, 350);
  });
  document.addEventListener('pointerdown', function (ev) {
    if (ctlShown && !root.contains(ev.target)) hideControls();
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') hideControls();
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
    var pose, line;
    if (petChain >= 3) {
      pose = 'milestone';
      burst(11);
      showEmo('♪');
      line = pickOne(petChain >= 5 ? PET_MAX : PET_HAPPY);
    } else {
      pose = 'making';
      burst(6);
      line = (currentSat() < 35 && Math.random() < 0.35) ? pickOne(PET_HUNGRY) : pickOne(PET_WARM);
    }
    setPose(pose);
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
      if (ctlShown) hideControls(); else showControls();
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
  root.querySelector('.xm-close-btn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    hideControls();
    root.classList.add('xm-closed');
    root.classList.remove('xm-open');
    hideBubble();
    stopSpeak();
    stopCelebVideo(); /* v8 复审返工：收起即停视频，滞后的探活链凭令牌丢弃 */
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
    markActive();
    wakeUp(false);
    setPose('waking');
    happyBounce();
    burst(7);
    showBubble(greeted ? '我回来啦，想找什么？' : greetingText(), true);
    window.setTimeout(function () { if (currentPose === 'waking') setPose('main'); }, 3200);
  });

  /* ---------- 聊天面板 ---------- */
  var history = [];
  var busy = false;
  var chatted = false;
  function openPanel() {
    undock();
    hideControls();
    closeLook();
    root.classList.add('xm-open');
    root.classList.remove('xm-closed');
    hideBubble();
    markActive();
    wakeUp(false);
    root.querySelector('.xm-chat-btn').classList.remove('xm-pulse');
    setPose('making');
    alignPanel();
    if (!chatted) {
      chatted = true;
      addCatText('你好呀，我是小猫猫！找网站是我的强项，比如「想看免费短剧」「要做 PPT 的工具」「学英语的网站」，直接打字告诉我就行。也可以问我某个分类里有什么、场景包怎么用。');
    }
    window.setTimeout(function () { try { inputEl.focus({ preventScroll: true }); } catch (e) { inputEl.focus(); } }, 120);
  }
  function closePanel() {
    root.classList.remove('xm-open');
    closeLook();
    setPose('main');
    markActive();
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

  function postJson(url, body) {
    return window.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
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
    v4.seenLevel = Math.max(v4.seenLevel, lv.level);
    v4.seenBadges = ids;
    persistV4();
    var parts = [];
    if (leveled) parts.push('哇！你升级啦：Lv.' + lv.level + '「' + lv.title + '」🎉');
    if (newOnes.length) {
      parts.push('新徽章点亮：' + newOnes.slice(0, 2).map(function (b) { return b.icon + '「' + b.title + '」'; }).join('、') + (newOnes.length > 2 ? ' 等 ' + newOnes.length + ' 枚' : '') + '！');
    }
    var text = parts.join(' ');
    if (root.classList.contains('xm-open')) { addCatText(text); return; }
    if (root.classList.contains('xm-closed') || sleeping) return;
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
    gameEl.classList.add('xm-on');
    gHud();
  }
  function closeGame() {
    endGame(false);
    gameEl.classList.remove('xm-on');
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
    if (interacted || sleeping) return;
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
  /* v8 图库三套：C=皇冠全套（默认，13 张）/ L=经典浅色（旧形象 6 张）/ D=经典深色（旧形象 6 张）。
     旧版存档的 set 只有 light/dark，键位与语义原样保留，老用户选过的经典图不丢。 */
  var POSE_LABELS = { main: '皇冠主形象', milestone: '开心大笑', making: '眨眼卖萌', surprised: '惊喜', shy: '害羞脸红', heart: '爱心眼', waking: '困困打哈欠', grumpy: '鼓脸小生气', teary: '委屈泪汪汪', working: '好奇张望', clever: '机灵侧目', pleading: '委屈垂耳', idle: '困困垂耳' };
  var POSE_KEYS = ['main', 'milestone', 'making', 'surprised', 'shy', 'heart', 'waking', 'grumpy', 'teary', 'working', 'clever', 'pleading', 'idle'];
  var CLASSIC_LABELS = { main: '主形象', idle: '待机', waking: '醒来', working: '工作', making: '卖萌', milestone: '庆祝' };
  var CLASSIC_KEYS = ['main', 'idle', 'waking', 'working', 'making', 'milestone'];
  function showLookNote(t) { if (lookNote) lookNote.textContent = t; }
  function selLookKey() {
    if (!avatarPick) return 'def';
    if (avatarPick.kind === 'upload') return 'U';
    return (avatarPick.set === 'dark' ? 'D:' : avatarPick.set === 'crown' ? 'C:' : 'L:') + avatarPick.pose;
  }
  function renderLook() {
    lookGrid.innerHTML = '';
    var items = [{ key: 'def', label: '默认皇冠全套', thumb: ASSETS + POSES.main }];
    POSE_KEYS.forEach(function (k) {
      items.push({ key: 'C:' + k, label: '皇冠·' + POSE_LABELS[k], thumb: ASSETS + POSES[k] });
    });
    CLASSIC_KEYS.forEach(function (k) {
      items.push({ key: 'L:' + k, label: '经典·' + CLASSIC_LABELS[k], thumb: ASSETS + POSES_CLASSIC[k] });
      items.push({ key: 'D:' + k, label: '经典深色·' + CLASSIC_LABELS[k], thumb: ASSETS + POSES_DARK[k] });
    });
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
      return !!(back && back.avatar && back.avatar.kind === avatarPick.kind &&
        (avatarPick.kind !== 'upload' || back.avatar.data === avatarPick.data) &&
        (avatarPick.kind !== 'builtin' || back.avatar.pose === avatarPick.pose));
    } catch (e) { return false; }
  }
  function pickLook(key) {
    var prev = avatarPick;
    if (key === 'def') avatarPick = null;
    else if (key === 'U') { if (!prev || prev.kind !== 'upload') return; }
    else {
      var pose = key.slice(2);
      var setName = key.charAt(0) === 'D' ? 'dark' : key.charAt(0) === 'C' ? 'crown' : 'light';
      if (!poseSetOf(setName)[pose]) return;
      avatarPick = { kind: 'builtin', set: setName, pose: pose };
    }
    if (!persistAvatarChecked()) {
      avatarPick = prev;
      persistAvatar();
      showLookNote('浏览器存不下这个选择，先恢复成刚才的啦');
      return;
    }
    stopCelebVideo(); /* v8 复审返工：换形象即停视频，滞后的探活链凭令牌丢弃 */
    refreshAvatarImages();
    renderLook();
    showLookNote(avatarPick ? '好啦，以后就用这个形象陪你～' : '恢复默认啦，整套姿势都回来咯');
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
  window.setTimeout(function () { burst(8); }, 380);
  window.setTimeout(function () {
    greeted = true;
    if (!root.classList.contains('xm-open') && !root.classList.contains('xm-closed')) {
      setPose('waking');
      /* v12：850ms 招呼多半还没手势——先出气泡不读；首次手势后补读一次（且仅当气泡还在时）。 */
      var greetText = composeGreeting();
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
      window.setTimeout(function () { if (currentPose === 'waking' && !sleeping) setPose('main'); }, 3400);
    }
  }, 850);
  /* 跨会话的升级/新徽章：等招呼说完再庆祝，不抢戏 */
  window.setTimeout(function () { checkGrowth(true); }, 9500);
})();
