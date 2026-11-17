/**
 * 考试日历数据（/exam）。
 *
 * 日期来源：2026-11-17 按官方公告逐项核实（中国教育考试网、研招网、
 * 国家公务员局专题、各省人事考试公告）。新增考试只收已核实的官方日期，
 * 不按往年惯例推测、不写死未公布的确切日：
 *  - 考研准考证官方只说「考前 10 天左右」，这里只写预计、不写死；
 *  - 省考七省（四川、江苏、广东、上海、天津、浙江、山东）都是单独招考，不是联考，文案不写「联考」；
 *  - 京考（2027 年度北京市公务员考试）按北京市公务员局公告核实
 *    （2026-11-17）：报名 11-12 9:00–11-18 18:00、准考证打印
 *    12-01 9:00–12-06 16:30、公安专业科目 12-05、公共科目 12-06；
 *    成绩只写「2027 年 1 月」、无确切日，不收成绩节点；
 *  - 2026 下半年软考（10-24–27）与教资笔试（11-01）已考完，不列入倒计时。
 */

export interface ExamNode {
  label: string
  detail: string
  /**
   * 官方直达入口（如准考证打印页）：只挂已核实的官方链接，事实源在
   * exam-calendar 的 URL 常量里，节点数据不写死域名；无入口的节点留空。
   */
  url?: string
  /** 节点开始日（YYYY-MM-DD，北京时间自然日） */
  startISO: string
  /** 节点结束日（单日节点与开始日相同） */
  endISO: string
  /** 预计日期：官方未公布确切日，状态不按日期自动翻转为「已结束」 */
  estimated?: boolean
}

export interface ExamInfo {
  id: string
  name: string
  shortName: string
  tagline: string
  examDateLabel: string
  /** 考试首日（YYYY-MM-DD）：公共科目首日 */
  startISO: string
  /** 考试末日（YYYY-MM-DD） */
  endISO: string
  /**
   * 考生视角的首考日（YYYY-MM-DD）：有专业科目加试的考试早于公共科目
   * 首日（国考 11-28 专业科目先考，公共科目 11-29）；缺省等于 startISO。
   * 倒计时、紧迫度与提醒档位都按首考日算，避免加试考生被「明天考试」误导。
   */
  firstExamDayISO?: string
  /** 首考日当天的时钟卡文案（缺省为「今天${shortName}」） */
  firstDayLabel?: string
  /** 首考日前一天的时钟卡文案（缺省为「明天${shortName}」） */
  eveLabel?: string
  nodes: ExamNode[]
  note?: string
}

/**
 * 四六级准考证打印官方入口：全国大学英语四、六级考试报名网
 * （CET 全国网上报名系统，教育部教育考试院）。
 *
 * 事实来源（2026-11-17 核实）：
 *  - live 浏览器 15:38 直访成功，标题「全国大学英语四、六级考试报名网」，
 *    首页左侧即有「快速打印准考证（PRINT TICKET）」入口；未点进打印流程，
 *    打印页内状态未验证；
 *  - 同日 curl：服务器可达（TLS + HTTP 均通），但对非浏览器请求返回 412
 *    反爬挑战页，不是死链证据；
 *  - 口试准考证 11-17 9:00 起打印、笔试准考证 12-01 9:00 起打印（教育部
 *    教育考试院 2026-09-02 下半年 CET 公告，多源一致），同一入口覆盖
 *    口试与笔试打印，故两个打印节点共用此链接。
 */
export const CET_ADMISSION_URL = 'https://cet-bm.neea.edu.cn'

