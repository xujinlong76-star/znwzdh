// 精选专题（合集）编辑层：A 壳结构 + B 里的编辑内容。
// 数据只覆盖“策展文案”（价值主张、导语、署名、期号、幕分组、编辑手记、纠错入口），
// 合集本身与站点仍由 API / 种子数据（seed-data.json）提供，本模块不伪造站点链接。
// 封面走站点 favicon 拼贴（复用 SiteFavicon），不调任何图片生成 API。

export interface FeaturedAct {
  id: string;
  title: string;
  description: string;
  siteUrls: string[];
}

export interface FeaturedCollectionEditorial {
  slug: string;
  title: string;
  valueProposition: string;
  intro: string;
  curator: string;
  issueNo: number;
  editorNote: string;
  correctionHref: string;
  acts: FeaturedAct[];
}
export function normalizeSiteUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export function correctionIssueUrl(title: string): string {
  return "https://github.com/xujinlong76-star/znwzdh/issues/new?title=" + encodeURIComponent("【纠错】" + title);
}

export function validateFeaturedEditorial(e: FeaturedCollectionEditorial): string[] {
  const errors: string[] = [];
  const valueLength = [...e.valueProposition].length;
  if (valueLength === 0 || valueLength > 20) errors.push(e.slug + ": 价值主张必须为 1 至 20 字");
  if (!e.intro.trim()) errors.push(e.slug + ": 导语不能为空");
  if (!e.curator.trim()) errors.push(e.slug + ": 策展署名不能为空");
  if (e.issueNo < 1) errors.push(e.slug + ": 期号必须从第 1 期开始");
  if (!e.editorNote.trim()) errors.push(e.slug + ": 编辑手记不能为空");
  if (!e.correctionHref.startsWith("https://github.com/xujinlong76-star/znwzdh/issues/new")) errors.push(e.slug + ": 纠错入口必须指向本仓库的问题页");
  if (e.acts.length === 0) errors.push(e.slug + ": 至少要有一幕");
  const seen = new Set<string>();
  for (const act of e.acts) {
    if (act.siteUrls.length === 0) errors.push(e.slug + ": " + act.title + " 不能没有站点");
    for (const url of act.siteUrls) {
      if (!url.startsWith("https://")) errors.push(e.slug + ": 站点链接必须是 https：" + url);
      const key = normalizeSiteUrl(url);
      if (seen.has(key)) errors.push(e.slug + ": 站点重复收录：" + url);
      seen.add(key);
    }
  }
  return errors;
}
export function actIndexForSiteUrl(e: FeaturedCollectionEditorial, url: string): number {
  const key = normalizeSiteUrl(url);
  return e.acts.findIndex((act) => act.siteUrls.some((u) => normalizeSiteUrl(u) === key));
}

export function coverSiteUrls(e: FeaturedCollectionEditorial): string[] {
  return e.acts.flatMap((act) => act.siteUrls);
}

export function orderUrlsByAct<T extends { url: string }>(e: FeaturedCollectionEditorial, sites: T[]): T[] {
  const order = new Map<string, number>();
  e.acts.forEach((act, actIndex) => {
    act.siteUrls.forEach((url, index) => order.set(normalizeSiteUrl(url), actIndex * 100 + index));
  });
  return [...sites].sort((a, b) => {
    const ra = order.get(normalizeSiteUrl(a.url));
    const rb = order.get(normalizeSiteUrl(b.url));
    return (ra ?? 100000) - (rb ?? 100000);
  });
}

