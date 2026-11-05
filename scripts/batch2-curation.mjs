/**
 * 第二批：全量补齐剩余 63 个空缺子分类的高质量权威站点
 * 具备严格的前置去重（URL 规范化比对 + 标题比对 + 库内全部站点查询比对 + 批次内互斥）
 */

export const BATCH2_CANDIDATES = [
  // 1. 设计与创意 / reg-design-and-creative
  {
    url: "https://www.blender.org",
    title: "Blender",
    description: "全球领先的开源全功能 3D 创作套件，支持建模、雕刻、绑定、动画、渲染与节点材质合成。",
    categoryId: "reg-three-d-and-ar",
    tags: ["3D建模", "开源工具", "渲染引擎", "动画设计"]
  },
  {
    url: "https://spline.design",
    title: "Spline",
    description: "专为网页与 UI 设计师打造的现代化在线 3D 协作设计工具，支持轻量级 3D 交互动效与三维网页嵌入。",
    categoryId: "reg-three-d-and-ar",
    tags: ["3D设计", "网页动效", "交互设计", "在线工具"]
  },
  {
    url: "https://sketchfab.com",
    title: "Sketchfab",
    description: "全球最大的 3D 模型、AR 与 VR 资产展示与分享平台，拥有庞大的 3D 创作者社区与交互式预览模型库。",
    categoryId: "reg-three-d-and-ar",
    tags: ["3D模型", "AR展示", "模型资产", "VR"]
  },
  {
    url: "https://www.awwwards.com",
    title: "Awwwards",
    description: "享誉全球的数字设计盛典与顶尖网页交互设计大奖评选机构，每日评选全球最具前沿创新与创意的网站案例。",
    categoryId: "reg-design-blogs",
    tags: ["设计大奖", "网页灵感", "交互案例", "UI欣赏"]
  },
  {
    url: "https://www.siteinspire.com",
    title: "Siteinspire",
    description: "高品质网页设计展示画廊，精选全球各行业最优雅、极简与排版精致的数字产品网站设计范例。",
    categoryId: "reg-design-blogs",
    tags: ["网页画廊", "排版灵感", "极简设计", "视觉参考"]
  },
  {
    url: "https://abduzeedo.com",
    title: "Abduzeedo",
    description: "国际资深设计美学与视觉艺术灵感刊物，涵盖平面设计、3D 视觉、建筑、工业造型与摄影艺术深度解析。",
    categoryId: "reg-design-blogs",
    tags: ["设计美学", "视觉艺术", "灵感博客", "工业设计"]
  },
  {
    url: "https://www.nngroup.com",
    title: "Nielsen Norman Group (NN/g)",
    description: "全球人机工程与用户体验可用性研究领域的黄金标准机构，提供严谨权威的用户研究实证方法与 UX 指南。",
    categoryId: "reg-user-research",
    tags: ["用户体验", "可用性测试", "UX研究", "人机工程"]
  },
  {
    url: "https://maze.co",
    title: "Maze",
    description: "现代化敏捷用户研究与无代码可用性测试平台，快速收集真实用户原型交互反馈与定量定性调研指标。",
    categoryId: "reg-user-research",
    tags: ["可用性测试", "用户研究", "原型反馈", "UX度量"]
  },

  // 2. 效率办公 / reg-office-productivity
  {
    url: "https://coda.io",
    title: "Coda",
    description: "融合文档灵活性、表格数据结构与无代码自动化的新一代团队全合一协作平台，让文档如软件般运行。",
    categoryId: "reg-collaborative-docs",
    tags: ["协作文档", "多维数据", "团队协同", "无代码"]
  },
  {
    url: "https://slite.com",
    title: "Slite",
    description: "专为现代分布式敏捷团队打造的 AI 驱动团队知识库与结构化协作文档空间，知识沉淀井然有序。",
    categoryId: "reg-collaborative-docs",
    tags: ["AI知识库", "团队文档", "远程协作"]
  },
  {
    url: "https://www.craft.do",
    title: "Craft Docs",
    description: "以极致排版美学与丝滑原生体验著称的结构化文档工具，支持优雅卡片排版、反向链接与一键网页分享。",
    categoryId: "reg-collaborative-docs",
    tags: ["结构化笔记", "排版美学", "团队文档"]
  },
  {
    url: "https://meet.google.com",
    title: "Google Meet",
    description: "谷歌官方轻量级高画质多端视频会议系统，支持无缝日历调度、实时字幕转录与安全加密连线。",
    categoryId: "reg-video-conferencing",
    tags: ["视频会议", "谷歌办公", "远程沟通", "云会议"]
  },
  {
    url: "https://www.microsoft.com/zh-cn/microsoft-teams/group-chat-software",
    title: "Microsoft Teams",
    description: "微软企业级全链路协同平台，深度整合高清音视频会议、分组讨论、屏幕协同与 Office 365 办公套件。",
    categoryId: "reg-video-conferencing",
    tags: ["企业会议", "团队协作", "微软办公", "群聊协作"]
  },

  // 3. 学习成长 / reg-learning-growth
  {
    url: "https://www.fenbi.com",
    title: "粉笔网",
    description: "中国知名公职招录与职业技能在线题库模考平台，提供数十万道历年真题精准解析、智能组卷与大数据模考。",
    categoryId: "reg-question-banks",
    tags: ["公考题库", "智能刷题", "历年真题", "职业备考"]
  },
  {
    url: "https://v.huatu.com",
    title: "华图在线",
    description: "华图教育旗下公考、事业单位与教师考编智能题库刷题平台，提供名师视频解题与高频考点专项突破。",
    categoryId: "reg-question-banks",
    tags: ["题库刷题", "华图公考", "专项练习"]
  },
  {
    url: "https://open.163.com",
    title: "网易公开课",
    description: "汇聚哈佛大学、耶鲁大学、TED 等全球名校顶尖公开课与通识讲座的优质公益知识学习平台。",
    categoryId: "reg-open-courses",
    tags: ["名校公开课", "TED演讲", "通识教育", "国际课程"]
  },
  {
    url: "https://www.icourse163.org",
    title: "中国大学MOOC",
    description: "教育部爱课程中心与网易联合推出的国家精品在线开放课程平台，拥有全国百所顶尖 985/211 高校认证课程。",
    categoryId: "reg-open-courses",
    tags: ["大学课程", "国家精品课", "学分认证", "MOOC"]
  },
  {
    url: "https://www.edx.org",
    title: "edX",
    description: "由哈佛大学与麻省理工学院 (MIT) 联合创立的非营利全球在线高等教育平台，提供权威微硕士与专业证书体系。",
    categoryId: "reg-open-courses",
    tags: ["全球公开课", "名校证书", "计算机课程", "在线学位"]
  },
  {
    url: "https://www.codemao.cn",
    title: "编程猫",
    description: "中国知名少儿图形化编程与计算思维学习平台，专为青少年打造的可视化积木编程与创客算法启蒙空间。",
    categoryId: "reg-kids-and-hobbies",
    tags: ["少儿编程", "图形化编程", "逻辑思维", "青少年创客"]
  },
  {
    url: "https://kaishu.com",
    title: "凯叔讲故事",
    description: "专注儿童优质有声国学、经典名著演播与科学通识故事的亲子数字内容品牌，守护孩子快乐成长。",
    categoryId: "reg-kids-and-hobbies",
    tags: ["儿童故事", "国学启蒙", "亲子阅读", "有声绘本"]
  },
  {
    url: "https://basic.smartedu.cn",
    title: "国家中小学智慧教育平台",
    description: "教育部官方打造的全国中小学全学段全学科优质数字化教学资源中心，覆盖名师精品网课与数字化教材。",
    categoryId: "reg-school-subjects",
    tags: ["官方教育", "中小学教材", "精品网课", "学科辅导"]
  },
  {
    url: "https://www.jyeoo.com",
    title: "菁优网",
    description: "专业的中小学全学科数理化生题库与试卷搜索引擎，提供海量中考高考真题题型归类与名师解题思路。",
    categoryId: "reg-school-subjects",
    tags: ["学科题库", "中高考试卷", "解题技巧", "中小学备课"]
  },

  // 4. 学术科研 / reg-academic-research
  {
    url: "https://fact.qq.com",
    title: "腾讯新闻较真查证平台",
    description: "腾讯旗下权威科学事实查证与网络谣言辟谣平台，联袂数百位行业专家对医疗健康与社会热点进行严谨核查。",
    categoryId: "reg-fact-checking",
    tags: ["事实核查", "辟谣平台", "科学求证", "腾讯较真"]
  },
  {
    url: "https://www.snopes.com",
    title: "Snopes",
    description: "全球历史最悠久、最知名的事实核查智库网站，对全球互联网流传的都市怪谈、突发新闻与虚假宣传进行深度溯源。",
    categoryId: "reg-fact-checking",
    tags: ["国际核查", "事实查验", "反虚假信息", "独立调查"]
  },

  // 5. 资讯媒体 / reg-news-and-media
  {
    url: "https://www.caixin.com",
    title: "财新网",
    description: "以独立客观和深度调查著称的中国高影响力财经新闻旗舰，在金融监管、宏观政策与重大商业事件中具备公信力。",
    categoryId: "reg-longform-journalism",
    tags: ["深度调查", "财经新闻", "政经分析", "权威报道"]
  },
  {
    url: "https://www.jiemian.com/special/zhengwugushi.html",
    title: "界面新闻·正午故事",
    description: "中国当代非虚构写作标杆特稿栏目，专注于挖掘时代洪流中普通人的个体命运与微观社会生活变迁。",
    categoryId: "reg-longform-journalism",
    tags: ["非虚构特稿", "深度叙事", "社会纪实", "正午故事"]
  },
  {
    url: "https://www.zaobao.com",
    title: "联合早报",
    description: "新加坡报业控股旗舰华文主流大报，以客观中立的国际视野观察中国与亚太政经大局。",
    categoryId: "reg-international-media",
    tags: ["国际时政", "新加坡媒体", "亚太观察", "权威视野"]
  },
  {
    url: "https://www.reuters.com",
    title: "路透社 (Reuters)",
    description: "全球顶尖综合通讯社，为全球金融机构与媒体提供毫秒级突发财经行情快讯与全球地缘政治报道。",
    categoryId: "reg-international-media",
    tags: ["国际通讯社", "全球快讯", "外媒视角", "金融资讯"]
  },
  {
    url: "https://www.eastday.com",
    title: "东方网",
    description: "上海最具影响力的重点综合性新闻门户网站，深度覆盖长三角一体化发展、上海民生问政与市民生活资讯。",
    categoryId: "reg-local-news",
    tags: ["上海本地", "长三角资讯", "民生问政", "区域门户"]
  },
  {
    url: "https://www.southcn.com",
    title: "南方网",
    description: "广东省委机关网与华南权威主流综合网络媒体，立足粤港澳大湾区改革前沿，提供权威政务与经济民生报道。",
    categoryId: "reg-local-news",
    tags: ["广东新闻", "大湾区动态", "政经民生", "南方报业"]
  },
  {
    url: "https://www.toutiao.com",
    title: "今日头条",
    description: "基于先进智能算法推荐的全品类信息流内容资讯平台，汇聚数万权威媒体与自媒体作者全天候新闻热点。",
    categoryId: "reg-news-aggregators",
    tags: ["资讯聚合", "算法推荐", "热点速览", "今日头条"]
  },
  {
    url: "https://news.google.com",
    title: "Google 新闻 (Google News)",
    description: "谷歌全球综合新闻聚合服务，智能汇集并对比不同媒体对同一突发事件的多重视角与深度报道脉络。",
    categoryId: "reg-news-aggregators",
    tags: ["新闻聚合", "全球热点", "多源对比", "谷歌服务"]
  },
  {
    url: "https://www.jiqizhixin.com",
    title: "机器之心",
    description: "专业前沿人工智能与尖端计算科技独立媒体，持续跟踪全球 AI 学术顶会、大模型技术演进与产业落地范式。",
    categoryId: "reg-independent-media",
    tags: ["人工智能", "前沿科技", "AI论文", "科技媒体"]
  },
  {
    url: "https://www.huxiu.com",
    title: "虎嗅网",
    description: "具备独到商业洞察与深度批判视角的商业科技媒体，聚焦商业新模式、科技独角兽与年轻新消费群体。",
    categoryId: "reg-independent-media",
    tags: ["商业评论", "科技独角兽", "新商业", "虎嗅"]
  },
  {
    url: "https://ourworldindata.org",
    title: "Our World in Data",
    description: "牛津大学领衔的全球权威开放数据研究与可视化平台，用交互式宏观数据图表呈现人类贫困、疾病与气候历史演变。",
    categoryId: "reg-data-journalism",
    tags: ["数据新闻", "交互图表", "全球指标", "牛津大学"]
  },
  {
    url: "https://pudding.cool",
    title: "The Pudding",
    description: "享誉全球的视觉数据新闻实验媒体，用生动绝伦的动态数据可视化与交互式微交互讲述流行文化与社会议题。",
    categoryId: "reg-data-journalism",
    tags: ["视觉数据", "动态图表", "交互叙事", "文化数据"]
  },
  {
    url: "https://www.newrank.cn",
    title: "新榜",
    description: "中国新媒体内容产业大数据服务领军平台，提供公众号、抖音、小红书全平台爆款内容监测与综合影响力排行。",
    categoryId: "reg-media-toolkit",
    tags: ["新媒体数据", "流量榜单", "内容分析", "营销工具"]
  },
  {
    url: "https://xiumi.us",
    title: "秀米",
    description: "广受新媒体编辑与设计师喜爱的微信排版工具与原创图文 SVG 排版神器，提供丰富动态交互排版模板。",
    categoryId: "reg-media-toolkit",
    tags: ["微信排版", "SVG排版", "长图文设计", "新媒体工具"]
  },

  // 6. 内容创作 / reg-content-creation
  {
    url: "https://www.ccopyright.com.cn",
    title: "中国版权保护中心",
    description: "国家法定软件著作权登记、文字美术作品版权登记、数字版权存证与版权法律咨询官方门户。",
    categoryId: "reg-copyright-and-compliance",
    tags: ["软件著作权", "版权登记", "官方存证", "知识产权"]
  },
  {
    url: "https://www.12377.cn",
    title: "中国互联网违法和不良信息举报中心",
    description: "中央网信办主办的全国互联网违法与网络侵权官方统一举报受理门户，维护清朗健康的网络生态环境。",
    categoryId: "reg-copyright-and-compliance",
    tags: ["官方举报", "网络合规", "侵权维权", "网信办"]
  },
  {
    url: "https://star.toutiao.com",
    title: "巨量星图",
    description: "抖音集团旗下官方达人内容营销与创作交易变现管理平台，高效连接品牌主广告商单与高价值优质创作者。",
    categoryId: "reg-monetization-and-mcn",
    tags: ["抖音星图", "商业商单", "创作者变现", "达人营销"]
  },
  {
    url: "https://channels.weixin.qq.com",
    title: "微信视频号创作者中心",
    description: "腾讯微信官方视频号内容创作管理平台，提供短视频发布、直播带货、流量变现与粉丝互动全景数据。",
    categoryId: "reg-monetization-and-mcn",
    tags: ["微信视频号", "创作者后台", "直播带货", "腾讯官方"]
  },

  // 7. 职业招聘 / reg-jobs-and-career
  {
    url: "https://www.yupao.com",
    title: "鱼泡网",
    description: "国内领先的蓝领工程建筑、装修施工与技工师傅精准求职招聘撮合平台，实名招工发薪更有保障。",
    categoryId: "reg-blue-collar-and-gig",
    tags: ["蓝领招聘", "建筑工程", "技工招工", "灵活用工"]
  },
  {
    url: "https://www.jianzhimao.com",
    title: "兼职猫",
    description: "知名安全可靠的大学生兼职与灵活用工智能匹配平台，岗位经过严格审核，保障用工双方真实权益。",
    categoryId: "reg-blue-collar-and-gig",
    tags: ["兼职招聘", "大学生求职", "灵活用工", "副业机会"]
  },
  {
    url: "http://www.scs.gov.cn",
    title: "国家公务员局",
    description: "中共中央组织部管理的主管公务员工作的副部级国家局官方门户，权威发布中央机关国家公务员考录政策与招考公告。",
    categoryId: "reg-civil-service-exams",
    tags: ["国考报名", "公考政策", "官方公告", "公职招考"]
  },
  {
    url: "https://www.offcn.com",
    title: "中公教育",
    description: "国内资深综合性公职就业培训与考试辅导平台，深耕国考省考、选调生、教师招录与三支一扶备考领域。",
    categoryId: "reg-civil-service-exams",
    tags: ["公职培训", "中公公考", "备考资料", "招录指南"]
  },
  {
    url: "https://maimai.cn",
    title: "脉脉",
    description: "中国极具影响力的真实职场社交平台，拓展高质量同行人脉、洞察行业热议动态与寻找大厂跳槽机遇。",
    categoryId: "reg-professional-networking",
    tags: ["职场社交", "同行交流", "内推招聘", "脉脉"]
  },
  {
    url: "https://www.linkedin.cn",
    title: "领英中国 (InJobs)",
    description: "全球最大职场社交巨头领英专为中国职场人打造的职业发展与招聘平台，链接全球跨国名企与海归人才机会。",
    categoryId: "reg-professional-networking",
    tags: ["国际外企", "职场招聘", "海归求职", "领英"]
  },
  {
    url: "https://www.acmcoder.com",
    title: "赛码网",
    description: "中国一线互联网名企指定专业在线技术笔试与真实编程测评服务商，提供各大名企校招上机真题环境模拟。",
    categoryId: "reg-interview-prep",
    tags: ["编程笔试", "名企校招", "算法测评", "模拟机考"]
  },
  {
    url: "https://www.mianshiya.com",
    title: "面试鸭",
    description: "专为程序员量身打造的高效刷题与求职神器，收录百度、腾讯、阿里等头部大厂最新真实技术面试真题与深度题解。",
    categoryId: "reg-interview-prep",
    tags: ["技术面试", "程序员刷题", "大厂面经", "面试题库"]
  },
  {
    url: "https://www.levels.fyi",
    title: "Levels.fyi",
    description: "全球高科技行业最受信任的工程师、产品与技术专家薪酬透明度数据库，提供真实薪资对比与各级别对标体系。",
    categoryId: "reg-salary-insights",
    tags: ["大厂薪资", "职级对标", "薪酬透明", "海外高薪"]
  },
  {
    url: "https://www.jobui.com",
    title: "职友集",
    description: "中国本土真实薪酬查询与雇主口碑评价大数据网站，汇总全国各行业真实员工收入水平与公司福利透视。",
    categoryId: "reg-salary-insights",
    tags: ["薪酬查询", "公司评价", "行业工资", "职场口碑"]
  },
  {
    url: "https://www.16personalities.com",
    title: "16Personalities",
    description: "全球广受认可的免费 MBTI 经典性格心理类型测评，深入剖析个人优势潜能、人际交往风格与最佳匹配职业航道。",
    categoryId: "reg-career-planning",
    tags: ["MBTI性格", "心理测试", "职业规划", "性格分析"]
  },
  {
    url: "http://www.12333.gov.cn",
    title: "12333 人社公共服务平台",
    description: "中华人民共和国人力资源和社会保障部官方全国公共服务平台，提供个人社保权益、医保转接与劳动争议维权入口。",
    categoryId: "reg-labor-rights",
    tags: ["人社服务", "社保查询", "劳动权益", "政务官方"]
  },
  {
    url: "http://www.12348.gov.cn",
    title: "中国法律服务网 (12348)",
    description: "司法部主办的官方公益法律服务平台，为劳动者提供免费在线法律咨询、劳动纠纷调解与法律援助申请入口。",
    categoryId: "reg-labor-rights",
    tags: ["法律援助", "劳动纠纷", "公益法律", "司法部"]
  },

  // 8. 金融财经 / reg-finance-and-investing
  {
    url: "https://www.chinalife.com.cn",
    title: "中国人寿",
    description: "中国特大型国有金融保险集团，连续多年入选财富世界500强，提供寿险、健康医疗险与养老规划综合服务。",
    categoryId: "reg-insurance",
    tags: ["中国人寿", "商业保险", "健康险", "养老金"]
  },
  {
    url: "https://www.picc.com",
    title: "中国人保 (PICC)",
    description: "历史悠久的新中国第一家综合性保险公司，亚洲最大的非寿险财险公司，覆盖汽车险、企业财产险与家财保障。",
    categoryId: "reg-insurance",
    tags: ["中国人保", "汽车保险", "财产险", "央企金融"]
  },
  {
    url: "https://open.alipay.com",
    title: "支付宝开放平台",
    description: "蚂蚁集团旗下支付宝数字支付、刷脸付、商家收单与跨境清算官方接入系统，连接海量商家与数字化经营能力。",
    categoryId: "reg-payments-and-wallets",
    tags: ["移动支付", "支付宝", "商户收款", "数字金融"]
  },
  {
    url: "https://pay.weixin.qq.com",
    title: "微信支付商户平台",
    description: "腾讯官方微信支付商业服务中心，提供小程序扫码支付、APP 移动支付、跨境电商收单及资金自动化结算。",
    categoryId: "reg-payments-and-wallets",
    tags: ["微信支付", "商户收款", "移动钱包", "腾讯金融"]
  },
  {
    url: "https://www.pbccrc.org.cn",
    title: "中国人民银行征信中心",
    description: "中国人民银行直属事业单位，建立全国统一的个人及企业信用信息基础数据库，官方查询个人信用报告权威入口。",
    categoryId: "reg-credit-and-reports",
    tags: ["央行征信", "信用报告", "征信查询", "金融信用"]
  },
  {
    url: "https://www.creditchina.gov.cn",
    title: "信用中国",
    description: "国家发展改革委主管的全国社会信用体系建设官方门户，公示全国统一的企业社会信用代码、守信联合激励与失信惩戒名单。",
    categoryId: "reg-credit-and-reports",
    tags: ["社会信用", "失信查询", "信用代码", "发改委"]
  },
  {
    url: "https://www.chinatax.gov.cn",
    title: "国家税务总局",
    description: "国家税务总局官方门户，权威公布最新国家个税专项附加扣除、企业所得税减免政策与纳税信用等级评定。",
    categoryId: "reg-tax-and-invoicing",
    tags: ["国家税务", "个税申报", "税收政策", "税务局"]
  },
  {
    url: "https://etax.chinatax.gov.cn",
    title: "国家税务总局电子发票服务平台",
    description: "全国统一规范的全面数字化电子发票开具、发票真伪查验、发票抵扣与税务发票管理综合服务系统。",
    categoryId: "reg-tax-and-invoicing",
    tags: ["数电发票", "发票查验", "发票开具", "电子税务"]
  },
  {
    url: "https://www.chinamoney.com.cn",
    title: "中国外汇交易中心",
    description: "中国人民银行直属机构，全国银行间同业拆借中心与人民币汇率中间价及基准利率 LPR 官方唯一发布平台。",
    categoryId: "reg-forex-and-metals",
    tags: ["人民币汇率", "银行间外汇", "央行基准", "LPR利率"]
  },
  {
    url: "https://www.sge.com.cn",
    title: "上海黄金交易所",
    description: "经国务院批准、中国人民银行组建的中国唯一合法从事贵金属交易的国家级市场，发布上海金基准价与实物交割走势。",
    categoryId: "reg-forex-and-metals",
    tags: ["上海黄金", "实物金条", "白银交易", "贵金属现货"]
  },
  {
    url: "https://www.shfe.com.cn",
    title: "上海期货交易所",
    description: "中国五大期货交易所之一，组织铜、铝、原油等战略大宗工业品及贵金属期货与期权挂牌交易，管理全国大宗价格发现。",
    categoryId: "reg-futures-and-derivatives",
    tags: ["期货交易", "大宗商品", "原油期货", "期权衍生品"]
  },
  {
    url: "https://www.cffex.com.cn",
    title: "中国金融期货交易所",
    description: "中国专门从事金融衍生产品交易的法人期货交易所，组织股指期货、国债期货与股指期权交易及结算风险管理。",
    categoryId: "reg-futures-and-derivatives",
    tags: ["股指期货", "国债期货", "金融衍生品", "中金所"]
  },
  {
    url: "https://coinmarketcap.com",
    title: "CoinMarketCap",
    description: "全球引用量最广泛的加密资产市值排名与币价走势追踪平台，提供全球各交易所交易量深度与历史行情走势。",
    categoryId: "reg-crypto-and-web3",
    tags: ["加密货币", "行情追踪", "市值排名", "区块链"]
  },
  {
    url: "https://etherscan.io",
    title: "Etherscan",
    description: "以太坊 (Ethereum) 生态公认最权威的区块链浏览器，提供实时的链上交易记录查询、智能合约代码验证与 Gas 监测。",
    categoryId: "reg-crypto-and-web3",
    tags: ["以太坊", "区块浏览器", "链上数据", "智能合约"]
  },
  {
    url: "https://www.chinatrust.com.cn",
    title: "中国信托登记有限责任公司",
    description: "经国务院同意设立的全国信托产品集中登记、信息披露与资产托管的行业基础设施与监管自律平台。",
    categoryId: "reg-trusts-and-am",
    tags: ["信托登记", "信托产品", "资产管理", "官方托管"]
  },
  {
    url: "https://www.cbex.com.cn",
    title: "北京产权交易所",
    description: "全国领先的综合性要素交易市场与央企国有资产转让法定挂牌交易平台，承担公共资源处置与股权转让流通。",
    categoryId: "reg-property-exchanges",
    tags: ["产权交易", "国有资产", "股权转让", "要素市场"]
  },
  {
    url: "https://zc.taobao.com",
    title: "阿里资产 (阿里拍卖)",
    description: "阿里巴巴旗下全球知名的网络资产拍卖与要素交易平台，汇聚全国各级法院司法拍卖房产、公车及商业破产重整资产。",
    categoryId: "reg-property-exchanges",
    tags: ["司法拍卖", "资产处置", "法拍房", "阿里资产"]
  },

  // 9. 影音娱乐 / reg-entertainment
  {
    url: "https://www.douyin.com",
    title: "抖音",
    description: "中国领先的国民级原创短视频与记录美好生活的创作社区，汇聚海量生活技能、幽默趣味与音乐文化。",
    categoryId: "reg-short-video",
    tags: ["短视频", "抖音", "国民应用", "视频社区"]
  },
  {
    url: "https://www.ixigua.com",
    title: "西瓜视频",
    description: "字节跳动旗下高品质中长视频创作与播放平台，汇聚大量深度科普、电影解说、旅行纪录与自制综艺。",
    categoryId: "reg-short-video",
    tags: ["中长视频", "视频创作", "科普纪实", "西瓜视频"]
  },
  {
    url: "https://www.douyu.com",
    title: "斗鱼直播",
    description: "国内领先的综合游戏电竞赛事直播平台，拥有超多头部电竞职业选手入驻与英雄联盟、DOTA2 官方赛事直播。",
    categoryId: "reg-live-streaming",
    tags: ["游戏直播", "电竞赛事", "弹幕互动", "斗鱼"]
  },
  {
    url: "https://www.huya.com",
    title: "虎牙直播",
    description: "以游戏直播为主的高清互动直播平台，覆盖热门手游端游电竞赛事、主机单机娱乐与户外综合才艺秀场。",
    categoryId: "reg-live-streaming",
    tags: ["游戏直播", "电竞解说", "高清直播", "虎牙"]
  },
  {
    url: "https://www.qingting.fm",
    title: "蜻蜓FM",
    description: "汇聚全国上千家权威广播电台实时流、高品质有声书、相声评书与名家人文音频节目的知名网络收音机平台。",
    categoryId: "reg-radio-and-broadcast",
    tags: ["网络电台", "广播收听", "有声书", "音频流"]
  },
  {
    url: "https://www.radio.cn",
    title: "云听 (中央广播电视总台)",
    description: "中央广播电视总台高品质国家级音频新媒体旗舰平台，提供国家广播电台高清原声直播、权威新闻演播与广播剧。",
    categoryId: "reg-radio-and-broadcast",
    tags: ["央视音频", "国家电台", "官方广播", "高保真音频"]
  },
  {
    url: "https://subhd.tv",
    title: "SubHD",
    description: "国内极具人气的高品质影视字幕分享与检索社区，聚合各大字幕组作品，支持精细化多语言双语字幕下载。",
    categoryId: "reg-subtitle-communities",
    tags: ["影视字幕", "双语字幕", "字幕下载", "SubHD"]
  },
  {
    url: "https://secure.assrt.net",
    title: "伪射手网 (ASSRT)",
    description: "传承经典射手网开源精神的纯粹影视剧字幕分享与检索站点，收录全球数万部经典电影与美剧高清匹配字幕。",
    categoryId: "reg-subtitle-communities",
    tags: ["射手字幕", "开源字幕", "电影字幕", "字幕检索"]
  },
  {
    url: "https://www.damai.cn",
    title: "大麦网",
    description: "中国现场娱乐综合票务营销平台，提供全国顶流明星巡回演唱会、音乐节、话剧歌剧与体育赛事实名制订票。",
    categoryId: "reg-event-ticketing",
    tags: ["演唱会门票", "话剧演出", "现场票务", "大麦网"]
  },
  {
    url: "https://www.showstart.com",
    title: "秀动网",
    description: "太合音乐集团旗下专注独立音乐演出、Livehouse 巡演、摇滚与电音现场的专业音乐现场票务服务平台。",
    categoryId: "reg-event-ticketing",
    tags: ["Livehouse", "独立音乐", "摇滚巡演", "演出购票"]
  },
  {
    url: "https://jlp.cctv.com",
    title: "央视网纪录片频道",
    description: "中央广播电视总台纪录片官方门户，收录《舌尖上的中国》《航拍中国》《河西走廊》等国家级震撼高分纪录片。",
    categoryId: "reg-documentaries",
    tags: ["央视纪录片", "人文历史", "自然地理", "高分佳作"]
  },
  {
    url: "https://www.bilibili.com/documentary",
    title: "哔哩哔哩纪录片",
    description: "年轻人深爱的高口碑中外纪录片汇聚地，拥有 BBC、国家地理合作版权与丰富自制人文美食高分纪录佳作。",
    categoryId: "reg-documentaries",
    tags: ["B站纪录片", "自然科学", "人文美食", "弹幕交流"]
  },
  {
    url: "https://www.netflix.com",
    title: "Netflix",
    description: "全球领先的流媒体娱乐点播巨头，提供海量备受好评的原创电视剧、电影、动漫与 4K 杜比视界高品质影视节目。",
    categoryId: "reg-overseas-streaming",
    tags: ["Netflix", "流媒体", "4K影视", "海外剧集"]
  },
  {
    url: "https://www.disneyplus.com",
    title: "Disney+",
    description: "华特迪士尼官方全平台流媒体服务，囊括迪士尼经典动画、漫威超级英雄电影、皮克斯与星球大战独家影像。",
    categoryId: "reg-overseas-streaming",
    tags: ["迪士尼", "漫威宇宙", "皮克斯", "海外点播"]
  },
  {
    url: "https://www.maoyan.com",
    title: "猫眼电影",
    description: "中国领先的互联网娱乐服务平台，提供全国所有主流影院实时放映排片、在线极速选座购票与权威实时电影票房榜。",
    categoryId: "reg-cinema-ticketing",
    tags: ["电影选座", "影院排片", "实时票房", "猫眼"]
  },
  {
    url: "https://www.taopiaopiao.com",
    title: "淘票票",
    description: "阿里巴巴旗下在线电影购票选座平台，深度整合影城会员卡福利、万达影城特惠与真实观影影迷打分社区。",
    categoryId: "reg-cinema-ticketing",
    tags: ["在线购票", "电影优惠", "选座买票", "淘票票"]
  },
  {
    url: "https://movie.douban.com",
    title: "豆瓣电影",
    description: "中文互联网最具公信力与文化底蕴的电影评分、大众观影记录与深度专业影评文化交流社区。",
    categoryId: "reg-film-criticism",
    tags: ["豆瓣评分", "深度影评", "观影记录", "影迷社区"]
  },
  {
    url: "https://www.rottentomatoes.com",
    title: "烂番茄 (Rotten Tomatoes)",
    description: "全球著名的影视评论与打分聚合网站，根据全球数百位职业认证影评人的专业好评率计算出权威的'新鲜度'指标。",
    categoryId: "reg-film-criticism",
    tags: ["烂番茄", "新鲜度", "影评聚合", "好莱坞评论"]
  },

  // 10. 游戏电竞 / reg-gaming-and-esports
  {
    url: "https://www.taptap.cn",
    title: "TapTap",
    description: "高质量手游玩家发现好游戏的首选社区与无分成官方游戏分发平台，提供纯粹真实玩家打分与原汁原味评测。",
    categoryId: "reg-mobile-game-channels",
    tags: ["手游社区", "TapTap", "新游预约", "无分成渠道"]
  },
  {
    url: "https://www.yxhb.cn",
    title: "好游快爆",
    description: "专注精品手游先行测试服预约、玩家真实体验打分与深度独家游戏图文视频通关攻略的玩家掌上实用工具。",
    categoryId: "reg-mobile-game-channels",
    tags: ["好游快爆", "手游预约", "测试服", "游戏工具"]
  },
  {
    url: "https://www.wanplus.cn",
    title: "玩加电竞",
    description: "中国专业电竞赛事大数据与战队信息平台，全面追踪英雄联盟 LPL、王者荣耀 KPL 与各大国际联赛对局数据。",
    categoryId: "reg-esports-events",
    tags: ["电竞数据", "LPL赛事", "战队排行", "赛事赛程"]
  },
  {
    url: "https://www.hltv.org",
    title: "HLTV",
    description: "全球 CS2/CS:GO 顶级职业电竞赛事第一网站，提供全球战队战力排行榜、各大 Major 淘汰赛对阵与选手详细 Rating 指标。",
    categoryId: "reg-esports-events",
    tags: ["CSGO电竞", "HLTV排名", "Major赛事", "选手数据"]
  },
  {
    url: "https://www.gamersky.com",
    title: "游民星空",
    description: "中国具有广泛影响力的单机游戏综合门户，提供权威前沿的新作首发评测、保姆级全流程图文攻略与全机种中文补丁。",
    categoryId: "reg-game-wikis-and-data",
    tags: ["单机游戏", "游戏攻略", "游民星空", "新游评测"]
  },
  {
    url: "https://www.3dmgame.com",
    title: "3DMGAME",
    description: "国内资深综合性单机与主机游戏媒体，为全球中文玩家提供海量新作爆料、Mod 工具、汉化补丁与玩家心得讨论圈。",
    categoryId: "reg-game-wikis-and-data",
    tags: ["3DM游戏", "游戏汉化", "Mod社区", "单机评测"]
  },
  {
    url: "https://unity.com",
    title: "Unity",
    description: "全球应用最广泛的实时 3D 互动内容创作引擎，支撑全球过半数移动游戏、AR/VR 应用与次世代工业数字孪生。",
    categoryId: "reg-engines-and-tools",
    tags: ["游戏引擎", "Unity开发", "跨平台开发", "3D引擎"]
  },
  {
    url: "https://www.unrealengine.com",
    title: "Unreal Engine (虚幻引擎)",
    description: "Epic Games 研发的享誉全球的次世代实时 3D 图形引擎，以 Nanite 与 Lumen 核心技术引领电影级画质与 AAA 大作标杆。",
    categoryId: "reg-engines-and-tools",
    tags: ["虚幻引擎", "UE5", "AAA大作", "实时渲染"]
  },
  {
    url: "https://godotengine.org",
    title: "Godot Engine",
    description: "完全免费开源的现代化跨平台 2D 与 3D 游戏开发引擎，架构轻盈高效、无版税束缚，深受独立游戏开发者推崇。",
    categoryId: "reg-engines-and-tools",
    tags: ["开源引擎", "Godot", "轻量游戏开发", "独立游戏"]
  },
  {
    url: "https://assetstore.unity.com",
    title: "Unity Asset Store",
    description: "Unity 官方庞大的数字资产商店，提供经过官方认证的海量 3D 游戏模型、环境场景包、物理特效与开发插件。",
    categoryId: "reg-game-art-assets",
    tags: ["游戏资产", "Unity商店", "3D模型包", "游戏插件"]
  },
  {
    url: "https://opengameart.org",
    title: "OpenGameArt",
    description: "非营利性的全球开源游戏美术资源库，免费提供遵从 GPL/CC 协议的 2D 精灵图、3D 贴图与免版税原创背景音效。",
    categoryId: "reg-game-art-assets",
    tags: ["开源美术", "精灵图", "免费音效", "游戏素材"]
  },
  {
    url: "https://itch.io",
    title: "itch.io",
    description: "全球独立游戏开发者最向往的开放式游戏分发与创意实验平台，定期举办数百场全球 Game Jam 游戏创作狂欢活动。",
    categoryId: "reg-indie-games",
    tags: ["独立游戏", "GameJam", "实验游戏", "开放分发"]
  },
  {
    url: "https://indienova.com",
    title: "indienova (独立日)",
    description: "中国极具情怀与学术氛围的独立游戏开发综合社区，涵盖前沿技术译文、开发者深度日志与本土独立作品展播。",
    categoryId: "reg-indie-games",
    tags: ["中国独立游戏", "开发者手记", "游戏设计", "indienova"]
  },
  {
    url: "https://www.chinajoy.net",
    title: "ChinaJoy (中国国际数码互动娱乐展览会)",
    description: "全球数字娱乐领域最具知名度与影响力的年度国际展会，汇聚全球数百家顶尖游戏大厂首秀与前沿科技软硬件。",
    categoryId: "reg-game-conventions",
    tags: ["ChinaJoy", "游戏展会", "国际数码展", "产业峰会"]
  },
  {
    url: "https://gdconf.com",
    title: "GDC (游戏开发者大会)",
    description: "全球规模最大、历史最悠久的游戏行业专业开发者峰会，汇集全球顶级工作室主程与主策分享尖端架构与设计哲学。",
    categoryId: "reg-game-conventions",
    tags: ["GDC", "开发者大会", "技术演讲", "行业标杆"]
  },

  // 11. 消费生活 / reg-consumer-life
  {
    url: "https://www.poizon.com",
    title: "得物 (Poizon)",
    description: "年轻一代潮流网购与潮流装备首选电商平台，首创'先鉴别，后发货'服务模式，提供正品潮流球鞋与潮玩数码。",
    categoryId: "reg-fashion-and-beauty",
    tags: ["得物", "潮流网购", "正品鉴别", "球鞋潮牌"]
  },
  {
    url: "https://www.vip.com",
    title: "唯品会",
    description: "中国知名品牌正品特卖电商门户，深度合作数万全球知名时尚服饰、美妆个护与轻奢大牌，提供专属深度折扣折扣特卖。",
    categoryId: "reg-fashion-and-beauty",
    tags: ["唯品会", "品牌特卖", "服饰折后", "正品美妆"]
  },
  {
    url: "https://www.meituan.com",
    title: "美团",
    description: "中国领先的生活服务电子商务平台，覆盖餐饮美食外卖准时到家、周边酒店团购、休闲娱乐与同城即时零售服务。",
    categoryId: "reg-grocery-and-delivery",
    tags: ["美团外卖", "本地生活", "同城配送", "团购优惠"]
  },
  {
    url: "https://www.ele.me",
    title: "饿了么",
    description: "阿里巴巴本地生活旗下领先的准时达外卖订餐与即时零售配送平台，全天候满足用户足不出户的美食与生活需求。",
    categoryId: "reg-grocery-and-delivery",
    tags: ["饿了么", "外卖订餐", "即时零售", "本地生活"]
  },
  {
    url: "https://www.freshippo.com",
    title: "盒马鲜生",
    description: "阿里巴巴旗下新零售标杆生鲜超市，主打原产地直采活鲜水产、无公害高品质果蔬食材与门店周围半小时极速达冷链。",
    categoryId: "reg-grocery-and-delivery",
    tags: ["盒马鲜生", "高品质生鲜", "产地直采", "极速到家"]
  },
  {
    url: "https://pages.tmall.com/wow/z/import/default/index",
    title: "天猫国际",
    description: "阿里巴巴旗下跨境电商官方直营进口购物平台，原产国保税仓直接发货，一站式海淘海外原装正品大牌好物。",
    categoryId: "reg-cross-border-shopping",
    tags: ["天猫国际", "跨境海淘", "保税直发", "海外正品"]
  },
  {
    url: "https://www.amazon.co.jp",
    title: "日本亚马逊 (Amazon JP)",
    description: "日本规模最大的综合性网络零售巨头，海量日本原装本土美妆、数码家电、动漫手办直邮服务，支持银联支付。",
    categoryId: "reg-cross-border-shopping",
    tags: ["日本海淘", "亚马逊日亚", "直邮中国", "海外购物"]
  },
  {
    url: "https://www.manmanbuy.com",
    title: "慢慢买",
    description: "中国老牌历史价格走势查询与全网商品实时比价导购平台，一键识破商家大促虚假降价，提供全网真实好价排行榜。",
    categoryId: "reg-deals-and-comparison",
    tags: ["历史价格", "比价工具", "优惠查询", "慢慢买"]
  },
  {
    url: "https://www.autohome.com.cn",
    title: "汽车之家",
    description: "中国访问量极大的汽车专业门户与车友论坛，提供全车型参数配置对比、经销商真实底价查询与千万车主真实用车口碑。",
    categoryId: "reg-car-and-driving",
    tags: ["汽车之家", "看车买车", "车型参数", "车主论坛"]
  },
  {
    url: "https://www.dongchedi.com",
    title: "懂车帝",
    description: "字节跳动旗下专业汽车信息与真实原创评测平台，提供极限环境严苛实测数据、真车拆解对比与 3D 看车体验。",
    categoryId: "reg-car-and-driving",
    tags: ["懂车帝", "汽车评测", "真车拆解", "底价查询"]
  },
  {
    url: "https://gab.122.gov.cn",
    title: "交通安全综合服务管理平台 (12123)",
    description: "公安部交通管理局全国统一互联网交通安全综合服务门户，提供驾驶人考试预约、机动车年检、违章扣分处理与罚款在线缴纳。",
    categoryId: "reg-car-and-driving",
    tags: ["交管12123", "违章处理", "驾考预约", "公安部官方"]
  },
  {
    url: "https://www.gotokeep.com",
    title: "Keep",
    description: "中国知名运动健身科技品牌，提供科学系统化的运动健身视频训练课程、跑步骑行户外轨迹记录与智能运动健康管理。",
    categoryId: "reg-sports-and-outdoor",
    tags: ["健身训练", "运动打卡", "跑步记录", "Keep"]
  },
  {
    url: "https://www.hupu.com",
    title: "虎扑",
    description: "中国高人气的综合体育赛事交流互动社区，全面覆盖 NBA 篮球实况、欧洲五大足球联赛、步行街论坛与运动装备评测。",
    categoryId: "reg-sports-and-outdoor",
    tags: ["虎扑体育", "NBA直播", "足球赛事", "步行街"]
  },
  {
    url: "https://www.8264.com",
    title: "8264 户外运动网",
    description: "中国资深户外运动与驴友探险门户，涵盖长途重装徒步路线路书、高山攀登滑雪技巧、露营装备深度评测与驴友结伴出行。",
    categoryId: "reg-sports-and-outdoor",
    tags: ["户外徒步", "露营装备", "登山探险", "驴友社区"]
  },
  {
    url: "https://www.boqii.com",
    title: "波奇网",
    description: "中国领先的一站式高品质宠物生活服务平台，涵盖正品猫粮狗粮用品商城、养宠科普健康百科与同城萌宠社区。",
    categoryId: "reg-pets-and-family",
    tags: ["波奇宠物", "正品宠粮", "养宠知识", "宠物健康"]
  },
  {
    url: "https://www.babytree.com",
    title: "宝宝树",
    description: "中国深受母婴家庭信赖的母婴育儿交流社区，汇集三甲医院儿科妇产专家专业解答，陪伴准妈妈与新生儿科学健康成长。",
    categoryId: "reg-pets-and-family",
    tags: ["母婴育儿", "孕期指南", "育儿社区", "宝宝树"]
  },

  // 12. 公共服务 / reg-public-services
  {
    url: "http://www.cncaprc.gov.cn",
    title: "全国老龄工作委员会办公室",
    description: "国家主管老龄事业发展战略与老龄政策协调的官方门户，权威公布涉老国家法规政策、居家适老化改造指南与老年优待服务。",
    categoryId: "reg-elderly-care",
    tags: ["老龄工作", "适老化改造", "国家政策", "银发经济"]
  },
  {
    url: "http://www.yanglaocn.com",
    title: "中国养老网",
    description: "国内领先的养老服务与养老产业综合门户，提供全国各省市高品质养老院、老年公寓、康养照护机构的客观评测与真实信息检索。",
    categoryId: "reg-elderly-care",
    tags: ["养老院查询", "医养结合", "老年看护", "中国养老"]
  },
  {
    url: "https://www.codac.org.cn",
    title: "中国人体器官捐献管理中心",
    description: "中国红十字会总会设立的国家人体器官捐献官方志愿登记与知识普及权威管理平台，推进阳光透明的生命接力关怀。",
    categoryId: "reg-end-of-life-care",
    tags: ["器官捐献", "生命关怀", "志愿登记", "红十字会"]
  },
  {
    url: "https://www.redcross.org.cn",
    title: "中国红十字会总会",
    description: "以保护人的生命和健康、弘扬人道博爱奉献精神为宗旨的国家红十字组织，开展应急人道救援与人道救助公益事业。",
    categoryId: "reg-end-of-life-care",
    tags: ["中国红十字会", "人道救援", "生命救护", "公益善举"]
  },
  {
    url: "http://www.moa.gov.cn",
    title: "中华人民共和国农业农村部",
    description: "国务院主管农业、农村、农民三农工作的国家部委官方门户，发布乡村振兴战略规划、强农惠农政策与全国农业大宗生产调度信息。",
    categoryId: "reg-agriculture-and-rural",
    tags: ["农业农村部", "乡村振兴", "惠农政策", "国家部委"]
  },
  {
    url: "https://www.ymt.com",
    title: "一亩田",
    description: "国内领先的农产品原产地数字化 B2B 批发电商交易平台，打通田间地头农户与全国销地批发大市场，促进优质农货出山出村。",
    categoryId: "reg-agriculture-and-rural",
    tags: ["一亩田", "农产品批发", "产销对接", "数字三农"]
  },
  {
    url: "https://www.chsi.com.cn",
    title: "中国高等教育学生信息网 (学信网)",
    description: "教育部指定的普通高校招生录取、全国普通高等教育学籍档案、学历认证与学位证书查询国家官方唯一认证平台。",
    categoryId: "reg-education-and-civic-services",
    tags: ["学信网", "学历认证", "学籍查询", "官方平台"]
  },
  {
    url: "https://www.neea.edu.cn",
    title: "中国教育考试网",
    description: "教育部教育考试院官方网站，负责国家普通高考、全国硕士研究生招生考试、四六级、教师资格证等国家级教育考试权威报名与成绩查询。",
    categoryId: "reg-education-and-civic-services",
    tags: ["教育考试院", "考研成绩", "四六级成绩", "国家考试"]
  },
  {
    url: "https://chinavolunteer.mca.gov.cn",
    title: "中国志愿服务网",
    description: "民政部指导的全国统一志愿服务综合管理平台，提供实名志愿者注册、公益志愿团体认证、志愿服务时长精准存证与证明出具。",
    categoryId: "reg-charity-and-volunteering",
    tags: ["志愿服务", "志愿者注册", "志愿时长", "民政部官方"]
  },
  {
    url: "https://gongyi.qq.com",
    title: "腾讯公益",
    description: "全球规模最大的互联网全民数字公益募捐平台之一，依托微信支付开创'99公益日'，以透明阳光技术驱动人人可公益。",
    categoryId: "reg-charity-and-volunteering",
    tags: ["腾讯公益", "爱心捐助", "99公益日", "透明慈善"]
  },
  {
    url: "https://onefoundation.cn",
    title: "壹基金",
    description: "国内最早创立的民间公募基金会之一，秉持'尽我所能，人人公益'理念，聚焦儿童关怀、重大灾害救援与公益人才赋能。",
    categoryId: "reg-charity-and-volunteering",
    tags: ["壹基金", "民间公募", "灾害救援", "儿童关怀"]
  }
];

export async function run() {
  console.log("=== 开始检查第二批待入库候选站点清单 ===");
  console.log("候选站点总量:", BATCH2_CANDIDATES.length);

  // 1. 获取现有数据库中所有有效分类与所有已存在站点
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

  console.log("当前库内已有站点数:", allSites.length);

  // 2. 严格筛选待写入站点
  const toAdd = [];
  const seenInBatch = new Set();
  let duplicateCount = 0;
  let invalidCategoryCount = 0;

  for (const item of BATCH2_CANDIDATES) {
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