/**
 * 省考七省准考证打印官方入口（U-30，2026-11-17 按各省公告原文逐项核实，
 * 入口 URL 逐个 curl 或按公告原文域名核实，不编造）：
 *  - 天津：天津市公务员考试录用服务平台 https://gklx.hrss.tj.gov.cn
 *    （公告 2026-11-02 原文所载；curl 200；窗口 11-28 8:30 起，公告未写截止）；
 *  - 山东：2027 年度山东省考试录用公务员报名平台
 *    https://gwy.sdrsks.org.cn/skbm2027.html（公告原文所载；curl 418 反爬
 *    应答，服务器存在；窗口 12-01 9:00–12-06 14:15）；
 *  - 四川：2027 年度公开考试录用公务员专题网站
 *    https://www.scpta.com.cn/front/Special/Info/44ad63b224814ead8b066b95b0aa6aff
 *    （公告原文所载；本站出口连不上，curl 000——URL 本身是公告原文逐字所载，
 *    非编造；窗口只写 12 月 1 日至 6 日，公告原文根本没写时刻）；
 *  - 浙江：浙江省公务员考试录用网 gwy.zjks.gov.cn（公告原文所载域名；
 *    https 不通、http 200，属 http-only 站，写 http 不“修正”为 https；
 *    窗口 12-01 9:00–12-06 17:00，深链未核实，只挂域名）；
 *  - 江苏：江苏人事考试网省级机关报名网址
 *    https://jshrss.jiangsu.gov.cn/col/col57253（公告原文所载；curl 200；
 *    窗口 12-02 9:00–12-06 15:00；各设区市网址见公告附件 1，不逐一挂）；
 *  - 广东：广东省公务员考试录用管理信息系统
 *    https://ggfw.hrss.gd.gov.cn/gwyks/index.do（公告原文所载；curl 200；
 *    窗口 12-02 9:00 起，公告未写截止）；
 *  - 上海：上海市公务员局官网 https://www.shacs.gov.cn/（公告所载专题站
 *    https://shacs.gov.cn/recruits/440 本机 curl 两次 404、fetch 失败，
 *    疑似报名结束后路径下线或反爬，暂挂已验证 200 的官网根，待 live 浏览器
 *    复核深链后再换；窗口 12-02 10:00–12-05 18:00 见市考务问答原文）。
 */
export const TIANJIN_SHENGKAO_ADMISSION_URL = 'https://gklx.hrss.tj.gov.cn'
export const SHANDONG_SHENGKAO_ADMISSION_URL = 'https://gwy.sdrsks.org.cn/skbm2027.html'
export const SICHUAN_SHENGKAO_ADMISSION_URL =
  'https://www.scpta.com.cn/front/Special/Info/44ad63b224814ead8b066b95b0aa6aff'
export const ZHEJIANG_SHENGKAO_ADMISSION_URL = 'http://gwy.zjks.gov.cn'
export const JIANGSU_SHENGKAO_ADMISSION_URL = 'https://jshrss.jiangsu.gov.cn/col/col57253'
export const GUANGDONG_SHENGKAO_ADMISSION_URL = 'https://ggfw.hrss.gd.gov.cn/gwyks/index.do'
export const SHANGHAI_SHENGKAO_ADMISSION_URL = 'https://www.shacs.gov.cn/'

/**
 * 国考准考证打印官方入口：中央机关及其直属机构 2027 年度考试录用公务员
 * 专题网站（国家公务员局）。事实来源见文件下方准考证打印提醒的注释
 * （2026-11-14 核实：http://bm.scs.gov.cn/kl2027 经 curl 返回 200；
 * https 版为空回复，链接必须写 http）。常量定义在 EXAMS 之前，因
 * guokao 准考证节点直接引用（模块顶层常量，EXAMS 字面量求值时不得 TDZ）。
 */
export const GUOKAO_ADMISSION_URL = 'http://bm.scs.gov.cn/kl2027'

/**
 * 京考报名与准考证打印官方入口：北京市人事考试通用平台
 * （北京市公务员局《北京市各级机关 2027 年度考试录用公务员公告》，
 * 首都之窗 2026-11-09 发布，2026-11-17 直访核实）。
 *  - 报名入口 http://rsj.beijing.gov.cn/bm/ztzl/gwy/ 为公告原文内嵌 URL；
 *    直访 http 与 https 返回同一页面（含「考生报名入口」与报名时间），
 *    原文写 http，按浙江先例写 http 不“修正”为 https；
 *  - 准考证打印走同一平台（公告原文「从『北京市人事考试通用平台』
 *    自行下载打印准考证」），报名与准考证两节点共用此链接。
 */
export const JINGKAO_APPLY_URL = 'http://rsj.beijing.gov.cn/bm/ztzl/gwy/'

/**
 * 京考官方公告 URL：首都之窗《北京市各级机关 2027 年度考试录用
 * 公务员公告》（2026-11-09，2026-11-17 直访全文在位，逐字核对
 * 报名/笔试/准考证日期）。挂在公共科目笔试节点上（条目无 url 字段，
 * 按文件惯例挂节点）；报考指南/招考简章只有临时对象存储附件链接，
 * 未核实到稳定直链，不挂。
 */
export const JINGKAO_NOTICE_URL =
  'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html'

