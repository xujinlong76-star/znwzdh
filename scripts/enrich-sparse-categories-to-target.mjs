/**
 * 针对稀疏分类的知名权威站点扩充脚本（精准对齐 215 叶子分类 ID）
 */

export const CANDIDATES = [
  // ==================== 1. 学术科研 (reg-academic-research) ====================
  {
    url: "https://www.nature.com",
    title: "Nature (自然杂志)",
    description: "全球最具声誉与影响力的跨学科顶尖科学期刊之一，发表各个科学领域的重大突破与前沿研究成果。",
    categoryId: "reg-literature-search",
    tags: ["顶刊", "Nature", "科学研究", "同行评议"]
  },
  {
    url: "https://www.science.org",
    title: "Science (科学杂志)",
    description: "美国科学促进会 (AAAS) 出版的世界顶级综合性科学学术周刊，引领全球基础科研创新与前沿科技风向标。",
    categoryId: "reg-literature-search",
    tags: ["顶刊", "Science", "前沿突破", "AAAS"]
  },
  {
    url: "https://www.wanfangdata.com.cn",
    title: "万方数据知识服务平台",
    description: "中国权威的综合性学术信息与知识服务平台，收录海量中外文学术期刊、学位论文、科技会议与专利文献。",
    categoryId: "reg-literature-search",
    tags: ["万方数据", "学术论文", "科技报告", "核心文献"]
  },
  {
    url: "https://www.cqvip.com",
    title: "维普网 (中文科技期刊数据库)",
    description: "中国最早研发并推广的中文科技期刊数据库，提供权威的中文科技期刊文献检索、论文查重与文献引证分析。",
    categoryId: "reg-literature-search",
    tags: ["维普", "科技期刊", "中文文献", "查重检索"]
  },
  {
    url: "https://pubmed.ncbi.nlm.nih.gov",
    title: "PubMed",
    description: "美国国家生物技术信息中心 (NCBI) 维护的全球最大生物医学文献数据库，免费收录数千万篇 MEDLINE 医学期刊文献。",
    categoryId: "reg-literature-search",
    tags: ["医学文献", "NCBI", "生物医药", "权威文献"]
  },
  {
    url: "https://ieeexplore.ieee.org",
    title: "IEEE Xplore",
    description: "全球电气电子工程与计算机科学领域最高水准文献库，收录 IEEE 官方标准、顶级国际会议论文与期刊全集。",
    categoryId: "reg-literature-search",
    tags: ["IEEE", "电子工程", "计算机顶会", "国际标准"]
  },
  {
    url: "https://www.webofscience.com",
    title: "Web of Science (SCI)",
    description: "科睿唯安旗下全球公认的最权威引文数据库，收录 SCI、SSCI 等顶级核心引文索引，支撑全球学术绩效与学科评估。",
    categoryId: "reg-literature-search",
    tags: ["WebOfScience", "SCI检索", "引文分析", "核心期刊"]
  },
  {
    url: "https://www.sciencedirect.com",
    title: "ScienceDirect (Elsevier)",
    description: "全球著名出版巨头爱思唯尔 (Elsevier) 旗下的同行评审全文数据库，拥有近四千种核心学术期刊与数万本学术专著。",
    categoryId: "reg-open-access",
    tags: ["Elsevier", "ScienceDirect", "同行评审", "全文学术"]
  },
  {
    url: "https://link.springer.com",
    title: "SpringerLink",
    description: "施普林格 (Springer Nature) 旗下全球大型数字文献出版平台，涵盖数千种科技、医学与人文社科期刊及丛书。",
    categoryId: "reg-open-access",
    tags: ["Springer", "数字文献", "自然科学", "学术专著"]
  },
  {
    url: "https://www.jstor.org",
    title: "JSTOR",
    description: "全球极具声望的数字学术图书馆，保存上千种人文社科、自然科学历史核心学术期刊回溯全集与珍贵史料。",
    categoryId: "reg-open-access",
    tags: ["JSTOR", "人文社科", "历史期刊", "学术图书馆"]
  },
  {
    url: "https://www.las.ac.cn",
    title: "中国科学院文献情报中心",
    description: "中国科学院直属国家级科技文献情报机构，发布中科院期刊分区表、国家科技文献保障与中国科学引文数据库 (CSCD)。",
    categoryId: "reg-research-management",
    tags: ["中科院", "期刊分区", "CSCD", "文献情报"]
  },
  {
    url: "https://www.nstl.gov.cn",
    title: "国家科技图书文献中心 (NSTL)",
    description: "科技部等部委联合组建的国家科技文献保障体系，面向全国提供外文印本科技期刊、会议录及论文原文传递服务。",
    categoryId: "reg-research-management",
    tags: ["NSTL", "国家科技文献", "原文传递", "外文期刊"]
  },
  {
    url: "https://www.aminer.cn",
    title: "AMiner (学术知识图谱与学者肖像)",
    description: "清华大学研发的学术大数据知识图谱挖掘平台，收录数亿学者论文关联网络、全球顶尖学者排名与学术影响力洞察。",
    categoryId: "reg-academic-community",
    tags: ["AMiner", "清华学术", "学者肖像", "AI学术分析"]
  },
  {
    url: "https://www.wiley.com",
    title: "Wiley Online Library",
    description: "全球领先的学术出版机构 Wiley 数字化图书馆，涵盖生命医学、物理工程与人文社科数千本高水平同行评议期刊。",
    categoryId: "reg-open-access",
    tags: ["Wiley", "学术图书馆", "同行评议", "生命科学"]
  },
  {
    url: "https://zotero.org",
    title: "Zotero",
    description: "知名的免费开源个人文献收集、管理与论文参考文献自动化格式化引用工具，支持跨平台同步与文献笔记协作。",
    categoryId: "reg-paper-writing",
    tags: ["文献管理", "Zotero", "参考文献", "开源学术"]
  },
  {
    url: "https://www.mendeley.com",
    title: "Mendeley",
    description: "Elsevier 旗下全球领先的学术文献管理与科研社交协作软件，支持 PDF 文献高亮注释与 Word 引用一键生成。",
    categoryId: "reg-paper-writing",
    tags: ["Mendeley", "文献管理", "学术协作", "Elsevier"]
  },

  // ==================== 2. 数据与分析 (reg-data-and-analytics) ====================
  {
    url: "https://data.stats.gov.cn",
    title: "国家统计局国家数据网",
    description: "中华人民共和国国家统计局官方统计数据发布门户，权威公布全国宏观经济、人口普查、工业产值与物价指数等一手数据。",
    categoryId: "reg-bi-and-reporting",
    tags: ["国家统计局", "宏观经济", "人口数据", "官方数据"]
  },
  {
    url: "https://index.baidu.com",
    title: "百度指数",
    description: "基于百度海量网民搜索行为的数据分析平台，透视全网关键词搜索热度趋势、用户画像、地域分布与舆情关注焦点。",
    categoryId: "reg-product-analytics",
    tags: ["百度指数", "趋势分析", "网民需求", "舆情洞察"]
  },
  {
    url: "https://trendinsight.oceanengine.com",
    title: "巨量算数",
    description: "抖音集团官方内容与消费趋势洞察平台，提供抖音全域内容热度、用户兴趣画像、行业洞察报告与爆款内容趋势。",
    categoryId: "reg-product-analytics",
    tags: ["巨量算数", "抖音趋势", "内容数据", "行业报告"]
  },
  {
    url: "https://trends.google.com",
    title: "Google Trends (谷歌趋势)",
    description: "谷歌官方全球搜索趋势与热点探索平台，实时分析全球数十个国家地区不同时期的搜索词热度与相关查询关联。",
    categoryId: "reg-product-analytics",
    tags: ["GoogleTrends", "全球趋势", "热搜洞察", "数据分析"]
  },
  {
    url: "https://www.statista.com",
    title: "Statista",
    description: "全球领先的商业统计与市场研究数据门户，涵盖全球数百个行业、上千个市场的权威统计图表与深度消费者调查报告。",
    categoryId: "reg-bi-and-reporting",
    tags: ["Statista", "市场研究", "行业数据", "商业统计"]
  },
  {
    url: "https://data.worldbank.org",
    title: "世界银行开放数据 (World Bank Open Data)",
    description: "世界银行官方权威全球经济发展数据库，免费提供全球各经济体 GDP、人均寿命、贫困率、教育与碳排放关键指标。",
    categoryId: "reg-bi-and-reporting",
    tags: ["世界银行", "全球宏观", "发展指标", "公开数据"]
  },
  {
    url: "https://ec.europa.eu/eurostat",
    title: "Eurostat (欧盟统计局)",
    description: "欧洲联盟官方统计局官方数据库，提供欧盟成员国高品质、经过严格标准化处理的经济、产业、贸易与人口统计数据。",
    categoryId: "reg-bi-and-reporting",
    tags: ["Eurostat", "欧盟数据", "经济统计", "人口指标"]
  },
  {
    url: "https://www.aliresearch.com",
    title: "阿里研究院",
    description: "阿里巴巴集团商业生态智库，聚焦数字经济、新消费新商业、乡村振兴与前沿跨境电商发展的权威深度研究报告。",
    categoryId: "reg-bi-and-reporting",
    tags: ["阿里研究院", "数字经济", "电商报告", "行业智库"]
  },
  {
    url: "https://www.iresearch.com.cn",
    title: "艾瑞网 (iResearch)",
    description: "中国著名的新经济与互联网市场研究咨询机构，定期发布移动互联网、新消费、跨境电商等垂直行业深度行业分析报告。",
    categoryId: "reg-bi-and-reporting",
    tags: ["艾瑞咨询", "新经济报告", "行业趋势", "市场分析"]
  },
  {
    url: "https://www.analysys.cn",
    title: "易观千帆",
    description: "中国领先的数字经济与移动应用大数据分析平台，监测全网主流 APP 月活规模、用户黏性与用户行为轨迹分析。",
    categoryId: "reg-product-analytics",
    tags: ["易观千帆", "APP榜单", "月活监测", "数字洞察"]
  },
  {
    url: "https://www.tableau.com",
    title: "Tableau",
    description: "全球领先的敏捷商业智能与交互式数据可视化分析平台，让任何组织都能快速连通海量异构数据源并制作精美仪表盘。",
    categoryId: "reg-data-visualization",
    tags: ["Tableau", "商业智能", "数据看板", "交互可视化"]
  },

  // ==================== 3. 资讯媒体 (reg-news-and-media) ====================
  {
    url: "http://www.xinhuanet.com",
    title: "新华网",
    description: "中国国家通讯社新华社主办的中央重点新闻网站，中国最具公信力和全球影响力的国家主流网络权威媒体旗舰。",
    categoryId: "reg-official-releases",
    tags: ["新华社", "官方媒体", "国家通讯社", "权威快讯"]
  },
  {
    url: "http://www.people.com.cn",
    title: "人民网",
    description: "《人民日报》建设的以新闻为主的大型网上信息发布平台，权威发布党和国家方针政策与中央重大新闻报道。",
    categoryId: "reg-official-releases",
    tags: ["人民日报", "中央媒体", "政经时评", "权威主流"]
  },
  {
    url: "https://www.cctv.com",
    title: "央视网",
    description: "中央广播电视总台官方综合新闻门户，覆盖《新闻联播》《焦点访谈》等国家顶级电视新闻栏目在线直播与点播。",
    categoryId: "reg-official-releases",
    tags: ["央视网", "总台新闻", "新闻联播", "视频资讯"]
  },
  {
    url: "https://www.chinanews.com.cn",
    title: "中国新闻网 (中新网)",
    description: "中国新闻社主办的国家级重点新闻门户，以全球华人视角客观报道国内外重大突发新闻、侨务资讯与文化视界。",
    categoryId: "reg-general-news-portals",
    tags: ["中新社", "华语新闻", "全球侨务", "国家门户"]
  },
  {
    url: "https://www.gmw.cn",
    title: "光明网",
    description: "《光明日报》官方新闻网站，思想文化与知识界核心网络媒体，聚焦科教文卫、学术理论与理论大家思想长文。",
    categoryId: "reg-general-news-portals",
    tags: ["光明日报", "知识界", "思想文化", "学术理论"]
  },
  {
    url: "https://www.huanqiu.com",
    title: "环球网",
    description: "由人民网和环球时报社联合创办的中央重点新闻网站，聚焦国际地缘局势、海外热点观察与大国博弈前沿观察。",
    categoryId: "reg-international-media",
    tags: ["环球时报", "国际观察", "海外热点", "地缘政治"]
  },
  {
    url: "https://www.guancha.cn",
    title: "观察者网",
    description: "立足中国立场观察世界变化的知名政经新媒体，聚合海量战略学者专栏、国际时评与中国工业科技全景报道。",
    categoryId: "reg-longform-journalism",
    tags: ["政经评论", "战略研究", "国际大局", "学者视角"]
  },
  {
    url: "https://www.nbd.com.cn",
    title: "每日经济新闻",
    description: "中国主流财经商业全媒体，聚焦上市公司调查、大公司动态、宏观金融监管与资本市场深度财报解析。",
    categoryId: "reg-finance-news",
    tags: ["财经新闻", "上市公司", "资本市场", "商业调查"]
  },
  {
    url: "https://www.yicai.com",
    title: "第一财经",
    description: "上海广播电视台旗下的综合财经媒体集团旗舰，全天候输出全球金融行情快讯、专业财经电视直播与宏观市场研判。",
    categoryId: "reg-finance-news",
    tags: ["第一财经", "商业电视", "金融快讯", "宏观经济"]
  },
  {
    url: "https://www.21jingji.com",
    title: "21经济网 (21世纪经济报道)",
    description: "南方财经全媒体集团旗下核心商业旗舰，深耕宏观经济走势、产业经济集群、绿色金融与资本市场政策导向。",
    categoryId: "reg-finance-news",
    tags: ["21世纪", "商业报道", "产业经济", "宏观趋势"]
  },
  {
    url: "https://finance.sina.com.cn",
    title: "新浪财经",
    description: "中国访问量极大的老牌财经门户网站，提供 A 股、港股、美股全实时行情、上市公司公告与海量券商研报数据库。",
    categoryId: "reg-finance-news",
    tags: ["新浪财经", "实时行情", "股市大盘", "券商研报"]
  },
  {
    url: "https://www.ifeng.com",
    title: "凤凰网",
    description: "著名华人主流跨媒体资讯门户，以独特的深度观察、历史人文纪录片与全球热点独家专题报道广受海内外关注。",
    categoryId: "reg-general-news-portals",
    tags: ["凤凰网", "华人视野", "深度专题", "历史纪实"]
  },

  // ==================== 4. 公共服务 (reg-public-services) ====================
  {
    url: "https://www.court.gov.cn",
    title: "最高人民法院",
    description: "中华人民共和国最高审判机关官方门户，发布最高法司法解释、指导性案例、全国法院审判动态与司法改革举措。",
    categoryId: "reg-justice-and-law",
    tags: ["最高人民法院", "司法解释", "指导案例", "审判权威"]
  },
  {
    url: "https://www.spp.gov.cn",
    title: "最高人民检察院",
    description: "中华人民共和国最高检察机关官方门户，发布国家法律监督报告、刑事民事行政检察指导案例与典型公益诉讼通报。",
    categoryId: "reg-justice-and-law",
    tags: ["最高检", "法律监督", "检务公开", "公益诉讼"]
  },
  {
    url: "https://www.mps.gov.cn",
    title: "中华人民共和国公安部",
    description: "国家公安部官方门户网站，提供全国户籍政策通报、便民警务措施、电信网络诈骗预警与出入境业务通告。",
    categoryId: "reg-government-affairs",
    tags: ["公安部", "警务便民", "反诈预警", "户籍管理"]
  },
  {
    url: "https://cs.mfa.gov.cn",
    title: "中国领事服务网 (外交部领事司)",
    description: "外交部官方海外中国公民与企业领事保护门户，权威发布全球海外旅行安全提醒、签证互免协议与海外求助电话。",
    categoryId: "reg-household-and-entry-exit",
    tags: ["领事保护", "海外旅行提醒", "互免签证", "外交部"]
  },
  {
    url: "https://www.weather.com.cn",
    title: "中国天气网",
    description: "中国气象局官方公共气象服务门户，提供全国数千个市县精细化 24 小时与 15 天天气预报、台风暴雨灾害预警。",
    categoryId: "reg-weather-and-environment",
    tags: ["中国气象局", "天气预报", "暴雨预警", "气象雷达"]
  },
  {
    url: "https://www.samr.gov.cn",
    title: "国家市场监督管理总局",
    description: "国家主管市场综合监管的部委官方门户，发布国家标准公告、食品药品抽检通报、反垄断执法与企业信用公示指引。",
    categoryId: "reg-market-regulation",
    tags: ["市场监管总局", "食品安全", "国家标准", "反垄断"]
  },
  {
    url: "https://www.gjzwfw.gov.cn",
    title: "国家政务服务平台",
    description: "全国一体化在线政务服务平台统一总枢纽，实现跨地区、跨部门、跨层级政务数据共享与公民全生命周期事项跨省通办。",
    categoryId: "reg-government-affairs",
    tags: ["国家政务平台", "一网通办", "跨省通办", "政务大厅"]
  },
  {
    url: "https://www.chinacdc.cn",
    title: "中国疾病预防控制中心 (中国CDC)",
    description: "国家公共卫生技术指导与疾病防控权威机构，发布传染病疫情动态、疫苗预防接种科学指南与季节性流感防护常识。",
    categoryId: "reg-healthcare",
    tags: ["中国疾控中心", "疫苗接种", "公共卫生", "疾病预防"]
  },
  {
    url: "https://www.chinapost.com.cn",
    title: "中国邮政集团",
    description: "大型国有邮政快递企业官方网站，承担国家普遍邮政服务、高考录取通知书寄递、特快专递 EMS 与国际邮包包裹追踪。",
    categoryId: "reg-government-affairs",
    tags: ["中国邮政", "EMS快递", "邮政查询", "普遍服务"]
  },

  // ==================== 5. 金融财经 (reg-finance-and-investing) ====================
  {
    url: "https://www.ccb.com",
    title: "中国建设银行 (CCB)",
    description: "中国大型国有四大商业银行之一，以住房金融、基建基础设施大型贷款与金融科技新金融服务为行业特色。",
    categoryId: "reg-banking",
    tags: ["建设银行", "国有大行", "住房金融", "财富管理"]
  },
  {
    url: "https://www.boc.cn",
    title: "中国银行 (BOC)",
    description: "中国全球化和综合化程度最高的百年大型国有商业银行，在外汇外贸买卖、跨境金融与国际银团贷款领域实力雄厚。",
    categoryId: "reg-banking",
    tags: ["中国银行", "外汇结算", "跨境金融", "百年老店"]
  },
  {
    url: "https://www.abchina.com",
    title: "中国农业银行 (ABC)",
    description: "横跨城乡、网点覆盖全国最广的大型国有商业银行，在三农惠农贷款、绿色金融与县域数字金融领域居行业领先地位。",
    categoryId: "reg-banking",
    tags: ["农业银行", "三农金融", "普惠金融", "网点最多"]
  },
  {
    url: "https://www.sse.com.cn",
    title: "上海证券交易所 (上交所)",
    description: "中国内地规模最大的证券交易所，涵盖主板蓝筹上市公司与科创板硬科技创新企业，负责证券市场发行与交易监管。",
    categoryId: "reg-securities-and-quotes",
    tags: ["上交所", "科创板", "A股大盘", "股票交易"]
  },
  {
    url: "https://www.szse.cn",
    title: "深圳证券交易所 (深交所)",
    description: "聚焦创新型创新创业企业的大型证券交易所，设有深市主板与创业板，是中国高新技术企业与创新资本形成的重要高地。",
    categoryId: "reg-securities-and-quotes",
    tags: ["深交所", "创业板", "创新资本", "上市公司"]
  },
  {
    url: "https://www.hkex.com.hk",
    title: "香港交易所 (HKEX)",
    description: "全球领先的国际金融中心证券与衍生产品交易所，连接中国内地与全球资本市场的超级枢纽，运行沪深港通与新经济上市。",
    categoryId: "reg-securities-and-quotes",
    tags: ["港交所", "港股市场", "沪深港通", "国际金融"]
  },
  {
    url: "https://www.10jqka.com.cn",
    title: "同花顺",
    description: "国内领先的互联网金融信息服务提供商，同花顺手机炒股软件提供 AI 智能投顾、问财智能选股与全景 Level-2 深度行情。",
    categoryId: "reg-securities-and-quotes",
    tags: ["同花顺", "股票软件", "Level2行情", "智能选股"]
  },

  // ==================== 6. 游戏电竞 (reg-gaming-and-esports) ====================
  {
    url: "https://store.playstation.com",
    title: "PlayStation Store (PSN 商店)",
    description: "索尼互娱 PlayStation 主机官方数字商城，提供 PS5/PS4 顶级独占 AAA 游戏、季票扩展与 PS Plus 会员阵容下载。",
    categoryId: "reg-console-and-cloud-gaming",
    tags: ["PlayStation", "PS5", "索尼主机", "独占大作"]
  },
  {
    url: "https://www.nintendo.com/us/store",
    title: "Nintendo eShop (任天堂商店)",
    description: "任天堂官方 Switch 数字游戏商店，提供《塞尔达传说》《马力欧》《宝可梦》等第一方神作与独立游戏数字版购买。",
    categoryId: "reg-console-and-cloud-gaming",
    tags: ["Nintendo", "Switch", "任天堂", "塞尔达"]
  },
  {
    url: "https://game.qq.com",
    title: "腾讯游戏官网",
    description: "全球领先的游戏研发与运营综合门户，覆盖《英雄联盟》《王者荣耀》《穿越火线》《和平精英》等国民现象级竞技网游。",
    categoryId: "reg-game-platforms",
    tags: ["腾讯游戏", "王者荣耀", "英雄联盟", "网络游戏"]
  },
  {
    url: "https://game.163.com",
    title: "网易游戏官网",
    description: "中国自主研发与精品网游领先巨头，运营《梦幻西游》《大话西游》《永劫无间》《逆水寒》《蛋仔派对》等精品佳作。",
    categoryId: "reg-game-platforms",
    tags: ["网易游戏", "逆水寒", "永劫无间", "蛋仔派对"]
  },
  {
    url: "https://www.ali213.net",
    title: "游侠网",
    description: "中国资深老牌单机游戏门户与论坛，汇聚最新游戏业界热点、新作开箱首测、中文汉化补丁与游戏修改辅助工具下载。",
    categoryId: "reg-game-wikis-and-data",
    tags: ["单机游戏", "游侠论坛", "汉化补丁", "游戏攻略"]
  },
  {
    url: "https://ys.mihoyo.com",
    title: "原神官网 (Genshin Impact)",
    description: "米哈游自研的全球超人气开放世界冒险 RPG 游戏官方网站，体验提瓦特大陆跨平台实时渲染与动人宏大世界观。",
    categoryId: "reg-game-platforms",
    tags: ["米哈游", "原神", "开放世界", "二次元游戏"]
  },
  {
    url: "https://lol.qq.com",
    title: "英雄联盟官方网站 (League of Legends)",
    description: "拳头游戏研发、腾讯代理运营的全球最具人气 MOBA 竞技网游官网，提供英雄资料库、版本更新与全球总决赛实况。",
    categoryId: "reg-esports-events",
    tags: ["英雄联盟", "LOL", "MOBA网游", "全球总决赛"]
  },
  {
    url: "https://pvp.qq.com",
    title: "王者荣耀官方网站",
    description: "腾讯天美工作室群研发的国民 5v5 英雄公平对战手游官网，包含全英雄出装铭文攻略、KPL 职业联赛赛程与赛事直播。",
    categoryId: "reg-esports-events",
    tags: ["王者荣耀", "KPL电竞", "MOBA手游", "腾讯官方"]
  },

  // ==================== 7. 影音娱乐 (reg-entertainment) ====================
  {
    url: "https://www.youku.com",
    title: "优酷 (Youku)",
    description: "阿里巴巴集团旗下老牌核心视频播放平台，涵盖白夜剧场精品悬疑剧、热门动漫港剧、合家欢综艺与院线新片。",
    categoryId: "reg-long-video",
    tags: ["优酷", "热播好剧", "悬疑短剧", "阿里文娱"]
  },
  {
    url: "https://www.mgtv.com",
    title: "芒果TV",
    description: "湖南广播影视集团旗下官方互联网视频平台，凭借《乘风破浪》《披荆斩棘》等王牌王牌综艺IP与青春甜宠剧领跑市场。",
    categoryId: "reg-long-video",
    tags: ["芒果TV", "王牌综艺", "湖南卫视", "自制剧集"]
  },
  {
    url: "https://www.kugou.com",
    title: "酷狗音乐",
    description: "国内用户基数庞大的数字音乐客户端，拥有海量经典老歌与当下短视频热门神曲曲库、蝰蛇专业音效与全景伴唱功能。",
    categoryId: "reg-music",
    tags: ["酷狗音乐", "经典老歌", "蝰蛇音效", "流行伴唱"]
  },
  {
    url: "https://piaofang.maoyan.com",
    title: "猫眼专业版 (实时票房数据)",
    description: "中国电影行业最权威的实时电影票房、影院排片占比、上座率以及电视剧全网正片播放量市占率专业大数据监测平台。",
    categoryId: "reg-cinema-ticketing",
    tags: ["猫眼专业版", "实时票房", "影院排片", "行业数据"]
  },

  // ==================== 8. 学习成长 (reg-learning-growth) ====================
  {
    url: "https://www.imooc.com",
    title: "慕课网",
    description: "程序员的梦工厂，提供体系化的前端、Java、Python、大模型全栈开发实战课程与资深架构师进阶成长路径。",
    categoryId: "reg-programming-learning",
    tags: ["慕课网", "程序员培训", "实战项目", "前端后端"]
  },
  {
    url: "https://study.163.com",
    title: "网易云课堂",
    description: "网易旗下大型在线实用技能学习平台，涵盖 IT 互联网技术、职场通用办公技能、考研考证与数字设计系统课程。",
    categoryId: "reg-online-courses",
    tags: ["网易云课堂", "技能提升", "职场充电", "职业考证"]
  },
  {
    url: "https://www.khanacademy.org",
    title: "可汗学院 (Khan Academy)",
    description: "全球享誉盛名的非营利纯免费数字化教育先锋，提供覆盖数学、物理、化学、生物与计算机的互动练习与通俗视频辅导。",
    categoryId: "reg-open-courses",
    tags: ["可汗学院", "公益教育", "中小学数学", "免费网课"]
  },
  {
    url: "https://www.duolingo.cn",
    title: "多邻国 (Duolingo)",
    description: "全球最受欢迎的趣味游戏化语言学习神器，通过碎片化答题与通关机制轻松掌握英语、日语、法语、西语等数十种语言。",
    categoryId: "reg-language-learning",
    tags: ["多邻国", "外语学习", "游戏化闯关", "多语种启蒙"]
  },
  {
    url: "https://wenku.baidu.com",
    title: "百度文库",
    description: "中国最大的综合性文档资料与知识分享平台，收录数亿份专业论文、考研资料、各行业合同模板与中小学全科教案。",
    categoryId: "reg-digital-libraries",
    tags: ["百度文库", "课件下载", "专业模板", "文档资料"]
  },

  // ==================== 9. 内容创作 (reg-content-creation) ====================
  {
    url: "https://bcut.bilibili.com",
    title: "必剪",
    description: "哔哩哔哩官方出品的年轻化视频剪辑软件，提供海量 B 站特色梗图贴纸、专属虚拟形象录制与一键高清投稿通道。",
    categoryId: "reg-video-editing",
    tags: ["必剪", "B站剪辑", "虚拟主播", "一键投稿"]
  },
  {
    url: "https://www.blackmagicdesign.com/cn/products/davinciresolve",
    title: "DaVinci Resolve (达芬奇调色剪辑)",
    description: "好莱坞电影工业首选的专业调色与后期剪辑制作套件，集剪辑、先进调色、Fairlight 专业音频与 Fusion 视觉特效于一身。",
    categoryId: "reg-video-editing",
    tags: ["达芬奇", "电影调色", "后期特效", "影视制作"]
  },

  // ==================== 10. 消费生活 (reg-consumer-life) ====================
  {
    url: "https://www.pinduoduo.com",
    title: "拼多多",
    description: "新电子商务开创者，以普惠、人为先与更少中间环节为核心，提供农产品直采、百亿补贴官方正品与高性价比团购好物。",
    categoryId: "reg-ecommerce",
    tags: ["拼多多", "百亿补贴", "农产品直采", "高性价比"]
  },
  {
    url: "https://www.suning.com",
    title: "苏宁易购",
    description: "中国领先的智慧零售服务商，线上线下全场景融合，专注全品类家电以旧换新、数码 3C 与家庭智能化场景解决方案。",
    categoryId: "reg-ecommerce",
    tags: ["苏宁易购", "以旧换新", "家电数码", "智慧零售"]
  },
  {
    url: "https://www.ke.com",
    title: "贝壳找房",
    description: "科技驱动的新居住服务平台，提供真实房源保障、VR 在线看房、二手房买卖签约流程全透明与高品质长租公寓服务。",
    categoryId: "reg-transit-and-mobility",
    tags: ["贝壳找房", "真实房源", "VR看房", "二手房买卖"]
  },
  {
    url: "https://www.lianjia.com",
    title: "链家网",
    description: "中国具有广泛公信力的房地产经纪综合服务平台，以'真房源'为基石，提供严谨的购房安心服务承诺与线下万家门店保障。",
    categoryId: "reg-transit-and-mobility",
    tags: ["链家", "真房源", "安心保障", "房产中介"]
  },
  {
    url: "https://www.fliggy.com",
    title: "飞猪旅行",
    description: "阿里巴巴旗下高性价比年轻化综合旅游服务平台，涵盖全球特价国际机票、星级酒店会员互通预订与度假门票保障。",
    categoryId: "reg-travel-and-lodging",
    tags: ["飞猪旅行", "阿里旅游", "特价机票", "酒店预订"]
  },
  {
    url: "https://www.qunar.com",
    title: "去哪儿旅行",
    description: "中国知名的旅游搜索引擎与机票比价预订平台，凭借强大的低价机票比价算法与火车票抢票服务深受大学生与年轻旅客青睐。",
    categoryId: "reg-travel-and-lodging",
    tags: ["去哪儿", "低价机票", "特惠酒店", "比价引擎"]
  },
  {
    url: "https://www.dianping.com",
    title: "大众点评",
    description: "中国领先的城市本地生活消费指南与真实口碑评价社区，提供全国各城市真实必吃榜餐厅、玩乐探店与真实消费评价。",
    categoryId: "reg-food-and-drink",
    tags: ["大众点评", "黑珍珠餐厅", "真实探店", "必吃榜"]
  },

  // ==================== 11. 职业招聘 (reg-jobs-and-career) ====================
  {
    url: "https://www.lagou.com",
    title: "拉勾招聘",
    description: "互联网科技行业垂直招聘平台，专注程序员、产品经理、运营和 UI 设计师求职，支持与互联网大厂业务直接极速沟通。",
    categoryId: "reg-tech-hiring",
    tags: ["拉勾网", "互联网招聘", "程序员求职", "高薪大厂"]
  },
  {
    url: "https://www.ciweishi.com",
    title: "刺猬实习",
    description: "备受海内外年轻人喜爱的青年职业成长与优质名企实习平台，聚焦大厂寒暑假日常实习、公益青年志愿与青年职场训练营。",
    categoryId: "reg-campus-and-internship",
    tags: ["刺猬实习", "名企实习", "青年发展", "大学生兼职"]
  },

  // ==================== 12. 设计与创意 (reg-design-and-creative) ====================
  {
    url: "https://www.behance.net",
    title: "Behance (Adobe)",
    description: "Adobe 旗下全球最大的创意专业人士综合展示平台，汇集全球顶级平面设计、品牌 VI、工业造型与建筑设计完整案例展出。",
    categoryId: "reg-inspiration-and-showcase",
    tags: ["Behance", "Adobe创意", "品牌设计", "工业设计"]
  },
  {
    url: "https://huaban.com",
    title: "花瓣网",
    description: "中国极具人气的视觉灵感采集与素材画板管理网站，数千万设计师在这里采集网页设计、插画、摄影与空间设计灵感碎片。",
    categoryId: "reg-inspiration-and-showcase",
    tags: ["花瓣网", "灵感画板", "素材采集", "视觉设计"]
  },
  {
    url: "https://www.iconfont.cn",
    title: "Iconfont (阿里巴巴矢量图标库)",
    description: "阿里巴巴体验技术团队打造的国内功能强大、内容丰富的矢量图标库，支持海量 SVG/矢量字体生成与多团队项目协作。",
    categoryId: "reg-icons-and-typefaces",
    tags: ["Iconfont", "阿里图标", "SVG素材", "矢量图标"]
  },
  {
    url: "https://www.flaticon.com",
    title: "Flaticon",
    description: "全球最大的免费高质量矢量图标数据库之一，提供数百万款经过精细设计的 SVG、PNG、EPS 格式多风格图标套件。",
    categoryId: "reg-icons-and-typefaces",
    tags: ["Flaticon", "矢量图标", "UI素材", "图标下载"]
  },
  {
    url: "https://www.freepik.com",
    title: "Freepik",
    description: "全球广受欢迎的高品质免费平面设计素材库，涵盖海量高质量矢量图源文件、免版税商用照片、PSD 样机与设计模板。",
    categoryId: "reg-stock-media",
    tags: ["Freepik", "矢量素材", "PSD样机", "免版税图片"]
  },
  {
    url: "https://www.ui.cn",
    title: "UI中国 (UICN)",
    description: "中国专业的用户体验设计行业综合门户平台，涵盖 UI/UX 设计大赛、人机交互案例长文、设计规范剖析与资深设计师交流社区。",
    categoryId: "reg-inspiration-and-showcase",
    tags: ["UI中国", "用户体验", "界面设计", "设计社区"]
  },
  {
    url: "https://www.uisdc.com",
    title: "优设网 (UISDC)",
    description: "国内极具人气的设计师终身学习平台，每日精选前沿设计资讯、PS/Figma/Blender 深度中文教程与优质免费设计资源合集。",
    categoryId: "reg-inspiration-and-showcase",
    tags: ["优设网", "设计教程", "设计资源", "Figma教学"]
  }
];

