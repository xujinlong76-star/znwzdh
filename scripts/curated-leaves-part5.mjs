export const CURATED_PART5 = {
  "reg-css-and-styling": [
    { name: "Stylelint", url: "https://stylelint.io/", desc: "现代强大的CSS、SCSS与CSS-in-JS代码规范检查与静态分析Linter工具", tags: ["CSS规范", "Stylelint", "前端工程"] },
    { name: "Open Props", url: "https://open-props.style/", desc: "基于原生CSS自定义属性（CSS Variables）的超轻量原子化设计Token库", tags: ["CSS变量", "DesignTokens", "原子CSS"] },
    { name: "Lightning CSS", url: "https://lightningcss.dev/", desc: "基于Rust编写的极速CSS解析器、前缀转换器、打包器与压缩工具", tags: ["LightningCSS", "Rust前端", "CSS构建"] }
  ],
  "reg-fullstack-and-server": [
    { name: "AnalogJS", url: "https://analogjs.org/", desc: "基于Vite驱动的Angular全栈元框架，支持SSR服务端渲染与文件路由", tags: ["AnalogJS", "Angular全栈", "SSR"] },
    { name: "Waku", url: "https://waku.gg/", desc: "由Zustand作者Daishi Kato打造的轻量级React Server Components (RSC)全栈框架", tags: ["Waku", "ReactRSC", "轻量全栈"] },
    { name: "Nitro (UnJS)", url: "https://nitro.unjs.io/", desc: "驱动Nuxt 3的跨平台高性能JavaScript服务端引擎，支持零配置部署至任何边缘云", tags: ["Nitro", "UnJS", "服务端引擎"] },
    { name: "Enhance.dev", url: "https://enhance.dev/", desc: "基于Web Components原生标准与渐进增强理念的HTML优先全栈SSR框架", tags: ["WebComponents", "SSR", "全栈框架"] }
  ],
  "reg-low-code-builder": [
    { name: " NocoBase", url: "https://www.nocobase.com/", desc: "极易扩展的开源数据模型驱动无代码与低代码企业开发平台", tags: ["NocoBase", "开源无代码", "数据驱动"] },
    { name: "illa Cloud (ILLA Builder)", url: "https://illacloud.com/", desc: "面向开发者的开源低代码内部工具构建平台，支持AI Agent与数据库直连", tags: ["ILLA", "开源低代码", "内部工具"] },
    { name: "Plasmic", url: "https://www.plasmic.app/", desc: "面向React与Next.js代码库的开源可视化UI构建器与无头CMS页面搭建工具", tags: ["Plasmic", "可视化React", "页面搭建"] }
  ],
  "reg-i18n-and-a11y": [
    { name: "Paraglide JS (inlang)", url: "https://inlang.com/", desc: "具备极致Tree-shaking与零运行时开销的现代化类型安全前端国际化i18n编译器与生态", tags: ["inlang", "类型安全i18n", "前端国际化"] },
    { name: "Pa11y", url: "https://pa11y.org/", desc: "自动化Web无障碍（Accessibility）命令行与CI持续集成合规检测工具套件", tags: ["Pa11y", "无障碍测试", "A11y自动化"] },
    { name: "A11y Project", url: "https://www.a11yproject.com/", desc: "由全球前端社区共同维护的数字无障碍开发核对清单（Checklist）与最佳实践指南", tags: ["A11yProject", "无障碍清单", "Web标准"] },
    { name: "Unicode CLDR (通用区域设置数据仓库)", url: "https://cldr.unicode.org/", desc: "Unicode联盟维护的全球所有操作系统与浏览器国际化（日期、货币、复数规则）底层权威标准数据库", tags: ["UnicodeCLDR", "国际化底层标准", "全球区域设置"] },
    { name: "NV Access (NVDA 开源屏幕阅读器)", url: "https://www.nvaccess.org/", desc: "全球视障开发者与Web无障碍（A11y）测试工程师必测的免费开源Windows屏幕阅读器官方网站", tags: ["NVDA读屏", "无障碍实测", "开源屏幕阅读器"] },
    { name: "Inclusive Components", url: "https://inclusive-components.design/", desc: "无障碍大师Heydon Pickering撰写的如何用标准ARIA与语义化HTML编写高无障碍组件（Tab/Modal/Menu）的权威指南", tags: ["InclusiveComponents", "ARIA组件模式", "无障碍设计"] }
  ],
  "reg-backend-frameworks": [
    { name: "Fiber (Go)", url: "https://gofiber.io/", desc: "受Express启发、基于Fasthttp构建的Go语言极致高性能Web后端框架", tags: ["GoFiber", "Golang后端", "高性能Web"] },
    { name: "Litestar (Python)", url: "https://litestar.dev/", desc: "现代高性能Python异步ASGI后端框架，内置依赖注入、DTO验证与OpenAPI生成", tags: ["Litestar", "Python异步", "ASGI框架"] },
    { name: "Encore.dev", url: "https://encore.dev/", desc: "内置分布式追踪、基础设施声明式编排与类型安全的Go与TypeScript云原生后端框架", tags: ["Encore", "云原生后端", "微服务框架"] }
  ],
  "reg-caching-and-search": [
    { name: "Manticore Search", url: "https://manticoresearch.com/", desc: "源自Sphinx、基于C++构建的超高速开源全文检索与向量搜索数据库", tags: ["Manticore", "全文检索", "C++搜索引擎"] },
    { name: "Quickwit", url: "https://quickwit.io/", desc: "基于Rust与Tantivy打造的云原生对象存储亚秒级日志与全文搜索引擎", tags: ["Quickwit", "Rust搜索", "云原生日志"] },
    { name: "Pelikan Cache (Twitter/X)", url: "https://pelikan.io/", desc: "Twitter开源的模块化高性能内存缓存服务框架，针对海量小对象缓存优化", tags: ["Pelikan", "内存缓存", "分布式缓存"] }
  ],
  "reg-testing-and-load": [
    { name: "Testcontainers", url: "https://testcontainers.com/", desc: "在单元测试与集成测试中按需拉起真实Docker数据库与消息队列实例的行业标准库", tags: ["Testcontainers", "集成测试", "Docker测试"] },
    { name: "Vegeta (HTTP Load Testing)", url: "https://github.com/tsenart/vegeta", desc: "基于Go语言编写的知名命令行与库双模式恒定速率HTTP高并发压力测试工具", tags: ["Vegeta", "Go压测", "HTTP基准测试"] },
    { name: "Hurl", url: "https://hurl.dev/", desc: "Orange开源的基于纯文本声明式语法与libcurl的HTTP接口测试与性能断言工具", tags: ["Hurl", "接口测试", "CLI测试"] }
  ],
  "reg-sre-and-postmortem": [
    { name: "Rootly", url: "https://rootly.com/", desc: "深度集成Slack的现代化SRE故障应急指挥、自动化On-Call升级与AI故障复盘平台", tags: ["Rootly", "故障指挥", "SRE复盘"] },
    { name: "Keep (Open-Source AIOps)", url: "https://www.keephq.dev/", desc: "开源AIOps告警聚合、去重、关联分析与自动化SRE故障响应工作流平台", tags: ["KeepHQ", "开源告警", "AIOps"] },
    { name: "Void / Verica Open Incident Database", url: "https://www.thevoid.community/", desc: "收录全球各大科技公司真实生产环境故障复盘报告（Postmortems）的开放知识库", tags: ["故障报告库", "Postmortem", "SRE案例"] }
  ],
  "reg-code-review": [
    { name: "CodeScene", url: "https://codescene.com/", desc: "基于行为代码分析（Behavioral Code Analysis）的技术债可视化、热点定位与PR代码评审平台", tags: ["CodeScene", "技术债分析", "代码热点"] },
    { name: "Sourcery AI", url: "https://sourcery.ai/", desc: "支持GitHub/GitLab与IDE的自动化代码重构建议、安全规则校验与AI代码评审工具", tags: ["Sourcery", "自动重构", "AI代码评审"] },
    { name: "Qlty (原 Code Climate Quality)", url: "https://qlty.sh/", desc: "新一代极速多语言代码质量度量、测试覆盖率门禁与自动化格式化评审平台", tags: ["Qlty", "代码质量", "测试覆盖率"] },
    { name: "Trunk Check", url: "https://trunk.io/", desc: "统一管理百余种代码Linter、安全扫描器、合并队列（Merge Queue）与PR自动检查的工程平台", tags: ["Trunk", "MergeQueue", "统一Linter"] }
  ],
  "reg-learning-paths": [
    { name: "The Odin Project", url: "https://www.theodinproject.com/", desc: "全球口碑极佳的完全免费开源全栈Web开发（Ruby on Rails / JavaScript）实战学习路线社区", tags: ["OdinProject", "全栈路线", "开源免费"] },
    { name: "Full Stack Open (赫尔辛基大学)", url: "https://fullstackopen.com/zh/", desc: "芬兰赫尔辛基大学计算机系官方开源中文版现代React、Redux、Node.js、GraphQL与TypeScript全栈课程", tags: ["FullStackOpen", "名校开源课", "React全栈"] },
    { name: "OSSU (Open Source Society University)", url: "https://cs.ossu.dev/", desc: "GitHub超17万星标的完全免费计算机科学本科名校公开课自学完整培养方案与路线图", tags: ["OSSU", "计算机本科路线", "名校自学"] },
    { name: "CS自学指南 (PKUFlyingPig)", url: "https://csdiy.wiki/", desc: "北大学子编写的中文互联网最具影响力的全球顶尖高校CS神课（CS61A/CSAPP/MIT6.S081）自学路线指南", tags: ["CS自学指南", "北大开源", "名校神课"] },
    { name: "Teach Yourself Computer Science", url: "https://teachyourselfcs.com/", desc: "旧金山Bradfield计算机学院出品的工程师必读9大计算机核心底层科目经典教材与视频学习路线", tags: ["TeachYourselfCS", "底层核心", "经典教材路线"] }
  ],
  "reg-ui-assets": [
    { name: "UI8", url: "https://ui8.net/", desc: "全球顶尖设计师出品的高品质Figma设计系统、3D插画套件、App UI Kit与网页模板市场", tags: ["UI8", "Figma套件", "精品UI"] },
    { name: "Craftwork Design", url: "https://craftwork.design/", desc: "专注于高品质矢量3D插画、Figma线框图组件库与SaaS落地页UI设计资源的知名工作室平台", tags: ["Craftwork", "SaaS插画", "组件库"] },
    { name: "unDraw", url: "https://undraw.co/", desc: "完全开源免费商用、支持在线一键自定义品牌主题色的扁平化SVG网页插画素材库", tags: ["unDraw", "开源SVG插画", "可改色"] },
    { name: "Storyset (by Freepik)", url: "https://storyset.com/", desc: "支持在线自定义配色、背景图层隐藏与CSS/Lottie微动画导出的免费矢量插画库", tags: ["Storyset", "动态插画", "免费矢量"] },
    { name: "Open Peeps", url: "https://www.openpeeps.com/", desc: "Pablo Stanley创作的CC0完全免费手绘风人物半身/全身模块化自由拼装SVG插画库", tags: ["OpenPeeps", "手绘人物", "CC0插画"] },
    { name: "Humaaans", url: "https://www.humaaans.com/", desc: "支持像乐高一样自由组合发型、服饰、姿态与场景的免费商用扁平人物UI插画库", tags: ["Humaaans", "模块化插画", "免费商用"] },
    { name: "DrawKit", url: "https://www.drawkit.com/", desc: "面向初创公司与产品设计师的每日更新2D手绘与3D渲染SVG/PNG UI插画及图标素材站", tags: ["DrawKit", "产品插画", "3D图标"] }
  ],
  "reg-color-palettes": [
    { name: "Realtime Colors", url: "https://www.realtimecolors.com/", desc: "在真实网页排版布局上实时预览并测试文本色、背景色、主副强调色搭配效果的网红配色神器", tags: ["RealtimeColors", "真实网页预览", "UI配色"] },
    { name: "Huemint", url: "https://huemint.com/", desc: "利用机器学习算法为品牌VI、网站UI与多色插画自动生成高对比度前景/背景配色方案的工具", tags: ["Huemint", "AI机器学习配色", "品牌色板"] },
    { name: "Happy Hues", url: "https://www.happyhues.co/", desc: "不仅提供精选色板，更直接展示每个颜色在按钮、卡片、标题等UI组件中具体用法的色彩灵感站", tags: ["HappyHues", "场景化配色", "色彩心理学"] },
    { name: "UI Colors (Tailwind Color Generator)", url: "https://uicolors.app/", desc: "输入任意单色即可一键生成符合视觉对比度的50-950十级Tailwind CSS标准色阶并实时预览UI组件", tags: ["Tailwind色阶", "UIColors", "设计系统色板"] }
  ],
  "reg-stock-media": [
    { name: "Coverr", url: "https://coverr.co/", desc: "专为网站首页背景、短视频创作者打造的100%免费商用高清航拍、科技与生活4K无版权视频素材库", tags: ["Coverr", "免费4K视频", "网页背景视频"] },
    { name: "Mixkit (by Envato)", url: "https://mixkit.co/", desc: "Envato旗下完全免费商用的高清实拍视频片段、无版权音乐、视频转场特效与达芬奇/PR模板库", tags: ["Mixkit", "免费视频音乐", "剪辑模板"] },
    { name: "Life of Pix", url: "https://www.lifeofpix.com/", desc: "由加拿大Leeroy创意机构策划的CC0公共领域无版权限制高质感街头、建筑与人文摄影图库", tags: ["LifeOfPix", "CC0人文摄影", "高质感图库"] },
    { name: "Kaboompics", url: "https://kaboompics.com/", desc: "深受生活方式博主与室内设计师喜爱的免费商用摄影图库，每张照片均附带自动提取的配套色板", tags: ["Kaboompics", "家居生活图库", "附带色板"] },
    { name: "Burst (by Shopify)", url: "https://www.shopify.com/stock-photos", desc: "Shopify官方出品的免费高分辨率电商产品、零售场景与商业创业无版权商用图片库", tags: ["Burst", "电商素材图", "Shopify官方"] }
  ],
  "reg-brand-and-identity": [
    { name: "Brand New (UnderConsideration)", url: "https://www.underconsideration.com/brandnew/", desc: "全球最具权威性的企业品牌重塑（Rebranding）、知名Logo焕新前后对比与视觉识别专业评论站", tags: ["BrandNew", "品牌焕新案例", "Logo评论"] },
    { name: "Branding Style Guides", url: "https://brandingstyleguides.com/", desc: "全球最大的公开企业VI视觉识别手册（Brand Guidelines）历史档案馆，收录超2000份名企PDF规范", tags: ["VI手册库", "企业视觉规范", "PDF档案"] },
    { name: "Simple Icons", url: "https://simpleicons.org/", desc: "收录超3000个全球知名科技、互联网与消费品牌官方标准SVG Logo图标与官方品牌HEX色值的开源库", tags: ["SimpleIcons", "品牌SVG图标", "官方品牌色"] },
    { name: "Logo Pond", url: "https://logopond.com/", desc: "全球平面设计师展示原创品牌Logo标志、图形徽章与字体标志创意草图的知名灵感社区", tags: ["LogoPond", "标志设计灵感", "图形创意"] }
  ],
  "reg-user-research": [
    { name: "Optimal Workshop", url: "https://www.optimalworkshop.com/", desc: "全球UX信息架构师标杆工具套件，专注卡片分类（Card Sorting）、树状导航测试与首击测试", tags: ["卡片分类", "信息架构测试", "OptimalWorkshop"] },
    { name: "Lyssna (原 UsabilityHub)", url: "https://www.lyssna.com/", desc: "面向产品与设计团队的远程快速5秒印象测试、设计偏好对比投票、原型可用性测试与用户招募平台", tags: ["Lyssna", "5秒测试", "偏好投票"] },
    { name: "Baymard Institute", url: "https://baymard.com/", desc: "全球最权威的电商网站与App用户体验（UX）可用性研究机构，拥有超13万小时真实结账与搜索可用性基准库", tags: ["Baymard", "电商UX研究", "可用性基准"] },
    { name: "Laws of UX", url: "https://lawsofux.com/", desc: "设计师与用研必读的菲茨定律、希克定律、米勒定律等21条核心认知心理学与用户体验法则图解指南", tags: ["LawsOfUX", "交互心理学法则", "用研必读"] }
  ],
  "reg-collaborative-docs": [
    { name: "AFFiNE", url: "https://affine.pro/", desc: "融合Notion结构化文档与Miro无尽画布白板的下一代开源本地优先（Local-First）知识库与协作工作台", tags: ["AFFiNE", "开源Notion替代", "文档白板合一"] },
    { name: "AppFlowy", url: "https://appflowy.io/", desc: "基于Flutter与Rust构建的开源隐私优先AI协作工作区、看板项目管理与多维表格文档平台", tags: ["AppFlowy", "Rust开源文档", "隐私优先"] },
    { name: "Outline (GetOutline)", url: "https://www.getoutline.com/", desc: "面向高速成长团队的极速开源Markdown团队Wiki知识库，支持实时协同编辑与Slack/GitHub深度集成", tags: ["Outline", "开源团队Wiki", "Markdown协作"] },
    { name: "BookStack", url: "https://www.bookstackapp.com/", desc: "采用“书架-书籍-章节-页面”直观心智模型的开源自托管企业文档与知识管理系统", tags: ["BookStack", "自托管知识库", "开源文档"] },
    { name: "Anytype", url: "https://anytype.io/", desc: "基于点对点加密同步与对象图谱（Object-based）模型的本地优先个人与团队协作知识库", tags: ["Anytype", "本地优先", "端到端加密"] },
    { name: "SiYuan 思源笔记", url: "https://b3log.org/siyuan/", desc: "国产开源隐私优先的本地块级双链笔记与个人知识管理系统，支持细粒度块引用、SQL查询与Docker自托管", tags: ["思源笔记", "国产开源双链", "块级引用"] },
    { name: "Docmost", url: "https://docmost.com/", desc: "支持实时多人协同编辑、空间权限管理、内嵌Draw.io与Mermaid图表的开源企业级Confluence替代方案", tags: ["Docmost", "开源Confluence", "多人实时协同"] },
    { name: "SilverBullet", url: "https://silverbullet.md/", desc: "基于纯本地Markdown文件与实时双向链接构建的极客可编程开源Web知识工作台", tags: ["SilverBullet", "Markdown知识库", "可编程笔记"] }
  ],
  "reg-video-conferencing": [
    { name: "BigBlueButton", url: "https://bigbluebutton.org/", desc: "专为在线教学与学术研讨会打造的全球顶级开源WebRTC视频会议系统，内置多用户互动白板与分组讨论室", tags: ["BigBlueButton", "开源在线教室", "学术视频会议"] },
    { name: "Daily.co", url: "https://www.daily.co/", desc: "全球领先的实时音视频WebRTC云通信平台与低延迟AI语音视频会议API基础设施", tags: ["Daily", "WebRTC视频", "音视频通话"] },
    { name: "小鱼易连", url: "https://www.xylink.com/", desc: "国内头部政企与金融级超高清云视频会议、应急指挥调度及智能硬件终端服务商", tags: ["小鱼易连", "政企云视频", "高清会议"] }
  ],
  "reg-mindmaps-and-boards": [
    { name: "tldraw", url: "https://www.tldraw.com/", desc: "GitHub顶流开源无限画布手绘风协同数字白板，支持Make Real一键将手绘草图转化为可运行前端代码", tags: ["tldraw", "开源无限画布", "草图转代码"] },
    { name: "Markmap", url: "https://markmap.js.org/", desc: "将任意Markdown层级文本实时解析渲染为可交互缩放SVG思维导图的知名开源工具", tags: ["Markmap", "Markdown转导图", "开源思维导图"] },
    { name: "Drawnix", url: "https://drawnix.com/", desc: "基于Plait框架构建的开源一体化在线思维导图、流程图与自由画笔白板工具", tags: ["Drawnix", "开源白板导图", "在线绘图"] }
  ],
  "reg-higher-education": [
    { name: "国家高等教育智慧教育平台", url: "https://higher.smartedu.cn/", desc: "教育部主办的全国高校国家级一流本科课程、名师慕课与虚拟仿真实验教学官方总门户", tags: ["教育部高教平台", "一流本科课程", "官方慕课"] },
    { name: "人卫慕课 (人民卫生出版社)", url: "https://www.pmphmooc.com/", desc: "人民卫生出版社官方中国医学高等教育线上平台，汇聚全国顶尖医学院校临床与基础医学课程", tags: ["人卫慕课", "医学高等教育", "临床课程"] },
    { name: "中国高校外语慕课平台UMOOCs", url: "https://moocs.unipus.cn/", desc: "北京外国语大学与外研社联合全国外语院校打造的国家级多语种高等教育慕课平台", tags: ["UMOOCs", "北外外研社", "高校外语慕课"] },
    { name: "超星尔雅 / 学习通高等教育", url: "https://erya.mooc.chaoxing.com/", desc: "全国数千所大专院校广泛采用的大学通识教育选修课、专业核心课与学术讲座在线教学平台", tags: ["超星尔雅", "高校通识课", "大学选修"] }
  ],
  "reg-question-banks": [
    { name: "中国人事考试网", url: "http://www.cpta.com.cn/", desc: "人社部人事考试中心官方网站，统管一级建造师、执业药师、经济师、软考等全国专业技术人员职业资格考试", tags: ["中国人事考试网", "职业资格统考", "人社部官方"] },
    { name: "全国计算机等级考试 NCRE / 软考网", url: "https://www.ruankao.org.cn/", desc: "工信部教育与考试中心主办的全国计算机技术与软件专业技术资格（水平）考试（软考）唯一官方报名与大纲平台", tags: ["软考官网", "工信部考试", "系统架构师"] },
    { name: "Exercism", url: "https://exercism.org/", desc: "全球知名的100%免费公益编程刷题与人类导师1对1代码点评平台，覆盖70+种编程语言与数千道进阶题库", tags: ["Exercism", "70种语言刷题", "导师代码点评"] },
    { name: "Project Euler (欧拉计划)", url: "https://projecteuler.net/", desc: "享誉全球的数论、组合数学与计算机算法融合挑战题库，包含近900道由浅入深的数学编程难题", tags: ["ProjectEuler", "欧拉计划", "数学算法题库"] },
    { name: "东奥会计在线", url: "https://www.dongao.com/", desc: "国内财会考证领域权威平台，提供注册会计师（CPA）、初级中级会计职称与税务师历年真题库及模考系统", tags: ["东奥会计", "CPA注会题库", "会计职称"] }
  ],
  "reg-dictionaries-and-translators": [
    { name: "汉典 ZDIC", url: "https://www.zdic.net/", desc: "收录超9万汉字的权威中华古今汉语字典、词典、成语词典，完整集成《康熙字典》《说文解字》与字源演变", tags: ["汉典", "说文解字", "古今汉语字典"] },
    { name: "Merriam-Webster 韦氏词典", url: "https://www.merriam-webster.com/", desc: "美国历史最悠久、最具权威性的美式英语标准词典、同义词辨析（Thesaurus）与词源考据官方网站", tags: ["韦氏词典", "美式英语权威", "GRE词汇词源"] },
    { name: "Reverso Context", url: "https://context.reverso.net/", desc: "基于数亿句真实双语平行语料库的上下文地道短语翻译、动词变位查询与多语种拼写语法纠错工具", tags: ["Reverso", "双语平行语料", "上下文例句"] },
    { name: "全國科學技術名詞審定委員會 (术语在线 TermOnline)", url: "https://www.termonline.cn/", desc: "中国科学院与全国科技名词委主办的国家级自然科学、工程技术、医学与社科中英文规范学术术语检索平台", tags: ["术语在线", "国家级标准译名", "学术专业词典"] }
  ],
  "reg-paper-writing": [
    { name: "Writefull", url: "https://www.writefull.com/", desc: "基于数百万篇已发表SCI期刊论文真实语料训练的英文学术写作润色、句式模板（Sentence Palette）与标题摘要生成工具", tags: ["Writefull", "SCI学术语料", "论文句式润色"] },
    { name: "Typst", url: "https://typst.app/", desc: "基于Rust编写的下一代现代化开源学术排版系统与实时协作平台，具备媲美LaTeX的排版质量与极简语法", tags: ["Typst", "新一代LaTeX替代", "极速学术排版"] },
    { name: "Academic Phrasebank (曼彻斯特大学)", url: "https://www.phrasebank.manchester.ac.uk/", desc: "英国曼彻斯特大学官方出品的英文学术论文引言、文献综述、方法论、结果讨论全章节标准句型宝典", tags: ["曼大学术句型库", "英文论文模板", "Phrasebank"] },
    { name: "Trinka AI", url: "https://www.trinka.ai/", desc: "专为医学、生命科学、计算机与工程领域SCI学术论文及技术报告打造的语法校对、AMA/APA格式检查与期刊匹配工具", tags: ["Trinka", "SCI语法校对", "APA格式检查"] }
  ],
  "reg-open-access": [
    { name: "国家哲学社会科学文献中心 (NCPSSD)", url: "https://www.ncpssd.cn/", desc: "中国社会科学院承建的国家级公益开放学术平台，向全社会完全免费提供超2000种中文社科核心期刊全文下载", tags: ["社科文献中心", "社科院免费论文", "中文核心开放获取"] },
    { name: "SciELO (Scientific Electronic Library Online)", url: "https://scielo.org/", desc: "覆盖拉美、伊比利亚及南非地区的全球知名国际开放获取（Open Access）同行评审科学期刊电子图书馆联盟", tags: ["SciELO", "国际OA期刊库", "免费全文"] },
    { name: "OAPEN (Open Access Publishing in European Networks)", url: "https://www.oapen.org/", desc: "由欧洲各国大学出版社与研究基金会共建的经同行评审开放获取（OA）学术专著与大学教材免费数字图书馆", tags: ["OAPEN", "开放获取学术专著", "欧洲大学出版社"] }
  ],
  "reg-official-releases": [
    { name: "全国人大网（中国人大网）", url: "http://www.npc.gov.cn/", desc: "全国人民代表大会官方网站，权威发布国家法律草案征求意见、立法动态、两会公报与国家法律法规数据库", tags: ["中国人大网", "国家立法发布", "两会权威"] },
    { name: "中国政协网", url: "http://www.cppcc.gov.cn/", desc: "中国人民政治协商会议全国委员会官方网站，权威发布政协提案、参政议政动态与全国两会重要资讯", tags: ["中国政协网", "全国政协", "参政议政"] },
    { name: "中华人民共和国外交部", url: "https://www.fmprc.gov.cn/", desc: "外交部官方网站，每日更新外交部例行记者会发言人答问实录、外交声明、领事提醒与双边关系公报", tags: ["外交部官网", "发言人记者会实录", "外交权威发布"] },
    { name: "中共中央纪律检查委员会（中央纪委国家监委网站）", url: "https://www.ccdi.gov.cn/", desc: "中央纪委国家监委官方权威发布平台，第一时间通报党纪政务处分、巡视反馈与党风廉政建设权威信息", tags: ["中央纪委国家监委", "权威通报", "廉政发布"] },
    { name: "中华人民共和国国防部", url: "http://www.mod.gov.cn/", desc: "国防部官方网站，权威发布国防部例行记者会、国防白皮书、军事演训通报与国际军事合作官方消息", tags: ["国防部官网", "国防白皮书", "军事权威发布"] }
  ],
  "reg-general-news-portals": [
    { name: "中国新闻网（中新网）", url: "https://www.chinanews.com.cn/", desc: "中国新闻社主办的国家级通讯社综合新闻门户，提供7x24小时国内外时政、财经、社会与侨务权威报道", tags: ["中国新闻网", "中新社", "国家级通讯社"] },
    { name: "中国网 China.com.cn", url: "http://www.china.com.cn/", desc: "国务院新闻办公室领导、中国外文局管理的国家重点新闻网站，以10余种语言向全球直播国新办新闻发布会", tags: ["中国网", "国新办直播", "国家重点门户"] },
    { name: "中国青年报（中青在线）", url: "https://www.cyol.com/", desc: "共青团中央机关报《中国青年报》官方新闻门户，以冰点周刊深度特稿、教育科技与青年社会热点报道闻名", tags: ["中青在线", "中国青年报", "冰点深度报道"] },
    { name: "上观新闻（解放日报）", url: "https://www.shobserver.com/", desc: "中共上海市委机关报解放日报社出品的政经深度观察、长三角新闻与深度调查主流新媒体门户", tags: ["上观新闻", "解放日报", "深度政经"] },
    { name: "红星新闻", url: "https://www.cdsb.com/", desc: "成都商报社出品的全国知名深度调查与突发热点新闻门户，以一线现场核实与“红星深度”调查报道著称", tags: ["红星新闻", "一线突发调查", "主流新媒体"] }
  ],
  "reg-media-toolkit": [
    { name: "Datawrapper", url: "https://www.datawrapper.de/", desc: "纽约时报、路透社等全球顶尖新闻编辑部首选的零代码响应式数据新闻图表、热力地图与交互表格制作工具", tags: ["Datawrapper", "数据新闻图表", "媒体可视化"] },
    { name: "Flourish Studio", url: "https://flourish.studio/", desc: "Canva旗下全球记者与新媒体创作者广泛使用的动态竞赛柱状图（Bar Chart Race）与交互式数据叙事可视化平台", tags: ["Flourish", "动态数据叙事", "新媒体图表"] },
    { name: "Knight Lab (西北大学新闻媒体实验室)", url: "https://knightlab.northwestern.edu/", desc: "美国西北大学研发的开源新闻叙事工具箱，包含TimelineJS时间轴、StoryMapJS地图叙事与Juxtapose图片前后对比工具", tags: ["KnightLab", "TimelineJS时间轴", "开源新闻工具"] },
    { name: "草料二维码", url: "https://cli.im/", desc: "国内新媒体运营与出版传媒必备的活码生成、微信群裂变码、图文音视频多媒体二维码排版制作平台", tags: ["草料二维码", "新媒体活码", "运营工具"] },
    { name: "新榜编辑器 / 壹伴微信编辑器", url: "https://yiban.io/", desc: "百万微信公众号运营者必装的浏览器增强插件，支持一键排版、样式采集、标题评分、AI配图与违规词检测", tags: ["壹伴助手", "公众号增强插件", "新媒体排版"] },
    { name: "句易网（新媒体违禁词敏感词检测）", url: "https://www.juyiwang.com/", desc: "国内新媒体文案、小红书种草、抖音直播话术广告法禁用词与平台敏感词一键在线合规审查工具", tags: ["句易网", "广告法违禁词检测", "文案合规"] }
  ],
  "reg-live-streaming-ops": [
    { name: "蝉妈妈（抖音直播电商数据）", url: "https://www.chanmama.com/", desc: "国内头部抖音直播带货数据分析平台，提供实时直播间大屏监控、达人带货榜、爆款选品与投流ROI诊断", tags: ["蝉妈妈", "抖音直播数据", "带货选品"] },
    { name: "灰豚数据", url: "https://www.huitun.com/", desc: "覆盖抖音、快手、小红书与淘宝直播的多平台直播间流量结构拆解、实时话术复盘与达人画像分析系统", tags: ["灰豚数据", "多平台直播分析", "流量拆解"] },
    { name: "考古加数据", url: "https://www.kaogujia.com/", desc: "专业的抖音直播间实时话术脚本提取、千川投流监测、爆品趋势挖掘与同行直播复盘工具", tags: ["考古加", "直播话术分析", "千川监测"] },
    { name: "巨量百应（抖音电商达人工作台）", url: "https://buyin.jinritemai.com/", desc: "抖音电商官方达人、机构与商家直播中控台，支持直播间商品上下架、发福袋发券、弹幕互动与实时成交看板", tags: ["巨量百应", "抖音直播中控台", "官方机构后台"] },
    { name: "微信视频号直播助手 / 视频号小店后台", url: "https://channels.weixin.qq.com/shop", desc: "腾讯微信视频号直播带货官方商家与达人运营后台，提供直播商品橱窗管理、公私域引流与成交数据罗盘", tags: ["视频号小店", "微信直播带货", "私域直播"] },
    { name: "淘宝直播中控台（主播工作台）", url: "https://liveplatform.taobao.com/", desc: "阿里巴巴淘宝直播官方主播与MCN机构运营管理后台，提供场控互动、宝贝讲解切片与流量推广工具", tags: ["淘宝直播后台", "电商直播中控", "MCN运营"] },
    { name: "StreamElements", url: "https://streamelements.com/", desc: "全球Twitch与YouTube主播广泛使用的云端直播图层（Cloud Overlays）、打赏提醒、聊天机器人与品牌赞助运营平台", tags: ["StreamElements", "云端直播图层", "海外直播运营"] }
  ],
  "reg-private-community": [
    { name: "群响（私域流量操盘手社区）", url: "https://www.qunxiang.com/", desc: "国内知名新消费品牌、微信私域流量操盘手、视频号与全域增长实战案例拆解社群", tags: ["群响", "私域操盘手", "增长案例"] },
    { name: "微伴助手（企业微信SCRM）", url: "https://www.weibanzhushou.com/", desc: "基于企业微信官方接口的知名私域流量SCRM运营工具，支持渠道活码、客户画像标签、群SOP与会话存档", tags: ["微伴助手", "企微SCRM", "私域社群工具"] },
    { name: "句子互动（微信生态RPA与私域自动化）", url: "https://www.juzibot.com/", desc: "Y Combinator孵化的企业微信生态规模化私域获客、AI智能客服托管与社群自动化SOP运营平台", tags: ["句子互动", "企微自动化", "AI私域客服"] }
  ],
  "reg-creator-community": [
    { name: "巨量星图", url: "https://www.xingtu.cn/", desc: "字节跳动旗下抖音、今日头条官方创作者商单撮合、品牌内容营销与达人商业价值评估平台", tags: ["巨量星图", "抖音官方商单", "达人变现"] },
    { name: "小红书蒲公英平台", url: "https://pgy.xiaohongshu.com/", desc: "小红书官方创作者商业合作服务平台，连接品牌方与KOC/KOL博主进行优质种草笔记与直播合作", tags: ["小红书蒲公英", "博主商单合作", "官方种草变现"] },
    { name: "哔哩哔哩花火平台", url: "https://huahuo.bilibili.com/", desc: "B站官方UP主商业合作与内容营销撮合平台，提供UP主报价透明查询、粉丝画像分析与商单履约保障", tags: ["B站花火", "UP主商单", "官方内容变现"] },
    { name: "快手磁力聚星", url: "https://k.kuaishou.com/", desc: "快手官方创作者生态商业变现与达人分销、品牌短视频及直播任务撮合平台", tags: ["磁力聚星", "快手达人变现", "官方任务"] },
    { name: "微信互选广告 / 视频号互选平台", url: "https://ad.weixin.qq.com/", desc: "腾讯微信生态官方公众号作者与视频号创作者商业内容合作及流量主变现官方平台", tags: ["微信互选", "流量主变现", "公众号视频号合作"] },
    { name: "面包多 Mianbaoduo", url: "https://mianbaoduo.com/", desc: "国内专注于独立创作者、画师、程序员、写作者售卖数字作品、付费专栏、素材包与按月订阅变现的平台", tags: ["面包多", "数字作品售卖", "独立创作者变现"] },
    { name: "小报童 Xiaobot", url: "https://xiaobot.net/", desc: "深受国内科技、投资、AI与文艺创作者欢迎的轻量级付费专栏、Newsletter通讯订阅与读者社群平台", tags: ["小报童", "付费专栏订阅", "中文Newsletter"] }
  ],
  "reg-campus-and-internship": [
    { name: "国家大学生就业服务平台（24365校园招聘）", url: "https://www.ncss.cn/", desc: "教育部主办的全国高校毕业生24365全天候校园招聘服务官方总平台，汇聚全国央国企、事业单位与名企校招岗位", tags: ["教育部24365校招", "国家大学生就业平台", "官方应届生招聘"] },
    { name: "白熊求职（名企校招内推与网申日历）", url: "https://www.icebear.me/", desc: "实时汇总互联网大厂、央国企、银行券商、快消外企春秋招网申开启时间表、内推码与笔试真题的校招工具站", tags: ["白熊求职", "秋招春招网申表", "名企内推日历"] },
    { name: "应届生求职网", url: "https://www.yingjiesheng.com/", desc: "前程无忧旗下国内历史最悠久的高校应届毕业生宣讲会日程、名企管培生网申、暑期实习与求职论坛门户", tags: ["应届生求职网", "高校宣讲会查询", "管培生网申"] },
    { name: "国聘网（央国企校招专区）", url: "https://www.iguopin.com/", desc: "国务院国资委、教育部等部委发起“国聘行动”的官方招聘平台，集中发布中央企业、地方国企及科研院所校招岗位", tags: ["国聘网", "央企国企校招", "国聘行动官方"] }
  ],
  "reg-executive-search": [
    { name: "Egon Zehnder 亿康先达", url: "https://www.egonzehnder.com/", desc: "总部位于瑞士苏黎世的全球五大顶级高管寻访（SHREK）公司之一，专注世界500强董事会顾问与CEO寻聘", tags: ["亿康先达", "五大顶级猎头", "CEO寻聘"] },
    { name: "Spencer Stuart 史宾沙", url: "https://www.spencerstuart.com/", desc: "创立于1956年的全球顶尖高管猎头与董事会治理咨询机构，每年发布权威《标普500董事会指数报告》", tags: ["史宾沙", "全球五大猎头", "高管寻访"] },
    { name: "Russell Reynolds Associates 罗盛咨询", url: "https://www.russellreynolds.com/", desc: "全球五大顶级高管猎头机构之一，专注于跨国企业C-Suite核心高管寻聘、领导力评估与继任规划", tags: ["罗盛咨询", "全球五大猎头", "C级高管"] },
    { name: "Boyden 博禹国际", url: "https://www.boyden.com/", desc: "成立于1946年的全球首家专注高管搜寻的国际猎头咨询集团，在全球40余国设有70余家办公室", tags: ["博禹国际", "跨国高管猎头", "临时高管"] },
    { name: "大瀚人力资源集团 (VASTSEA)", url: "http://www.vastsea.com/", desc: "国内老牌大型综合性中高端猎头与RPO招聘流程外包服务集团，覆盖全国超40个重点城市", tags: ["大瀚猎头", "国内大型猎头", "RPO服务"] },
    { name: "嘉驰国际 X-GIANTS", url: "https://www.xgiants.com/", desc: "国内领先的科技数字化驱动一站式中高端猎头寻访、灵活用工与专家网络服务商", tags: ["嘉驰国际", "中高端猎头", "专家网络"] }
  ],
  "reg-professional-networking": [
    { name: "lunchclub", url: "https://lunchclub.com/", desc: "基于AI智能匹配算法的全球专业人士、创业者、投资人与工程师1对1视频咖啡社交网络", tags: ["Lunchclub", "AI职场匹配", "创业社交"] },
    { name: "Polywork", url: "https://www.polywork.com/", desc: "面向斜杠青年、科技从业者展示多维职业身份、副业项目、演讲作品与跨界合作机会的新一代职场社交平台", tags: ["Polywork", "多维职业主页", "跨界合作"] },
    { name: "ADPList (Amazing Design People List)", url: "https://adplist.org/", desc: "汇聚全球超25000名来自苹果、谷歌、Meta一线资深设计师、产品经理与工程师提供免费1对1职场导师辅导的平台", tags: ["ADPList", "大厂导师1对1", "全球职场辅导"] },
    { name: "Read.cv / Posts.cv", url: "https://read.cv/", desc: "深受硅谷设计师与独立工程师喜爱的极简主义现代职业履历展示与作品集同行社交网络", tags: ["ReadCV", "极简职场社交", "硅谷作品集"] },
    { name: "领英中国（LinkedIn 职场指南与全球拓展）", url: "https://business.linkedin.com/zh-cn", desc: "LinkedIn领英面向中国出海企业的全球化人才招募、海外雇主品牌建设与跨境职场人脉拓展官方门户", tags: ["领英出海", "全球人才寻访", "跨境职场"] }
  ],
  "reg-resume-tools": [
    { name: "JSON Resume", url: "https://jsonresume.org/", desc: "全球开发者推崇的基于开源JSON Schema标准的程序员简历规范，支持数百种主题一键编译导出HTML/PDF", tags: ["JSONResume", "开源简历标准", "程序员简历"] },
    { name: "木及简历 (Muji Resume)", url: "https://www.mujicv.com/", desc: "支持Markdown语法与可视化双模式实时拖拽排版的极简主义高颜值中文单页简历制作工具", tags: ["木及简历", "Markdown简历", "极简排版"] },
    { name: "OpenResume", url: "https://www.open-resume.com/", desc: "GitHub高星完全免费开源的本地隐私优先简历生成器与内置ATS招聘系统简历解析可读性测试工具", tags: ["OpenResume", "开源ATS检测", "免费简历生成"] }
  ],
  "reg-interview-prep": [
    { name: "Tech Interview Handbook", url: "https://www.techinterviewhandbook.org/", desc: "由Meta前端架构师Yangshun Tay维护的GitHub超11万星标硅谷科技大厂算法、行为面试与Blind 75刷题权威指南", tags: ["Blind75原作者", "硅谷面试手册", "GitHub十万星"] },
    { name: "System Design Primer (GitHub)", url: "https://github.com/donnemartin/system-design-primer", desc: "GitHub超27万星标的全球第一高并发分布式系统架构设计面试圣经（含中文完整翻译与Anki闪卡）", tags: ["系统设计圣经", "27万星标", "架构师面试"] },
    { name: "小林coding (图解计算机基础面试)", url: "https://xiaolincoding.com/", desc: "国内校招与社招后端程序员必背的《图解网络》《图解操作系统》《图解MySQL》《图解Redis》高频八股文宝典", tags: ["小林coding", "图解计算机基础", "大厂八股文"] }
  ],
  "reg-salary-insights": [
    { name: "Comprehensive.io", url: "https://www.comprehensive.io/", desc: "实时抓取并汇总数千家欧美科技公司官方招聘公告中依法公开的真实薪酬区间（Salary Transparency）数据库", tags: ["真实薪资公开", "科技公司薪酬", "透明薪资库"] },
    { name: "智联招聘薪酬报告与行业白皮书", url: "https://www.zhaopin.com/company/research", desc: "智联招聘官方按季度发布的全国38城企业平均招聘薪酬报告、热门行业薪资涨幅与职场洞察数据库", tags: ["智联薪酬报告", "38城平均薪资", "季度白皮书"] },
    { name: "ITJobsWatch (UK & Europe Tech Salaries)", url: "https://www.itjobswatch.co.uk/", desc: "追踪英国及欧洲科技市场各类编程语言、云架构师、AI工程师永久职位与合同工时薪中位数的权威统计站", tags: ["欧洲IT薪资", "技术栈薪酬趋势", "时薪中位数"] }
  ],
  "reg-freelance": [
    { name: "Contra", url: "https://contra.com/", desc: "面向全球数字游民、独立设计师、AI工程师与Web开发者的零佣金（Commission-Free）自由职业作品集与签约平台", tags: ["Contra", "零佣金自由职业", "数字游民"] },
    { name: "码市 Coding Mart / 开源众包", url: "https://zb.oschina.net/", desc: "开源中国OSCHINA旗下的软件开发众包平台，连接企业软件外包需求与全国认证程序员进行悬赏及整包开发", tags: ["开源众包", "软件外包接单", "开源中国旗下"] },
    { name: "Working Nomads", url: "https://www.workingnomads.com/", desc: "专注为全球数字游民每日精选100%可远程办公（Remote Only）的软件开发、设计、营销与客户支持职位平台", tags: ["WorkingNomads", "数字游民远程", "全球远程工作"] }
  ],
  "reg-labor-rights": [
    { name: "中国裁判文书网（劳动争议专栏）", url: "https://wenshu.court.gov.cn/", desc: "最高人民法院主办的全国各级法院生效判决书官方公开平台，可检索全国各地真实劳动争议、竞业限制与工伤判例", tags: ["中国裁判文书网", "最高法官方", "劳动争议真实判例"] },
    { name: "人民法院公告网 / 中国执行信息公开网", url: "http://zxgk.court.gov.cn/", desc: "最高人民法院官方被执行人信息查询平台，用于核查欠薪企业是否为失信被执行人（老赖）及执行案件进展", tags: ["执行信息公开网", "欠薪老赖核查", "最高法官方"] },
    { name: "国家信访局网上投诉与全国根治欠薪线索反映平台", url: "https://www.gjxfj.gov.cn/", desc: "国务院根治拖欠农民工工资工作领导小组办公室与国家信访局官方欠薪维权线索登记督办平台", tags: ["根治欠薪平台", "官方维权督办", "国家信访局"] },
    { name: "中国劳动保障新闻网（中国劳动保障报）", url: "https://www.clssn.com/", desc: "人力资源和社会保障部主管的《中国劳动保障报》官方网站，权威解读劳动合同法、工伤认定、社保缴纳与仲裁典型案例", tags: ["中国劳动保障报", "人社部权威普法", "劳动仲裁案例解读"] },
    { name: "北大法宝（劳动法与社保法规库）", url: "https://www.pkulaw.com/", desc: "北京大学法制信息中心出品的权威中国法律数据库，提供全国及各省市劳动争议司法解释、赔偿标准与指导案例", tags: ["北大法宝", "各地赔偿标准", "劳动司法解释"] }
  ],
  "reg-funds-and-wealth": [
    { name: "中证指数有限公司 CSI", url: "https://www.csindex.com.cn/", desc: "沪深交易所共同出资设立的国家级金融市场指数编制机构，官方发布沪深300、中证500、中证红利等指数估值与权重", tags: ["中证指数官网", "沪深300估值", "ETF指数编制"] },
    { name: "国证指数 CNI (深交所指数)", url: "http://www.cnindex.com.cn/", desc: "深圳证券交易所旗下权威指数编制平台，官方发布创业板指、深证100、国证芯片及ETFIOPV净值数据", tags: ["国证指数", "创业板指", "深交所官方"] },
    { name: "ETFDB (ETF Database)", url: "https://etfdb.com/", desc: "全球规模最大的美股与国际ETF交易所交易基金筛选器、持仓透视、费率对比与资金流向数据库", tags: ["ETFDB", "美股ETF数据库", "全球资产配置"] },
    { name: "集思录（低风险投资与ETF可转债社区）", url: "https://www.jisilu.cn/", desc: "国内最专业的量化低风险投资、可转债双低轮动、场内ETF折溢价套利、REITs与分级A数据工具社区", tags: ["集思录", "可转债数据", "ETF套利低风险"] }
  ],
  "reg-forex-and-metals": [
    { name: "中国金币网", url: "http://www.chinagoldcoin.net/", desc: "中国人民银行直属中国金币总公司官方网站，权威发布熊猫普制金币、精制纪念金银币发行公告与防伪溯源", tags: ["中国金币网", "央行熊猫金币", "贵金属纪念币"] },
    { name: "上海有色网 SMM（贵金属与有色行情）", url: "https://www.smm.cn/", desc: "国内权威的有色金属与白银、铂钯贵金属现货基准价格（SMM价格）、产业链库存及矿业调研数据门户", tags: ["上海有色网", "SMM现货均价", "白银有色金属"] },
    { name: "Barchart (Forex & Precious Metals)", url: "https://www.barchart.com/forex", desc: "北美权威的外汇货币对、黄金白银期货期权隐含波动率、CFTC持仓报告（COT）与大宗商品技术面分析平台", tags: ["Barchart", "CFTC持仓数据", "外汇贵金属分析"] },
    { name: "CLS Group (全球外汇结算基础设施)", url: "https://www.cls-group.com/", desc: "处理全球超半数跨国货币交易结算的国际系统重要性金融市场基础设施（PvP外汇同步交收系统）官网及全球外汇成交量月报", tags: ["CLSGroup", "国际外汇清算", "全球外汇成交量"] }
  ],
  "reg-futures-and-derivatives": [
    { name: "国际掉期与衍生工具协会 ISDA", url: "https://www.isda.org/", desc: "制定全球场外金融衍生品交易标准主协议（ISDA Master Agreement）的国际最权威衍生品行业组织官网", tags: ["ISDA主协议", "全球场外衍生品", "国际金融标准"] },
    { name: "美国商品期货交易委员会 CFTC", url: "https://www.cftc.gov/", desc: "美国联邦期货与衍生品最高监管机构官网，每周五定期发布全球交易员必看的COT（Commitments of Traders）持仓报告", tags: ["CFTC官网", "COT持仓报告", "期货监管数据"] },
    { name: "扑克财经", url: "https://www.puoke.com/", desc: "国内知名大宗商品产业、能源化工、黑色金属、农产品期货期权与宏观大类资产专业智库问答社区", tags: ["扑克财经", "大宗商品智库", "产业套保期权"] }
  ],
  "reg-crypto-and-web3": [
    { name: "Token Terminal", url: "https://tokenterminal.com/", desc: "采用传统华尔街股票财务指标（市盈率P/E、协议收入、开发者活跃度）评估公链与Web3协议基本面的机构级数据终端", tags: ["TokenTerminal", "Web3基本面财报", "链上协议收入"] },
    { name: "L2BEAT", url: "https://l2beat.com/", desc: "以太坊Layer 2扩容生态（Arbitrum/Optimism/Base/ZK-Rollups）锁仓量、抗审查风险评级与架构透明度最权威监测站", tags: ["L2BEAT", "以太坊Layer2监测", "Rollup风险评级"] },
    { name: "Messari", url: "https://messari.io/", desc: "全球顶尖的机构级加密资产研究报告、赛道图谱、链上治理提案追踪与季度生态深度研报平台", tags: ["Messari", "机构级Web3研报", "加密赛道图谱"] },
    { name: "Chainlink 官方文档与预言机网络", url: "https://chain.link/", desc: "Web3行业标准去中心化预言机（Oracle）网络与跨链互操作协议（CCIP）官方网站及实时喂价数据浏览器", tags: ["Chainlink", "去中心化预言机", "CCIP跨链"] },
    { name: "ethresear.ch (以太坊核心学术研究论坛)", url: "https://ethresear.ch/", desc: "Vitalik Buterin与全球以太坊核心密码学研究员探讨零知识证明（ZKP）、共识机制、MEV与分片扩容的官方学术论坛", tags: ["ethresearch", "零知识证明密码学", "以太坊核心研究"] }
  ],
  "reg-trusts-and-am": [
    { name: "华宝信托", url: "https://www.hwabaotrust.com/", desc: "中国宝武钢铁集团旗下知名国有信托机构，在企业年金受托管理、薪酬福利信托、供应链金融与家族信托领域处于领先地位", tags: ["华宝信托", "中国宝武旗下", "企业年金信托"] },
    { name: "中融信托 / 兴业国际信托", url: "https://www.ciit.com.cn/", desc: "兴业银行控股的大型银行系信托公司，提供资产证券化、绿色信托、家族财富传承与特殊资产服务信托", tags: ["兴业信托", "银行系信托", "绿色资产管理"] },
    { name: "国投泰康信托", url: "https://www.sdictrust.com.cn/", desc: "国家开发投资集团（国投）与泰康保险联合控股的央企信托机构，深耕养老信托、保险金信托与资产配置", tags: ["国投泰康信托", "央企信托", "养老保险金信托"] },
    { name: "百瑞信托", url: "https://www.brtrust.com/", desc: "国家电投集团控股的能源央企背景信托公司，以绿色双碳能源产融结合信托与慈善信托研究闻名", tags: ["百瑞信托", "国家电投旗下", "绿色能源信托"] }
  ],
  "reg-short-video": [
    { name: "视频号助手（微信创作者学堂）", url: "https://finder.video.qq.com/", desc: "腾讯微信视频号官方PC端高清长短视频投稿、合集管理、原创保护与直播预约工作台", tags: ["视频号PC端", "微信视频创作", "官方投稿"] },
    { name: "小红书创作服务平台（视频笔记专区）", url: "https://creator.xiaohongshu.com/", desc: "小红书官方Vlog短视频、干货教程视频4K网页端上传、封面测试、粉丝数据与灵感周报平台", tags: ["小红书视频创作", "Vlog笔记后台", "官方创作者中心"] },
    { name: "飞瓜数据（短视频与直播数据分析）", url: "https://www.feigua.cn/", desc: "覆盖抖音、快手、小红书、B站与视频号的热门短视频BGM音乐榜、爆款脚本拆解与账号涨粉监控平台", tags: ["飞瓜数据", "短视频爆款脚本", "热门BGM榜单"] },
    { name: "腾讯微视", url: "https://weishi.qq.com/", desc: "腾讯旗下正能量精品短剧、影视动漫二创解说与趣味互动特效短视频分享平台", tags: ["腾讯微视", "精品短剧", "影视短视频"] },
    { name: "字节跳动巨量创意（短视频创意灵感库）", url: "https://cc.oceanengine.com/", desc: "巨量引擎官方出品的抖音爆款短视频前3秒黄金完播率脚本拆解、分镜灵感库与行业高转化视频案例平台", tags: ["巨量创意", "黄金前3秒拆解", "抖音官方灵感库"] },
    { name: "Vimeo Staff Picks (全球最佳创意短片展映)", url: "https://vimeo.com/channels/staffpicks", desc: "全球独立导演、动画师与视觉艺术家公认的最高水准创意短片、实验影像与纪实微电影每日策展频道", tags: ["VimeoStaffPicks", "独立创意短片", "视觉艺术殿堂"] }
  ],
  "reg-radio-and-broadcast": [
    { name: "上海人民广播电台（话匣子 / 阿基米德）", url: "https://www.smg.cn/", desc: "上海广播电视台（SMG）旗下上海新闻广播、第一财经广播、动感101、经典947古典音乐广播官方门户", tags: ["上海广播SMG", "动感101", "经典947古典乐"] },
    { name: "深圳广播电影电视集团（壹深圳在线广播）", url: "https://www.sztv.com.cn/", desc: "深圳广电集团官方先锋898新闻频率、飞扬971音乐频率、深圳交通频率与大湾区华语广播在线直播平台", tags: ["深圳广电广播", "飞扬971", "大湾区电台"] },
    { name: "香港电台 RTHK (Radio Television Hong Kong)", url: "https://www.rthk.hk/radio", desc: "香港历史最悠久的公共广播机构，提供香港电台第一台至第五台粤语、普通话、英语新闻与古典音乐实时广播", tags: ["香港电台RTHK", "粤语公共广播", "香港文化音乐"] },
    { name: "ABC Listen (澳大利亚广播公司电台)", url: "https://www.abc.net.au/listen", desc: "澳大利亚国家公共广播电台官方在线收听平台，包含ABC News、Classic古典音乐台、Triple J青年独立音乐台与英语听力节目", tags: ["澳洲广播ABC", "TripleJ独立音乐", "英语新闻听力"] },
    { name: "CBC Listen (加拿大广播公司官方电台)", url: "https://www.cbc.ca/listen", desc: "加拿大国家公共广播CBC Radio One谈话新闻与CBC Music全天候无广告爵士、古典、民谣音乐流媒体电台", tags: ["加拿大广播CBC", "北美英语听力", "无广告音乐电台"] },
    { name: "KEXP 90.3 FM Seattle", url: "https://www.kexp.org/", desc: "华盛顿大学合作运营、全球摇滚与独立音乐乐迷顶礼膜拜的西雅图传奇非营利公共广播电台与Live现场录音宝库", tags: ["KEXP西雅图", "传奇独立摇滚电台", "Live现场录音"] }
  ],
  "reg-ratings-and-reviews": [
    { name: "SensaCritique", url: "https://www.sensacritique.com/", desc: "法语世界最大的文化艺术评分社区，汇聚欧洲影迷、剧迷、书迷与玩家对电影、剧集、漫画和电子游戏的深度长评与榜单", tags: ["SensaCritique", "欧洲文化评分", "法语影评社区"] },
    { name: "MUBI Notebook & Film Database", url: "https://mubi.com/en/notebook", desc: "MUBI旗下全球艺术电影数据库、各大国际电影节策展人场刊打分表格（Festival Grids）与影迷评分社区", tags: ["MUBI评分库", "电影节场刊打分", "艺术电影数据库"] },
    { name: "Roger Ebert Great Movies (影史必看殿堂片单)", url: "https://www.rogerebert.com/great-movies", desc: "罗杰·伊伯特亲自撰写的近400部影史四星殿堂级杰作（The Great Movies）深度解析与必看电影评分档案库", tags: ["伊伯特四星片单", "影史必看杰作", "殿堂级影评"] },
    { name: "Anime News Network (ANN Encyclopedia & Ratings)", url: "https://www.animenewsnetwork.com/encyclopedia/", desc: "英语世界最权威的日本动画与漫画百科全书数据库、声优监督制作人员名单检索与全球观众分级评分榜", tags: ["ANN百科", "全球动漫评分库", "声优制作档案"] },
    { name: "FilmAffinity", url: "https://www.filmaffinity.com/en/main.html", desc: "西班牙语及英语世界极具影响力的独立电影推荐引擎、灵魂伴侣口味匹配（Movie Soulmates）与影史高分榜单网站", tags: ["FilmAffinity", "口味匹配推荐", "西语电影评分"] },
    { name: "They Shoot Pictures, Don't They? (TSPDT)", url: "https://www.theyshootpictures.com/", desc: "综合全球超万名电影学者、导演与影评人选票计算出的“影史最伟大1000部电影”与“21世纪最伟大电影”学术级权威榜单数据库", tags: ["TSPDT影史千佳", "全球学者综合榜", "电影学术最高榜"] },
    { name: "Criticker", url: "https://www.criticker.com/", desc: "采用百分制精细打分与专有TCI（Taste Compatibility Index）口味相似度算法预测你对未看电影评分的硬核影迷网站", tags: ["Criticker", "百分制电影打分", "AI口味预测评分"] },
    { name: "Common Sense Media", url: "https://www.commonsensemedia.org/", desc: "美国最大的非营利家庭观影分级与内容评测机构，为全球电影、剧集、游戏提供详尽的适宜年龄评分与暴力语言内容提示", tags: ["家庭观影分级", "年龄适宜度评分", "非营利影视评测"] }
  ],
  "reg-event-ticketing": [
    { name: "天桥艺术中心官方购票", url: "https://www.tartscenter.com/", desc: "北京天桥艺术中心官方网站，主营国内外原版引进百老汇/伦敦西区经典音乐剧、芭蕾舞剧、话剧与国际戏剧节在线选座购票", tags: ["天桥艺术中心", "百老汇音乐剧", "国际戏剧节购票"] },
    { name: "上海大剧院官方票务 SGT", url: "https://www.shgtheatre.com/", desc: "上海大剧院官方演出日历与在线选座购票平台，汇聚世界顶尖交响乐团、歌剧、昆曲京剧与现代舞剧演出", tags: ["上海大剧院官网", "交响乐歌剧购票", "艺术殿堂"] },
    { name: "Eventbrite", url: "https://www.eventbrite.com/", desc: "全球最大的科技峰会、音乐艺术节、社区沙龙、创客工作坊与线下文化演出活动报名与电子票务平台", tags: ["Eventbrite", "全球活动票务", "科技音乐节报名"] }
  ],
  "reg-documentaries": [
    { name: "Smithsonian Channel (史密森尼学会纪录片频道)", url: "https://www.smithsonianchannel.com/", desc: "全球最大博物馆与研究综合体美国史密森尼学会官方出品的航空史、世界历史、古生物考古与地球科学纪录片平台", tags: ["史密森尼纪录片", "航空与考古历史", "博物馆官方出品"] },
    { name: "IDFA (阿姆斯特丹国际纪录片电影节在线片库)", url: "https://www.idfa.nl/en/collection/documentaries", desc: "全球最高殿堂阿姆斯特丹国际纪录片电影节（IDFA）官方网站，提供数百部世界获奖艺术纪录片在线流媒体展映与大师课", tags: ["IDFA阿姆斯特丹", "世界最高纪录片节", "获奖纪录片展映"] },
    { name: "National Film Board of Canada (NFB 加拿大国家电影局)", url: "https://www.nfb.ca/documentary/", desc: "屡获奥斯卡最佳纪录片与最佳动画短片奖的加拿大国家电影局官网，免费向全球开放超6000部高清纪录片与艺术短片", tags: ["加拿大国家电影局", "6000部免费纪录片", "奥斯卡获奖机构"] },
    { name: "History Channel (历史频道)", url: "https://www.history.com/", desc: "全球知名历史纪实电视频道官网，提供古代文明、二战史、工业革命、科学发现与历史人物专题纪录片及档案视频", tags: ["HistoryChannel", "世界历史纪录片", "历史档案库"] },
    { name: "上海纪实人文频道 / 看东方纪录片", url: "https://www.kankanews.com/", desc: "上海广播电视台纪实人文频道官方融媒体，出品《人间世》《大师》《外滩》《激流》等豆瓣9分+国产神作纪录片", tags: ["上海纪实频道", "人间世出品方", "国产高分纪录片"] }
  ],
  "reg-overseas-streaming": [
    { name: "AbemaTV", url: "https://abema.tv/", desc: "日本CyberAgent与朝日电视台合资打造的日本最大互联网流媒体电视，提供24小时日本新闻、深夜新番动画首发、将棋与日剧综艺", tags: ["AbemaTV", "日本深夜新番首发", "日本网络电视"] },
    { name: "U-NEXT", url: "https://video.unext.jp/", desc: "日本本土曲库与片库规模第一的综合流媒体平台，涵盖超30万部日本电影、大河剧、时代剧、最新季番剧及电子漫画杂志", tags: ["U-NEXT", "日本最大片库", "日剧大河剧动漫"] },
    { name: "Viki (Rakuten Viki)", url: "https://www.viki.com/", desc: "乐天集团旗下风靡全球的亚洲影视海外流媒体平台，主打热播韩剧、日剧、华语剧集与全球志愿者百种语言实时弹幕字幕", tags: ["RakutenViki", "海外看韩剧日剧", "多语种粉丝字幕"] },
    { name: "Criterion Channel (CC标准收藏流媒体)", url: "https://www.criterionchannel.com/", desc: "Criterion Collection标准收藏官方艺术电影流媒体，永久在线展映超2000部4K修复世界电影史经典大师杰作与导演评论音轨", tags: ["CriterionChannel", "CC标准收藏流媒体", "世界电影史大师库"] },
    { name: "Kanopy", url: "https://www.kanopy.com/", desc: "与全球数千所大学图书馆及公共图书馆合作的学术与艺术电影免费流媒体平台，收录A24佳作、世界影展电影与The Great Courses大学公开课", tags: ["Kanopy", "大学图书馆流媒体", "A24与学术电影"] },
    { name: "Tubi (Fox 免费正版流媒体)", url: "https://tubitv.com/", desc: "福克斯（Fox）旗下北美用户规模最大的完全免费广告支持（FAST）正版电影与经典美剧流媒体平台，片库超20万部", tags: ["TubiTV", "福克斯免费流媒体", "20万部正版欧美片"] },
    { name: "Pluto TV (派拉蒙免费电视频道流媒体)", url: "https://pluto.tv/", desc: "派拉蒙全球旗下知名的免费24小时在线直播电视频道与点播流媒体，涵盖电影、经典美剧、体育、动漫与新闻数百个频道", tags: ["PlutoTV", "派拉蒙免费电视", "数百欧美直播频道"] },
    { name: "Curzon Home Cinema / BFI Player", url: "https://player.bfi.org.uk/", desc: "英国电影协会（BFI）官方艺术流媒体平台，提供英国影史珍贵胶片修复档案、欧洲大师电影及伦敦电影节线上展映", tags: ["BFIPlayer", "英国电影协会官方", "胶片修复大师展"] }
  ],
  "reg-cinema-ticketing": [
    { name: "卢米埃影城 Lumiere Pavilions", url: "http://www.lumiai.com/", desc: "国内知名高端国际化连锁影院品牌卢米埃影城官方网站，主打LD激光巨幕厅、杜比全景声厅排片查询与歌剧电影展映购票", tags: ["卢米埃影城", "高端艺术院线", "LD杜比全景声"] },
    { name: "英皇电影城 Emperor Cinemas", url: "https://www.emperorcinemas.com/", desc: "香港英皇集团旗下高端直营连锁影院官方网站，覆盖北京、深圳、成都、香港等地IMAX激光厅、VIP贵宾厅在线选座购票", tags: ["英皇电影城", "激光IMAX", "港澳内地连锁院线"] },
    { name: "国家电影专资办（中国电影发行放映协会数据）", url: "http://www.chinafilmassociation.com/", desc: "中国电影发行放映协会官方网站，权威发布全国数字影院建设标准、农村与城市院线发行规范及年度中国电影市场行业报告", tags: ["中国电影发行放映协会", "全国院线行业权威", "官方市场报告"] },
    { name: "AMC Theatres (全球最大连锁院线)", url: "https://www.amctheatres.com/", desc: "全球规模最大的连锁电影院线AMC官方购票网站，支持IMAX at AMC、Dolby Cinema、Prime特效厅选座与A-List观影通行证", tags: ["AMC院线官网", "全球最大电影院线", "杜比IMAX选座"] }
  ],
  "reg-gaming-media": [
    { name: "Rock Paper Shotgun (RPS)", url: "https://www.rockpapershotgun.com/", desc: "创刊于2007年的英国殿堂级PC电脑游戏深度评论网站，以风趣幽默的独立游戏发掘、策略模拟游戏评测与深度长文闻名全球", tags: ["RockPaperShotgun", "PC游戏深度评论", "英国殿堂媒体"] },
    { name: "4Gamer.net", url: "https://www.4gamer.net/", desc: "日本规模最大、专业度最高的综合电子游戏与PC电竞硬件媒体，以极详尽的制作人万字技术专访与东京电玩展深度报道著称", tags: ["4Gamer", "日本最专业游戏媒体", "制作人深度专访"] },
    { name: "Gematsu", url: "https://www.gematsu.com/", desc: "全球速度最快、最权威的日本主机游戏、JRPG角色扮演游戏、卡普空/SE/世嘉/任天堂官方发布会英译一手资讯站", tags: ["Gematsu", "日式主机游戏快讯", "JRPG权威情报"] },
    { name: "VGChartz / GamesIndustry.biz", url: "https://www.gamesindustry.biz/", desc: "全球游戏行业高管必读的电子游戏商业数据媒体，权威发布英国欧洲主机周销量榜、全球游戏公司财报解读与并购投融资分析", tags: ["GamesIndustry", "全球游戏销量数据", "大厂财报商业分析"] }
  ],
  "reg-engines-and-tools": [
    { name: "Defold Engine", url: "https://defold.com/", desc: "源自《糖果传奇》开发商King、现由Defold基金会维护的完全免费开源零版税跨平台（Web/手游/Switch/Steam）超轻量Lua游戏引擎", tags: ["Defold引擎", "King开源轻量引擎", "Lua跨平台开发"] },
    { name: "Construct 3", url: "https://www.construct.net/", desc: "无需安装客户端、直接在浏览器中运行的全球最强大事件表逻辑驱动2D HTML5与Steam独立游戏快速开发引擎", tags: ["Construct3", "浏览器免编程引擎", "2D游戏快速原型"] },
    { name: "Spine 2D (Esoteric Software)", url: "http://esotericsoftware.com/", desc: "全球2D游戏与二次元手游行业标准的2D骨骼动画（Skeletal Animation）制作软件，支持网格自由变形与全主流游戏引擎运行时", tags: ["Spine2D", "2D骨骼动画标准", "二次元立绘动效"] },
    { name: "Tiled Map Editor", url: "https://www.mapeditor.org/", desc: "全球2D像素RPG、银河恶魔城与策略游戏开发者必备的完全免费开源通用2D瓦片地图编辑器（支持正交、等距斜视角与六边形网格）", tags: ["Tiled地图编辑器", "开源2D关卡设计", "像素瓦片地图"] },
    { name: "LDtk (Level Designer Toolkit)", url: "https://ldtk.io/", desc: "由《死亡细胞》（Dead Cells）主策划Sebastien Benard开发的现代化高颜值开源2D横版动作与银河城游戏关卡地图编辑器", tags: ["LDtk关卡编辑器", "死亡细胞作者出品", "现代开源2D地图工具"] },
    { name: "Aseprite", url: "https://www.aseprite.org/", desc: "全球像素画师与独立游戏开发者公认的第一像素美术（Pixel Art）绘制与逐帧序列精灵图动画制作神器", tags: ["Aseprite", "像素画第一神器", "Sprite序列帧动画"] }
  ],
  "reg-game-art-assets": [
    { name: "Quaternius (CC0 Low Poly 3D Assets)", url: "https://quaternius.com/", desc: "提供数千个100%免费CC0无版权可商用、带完整骨骼绑定与动画的低多边形（Low-Poly）3D机甲、奇幻RPG角色、武器与建筑套装网站", tags: ["Quaternius", "CC0免费3D低模", "带骨骼动画模型包"] },
    { name: "KayKit (Kay Lousberg Game Assets)", url: "https://kaylousberg.com/game-assets", desc: "全球独立游戏与Game Jam极受欢迎的高品质CC0免费3D卡通地牢、中世纪城堡、太空基地与冒险角色模块化3D游戏资产库", tags: ["KayKit", "CC0模块化3D资产", "GameJam必备素材"] },
    { name: "Synty Store (Polygon Series Assets)", url: "https://syntystore.com/", desc: "全球最著名的POLYGON系列风格化低多边形（Low-Poly）Unity与Unreal Engine商业3D游戏场景、角色打包资产官方商城", tags: ["SyntyPolygon", "全球最火低模套装", "Unity虚幻3D资产"] },
    { name: "KitBash3D", url: "https://kitbash3d.com/", desc: "好莱坞电影概念设计与3A开放世界游戏广泛采用的赛博朋克、末日废土、奇幻帝国与现代都市超大型3D建筑群资产库", tags: ["KitBash3D", "3A级3D城市建筑库", "赛博朋克概念资产"] },
    { name: "3dtextures.me", url: "https://3dtextures.me/", desc: "完全免费提供法线贴图（Normal）、粗糙度（Roughness）、置换（Displacement）与AO通道齐全的无缝PBR游戏材质贴图站", tags: ["3dtextures", "免费无缝PBR贴图", "法线置换全通道"] },
    { name: "ShareTextures", url: "https://www.sharetextures.com/", desc: "由建筑可视化与游戏美术团队维护的CC0完全免费商用4K PBR物理材质纹理、织物木材大理石贴图与3D模型公共库", tags: ["ShareTextures", "CC0免费4K材质", "PBR纹理库"] },
    { name: "Sonniss (GDC Free Game Audio Bundles)", url: "https://sonniss.com/gameaudiogdc", desc: "每年GDC大会期间向全球游戏开发者免费赠送数十GB免版税（Royalty-Free）终身可商用好莱坞级环境音、枪械魔法与UI音效大礼包的平台", tags: ["Sonniss", "GDC免费百G音效包", "免版税商业游戏音频"] },
    { name: "Lospec (Pixel Art Palettes & Resources)", url: "https://lospec.com/palette-list", desc: "全球像素艺术与复古游戏美术师大本营，收录数千套经典复古游戏机（GameBoy/NES/PICO-8）调色板、像素教程与体素素材", tags: ["Lospec", "像素画色板大全", "复古游戏美术资源"] },
    { name: "Spriters Resource (VG Resource)", url: "https://www.spriters-resource.com/", desc: "全球最大的经典电子游戏2D精灵表（Sprite Sheets）、3D模型（Models Resource）、纹理与音效研究学习参考拆包资料馆", tags: ["SpritersResource", "经典游戏Sprite拆解库", "游戏美术动作参考"] },
    { name: "Texture Haven / HDRI Haven", url: "https://hdrihaven.com/", desc: "100%免费CC0无版权的16K超高动态范围（32-bit EXR）户外自然天空、室内摄影棚光照贴图库，可直接导入Blender/Unity/UE5", tags: ["HDRIHaven", "16K免费天空盒光照", "CC0无版权环境光"] },
    { name: "itch.io Free Pixel Art Assets", url: "https://itch.io/game-assets/free", desc: "itch.io官方免费游戏美术素材专区，汇聚全球独立画师开源分享的2D横版像素地图、视觉小说立绘对话框与复古字体包", tags: ["免费独立美术", "视觉小说UI素材", "像素地图瓦片"] },
    { name: "Poliigon", url: "https://www.poliigon.com/", desc: "由Blender Guru创始人Andrew Price创立的行业顶尖照片级真实感PBR纹理材质、高清摄影扫描3D模型与HDRI贴图库", tags: ["Poliigon", "BlenderGuru创立", "照片级扫描PBR材质"] }
  ],
  "reg-game-conventions": [
    { name: "IGF (Independent Games Festival 独立游戏节)", url: "https://igf.com/", desc: "创办于1998年、每年在GDC旧金山大会颁发塞尤玛斯·麦克纳利大奖的全球历史最悠久、含金量最高的国际独立游戏展与奖项", tags: ["IGF独立游戏节", "塞尤玛斯最高奖", "全球独立游戏殿堂"] },
    { name: "EVO (Evolution Championship Series 全球格斗游戏大赛)", url: "https://www.evo.gg/", desc: "每年在拉斯维加斯与东京举办的全球最大规模格斗游戏狂欢展会与最高殿堂锦标赛（涵盖街霸、铁拳、罪恶装备、拳皇）", tags: ["EVO格斗大赛", "拉斯维加斯格斗展", "街霸铁拳最高殿堂"] },
    { name: "Brasil Game Show (BGS 巴西圣保罗国际游戏展)", url: "https://www.brasilgameshow.com.br/", desc: "拉丁美洲规模最大、观展人数超30万人的国际电子游戏展览会，汇聚索尼、任天堂、育碧与全球电竞战队", tags: ["巴西国际游戏展BGS", "拉美最大游戏展", "30万人国际盛会"] },
    { name: "EGX London / MCM Comic Con", url: "https://www.egx.net/", desc: "在英国伦敦ExCeL展览中心举办的英国最大规模电子游戏展览会，提供未发售3A主机新作试玩、Rezzed独立游戏展区与开发者讲座", tags: ["EGX伦敦游戏展", "英国最大电玩展", "Rezzed独立展区"] },
    { name: "萤火虫动漫游戏嘉年华", url: "https://www.fireflyacg.com/", desc: "华南地区（广州/上海/武汉）极具影响力的超大型线下动漫游戏展览会，汇集热门二次元手游参展商、知名声优Coser与自由行活动", tags: ["萤火虫漫展", "华南大型动漫游戏展", "二次元手游盛会"] }
  ],
  "reg-deals-and-comparison": [
    { name: "CheapShark", url: "https://www.cheapshark.com/", desc: "完全免费且提供开放API的PC数字正版游戏全网比价网站，实时监控Steam、Epic、GOG、Humble Bundle与GreenManGaming史低折扣", tags: ["CheapShark", "正版PC游戏比价", "史低监控API"] },
    { name: "Deku Deals (Switch / PS5 / Xbox 主机游戏史低比价)", url: "https://www.dekudeals.com/", desc: "任天堂Switch、PS5与Xbox主机玩家公认最好用的eShop/PSN数字版与实体卡带历史价格走势图及打折降价邮件提醒神器", tags: ["DekuDeals", "Switch主机游戏比价", "eShop史低曲线"] },
    { name: "Wirecutter (纽约时报消费评测)", url: "https://www.nytimes.com/wirecutter/", desc: "《纽约时报》旗下全球最具公信力的独立消费电子、家居用品、户外装备实测横评与性价比选购推荐指南网站", tags: ["Wirecutter", "纽约时报硬核评测", "全球消费选购指南"] },
    { name: "RTINGS.com", url: "https://www.rtings.com/", desc: "坚持自费购买所有测试样机、采用统一实验室光学与声学仪器量化打分的全球最权威电视、显示器、耳机、鼠标深度对比评测库", tags: ["RTINGS", "自费购机实验室评测", "显示器耳机量化对比"] },
    { name: "Idealo (欧洲最大比价引擎)", url: "https://www.idealo.de/", desc: "德国及欧洲市场最大的全品类电商比价与历史价格走势搜索引擎，覆盖欧洲超5万家在线零售商实时报价对比", tags: ["Idealo", "欧洲第一比价网", "欧淘历史价格曲线"] }
  ],
  "reg-secondhand-market": [
    { name: "Reverb (全球最大二手乐器与音频设备市场)", url: "https://reverb.com/", desc: "全球音乐人、制作人与吉他发烧友首选的Vintage古董电吉他、合成器、效果器、录音室麦克风新旧交易与历史成交估价平台", tags: ["Reverb", "全球二手乐器圣地", "古董吉他合成器"] },
    { name: "Chrono24 (全球名表与二手腕表交易市场)", url: "https://www.chrono24.cn/", desc: "创立于2003年的全球最大二手奢侈名表与古董腕表在线交易平台，提供第三方资金托管、真伪鉴定保障与全球腕表行情指数", tags: ["Chrono24", "全球二手名表鉴定", "腕表行情指数"] },
    { name: "Swappa", url: "https://swappa.com/", desc: "北美口碑极佳的严审序列号（IMEI防赃机验证）零欺诈个人C2C二手iPhone、MacBook、相机镜头与游戏主机直卖平台", tags: ["Swappa", "序列号核验二手数码", "无暗病数码直卖"] },
    { name: "只二 Zhier (高品质女性二手设计师服饰奢品平台)", url: "https://www.zhiervip.com/", desc: "国内专注设计师女装、轻奢包袋与高端配饰的一站式顺丰上门取件寄卖、专业护理消毒与正品鉴定二手平台", tags: ["只二", "设计师服饰寄卖", "正品鉴定消毒"] },
    { name: "中邮网 / 赵涌在线（钱币邮票艺术收藏品二手竞买）", url: "https://www.zhaoonline.com/", desc: "创办于1985年的国内龙头邮票、古钱币、金银纪念币、文献善本保真鉴定委托竞买与收藏品二级流转平台", tags: ["赵涌在线", "钱币邮票保真竞买", "收藏品二级流转"] }
  ],
  "reg-social-and-dating": [
    { name: "一伴婚恋", url: "http://www.yiban.com.cn/", desc: "主打身份证+学历+房车多重严格实名审核、支持双方家长帮你把关与互加微信的高诚意实名制相亲小程序与App官网", tags: ["一伴婚恋", "多重实名制相亲", "严肃结婚交友"] },
    { name: "牵手恋爱 App", url: "https://www.qianshou.com/", desc: "由珍爱网孵化的面向一二线城市单身白领青年的身份证实名+名校名企职业双重认证、心理测评匹配严肃恋爱平台", tags: ["牵手App", "名校名企双重认证", "青年白领恋爱"] },
    { name: "Hinge", url: "https://hinge.co/", desc: "以“Designed to be Deleted（旨在被卸载）”为口号、风靡欧美高学历青年群体的深度问答破冰与长期严肃恋爱交友平台", tags: ["Hinge", "长期严肃恋爱", "深度破冰问答"] },
    { name: "Coffee Meets Bagel (CMB)", url: "https://coffeemeetsbagel.com/", desc: "由哈佛商学院三姐妹创立、在全球海外华人与亚裔精英白领中口碑极高的每日中午限量精选高质量匹配交友平台", tags: ["CoffeeMeetsBagel", "每日精选少而精", "海外华人精英交友"] }
  ],
  "reg-market-regulation": [
    { name: "全国特种设备公示信息查询平台", url: "http://cnse.e-cqs.cn/", desc: "国家市场监督管理总局主办的全国电梯、锅炉、压力容器、客运索道与大型游乐设施生产充装许可及检验检测机构官方查询系统", tags: ["特种设备官方查询", "电梯游乐设施安全", "国家市场监管总局"] },
    { name: "全国社会组织信用信息公示平台", url: "https://xxgs.chinanpo.mca.gov.cn/", desc: "民政部主办的全国社会团体、基金会、民办非企业单位法人登记真伪核验、年检结果与涉嫌非法社会组织曝光名单唯一官方平台", tags: ["社会组织真伪查询", "非法山寨协会曝光", "民政部官方公示"] },
    { name: "中国盐业协会 / 全国食品生产许可获证企业查询 (SC查询)", url: "http://spaqjg.cnca.cn/", desc: "国家市场监管总局官方食品生产许可证（SC编号）、保健食品与婴幼儿配方乳粉生产企业资质核验系统", tags: ["SC食品生产许可证核验", "食品安全官方查询", "市场监管总局"] }
  ],
  "reg-mental-health": [
    { name: "上海市精神卫生中心（宛平南路600号官网）", url: "https://www.smhc.org.cn/", desc: "国家精神疾病医学中心、上海交通大学医学院附属精神卫生中心官方网站，提供权威心理健康科普、睡眠障碍与心理咨询门诊指南", tags: ["上海精神卫生中心", "国家精神医学中心", "权威心理健康科普"] },
    { name: "美国心理学会 APA (American Psychological Association)", url: "https://www.apa.org/", desc: "全球规模最大、最具学术权威的心理学科学组织与APA论文格式制定者官网，提供全人类心理疾病、认知行为疗法（CBT）与情绪健康循证百科", tags: ["美国心理学会APA", "全球心理学最高权威", "CBT循证心理百科"] },
    { name: "Mind (英国国家心理健康慈善机构)", url: "https://www.mind.org.uk/", desc: "英国最具影响力的公共心理健康非营利机构官网，提供极详尽的抑郁症、焦虑症、双相情感障碍、PTSD自我护理指南与亲友陪伴手册", tags: ["Mind心理健康指南", "抑郁焦虑自救手册", "公益心理科普"] }
  ],
  "reg-education-and-civic-services": [
    { name: "全国住房公积金公共服务平台", url: "https://www.gjj12329.cn/", desc: "住建部住房公积金监管司官方指导的全国公积金政策资讯、异地转移接续、贷款利率计算器与各地公积金中心官方入口导航", tags: ["全国公积金平台", "12329公积金", "异地转移与房贷计算"] },
    { name: "教育部留学服务中心（中国留学网）", url: "https://www.cscse.edu.cn/", desc: "教育部直属的国（境）外学历学位认证、公派留学派出、留学人员回国落户就业报到唯一官方线上办理平台", tags: ["教育部留服中心", "海外学历学位认证", "中国留学网官方"] },
    { name: "全国人社政务服务平台（12333公共服务网）", url: "https://www.12333.gov.cn/", desc: "人力资源和社会保障部官方网上办事大厅，一站式办理全国社保卡申领挂失、专业技术人员职业资格证书查询核验与失业金申领", tags: ["全国人社服务平台", "职业资格证书官方核验", "社保卡申领"] }
  ],
  "reg-charity-and-volunteering": [
    { name: "北京志愿服务发展研究会 / 志愿北京（北京市志愿服务联合会）", url: "https://www.bv2008.cn/", desc: "共青团北京市委与北京市志愿服务联合会官方“志愿北京”信息平台，继承2008奥运志愿者精神，提供志愿者注册、项目报名与工时记录", tags: ["志愿北京官网", "奥运志愿者传承", "官方志愿工时平台"] },
    { name: "上海志愿者网", url: "https://www.volunteer.sh.cn/", desc: "中共上海市委社会工作部与上海市志愿者协会主办的官方志愿服务总门户，提供进博会志愿者招募、社区公益项目与电子志愿者证申领", tags: ["上海志愿者网", "进博会志愿者官方", "社区公益报名"] },
    { name: "深圳义工联（志愿深圳信息系统）", url: "https://v.sva.org.cn/", desc: "中国内地最早成立的市级志愿者组织深圳市义工联合会官方网站，管理全市超380万注册“红马甲”义工的志愿服务报名与积分激励", tags: ["深圳义工联", "红马甲志愿深圳", "全国最早义工组织"] },
    { name: "中国绿化基金会（百万森林 / 我有一片胡杨林）", url: "https://www.cgf.org.cn/", desc: "国家林业和草原局主管的全国性5A级公募基金会官网，运营蚂蚁森林合作造林、“百万森林计划”、荒漠化防治与珍稀濒危野生动物保护项目", tags: ["中国绿化基金会", "蚂蚁森林合作造林", "国家林草局主管5A"] },
    { name: "爱德基金会 Amity Foundation", url: "https://www.amity.org.cn/", desc: "成立于1985年、拥有联合国经社理事会特殊咨商地位的全国性5A级公募基金会，发起著名的“爱德面包坊”孤独症喜憨儿就业与乡村教育助学项目", tags: ["爱德基金会", "5A级国际公募基金会", "喜憨儿面包坊公益"] }
  ]
};