export const EXAMS: ExamInfo[] = [
  {
    id: 'guokao',
    name: '2027 年国家公务员考试',
    shortName: '国考',
    tagline: '专业科目 11 月 28 日 · 公共科目 11 月 29 日',
    examDateLabel: '11 月 28–29 日',
    startISO: '2026-11-29',
    endISO: '2026-11-29',
    // 首考日 11-28：部分岗位专业科目 14:00–16:00 先考（国家公务员局
    // 2027 年度招考公告；2026-11-16 多源复核一致）。倒计时按首考日说事。
    firstExamDayISO: '2026-11-28',
    firstDayLabel: '今天国考 · 专业科目 14:00 开考',
    eveLabel: '明天国考（专业科目先考 11 月 28 日）',
    nodes: [
      {
        label: '准考证打印',
        detail: '11 月 23 日 0:00 至 11 月 29 日 15:00',
        startISO: '2026-11-23',
        endISO: '2026-11-29',
        url: GUOKAO_ADMISSION_URL,
      },
      {
        label: '专业科目笔试',
        detail: '11 月 28 日 14:00–16:00（部分岗位）',
        startISO: '2026-11-28',
        endISO: '2026-11-28',
      },
      {
        label: '公共科目笔试',
        detail: '行测 9:00–11:00，申论 14:00–17:00',
        startISO: '2026-11-29',
        endISO: '2026-11-29',
      },
    ],
  },
  {
    id: 'cet',
    name: '2026 年下半年全国大学英语四、六级考试',
    shortName: '四六级',
    tagline: '笔试',
    examDateLabel: '12 月 12 日',
    startISO: '2026-12-12',
    endISO: '2026-12-12',
    nodes: [
      {
        label: '口试',
        detail: '四级 11 月 21 日，六级 11 月 22 日',
        startISO: '2026-11-21',
        endISO: '2026-11-22',
      },
      {
        label: '口试准考证打印',
        detail: '11 月 17 日 9:00 起',
        startISO: '2026-11-17',
        endISO: '2026-11-22',
        url: CET_ADMISSION_URL,
      },
      {
        label: '笔试准考证打印',
        detail: '12 月 1 日 9:00 起',
        startISO: '2026-12-01',
        endISO: '2026-12-12',
        url: CET_ADMISSION_URL,
      },
      {
        label: '笔试',
        detail: '四级 9:00–11:20，六级 15:00–17:25',
        startISO: '2026-12-12',
        endISO: '2026-12-12',
      },
    ],
  },
  {
    id: 'shengkao',
    name: '2027 年省考（多省同日笔试）',
    shortName: '省考',
    tagline: '公共科目笔试',
    examDateLabel: '12 月 6 日',
    startISO: '2026-12-06',
    endISO: '2026-12-06',
    nodes: [
      // 七省准考证打印窗口各异，必须分省建节点（U-30，2026-11-17 核实）：
      // 天津最早 11-28 8:30 开放；广东/天津公告未写截止、四川公告未写时刻，
      // 三省挂 estimated，状态永不自动翻「已结束」，detail 如实写明，不编时刻；
      // 无截止两省的 endISO 取笔试日 12-06 作末日占位（estimated 下状态不受影响）。
      {
        label: '天津准考证打印',
        detail: '11 月 28 日 8:30 起，公告未写截止，以报名系统为准',
        startISO: '2026-11-28',
        endISO: '2026-12-06',
        estimated: true,
        url: TIANJIN_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '山东准考证打印',
        detail: '12 月 1 日 9:00 至 12 月 6 日 14:15',
        startISO: '2026-12-01',
        endISO: '2026-12-06',
        url: SHANDONG_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '四川准考证打印',
        detail: '12 月 1 日至 12 月 6 日，公告未写时刻',
        startISO: '2026-12-01',
        endISO: '2026-12-06',
        estimated: true,
        url: SICHUAN_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '浙江准考证打印',
        detail: '12 月 1 日 9:00 至 12 月 6 日 17:00',
        startISO: '2026-12-01',
        endISO: '2026-12-06',
        url: ZHEJIANG_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '江苏准考证打印',
        detail: '12 月 2 日 9:00 至 12 月 6 日 15:00',
        startISO: '2026-12-02',
        endISO: '2026-12-06',
        url: JIANGSU_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '广东准考证打印',
        detail: '12 月 2 日 9:00 起，公告未写截止，以报名系统为准',
        startISO: '2026-12-02',
        endISO: '2026-12-06',
        estimated: true,
        url: GUANGDONG_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '上海准考证打印',
        detail: '12 月 2 日 10:00 至 12 月 5 日 18:00',
        startISO: '2026-12-02',
        endISO: '2026-12-05',
        url: SHANGHAI_SHENGKAO_ADMISSION_URL,
      },
      {
        label: '专业科目笔试',
        detail: '12 月 5 日（多省）',
        startISO: '2026-12-05',
        endISO: '2026-12-05',
      },
      {
        label: '公共科目笔试',
        detail: '12 月 6 日：四川、江苏、广东、上海、天津、浙江、山东',
        startISO: '2026-12-06',
        endISO: '2026-12-06',
      },
    ],
    note: '七省均为单独招考，报名均已截止（山东 11 月 6–9 日；四川 11 月 4 日、广东 11 月 6 日、上海 11 月 7 日、江苏/天津 11 月 9 日、浙江 11 月 11 日）。七省准考证窗口各异，分省见节点。',
  },
  {
    id: 'jingkao',
    name: '2027 年度北京市公务员考试',
    shortName: '京考',
    tagline: '公安专业科目 12 月 5 日 · 公共科目 12 月 6 日',
    examDateLabel: '12 月 5–6 日',
    startISO: '2026-12-06',
    endISO: '2026-12-06',
    // 首考日 12-05：公安机关人民警察职位专业科目 14:00–16:00 先考
    // （北京市公务员局 2027 年度公告；2026-11-17 按首都之窗原文逐字
    // 核实）。倒计时按首考日说事；因此 11-30 起最近场为京考（首考日
    // 12-05 早于省考 12-06），home-exam-entry / exam-urgency 的
    // 11-30 最近场断言已同步改京考，不是削弱。
    firstExamDayISO: '2026-12-05',
    firstDayLabel: '今天京考 · 公安专业科目 14:00 开考',
    eveLabel: '明天京考（公安专业科目先考 12 月 5 日）',
    // 京考节点（U-76，2026-11-17 按首都之窗公告原文逐字核实）：
    // 报名 11-12 9:00–11-18 18:00、准考证打印 12-01 9:00–12-06 16:30、
    // 公安专业科目 12-05 14:00–16:00、公共科目 12-06（行测 9:00–11:00、
    // 申论 14:00–16:30）。
    // 报名是多日窗口节点（11-12–11-18），窗口内状态为进行中；18:00 是
    // 时刻级截止，无法用日期字段表达，11-18 当天仍显示进行中，detail
    // 写明「18:00 截止」，不新造时刻门控函数。
    // 不收缴费节点：官方窗口 11-21 0:00–11-23 24:00 已核实，但文件无
    // 缴费类节点先例（国考/省考均不设缴费节点），最小切口不收。
    // 不收成绩节点：官方只写「2027 年 1 月」，无确切日；成绩类禁用
    // estimated（开考后才有意义），无确切日 + 无可信占位日 = 不收，
    // 待官方公布具体日期后再补。
    nodes: [
      {
        label: '报名',
        detail: '11 月 12 日 9:00 至 11 月 18 日 18:00，登录北京市人事考试通用平台提交报考申请；未通过资格审查者可在 11 月 18 日 18:00 前改报其他职位',
        startISO: '2026-11-12',
        endISO: '2026-11-18',
        url: JINGKAO_APPLY_URL,
      },
      {
        label: '准考证打印',
        detail: '12 月 1 日 9:00 至 12 月 6 日 16:30，缴费成功后从北京市人事考试通用平台自行下载打印准考证',
        startISO: '2026-12-01',
        endISO: '2026-12-06',
        url: JINGKAO_APPLY_URL,
      },
      {
        label: '公安专业科目笔试',
        detail: '12 月 5 日 14:00–16:00（仅公安机关人民警察职位）',
        startISO: '2026-12-05',
        endISO: '2026-12-05',
      },
      {
        label: '公共科目笔试',
        detail: '12 月 6 日：行测 9:00–11:00，申论 14:00–16:30',
        startISO: '2026-12-06',
        endISO: '2026-12-06',
        url: JINGKAO_NOTICE_URL,
      },
    ],
    note: '北京市考为单独招考；公共科目与省考同日（12 月 6 日），报名系统与招录机关不同。',
  },
  {
    id: 'kaoyan',
    name: '2027 年全国硕士研究生招生考试',
    shortName: '考研',
    tagline: '初试',
    examDateLabel: '12 月 19–20 日',
    startISO: '2026-12-19',
    endISO: '2026-12-20',
    nodes: [
      {
        label: '准考证下载',
        detail: '考前 10 天左右开通（预计 12 月 9 日前后）',
        startISO: '2026-12-09',
        endISO: '2026-12-10',
        estimated: true,
      },
      {
        label: '初试',
        detail: '12 月 19–20 日',
        startISO: '2026-12-19',
        endISO: '2026-12-20',
      },
    ],
  },
  {
    id: 'chengkao',
    name: '2026 年成人高考',
    shortName: '成考',
    tagline: '成绩分省公布',
    examDateLabel: '10 月 17–18 日',
    startISO: '2026-10-17',
    endISO: '2026-10-18',
    // 成考成绩分省公布，无全国统一时间（2026-11-17 核实）：11-18 当天可查的
    // 只有江西（9:00）与广东（16:00 短信推送 / 16:20 小程序自查）两省；
    // 浙江 11-20 左右公布成绩与分数线、11-25–11-29 志愿确认（浙江省教育
    // 考试院《2026 年 11 月浙江教育考试历》2026-11-02，2026-11-17 复核），
    // 故列三省四节点，不写全国单节点；其余省份时间各异或未公布，逐省核实后再补。
    // 统考 10-17–18 已结束，条目存在只为承载成绩节点；成绩节点是单日公布事件
    // （startISO = endISO），公布后状态翻「已结束」，detail 仍写明查询渠道；
    // 浙江志愿确认是多日窗口节点（11-25–11-29），窗口内状态为进行中。
    // 三省均无网页查分 URL 可挂（广东走官微/支付宝/百度三大小程序；江西、浙江
    // 查分 URL 未核实到 verbatim），节点不挂 url，不编链接。
    nodes: [
      {
        label: '江西成绩查询',
        detail: '11 月 18 日 9:00 起可查（江西省教育考试院网服务大厅「成绩查询」栏目）',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '广东成绩查询',
        detail: '11 月 18 日 16:00 起短信推送，16:20 起官微（gdsksy）/支付宝/百度小程序可查',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '浙江成绩查询',
        detail: '11 月 20 日左右公布成绩与分数线（浙江省教育考试院成人高校招生报名系统）',
        startISO: '2026-11-20',
        endISO: '2026-11-20',
      },
      {
        label: '浙江志愿确认',
        detail: '11 月 25 日 8:30 至 11 月 29 日 17:00，登录成人高校招生报名系统确认或修改志愿',
        startISO: '2026-11-25',
        endISO: '2026-11-29',
      },
    ],
    note: '成绩分省公布，无全国统一时间。广东：复查申请截止 11 月 20 日 15:00，成绩证书 11 月 28 日 16:00 起可下载打印；其余省份时间各异，以各省教育考试院公告为准。',
  },
]