export async function run() {
  console.log("=== 开始检查核心知名站点扩充清单 ===");
  console.log("候选站点总量:", CANDIDATES.length);

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

  console.log("库内当前已有站点数:", allSites.length);

  const toAdd = [];
  const seenInBatch = new Set();
  let duplicateCount = 0;
  let invalidCategoryCount = 0;

  for (const item of CANDIDATES) {
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
  console.log("待新增站点数:", toAdd.length);
  console.log("跳过的重复数:", duplicateCount);
  console.log("错误分类站点数:", invalidCategoryCount);

  if (invalidCategoryCount > 0) {
    throw new Error("存在无效分类，中止执行！");
  }

  if (toAdd.length === 0) {
    console.log("没有新站点需要写入。");
    return;
  }

  const BATCH_SIZE = 50;
  let totalCreated = 0;
  for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
    const chunk = toAdd.slice(i, i + BATCH_SIZE);
    console.log(`正在写入批次 ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} 个站点)...`);
    const resp = await fetch("http://127.0.0.1:8787/api/sites/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sites: chunk })
    }).then(r => r.json());

    if (!resp.success) {
      console.error("写入失败:", resp);
      throw new Error("写入报错");
    }
    totalCreated += resp.created;
    console.log(`  -> 本批成功新建: ${resp.created}, 重复拦截: ${resp.duplicates}`);
  }

  console.log(`\n🎉 全量写入成功！共新增 ${totalCreated} 个知名站点。`);
}

run().catch(e => {
  console.error("执行脚本异常:", e);
  process.exit(1);
});