export function issueLabel(e: FeaturedCollectionEditorial): string {
  return "第 " + e.issueNo + " 期";
}
export const FEATURED_COLLECTION_EDITORIALS: FeaturedCollectionEditorial[] = [
  {
    slug: "drama-guide",
    title: "短剧追剧指南",
    valueProposition: "正版追更，一集不落",
    intro: "短剧更新快、平台多、坑也多。这期合集只收正版能看的平台：先上大站追更，再看解说测评避雷，追剧不迷路。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开、正版可看的平台；短剧付费前先看免费集数，充值前确认集数与价格。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("短剧追剧指南"),
    acts: [
      { id: "act-1", title: "第一幕 · 大站追更", description: "先上大站：正版片库全、更新稳，是追剧的主阵地。", siteUrls: ["https://www.bilibili.com", "https://www.iqiyi.com", "https://v.qq.com", "https://www.youku.com"] },
      { id: "act-2", title: "第二幕 · 换个口味", description: "芒果的独家剧集与抖音的竖屏短剧，换个口味继续追。", siteUrls: ["https://www.mgtv.com", "https://www.douyin.com"] },
    ],
  },
  {
    slug: "exam-sprint",
    title: "考公考研冲刺",
    valueProposition: "报名不跑偏，备考有章法",
    intro: "考公考研最怕信息错、报名晚。这期把官方报名入口和靠谱备考平台排成一条线：先确认报名，再跟课程刷题。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "报名入口以官方为准：研招网报名时间每年变动，缴费前务必核对公告；培训机构课程与价格以官网为准，试听后再决定。",
    correctionHref: correctionIssueUrl("考公考研冲刺"),
    acts: [
      { id: "act-1", title: "第一幕 · 官方报名入口", description: "报名、查分、查学历，先走官方入口，信息最准。", siteUrls: ["https://yz.chsi.com.cn", "https://www.chsi.com.cn", "https://www.mohrss.gov.cn"] },
      { id: "act-2", title: "第二幕 · 备考课程与刷题", description: "跟课、刷题、学公开课，备考按节奏走。", siteUrls: ["https://www.huatu.com", "https://www.fenbi.com", "https://www.icourse163.org"] },
    ],
  },
  {
    slug: "ai-video-toolkit",
    title: "AI 视频创作工具箱",
    valueProposition: "一句话，出成片",
    intro: "AI 视频工具多，新手容易挑花眼。这期只收能直接用的生成平台：先文生视频出片，再图生视频玩运镜，创作不迷路。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开、可以免费体验的 AI 视频平台；生成效果因提示词与模型版本而异，正式商用前请确认各平台的版权与使用条款。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("AI 视频创作工具箱"),
    acts: [
      { id: "act-1", title: "第一幕 · 文生视频先上手", description: "先把想法变成画面：输入一句话就能出片，是上手最快的路。", siteUrls: ["https://runwayml.com", "https://pika.art", "https://klingai.com"] },
      { id: "act-2", title: "第二幕 · 图生视频玩运镜", description: "有了图片再动起来：运镜与质感拉满，成片更有电影感。", siteUrls: ["https://www.lumalabs.ai", "https://jimeng.jianying.com", "https://hailuoai.com"] },
    ],
  },
  {
    slug: "office-boost",
    title: "打工人效率办公",
    valueProposition: "开工不加班，事事有着落",
    intro: "上班的工具越少越好。这期只收打开就能干活的办公平台：先把协作沟通理顺，再把文档表格收好，下班不拖堂。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的办公平台；企业版功能与价格以各官网为准，选型前建议先试免费版。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("打工人效率办公"),
    acts: [
      { id: "act-1", title: "第一幕 · 协作沟通", description: "先把人和事连起来：文档、会议、日程与审批在一个地方。", siteUrls: ["https://www.feishu.cn", "https://www.dingtalk.com", "https://www.notion.com"] },
      { id: "act-2", title: "第二幕 · 文档表格", description: "再把资料收好：文档表格随开随改，沉淀的资料找得到。", siteUrls: ["https://docs.qq.com", "https://www.wps.cn", "https://www.yuque.com"] },
    ],
  },
  {
    slug: "beginner-web",
    title: "新手上网必备",
    valueProposition: "上网第一课，一看就会",
    intro: "刚上网别慌，六个站够用：先学会查东西、发微信、找路，再学看天气、买票和翻译，一步步来。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收一看就会的基础站：先记百度和微信，办事再用 12306 和翻译；凡是让先交钱、先下载不明软件的，先停下来问问家里人。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("新手上网必备"),
    acts: [
      { id: "act-1", title: "第一幕 · 先上网", description: "先学会查、聊、找路：搜索、微信、地图三件套。", siteUrls: ["https://www.baidu.com", "https://weixin.qq.com", "https://www.amap.com"] },
      { id: "act-2", title: "第二幕 · 出门办事", description: "出门前看天气、买车票，看不懂外文就翻译。", siteUrls: ["https://weather.com.cn", "https://www.12306.cn", "https://fanyi.baidu.com"] },
    ],
  },
  {
    slug: "senior-services",
    title: "长辈便民服务",
    valueProposition: "办事不用跑，手机全办好",
    intro: "给长辈挑的便民站：办事、医保、缴费在第一幕，吃饭、叫车、挂号在第二幕，大字大按钮，慢慢点不着急。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收官方与大平台入口：办事缴费认准 gov.cn 结尾的官网，医保报销以国家医保服务平台为准；凡是索要验证码、银行卡密码的，都是骗子，立刻挂断。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("长辈便民服务"),
    acts: [
      { id: "act-1", title: "第一幕 · 办事不用跑", description: "政务、医保、缴费都在手机上，不用跑窗口排队。", siteUrls: ["https://www.gjzwfw.gov.cn", "https://www.nhsa.gov.cn", "https://www.alipay.com"] },
      { id: "act-2", title: "第二幕 · 生活有人帮", description: "吃饭、叫车、挂号都有人帮，子女也能远程代办。", siteUrls: ["https://www.meituan.com", "https://www.didiglobal.com", "https://www.guahao.com"] },
    ],
  },
  {
    slug: "job-hunt-express",
    title: "求职招聘直通车",
    valueProposition: "好工作，直通车",
    intro: "找工作最怕大海捞针。这期把招聘平台排成两幕：先上大站广撒网，再按互联网、中高端、实习对症下药，面试不迷路。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的招聘平台；投递前先核对公司与岗位信息，凡是先交钱、先培训再上岗的，都是套路。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("求职招聘直通车"),
    acts: [
      { id: "act-1", title: "第一幕 · 大站投简历", description: "先上大站广撒网：岗位多、更新快，是找工作的主阵地。", siteUrls: ["https://www.zhipin.com", "https://www.zhaopin.com", "https://www.51job.com"] },
      { id: "act-2", title: "第二幕 · 对症下药", description: "互联网、中高端、实习各有去处，对口投递效率更高。", siteUrls: ["https://www.lagou.com", "https://www.liepin.com", "https://www.shixiseng.com"] },
    ],
  },
  {
    slug: "academic-toolkit",
    title: "学术科研工具箱",
    valueProposition: "查文献，做科研",
    intro: "写论文最怕找不到文献、理不清引用。这期把检索、预印本与文献管理排成一条线：先查到论文，再追前沿、管好引用。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的学术平台；知网全文下载需机构权限或付费，引用请以原文为准；预印本未经同行评审，引用时请留心。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("学术科研工具箱"),
    acts: [
      { id: "act-1", title: "第一幕 · 查文献找论文", description: "先查到论文：中英文文献库与 AI 检索，找文献不迷路。", siteUrls: ["https://www.cnki.net", "https://scholar.google.com", "https://www.semanticscholar.org"] },
      { id: "act-2", title: "第二幕 · 追前沿管文献", description: "预印本追最新成果，PubMed 查医学文献，Zotero 把引用收好。", siteUrls: ["https://arxiv.org", "https://pubmed.ncbi.nlm.nih.gov", "https://www.zotero.org"] },
    ],
  },
  {
    slug: "shopping-saver",
    title: "网购省钱指南",
    valueProposition: "先比价，再下单",
    intro: "下单前多看一眼，往往能省下一顿饭。这期把购物分成两幕：先上大站挑东西，再用比价、返利工具把价格压到最低。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的购物与比价平台；价格与优惠随时会变，下单前请以商品页为准，返利到账以各平台规则为准，切勿轻信先付款后返现的私人交易。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("网购省钱指南"),
    acts: [
      { id: "act-1", title: "第一幕 · 大站买买买", description: "先上大站挑东西：品类全、物流快，是网购的主阵地。", siteUrls: ["https://www.taobao.com", "https://www.jd.com/?cu=true", "https://www.pinduoduo.com"] },
      { id: "act-2", title: "第二幕 · 先比价再下单", description: "爆料、历史价、返利三件套，把价格压到最低。", siteUrls: ["https://www.smzdm.com", "https://www.manmanbuy.com", "https://www.fanli.com"] },
    ],
  },
  {
    slug: "novel-film-tracking",
    title: "小说影视追更",
    valueProposition: "小说电影，追更不愁",
    intro: "好书怕断更，好片怕错过。这期把追更分成两幕：先追小说连载，再追电影上映，书影两不误。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的小说与电影平台；小说连载更新以各站为准，电影票价与排片请以影院实际为准。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("小说影视追更"),
    acts: [
      { id: "act-1", title: "第一幕 · 追小说", description: "先追小说连载：女频、免费、男频各有去处。", siteUrls: ["https://www.jjwxc.net", "https://fanqie.com", "https://www.zongheng.com"] },
      { id: "act-2", title: "第二幕 · 追电影", description: "再追电影上映：先看评分挑片，再抢新片票。", siteUrls: ["https://www.douban.com", "https://www.mtime.com", "https://www.taopiaopiao.com"] },
    ],
  },
  {
    slug: "agentic-ai",
    title: "2026 前沿 Agentic AI 生产力矩阵",
    valueProposition: "让 Agent 替你干活",
    intro: "2026 年的前沿玩法是让 Agent 自己干活：从写代码的编程 Agent，到本地跑模型、生产部署推理引擎，这一期把生产力矩阵排成两幕。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的 Agent 与推理工具；Devin 的收录理由已按实际产品修正（原先误写为 Codeium 的 Cascade IDE）。模型与 Agent 的能力更新很快，链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("2026 前沿 Agentic AI 生产力矩阵"),
    acts: [
      { id: "act-1", title: "第一幕 · 写代码的 Agent", description: "先让 Agent 写代码：原生编辑器、自主工程师与开源 Agent。", siteUrls: ["https://cursor.com", "https://devin.ai/desktop", "https://github.com/cline/cline"] },
      { id: "act-2", title: "第二幕 · 跑模型的引擎", description: "再让模型跑起来：本地部署、生产推理与多智能体编排。", siteUrls: ["https://ollama.com", "https://github.com/vllm-project/vllm", "https://github.com/langchain-ai/langgraph"] },
    ],
  },
  {
    slug: "ai-coding",
    title: "AI 编程工具链",
    valueProposition: "写代码，有 AI 搭手",
    intro: "写代码不必从零手敲：补全、对话、重构都有 AI 搭手。这一期收六个能直接打开的入口，先装进编辑器，再让补全与对话接上。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的 AI 编程入口；原有 3 站，本期按精选专题的收录标准补齐到 6 站；DeepSeek 对话页在盒子网络下无法返回 200（403/202 均为反爬校验页），已按诚实口径换为同类可验证的 Kimi；Copilot 需 GitHub 账号登录使用。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("AI 编程工具链"),
    acts: [
      { id: "act-1", title: "第一幕 · 装进编辑器", description: "先装进编辑器：官方助手、AI 原生编辑器与 AI 编程 IDE。", siteUrls: ["https://github.com/features/copilot", "https://cursor.com", "https://www.windsurf.com"] },
      { id: "act-2", title: "第二幕 · 补全与对话", description: "再让补全与对话接上：老牌补全、国产助手与 AI 对话。", siteUrls: ["https://www.tabnine.com", "https://tongyi.aliyun.com/lingma", "https://kimi.moonshot.cn"] },
    ],
  },
  {
    slug: "frontend-starter",
    title: "前端入门路线",
    valueProposition: "从零到独立做项目",
    intro: "零基础学前端，先走对路线：先夯实 Web 标准与语法，再对着技能树查漏补缺、跟着开源项目实战。这一期把入门六步排成两幕。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的前端入门资料；原有 4 站，本期按精选专题的收录标准补齐到 6 站；MDN 是中文文档，菜鸟教程适合快速过语法，JavaScript.info 适合由浅入深补语言细节，阮一峰的 ES6 入门适合学现代语法，roadmap.sh 适合查漏补缺，GitHub 趋势榜适合找项目练手。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("前端入门路线"),
    acts: [
      { id: "act-1", title: "第一幕 · 先打基础", description: "先打基础：标准文档、语法速通与现代教程。", siteUrls: ["https://developer.mozilla.org/zh-CN", "https://www.runoob.com", "https://javascript.info"] },
      { id: "act-2", title: "第二幕 · 再练技能", description: "再练技能：现代语法进阶、技能树查漏补缺，趋势榜找项目实战。", siteUrls: ["https://roadmap.sh", "https://github.com/trending", "https://es6.ruanyifeng.com"] },
    ],
  },
  {
    slug: "design-toolkit",
    title: "设计速查工具箱",
    valueProposition: "配色图标字体，一站备齐",
    intro: "做设计最怕到处找工具：配色、图标、字体、抠图各一个网站。这一期把速查工具排成两幕，先做设计，再修图找字。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的设计速查工具；原有 5 站，按精选专题每合集不少于 6 站的收录标准补齐 Photopea（免费在线修图）；Figma 部分功能需账号登录。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("设计速查工具箱"),
    acts: [
      { id: "act-1", title: "第一幕 · 做设计", description: "先做设计：协同设计、图标与配色。", siteUrls: ["https://figma.com", "https://iconify.design", "https://coolors.co"] },
      { id: "act-2", title: "第二幕 · 字体与图片", description: "再修图找字：免费字体、抠图与在线修图。", siteUrls: ["https://fonts.google.com", "https://www.remove.bg", "https://www.photopea.com"] },
    ],
  },
  {
    slug: "open-source-alternatives",
    title: "开源替代",
    valueProposition: "开源平替，照样好用",
    intro: "好东西不一定贵：白板、运行时、框架、数据库、模型、办公套件，都有开源平替。这一期把六个开源替代排成两幕，先开发提速，再办公创作。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期只收能直接打开的开源项目；原有 5 站，按精选专题每合集不少于 6 站的收录标准补齐 LibreOffice（开源办公套件）；开源项目以各项目官网与仓库为准。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("开源替代"),
    acts: [
      { id: "act-1", title: "第一幕 · 开发提速", description: "先开发提速：运行时、框架与数据库。", siteUrls: ["https://bun.sh", "https://fastify.dev", "https://orm.drizzle.team"] },
      { id: "act-2", title: "第二幕 · 办公与创作", description: "再办公创作：白板、本地模型与办公套件。", siteUrls: ["https://excalidraw.com", "https://ollama.com", "https://www.libreoffice.org"] },
    ],
  },
  {
    slug: "editors-picks",
    title: "编辑精选",
    valueProposition: "编辑亲选，每天必看",
    intro: "这期没有主题，只有编辑的偏好：开发者的工具箱、生活里的刚需、值得读的东西。跨领域人工挑选，每天刷一遍。",
    curator: "山羊胡网编辑部",
    issueNo: 1,
    editorNote: "本期是跨领域人工挑选的时效抽屉：DeepSeek 对话页在盒子网络下无法返回 200（403/202 均为反爬校验页），已按诚实口径换为同类可验证的 Kimi；其余九站均已逐个核实。链接如失效，欢迎通过页面底部的纠错入口告诉我们。",
    correctionHref: correctionIssueUrl("编辑精选"),
    acts: [
      { id: "act-1", title: "第一幕 · 开发者的工具箱", description: "先看开发者的工具箱：热门开源、AI 对话、设计、文档与刷题。", siteUrls: ["https://github.com/trending", "https://kimi.moonshot.cn", "https://figma.com", "https://developer.mozilla.org", "https://leetcode.cn"] },
      { id: "act-2", title: "第二幕 · 生活与知识", description: "再看生活与知识：视频、出行、问答与最新论文。", siteUrls: ["https://www.bilibili.com", "https://www.12306.cn", "https://www.amap.com", "https://www.zhihu.com", "https://arxiv.org"] },
    ],
  },
];

export function getFeaturedEditorial(slug: string): FeaturedCollectionEditorial | undefined {
  return FEATURED_COLLECTION_EDITORIALS.find((e) => e.slug === slug);
}

export function relatedFeaturedEditorials(slug: string): FeaturedCollectionEditorial[] {
  return FEATURED_COLLECTION_EDITORIALS.filter((e) => e.slug !== slug);
}