/**
 * 撞期与双考提醒。日期均已核实：中小学教师资格面试 12-05–06
 *（准考证 11-30–12-06，报名 11-06–09 已截止）。
 *
 * 过期哨兵（2026-11-17 R-1）：每条带 validUntilISO（北京时间自然日，
 * 含当日有效），所涉日期一过即过期；activeExamReminders() 在数据层
 * 单点过滤，所有消费点（/exam 页、首页条带等）只读派生结果，不直接
 * 读 EXAM_REMINDERS 原数组，避免提醒在撞期过后仍展示到 12-20。
 */
export interface ExamReminder {
  title: string
  body: string
  /** 提醒有效期至该日（含当日）：省考撞期到 12-06，考研衔接到 12-19 */
  validUntilISO: string
}

export const EXAM_REMINDERS: ExamReminder[] = [
  {
    title: '12 月 5–6 日撞期：省考与教资面试',
    body: '2027 省考公共科目（12 月 6 日）与中小学教师资格面试（12 月 5–6 日）是同一个周末，同时报考请先对一下两场的具体考场与时间，必要时提前取舍。',
    validUntilISO: '2026-12-06',
  },
  {
    title: '国考之后一周就是省考',
    body: '11 月 29 日国考公共科目考完，12 月 6 日多省省考公共科目接着来，两场题型相近，适合以考代练、衔接复习。',
    validUntilISO: '2026-12-06',
  },
  {
    title: '四六级之后一周就是考研',
    body: '12 月 12 日四六级笔试后，12 月 19–20 日就是 2027 考研初试，英语听力与阅读的备考可以直接衔接。',
    validUntilISO: '2026-12-19',
  },
]

