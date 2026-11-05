/**
 * 针对稀疏与空缺分类的高质量权威站点扩充脚本
 * 具备严格的前置去重（URL 规范化比对 + 库内查询比对 + 批次内互斥）
 */

export const CANDIDATE_SITES = [
  // ==================== 1. AI 工具 / reg-ai-tools ====================
  {
    url: "https://klingai.kuaishou.com",
    title: "快手可灵 (Kling AI)",
    description: "快手自研前沿视频生成大模型平台，支持超长高清文生视频、图生视频与高动态运镜控制。",
    categoryId: "reg-ai-video-generation",
    tags: ["AI视频", "文生视频", "大模型", "快手"]
  },
  {
    url: "https://runwayml.com",
    title: "Runway",
    description: "全球领先的生成式 AI 创意套件，提供 Gen-3 Alpha 高品质电影级视频生成与动态特效合成。",
    categoryId: "reg-ai-video-generation",
    tags: ["AI视频", "Gen-3", "创意工具", "视觉模型"]
  },
  {
    url: "https://pika.art",
    title: "Pika",
    description: "广受欢迎的 AI 创意视频与动态特效生成工具，支持物理效果模拟、区域重绘与创意视效生成。",
    categoryId: "reg-ai-video-generation",
    tags: ["AI视频", "特效生成", "创意工具"]
  },
  {
    url: "https://chatglm.cn/video",
    title: "智谱清影 (Ying)",
    description: "智谱 AI 推出的 CogVideoX 架构驱动视频生成工具，支持流畅自然的高清中文文生视频与图生视频。",
    categoryId: "reg-ai-video-generation",
    tags: ["AI视频", "CogVideo", "智谱AI"]
  },

  // ==================== 2. 效率办公 / reg-office-productivity ====================
  {
    url: "https://www.feishu.cn",
    title: "飞书",
    description: "先进企业协作与管理平台，整合即时沟通、多维表格、云端知识库与智能审批业务流。",
    categoryId: "reg-collaborative-docs",
    tags: ["协作文档", "知识库", "企业协作", "多维表格"]
  },
  {
    url: "https://www.yuque.com",
    title: "语雀",
    description: "蚂蚁集团旗下专业云端知识库，专为个人创作者与技术团队打造的结构化知识沉淀与文档协作空间。",
    categoryId: "reg-collaborative-docs",
    tags: ["知识库", "协同文档", "团队知识库"]
  },
  {
    url: "https://docs.qq.com",
    title: "腾讯文档",
    description: "腾讯推出的多人实时在线协同办公系统，支持 Word/Excel/PPT/收集表等多端同步与权限管控。",
    categoryId: "reg-collaborative-docs",
    tags: ["在线文档", "表格协同", "腾讯"]
  },
  {
    url: "https://meeting.tencent.com",
    title: "腾讯会议",
    description: "腾讯旗下高清流畅、安全可靠的云视频会议协作平台，支持屏幕共享、AI 纪要与跨国连线。",
    categoryId: "reg-video-conferencing",
    tags: ["视频会议", "云会议", "屏幕共享", "协同办公"]
  },
  {
    url: "https://zoom.us",
    title: "Zoom",
    description: "全球领先的企业级现代化音视频会议与协同通信平台，支持大容量研讨会与团队聊天空间。",
    categoryId: "reg-video-conferencing",
    tags: ["视频会议", "跨国协作", "企业通信"]
  },
  {
    url: "https://www.wjx.cn",
    title: "问卷星",
    description: "国内领先的在线问卷调查、考试测评、投票与表单数据统计分析服务平台。",
    categoryId: "reg-forms-and-surveys",
    tags: ["问卷调查", "表单收集", "在线考试"]
  },
  {
    url: "https://wj.qq.com",
    title: "腾讯问卷",
    description: "腾讯官方免费的在线问卷调查系统，提供丰富专业模板、逻辑跳转与多维度数据统计导出功能。",
    categoryId: "reg-forms-and-surveys",
    tags: ["在线问卷", "表单工具", "腾讯官方"]
  },
  {
    url: "https://typeform.com",
    title: "Typeform",
    description: "全球知名的人性化交互式在线表单与问卷平台，单题渐进式交互显著提高表单填写转化率。",
    categoryId: "reg-forms-and-surveys",
    tags: ["交互表单", "在线调研", "转化提升"]
  },
  {
    url: "https://mubu.com",
    title: "幕布",
    description: "极简大纲笔记与一键转换思维导图的结构化思考工具，适合头脑风暴、读书笔记与工作任务梳理。",
    categoryId: "reg-mindmaps-and-boards",
    tags: ["大纲笔记", "思维导图", "知识整理"]
  },
  {
    url: "https://www.processon.com",
    title: "ProcessOn",
    description: "专业在线作图工具与知识分享社区，支持流程图、思维导图、UML、网络拓扑图与原型设计。",
    categoryId: "reg-mindmaps-and-boards",
    tags: ["流程图", "思维导图", "架构图", "在线协作"]
  },
  {
    url: "https://miro.com",
    title: "Miro",
    description: "国际顶尖的可视化协作白板平台，支持远程团队敏捷敏捷规划、用户故事地图与头脑风暴。",
    categoryId: "reg-mindmaps-and-boards",
    tags: ["协作白板", "敏捷规划", "头脑风暴"]
  },

  // ==================== 3. 数据与分析 / reg-data-and-analytics ====================
  {
    url: "https://superset.apache.org",
    title: "Apache Superset",
    description: "Apache 顶级开源现代企业级商业智能与数据探索可视化平台，具备丰富的图表库与 SQL Lab 编辑器。",
    categoryId: "reg-bi-and-reporting",
    tags: ["商业智能", "数据可视化", "开源BI", "数据看板"]
  },
  {
    url: "https://www.metabase.com",
    title: "Metabase",
    description: "极简易用、开源的业务数据洞察与报表仪表盘工具，支持无代码可视化查询与精细权限控制。",
    categoryId: "reg-bi-and-reporting",
    tags: ["开源BI", "数据分析", "看板", "SQL可视化"]
  },
  {
    url: "https://powerbi.microsoft.com",
    title: "Microsoft Power BI",
    description: "微软企业级可扩展商业智能数据分析与交互式报表套件，深度无缝整合 Office 365 与云数据源。",
    categoryId: "reg-bi-and-reporting",
    tags: ["PowerBI", "商业智能", "微软", "报表分析"]
  },
  {
    url: "https://posthog.com",
    title: "PostHog",
    description: "专为现代开发者打造的一体化开源产品分析套件，整合用户埋点、行为录屏、热力图、A/B测试与特性旗标。",
    categoryId: "reg-product-analytics",
    tags: ["产品分析", "用户行为", "开源埋点", "录屏分析"]
  },
  {
    url: "https://mixpanel.com",
    title: "Mixpanel",
    description: "全球领先的深度产品与用户行为路径分析平台，助力团队衡量指标、转化漏斗与留存分析。",
    categoryId: "reg-product-analytics",
    tags: ["用户分析", "转化漏斗", "留存分析"]
  },
  {
    url: "https://scrapy.org",
    title: "Scrapy",
    description: "Python 生态中最具工业级强健性的快速开源网络爬虫与网页内容抓取框架。",
    categoryId: "reg-data-collection",
    tags: ["网页爬虫", "数据抓取", "Python", "开源框架"]
  },
  {
    url: "https://crawlee.dev",
    title: "Crawlee",
    description: "Apify 出品的新一代 Node.js 网页抓取与浏览器自动化库，内置智能代理轮换与防封反爬能力。",
    categoryId: "reg-data-collection",
    tags: ["爬虫框架", "Nodejs", "自动化采集"]
  },
  {
    url: "https://openrefine.org",
    title: "OpenRefine",
    description: "功能强大的开源混乱数据清洗、批量格式转换与语义对齐探索工具。",
    categoryId: "reg-data-collection",
    tags: ["数据清洗", "格式转换", "开源工具"]
  },
  {
    url: "https://seatunnel.apache.org",
    title: "Apache SeaTunnel",
    description: "下一代超高性能、分布式海量数据集成平台，支持上百种异构数据源之间的高效同步与流批处理。",
    categoryId: "reg-data-integration-etl",
    tags: ["数据同步", "ETL", "海量数据", "Apache"]
  },
  {
    url: "https://airbyte.com",
    title: "Airbyte",
    description: "新一代开源 ELT 数据管道与云数据仓库连接器引擎，提供 300+ 开箱即用数据集成连接器。",
    categoryId: "reg-data-integration-etl",
    tags: ["ELT", "数据管道", "开源集成"]
  },
  {
    url: "https://search.google.com/search-console",
    title: "Google Search Console",
    description: "谷歌官方网站站长工具，提供搜索流量透视、索引收录覆盖率诊断与技术 SEO 健康指标。",
    categoryId: "reg-seo-and-growth",
    tags: ["SEO", "搜索引擎优化", "站长平台", "收录分析"]
  },
  {
    url: "https://ziyuan.baidu.com",
    title: "百度搜索资源平台",
    description: "百度官方站长服务平台，提供链接快速提交、网站收录索引监控与移动搜索体验诊断分析。",
    categoryId: "reg-seo-and-growth",
    tags: ["百度站长", "链接提交", "搜索引擎"]
  },

  // ==================== 4. 内容创作 / reg-content-creation ====================
  {
    url: "https://mp.weixin.qq.com",
    title: "微信公众平台",
    description: "微信官方内容创作、发布管理与公众号服务号运营后台，拥有最庞大的中文私域受众分发能力。",
    categoryId: "reg-writing-and-layout",
    tags: ["公众号", "内容创作", "新媒体", "微信"]
  },
  {
    url: "https://yiban.io",
    title: "壹伴助手",
    description: "一站式公众号排版与素材辅助插件，提供图文样式秒刷、无版权图库与排期发布工具。",
    categoryId: "reg-writing-and-layout",
    tags: ["公众号排版", "新媒体工具", "素材库"]
  },
  {
    url: "https://www.135editor.com",
    title: "135编辑器",
    description: "海量设计排版样式与秒刷功能的图文排版编辑器，支持多渠道内容同步与团队协作排版。",
    categoryId: "reg-writing-and-layout",
    tags: ["图文排版", "新媒体编辑", "样式模板"]
  },
  {
    url: "https://www.capcut.cn",
    title: "剪映专业版",
    description: "字节跳动旗下全能易用视频创作工具，内置海量正版曲库、AI 智能字幕、文本朗读与质感滤镜。",
    categoryId: "reg-video-editing",
    tags: ["视频剪辑", "智能字幕", "后期工具", "短视频"]
  },
  {
    url: "https://www.blackmagicdesign.com/products/davinciresolve",
    title: "DaVinci Resolve (达芬奇)",
    description: "行业专业影视级剪辑、调色、视觉特效与音频后期制作系统，提供功能完备的免费版本。",
    categoryId: "reg-video-editing",
    tags: ["视频剪辑", "专业调色", "音频后期", "影视制作"]
  },
  {
    url: "https://studio.xiaoyuzhoufm.com",
    title: "小宇宙 Studio",
    description: "专为中文播客创作者打造的一站式播客托管、节目发布、音质增强与收听互动数据分析工作台。",
    categoryId: "reg-podcast-production",
    tags: ["播客托管", "音频制作", "创作者后台", "小宇宙"]
  },
  {
    url: "https://www.audacityteam.org",
    title: "Audacity",
    description: "老牌开源免费的多轨音频录音、降噪滤镜、均衡器与多格式音频编辑软件。",
    categoryId: "reg-podcast-production",
    tags: ["音频录制", "声音编辑", "音频降噪", "开源音频"]
  },
  {
    url: "https://obsproject.com",
    title: "OBS Studio",
    description: "全球广泛采用的开源免费跨平台推流软件，支持多视音频源捕获混音、场景无缝过渡与高清录像。",
    categoryId: "reg-live-streaming-ops",
    tags: ["直播推流", "屏幕录制", "多源混音", "开源软件"]
  },
  {
    url: "https://live.bilibili.com/liveHime",
    title: "哔哩哔哩直播姬",
    description: "B站官方出品的一键直播助手，集成弹幕互动互动组件、虚拟主播动作驱动与游戏捕获推流。",
    categoryId: "reg-live-streaming-ops",
    tags: ["B站直播", "直播助手", "虚拟主播"]
  },
  {
    url: "https://www.newrank.cn",
    title: "新榜 (NewRank)",
    description: "中国内容产业权威数据服务平台，提供微信、抖音、快手、小红书全平台达人排行榜与行业监测数据。",
    categoryId: "reg-social-and-growth-ops",
    tags: ["新媒体数据", "达人榜单", "行业舆情", "内容增长"]
  },
  {
    url: "https://www.chanmama.com",
    title: "蝉妈妈",
    description: "专业的抖音与短视频电商数据分析平台，提供直播间实时监控、热销爆品选品与带货达人洞察。",
    categoryId: "reg-social-and-growth-ops",
    tags: ["短视频数据", "直播带货", "选品分析"]
  },
  {
    url: "https://www.zsxq.com",
    title: "知识星球",
    description: "创作者连接高黏性铁杆粉丝的知识社群变现工具，支持高价值内容沉淀、问答互动与私域运营。",
    categoryId: "reg-private-community",
    tags: ["私域社群", "知识付费", "粉丝互动"]
  },
  {
    url: "https://txc.qq.com",
    title: "腾讯兔小巢",
    description: "腾讯推出的免费轻量产品用户反馈与互动社区平台，助力产品经理与运营者沉淀真实用户声音。",
    categoryId: "reg-private-community",
    tags: ["用户反馈", "社群互动", "腾讯官方"]
  },
  {
    url: "https://substack.com",
    title: "Substack",
    description: "全球知名的独立创作者付费专栏与邮件通讯平台，助力作者通过高质量长文章订阅实现商业变现。",
    categoryId: "reg-email-newsletter",
    tags: ["Newsletter", "邮件通讯", "付费订阅", "独立创作"]
  },
  {
    url: "https://zhubai.love",
    title: "竹白",
    description: "国内极简好用的中文创作者 Newsletter 发送工具，支持邮件与微信双渠道同步推送到读者终端。",
    categoryId: "reg-email-newsletter",
    tags: ["中文Newsletter", "微信通知", "邮件写作"]
  },
  {
    url: "https://resend.com",
    title: "Resend",
    description: "为现代开发者设计的一流交易与营销邮件 API 服务，基于 React Email 构建出色的响应式邮件模版。",
    categoryId: "reg-email-newsletter",
    tags: ["邮件API", "ReactEmail", "开发者邮件"]
  },
  {
    url: "https://www.framer.com",
    title: "Framer",
    description: "革命性的无代码建站工具，支持将精美视觉设计稿一键秒级发布为具备流畅交互的响应式生产级网站。",
    categoryId: "reg-landing-page-builder",
    tags: ["无代码建站", "交互设计", "落地页构建"]
  },
  {
    url: "https://v0.dev",
    title: "v0 by Vercel",
    description: "Vercel 官方推出的生成式 UI 原型工具，基于自然语言直接生成优雅现代的 React 与 Tailwind 组件。",
    categoryId: "reg-landing-page-builder",
    tags: ["AI生成UI", "React原型", "Vercel"]
  },
  {
    url: "https://www.hellorf.com",
    title: "站酷海洛",
    description: "站酷旗下正版商业图片、矢量插画、4K视频素材与字体授权交易平台，商用版权链路完备可靠。",
    categoryId: "reg-content-assets",
    tags: ["商业图片", "商用素材", "矢量插画", "正版授权"]
  },
  {
    url: "https://www.tosound.com",
    title: "淘声网 (ToSound)",
    description: "智能声音搜索引擎，聚合全球海量免版税音效素材、游戏背景配乐与影视环境音采集。",
    categoryId: "reg-content-assets",
    tags: ["免版税音效", "背景音乐", "声音搜索"]
  },
  {
    url: "https://tophub.today",
    title: "今日热榜 (Tophub)",
    description: "一站式聚合全网数十家主流社区与媒体平台（知乎、微博、微信、B站、36氪）实时热榜与趋势榜单。",
    categoryId: "reg-trend-topics",
    tags: ["热搜榜单", "实时热点", "舆情追踪", "聚合热榜"]
  },
  {
    url: "https://top.baidu.com",
    title: "百度热搜",
    description: "百度官方大数据热搜排行榜，客观反映当下全国互联网网民最关注的社会热点与民生大事件。",
    categoryId: "reg-trend-topics",
    tags: ["百度热搜", "热搜榜单", "全网趋势"]
  },
  {
    url: "https://s.weibo.com/top/summary",
    title: "微博热搜榜",
    description: "中国最大的社交媒体实时话题风向标，直观呈现秒级更新的文娱、社会新闻与大众讨论热点。",
    categoryId: "reg-trend-topics",
    tags: ["微博热搜", "社交风向标", "实时舆情"]
  },
  {
    url: "https://sspai.com",
    title: "少数派 (sspai)",
    description: "专注于高品质数字消费、软硬件深度测评、效率生产力工具实践与高质量原创内容分享的科技社区。",
    categoryId: "reg-creator-community",
    tags: ["生产力工具", "数字生活", "科技社区", "原创内容"]
  },
  {
    url: "https://www.zcool.com.cn",
    title: "站酷 (ZCOOL)",
    description: "中国极具影响力的设计师互动平台，汇聚数百万优秀平面、插画、UI 与三维艺术家作品与经验分享。",
    categoryId: "reg-creator-community",
    tags: ["设计师社区", "创意展示", "视觉设计"]
  },
  {
    url: "https://studio.youtube.com",
    title: "YouTube Studio",
    description: "YouTube 官方创作者中心，提供全球视听内容分发、多语种字幕配置、版权管理与商业收益结算工具。",
    categoryId: "reg-global-creation",
    tags: ["出海视频", "创作者后台", "YouTube"]
  },
  {
    url: "https://medium.com",
    title: "Medium",
    description: "全球知名的开放式深度长文写作与阅读平台，汇聚世界各领域专业人士与思想领袖的前沿见解。",
    categoryId: "reg-global-creation",
    tags: ["深度阅读", "全球专栏", "英语写作"]
  },

  // ==================== 5. 学术科研 / reg-academic-research ====================
  {
    url: "https://www.overleaf.com",
    title: "Overleaf",
    description: "全球领先的在线实时协作 LaTeX 论文编辑器，内置数千种主流学术期刊与学术会议格式模板。",
    categoryId: "reg-paper-writing",
    tags: ["LaTeX", "学术排版", "论文写作", "在线协作"]
  },
  {
    url: "https://xiezuocat.com",
    title: "秘塔写作猫",
    description: "AI 驱动的现代中文智能写作辅助工具，提供学术论文语法检查、错别字纠错、文章润色与降重建议。",
    categoryId: "reg-paper-writing",
    tags: ["AI写作", "语法纠错", "论文润色"]
  },
  {
    url: "https://quillbot.com",
    title: "QuillBot",
    description: "享誉全球的英文学术改写与同义句润色工具，拥有强大的语法检查、总结器与引文格式生成功能。",
    categoryId: "reg-paper-writing",
    tags: ["英文改写", "学术润色", "语法检查"]
  },
  {
    url: "https://www.zotero.org",
    title: "Zotero",
    description: "经典免费开源的学术文献管理软件，支持一键浏览器抓取文献元数据、自动生成参考文献与全文批注检索。",
    categoryId: "reg-research-management",
    tags: ["文献管理", "开源工具", "引文生成", "学术研究"]
  },
  {
    url: "https://www.mendeley.com",
    title: "Mendeley",
    description: "爱思唯尔 (Elsevier) 旗下的文献管理器与科研社交网络，提供云端多端同步与学术文献协作群组。",
    categoryId: "reg-research-management",
    tags: ["文献管理", "Elsevier", "学术社交"]
  },
  {
    url: "https://www.researchgate.net",
    title: "ResearchGate",
    description: "全球规模最大的科研学者社交与学术成果共享网络，促进全球科学工作者即时分享论文与同行评审。",
    categoryId: "reg-academic-community",
    tags: ["学者社区", "学术社交", "论文分享"]
  },
  {
    url: "https://muchong.com",
    title: "小木虫",
    description: "国内访问量领先的学术科研互动社区，涵盖考博考研经验、国家自然科学基金申报与各学科前沿讨论。",
    categoryId: "reg-academic-community",
    tags: ["科研论坛", "学术讨论", "基金申报"]
  },
  {
    url: "https://arxiv.org",
    title: "arXiv",
    description: "康奈尔大学运营的全球权威开源学术预印本文库，覆盖计算机科学、人工智能、物理与数学前沿研究成果。",
    categoryId: "reg-open-access",
    tags: ["预印本文库", "开放获取", "前沿论文", "计算机科学"]
  },
  {
    url: "https://www.paper.edu.cn",
    title: "中国科技论文在线",
    description: "教育部科技发展中心主办的科技论文预印本交流平台，提供科研人员首发学术成果与论文快速评议通道。",
    categoryId: "reg-open-access",
    tags: ["预印本", "科技论文", "教育部官方"]
  },
  {
    url: "https://dblp.org",
    title: "DBLP 计算机科学文献库",
    description: "国际公认最权威、更新最及时的计算机科学顶级会议与顶级期刊元数据索引检索系统。",
    categoryId: "reg-academic-conferences",
    tags: ["学术会议", "期刊索引", "计算机科学", "文献数据库"]
  },
  {
    url: "https://www.ccf.org.cn",
    title: "中国计算机学会 (CCF)",
    description: "中国计算机领域专业学术团体，其发布的《CCF 推荐国际学术会议和期刊目录》为行业公认的权威学术评价指南。",
    categoryId: "reg-academic-conferences",
    tags: ["CCF", "学术评价", "期刊推荐", "学术团体"]
  },

  // ==================== 6. 学习成长 / reg-learning-growth ====================
  {
    url: "https://gaokao.chsi.com.cn",
    title: "阳光高考",
    description: "教育部高校招生阳光工程指定平台，提供全国普通高校招生录取政策、专业分数线与志愿填报参考。",
    categoryId: "reg-k12-and-enrollment",
    tags: ["高考录取", "教育部平台", "升学报考"]
  },
  {
    url: "https://basic.smartedu.cn",
    title: "国家中小学智慧教育平台",
    description: "教育部主办的全国中小学免费优质教育教学资源中心，覆盖小学、初中、高中全学段教材课程同步资源。",
    categoryId: "reg-k12-and-enrollment",
    tags: ["基础教育", "中小学教材", "官方网课"]
  },
  {
    url: "https://www.chsi.com.cn",
    title: "学信网 (中国高等教育学生信息网)",
    description: "教育部指定的全国学籍学历查询、在线验证、出国教育背景信息认证与高校招生信息权威官方网站。",
    categoryId: "reg-higher-education",
    tags: ["学历查询", "学籍认证", "教育部权威"]
  },
  {
    url: "https://www.cdgdc.edu.cn",
    title: "学位网 (中国学位与研究生教育信息网)",
    description: "国家教育部学位认证、全国学科评估与高校研究生教育综合官方门户与数据查询系统。",
    categoryId: "reg-higher-education",
    tags: ["学位认证", "学科评估", "研究生教育"]
  },
  {
    url: "https://yz.chsi.com.cn",
    title: "中国研究生招生信息网 (研招网)",
    description: "全国硕士研究生招生考试统一部署、网上报名、调剂服务与政策发布的官方唯一指定平台。",
    categoryId: "reg-postgrad-and-study-abroad",
    tags: ["考研报名", "研究生调剂", "教育部官方"]
  },
  {
    url: "https://www.csc.edu.cn",
    title: "国家留学网",
    description: "国家留学基金管理委员会官方平台，组织实施国家公派出国留学基金项目申报、选派与管理服务。",
    categoryId: "reg-postgrad-and-study-abroad",
    tags: ["国家公派", "留学基金", "出国留学"]
  },
  {
    url: "https://www.cpta.com.cn",
    title: "中国人事考试网",
    description: "人力资源和社会保障部人事考试中心官方门户，承办全国专业技术人员职业资格考试报名与成绩核查。",
    categoryId: "reg-certifications",
    tags: ["职业资格", "人事考试", "国家资格证"]
  },
  {
    url: "https://www.neea.edu.cn",
    title: "中国教育考试网",
    description: "教育部教育考试院官方网站，负责全国英语四六级 (CET)、计算机等级考试 (NCRE)、教师资格考试报名与查分。",
    categoryId: "reg-certifications",
    tags: ["四六级报名", "计算机等级", "教师资格证"]
  },
  {
    url: "https://www.duolingo.com",
    title: "多邻国 (Duolingo)",
    description: "全球最受欢迎的趣味化、游戏化外语学习应用平台，通过碎片化闯关练习轻松掌握 40+ 种世界语言。",
    categoryId: "reg-language-learning",
    tags: ["外语学习", "趣味英语", "多语种"]
  },
  {
    url: "https://www.shanbay.com",
    title: "扇贝网",
    description: "基于遗忘曲线科学算法的知名外语学习平台，涵盖扇贝单词、扇贝听力、阅读与口语全方位技能训练。",
    categoryId: "reg-language-learning",
    tags: ["背单词", "英语阅读", "听力训练"]
  },
  {
    url: "https://leetcode.cn",
    title: "力扣 (LeetCode 中国)",
    description: "全球知名的编程算法面试题库与技术交流平台，提供权威算法练习、数据结构精析与周赛竞技体系。",
    categoryId: "reg-question-banks",
    tags: ["算法刷题", "数据结构", "技术面试", "编程题库"]
  },
  {
    url: "https://www.nowcoder.com",
    title: "牛客网",
    description: "互联网求职必备的笔试面试刷题平台，提供名企真题题库、技术交流圈子、校招内推与真实面经分享。",
    categoryId: "reg-question-banks",
    tags: ["名企笔试", "求职面试", "面经题库"]
  },
  {
    url: "https://www.deepl.com",
    title: "DeepL 翻译",
    description: "基于先进深度神经网络架构的全球高精确度机器翻译平台，语意自然通顺、专业长文档翻译表现卓越。",
    categoryId: "reg-dictionaries-and-translators",
    tags: ["AI翻译", "机器翻译", "精准翻译", "文档翻译"]
  },
  {
    url: "https://dict.youdao.com",
    title: "有道词典",
    description: "网易旗下领先的综合多语种查词与翻译工具，收录柯林斯、朗文等多部权威词典与海量双语例句。",
    categoryId: "reg-dictionaries-and-translators",
    tags: ["在线查词", "权威字典", "网易有道"]
  },
  {
    url: "https://www.zdic.net",
    title: "汉典 (Zdic)",
    description: "最权威详尽的免费在线汉语字典词典，集成说文解字、康熙字典、异体字字典与汉字古今演变字形考证。",
    categoryId: "reg-dictionaries-and-translators",
    tags: ["汉语字典", "说文解字", "国学字典", "字源字形"]
  },
  {
    url: "https://www.guokr.com",
    title: "果壳网 (Guokr)",
    description: "倡导科学思考与理性生活方式的知名科技科普传媒社区，用有趣通俗的视角拆解日常科学原理与谣言分析。",
    categoryId: "reg-popular-science",
    tags: ["大众科普", "科学生活", "科普传媒"]
  },
  {
    url: "https://www.kepu.net.cn",
    title: "中国科普博览",
    description: "中国科学院网络科普门户，集结数百家科研院所前沿科技成果通俗化展示、科学普及与青少年科创资源。",
    categoryId: "reg-popular-science",
    tags: ["中科院科普", "科学前沿", "通识教育"]
  },

  // ==================== 7. 职业招聘 / reg-jobs-and-career ====================
  {
    url: "https://www.zhipin.com",
    title: "BOSS直聘",
    description: "中国主流的移动直聘招聘平台，求职者直接与未来业务主管及企业负责人在线即时开聊求职意向。",
    categoryId: "reg-general-job-boards",
    tags: ["综合招聘", "求职找工作", "在线直聊"]
  },
  {
    url: "https://www.zhaopin.com",
    title: "智联招聘",
    description: "中国知名的人力资本生态综合服务商，覆盖海量行业知名雇主、白领岗位与职业测评报告。",
    categoryId: "reg-general-job-boards",
    tags: ["人才招聘", "白领求职", "企业招工"]
  },
  {
    url: "https://www.51job.com",
    title: "前程无忧",
    description: "全国广泛使用的综合人力资源求职门户，提供全行业真实职位筛选、名企招聘专场与简历投递通道。",
    categoryId: "reg-general-job-boards",
    tags: ["找工作", "名企校招", "人力资源"]
  },
  {
    url: "https://www.shixiseng.com",
    title: "实习僧",
    description: "全国领先的大学生实习求职招聘平台，聚焦知名互联网外企、央国企与知名事务所的日常与寒暑假实习机会。",
    categoryId: "reg-campus-and-internship",
    tags: ["学生实习", "名企实习", "暑期实习"]
  },
  {
    url: "https://www.yingjiesheng.com",
    title: "应届生求职网",
    description: "前程无忧旗下专为高校应届毕业生服务的招聘网，汇集全国校招网申日历、宣讲会行程与校招答辩求职辅导。",
    categoryId: "reg-campus-and-internship",
    tags: ["校园招聘", "应届生求职", "宣讲会网申"]
  },
  {
    url: "https://www.liepin.com",
    title: "猎聘网",
    description: "专注于中高端技术专家与管理精英人才的职业成长平台，海量认证专业猎头在线精准推荐优质年薪岗位。",
    categoryId: "reg-executive-search",
    tags: ["中高端招聘", "猎头服务", "精英人才"]
  },
  {
    url: "https://eleduck.com",
    title: "电鸭社区",
    description: "国内活跃的远程工作、自由职业者与数字游民社区，提供海量经过人工审核的远程全职兼职岗位信息。",
    categoryId: "reg-remote-and-overseas-jobs",
    tags: ["远程办公", "数字游民", "自由职业", "海外接单"]
  },
  {
    url: "https://remoteok.com",
    title: "RemoteOK",
    description: "全球备受软件工程师与设计师青睐的海外高薪远程职位聚合看板，支持全球全远程工作机会筛选。",
    categoryId: "reg-remote-and-overseas-jobs",
    tags: ["海外远程", "全远程工作", "美元薪资"]
  },
  {
    url: "https://mujicv.com",
    title: "木及简历",
    description: "极简纯粹的在线 Markdown 简历生成工具，支持纯文本实时排版、模块灵活微调与高保真矢量 PDF 秒级导出。",
    categoryId: "reg-resume-tools",
    tags: ["在线简历", "Markdown排版", "PDF导出"]
  },
  {
    url: "https://www.wondercv.com",
    title: "超级简历 (WonderCV)",
    description: "遵循大厂与投行 HR 筛选逻辑的专业求职简历制作平台，提供免费中英双语模板与智能简历诊断服务。",
    categoryId: "reg-resume-tools",
    tags: ["简历模板", "求职简历", "简历诊断"]
  },
  {
    url: "https://www.upwork.com",
    title: "Upwork",
    description: "全球规模最大的企业自由职业者众包协作网络，汇集全球各行业的开发者、设计师与顾问接单项目。",
    categoryId: "reg-freelance",
    tags: ["全球接单", "自由职业", "外包协作"]
  },
  {
    url: "https://www.zbj.com",
    title: "猪八戒网",
    description: "国内领先的企业服务与创意技能众包交易商城，提供软件定制、品牌设计、商标注册与灵活用工接单。",
    categoryId: "reg-freelance",
    tags: ["众包服务", "软件外包", "兼职接单"]
  },

  // ==================== 8. 金融财经 / reg-finance-and-investing ====================
  {
    url: "https://www.icbc.com.cn",
    title: "中国工商银行",
    description: "中国资产规模最大的国有大型商业银行官方门户，提供个人与企业网上银行综合账户与资金管理服务。",
    categoryId: "reg-banking",
    tags: ["国有银行", "网上银行", "金融账户"]
  },
  {
    url: "https://www.cmbchina.com",
    title: "招商银行",
    description: "以创新服务与卓越用户体验闻名的领先零售商业银行，提供一网通在线理财、信用卡与生活金融服务。",
    categoryId: "reg-banking",
    tags: ["商业银行", "零售金融", "财富管理"]
  },
  {
    url: "https://www.eastmoney.com",
    title: "东方财富网",
    description: "中国专业财经证券综合门户，提供实时 A 股、港股、美股全市场行情数据、财经快讯与投资股吧社区。",
    categoryId: "reg-securities-and-quotes",
    tags: ["证券行情", "A股数据", "财经门户", "股吧社区"]
  },
  {
    url: "https://xueqiu.com",
    title: "雪球",
    description: "聪明的投资者聚集地，提供全市场跨资产行情、上市公司深度财报透视与高活跃度专业投资交流社群。",
    categoryId: "reg-securities-and-quotes",
    tags: ["投资社区", "股票行情", "基金投资", "财报分析"]
  },
  {
    url: "https://www.tradingview.com",
    title: "TradingView",
    description: "全球交易者与专业分析师首选的现代金融图表平台，提供完备的技术分析指标库与跨市场云端图表。",
    categoryId: "reg-securities-and-quotes",
    tags: ["专业图表", "技术指标", "全球市场", "行情分析"]
  },
  {
    url: "https://fund.eastmoney.com",
    title: "天天基金网",
    description: "东方财富旗下中国领先的独立第三方证券投资基金销售平台，提供基金净值查询、排行与智能定投工具。",
    categoryId: "reg-funds-and-wealth",
    tags: ["基金净值", "基金定投", "理财平台"]
  },
  {
    url: "https://qianji.app",
    title: "钱迹",
    description: "深受极简主义者好评的无开屏广告个人记账应用，支持多资产账户关联、预算管理与资产负债清晰统计。",
    categoryId: "reg-personal-finance",
    tags: ["极简记账", "资产管理", "财务预算"]
  },
  {
    url: "https://robo.datayes.com",
    title: "萝卜投研",
    description: "基于人工智能与大数据的专业金融投资研究终端，提供上市公司深度研报提取、财务预警与产业知识图谱。",
    categoryId: "reg-research-and-reports",
    tags: ["投研终端", "券商研报", "财务数据", "行业分析"]
  },
  {
    url: "https://www.cninfo.com.cn",
    title: "巨潮资讯网",
    description: "中国证监会指定的上市公司信息披露官方网站，权威实时发布深沪京三所上市公司公告与官方法定财报。",
    categoryId: "reg-research-and-reports",
    tags: ["官方公告", "信息披露", "证券监管", "财报披露"]
  },

  // ==================== 9. 游戏电竞 / reg-gaming-and-esports ====================
  {
    url: "https://store.steampowered.com",
    title: "Steam",
    description: "全球规模最大的综合性数字游戏发行平台与玩家社区，拥有数万款跨平台正版电脑游戏与创意工坊模组生态。",
    categoryId: "reg-game-platforms",
    tags: ["数字游戏", "Steam", "联机平台", "创意工坊"]
  },
  {
    url: "https://store.epicgames.com",
    title: "Epic Games Store",
    description: "知名数字游戏发行平台，每周定期赠送正版精品大作，拥有低抽成开发者友好政策与虚幻引擎原生集成生态。",
    categoryId: "reg-game-platforms",
    tags: ["游戏商店", "周免游戏", "虚幻引擎", "正版游戏"]
  },
  {
    url: "https://www.gog.com",
    title: "GOG.com",
    description: "CD PROJEKT 旗下数字游戏商店，坚持完全无 DRM 限制，专注于经典复刻佳作与优秀独立游戏发行。",
    categoryId: "reg-game-platforms",
    tags: ["无DRM", "经典游戏", "独立游戏"]
  },
  {
    url: "https://store.playstation.com",
    title: "PlayStation Store",
    description: "索尼互娱 PlayStation 官方数字商城，提供 PS5/PS4 主机独占大作、Plus 订阅制会员游戏库与数字版下载。",
    categoryId: "reg-console-and-cloud-gaming",
    tags: ["PlayStation", "主机游戏", "索尼互娱"]
  },
  {
    url: "https://www.xbox.com",
    title: "Xbox 官方主页",
    description: "微软 Xbox 官方数字平台，提供知名 Xbox Game Pass (XGP) 跨平台海量游戏畅玩库与 xCloud 云游戏体验。",
    categoryId: "reg-console-and-cloud-gaming",
    tags: ["Xbox", "XGP", "主机平台", "云游戏"]
  },
  {
    url: "https://gamer.qq.com",
    title: "腾讯先锋云游戏",
    description: "腾讯官方正版云游戏平台，支持电脑、手机跨端免下载秒级体验多款热门 PC 与移动端大型竞技网游。",
    categoryId: "reg-console-and-cloud-gaming",
    tags: ["腾讯云游戏", "免下载畅玩", "跨端游戏"]
  },
  {
    url: "https://www.gcores.com",
    title: "机核网 (GCORES)",
    description: "国内备受青年玩家喜爱的综合泛游戏文化与生活方式媒体，产出极高深度的游戏幕后、播客节目与考据专栏。",
    categoryId: "reg-gaming-media",
    tags: ["游戏文化", "深度媒体", "游戏播客", "文化考据"]
  },
  {
    url: "https://www.gamersky.com",
    title: "游民星空",
    description: "国内大型专业游戏门户网站，提供全球即时游戏发售动态、硬件评测、权威评分榜单与深度游戏评测。",
    categoryId: "reg-gaming-media",
    tags: ["游戏资讯", "单机门户", "发售日历", "硬件评测"]
  },
  {
    url: "https://bbs.nga.cn",
    title: "NGA 玩家社区",
    description: "国内极具影响力的专业硬核玩家论坛，覆盖魔兽世界、手机游戏、单机主机与硬件数码深度攻略交流。",
    categoryId: "reg-gaming-community",
    tags: ["游戏论坛", "玩家社区", "硬核讨论", "攻略专区"]
  },
  {
    url: "https://www.xiaoheihe.cn",
    title: "小黑盒",
    description: "专为广大 Steam、主机与手游玩家设计的战绩数据查询、折扣史低比价与活跃玩家社群平台。",
    categoryId: "reg-gaming-community",
    tags: ["战绩查询", "史低比价", "玩家社群"]
  },

  // ==================== 10. 资讯媒体 / reg-news-and-media ====================
  {
    url: "https://www.gov.cn",
    title: "中国政府网",
    description: "中华人民共和国中央人民政府权威门户网站，权威准确发布国务院重大决策部署、国家政策文件与政务信息。",
    categoryId: "reg-official-releases",
    tags: ["中央政府", "政策法规", "政务发布", "国家门户"]
  },
  {
    url: "https://www.xinhuanet.com",
    title: "新华网",
    description: "新华社主办的中国权威国家级网络通讯社与综合新闻信息服务平台，实时报道国内外重大时政与社会新闻。",
    categoryId: "reg-official-releases",
    tags: ["国家通讯社", "权威发布", "时政要闻"]
  },
  {
    url: "https://www.thepaper.cn",
    title: "澎湃新闻",
    description: "专注时政新闻与思想评论的高品质原创新闻平台，以深度特稿、舆论监督与专业调查报道见长。",
    categoryId: "reg-general-news-portals",
    tags: ["原创新闻", "深度特稿", "时政思想"]
  },
  {
    url: "https://www.jiemian.com",
    title: "界面新闻",
    description: "中国具有广泛影响力的原创财经与商业新闻平台，覆盖上市公司深度调查、科技前沿动态与商业领袖访谈。",
    categoryId: "reg-general-news-portals",
    tags: ["商业报道", "财经资讯", "原创商业"]
  },
  {
    url: "https://www.caixin.com",
    title: "财新网",
    description: "中国公信力与权威度最高的高端金融与经济新闻机构，以高质量的金融调查报道与独家宏观经济分析著称。",
    categoryId: "reg-finance-news",
    tags: ["深度财经", "金融调查", "财新传媒", "经济智库"]
  },
  {
    url: "https://wallstreetcn.com",
    title: "华尔街见闻",
    description: "全球金融市场 7x24 小时全球即时行情快讯与专业宏观脱水研报平台，为专业投资者提供敏锐市场预警。",
    categoryId: "reg-finance-news",
    tags: ["实时快讯", "全球宏观", "金融见闻", "投资研报"]
  },
  {
    url: "https://36kr.com",
    title: "36氪",
    description: "中国领先的新经济科技创新创业媒体，深度追踪早期科技创新、风险投资动态与明星创业公司成长故事。",
    categoryId: "reg-niche-industry-news",
    tags: ["科技创投", "新经济", "独角兽", "融资快讯"]
  },
  {
    url: "https://www.huxiu.com",
    title: "虎嗅网",
    description: "聚焦科技商业、产业互联网与数字文化潮流的深度商业评论平台，产出视角犀利具有独立思考价值的文章。",
    categoryId: "reg-niche-industry-news",
    tags: ["商业评论", "产业观察", "科技洞察"]
  },

  // ==================== 11. 影音娱乐 / reg-entertainment ====================
  {
    url: "https://www.bilibili.com",
    title: "哔哩哔哩 (Bilibili)",
    description: "中国年轻世代标志性的综合视频与弹幕创作社区，拥有海量高质量科技科普、数码评测、番剧与多元创作内容。",
    categoryId: "reg-long-video",
    tags: ["弹幕视频", "B站", "二次元", "知识科普", "长视频"]
  },
  {
    url: "https://www.iqiyi.com",
    title: "爱奇艺",
    description: "国内领先的高清正版综合视频流媒体平台，提供海量自制热播华语剧集、正版电影与现象级综艺节目。",
    categoryId: "reg-long-video",
    tags: ["正版长视频", "热播剧集", "影视流媒体"]
  },
  {
    url: "https://v.qq.com",
    title: "腾讯视频",
    description: "腾讯旗下旗舰在线视频平台，聚合海量优质热播剧集、少儿动漫、体育赛事直播与独家纪录片。",
    categoryId: "reg-long-video",
    tags: ["在线视频", "腾讯视频", "高清剧集"]
  },
  {
    url: "https://music.163.com",
    title: "网易云音乐",
    description: "深受年轻人喜爱的个性化流媒体音乐平台，以独树一帜的精准歌单算法推荐、乐评社交与独立音乐人孵化闻名。",
    categoryId: "reg-music",
    tags: ["在线音乐", "歌单推荐", "独立音乐", "网易云"]
  },
  {
    url: "https://y.qq.com",
    title: "QQ音乐",
    description: "腾讯旗下曲库规模庞大、版权资源丰富的高清流媒体音乐平台，提供无损高解析音质与全景声听觉体验。",
    categoryId: "reg-music",
    tags: ["数字音乐", "无损曲库", "QQ音乐"]
  },
  {
    url: "https://open.spotify.com",
    title: "Spotify",
    description: "全球主流流媒体音乐与全球播客巨头，拥有无可比拟的全球流行曲库与卓越的个性化算法推荐体验。",
    categoryId: "reg-music",
    tags: ["全球音乐", "Spotify", "播客流媒体"]
  },
  {
    url: "https://www.ximalaya.com",
    title: "喜马拉雅",
    description: "中国著名的移动音频分享平台，拥有涵盖有声小说、儿童故事、相声评书与名家大师课的万千声音宝库。",
    categoryId: "reg-podcast-and-audiobooks",
    tags: ["有声读物", "音频分享", "有声书"]
  },
  {
    url: "https://www.xiaoyuzhoufm.com",
    title: "小宇宙 App",
    description: "界面优雅纯粹的中文泛用型播客客户端，汇聚全网最优质的中文中文播客单集、时间戳高亮与听友高能热评。",
    categoryId: "reg-podcast-and-audiobooks",
    tags: ["中文播客", "音频收听", "小宇宙"]
  },
  {
    url: "https://zh.moegirl.org.cn",
    title: "萌娘百科",
    description: "万物皆可萌的二次元 ACG 动漫文化百科全书，记录详尽的动画、漫画、轻小说设定与声优角色资料档案。",
    categoryId: "reg-anime-and-fandom",
    tags: ["二次元百科", "萌娘百科", "动漫资料"]
  },

  // ==================== 12. 公共民生 / reg-public-services ====================
  {
    url: "https://si.12333.gov.cn",
    title: "国家社会保险公共服务平台",
    description: "人力资源社会保障部全国统一的社保公共服务门户，提供参保证明查验、养老金待遇测算与社保卡在线业务。",
    categoryId: "reg-social-security-and-housing-fund",
    tags: ["社保查询", "养老金测算", "政务便民"]
  },
  {
    url: "https://fuwu.nhsa.gov.cn",
    title: "国家医保服务平台",
    description: "国家医疗保障局官方政务服务门户，支持医保电子凭证激活、跨省异地就医直接结算备案与医保药品目录检索。",
    categoryId: "reg-social-security-and-housing-fund",
    tags: ["国家医保", "异地就医", "医保凭证"]
  },
  {
    url: "https://s.nia.gov.cn",
    title: "国家移民管理局政务服务平台",
    description: "中国出入境通行证件预约办理、往来港澳台签注查询、护照进度与出入境个人记录官方查询服务大厅。",
    categoryId: "reg-household-and-entry-exit",
    tags: ["出入境政务", "护照办理", "港澳签注"]
  },
  {
    url: "https://wenshu.court.gov.cn",
    title: "中国裁判文书网",
    description: "最高人民法院官方裁判文书公开平台，依法公开全国各级人民法院作出的生效裁判文书，是权威法律实务研究宝库。",
    categoryId: "reg-justice-and-law",
    tags: ["裁判文书", "司法公开", "法律检索", "最高法院"]
  },
  {
    url: "https://flk.npc.gov.cn",
    title: "国家法律法规数据库",
    description: "全国人大常委会法工委建设的国家级法律法规数据库，收录全部宪法、现行有效法律、行政法规与司法解释。",
    categoryId: "reg-justice-and-law",
    tags: ["法律法规", "法条查询", "全国人大官方"]
  },
  {
    url: "https://www.gsxt.gov.cn",
    title: "国家企业信用信息公示系统",
    description: "国家市场监管总局主办的官方企业信用信息统一查询入口，权威核查全国企事业单位工商登记、股东及经营异常状态。",
    categoryId: "reg-market-regulation",
    tags: ["企业信用", "工商核查", "市场监管"]
  },
  {
    url: "https://dxy.com",
    title: "丁香医生",
    description: "国内知名专业的可信赖医学健康科普与在线健康咨询平台，由一线资深医生团队撰写通俗专业的辟谣与就医指南。",
    categoryId: "reg-healthcare",
    tags: ["医学科普", "在线就医", "健康辟谣"]
  },
  {
    url: "https://www.jiandanxinli.com",
    title: "简单心理",
    description: "国内提供专业循证心理咨询的高标准服务平台，汇集受严格系统伦理受训的高水准心理咨询师资源。",
    categoryId: "reg-mental-health",
    tags: ["心理咨询", "心理健康", "心理科普"]
  },

  // ==================== 13. 消费生活 / reg-consumer-life ====================
  {
    url: "https://www.smzdm.com",
    title: "什么值得买",
    description: "中国著名的数码家电消费门户与网购优惠决策社区，提供真实用户深度长测好文、历史低价走势与海淘攻略。",
    categoryId: "reg-digital-and-home",
    tags: ["数码测评", "消费指南", "优惠折扣", "好物推荐"]
  },
  {
    url: "https://www.yidoutang.com",
    title: "一兜糖家居",
    description: "真实屋主装修经验与软装家居审美交流社区，提供全套真实新房装修案例、避坑清单与智能家居布置灵感。",
    categoryId: "reg-digital-and-home",
    tags: ["家居装修", "软装设计", "生活美学"]
  },
  {
    url: "https://2.taobao.com",
    title: "闲鱼",
    description: "阿里巴巴旗下中国最大的个人闲置物品二手交易平台，覆盖数码手机、手办潮玩、图书二手与同城面交社区。",
    categoryId: "reg-secondhand-market",
    tags: ["二手交易", "闲置转让", "数码回收", "闲鱼"]
  },
  {
    url: "https://www.zhuanzhuan.com",
    title: "转转",
    description: "专注数码电子产品的专业二手优品交易与专业质检平台，提供官方上门验机、二手质保与旧机估价回收。",
    categoryId: "reg-secondhand-market",
    tags: ["二手质检", "数码回收", "二手手机"]
  },
  {
    url: "https://www.ctrip.com",
    title: "携程旅行",
    description: "全球领先的一站式旅行预订服务平台，涵盖特价机票、全球高品质酒店民宿、火车票与度假定制保障服务。",
    categoryId: "reg-travel-and-lodging",
    tags: ["旅游预订", "特价机票", "酒店预订", "出行保障"]
  },
  {
    url: "https://www.mafengwo.cn",
    title: "马蜂窝",
    description: "年轻一代喜爱的中国旅游目的地攻略社区，汇集全球旅游达人深度图文游记、自由行路书与小众景点发掘指南。",
    categoryId: "reg-travel-and-lodging",
    tags: ["旅游攻略", "自由行路书", "游记探索"]
  },
  {
    url: "https://www.xiachufang.com",
    title: "下厨房",
    description: "国内极具烟火气的美食菜谱分享社区，拥有数十万道步骤详尽的家常菜烹饪食谱、烘焙配方与厨友交流笔记。",
    categoryId: "reg-food-and-drink",
    tags: ["家常菜谱", "烘焙配方", "烹饪教学", "美食社区"]
  },

  // ==================== 14. 设计与创意 / reg-design-and-creative ====================
  {
    url: "https://ant.design",
    title: "Ant Design",
    description: "蚂蚁集团开源的企业级 UI 设计语言与全链路 React/Vue 组件库规范，被全球数万企业后台系统广泛采纳。",
    categoryId: "reg-design-systems",
    tags: ["设计系统", "组件库", "UI规范", "蚂蚁设计"]
  },
  {
    url: "https://developer.apple.com/design/human-interface-guidelines",
    title: "Apple Human Interface Guidelines",
    description: "苹果官方全平台人机交互设计规范 (HIG)，定义了 iOS、macOS、visionOS 与 watchOS 顶级精致交互美学标杆。",
    categoryId: "reg-design-systems",
    tags: ["交互设计", "苹果规范", "HIG", "UI设计"]
  },
  {
    url: "https://m3.material.io",
    title: "Material Design (M3)",
    description: "谷歌 Material 3 现代化跨端自适应设计规范，引入动态色彩取色体系、流畅动效哲学与无障碍设计标准。",
    categoryId: "reg-design-systems",
    tags: ["MaterialDesign", "谷歌设计", "设计规范"]
  },
  {
    url: "https://unsplash.com",
    title: "Unsplash",
    description: "享誉全球的免费高分辨率免版税摄影图片共享社区，数百万专业摄影师贡献海量可安全商用高清视觉图片。",
    categoryId: "reg-stock-media",
    tags: ["免版权图片", "高清摄影", "商用壁纸", "视觉素材"]
  },
  {
    url: "https://www.pexels.com",
    title: "Pexels",
    description: "知名的高品质免费素材图片与 4K 高清视频片段库，所有精选素材均支持完全免署名自由商用与个人二创。",
    categoryId: "reg-stock-media",
    tags: ["免费图库", "4K视频素材", "商用免版权"]
  },
  {
    url: "https://worldvectorlogo.com",
    title: "Worldvectorlogo",
    description: "全球规模最大的知名企业、科技产品与品牌官方高保真矢量 SVG Logo 下载中心，方便设计师随时取用规范标识。",
    categoryId: "reg-brand-and-identity",
    tags: ["矢量Logo", "品牌VI", "SVG图标", "标志下载"]
  }
];

