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
];

export function getFeaturedEditorial(slug: string): FeaturedCollectionEditorial | undefined {
  return FEATURED_COLLECTION_EDITORIALS.find((e) => e.slug === slug);
}

export function relatedFeaturedEditorials(slug: string): FeaturedCollectionEditorial[] {
  return FEATURED_COLLECTION_EDITORIALS.filter((e) => e.slug !== slug);
}
