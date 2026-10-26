/**
 * 种子插件：独立黑客出海与全球 SaaS 武器库（site-pack）
 *
 * 遵循 2026 前沿技术标准打造的旗舰级专业网址包。
 * 覆盖 20 大核心分类与 200 个前沿站点。
 */
import type { SeedPluginDef } from "../types.ts";

export const indieHackerGlobalSaas: SeedPluginDef = {
  "slug": "indie-hacker-global-saas",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "site-pack",
    "name": "独立黑客出海与全球 SaaS 武器库",
    "description": "2026 前沿独立黑客 (Indie Hacker) 出海与全球微型 SaaS 商业化全景武器库（20 大分类 / 202 个精选站点）：系统覆盖全球多币种支付结汇、合规法务、全栈开发元框架、身份验证、全球化 SEO 营销、埋点分析与出海远程社区。",
    "icon": "🚀",
    "author": "山羊胡官方",
    "license": "MIT",
    "version": "1.0.0",
    "tags": [
      "出海",
      "SaaS",
      "独立开发",
      "Stripe",
      "支付",
      "增长",
      "全球化",
      "IndieHacker"
    ],
    "payload": {
      "categories": [
        {
          "title": "支付与钱包",
          "description": "全球多币种信用卡扣款、MoR 记录商结算与跨境订阅支付网关"
        },
        {
          "title": "财税发票",
          "description": "全球数字服务税 (VAT/Sales Tax) 自动化申报、发票与税务合规"
        },
        {
          "title": "银行",
          "description": "面向海外初创企业的线上多币种商业银行账户与国际跨境电汇"
        },
        {
          "title": "SEO 与增长",
          "description": "搜索引擎关键词挖掘、外链建设、反向链接分析与程序化 SEO"
        },
        {
          "title": "埋点与分析",
          "description": "尊重隐私的现代化网站访问分析、用户行为漏斗与转化归因"
        },
        {
          "title": "落地页搭建",
          "description": "高转化营销落地页、Waitlist 候补收集与快速建站生成工具"
        },
        {
          "title": "邮件通讯",
          "description": "自动化事务邮件发送、营销邮件群发与新闻通讯订阅托管服务"
        },
        {
          "title": "出海创作",
          "description": "跨语言本地化翻译、国际化多语言支持与海外内容本地化落地"
        },
        {
          "title": "社媒与增长",
          "description": "海外社交媒体自动化调度发帖、KOL 推广与冷启动增长渠道"
        },
        {
          "title": "核心框架",
          "description": "支撑轻量 SaaS 极速上线的现代化全栈元框架与极速开箱模版"
        },
        {
          "title": "全栈与服务端",
          "description": "免运维的高性能 BaaS 后端、数据库无缝同步与云函数接口"
        },
        {
          "title": "低代码搭建",
          "description": "SaaS 快速启动样板间 (Boilerplate)、管理后台与内部工具搭建"
        },
        {
          "title": "组件与 UI 体系",
          "description": "现代化高颜值无头组件库、Tailwind 界面模板与设计设计系统"
        },
        {
          "title": "IaC 与云厂商",
          "description": "按需计费、全球就近边缘加速的现代化云托管与域名基础设施"
        },
        {
          "title": "无服务器与事件",
          "description": "低成本随用随付的 Serverless 接口、消息队列与后台定时任务"
        },
        {
          "title": "应用与密钥安全",
          "description": "出海 SaaS 开箱即用多租户用户认证、社会化登录与防欺诈风控"
        },
        {
          "title": "项目与研发管理",
          "description": "公开路线图规划、用户功能反馈投票收集与产品更新日志发布"
        },
        {
          "title": "表单与问卷",
          "description": "高转化交互式表单、潜在客户资格审查与多渠道用户满意度调查"
        },
        {
          "title": "海外与远程",
          "description": "全球独立开发者社区、SaaS 创始人经验分享与透明收入展示榜"
        },
        {
          "title": "自由职业",
          "description": "全球数字游民远程工作平台、独立外包接单与自由职业服务市场"
        }
      ],
      "sites": [
        {
          "url": "https://stripe.com/",
          "title": "Stripe",
          "description": "全球互联网支付基础设施黄金标准，支持 135+ 种货币与全球主流银行卡。",
          "category": "支付与钱包",
          "subCategory": "支付基石",
          "tags": [
            "Stripe",
            "全球支付"
          ]
        },
        {
          "url": "https://www.lemonsqueezy.com/",
          "title": "Lemon Squeezy",
          "description": "专为软件与数字商品打造的记录商 (MoR) 支付平台，自动处理全球税费。",
          "category": "支付与钱包",
          "subCategory": "MoR平台",
          "tags": [
            "LemonSqueezy",
            "免税务申报"
          ]
        },
        {
          "url": "https://www.paddle.com/",
          "title": "Paddle",
          "description": "老牌出海 SaaS 专属结算记录商，提供完备的 B2B/B2C 订阅计费管理体系。",
          "category": "支付与钱包",
          "subCategory": "MoR平台",
          "tags": [
            "Paddle",
            "SaaS计费"
          ]
        },
        {
          "url": "https://polar.sh/",
          "title": "Polar.sh",
          "description": "专为开发者与开源创作者打造的轻量级现代支付与赞助微平台。",
          "category": "支付与钱包",
          "subCategory": "开发者支付",
          "tags": [
            "Polar",
            "开源赞助"
          ]
        },
        {
          "url": "https://creem.io/",
          "title": "Creem",
          "description": "欧洲初创团队打造的极简现代化订阅计费平台，极简 API 快速接入。",
          "category": "支付与钱包",
          "subCategory": "极简订阅",
          "tags": [
            "Creem",
            "欧洲支付"
          ]
        },
        {
          "url": "https://www.paypal.com/business",
          "title": "PayPal Business",
          "description": "覆盖全球数亿买家信任的经典国际支付方式，出海必配收款渠道之一。",
          "category": "支付与钱包",
          "subCategory": "主流钱包",
          "tags": [
            "PayPal",
            "国际钱包"
          ]
        },
        {
          "url": "https://gumroad.com/",
          "title": "Gumroad",
          "description": "创作者与独立黑客销售电子书、课程与数字工具资产的经典先驱市场。",
          "category": "支付与钱包",
          "subCategory": "数字集市",
          "tags": [
            "Gumroad",
            "创作者销售"
          ]
        },
        {
          "url": "https://chargebee.com/",
          "title": "Chargebee",
          "description": "适用于快速成长 SaaS 企业的全周期订阅计费与复杂收入确认管理平台。",
          "category": "支付与钱包",
          "subCategory": "订阅计费",
          "tags": [
            "Chargebee",
            "企业级计费"
          ]
        },
        {
          "url": "https://recurly.com/",
          "title": "Recurly",
          "description": "专注于大幅削减非自愿流失、优化续费成功率的专业级订阅计费平台。",
          "category": "支付与钱包",
          "subCategory": "续费优化",
          "tags": [
            "Recurly",
            "防流失"
          ]
        },
        {
          "url": "https://dlocal.com/",
          "title": "dLocal",
          "description": "一站式新兴市场支付平台，连接拉美、亚太与非洲数十个国家的本地支付。",
          "category": "支付与钱包",
          "subCategory": "新兴市场",
          "tags": [
            "dLocal",
            "拉美支付"
          ]
        },
        {
          "url": "https://stripe.com/atlas",
          "title": "Stripe Atlas",
          "description": "几分钟内在线注册美国特拉华州 C-Corp 或 LLC 公司并设立银行账户。",
          "category": "财税发票",
          "subCategory": "公司注册",
          "tags": [
            "Stripe Atlas",
            "美国公司"
          ]
        },
        {
          "url": "https://stripe.com/tax",
          "title": "Stripe Tax",
          "description": "自动计算并代收全球各地适用的销售税与增值税，提供完整申报报表。",
          "category": "财税发票",
          "subCategory": "自动税务",
          "tags": [
            "Stripe Tax",
            "销售税"
          ]
        },
        {
          "url": "https://www.taxjar.com/",
          "title": "TaxJar (Stripe 旗下)",
          "description": "自动化美国各州销售税计算、报表汇总与多州自动报税合规云平台。",
          "category": "财税发票",
          "subCategory": "美国税合规",
          "tags": [
            "TaxJar",
            "多州合规"
          ]
        },
        {
          "url": "https://quaderno.io/",
          "title": "Quaderno",
          "description": "专为数字企业与 SaaS 打造的全球税务合规自动化系统，跨网关聚合数据。",
          "category": "财税发票",
          "subCategory": "全球税务",
          "tags": [
            "Quaderno",
            "多网关税务"
          ]
        },
        {
          "url": "https://doola.com/",
          "title": "doola",
          "description": "协助全球创始人轻松完成美国公司注册、EIN 申请、报税与年度合规。",
          "category": "财税发票",
          "subCategory": "出海合规",
          "tags": [
            "doola",
            "远程注册"
          ]
        },
        {
          "url": "https://firstbase.io/",
          "title": "Firstbase",
          "description": "为国际创始人提供的一站式设立美国公司、开设账户与法律合规服务平台。",
          "category": "财税发票",
          "subCategory": "公司设立",
          "tags": [
            "Firstbase",
            "特拉华公司"
          ]
        },
        {
          "url": "https://anrok.com/",
          "title": "Anrok",
          "description": "专为现代 SaaS 企业量身定制的全球销售税自动化计算与实时监控系统。",
          "category": "财税发票",
          "subCategory": "SaaS专税",
          "tags": [
            "Anrok",
            "SaaS税务"
          ]
        },
        {
          "url": "https://invoiceninja.com/",
          "title": "Invoice Ninja",
          "description": "自由开源的自托管发票生成、付款追踪与专业报价单开具系统。",
          "category": "财税发票",
          "subCategory": "开源发票",
          "tags": [
            "InvoiceNinja",
            "自建发票"
          ]
        },
        {
          "url": "https://stripe.com/invoicing",
          "title": "Stripe Invoicing",
          "description": "在线向企业客户开具专业发票并追踪付款到账状态的自动化工具。",
          "category": "财税发票",
          "subCategory": "在线发票",
          "tags": [
            "Stripe Invoicing",
            "企业收款"
          ]
        },
        {
          "url": "https://quickbooks.intuit.com/",
          "title": "QuickBooks Online",
          "description": "中小企业与初创公司广泛使用的老牌财税记账与利润表汇总软件。",
          "category": "财税发票",
          "subCategory": "企业记账",
          "tags": [
            "QuickBooks",
            "财务记账"
          ]
        },
        {
          "url": "https://mercury.com/",
          "title": "Mercury (水星银行)",
          "description": "全球科技初创企业与独立黑客首选的美国商业银行账户，支持纯线上申请。",
          "category": "银行",
          "subCategory": "初创银行",
          "tags": [
            "Mercury",
            "美国银行"
          ]
        },
        {
          "url": "https://www.brex.com/",
          "title": "Brex",
          "description": "面向高成长初创企业的全功能企业信用卡、财务管理与现金账户。",
          "category": "银行",
          "subCategory": "企业信用卡",
          "tags": [
            "Brex",
            "企业卡"
          ]
        },
        {
          "url": "https://wise.com/business/",
          "title": "Wise Business",
          "description": "低费率跨境多币种商业账户，支持 40+ 种货币实时换汇与国际电汇结汇。",
          "category": "银行",
          "subCategory": "跨境结算",
          "tags": [
            "Wise",
            "多币种账户"
          ]
        },
        {
          "url": "https://www.revolut.com/business/",
          "title": "Revolut Business",
          "description": "欧洲顶尖数字金融科技银行，为全球商业团队提供多币种结算与虚拟卡。",
          "category": "银行",
          "subCategory": "欧洲数字银行",
          "tags": [
            "Revolut",
            "多币种卡"
          ]
        },
        {
          "url": "https://airwallex.com/",
          "title": "空中云汇 (Airwallex)",
          "description": "面向全球化出海企业的全球收款、全球账户开设与低成本多币种结算通道。",
          "category": "银行",
          "subCategory": "出海收款",
          "tags": [
            "Airwallex",
            "国际结汇"
          ]
        },
        {
          "url": "https://www.payoneer.com/",
          "title": "派安盈 (Payoneer)",
          "description": "跨境电商与独立出海开发者广泛采纳的全球资金收付与本地银行账户分发服务。",
          "category": "银行",
          "subCategory": "老牌收汇",
          "tags": [
            "Payoneer",
            "外币收结"
          ]
        },
        {
          "url": "https://relayfi.com/",
          "title": "Relay Financial",
          "description": "专为小型企业与独立创业者量身打造的在线零月费商业银行账户。",
          "category": "银行",
          "subCategory": "零月费银行",
          "tags": [
            "Relay",
            "免月费账户"
          ]
        },
        {
          "url": "https://ramp.com/",
          "title": "Ramp",
          "description": "结合智能费用报销、企业卡与自动节省支出建议的现代化企业财务系统。",
          "category": "银行",
          "subCategory": "财务节省",
          "tags": [
            "Ramp",
            "支出管控"
          ]
        },
        {
          "url": "https://pingpongx.com/",
          "title": "PingPong 金融",
          "description": "国内领先的跨境收款与资金管理服务商，提供合规、低费率跨境提现通道。",
          "category": "银行",
          "subCategory": "国内合规收汇",
          "tags": [
            "PingPong",
            "外贸结汇"
          ]
        },
        {
          "url": "https://stripe.com/treasury",
          "title": "Stripe Treasury",
          "description": "将银行即服务 (BaaS) 深度嵌入你的产品与工作流中的金融 API。",
          "category": "银行",
          "subCategory": "嵌入式金融",
          "tags": [
            "Stripe Treasury",
            "BaaS金融"
          ]
        },
        {
          "url": "https://ahrefs.com/",
          "title": "Ahrefs",
          "description": "全球权威 SEO 工具集，精准分析竞品外链图谱、关键词搜索量与内容差距。",
          "category": "SEO 与增长",
          "subCategory": "SEO工具集",
          "tags": [
            "Ahrefs",
            "外链分析"
          ]
        },
        {
          "url": "https://www.semrush.com/",
          "title": "Semrush",
          "description": "全面的数字营销与搜索引擎优化平台，包含竞品流量侦测与广告投放分析。",
          "category": "SEO 与增长",
          "subCategory": "综合营销",
          "tags": [
            "Semrush",
            "竞品侦测"
          ]
        },
        {
          "url": "https://search.google.com/search-console/about",
          "title": "Google Search Console",
          "description": "Google 官方搜索控制台，实时查看网站索引状态、点击量与搜索表现。",
          "category": "SEO 与增长",
          "subCategory": "官方工具",
          "tags": [
            "Search Console",
            "谷歌索引"
          ]
        },
        {
          "url": "https://moz.com/",
          "title": "Moz Pro",
          "description": "定义了域名权重 (Domain Authority) 指标的老牌权威 SEO 分析与监控软件。",
          "category": "SEO 与增长",
          "subCategory": "域名权重",
          "tags": [
            "Moz",
            "DA权重"
          ]
        },
        {
          "url": "https://answerthepublic.com/",
          "title": "AnswerThePublic",
          "description": "根据搜索引擎自动补全挖掘海量长尾疑问词，发现用户真实痛点的高效工具。",
          "category": "SEO 与增长",
          "subCategory": "需求挖掘",
          "tags": [
            "长尾关键词",
            "用户痛点"
          ]
        },
        {
          "url": "https://trends.google.com/",
          "title": "Google 趋势 (Google Trends)",
          "description": "实时探索全球热门搜索词走向与历史趋势，捕捉出海前沿商机与选品方向。",
          "category": "SEO 与增长",
          "subCategory": "趋势追踪",
          "tags": [
            "Google Trends",
            "热度趋势"
          ]
        },
        {
          "url": "https://screamingfrog.co.uk/seo-spider/",
          "title": "Screaming Frog SEO Spider",
          "description": "业内知名的网站爬虫诊断利器，快速找出死链、重定向链与 Meta 缺失缺陷。",
          "category": "SEO 与增长",
          "subCategory": "站内爬虫",
          "tags": [
            "Screaming Frog",
            "死链扫描"
          ]
        },
        {
          "url": "https://surferseo.com/",
          "title": "Surfer SEO",
          "description": "数据驱动的内容优化系统，利用自然语言处理为文章提供实时排版打分与关键词建议。",
          "category": "SEO 与增长",
          "subCategory": "内容优化",
          "tags": [
            "SurferSEO",
            "内容排版"
          ]
        },
        {
          "url": "https://ubersuggest.com/",
          "title": "Ubersuggest",
          "description": "性价比极高的高频关键词建议与竞品反向链接速查工具。",
          "category": "SEO 与增长",
          "subCategory": "性价比工具",
          "tags": [
            "Ubersuggest",
            "词库分析"
          ]
        },
        {
          "url": "https://www.bing.com/webmasters/",
          "title": "Bing Webmaster Tools",
          "description": "微软必应站长管理工具，随着 Copilot 结合，必应流量权重正在大幅提升。",
          "category": "SEO 与增长",
          "subCategory": "必应官方",
          "tags": [
            "Bing Webmaster",
            "必应收录"
          ]
        },
        {
          "url": "https://plausible.io/",
          "title": "Plausible Analytics",
          "description": "完全轻量且尊重 GDPR 隐私的开源网站分析服务，无 Cookie 且脚本不足 1KB。",
          "category": "埋点与分析",
          "subCategory": "隐私分析",
          "tags": [
            "Plausible",
            "轻量统计"
          ]
        },
        {
          "url": "https://umami.is/",
          "title": "Umami",
          "description": "极简自托管网页分析方案，可自由安装在自己服务器上，完全掌握数据隐私所有权。",
          "category": "埋点与分析",
          "subCategory": "开源自建",
          "tags": [
            "Umami",
            "自托管分析"
          ]
        },
        {
          "url": "https://posthog.com/",
          "title": "PostHog",
          "description": "开源的全栈产品分析套件，涵盖会话录屏、Feature Flags 灰度与转化漏斗分析。",
          "category": "埋点与分析",
          "subCategory": "全功能套件",
          "tags": [
            "PostHog",
            "会话录屏"
          ]
        },
        {
          "url": "https://mixpanel.com/",
          "title": "Mixpanel",
          "description": "以事件驱动与漏斗分析见长的深度用户行为分析平台，洞察用户留存核心动作。",
          "category": "埋点与分析",
          "subCategory": "深度漏斗",
          "tags": [
            "Mixpanel",
            "用户留存"
          ]
        },
        {
          "url": "https://amplitude.com/",
          "title": "Amplitude",
          "description": "数字产品分析领域的领导者，提供强大的行为群组划分与流失预测模型。",
          "category": "埋点与分析",
          "subCategory": "行为群组",
          "tags": [
            "Amplitude",
            "群组分析"
          ]
        },
        {
          "url": "https://analytics.google.com/",
          "title": "Google Analytics 4 (GA4)",
          "description": "全球使用最广泛的免费网站与应用统计分析平台，广告追踪归因标配。",
          "category": "埋点与分析",
          "subCategory": "官方标配",
          "tags": [
            "GA4",
            "Google分析"
          ]
        },
        {
          "url": "https://matomo.org/",
          "title": "Matomo (原 Piwik)",
          "description": "功能极其全面的开源 Google Analytics 替代方案，100% 掌握数据产权。",
          "category": "埋点与分析",
          "subCategory": "开源替代",
          "tags": [
            "Matomo",
            "隐私合规"
          ]
        },
        {
          "url": "https://www.hotjar.com/",
          "title": "Hotjar",
          "description": "可视化用户交互热力图、录制真实访客鼠标滚动与收集微型反馈的直观工具。",
          "category": "埋点与分析",
          "subCategory": "热力图录屏",
          "tags": [
            "Hotjar",
            "热力图"
          ]
        },
        {
          "url": "https://pirsch.io/",
          "title": "Pirsch Analytics",
          "description": "德国打造的高性能无 Cookie 隐私分析工具，提供极佳的开发者接入 API。",
          "category": "埋点与分析",
          "subCategory": "欧洲合规",
          "tags": [
            "Pirsch",
            "无Cookie"
          ]
        },
        {
          "url": "https://clarity.microsoft.com/",
          "title": "Microsoft Clarity",
          "description": "微软推出的完全免费用户行为热力图与会话录屏工具，无任何流量上限限制。",
          "category": "埋点与分析",
          "subCategory": "免费热力图",
          "tags": [
            "Clarity",
            "微软免费"
          ]
        },
        {
          "url": "https://framer.com/",
          "title": "Framer",
          "description": "交互极度自由的现代可视化无代码建站工具，支持平滑炫酷动效与 CMS 内容管理。",
          "category": "落地页搭建",
          "subCategory": "动效无代码",
          "tags": [
            "Framer",
            "现代落地页"
          ]
        },
        {
          "url": "https://webflow.com/",
          "title": "Webflow",
          "description": "行业级可视化网页设计与内容管理平台，完全基于底层 CSS 盒子模型构建。",
          "category": "落地页搭建",
          "subCategory": "专业建站",
          "tags": [
            "Webflow",
            "专业设计"
          ]
        },
        {
          "url": "https://carrd.co/",
          "title": "Carrd",
          "description": "以简单、极速且超高性价比著称的单页网站构建利器，十几分钟上线 MVP。",
          "category": "落地页搭建",
          "subCategory": "超轻单页",
          "tags": [
            "Carrd",
            "极速MVP"
          ]
        },
        {
          "url": "https://typedream.com/",
          "title": "Typedream",
          "description": "像在 Notion 中打字一样轻松构建出精美现代落地页的无代码工具。",
          "category": "落地页搭建",
          "subCategory": "Notion风格",
          "tags": [
            "Typedream",
            "打字建站"
          ]
        },
        {
          "url": "https://dorik.com/",
          "title": "Dorik",
          "description": "结合 AI 生成与丰富预制模块的高性价比建站工具，原生自带博客与白标支持。",
          "category": "落地页搭建",
          "subCategory": "AI建站",
          "tags": [
            "Dorik",
            "轻量博客"
          ]
        },
        {
          "url": "https://landingsite.ai/",
          "title": "LandingSite.ai",
          "description": "输入项目提示词一键全自动生成高颜值文案与响应式界面的落地页生成器。",
          "category": "落地页搭建",
          "subCategory": "AI生成",
          "tags": [
            "LandingSite",
            "AI落地页"
          ]
        },
        {
          "url": "https://launchlist.net/",
          "title": "LaunchList",
          "description": "几行代码嵌入任何落地页的 Viral 病毒式传播 Waitlist 候补排队系统。",
          "category": "落地页搭建",
          "subCategory": "候补排队",
          "tags": [
            "LaunchList",
            "病毒传播"
          ]
        },
        {
          "url": "https://getwaitlist.com/",
          "title": "GetWaitlist",
          "description": "拥有内置积分奖励、推荐分享排行榜与防刷机制的专业 Waitlist 组件服务。",
          "category": "落地页搭建",
          "subCategory": "裂变候补",
          "tags": [
            "Waitlist",
            "裂变增长"
          ]
        },
        {
          "url": "https://earlybird.im/",
          "title": "EarlyBird",
          "description": "专为早期创业想法做概念验证 (Idea Validation) 与收集首批付费意向的工具。",
          "category": "落地页搭建",
          "subCategory": "想法验证",
          "tags": [
            "EarlyBird",
            "需求验证"
          ]
        },
        {
          "url": "https://versoly.com/",
          "title": "Versoly",
          "description": "专为 SaaS 增长设计的转化率优先落地页构建器，内置丰富的框架对比模板。",
          "category": "落地页搭建",
          "subCategory": "SaaS优化",
          "tags": [
            "Versoly",
            "高转化模板"
          ]
        },
        {
          "url": "https://resend.com/",
          "title": "Resend",
          "description": "为现代开发者打造的下一代事务邮件发送平台，拥有极佳的 API 与 React Email 支持。",
          "category": "邮件通讯",
          "subCategory": "开发者邮件",
          "tags": [
            "Resend",
            "React Email"
          ]
        },
        {
          "url": "https://react.email/",
          "title": "React Email",
          "description": "使用 React 与 TypeScript 组件编写精美响应式跨客户端邮件模板的开源套件。",
          "category": "邮件通讯",
          "subCategory": "组件化邮件",
          "tags": [
            "ReactEmail",
            "组件化"
          ]
        },
        {
          "url": "https://postmarkapp.com/",
          "title": "Postmark",
          "description": "业内享有极高声誉的闪电级事务邮件投递平台，以极高的收件箱进信率著称。",
          "category": "邮件通讯",
          "subCategory": "极高进信率",
          "tags": [
            "Postmark",
            "事务邮件"
          ]
        },
        {
          "url": "https://buttondown.email/",
          "title": "Buttondown",
          "description": "面向独立作者与极客的轻量级优雅邮件订阅托管平台，完美支持 Markdown。",
          "category": "邮件通讯",
          "subCategory": "极客通讯",
          "tags": [
            "Buttondown",
            "Markdown邮件"
          ]
        },
        {
          "url": "https://substack.com/",
          "title": "Substack",
          "description": "全球知名的内容创作者订阅与付费 Newsletter 平台，自带庞大读者推荐网络。",
          "category": "邮件通讯",
          "subCategory": "付费订阅网",
          "tags": [
            "Substack",
            "读者生态"
          ]
        },
        {
          "url": "https://ghost.org/",
          "title": "Ghost",
          "description": "现代开源独立发布平台，将博客网站与邮件订阅列表完美融合在同一个系统中。",
          "category": "邮件通讯",
          "subCategory": "独立博客通讯",
          "tags": [
            "Ghost",
            "独立发布"
          ]
        },
        {
          "url": "https://mailchimp.com/",
          "title": "Mailchimp",
          "description": "历史悠久的大型邮件营销自动化平台，提供完备的用户生命周期旅程编排。",
          "category": "邮件通讯",
          "subCategory": "综合营销",
          "tags": [
            "Mailchimp",
            "自动化旅程"
          ]
        },
        {
          "url": "https://www.brevo.com/",
          "title": "Brevo (原 Sendinblue)",
          "description": "欧洲顶尖性价比的多渠道营销套件，按发送量计费且包含事务邮件与短信。",
          "category": "邮件通讯",
          "subCategory": "多渠道套件",
          "tags": [
            "Brevo",
            "高性价比"
          ]
        },
        {
          "url": "https://convertkit.com/",
          "title": "Kit (原 ConvertKit)",
          "description": "专为创作者打造的受众增长与自动化邮件漏斗平台，商业化流程成熟。",
          "category": "邮件通讯",
          "subCategory": "创作者漏斗",
          "tags": [
            "Kit",
            "自动化营销"
          ]
        },
        {
          "url": "https://mailgun.com/",
          "title": "Mailgun",
          "description": "老牌针对开发者的强大云端邮件 API 服务，支持邮件解析与大规模发送。",
          "category": "邮件通讯",
          "subCategory": "邮件API",
          "tags": [
            "Mailgun",
            "批量发送"
          ]
        },
        {
          "url": "https://crowdin.com/",
          "title": "Crowdin",
          "description": "出海软件团队首选的本地化管理平台，与 GitHub 自动同步多语言翻译词条。",
          "category": "出海创作",
          "subCategory": "本地化协同",
          "tags": [
            "Crowdin",
            "多语言"
          ]
        },
        {
          "url": "https://lokalise.com/",
          "title": "Lokalise",
          "description": "现代化软件多语言本地化平台，提供极速审查工作流与高阶自动化集成。",
          "category": "出海创作",
          "subCategory": "持续本地化",
          "tags": [
            "Lokalise",
            "跨语言"
          ]
        },
        {
          "url": "https://deepl.com/translator",
          "title": "DeepL 翻译器",
          "description": "全球公认翻译语调极其自然地道、上下文理解精准的神经网络翻译标杆。",
          "category": "出海创作",
          "subCategory": "高精度翻译",
          "tags": [
            "DeepL",
            "自然地道"
          ]
        },
        {
          "url": "https://www.i18next.com/",
          "title": "i18next",
          "description": "JavaScript 生态中历史悠久、功能最全的多语言国际化处理标准开源框架。",
          "category": "出海创作",
          "subCategory": "国际化框架",
          "tags": [
            "i18next",
            "前端国际化"
          ]
        },
        {
          "url": "https://next-intl-docs.vercel.app/",
          "title": "next-intl",
          "description": "Next.js App Router 官方推荐的深度无缝国际化多语言路由与翻译组件库。",
          "category": "出海创作",
          "subCategory": "Next.js国际化",
          "tags": [
            "next-intl",
            "AppRouter"
          ]
        },
        {
          "url": "https://tolgee.io/",
          "title": "Tolgee",
          "description": "开源且支持在网页中 Alt+Click 原地翻译并即时保存的现代本地化工具平台。",
          "category": "出海创作",
          "subCategory": "原地翻译",
          "tags": [
            "Tolgee",
            "开源本地化"
          ]
        },
        {
          "url": "https://weblate.org/",
          "title": "Weblate",
          "description": "自由开源的网页版协同本地化平台，与 Git 深度整合且广泛用于开源项目翻译。",
          "category": "出海创作",
          "subCategory": "开源翻译平台",
          "tags": [
            "Weblate",
            "Git双向同步"
          ]
        },
        {
          "url": "https://inlang.com/",
          "title": "inlang",
          "description": "基于 Git 构建的无服务器国际化基础设施生态，支持在 VS Code 中内联预览翻译。",
          "category": "出海创作",
          "subCategory": "Git原生国际化",
          "tags": [
            "inlang",
            "开发者友好"
          ]
        },
        {
          "url": "https://grammarly.com/",
          "title": "Grammarly",
          "description": "出海撰写英文营销文案与冷启动邮件的语法润色、拼写纠错与语气优化神器。",
          "category": "出海创作",
          "subCategory": "英文润色",
          "tags": [
            "Grammarly",
            "语法纠错"
          ]
        },
        {
          "url": "https://hemingwayapp.com/",
          "title": "Hemingway Editor",
          "description": "分析英文句子可读性等级、剔除冗余复杂句式的经典文案打磨编辑器。",
          "category": "出海创作",
          "subCategory": "可读性优化",
          "tags": [
            "Hemingway",
            "文案优化"
          ]
        },
        {
          "url": "https://www.producthunt.com/",
          "title": "Product Hunt",
          "description": "全球新产品发布的最高舞台，出海独立黑客获取首批种子用户的第一战阵地。",
          "category": "社媒与增长",
          "subCategory": "产品发布",
          "tags": [
            "Product Hunt",
            "首发流量"
          ]
        },
        {
          "url": "https://buffer.com/",
          "title": "Buffer",
          "description": "直观易用的社交媒体定时排程发帖工具，统一管理 X、LinkedIn、Instagram 矩阵。",
          "category": "社媒与增长",
          "subCategory": "社媒排程",
          "tags": [
            "Buffer",
            "自动化发帖"
          ]
        },
        {
          "url": "https://typefully.com/",
          "title": "Typefully",
          "description": "专为 X (Twitter) 打造的极度高颜值写作、Thread 串联排版与数据分析工具。",
          "category": "社媒与增长",
          "subCategory": "推特排版",
          "tags": [
            "Typefully",
            "Twitter增长"
          ]
        },
        {
          "url": "https://hypefury.com/",
          "title": "Hypefury",
          "description": "自动化社交媒体增长加速器，支持自动转推优质推文与跨平台自动同步发布。",
          "category": "社媒与增长",
          "subCategory": "推特增长",
          "tags": [
            "Hypefury",
            "自动转推"
          ]
        },
        {
          "url": "https://betalist.com/",
          "title": "BetaList",
          "description": "发现未上线的早期科技创业项目并在产品公测前积累早期核心拥趸的平台。",
          "category": "社媒与增长",
          "subCategory": "早期公测",
          "tags": [
            "BetaList",
            "公测预订"
          ]
        },
        {
          "url": "https://www.reddit.com/r/SideProject/",
          "title": "Reddit r/SideProject",
          "description": "全球独立开发者展示自己业余副业项目的活跃子版块，反馈极其真实坦率。",
          "category": "社媒与增长",
          "subCategory": "社区反馈",
          "tags": [
            "Reddit",
            "副业交流"
          ]
        },
        {
          "url": "https://news.ycombinator.com/show",
          "title": "Show HN (Hacker News)",
          "description": "向硅谷最硬核的黑客与技术人群展示你的作品，顶级流量与严肃技术评审来源。",
          "category": "社媒与增长",
          "subCategory": "硬核首发",
          "tags": [
            "Show HN",
            "黑客新闻"
          ]
        },
        {
          "url": "https://www.feedly.com/",
          "title": "Feedly",
          "description": "追踪全球行业顶尖博客与新闻资讯的专业 RSS 聚合器，监控竞品动态。",
          "category": "社媒与增长",
          "subCategory": "行业资讯",
          "tags": [
            "Feedly",
            "情报追踪"
          ]
        },
        {
          "url": "https://tweetdeck.twitter.com/",
          "title": "X Pro (原 TweetDeck)",
          "description": "多栏位实时监控关键词、特定话题讨论与潜在客户求助的专业控制台。",
          "category": "社媒与增长",
          "subCategory": "实时监控",
          "tags": [
            "X Pro",
            "多列监控"
          ]
        },
        {
          "url": "https://fedy.io/",
          "title": "Fedy",
          "description": "开源的联邦宇宙去中心化社交媒体跨平台广播发布工具。",
          "category": "社媒与增长",
          "subCategory": "联邦分发",
          "tags": [
            "Fedy",
            "去中心化"
          ]
        },
        {
          "url": "https://nextjs.org/docs",
          "title": "Next.js 官方架构指南",
          "description": "Vercel 旗舰框架，全功能服务端渲染与边缘执行，出海 SaaS 首选全栈框架。",
          "category": "核心框架",
          "subCategory": "主流首选",
          "tags": [
            "Next.js",
            "全栈框架"
          ]
        },
        {
          "url": "https://remix.run/docs",
          "title": "Remix 官方文档",
          "description": "以 Web 标准与极致数据加载弹性著称的 React 全栈框架，路由嵌套体验极佳。",
          "category": "核心框架",
          "subCategory": "Web标准",
          "tags": [
            "Remix",
            "ReactRouter"
          ]
        },
        {
          "url": "https://astro.build/themes/",
          "title": "Astro 官方出海模版库",
          "description": "专为轻量营销博客、文档与内容型站点打造的零 JS 开销框架主题集。",
          "category": "核心框架",
          "subCategory": "内容框架",
          "tags": [
            "Astro",
            "内容出海"
          ]
        },
        {
          "url": "https://nuxt.com/docs",
          "title": "Nuxt 官方参考文档",
          "description": "Vue 阵营首屈一指的全栈解决方案，出色的模块体系让配置少写 80%。",
          "category": "核心框架",
          "subCategory": "Vue全栈",
          "tags": [
            "Nuxt",
            "Vue3"
          ]
        },
        {
          "url": "https://svelte.dev/docs/kit",
          "title": "SvelteKit 官方手册",
          "description": "极简响应式编译框架 Svelte 的官方应用框架，打包体积小到令人惊叹。",
          "category": "核心框架",
          "subCategory": "极小体积",
          "tags": [
            "SvelteKit",
            "编译型全栈"
          ]
        },
        {
          "url": "https://vitejs.dev/",
          "title": "Vite",
          "description": "现代前端模块化构建利器，几毫秒内极速启动本地开发服务器。",
          "category": "核心框架",
          "subCategory": "构建工具",
          "tags": [
            "Vite",
            "开发体验"
          ]
        },
        {
          "url": "https://tanstack.com/start",
          "title": "TanStack Start",
          "description": "TanStack 团队打造的全新全栈 React 框架，拥有最顶级的类型安全数据流。",
          "category": "核心框架",
          "subCategory": "类型安全全栈",
          "tags": [
            "TanStack",
            "完全类型安全"
          ]
        },
        {
          "url": "https://redwoodjs.com/",
          "title": "RedwoodJS",
          "description": "专为初创企业设计的全功能集成全栈框架，内置 GraphQL、认证与数据库迁移。",
          "category": "核心框架",
          "subCategory": "初创全套",
          "tags": [
            "Redwood",
            "初创框架"
          ]
        },
        {
          "url": "https://blitzjs.com/",
          "title": "Blitz.js",
          "description": "无 API 架构理念全栈框架，像在本地调用函数一样直接与数据库通信。",
          "category": "核心框架",
          "subCategory": "无API理念",
          "tags": [
            "Blitz",
            "快速上线"
          ]
        },
        {
          "url": "https://adonisjs.com/",
          "title": "AdonisJS",
          "description": "TypeScript 原生具备优雅 MVC 结构的服务端全栈框架，Laravel 的 TS 精神续作。",
          "category": "核心框架",
          "subCategory": "TS-MVC",
          "tags": [
            "AdonisJS",
            "全栈框架"
          ]
        },
        {
          "url": "https://supabase.com/",
          "title": "Supabase",
          "description": "开源 Firebase 替代品，几秒内获得带 Auth、Realtime 与 pgvector 的 Postgres 数据库。",
          "category": "全栈与服务端",
          "subCategory": "BaaS中枢",
          "tags": [
            "Supabase",
            "BaaS"
          ]
        },
        {
          "url": "https://convex.dev/",
          "title": "Convex",
          "description": "反应式全栈后端平台，将后端代码与数据库深度融合，实现数据实时自动响应。",
          "category": "全栈与服务端",
          "subCategory": "反应式后端",
          "tags": [
            "Convex",
            "实时数据"
          ]
        },
        {
          "url": "https://firebase.google.com/",
          "title": "Google Firebase",
          "description": "Google 旗下老牌成熟的移动与 Web 应用后端云，免除一切底层运维负担。",
          "category": "全栈与服务端",
          "subCategory": "经典BaaS",
          "tags": [
            "Firebase",
            "Google云"
          ]
        },
        {
          "url": "https://pocketbase.io/",
          "title": "PocketBase",
          "description": "单文件嵌入式开源后端，集成实时 SQLite 数据库、用户认证与文件存储。",
          "category": "全栈与服务端",
          "subCategory": "单文件BaaS",
          "tags": [
            "PocketBase",
            "极轻后端"
          ]
        },
        {
          "url": "https://appwrite.io/",
          "title": "Appwrite",
          "description": "自托管的安全端到端后端服务套件，提供完整的认证、存储与函数计算能力。",
          "category": "全栈与服务端",
          "subCategory": "开源BaaS",
          "tags": [
            "Appwrite",
            "自托管后端"
          ]
        },
        {
          "url": "https://neon.tech/",
          "title": "Neon Serverless Postgres",
          "description": "现代云原生无服务器 Postgres，几秒内创建完整开发分支，按需瞬间唤醒。",
          "category": "全栈与服务端",
          "subCategory": "ServerlessDB",
          "tags": [
            "Neon",
            "分支数据库"
          ]
        },
        {
          "url": "https://upstash.com/",
          "title": "Upstash (Redis/QStash)",
          "description": "按请求次数计费的无服务器 Redis 与 Kafka，适合边缘计算与长效定时调度。",
          "category": "全栈与服务端",
          "subCategory": "Serverless缓存",
          "tags": [
            "Upstash",
            "按量付费"
          ]
        },
        {
          "url": "https://prisma.io/",
          "title": "Prisma ORM",
          "description": "下一代类型安全 Node.js & TypeScript ORM，拥有极佳的数据迁移与自动补全体验。",
          "category": "全栈与服务端",
          "subCategory": "现代ORM",
          "tags": [
            "Prisma",
            "类型安全ORM"
          ]
        },
        {
          "url": "https://orm.drizzle.team/",
          "title": "Drizzle ORM",
          "description": "零开销、轻量极速且完全类型安全的现代 TypeScript SQL 查询构建器。",
          "category": "全栈与服务端",
          "subCategory": "极轻ORM",
          "tags": [
            "Drizzle",
            "SQL构建器"
          ]
        },
        {
          "url": "https://hasura.io/",
          "title": "Hasura",
          "description": "即刻将现有数据库一键生成即用高安全 GraphQL 与 REST API 的引擎。",
          "category": "全栈与服务端",
          "subCategory": "即时API",
          "tags": [
            "Hasura",
            "GraphQL引擎"
          ]
        },
        {
          "url": "https://shipfa.st/",
          "title": "ShipFast (Marc Lou)",
          "description": "全球独立黑客爆款 Next.js SaaS 启动模板，内置 Stripe、Auth 与事务邮件。",
          "category": "低代码搭建",
          "subCategory": "启动样板间",
          "tags": [
            "ShipFast",
            "爆款模板"
          ]
        },
        {
          "url": "https://makerkit.dev/",
          "title": "MakerKit",
          "description": "企业级 SaaS 样板间，提供多租户、团队席位、RBAC 权限与计费门户全套支持。",
          "category": "低代码搭建",
          "subCategory": "多租户样板",
          "tags": [
            "MakerKit",
            "多租户"
          ]
        },
        {
          "url": "https://shadcn.io/templates",
          "title": "shadcn/ui 官方生态模版",
          "description": "基于流行设计系统衍生出的各类开箱即用高质量 SaaS 仪表盘模版集。",
          "category": "低代码搭建",
          "subCategory": "界面模版",
          "tags": [
            "shadcn",
            "SaaS后台"
          ]
        },
        {
          "url": "https://refine.dev/",
          "title": "Refine",
          "description": "基于 React 的元框架，以令人惊叹的速度快速开发内部工具、管理面板与 B2B 应用。",
          "category": "低代码搭建",
          "subCategory": "内部面板框架",
          "tags": [
            "Refine",
            "管理后台"
          ]
        },
        {
          "url": "https://strapi.io/",
          "title": "Strapi",
          "description": "全球最受欢迎的开源无头 CMS (Headless CMS)，支持完全自主托管与自定义内容模型。",
          "category": "低代码搭建",
          "subCategory": "无头CMS",
          "tags": [
            "Strapi",
            "HeadlessCMS"
          ]
        },
        {
          "url": "https://payloadcms.com/",
          "title": "Payload CMS",
          "description": "纯 TypeScript 打造的代码优先现代全栈无头内容管理系统，深度融入 Next.js。",
          "category": "低代码搭建",
          "subCategory": "TS优先CMS",
          "tags": [
            "Payload",
            "代码优先"
          ]
        },
        {
          "url": "https://directus.io/",
          "title": "Directus",
          "description": "在任意 SQL 数据库之上快速搭建即时 API 与实时数据协作管理后厨的开源平台。",
          "category": "低代码搭建",
          "subCategory": "数据后台",
          "tags": [
            "Directus",
            "开源数据层"
          ]
        },
        {
          "url": "https://budibase.com/",
          "title": "Budibase",
          "description": "开源低代码平台，几分钟连接内部数据库并生成美观的业务审批流与内管系统。",
          "category": "低代码搭建",
          "subCategory": "开源低代码",
          "tags": [
            "Budibase",
            "内部流程"
          ]
        },
        {
          "url": "https://appsmith.com/",
          "title": "Appsmith",
          "description": "开源的低代码应用构建器，用拖拽组件和编写简单 JS 快速构建内部管理工具。",
          "category": "低代码搭建",
          "subCategory": "低代码构建",
          "tags": [
            "Appsmith",
            "拖拽界面"
          ]
        },
        {
          "url": "https://tooljet.com/",
          "title": "ToolJet",
          "description": "开源的 Retool 替代品，支持安全连接云端服务并快速拼装可视化企业工具。",
          "category": "低代码搭建",
          "subCategory": "企业工具",
          "tags": [
            "ToolJet",
            "Retool替代"
          ]
        },
        {
          "url": "https://ui.shadcn.com/",
          "title": "shadcn/ui",
          "description": "设计极美且支持源码直接复制到工程的无头组件规范，现代 SaaS 界面事实标准。",
          "category": "组件与 UI 体系",
          "subCategory": "行业标杆",
          "tags": [
            "shadcn/ui",
            "设计规范"
          ]
        },
        {
          "url": "https://tailwindcss.com/",
          "title": "Tailwind CSS",
          "description": "原子化优先的现代实用 CSS 框架，彻底改变全球 Web 前端开发样式编写方式。",
          "category": "组件与 UI 体系",
          "subCategory": "样式框架",
          "tags": [
            "Tailwind",
            "原子化CSS"
          ]
        },
        {
          "url": "https://www.radix-ui.com/",
          "title": "Radix UI",
          "description": "无样式、注重无障碍访问 (a11y) 与键盘导航的高可靠基础交互组件基底。",
          "category": "组件与 UI 体系",
          "subCategory": "无头组件",
          "tags": [
            "Radix",
            "无障碍"
          ]
        },
        {
          "url": "https://lucide.dev/",
          "title": "Lucide Icons",
          "description": "简洁、优雅、一致且开源的现代化图标集合，拥有极佳的轻量无缝多框架支持。",
          "category": "组件与 UI 体系",
          "subCategory": "通用图标",
          "tags": [
            "Lucide",
            "精美图标"
          ]
        },
        {
          "url": "https://magicui.design/",
          "title": "Magic UI",
          "description": "专为高转化现代着陆页打造的炫酷、流畅动态组件与微动效库。",
          "category": "组件与 UI 体系",
          "subCategory": "特效组件",
          "tags": [
            "MagicUI",
            "动效组件"
          ]
        },
        {
          "url": "https://aceternity.com/",
          "title": "Aceternity UI",
          "description": "充满未来科技感的 React 交互组件库，让落地页瞬间拥有科技独角兽质感。",
          "category": "组件与 UI 体系",
          "subCategory": "未来感设计",
          "tags": [
            "Aceternity",
            "动效界面"
          ]
        },
        {
          "url": "https://nextui.org/",
          "title": "NextUI / HeroUI",
          "description": "视觉精美、自带出彩平滑暗黑模式切换的现代化 React 前端组件库。",
          "category": "组件与 UI 体系",
          "subCategory": "高颜值组件",
          "tags": [
            "NextUI",
            "暗黑模式"
          ]
        },
        {
          "url": "https://headlessui.com/",
          "title": "Headless UI",
          "description": "Tailwind CSS 官方出品的完全无样式、完全可访问的 React/Vue 交互组件。",
          "category": "组件与 UI 体系",
          "subCategory": "官方无头",
          "tags": [
            "HeadlessUI",
            "官方组件"
          ]
        },
        {
          "url": "https://chakra-ui.com/",
          "title": "Chakra UI",
          "description": "简单、模块化且支持语义化样式的经典组件库，轻松构建符合无障碍规范的界面。",
          "category": "组件与 UI 体系",
          "subCategory": "模块化组件",
          "tags": [
            "Chakra",
            "无障碍友好"
          ]
        },
        {
          "url": "https://mantine.dev/",
          "title": "Mantine",
          "description": "功能极其完备的 React 现代组件与 Hook 库，涵盖从表单、图表到通知一切需求。",
          "category": "组件与 UI 体系",
          "subCategory": "全能组件",
          "tags": [
            "Mantine",
            "全套组件"
          ]
        },
        {
          "url": "https://vercel.com/",
          "title": "Vercel",
          "description": "前端开发者的全球边缘交付云，免运维提供全球 CDN、自动预览与无服务器计算。",
          "category": "IaC 与云厂商",
          "subCategory": "边缘交付",
          "tags": [
            "Vercel",
            "前端云"
          ]
        },
        {
          "url": "https://www.cloudflare.com/",
          "title": "Cloudflare",
          "description": "全球互联网基础设施安全与边缘加速巨头，提供免费的高防 DNS 与安全防护。",
          "category": "IaC 与云厂商",
          "subCategory": "安全与CDN",
          "tags": [
            "Cloudflare",
            "高防加速"
          ]
        },
        {
          "url": "https://railway.com/",
          "title": "Railway",
          "description": "现代云基础设施开发平台，消除基础设施复杂度，支持全语言全服务一键上线。",
          "category": "IaC 与云厂商",
          "subCategory": "简单PaaS",
          "tags": [
            "Railway",
            "极简部署"
          ]
        },
        {
          "url": "https://fly.io/docs/",
          "title": "Fly.io 开发者平台",
          "description": "将微型服务器物理靠近全球目标用户的现代云，让轻量全栈应用全球低延迟。",
          "category": "IaC 与云厂商",
          "subCategory": "全球边缘",
          "tags": [
            "Fly.io",
            "低延迟"
          ]
        },
        {
          "url": "https://www.hetzner.com/",
          "title": "Hetzner Online",
          "description": "欧洲以极致性价比著称的老牌独立服务器与高性能云主机服务商，成本极其节省。",
          "category": "IaC 与云厂商",
          "subCategory": "极高性价比",
          "tags": [
            "Hetzner",
            "低价高配"
          ]
        },
        {
          "url": "https://www.digitalocean.com/",
          "title": "DigitalOcean",
          "description": "专为开发者设计的简单易懂云主机与托管数据库，以实惠的 Droplet 闻名。",
          "category": "IaC 与云厂商",
          "subCategory": "开发者云",
          "tags": [
            "DigitalOcean",
            "经典云主机"
          ]
        },
        {
          "url": "https://porkbun.com/",
          "title": "Porkbun",
          "description": "口碑绝佳且续费极其公道无套路的现代域名注册商，出海注册域名的极佳选择。",
          "category": "IaC 与云厂商",
          "subCategory": "良心域名商",
          "tags": [
            "Porkbun",
            "域名注册"
          ]
        },
        {
          "url": "https://namecheap.com/",
          "title": "Namecheap",
          "description": "老牌国际域名注册服务商，支持丰富优惠代码并提供终身免费隐私保护。",
          "category": "IaC 与云厂商",
          "subCategory": "域名托管",
          "tags": [
            "Namecheap",
            "隐私保护"
          ]
        },
        {
          "url": "https://www.terraform.io/",
          "title": "Terraform by HashiCorp",
          "description": "代码化基础设施 (IaC) 的行业绝对标准，用声明式配置跨多云自动化配置资源。",
          "category": "IaC 与云厂商",
          "subCategory": "IaC标准",
          "tags": [
            "Terraform",
            "代码化云"
          ]
        },
        {
          "url": "https://www.pulumi.com/",
          "title": "Pulumi",
          "description": "使用真正的编程语言（TypeScript、Python、Go）来编排与部署云资源的现代 IaC 平台。",
          "category": "IaC 与云厂商",
          "subCategory": "编程IaC",
          "tags": [
            "Pulumi",
            "代码化编排"
          ]
        },
        {
          "url": "https://inngest.com/docs",
          "title": "Inngest 官方文档",
          "description": "为现代全栈应用打造的事件驱动耐久工作流引擎，消除后台任务超时难题。",
          "category": "无服务器与事件",
          "subCategory": "耐久工作流",
          "tags": [
            "Inngest",
            "耐久执行"
          ]
        },
        {
          "url": "https://trigger.dev/docs",
          "title": "Trigger.dev 官方指南",
          "description": "全开源、免超时困扰的长任务执行引擎，支持在代码中轻松编排 AI 与长处理流。",
          "category": "无服务器与事件",
          "subCategory": "开源后台引擎",
          "tags": [
            "Trigger.dev",
            "后台作业"
          ]
        },
        {
          "url": "https://upstash.com/docs/redis/overall/getstarted",
          "title": "Upstash Redis 入门",
          "description": "免维护的按量计费 Serverless 键值数据库，原生支持边缘请求限流与缓存。",
          "category": "无服务器与事件",
          "subCategory": "按量计费",
          "tags": [
            "Upstash",
            "边缘缓存"
          ]
        },
        {
          "url": "https://qstash.upstash.com/",
          "title": "QStash 消息调度",
          "description": "专为 Serverless 架构设计的无服务器消息队列与延迟定时发布分发系统。",
          "category": "无服务器与事件",
          "subCategory": "延迟队列",
          "tags": [
            "QStash",
            "定时分发"
          ]
        },
        {
          "url": "https://quirrel.dev/",
          "title": "Quirrel",
          "description": "简单无痛处理 Next.js 延迟任务与定时调度的开源利器，现已并入 Netlify。",
          "category": "无服务器与事件",
          "subCategory": "延迟调度",
          "tags": [
            "Quirrel",
            "定时任务"
          ]
        },
        {
          "url": "https://www.zeplo.io/",
          "title": "Zeplo",
          "description": "极简的请求排队与重试中间件，发送一个 HTTP 请求即可轻松实现延迟或定时回调。",
          "category": "无服务器与事件",
          "subCategory": "重试中间件",
          "tags": [
            "Zeplo",
            "自动重试"
          ]
        },
        {
          "url": "https://cron-job.org/en/",
          "title": "cron-job.org",
          "description": "完全免费且高可靠的网页定时任务调用服务，按设定周期准时唤醒你的云端接口。",
          "category": "无服务器与事件",
          "subCategory": "免费定时器",
          "tags": [
            "cron-job",
            "定时监控"
          ]
        },
        {
          "url": "https://svix.com/",
          "title": "Svix",
          "description": "企业级 Webhooks 发送即服务平台，几行代码为你的出海 SaaS 赋予专业回调能力。",
          "category": "无服务器与事件",
          "subCategory": "Webhook服务",
          "tags": [
            "Svix",
            "Webhooks"
          ]
        },
        {
          "url": "https://hookdeck.com/",
          "title": "Hookdeck",
          "description": "专为入站 Webhook 打造的可靠事件网关，提供请求排队、重试与故障捕获恢复。",
          "category": "无服务器与事件",
          "subCategory": "事件网关",
          "tags": [
            "Hookdeck",
            "接收网关"
          ]
        },
        {
          "url": "https://smee.io/",
          "title": "Smee.io",
          "description": "由 GitHub 维护的轻量 Webhook 本地调试转发代理，免公网 IP 调试各种回调事件。",
          "category": "无服务器与事件",
          "subCategory": "本地调试",
          "tags": [
            "Smee",
            "Webhook调试"
          ]
        },
        {
          "url": "https://clerk.com/docs",
          "title": "Clerk 官方文档",
          "description": "专为 Next.js 与现代 Web 打造的开箱即用用户认证系统，界面精美且支持多租户。",
          "category": "应用与密钥安全",
          "subCategory": "开箱即用认证",
          "tags": [
            "Clerk",
            "用户系统"
          ]
        },
        {
          "url": "https://authjs.dev/",
          "title": "Auth.js (NextAuth.js)",
          "description": "完全开源且自由掌握所有用户数据的轻量身份验证库，支持数十种 OAuth 服务商。",
          "category": "应用与密钥安全",
          "subCategory": "开源认证",
          "tags": [
            "Auth.js",
            "NextAuth"
          ]
        },
        {
          "url": "https://lucia-auth.com/",
          "title": "Lucia Auth",
          "description": "现代极简、贴近底层会话理念的开源用户授权机制指南与实践范式。",
          "category": "应用与密钥安全",
          "subCategory": "会话管理",
          "tags": [
            "Lucia",
            "会话控制"
          ]
        },
        {
          "url": "https://kinde.com/",
          "title": "Kinde",
          "description": "专为初创团队与 SaaS 构建的现代身份验证、功能开关与用户计费统一平台。",
          "category": "应用与密钥安全",
          "subCategory": "初创身份",
          "tags": [
            "Kinde",
            "用户认证"
          ]
        },
        {
          "url": "https://supabase.com/auth",
          "title": "Supabase Auth",
          "description": "深度集成于 Postgres 数据库行级安全 (RLS) 的内置用户认证体系，极度安全可靠。",
          "category": "应用与密钥安全",
          "subCategory": "数据库安全",
          "tags": [
            "Supabase Auth",
            "行级安全"
          ]
        },
        {
          "url": "https://logto.io/",
          "title": "Logto",
          "description": "类似 Auth0 但更轻量好用的开源身份基础设施，几分钟构建出海统一登录页。",
          "category": "应用与密钥安全",
          "subCategory": "开源Auth0",
          "tags": [
            "Logto",
            "自托管登录"
          ]
        },
        {
          "url": "https://arcjet.com/",
          "title": "Arcjet",
          "description": "专为 Next.js 开发者打造的内置安全防护库，提供请求速率限制、机器人拦截与防攻击。",
          "category": "应用与密钥安全",
          "subCategory": "应用级安全",
          "tags": [
            "Arcjet",
            "限流防刷"
          ]
        },
        {
          "url": "https://infisical.com/docs/documentation/getting-started/introduction",
          "title": "Infisical 官方快速开始",
          "description": "端到端加密环境变量与 API 密钥管理平台，团队协作免遭密码泄露事故。",
          "category": "应用与密钥安全",
          "subCategory": "密钥管理",
          "tags": [
            "Infisical",
            "环境变量安全"
          ]
        },
        {
          "url": "https://www.hcaptcha.com/",
          "title": "hCaptcha",
          "description": "保护网站免受机器人与自动化攻击的隐私优先人机验证解决方案。",
          "category": "应用与密钥安全",
          "subCategory": "人机验证",
          "tags": [
            "hCaptcha",
            "防机器人"
          ]
        },
        {
          "url": "https://developers.cloudflare.com/turnstile/",
          "title": "Cloudflare Turnstile",
          "description": "用户无需点击繁琐红绿灯图片的无感智能人机验证，彻底提升注册转化率。",
          "category": "应用与密钥安全",
          "subCategory": "无感人机验证",
          "tags": [
            "Turnstile",
            "无感验证"
          ]
        },
        {
          "url": "https://canny.io/",
          "title": "Canny",
          "description": "用户反馈收集、路线图规划与功能投票看板的经典行业事实标准平台。",
          "category": "项目与研发管理",
          "subCategory": "反馈看板",
          "tags": [
            "Canny",
            "用户反馈"
          ]
        },
        {
          "url": "https://featurebase.app/",
          "title": "Featurebase",
          "description": "现代、极速且高性价比的用户反馈追踪与公开发布路线图平台，Canny 的新锐竞品。",
          "category": "项目与研发管理",
          "subCategory": "高性价比反馈",
          "tags": [
            "Featurebase",
            "路线图"
          ]
        },
        {
          "url": "https://linear.app/",
          "title": "Linear",
          "description": "以极致丝滑体验与高键盘效率闻名的现代敏捷研发管理工具，科技独角兽标配。",
          "category": "项目与研发管理",
          "subCategory": "敏捷研发",
          "tags": [
            "Linear",
            "极速体验"
          ]
        },
        {
          "url": "https://plain.com/",
          "title": "Plain",
          "description": "专为 B2B SaaS 团队打造的现代化统一客服支持与用户沟通工单平台。",
          "category": "项目与研发管理",
          "subCategory": "客户工单",
          "tags": [
            "Plain",
            "B2B客服"
          ]
        },
        {
          "url": "https://crisp.chat/zh/",
          "title": "Crisp",
          "description": "全功能客户沟通与在线实时在线客服咨询系统，支持邮件联动与知识库。",
          "category": "项目与研发管理",
          "subCategory": "在线客服",
          "tags": [
            "Crisp",
            "实时聊天"
          ]
        },
        {
          "url": "https://notice.studio/",
          "title": "Notice",
          "description": "将 FAQ 常见问题、帮助中心、更新日志与隐私协议一站式托管发布的内容中心。",
          "category": "项目与研发管理",
          "subCategory": "帮助中心",
          "tags": [
            "Notice",
            "FAQ中心"
          ]
        },
        {
          "url": "https://headwayapp.co/",
          "title": "Headway",
          "description": "嵌入式产品更新日志 (Changelog) 小部件，让你的老用户即时感知软件功能迭代。",
          "category": "项目与研发管理",
          "subCategory": "更新日志",
          "tags": [
            "Headway",
            "Changelog"
          ]
        },
        {
          "url": "https://beamer.com/",
          "title": "Beamer",
          "description": "支持向应用内推送新功能公告、收集 NPS 满意度并驱动老用户复购的通知中心。",
          "category": "项目与研发管理",
          "subCategory": "应用内通知",
          "tags": [
            "Beamer",
            "功能公告"
          ]
        },
        {
          "url": "https://trello.com/",
          "title": "Trello",
          "description": "经典直观的看板项目管理工具，小团队与个人规划阶段任务的经典轻量选择。",
          "category": "项目与研发管理",
          "subCategory": "经典看板",
          "tags": [
            "Trello",
            "轻量管理"
          ]
        },
        {
          "url": "https://height.app/",
          "title": "Height",
          "description": "AI 自动分配与整理产品待办项的新一代团队协同项目与任务管理平台。",
          "category": "项目与研发管理",
          "subCategory": "智能协同",
          "tags": [
            "Height",
            "智能待办"
          ]
        },
        {
          "url": "https://tally.so/",
          "title": "Tally",
          "description": "免费且像在 Notion 中打字一样极简构建复杂逻辑表单的神器，独立开发者首选。",
          "category": "表单与问卷",
          "subCategory": "极简表单",
          "tags": [
            "Tally",
            "Notion风格表单"
          ]
        },
        {
          "url": "https://typeform.com/",
          "title": "Typeform",
          "description": "交互体验极其高级的一题一问式人机对话表单开创者，出海转化率标杆。",
          "category": "表单与问卷",
          "subCategory": "高质对话表单",
          "tags": [
            "Typeform",
            "高转化"
          ]
        },
        {
          "url": "https://fillout.com/",
          "title": "Fillout",
          "description": "深度打通 Airtable、Notion 与外部数据库的高级多步骤动态逻辑表单工具。",
          "category": "表单与问卷",
          "subCategory": "数据联动表单",
          "tags": [
            "Fillout",
            "复杂逻辑"
          ]
        },
        {
          "url": "https://formspree.io/",
          "title": "Formspree",
          "description": "无需编写任何服务端代码，纯 HTML 表单直接提交并发送邮件到邮箱的 API 服务。",
          "category": "表单与问卷",
          "subCategory": "表单API",
          "tags": [
            "Formspree",
            "无代码后端"
          ]
        },
        {
          "url": "https://getform.io/",
          "title": "Getform",
          "description": "易于集成的前端表单处理端点，支持附件上传、自动化 Zapier 触发与防垃圾邮件。",
          "category": "表单与问卷",
          "subCategory": "表单端点",
          "tags": [
            "Getform",
            "自动化联动"
          ]
        },
        {
          "url": "https://formbricks.com/",
          "title": "Formbricks",
          "description": "开源的定点用户调研与 NPS 微问卷工具，精准在用户执行特定操作后即时触发。",
          "category": "表单与问卷",
          "subCategory": "应用内微调研",
          "tags": [
            "Formbricks",
            "开源调研"
          ]
        },
        {
          "url": "https://opnform.com/",
          "title": "OpnForm",
          "description": "完全开源且可自托管的在线表单制作平台，内置强大的逻辑跳转与通知。",
          "category": "表单与问卷",
          "subCategory": "开源自建",
          "tags": [
            "OpnForm",
            "自托管表单"
          ]
        },
        {
          "url": "https://formkeep.com/",
          "title": "FormKeep",
          "description": "专为网页设计师与前端开发者打造的无头表单端点与数据收集后端服务。",
          "category": "表单与问卷",
          "subCategory": "无头表单",
          "tags": [
            "FormKeep",
            "数据收集"
          ]
        },
        {
          "url": "https://jotform.com/",
          "title": "Jotform",
          "description": "功能极其庞大完备的在线表单创建者，拥有数千个各行业现成表单模板。",
          "category": "表单与问卷",
          "subCategory": "综合模板库",
          "tags": [
            "Jotform",
            "模板大库"
          ]
        },
        {
          "url": "https://docs.google.com/forms/",
          "title": "Google 表单 (Google Forms)",
          "description": "完全免费且高可靠的云端问卷与表单工具，数据自动汇入 Google Sheets 表格。",
          "category": "表单与问卷",
          "subCategory": "官方免费",
          "tags": [
            "Google Forms",
            "免费问卷"
          ]
        },
        {
          "url": "https://www.indiehackers.com/",
          "title": "Indie Hackers",
          "description": "全球最大独立黑客社区，分享真实微型创业案例、商业变现与收入公开历程。",
          "category": "海外与远程",
          "subCategory": "独立黑客殿堂",
          "tags": [
            "Indie Hackers",
            "收入公开"
          ]
        },
        {
          "url": "https://weworkremotely.com/",
          "title": "We Work Remotely (WWR)",
          "description": "全球规模最大的远程工作招聘社区，海量海外全职远程开发与设计机会。",
          "category": "海外与远程",
          "subCategory": "远程招聘",
          "tags": [
            "WWR",
            "海外全职"
          ]
        },
        {
          "url": "https://remoteok.com/",
          "title": "Remote OK",
          "description": "知名独立黑客 Pieter Levels 创办的全球远程工作平台，实时聚合高薪机会。",
          "category": "海外与远程",
          "subCategory": "独立作品",
          "tags": [
            "Remote OK",
            "Levels作品"
          ]
        },
        {
          "url": "https://nomadlist.com/",
          "title": "Nomad List",
          "description": "全球数字游民必备的旅居城市物价、网络速度、安全度与社区生活全面指南。",
          "category": "海外与远程",
          "subCategory": "数字游民指南",
          "tags": [
            "Nomad List",
            "旅居城市"
          ]
        },
        {
          "url": "https://www.producthunt.com/stories",
          "title": "Product Hunt Stories",
          "description": "全球新锐软件创始人分享的从零冷启动、踩坑教训与用户增长心得专栏。",
          "category": "海外与远程",
          "subCategory": "创始人专栏",
          "tags": [
            "PH Stories",
            "创业历程"
          ]
        },
        {
          "url": "https://growthhackers.com/",
          "title": "GrowthHackers",
          "description": "全球增长黑客与敏捷营销专家交流 AARRR 模型与实验性增长测试的知识库。",
          "category": "海外与远程",
          "subCategory": "增长黑客",
          "tags": [
            "GrowthHackers",
            "增长实验"
          ]
        },
        {
          "url": "https://saastr.com/",
          "title": "SaaStr",
          "description": "全球最大的 B2B SaaS 创始人、高管与投资人思想领导力与业务增长社区。",
          "category": "海外与远程",
          "subCategory": "B2B SaaS指南",
          "tags": [
            "SaaStr",
            "SaaS增长"
          ]
        },
        {
          "url": "https://microacquire.com/",
          "title": "Acquire.com (原 MicroAcquire)",
          "description": "全球初创项目与盈利微型 SaaS 快速并购出售交易市场，实现自由退出变现。",
          "category": "海外与远程",
          "subCategory": "初创并购",
          "tags": [
            "Acquire.com",
            "项目出售"
          ]
        },
        {
          "url": "https://flippa.com/",
          "title": "Flippa",
          "description": "历史悠久的全球数字资产拍卖行，买卖网站、SaaS 软件、域名与电商网店。",
          "category": "海外与远程",
          "subCategory": "数字资产交易",
          "tags": [
            "Flippa",
            "资产拍卖"
          ]
        },
        {
          "url": "https://www.sidehustlestack.co/",
          "title": "Side Hustle Stack",
          "description": "探索通过网络副业与创作者经济实现个人独立自由搞钱的精选工具导航。",
          "category": "海外与远程",
          "subCategory": "副业变现",
          "tags": [
            "Side Hustle",
            "副业经济"
          ]
        },
        {
          "url": "https://www.upwork.com/",
          "title": "Upwork",
          "description": "全球最大的综合类自由职业者兼职与全职雇佣平台，服务全球数百万企业。",
          "category": "自由职业",
          "subCategory": "全球综合",
          "tags": [
            "Upwork",
            "自由职业"
          ]
        },
        {
          "url": "https://www.fiverr.com/",
          "title": "Fiverr",
          "description": "服务按明码标价包 (Gigs) 售卖的全球自由职业市场，买卖各类数字技能服务。",
          "category": "自由职业",
          "subCategory": "技能集市",
          "tags": [
            "Fiverr",
            "技能交易"
          ]
        },
        {
          "url": "https://toptal.com/",
          "title": "Toptal",
          "description": "严格筛选排名前 3% 的全球顶尖自由职业软件工程师、设计师与财务专家平台。",
          "category": "自由职业",
          "subCategory": "高端精英",
          "tags": [
            "Toptal",
            "顶尖人才"
          ]
        },
        {
          "url": "https://gun.io/",
          "title": "Gun.io",
          "description": "专注于为海外快速扩张的科技团队精准匹配资深软件工程自由开发者的平台。",
          "category": "自由职业",
          "subCategory": "资深工程师",
          "tags": [
            "Gun.io",
            "技术外包"
          ]
        },
        {
          "url": "https://dribbble.com/hiring",
          "title": "Dribbble Freelance Projects",
          "description": "全球顶级视觉与 UI 设计师寻找高质量海外远程兼职设计外包项目的乐园。",
          "category": "自由职业",
          "subCategory": "设计自由职业",
          "tags": [
            "Dribbble",
            "设计外包"
          ]
        },
        {
          "url": "https://contra.com/",
          "title": "Contra",
          "description": "为新一代独立专业人士打造的零佣金独立作品集与自由职业合约签约平台。",
          "category": "自由职业",
          "subCategory": "零佣金平台",
          "tags": [
            "Contra",
            "新锐自由职业"
          ]
        },
        {
          "url": "https://www.freelancer.com/",
          "title": "Freelancer.com",
          "description": "跨国自由职业与众包竞标平台，拥有海量中小企业软件开发与文档翻译需求。",
          "category": "自由职业",
          "subCategory": "老牌竞标",
          "tags": [
            "Freelancer",
            "众包竞标"
          ]
        },
        {
          "url": "https://wellfound.com/",
          "title": "Wellfound (原 AngelList Talent)",
          "description": "连接全球顶尖早期高成长初创企业与冒险精神工程师求职的知名平台。",
          "category": "自由职业",
          "subCategory": "初创求职",
          "tags": [
            "Wellfound",
            "AngelList"
          ]
        },
        {
          "url": "https://remotive.com/",
          "title": "Remotive",
          "description": "精挑细选的高质量远程软件开发工作公告板，自带活跃的远程职业社群。",
          "category": "自由职业",
          "subCategory": "精选远程",
          "tags": [
            "Remotive",
            "远程工作"
          ]
        },
        {
          "url": "https://www.guru.com/",
          "title": "Guru",
          "description": "老牌自由职业者服务撮合平台，提供灵活的工作协议管理与安全托管账户结算。",
          "category": "自由职业",
          "subCategory": "安全托付",
          "tags": [
            "Guru",
            "托管结算"
          ]
        }
      ]
    }
  }
};