export async function run() {
  console.log("=== 开始检查待入库候选站点清单 ===");
  console.log("候选站点总量:", CANDIDATE_SITES.length);

  // 1. 获取现有数据库中所有分类与所有已存在站点
  const cats = await fetch("http://127.0.0.1:8787/api/categories").then(r => r.json());
  const validCatIds = new Set(cats.filter(c => !!c.parentId).map(c => c.id));
  
  const allSites = [];
  let offset = 0;
  while (true) {
    const batch = await fetch("http://127.0.0.1:8787/api/sites?limit=500&offset=" + offset).then(r => r.json());
    allSites.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  
  const normalize = (u) => u.toLowerCase().trim().replace(/\/+$/, "");
  const existingUrls = new Set(allSites.map(s => normalize(s.url)));
  const existingTitles = new Set(allSites.map(s => s.title.toLowerCase().trim()));

  console.log("已存在库内站点数:", allSites.length);

  // 2. 严格筛选待写入站点
  const toAdd = [];
  const seenInBatch = new Set();
  let duplicateCount = 0;
  let invalidCategoryCount = 0;

  for (const item of CANDIDATE_SITES) {
    const normUrl = normalize(item.url);
    if (existingUrls.has(normUrl) || seenInBatch.has(normUrl)) {
      console.warn("  [跳过已存在 URL]", item.title, "->", item.url);
      duplicateCount++;
      continue;
    }
    if (!validCatIds.has(item.categoryId)) {
      console.error("  [错误分类 ID]", item.title, "->", item.categoryId);
      invalidCategoryCount++;
      continue;
    }
    seenInBatch.add(normUrl);
    toAdd.push(item);
  }

  console.log("\n=== 预检查完成 ===");
  console.log("有效待新增站点数:", toAdd.length);
  console.log("跳过的重复站点数:", duplicateCount);
  console.log("错误分类站点数:", invalidCategoryCount);

  if (invalidCategoryCount > 0) {
    throw new Error("存在无效分类，中止执行！");
  }

  if (toAdd.length === 0) {
    console.log("没有新站点需要写入。");
    return;
  }

  // 3. 分批调用 POST /api/sites/batch
  const BATCH_SIZE = 50;
  let totalCreated = 0;
  let totalDuplicates = 0;

  for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
    const chunk = toAdd.slice(i, i + BATCH_SIZE);
    console.log(`正在写入批次 ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} 个站点)...`);
    const resp = await fetch("http://127.0.0.1:8787/api/sites/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sites: chunk })
    }).then(r => r.json());

    if (!resp.success) {
      console.error("批次写入报错:", resp);
      throw new Error("写入失败");
    }
    totalCreated += resp.created;
    totalDuplicates += resp.duplicates;
    console.log(`  -> 本批成功新建: ${resp.created}, 重复拦截: ${resp.duplicates}`);
  }

  console.log("\n🎉 全量写入完成！");
  console.log(`总计成功新增站点: ${totalCreated}`);
  console.log(`总计去重拦截: ${totalDuplicates}`);
}

run().catch(e => {
  console.error("执行脚本异常:", e);
  process.exit(1);
});