export const EXTRA_PART5 = [
  // reg-learning-paths (need 2)
  { categoryId: "reg-learning-paths", title: "Missing Semester of Your CS Education (MIT)", url: "https://missing-semester-cn.github.io/", description: "麻省理工学院MIT官方出品《计算机教育中缺失的一课》中文版，系统讲授Shell、Vim、Git、命令行与安全工具", tags: ["MIT缺失的一课", "计算机必修工具", "名校中文公开课"] },
  { categoryId: "reg-learning-paths", title: "Google Tech Dev Guide", url: "https://techdevguide.withgoogle.com/", description: "Google官方整理的软件工程师从基础数据结构到高级系统工程的循序渐进自学成长路径指南", tags: ["Google成长路线", "工程师自学", "官方指南"] },
  { categoryId: "reg-learning-paths", title: "nand2tetris (从与非门到俄罗斯方块)", url: "https://www.nand2tetris.org/", description: "全球计算机体系结构经典实践课程，带你从零搭建逻辑门、CPU、汇编器、编译器、操作系统直到运行游戏", tags: ["nand2tetris", "从零造计算机", "硬核体系结构路线"] },
  { categoryId: "reg-learning-paths", title: "Frontend Developer Handbook (Frontend Masters)", url: "https://frontendmasters.com/guides/front-end-handbook/2024/", description: "Frontend Masters出品的年度现代前端工程师技术栈全景图、职业进阶路线与工具生态手册", tags: ["前端年度手册", "技术栈全景", "职业路线"] },

  // reg-ui-assets (need 5)
  { categoryId: "reg-ui-assets", title: "Blush Design", url: "https://blush.design/zh-CN", description: "汇聚全球顶尖插画师作品、支持在Figma或网页端像捏脸一样无限混搭组合的商用UI插画平台", tags: ["Blush插画", "模块化捏脸插画", "Figma插件"] },
  { categoryId: "reg-ui-assets", title: "IRA Design (by Creative Tim)", url: "https://iradesign.io/", description: "支持5种渐变色自由切换与手绘人物场景图层自由拼装的MIT开源免费商用SVG矢量插画库", tags: ["IRADesign", "渐变SVG插画", "MIT免费商用"] },
  { categoryId: "reg-ui-assets", title: "ManyPixels Illustrations", url: "https://www.manypixels.co/gallery", description: "每周持续更新、收录超2500张支持在线一键替换品牌HEX主色的免版税扁平化与等距2.5D网页SVG插画库", tags: ["ManyPixels", "2.5D等距插画", "一键换色SVG"] },
  { categoryId: "reg-ui-assets", title: "Absurd Design", url: "https://absurd.design/", description: "打破常规千篇一律扁平风的超现实主义手绘艺术感网页UI插画与概念视觉素材站", tags: ["AbsurdDesign", "超现实手绘插画", "先锋UI素材"] },
  { categoryId: "reg-ui-assets", title: "Shapefest", url: "https://www.shapefest.com/", description: "包含超15万个高分辨率透明背景PNG粘土、金属、毛玻璃、全息材质3D几何图形与UI装饰元素的免费素材库", tags: ["Shapefest", "3D毛玻璃元素", "透明PNG素材"] },
  { categoryId: "reg-ui-assets", title: "Streamline HQ", url: "https://www.streamlinehq.com/", description: "全球规模最大的统一设计语言图标（15万+）、UI插画、Emoji与矢量元素设计系统资产库", tags: ["StreamlineHQ", "15万图标插画库", "企业级UI资产"] },
  { categoryId: "reg-ui-assets", title: "Vertex.im (免费可定制3D图标库)", url: "https://vertex.im/", description: "完全免费且无需注册的在线3D立体图标定制工具，支持自由旋转3D视角、调节材质光泽度与导出高清PNG", tags: ["Vertex3D", "免费在线3D图标", "自由调节视角材质"] },

  // reg-color-palettes (need 1)
  { categoryId: "reg-color-palettes", title: "Leonardo Color (Adobe 开源色彩系统)", url: "https://leonardocolor.io/", description: "Adobe开源的基于WCAG 2.1与APCA感知对比度算法的科学设计系统自适应暗黑/明亮模式色板生成工具", tags: ["AdobeLeonardo", "APCA对比度算法", "设计系统色彩工程"] },
  { categoryId: "reg-color-palettes", title: "Picular (色彩搜索引擎)", url: "https://picular.co/", description: "被称为“颜色的Google搜索”，输入任意自然界或情绪英文单词（如Forest/Ocean/Cyber）即刻生成对应灵感色卡", tags: ["Picular", "关键词搜颜色", "自然灵感色卡"] },
  { categoryId: "reg-color-palettes", title: "Khroma (AI 个性化配色生成器)", url: "https://www.khroma.co/", description: "通过挑选50个你喜欢的颜色在浏览器本地训练专属神经网络模型，无限生成符合个人审美偏好的排版与渐变色板", tags: ["Khroma", "神经网络配色", "个性化色卡"] },

  // reg-stock-media (need 3)
  { categoryId: "reg-stock-media", title: "Foodiesfeed (全球免费高清美食摄影图库)", url: "https://www.foodiesfeed.com/", description: "专注于餐饮美食、咖啡甜点、新鲜食材与烹饪俯拍的CC0完全免费商用超高清美食摄影素材图库", tags: ["Foodiesfeed", "免费美食摄影库", "CC0餐饮图片"] },
  { categoryId: "reg-stock-media", title: "Gratisography", url: "https://gratisography.com/", description: "以极具创意脑洞、幽默表现力与反常规视角著称的全球最独特100%免费商用高分辨率创意摄影图库", tags: ["Gratisography", "脑洞创意摄影", "免费商用怪诞图库"] },
  { categoryId: "reg-stock-media", title: "StockSnap.io", url: "https://stocksnap.io/", description: "每周精选新增数百张CC0无版权限制、完全免署名的商业办公、自然风光与城市人像高清摄影图库", tags: ["StockSnap", "CC0免署名图库", "高清商业摄影"] },
  { categoryId: "reg-stock-media", title: "Dareful (原 StockFootageForFree 全4K免费视频库)", url: "https://dareful.com/", description: "由VideoBlocks创始人资助、所有视频均为真4K超高清分辨率且采用CC4.0免费商用许可的航拍与风光视频素材站", tags: ["Dareful", "真4K免费航拍视频", "无水印视频素材"] },
  { categoryId: "reg-stock-media", title: "Magdeleine (每日严选情绪色调摄影图库)", url: "https://magdeleine.co/", description: "由摄影师手工严选的CC0胶片质感与高情绪价值免费商用摄影图库，支持按主色调与相机明暗度精准检索", tags: ["Magdeleine", "胶片质感CC0图库", "按主色调搜图"] },

  // reg-brand-and-identity (need 2)
  { categoryId: "reg-brand-and-identity", title: "LogoArchive (极简现代主义Logo博物馆)", url: "https://www.logo-archive.org/", description: "由英国设计史学者Richard Baird建立的20世纪中叶全球现代主义几何极简主义经典标志与企业徽标数字档案馆", tags: ["LogoArchive", "现代主义标志博物馆", "几何极简Logo史"] },
  { categoryId: "reg-brand-and-identity", title: "BrandColors (全球名企官方标准色值大全)", url: "https://brandcolors.net/", description: "收录全球数千家知名科技、汽车、金融与消费巨头官方VI规范中精确主辅HEX色值与一键导出SCSS/ASE色板的工具站", tags: ["BrandColors", "名企官方VI色值", "品牌标准色查询"] },
  { categoryId: "reg-brand-and-identity", title: "Identity Designed", url: "https://identitydesigned.com/", description: "《Logo Design Love》作者David Airey主理的全球顶尖设计工作室品牌视觉识别系统（VI）全案深度剖析网站", tags: ["IdentityDesigned", "全球顶尖VI全案", "品牌设计深度解析"] },
  { categoryId: "reg-brand-and-identity", title: "SVGL (高清科技品牌SVG Logo库)", url: "https://svgl.app/", description: "面向开发者与设计师的现代化开源高清科技品牌、AI大模型、开发框架与SaaS产品明亮/暗黑双模式SVG Logo库", tags: ["SVGL", "暗黑模式品牌Logo", "开源科技SVG库"] },

  // reg-user-research (need 1)
  { categoryId: "reg-user-research", title: "GoodUI (A/B测试实证转化率模式库)", url: "https://goodui.org/", description: "汇总Amazon、Netflix、Booking等巨头数百场真实A/B测试赢家实验数据（Winner vs Loser）的UI转化率实证用研平台", tags: ["GoodUI", "真实AB测试胜率库", "转化率实证用研"] },
  { categoryId: "reg-user-research", title: "Growth.Design (交互式漫画产品心理学案例)", url: "https://growth.design/case-studies", description: "以沉浸式互动幻灯片拆解Duolingo、Airbnb、Spotify等顶级产品的用户引导、留存漏斗与认知偏差UX用研神站", tags: ["GrowthDesign", "顶级产品UX拆解", "行为心理学案例"] },
  { categoryId: "reg-user-research", title: "UXtweak", url: "https://www.uxtweak.com/", description: "一体化网站与移动端App用户可用性测试、五秒测试、树状菜单信息架构验证、会话录屏与点击热力图研究平台", tags: ["UXtweak", "树状菜单可用性", "点击热力图用研"] },

  // reg-collaborative-docs (need 4)
  { categoryId: "reg-collaborative-docs", title: "Wiki.js", url: "https://js.wiki/", description: "基于Node.js与Git双向同步构建的全球最流行开源现代化企业Wiki文档系统，内置Markdown、流程图与细粒度RBAC权限", tags: ["Wiki.js", "Git双向同步Wiki", "开源企业知识库"] },
  { categoryId: "reg-collaborative-docs", title: "XWiki", url: "https://www.xwiki.org/", description: "欧洲广泛采用的开源企业级第二代结构化Wiki协作平台，支持在文档页面内直接构建自定义数据库表单应用与宏扩展", tags: ["XWiki", "结构化企业Wiki", "开源Confluence替代"] },
  { categoryId: "reg-collaborative-docs", title: "Etherpad (实时开源协同富文本编辑器)", url: "https://etherpad.org/", description: "由Linux基金会等机构支持的毫秒级多人同时在线高亮协同写作开源Web文档系统，拥有数百种社区插件", tags: ["Etherpad", "开源毫秒级协同写作", "自托管在线文档"] },
  { categoryId: "reg-collaborative-docs", title: "CryptPad (零知识端到端加密开源协作套件)", url: "https://cryptpad.org/", description: "法国开源研发的100%零知识端到端加密在线协作办公套件，涵盖富文本文档、电子表格、看板、白板与代码协同", tags: ["CryptPad", "零知识加密协作套件", "开源在线表格文档"] },
  { categoryId: "reg-collaborative-docs", title: "focalboard / Mattermost Boards", url: "https://www.focalboard.com/", description: "开源自托管的Trello、Notion与Asana替代方案，支持团队任务卡片、多视图看板、日历与项目文档一体化协同", tags: ["Focalboard", "开源自托管看板文档", "团队任务协同"] },
  { categoryId: "reg-collaborative-docs", title: "Trilium Notes", url: "https://github.com/TriliumNext/Notes", description: "支持无限层级树状笔记、同节点多位置克隆、知识图谱可视化与自建服务端同步的开源大型个人与团队知识库", tags: ["TriliumNotes", "无限层级知识树", "开源自托管笔记"] },

  // reg-video-conferencing (need 1)
  { categoryId: "reg-video-conferencing", title: "LiveKit", url: "https://livekit.io/", description: "支撑OpenAI ChatGPT实时语音视频对话的全球顶流开源WebRTC云原生音视频会议SFU服务器与多端SDK基础设施", tags: ["LiveKit", "OpenAI同款WebRTC", "开源音视频会议底座"] },
  { categoryId: "reg-video-conferencing", title: "亿联会议 Yealink Meeting", url: "https://www.yealink.com.cn/", description: "全球SIP话机与企业级智能会议室硬件领军者亿联网络出品的4K超清云视频会议与智慧会议室协同平台", tags: ["亿联会议", "智慧会议室领军者", "企业级4K云视频"] },
  { categoryId: "reg-video-conferencing", title: "好视通云会议 (齐心集团)", url: "https://www.hst.com/", description: "国内知名政企信创适配、远程党建、远程医疗会诊与双师课堂大规模并发云视频会议服务平台", tags: ["好视通", "国产信创云会议", "政企视频系统"] },

  // reg-question-banks (need 2)
  { categoryId: "reg-question-banks", title: "考试酷 Examcoo", url: "https://www.examcoo.com/", description: "国内知名的永久免费电子作业与在线考试题库系统，收录中小学、大学高数英语四六级、建筑财会医卫超百万份共享试卷", tags: ["考试酷", "免费百万共享题库", "在线自测组卷"] },
  { categoryId: "reg-question-banks", title: "Kattis (Open Kattis 国际ACM算法竞赛题库)", url: "https://open.kattis.com/", description: "ICPC国际大学生程序设计竞赛世界总决赛官方采用的高标准在线算法评测系统（OJ）与数千道经典ACM真题库", tags: ["OpenKattis", "ICPC世决官方OJ", "国际算法竞赛题库"] },
  { categoryId: "reg-question-banks", title: "金考典（建筑财会职业资格考试题库）", url: "https://www.jinkaodian.com/", description: "深耕一级二级建造师、注册消防工程师、注册会计师CPA、法考与执业药师的章节精讲历年真题模考软件官网", tags: ["金考典", "一建二建注会题库", "职业资格真题模考"] },
  { categoryId: "reg-question-banks", title: "CSES Problem Set (芬兰经典算法刷题库)", url: "https://cses.fi/problemset/", description: "算法竞赛界公认质量极高的300道核心算法精选题集，涵盖动态规划、图论、树算法、数论与高级数据结构", tags: ["CSES题集", "300道算法核心母题", "竞赛必刷经典"] },

  // reg-dictionaries-and-translators (need 1)
  { categoryId: "reg-dictionaries-and-translators", title: "Longman Dictionary 朗文当代高级英语辞典", url: "https://www.ldoceonline.com/", description: "培生教育出版的全球英语学习者最推崇的《朗文当代高级英语辞典》在线免费版，用2000个基础词汇精准释义并配真人朗读例句", tags: ["朗文当代英语辞典", "真人整句发音", "权威英英释义"] },
  { categoryId: "reg-dictionaries-and-translators", title: "Collins Dictionary 柯林斯在线词典", url: "https://www.collinsdictionary.com/", description: "以整句自然语境释义（COBUILD语料库）、词频星级标记与英法德西意多语互译闻名的国际权威词典官方网站", tags: ["柯林斯COBUILD词典", "整句语境释义", "词频星级权威"] },
  { categoryId: "reg-dictionaries-and-translators", title: "Online Etymology Dictionary (英语词源在线词典)", url: "https://www.etymonline.com/", description: "全球语言学者与高阶英语学习者必备的英语单词词根、印欧语系历史演变与词汇首次出现年代权威考据词典", tags: ["Etymonline", "英语词根词源考据", "词汇历史演变"] },

  // reg-paper-writing (need 2)
  { categoryId: "reg-paper-writing", title: "Authorea (Wiley 旗下合作科研论文写作平台)", url: "https://www.authorea.com/", description: "学术出版巨头Wiley旗下的现代化在线科研论文协同撰写平台，支持LaTeX、Markdown与富文本混排、Jupyter交互图表及一键投稿", tags: ["Authorea", "Wiley官方论文平台", "LaTeX协同投稿"] },
  { categoryId: "reg-paper-writing", title: "Detexify (手绘识别LaTeX数学符号神器)", url: "https://detexify.kirelabs.org/", description: "科研人员写LaTeX论文必备小工具：用鼠标在画板上随手画出任意复杂数学或物理希腊符号，AI即刻识别出对应LaTeX宏包与命令", tags: ["Detexify", "手绘查LaTeX符号", "数学公式写作神器"] },
  { categoryId: "reg-paper-writing", title: "Tables Generator (LaTeX / Markdown 学术三线表生成器)", url: "https://www.tablesgenerator.com/", description: "支持从Excel直接复制粘贴表格数据，一键可视化调整合并单元格与边框并生成标准LaTeX booktabs学术三线表代码的在线工具", tags: ["TablesGenerator", "Excel转LaTeX三线表", "论文排版必备"] },
  { categoryId: "reg-paper-writing", title: "LanguageTool (开源多语种学术语法与标点校对)", url: "https://languagetool.org/", description: "支持英语、德语、法语、西班牙语及中文等30余种语言的开源高阶语法、学术用词冗余、标点规范与风格校对工具（支持Overleaf插件）", tags: ["LanguageTool", "Overleaf语法校对插件", "开源多语种润色"] },

  // reg-official-releases (need 1)
  { categoryId: "reg-official-releases", title: "中华人民共和国最高人民法院", url: "https://www.court.gov.cn/", description: "最高人民法院官方网站，权威发布国家司法解释、指导性案例、最高法工作报告、新闻发布会与全国法院审判动态", tags: ["最高人民法院官网", "国家司法解释发布", "指导性案例权威"] },
  { categoryId: "reg-official-releases", title: "中华人民共和国最高人民检察院", url: "https://www.spp.gov.cn/", description: "最高人民检察院官方网站，权威发布刑事民事行政公益诉讼检察政策、典型案例通报与国家法治建设重要资讯", tags: ["最高人民检察院官网", "公益诉讼权威发布", "国家司法机关"] },
  { categoryId: "reg-official-releases", title: "中华人民共和国商务部 MOFCOM", url: "https://www.mofcom.gov.cn/", description: "商务部官方网站，权威发布全国进出口贸易统计数据、外商投资政策、消费促进措施、贸易救济公告与例行新闻发布会", tags: ["商务部官网", "外贸与消费数据发布", "部委权威门户"] },

  // reg-general-news-portals (need 1)
  { categoryId: "reg-general-news-portals", title: "北京日报网（京报网）", url: "https://www.bjd.com.cn/", description: "中共北京市委机关报北京日报报业集团官方融媒体门户，权威报道首都政经动态、京津冀协同发展与长安街知事深度时政专栏", tags: ["京报网", "北京日报社", "长安街知事时政"] },
  { categoryId: "reg-general-news-portals", title: "羊城晚报（金羊网）", url: "https://www.ycwb.com/", description: "新中国成立后办起的第一张大型综合性晚报《羊城晚报》官方网站，深耕粤港澳大湾区民生、文化副刊与岭南深度新闻报道", tags: ["金羊网", "羊城晚报官网", "大湾区主流大报"] },
  { categoryId: "reg-general-news-portals", title: "大河网（河南日报报业集团）", url: "https://www.dahe.cn/", description: "中共河南省委机关报河南日报报业集团主办的河南省首家重点综合新闻门户，全面覆盖中原经济区时政、民生与文化资讯", tags: ["大河网", "河南日报集团", "中部重点新闻门户"] },

  // reg-media-toolkit (need 3)
  { categoryId: "reg-media-toolkit", title: "Carbon.now.sh (高颜值代码截图生成工具)", url: "https://carbon.now.sh/", description: "全球技术博主、公众号与科技媒体最喜爱的高颜值Mac窗口风格代码高亮海报截图生成器", tags: ["Carbon代码截图", "技术公众号配图", "Mac风格美化"] },
  { categoryId: "reg-media-toolkit", title: "RAWGraphs (开源复杂数据新闻可视化生成器)", url: "https://www.rawgraphs.io/", description: "米兰理工大学密度设计实验室开源的科研与数据新闻利器，将CSV数据一键转化为桑基图、蜂群图、树图等矢量SVG图表", tags: ["RAWGraphs", "开源桑基图生成", "数据新闻SVG图表"] },
  { categoryId: "reg-media-toolkit", title: "零克查词（小红书抖音违规敏感词实时检测）", url: "https://www.lingkechaci.com/", description: "专为小红书种草笔记、抖音短视频口播、美妆医疗保健文案打造的最新广告法极限词与平台限流敏感词高亮替换工具", tags: ["零克查词", "小红书限流词检测", "新媒体合规工具"] },
  { categoryId: "reg-media-toolkit", title: "Md2All / Markdown Nice (墨滴公众号排版)", url: "https://www.mdnice.com/", description: "国内技术与深度写作者最常用的Markdown转微信公众号、知乎、掘金排版编辑器，内置数十款精美CSS主题与数学公式完美渲染", tags: ["MarkdownNice", "墨滴公众号排版", "Markdown一键转微信"] },
  { categoryId: "reg-media-toolkit", title: "ScreenStudio / Kap (开源Mac高清GIF与录屏工具)", url: "https://getkap.co/", description: "新媒体产品测评与教程作者必备的完全开源轻量级高清屏幕录制、一键裁剪导出高帧率GIF/MP4/WebM动图工具", tags: ["Kap开源录屏", "高清GIF动图制作", "新媒体教程工具"] },

  // reg-live-streaming-ops (need 2)
  { categoryId: "reg-live-streaming-ops", title: "OBS Studio 官方网站", url: "https://obsproject.com/", description: "全球所有直播平台（抖音/B站/视频号/Twitch/YouTube）主播标配的100%免费开源高清视频推流、多机位导播切画与绿幕抠像软件官网", tags: ["OBSStudio官网", "全球开源推流标杆", "多机位直播导播"] },
  { categoryId: "reg-live-streaming-ops", title: "Restream.io (多平台同步推流云直播)", url: "https://restream.io/", description: "支持将同一场高清直播流同时分发推送到YouTube、Twitch、X、LinkedIn等30+全球主流平台并聚合所有平台弹幕评论的云工具", tags: ["Restream", "30平台同步推流", "多平台弹幕聚合"] },
  { categoryId: "reg-live-streaming-ops", title: "哔哩哔哩直播姬（B站官方开播工作台）", url: "https://live.bilibili.com/liveHime", description: "B站官方出品的集成了Live2D虚拟主播面捕、弹幕点歌机、高能时刻自动切片、大航海舰长特效答谢与一键手游投屏的开播神器", tags: ["B站直播姬", "虚拟主播面捕开播", "弹幕互动插件"] },
  { categoryId: "reg-live-streaming-ops", title: "抖音直播伴侣官方下载", url: "https://streamingtool.douyin.com/", description: "字节跳动抖音官方PC端与移动端专业直播推流工具，原生支持4K高帧率游戏直播、电商绿幕虚拟直播间、美颜滤镜与福袋互动", tags: ["抖音直播伴侣", "绿幕虚拟直播间", "抖音官方开播工具"] },

  // reg-campus-and-internship (need 1)
  { categoryId: "reg-campus-and-internship", title: "海投网（全国高校校园宣讲会查询系统）", url: "https://xjh.haitou.cc/", description: "实时同步全国百余所985/211双一流重点高校就业办官方线下校园宣讲会、空中宣讲会时间教室与大型双选会日程的校招工具站", tags: ["海投网宣讲会", "985高校宣讲会日程", "双选会查询"] },
  { categoryId: "reg-campus-and-internship", title: "中智招聘网（央企校招与外企实习平台）", url: "https://www.ciiczhaopin.com/", description: "国务院国资委直属唯一人力资源央企中国国际技术智力合作集团（中智CIIC）官方校园招聘、名企暑期实习与央国企统招平台", tags: ["中智招聘", "人力资源央企官方", "央企外企校招"] },
  { categoryId: "reg-campus-and-internship", title: "大街网（青年校招与名企实习社区）", url: "https://www.dajie.com/", description: "面向大学应届生与年轻职场人的校园招聘网申、名企实习生招募与校友职业人脉平台", tags: ["大街网", "大学生实习校招", "青年求职"] },

  // reg-executive-search (need 1)
  { categoryId: "reg-executive-search", title: "Odgers Berndtson 奥杰国际猎头", url: "https://www.odgersberndtson.com/", description: "总部位于伦敦、拥有近60年历史的欧洲及全球顶级高管寻访与领导力评估机构，在30余国设有分支机构", tags: ["奥杰国际", "欧洲顶级高管猎头", "跨国CEO寻聘"] },
  { categoryId: "reg-executive-search", title: "Robert Walters 华德士", url: "https://www.robertwalters.cn/", description: "创立于1985年的伦敦证交所上市全球知名专业中高端人才寻访机构，每年发布权威《全球薪资调查报告》", tags: ["华德士", "全球中高端猎头", "年度全球薪资报告"] },
  { categoryId: "reg-executive-search", title: "任仕达中国 Randstad China", url: "https://www.randstad.cn/", description: "全球规模领先的人力资源服务巨头荷兰任仕达集团中国官网，提供跨国企业中高端猎头寻访、RPO与灵活用工解决方案", tags: ["任仕达Randstad", "全球HR巨头", "跨国猎头服务"] },

  // reg-professional-networking (need 2)
  { categoryId: "reg-professional-networking", title: "XING (德语区最大职场社交网络)", url: "https://www.xing.com/", description: "覆盖德国、奥地利与瑞士（DACH欧洲核心经济区）超2100万专业人士、工程师与企业高管的欧洲本土第一职场人脉与招聘社交平台", tags: ["XING", "德语区第一职场社交", "欧洲工程师人脉"] },
  { categoryId: "reg-professional-networking", title: " Blind (TeamBlind 硅谷大厂实名企业邮箱认证职场社区)", url: "https://www.teamblind.com/", description: "需通过苹果、谷歌、微软、Meta、字节跳动等公司企业邮箱验证入驻的全球科技大厂员工真实职场交流、内推互助与Offer包对比社区", tags: ["TeamBlind", "硅谷大厂企业邮箱认证", "内推与Offer对比"] },
  { categoryId: "reg-professional-networking", title: "Peerlist", url: "https://peerlist.io/", description: "面向全球软件工程师、产品设计师与独立创作者的新一代经过验证的工作作品集（Proof of Work）、GitHub贡献集成与同行人脉网络", tags: ["Peerlist", "作品集验证职场社交", "开发者同行网络"] },
  { categoryId: "reg-professional-networking", title: "MentorCruise", url: "https://mentorcruise.com/", description: "连接全球顶尖科技公司资深工程总监、Staff Engineer、AI科学家与成长期职场人的长期职业规划及代码架构导师网络", tags: ["MentorCruise", "Staff工程师导师网", "长期职业晋升辅导"] },

  // reg-interview-prep (need 1)
  { categoryId: "reg-interview-prep", title: "JavaGuide (Java学习与大厂面试指南)", url: "https://javaguide.cn/", description: "GitHub超14万星标的国内Java后端工程师校招与社招面试通关圣经，系统覆盖JVM、并发编程、Spring、分布式、MySQL与真实面经", tags: ["JavaGuide", "14万星Java面试圣经", "后端八股文大全"] },
  { categoryId: "reg-interview-prep", title: "代码随想录 (卡尔算法刷题通关指南)", url: "https://programmercarl.com/", description: "GitHub超5万星标的国内最受欢迎LeetCode算法面试按专题循序渐进刷题路线图、图解动画与大厂高频笔试真题解析站", tags: ["代码随想录", "算法刷题循序路线", "大厂笔试通关"] },
  { categoryId: "reg-interview-prep", title: "GreatFrontEnd (前端工程师系统设计与代码面试平台)", url: "https://www.greatfrontend.com/", description: "由前Meta面试官团队打造的前端JavaScript手写题、UI组件实现与前端大型Web应用系统架构设计（Front-End System Design）题库", tags: ["GreatFrontEnd", "前端系统设计面试", "JS手写题库"] },

  // reg-funds-and-wealth (need 1)
  { categoryId: "reg-funds-and-wealth", title: "中国债券信息网 (中央结算公司 CCDC)", url: "https://www.chinabond.com.cn/", description: "中央国债登记结算有限责任公司官方门户，权威发布中债国债收益率曲线（十年期国债基准）、债券估值与固定收益理财市场数据", tags: ["中国债券信息网", "中债国债收益率曲线", "固收理财权威基准"] },
  { categoryId: "reg-funds-and-wealth", title: "Portfolio Visualizer (全球资产配置回测神器)", url: "https://www.portfoliovisualizer.com/", description: "全球指数基金投资者与量化理财师最推崇的股债黄金资产配置组合历史回测、蒙特卡洛退休模拟、夏普比率与最大回撤分析工具", tags: ["PortfolioVisualizer", "资产配置历史回测", "夏普最大回撤分析"] },
  { categoryId: "reg-funds-and-wealth", title: "韭圈儿 (基金经理与ETF估值数据工具)", url: "https://www.jiucaishuo.com/", description: "国内基民与投顾常用的全市场宽基行业指数PE/PB历史百分位估值表、基金持仓穿透、相关性矩阵与基金PK对比工具站", tags: ["韭圈儿", "指数PE百分位估值表", "基金相关性对比"] },

  // reg-short-video (need 1)
  { categoryId: "reg-short-video", title: "快手光合创作者大会与达人学院", url: "https://university.kuaishou.com/", description: "快手官方短视频创作者学习与成长平台，提供短视频拍摄剪辑技巧、爆款选题策划、账号冷启动运营与官方流量扶持活动指南", tags: ["快手创作者学院", "官方短视频运营课", "达人流量扶持"] },
  { categoryId: "reg-short-video", title: "抖音电商学习中心（短视频带货与创作官方课堂）", url: "https://school.jinritemai.com/", description: "抖音官方出品的短视频内容创作、图文带货、好物短视频脚本编写、商品卡流量获取与平台创作规范免费公开课门户", tags: ["抖音官方学习中心", "短视频脚本公开课", "官方运营指南"] },
  { categoryId: "reg-short-video", title: "西瓜创作平台（中短视频同步分发后台）", url: "https://studio.ixigua.com/", description: "字节跳动旗下西瓜视频与抖音横屏中短视频一键同步分发、4K超清投稿、播放收益结算与影视科普创作者官方后台", tags: ["西瓜创作平台", "抖音横屏同步分发", "中短视频收益后台"] },

  // Final 5 leaves top-up
  { categoryId: "reg-stock-media", title: "ISO Republic (免费高分辨率CC0图片与视频素材库)", url: "https://isorepublic.com/", description: "由英国设计师Tom Eversley创立的精选超7000张CC0完全免费商用高清建筑、科技、自然摄影图片与4K短视频素材库", tags: ["ISORepublic", "CC0免费图片视频", "英国设计师精选"] },
  { categoryId: "reg-stock-media", title: "SplitShire", url: "https://www.splitshire.com/", description: "意大利商业摄影师Daniel Nanescu无私开放的数千张极具电影感与生活气息的免费商用高分辨率摄影图库及无人机航拍视频站", tags: ["SplitShire", "电影感免费摄影", "无人机航拍素材"] },
  { categoryId: "reg-stock-media", title: "Picjumbo", url: "https://picjumbo.com/", description: "创立于2013年、全球下载量超千万次的完全免费商用高清科技数码产品特写、办公桌面与现代生活摄影素材库", tags: ["Picjumbo", "数码办公特写图库", "免费商用高清图"] },

  { categoryId: "reg-official-releases", title: "中华人民共和国生态环境部 MEE", url: "https://www.mee.gov.cn/", description: "生态环境部官方网站，权威发布全国空气与水环境质量公报、中央生态环保督察通报、碳达峰碳中和政策与核安全信息", tags: ["生态环境部官网", "双碳环保权威发布", "国家部委门户"] },
  { categoryId: "reg-official-releases", title: "中华人民共和国住房和城乡建设部 MOHURD", url: "https://www.mohurd.gov.cn/", description: "住建部官方网站，权威发布国家房地产调控政策、保障性住房建设、城乡规划建筑工程国家标准与城市更新动态", tags: ["住建部官网", "住房与建筑国标发布", "国家部委权威"] },
  { categoryId: "reg-official-releases", title: "中华人民共和国交通运输部 MOT", url: "https://www.mot.gov.cn/", description: "交通运输部官方网站，权威发布国家综合立体交通网规划、高速公路水运民航铁路运行数据与节假日出行指南", tags: ["交通运输部官网", "全国交通运行权威数据", "国家部委门户"] },

  { categoryId: "reg-media-toolkit", title: "Hemingway Editor (海明威极简清晰度写作编辑器)", url: "https://hemingwayapp.com/", description: "全球记者与专栏作家推崇的英文新闻与非虚构写作清晰度检测工具，自动高亮冗长复杂句、被动语态与副词滥用", tags: ["海明威写作编辑器", "新闻写作清晰度检测", "记者编辑工具"] },
  { categoryId: "reg-media-toolkit", title: "Squoosh (Google Chrome 实验室开源极致图片压缩工具)", url: "https://squoosh.app/", description: "Google Chrome团队开源的纯浏览器本地运行新媒体高清配图无损压缩与WebP/AVIF下一代图像格式实时对比转换神器", tags: ["GoogleSquoosh", "新媒体配图无损压缩", "WebP转换神器"] },
  { categoryId: "reg-media-toolkit", title: "Excalidraw (开源手绘风新媒体架构图与信息图白板)", url: "https://excalidraw.com/", description: "科技自媒体与深度商业作者最喜爱的开源手绘风格逻辑架构图、商业模式拆解图与流程图绘制导出工具", tags: ["Excalidraw", "手绘商业逻辑配图", "科技媒体绘图神器"] },
  { categoryId: "reg-media-toolkit", title: "易撰 Yizhuan5 (自媒体爆文热词与违规风险创作平台)", url: "https://www.yizhuan5.com/", description: "国内专业的新媒体爆文数据库、全网各平台实时热词采集、标题生成与文章原创度/风险度检测工作台", tags: ["易撰新媒体", "全网爆文热词库", "原创度风险检测"] },
  { categoryId: "reg-media-toolkit", title: "微小宝 / 96微信编辑器", url: "https://bj.96weixin.com/", description: "国内老牌微信公众号可视化图文排版编辑器，提供节日热点SVG交互动效模板、全文一键换色与多账号同步分发", tags: ["96微信编辑器", "SVG交互图文排版", "公众号美化工具"] },
  { categoryId: "reg-media-toolkit", title: "Bellingcat Online Investigation Toolkit (开源新闻事实核查工具箱)", url: "https://bellingcat.gitbook.io/toolkit", description: "国际知名调查新闻机构Bellingcat维护的全球记者开源情报（OSINT）、卫星地图核查、图片视频真伪溯源与档案检索工具库", tags: ["Bellingcat工具箱", "国际调查记者核查", "图片视频真伪溯源"] },

  { categoryId: "reg-live-streaming-ops", title: "Prism Live Studio (Naver 出品跨平台多路推流与VTuber直播工具)", url: "https://prismlive.com/zh_cn/", description: "韩国互联网巨头Naver出品的完全免费PC与移动端多平台同步推流、3D虚拟形象动捕、动态贴纸特效与提词器一体化直播工作台", tags: ["PrismLiveStudio", "Naver免费多路推流", "虚拟直播与提词器"] },
  { categoryId: "reg-live-streaming-ops", title: "Nightbot (全球最流行的直播间自动化弹幕互动与场控机器人)", url: "https://nightbot.tv/", description: "支持YouTube Live与Twitch的云端自动化直播间场控机器人，提供自定义关键词自动回复、点歌队列、定时公告与刷屏过滤", tags: ["Nightbot", "直播间自动场控机器人", "弹幕点歌与互动"] },
  { categoryId: "reg-live-streaming-ops", title: "快手直播伴侣官方下载", url: "https://live.kuaishou.com/live-partner", description: "快手官方PC端与移动端专业开播投屏推流软件，支持多场景画中画图层编排、电商商品讲解卡片、语音字幕识别与高清游戏直播", tags: ["快手直播伴侣", "快手官方PC推流", "电商讲解卡片开播"] },
  { categoryId: "reg-live-streaming-ops", title: "VTube Studio (全球虚拟主播Live2D面部捕捉行业标准工具)", url: "https://denchisoft.com/", description: "全球B站、抖音与Twitch虚拟主播（VTuber）使用率最高的低延迟高精准度iPhone/摄像头Live2D模型面部表情捕捉与直播推流软件官网", tags: ["VTubeStudio官网", "虚拟主播面捕行业标准", "Live2D直播软件"] },

  { categoryId: "reg-professional-networking", title: " Levels.fyi Community & Verified Referrals (大厂内推与职业导师网络)", url: "https://www.levels.fyi/services/", description: "连接全球顶尖科技大厂（Google/Meta/OpenAI/字节跳动）在职资深工程师提供1对1薪资谈判辅导、简历精修与实名直推的职场人脉服务网", tags: ["大厂工程师1对1辅导", "薪资谈判与内推网络", "科技职场人脉"] },
  { categoryId: "reg-professional-networking", title: "Indie Hackers (Stripe 旗下全球独立开发者与创业者职场社交社区)", url: "https://www.indiehackers.com/", description: "支付巨头Stripe收购的全球最大独立开发者、一人公司创始人与SaaS创业者真实营收透明分享、联合创始人寻找与同行社交网络", tags: ["IndieHackers", "Stripe旗下创业者社交", "联合创始人人脉"] },
  { categoryId: "reg-professional-networking", title: "The Org (全球企业真实组织架构图与高管团队人脉库)", url: "https://theorg.com/", description: "收录全球超40万家科技与知名企业公开透明的真实部门汇报线、高管与核心骨干实名团队架构图（Org Chart）的创新职场人脉平台", tags: ["TheOrg", "40万名企真实组织架构图", "透明团队人脉库"] }
];