/**
 * 未过期的撞期提醒：validUntilISO 当天仍展示，次日 0 点（北京时间）
 * 起隐藏。提醒区只随 nearest 消失（12-20 才下线）兜不住过期提醒，
 * 故消费点一律读这里，不读 EXAM_REMINDERS 原数组。
 */
export function activeExamReminders(nowMs: number = Date.now()): ExamReminder[] {
  return EXAM_REMINDERS.filter((r) => daysUntil(r.validUntilISO, nowMs) >= 0)
}

/** 备考站点区：读站内「学习成长 / 考试备考」分类，不硬编码链接 */
export const EXAM_PREP_CATEGORY_ID = 'reg-learning-growth'
export const EXAM_PREP_SUB_ID = 'reg-exam-prep'

export const EXAM_DATA_NOTE =
  '考试日期据官方公告核实于 2026 年 11 月 17 日，请以各考试官方最新公告为准。'

export const DAY_MS = 24 * 3600 * 1000
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

/** 某日期在北京时间的零点对应的 UTC 毫秒数 */
export function shanghaiMidnightMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - SHANGHAI_OFFSET_MS
}

/** 给定时刻所在的北京时间自然日的零点（UTC 毫秒数） */
function shanghaiTodayStartMs(nowMs: number): number {
  return Math.floor((nowMs + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS
}

/** 到目标日期（北京时间自然日）还剩几天：今天 0，明天 1，已过为负数 */
export function daysUntil(targetISO: string, nowMs: number = Date.now()): number {
  return Math.round((shanghaiMidnightMs(targetISO) - shanghaiTodayStartMs(nowMs)) / DAY_MS)
}

export type ExamStatus = 'upcoming' | 'today' | 'ongoing' | 'ended'

/**
 * 考生视角的首考日：有加试的考试早于公共科目首日（国考 11-28），
 * 缺省等于 startISO。倒计时、紧迫度、提醒档位与倒计时岛都以它为锚。
 */
export function firstExamDay(
  exam: Pick<ExamInfo, 'startISO' | 'firstExamDayISO'>,
): string {
  return exam.firstExamDayISO ?? exam.startISO
}

export function examStatus(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamStatus {
  const toStart = daysUntil(firstExamDay(exam), nowMs)
  const toEnd = daysUntil(exam.endISO, nowMs)
  if (toEnd < 0) return 'ended'
  if (toStart > 0) return 'upcoming'
  if (exam.startISO === exam.endISO) return 'today'
  return 'ongoing'
}

export type ExamNodeStatus = 'done' | 'today' | 'active' | 'upcoming' | 'estimated'

export function examNodeStatus(node: ExamNode, nowMs: number = Date.now()): ExamNodeStatus {
  if (node.estimated) return 'estimated'
  const toStart = daysUntil(node.startISO, nowMs)
  const toEnd = daysUntil(node.endISO, nowMs)
  if (toEnd < 0) return 'done'
  if (toStart > 0) return 'upcoming'
  if (node.startISO === node.endISO) return 'today'
  return 'active'
}

/** 最近一场：未结束的考试里首考日最早的；多日考试末日仍算未结束
 *（考研 12-19–20：12-20 当天条带仍在，与 /exam 倒计时岛「进行中 ·
 * 第 2 天」一致）；六场全结束则返回 undefined（调用方渲染空态条带）。
 * 排序按首考日（firstExamDay），不是公共科目首日 startISO：有加试的
 * 考试（国考首考日 11-28 < startISO 11-29；京考首考日 12-05 < startISO
 * 12-06）应按考生实际最早开考日排。京考首考日早于省考 12-06，故 11-30
 * 起最近场为京考；exams 参数只为测试注入合成数据（2026-11-16 0922
 * C 线），调用方不传。 */
export function nearestExam(
  nowMs: number = Date.now(),
  exams: ExamInfo[] = EXAMS,
): ExamInfo | undefined {
  return [...exams]
    .sort((a, b) => firstExamDay(a).localeCompare(firstExamDay(b)))
    .find((exam) => examStatus(exam, nowMs) !== 'ended')
}

/**
 * 「下一步」挑选谓词：预计节点（estimated）在所属考试开考后不再算待办
 * ——准考证下载开考后已无意义；其余节点按状态算。时间轴的
 * examNodeStatus 不动（预计节点仍显示「预计」，不按日期翻 done）。
 */
export function isNodeActionable(
  node: ExamNode,
  exam: ExamInfo,
  nowMs: number = Date.now(),
): boolean {
  if (node.estimated && daysUntil(exam.startISO, nowMs) <= 0) return false
  return examNodeStatus(node, nowMs) !== 'done'
}

/** 某场考试的「下一步」节点：按开始日排序，第一个未结束的节点；全过则 undefined */
export function nextExamNode(exam: ExamInfo, nowMs: number = Date.now()): ExamNode | undefined {
  return [...exam.nodes]
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .find((node) => isNodeActionable(node, exam, nowMs))
}

/**
 * 该场考试是否仍有可办节点（R1，2026-11-17）：统考已过不等于全办完——
 * 成考 11-18 当天 examStatus 已是 ended，但两省成绩节点仍是 today；
 * 卡片级「已结束」须先看这谓词再渲染，节点全过后才算真结束。
 */
export function hasActionableNodes(exam: ExamInfo, nowMs: number = Date.now()): boolean {
  return nextExamNode(exam, nowMs) !== undefined
}

/** 倒计时拆分：天 / 时 / 分 / 秒（目标时刻已过则全 0） */
export function countdownParts(targetMs: number, nowMs: number) {
  const diff = Math.max(0, targetMs - nowMs)
  return {
    days: Math.floor(diff / DAY_MS),
    hours: Math.floor((diff % DAY_MS) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  }
}

export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  upcoming: '未开始',
  today: '今天考试',
  ongoing: '进行中',
  ended: '已结束',
}

export const EXAM_NODE_STATUS_LABEL: Record<ExamNodeStatus, string> = {
  done: '已结束',
  today: '今天',
  active: '进行中',
  upcoming: '未开始',
  estimated: '预计',
}

/**
 * 倒计时紧迫度分档（纯派生：考试 + 时刻，不存状态、不写存储）。
 * 档位互斥：ended → null（不参与任何档位）；today/ongoing → today；
 * 距首考日 1 天 → tomorrow；≤3 天 → urgent；≤7 天 → soon；其余 → relaxed。
 * 多日考试以首考日计紧迫度，进行中只显示「第 N 天」。
 */
export type ExamUrgencyTier = 'today' | 'tomorrow' | 'urgent' | 'soon' | 'relaxed'

export function urgencyTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamUrgencyTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(firstExamDay(exam), nowMs)
  if (d <= 1) return 'tomorrow'
  if (d <= 3) return 'urgent'
  if (d <= 7) return 'soon'
  return 'relaxed'
}

/**
 * 时钟卡倒计时行（纯派生）：最近一场未结束考试的一行文案 + 紧迫档位。
 * 六场全结束返回 undefined（调用方隐藏该行，不写未公布日期）。
 * 文案与 /exam 倒计时岛同口径：首考日当天「今天国考 · 专业科目 14:00
 * 开考」（国考首考日 11-28 设了 firstDayLabel）、进行中「考研进行中 ·
 * 第 2 天」、首考日前一天「明天国考（专业科目先考 11 月 28 日）」
 *（设了 eveLabel）、其余「距国考 N 天」；天数按北京时间自然日
 *（daysUntil 首考日），与考试条带数字一致。
 */
export interface ExamCountdownLine {
  exam: ExamInfo
  /** 距首考日的北京时间自然日数：今天 0，明天 1，进行中为负 */
  days: number
  tier: ExamUrgencyTier
  label: string
}

export function nearestExamCountdown(nowMs: number = Date.now()): ExamCountdownLine | undefined {
  const exam = nearestExam(nowMs)
  if (!exam) return undefined
  const tier = urgencyTier(exam, nowMs)
  if (!tier) return undefined
  const status = examStatus(exam, nowMs)
  const d = daysUntil(firstExamDay(exam), nowMs)
  let label: string
  if (status === 'today') {
    label = d === 0 && exam.firstDayLabel ? exam.firstDayLabel : `今天${exam.shortName}`
  } else if (status === 'ongoing') label = `${exam.shortName}进行中 · 第 ${1 - d} 天`
  else if (d === 1) label = exam.eveLabel ?? `明天${exam.shortName}`
  else label = `距${exam.shortName} ${d} 天`
  return { exam, days: d, tier, label }
}

/**
 * 提醒档位：只在考前 7 / 3 / 1 天与考试当天命中，其余为 null。
 * 同一考试同一天只命中一个档位，去重天然成立，无需存储去重表。
 */
export type ExamReminderTier = '7d' | '3d' | '1d' | 'today'

export function reminderTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamReminderTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(firstExamDay(exam), nowMs)
  if (d === 7) return '7d'
  if (d === 3) return '3d'
  if (d === 1) return '1d'
  return null
}

export const EXAM_REMINDER_TIER_LABEL: Record<ExamReminderTier, string> = {
  '7d': '考前 7 天',
  '3d': '考前 3 天',
  '1d': '明天考试',
  today: '今天考试',
}

/**
 * 国考准考证打印提醒（只针对 guokao，首页条带 + /exam 国考卡片）。
 *
 * 事实来源（2026-11-14 按官方公告逐项核实 + curl）：
 *  - 打印窗口 11 月 23 日 0:00 至 11 月 29 日 15:00，逾期系统关闭、无法补打；
 *  - 退场句出自考场规则、不在公告正文；
 *  - 官方专题站 http://bm.scs.gov.cn/kl2027 经 curl 核实返回 200（JS 跳转页），
 *    是站内提醒唯一可点击入口；https 版为空回复，链接必须写 http://；
 *  - gwy.cpta.com.cn 根路径返回 405，不作站内可点击主入口。
 *
 * 门控（北京时间；15:00 截止用时刻算，不按自然日）：
 *  - 11-15–11-21 倒计时（countdown，距打印开启 X 天）；
 *  - 11-22 预热（warmup，开放前一天）；
 *  - 11-23–11-26 已开放（open）；
 *  - 11-27–11-29 15:00 末班（last-call）；
 *  - 11-15 之前与 11-29 15:00 之后一律不显示（null）。
 * 文案取自已核实的提醒准备稿 A 版（条带短句 / 卡片全句）。
 */
export type GuokaoAdmissionPhase = 'countdown' | 'warmup' | 'open' | 'last-call'

export function guokaoAdmissionPhase(nowMs: number = Date.now()): GuokaoAdmissionPhase | null {
  const countdownStart = shanghaiMidnightMs('2026-11-15')
  const warmupStart = shanghaiMidnightMs('2026-11-22')
  const openStart = shanghaiMidnightMs('2026-11-23')
  const lastCallStart = shanghaiMidnightMs('2026-11-27')
  const deadline = shanghaiMidnightMs('2026-11-29') + 15 * 3600 * 1000
  if (nowMs >= countdownStart && nowMs < warmupStart) return 'countdown'
  if (nowMs < warmupStart || nowMs >= deadline) return null
  if (nowMs < openStart) return 'warmup'
  if (nowMs < lastCallStart) return 'open'
  return 'last-call'
}

export interface GuokaoAdmissionReminder {
  phase: GuokaoAdmissionPhase
  /** 条带一行文案（短句） */
  stripLine: string
  /** /exam 卡片文案（A 版全句） */
  cardLine: string
  url: string
}

const GUOKAO_ADMISSION_COPY: Record<
  Exclude<GuokaoAdmissionPhase, 'countdown'>,
  { strip: string; card: string }
> = {
  warmup: {
    strip: '国考准考证明天 0:00 开放打印，11 月 29 日 15:00 截止',
    card: '2027 国考准考证明天（11 月 23 日）0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  open: {
    strip: '国考准考证打印已开放，11 月 29 日 15:00 截止，逾期无法补打',
    card: '2027 国考准考证打印已开放，11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  'last-call': {
    strip: '末班提醒：国考准考证 11 月 29 日 15:00 截止，逾期无法补打；今年新规：开考 15 分钟后不得入场，行测最晚 8:45、申论 13:45',
    card: '末班提醒：2027 国考准考证 11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
}

/**
 * 某场考试的准考证打印提醒：只有国考在门控窗口内才返回内容，
 * 其余考试与窗口外一律返回 null（调用方渲染 nothing，不出空壳）。
 */
export function admissionReminderFor(
  exam: Pick<ExamInfo, 'id'>,
  nowMs: number = Date.now(),
): GuokaoAdmissionReminder | null {
  if (exam.id !== 'guokao') return null
  const phase = guokaoAdmissionPhase(nowMs)
  if (!phase) return null
  if (phase === 'countdown') {
    const days = daysUntil('2026-11-23', nowMs)
    const strip = `国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止`
    const card = `2027 国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。`
    return { phase, stripLine: strip, cardLine: card, url: GUOKAO_ADMISSION_URL }
  }
  const copy = GUOKAO_ADMISSION_COPY[phase]
  return { phase, stripLine: copy.strip, cardLine: copy.card, url: GUOKAO_ADMISSION_URL }
}
