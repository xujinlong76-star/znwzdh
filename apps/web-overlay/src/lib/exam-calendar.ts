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
 *  - 军队文职（2027 年军队文职人员公开招考，2026-11-18 按公告
 *    全文转载核实）：准考证打印 12-07 9:00–12-13 14:00、全军统一
 *    笔试 12-13（公共科目 9:00–11:00、专业科目 14:00–16:00）；
 *    只收准考证 + 缴费 + 笔试三节点，报名/成绩一律不收（见条目注释）；
 *  - 教资面试（2026 年下半年中小学教师资格面试，2026-11-18 按
 *    北京/江西/黑龙江/吉林/山东公告核实）：准考证打印 11-30–12-06
 *    （北京 11-30 10:00–12-06 16:00）、面试 12-05–12-06；
 *    只收准考证 + 面试两节点，报名/成绩一律不收（见条目注释）；
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
 * 国考准考证打印官方入口（U-59）：报名确认及准考证打印系统直达
 * （中国人事考试网国考专用入口 http://gwy.cpta.com.cn，写 http）。
 *
 * 两层分工（2026-11-17 雷达第 16 轮定性）：
 *  - 直链（本常量，准考证节点与提醒的点击目标）：gwy.cpta.com.cn，
 *    报名确认及准考证打印系统直达；打印窗口 11-23 0:00 至 11-29 15:00，
 *    与站内节点窗口一致；
 *  - 门户（GUOKAO_PORTAL_URL，见下）：bm.scs.gov.cn/kl2027，国家公务员局
 *    2027 年度招考专题网站，是报名/审查的门户入口，不是打印系统直达
 *    地址——实测仅 335 B JS 跳转页，当前直接访问会跳到 scs.gov.cn 首页，
 *    点它找不到打印系统，故不作准考证节点的点击目标。
 *
 * 事实来源：官方 2026-10-25 单独公告《报名确认及准考证打印网址》所载
 * 直达网址（教育在线 2026-10-26 逐字转载 + 河南华图报考指南逐字引用 +
 * 多地文印证；未能从 scs.gov.cn 原站直读该公告）。gwy 根路径实测 405
 * （表单系统常见响应，非死链）。历史记录：bm 链 2026-11-14 curl 曾返回
 * 200（当时即为 JS 跳转页），不代表它直达打印系统。
 * 未验证项：本机沙箱 curl 外网返回 000（DNS 黑洞），gwy 直链未从本机
 * 直访复核；以上均引自上述转载与雷达第 16 轮记录，未写「经 curl 核实」。
 * 常量定义在 EXAMS 之前，因 guokao 准考证节点直接引用（模块顶层常量，
 * EXAMS 字面量求值时不得 TDZ）。
 */
export const GUOKAO_ADMISSION_URL = 'http://gwy.cpta.com.cn'

/**
 * 国考专题网站门户入口（报名/审查）：国家公务员局 2027 年度招考专题
 * 网站 http://bm.scs.gov.cn/kl2027。保留作门户引用，不作准考证打印
 * 节点与提醒的点击目标（见 GUOKAO_ADMISSION_URL 注释：仅 335 B JS
 * 跳转页，当前直接访问会跳到 scs.gov.cn 首页、找不到打印系统）。
 */
export const GUOKAO_PORTAL_URL = 'http://bm.scs.gov.cn/kl2027'

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

/**
 * 军队文职官方入口（2026-11-18 按公告全文转载核实：eol.cn
 * https://www.eol.cn/news/yaowen/202611/t20261104_2790191.shtml、
 * 新浪全文、央视通稿三源一致）。
 *
 * 两层分工（与京考/国考同款）：
 *  - 直链（本常量 JUNDUANWENZHI_ADMISSION_URL，准考证节点的点击目标）：
 *    报名系统 https://wzryzk.81rc.mil.cn/qjwzwb，公告原文所载系统入口；
 *    准考证打印 12-07 9:00–12-13 14:00；
 *  - 门户（JUNDUANWENZHI_PORTAL_URL）：军队人才网 http://www.81rc.mil.cn，
 *    只作门户引用，不作任何节点的点击目标（与 GUOKAO_PORTAL_URL 同款处理）；
 *    81rc 公告文章直链未核到，不得编造，故笔试节点不挂 url。
 * 常量定义在 EXAMS 之前，因军队文职准考证节点直接引用（防 TDZ）。
 */
export const JUNDUANWENZHI_ADMISSION_URL = 'https://wzryzk.81rc.mil.cn/qjwzwb'
export const JUNDUANWENZHI_PORTAL_URL = 'http://www.81rc.mil.cn'

/**
 * 教资面试统一入口：中小学教师资格考试网 https://ntce.neea.edu.cn
 *（报名/准考证打印/成绩同一入口，2026-11-18 按北京/江西/黑龙江/
 * 吉林/山东公告核实）。只挂在准考证打印节点上；面试节点本身无单独
 * 入口，不重复挂同一链接（跟踪岛会把带 url 的节点都渲染成「去官网
 * 打印准考证」，挂在面试行会误导）。常量定义在 EXAMS 之前（防 TDZ）。
 */
export const JIAOSHI_MIANSHI_URL = 'https://ntce.neea.edu.cn'

/**
 * 江西成考成绩复核官方入口（U-87，2026-11-18 按江西省教育考试院
 * 2026-11-13 公告原文核实）：考生如对本人考试成绩有疑义，可于
 * 11 月 19 日 09:00 至 11 月 20 日 17:00 登录「江西省成人高考网上
 * 报名系统」提出复核申请，复核结果于 11 月 24 日通过报名系统反馈。
 * URL 含末尾斜杠，逐字取自公告原文。常量定义在 EXAMS 之前（防 TDZ）。
 */
export const JIANGXI_CHENGKAO_REVIEW_URL = 'https://jdyw.jxeea.cn/'

/**
 * 广东自考成绩查询官方入口（U-144，2026-11-18 按广东省教育考试院
 * 2026-11-10 省自考委办公告原文核实）：成绩定于 11 月 18 日 15 时公布，
 * 查询入口为官微小程序（gdsksy）、支付宝小程序、百度智能小程序与
 * 广东省自学考试管理系统 https://www.eeagd.edu.cn/selfec/（查合格成绩
 * 与当次违规处理情况）。域名只认 eea.gd.gov.cn 体系下的 eeagd.edu.cn，
 * ee.gd.gov.cn 不得出现（雷达第 30 轮定论）。常量定义在 EXAMS 之前（防 TDZ）。
 */
export const GUANGDONG_ZIKAO_SCORE_URL = 'https://www.eeagd.edu.cn/selfec/'

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
  // 两场新增条目排在京考之前（2026-11-18 01:22 轮）：
  // 教资面试首考日 12-05 与京考同日，nearestExam 用 stable sort 按
  // 首考日排，平局时数组在前者胜出，故 11-30 起最近场为教资面试
  // 而非京考；军队文职首考日 12-13 无平局，位置只影响清单顺序。
  {
    id: 'jiaoshi-mianshi',
    name: '2026 年下半年中小学教师资格面试',
    shortName: '教资面试',
    tagline: '面试 12 月 5–6 日',
    examDateLabel: '12 月 5–6 日',
    startISO: '2026-12-05',
    endISO: '2026-12-06',
    // 教资面试节点（2026-11-18 按北京/江西/黑龙江/吉林/山东公告核实）：
    // 准考证打印 11-30–12-06（北京：11-30 10:00–12-06 16:00，各省窗口
    // 以本省公告为准）；面试 12-05–12-06。
    // 只收准考证 + 面试两节点：报名已过期（省际截止时刻不一，不逐省列），
    // 成绩 2027-01-08（部分省写「预计」，口径有省际差异），两节点一律不收。
    // 面试是多日节点（12-05–12-06）：两天状态均为 active，不走单日 today。
    nodes: [
      {
        label: '准考证打印',
        detail: '11 月 30 日至 12 月 6 日（北京：11 月 30 日 10:00 至 12 月 6 日 16:00；各省以本省公告为准），登录中小学教师资格考试网下载打印准考证',
        startISO: '2026-11-30',
        endISO: '2026-12-06',
        url: JIAOSHI_MIANSHI_URL,
      },
      {
        label: '面试',
        detail: '12 月 5–6 日，具体时间与地点以准考证为准',
        startISO: '2026-12-05',
        endISO: '2026-12-06',
      },
    ],
    note: '面试与省考、京考同在 12 月 5–6 日周末；准考证打印窗口与面试时间各省略有差异，以本省公告与准考证为准。',
  },
  {
    id: 'jundui-wenzhi',
    name: '2027 年军队文职人员公开招考',
    shortName: '军队文职',
    tagline: '全军统一笔试 12 月 13 日',
    examDateLabel: '12 月 13 日',
    startISO: '2026-12-13',
    endISO: '2026-12-13',
    // 军队文职节点（2026-11-18 按公告全文转载核实：eol.cn / 新浪 / 央视通稿）：
    // 准考证打印 12-07 9:00–12-13 14:00、全军统一笔试 12-13
    //（公共科目 9:00–11:00、专业科目 14:00–16:00）。
    // 只收准考证 + 缴费 + 笔试三节点：报名已过期不收；缴费按公告 §5 通用
    // 窗口收（11-17 8:00–11-18 18:00，初审通过人员缴纳报名费并选择考试
    // 城市，每门 50 元；文体岗位先面试合格人员同一窗口缴费；免笔试直接
    // 面试岗位不缴费）；成绩 2027 年 1 月底左右，无确切日，不收。
    nodes: [
      {
        label: '准考证打印',
        detail: '12 月 7 日 9:00 至 12 月 13 日 14:00，登录军队人才网报名系统下载打印准考证',
        startISO: '2026-12-07',
        endISO: '2026-12-13',
        url: JUNDUANWENZHI_ADMISSION_URL,
      },
      {
        label: '缴费',
        detail: '通过报名资格条件初审的报考人员，于 2026 年 11 月 17 日 8:00 至 18 日 18:00 缴纳报名费和选择考试城市，每门考试科目人民币 50 元；缴费成功并打印报名回执方为有效报名。文体岗位（艺术、体育、播音）先面试合格人员同一窗口缴费。免笔试直接面试岗位不需要缴纳报名费。',
        startISO: '2026-11-17',
        endISO: '2026-11-18',
      },
      {
        label: '全军统一笔试',
        detail: '12 月 13 日：公共科目 9:00–11:00，专业科目 14:00–16:00',
        startISO: '2026-12-13',
        endISO: '2026-12-13',
      },
    ],
    note: '报名已截止；缴费窗口 11 月 17 日 8:00 至 11 月 18 日 18:00，每门考试科目人民币 50 元，免笔试直接面试岗位不需要缴纳报名费；成绩预计 2027 年 1 月底左右公布，无确切日，不收成绩节点。',
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
    // 核实）。倒计时按首考日说事；京考首考日 12-05 早于省考 12-06，
    // 但与教资面试同日、且教资面试在 EXAMS 数组中排在京考之前，
    // 故 11-30 起最近场为教资面试，京考的 firstDayLabel / eveLabel
    // 当前被同日首考的教资面试遮蔽（条目移除后自动恢复）。
    // home-exam-entry / exam-urgency 的 11-30 最近场断言已同步改
    // 教资面试，不是削弱。
    firstExamDayISO: '2026-12-05',
    firstDayLabel: '今天京考 · 公安专业科目 14:00 开考',
    eveLabel: '明天京考（公安专业科目先考 12 月 5 日）',
    // 京考节点（U-76，2026-11-17 按首都之窗公告原文逐字核实）：
    // 报名 11-12 9:00–11-18 18:00、准考证打印 12-01 9:00–12-06 16:30、
    // 公安专业科目 12-05 14:00–16:00、公共科目 12-06（行测 9:00–11:00、
    // 申论 14:00–16:30）。
    // 报名是多日窗口节点（11-12–11-18），节点状态 examNodeStatus 仍是
    // 纯日期口径：11-18 全天为进行中，11-19 才翻已结束，detail 写明
    // 「18:00 截止」。18:00 时刻截止只在渲染层按表查
    // （examNodeDeadlineLabel / todayNodeDeadlineMs，查表 key 为
    // `${exam.id}:${node.label}`），调用方用
    // `deadlineLabel ?? EXAM_NODE_STATUS_LABEL[status]` 取文案；不给
    // ExamNode 加时刻字段，不改 examNodeStatus / todayNodes。
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
    // 只有江西（9:00）、广东（16:00 短信推送 / 16:20 小程序自查）与新疆
    // （12:00）三省；
    // 浙江 11-20 左右公布成绩与分数线、11-25–11-29 志愿确认（浙江省教育
    // 考试院《2026 年 11 月浙江教育考试历》2026-11-02，2026-11-17 复核），
    // 故列七省十一节点，不写全国单节点；其余省份时间各异或未公布，逐省核实后再补。
    // 统考 10-17–18 已结束，条目存在只为承载成绩节点；成绩节点是单日公布事件
    // （startISO = endISO），公布后状态翻「已结束」，detail 仍写明查询渠道；
    // 浙江成绩查询是例外（U-109）：11-20 只是「左右」的预计日，挂 estimated，
    // 状态恒为「预计」不翻「已结束」。
    // 浙江志愿确认是多日窗口节点（11-25–11-29），窗口内状态为进行中。
    // 江西成绩复核（U-87）：江西省教育考试院 2026-11-13 公告原文，2026-11-18
    // 核实——复核申请 11-19 9:00–11-20 17:00、结果 11-24 通过报名系统反馈。
    // 新疆成绩与复核（U-91）：新疆教育考试院 2026-11-16 公告原文，2026-11-18
    // 核实——成绩 11-18 12:00 起可查，复核申请 11-18 12:00–11-20 12:00，
    // 发邮件至所在地（州、市）教育考试机构指定邮箱（见公告附件 2），逾期不再受理。
    // 邮箱落点（U-91 复审补记，2026-11-18）：公告正文未列具体邮箱，指定邮箱
    // 清单在附件 2；本轮直读 xjzk.gov.cn 公告原文失败、未能读到附件 2，故不补
    // 具体邮箱地址、不编造邮箱，考生须查公告附件 2 确认所在地指定邮箱。
    // 海南成绩查询（U-164，2026-11-19 00:11–00:13 live 直读海南省教育考试院
    // 公告原文核实）：《海南省2026年成人高校招生全国统一考试成绩发布公告》
    // （2026-11-18 发布，https://ea.hainan.gov.cn/ywdt/crgkdxyyslj/202611/t20261118_4181157.html）
    // 原文「将于11月19日17:00公布考试成绩」，全文只出现这一个时间；11-23 09:00
    // 口径不成立，作废（此前雷达轮次所载 11-23 09:00 是转述级汇编口径，无官方原文）。
    // 查询入口为成人高考报名系统 https://crgk.hnks.gov.cn/（只写注释，不挂 url
    // 字段，U-102 口径：成考查分节点统一不挂 url，detail 文本写明渠道）；公告未给
    // 查分关闭日，不编 endISO，单日节点（startISO = endISO），11-20 起状态翻
    // 「已结束」，与江西/广东/新疆查分节点同款；17:00 是开通时刻不是截止时刻，
    // 不入 PEAK 表（与上海自考 11-19 10:00 同款，见 PEAK 表注释）。
    // 广东成绩复核（U-110，2026-11-18）：广东复查无起始日证实、只知截止 11 月 20 日
    // 15:00（成考 note 口径，U-99 已核实），故单日节点 11-20，不写 11-19；
    // 线下书面申请，无 URL 可挂；成绩证书下载仍只在 note，不作节点。
    // 山西成绩复核（U-160，转载级，2026-11-19 核实）：山西省招生考试管理中心
    // 2026-11-16 通知《山西省2026年成人高考成绩揭晓》——成绩 11-18 已公布，
    // 复核 11-19、20 日工作时间内到考试所在市的招生考试机构办理，逾期不予受理，
    // 11 月 27 日前各市通知复核结果；录取分数线、录取时间另行公布。凤凰网大风号
    // 转载（2026-11-16，http://feng.ifeng.com/c/8y6Vg5nVRcH）与新浪财经转载
    // （2026-11-17，https://finance.sina.com.cn/jjxw/2026-11-17/doc-iniyyzyi1865900.shtml）
    // 复核段逐字一致；山西招生考试网 sxkszx.cn 本轮 curl http 403、https 超时、
    // browser.open 失败，未直读到官方原文，故口径级别为转载级、不得写「据官网公告」，
    // 不挂 sxkszx.cn 的 url 字段（detail 文本亦不写 URL 字符串）。复核窗口无具体时刻
    // （原文只写「工作时间内」），不补时刻、不入 PEAK 表；11 月 27 日是结果通知日、
    // 不是节点截止时刻，同样不入表。节点 11-19→11-20：11-19 被海南直接节点抑制进
    // 接续区（与江西复核同款，抑制只拦 startsToday）；11-20 以 endsToday 进今日行
    // （第一遍不抑制），无 PEAK 表项故无倒计时 chip、全天显示「进行中」、不翻「已截止」。
    // 天津成绩复核（U-162，转载级，2026-11-19 核实）：环球青藤（原环球网校）
    // hqwx 2026-11-18《2026成考查分汇总11月18日更新：海南19日17时将公布，
    // 17地开通记录对照》（https://www.hqwx.com/chengrengk-kaoshi/news/17859084897258.html）——
    // 成绩 11 月 18 日 9 时起可查，复核 11 月 19 日 9 时至 18 时网上申请缴费，
    // 复核结果 11 月 25 日 9 时起查结果（表格版：11 月 25 日 9 时至 11 月 30 日
    // 17 时查结果）。hqwx 自认「本文为资讯梳理，不是官方公告原文；所有时间、
    // 凭证与后续安排以各省教育考试院官方发布为准」，且「本页保留前次已核验开通
    // 的 17 地快照，本轮仅补海南待开通提示，其他地区未在本轮重新逐省核验」——
    // 天津细节为前次快照、本轮未重新核验。zhaokao.net 本轮未直读到官方原文，
    // 无第二信源，故口径级别为转载级、不得写「据官网公告」，不挂 url 字段
    // （detail 文本亦不写 URL 字符串）。移动端不支持复核申请，需电脑访问招考
    // 资讯网（只记注释，不进 detail）。11-19 18:00 是截止时刻、入 PEAK 表
    // （与海南 17:00、上海 10:00 的开通时刻性质相反，后两者不入表）；结果窗口
    // 11-25 09:00 是开通时刻、11-30 17:00 是结果窗口末端，均不入表。节点单日
    // kind 'today'：11-19 进今日行（海南直接节点之后），11-20 翻 done、不进
    // 接续区。eol.cn 2025 口径（11-19 09:00–11-20 12:00 现场办理）与 2026
    // 三处实质冲突，绝不复刻。
    // 查分节点不挂 url（五省：广东走官微/支付宝/百度三大小程序；江西、浙江、
    // 新疆查分 URL 未核实到 verbatim，不编链接；海南查询入口 URL 已核实但仍不挂，
    // 见海南注释，U-102 口径）；
    // 江西复核节点挂报名系统直链（公告原文所载），不是查分链接；新疆复核
    // 走邮箱申请，无 URL 可挂；广东复核线下书面申请，无 URL 可挂；山西复核
    // 线下办理、无 URL 可挂（sxkszx.cn 本轮未证实可达，不编链接）；天津复核
    // 网上申请缴费、无 URL 可挂（招考资讯网本轮未直读到官方原文，不编链接）。
    nodes: [
      {
        label: '江西成绩查询',
        detail: '11 月 18 日 9:00 起可查（江西省教育考试院网服务大厅「成绩查询」栏目）',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '江西成绩复核',
        detail: '11 月 19 日 9:00 至 11 月 20 日 17:00 登录江西省成人高考网上报名系统申请，复核结果 11 月 24 日通过报名系统反馈',
        url: JIANGXI_CHENGKAO_REVIEW_URL,
        startISO: '2026-11-19',
        endISO: '2026-11-20',
      },
      {
        label: '广东成绩查询',
        detail: '11 月 18 日 16:00 起短信推送，16:20 起官微（gdsksy）/支付宝/百度小程序可查',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '广东成绩复核',
        detail: '复查须在 11 月 20 日 15:00 前凭身份证件、准考证到当地县（市、区）招生办书面申请，逾期不予受理',
        startISO: '2026-11-20',
        endISO: '2026-11-20',
      },
      {
        label: '新疆成绩查询',
        detail: '11 月 18 日 12:00 起可查（新疆教育考试院官网"新疆招生网"公众服务大厅"成绩查询"，输入身份证号、密码、短信验证码）',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '新疆成绩复核',
        detail: '11 月 18 日 12:00 至 11 月 20 日 12:00，下载《2026年自治区成人高考复核成绩申请表》，填好发送至所在地（州、市）教育考试机构指定邮箱（具体邮箱见公告附件2），逾期不再受理',
        startISO: '2026-11-18',
        endISO: '2026-11-20',
      },
      {
        label: '山西成绩复核',
        detail: '成绩已于 11 月 18 日公布；对成绩有疑义的考生，可于 11 月 19 日、20 日的工作时间内，到考试所在市的招生考试机构办理成绩复核手续，逾期不予受理；11 月 27 日前，各市招生考试机构通知考生成绩复核结果（转载级：山西省招生考试管理中心 2026-11-16 通知，凤凰网与新浪财经转载一致，本站未在山西招生考试网直读到官方原文）',
        startISO: '2026-11-19',
        endISO: '2026-11-20',
      },
      {
        label: '海南成绩查询',
        detail: '11 月 19 日 17:00 起可查（海南省成人高考报名系统）',
        startISO: '2026-11-19',
        endISO: '2026-11-19',
      },
      {
        label: '天津成绩复核',
        detail: '11 月 19 日 9:00 至 18:00 网上申请缴费；复核结果 11 月 25 日 9:00 至 11 月 30 日 17:00 可查（转载级、未见官方原文，待官方原文核实后升级）',
        startISO: '2026-11-19',
        endISO: '2026-11-19',
      },
      {
        label: '浙江成绩查询',
        detail: '11 月 20 日左右公布成绩与分数线（浙江省教育考试院成人高校招生报名系统）',
        startISO: '2026-11-20',
        endISO: '2026-11-20',
        estimated: true,
      },
      {
        label: '浙江志愿确认',
        detail: '11 月 25 日 8:30 至 11 月 29 日 17:00，登录成人高校招生报名系统确认或修改志愿',
        startISO: '2026-11-25',
        endISO: '2026-11-29',
      },
    ],
    note: '成绩分省公布，无全国统一时间。广东成绩证书 11 月 28 日 16:00 起可通过官微/支付宝/百度小程序下载打印；其余省份时间各异，以各省教育考试院公告为准。',
  },
  {
    id: 'jiangsu-zikao',
    name: '2026 年 10 月江苏省高等教育自学考试',
    shortName: '江苏自考',
    tagline: '成绩 11 月 18 日公布',
    examDateLabel: '10 月 24–25 日',
    startISO: '2026-10-24',
    endISO: '2026-10-25',
    // 江苏自考成绩与复核（U-144，2026-11-18 核实）：成绩 11-18 10:00 发布，
    // 入口 www.jseea.cn「招考业务」-「自学考试」；复核登记 11-18、19、20 日
    // （17:00 截止），持本人身份证、准考证到所属区县考办登记，逾期不予受理
    // （常州发布转载江苏省教育考试院通告）。考期 10-24–25：eol.cn 两篇 +
    // 江苏省教育考试院 10-14 特别提醒转载一致，无矛盾。
    // 统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩复核为线下
    // 登记，无线上入口。两节点不挂 url（无网页深链可挂，不编链接）、不设
    // estimated（日期均已核实）；label 不带省前缀（短名已含「江苏」）。
    nodes: [
      {
        label: '成绩查询',
        detail: '11 月 18 日 10:00 起可查（江苏省教育考试院门户网站 www.jseea.cn「招考业务」栏目「自学考试」页面）',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
      },
      {
        label: '成绩复核',
        detail: '11 月 18 日、19 日、20 日（17:00 截止）持本人身份证、准考证到所属区县考办登记并提交复核申请，逾期不予受理',
        startISO: '2026-11-18',
        endISO: '2026-11-20',
      },
    ],
    note: '统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩复核为线下登记，无线上入口。',
  },
  {
    id: 'guangdong-zikao',
    name: '2026 年 10 月广东省高等教育自学考试',
    shortName: '广东自考',
    tagline: '成绩 11 月 18 日公布',
    examDateLabel: '10 月 24–25 日',
    startISO: '2026-10-24',
    endISO: '2026-10-25',
    // 广东自考成绩查询（U-144，2026-11-18 核实）：成绩 11-18 15:00 公布
    // （广东省教育考试院 2026-11-10 省自考委办公告原文「定于 11 月 18 日
    // 15 时公布考试成绩」）；入口 4 种：官微小程序（gdsksy）、支付宝小
    // 程序、百度智能小程序、广东省自学考试管理系统（查合格成绩与当次违
    // 规处理情况）。复核无全省统一窗口，各市自考办在公布后 10 个工作日
    // 内安排，不设日期节点、不进查表、不挂 url 以外入口。考期 10-24–25。
    // 统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩查询挂
    // 线上系统直链（U-87 规则：公告原文给出可直接登录办理的线上系统
    // URL 才挂链），不设 estimated（日期与时刻均已核实）；label 不带省
    // 前缀（短名已含「广东」）。
    nodes: [
      {
        label: '成绩查询',
        detail: '11 月 18 日 15:00 起可查：官微小程序（gdsksy）、支付宝小程序、百度智能小程序、广东省自学考试管理系统（查合格成绩与当次违规处理情况）',
        startISO: '2026-11-18',
        endISO: '2026-11-18',
        url: GUANGDONG_ZIKAO_SCORE_URL,
      },
    ],
    note: '统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩复核无全省统一窗口，各市自考办在成绩公布后 10 个工作日内安排具体受理时间与地点，以所在市公布为准，须本人持身份证、准考证到参加考试所在市自考办申请，逾期不予受理，仅限漏评、漏记分、错记分、加错分四种情形。',
  },
  {
    id: 'shanghai-zikao',
    name: '2026 年下半年上海市高等教育自学考试',
    shortName: '上海自考',
    tagline: '成绩 11 月 19 日公布',
    examDateLabel: '10 月 24–25 日',
    startISO: '2026-10-24',
    endISO: '2026-10-25',
    // 上海自考成绩与复核（U-163）：上海市教育考试院《上海市2026年下半年高等教育自学考试成绩将于11月19日公布》公告原文（2026-11-13），2026-11-18 核实——成绩查询通道 11-19 10:00 至 12-18 16:00 开通；复核 11-20 至 22 日向主考高校申请，具体时间与方式见主考高校网站通知。
    // 考期 10-24–25：上海应用技术大学继续教育学院 2026-10-16 通知原文「理论课将于 10 月 24 日、25 日举行」。
    // 统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；两节点不挂 url
    // （无网页深链可挂，不编链接；考生服务平台 ste.shmeea.edu.cn 只是平台
    // 首页，按 U-87 规则不挂）、不设 estimated（日期均已核实）；label 不带
    // 省前缀（短名已含「上海」，与江苏/广东自考同款）。
    nodes: [
      {
        label: '成绩查询',
        detail: '11 月 19 日 10:00 至 12 月 18 日 16:00 可查（上海市教育考试院官网首页「成绩查询」栏目，或上海市高等教育自学考试考生服务平台，凭准考证号 / 证件号查询）',
        startISO: '2026-11-19',
        endISO: '2026-12-18',
      },
      {
        label: '成绩复核',
        detail: '11 月 20 日至 22 日向主考高校申请成绩复核，具体复核时间与复核方式见主考高校网站通知',
        startISO: '2026-11-20',
        endISO: '2026-11-22',
      },
    ],
    note: '统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩复核向主考高校申请，具体复核时间与复核方式见主考高校网站通知。',
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
  '考试日期据官方公告核实于 2026 年 11 月 17 日（军队文职、教资面试、江西成考复核、新疆成考成绩与复核、上海自考成绩与复核核实于 11 月 18 日；海南成考成绩核实于 11 月 19 日），请以各考试官方最新公告为准。'

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

/**
 * 今日节点（U-102，首页「今日提醒」行的数据源）。
 *
 * 判定只用自然日口径（daysUntil + examNodeStatus），不新造时刻门控函数、
 * 不给 ExamNode 加时刻字段（京考报名 18:00 截止的决策见 jingkao 节点注释）：
 *  - kind 'today'：单日节点当天（examNodeStatus === 'today'），如三省成绩查询；
 *  - kind 'endsToday'：多日窗口末日当天（active 且 endISO 就是今天），
 *    如京考报名、文职缴费在 11-18——行内只写「今日截止」，时点只以
 *    节点 detail 原文呈现，不算「已截止 / 未截止」；
 *  - kind 'startsToday'：多日窗口首日当天（active 且 startISO 就是今天），
 *    但只在该场考试当天没有更直接的今日节点（today / endsToday）时才收录，
 *    如江西成绩复核在 11-19；新疆成绩复核在 11-18 不收——成考当天已有
 *    三省查询三个今日节点，复核进接续区，不抢今日行。
 *  - estimated 节点永不进今日集合（examNodeStatus 恒返回 'estimated'，
 *    如浙江成绩查询 11-20 当天也不出现）。
 * 顺序：直接节点（today / endsToday）按 EXAMS 数组序、考试内节点数组序；
 * startsToday 为第二遍追加，排在全部直接节点之后；两遍内部均不另排序。
 * exams 参数只为测试注入合成数据，调用方不传。11-18 恰好 7 项，11-19 海南成绩查询（today）+ 上海自考成绩查询（startsToday）2 项；
 * 江西成绩复核因成考已有今日节点退接续区（U-164，与新疆复核 11-18 同款抑制）。
 */
export interface TodayNodeItem {
  exam: ExamInfo
  node: ExamNode
  kind: 'today' | 'endsToday' | 'startsToday'
}

export function todayNodes(
  nowMs: number = Date.now(),
  exams: ExamInfo[] = EXAMS,
): TodayNodeItem[] {
  const items: TodayNodeItem[] = []
  const hasDirectToday = new Set<string>()
  for (const exam of exams) {
    for (const node of exam.nodes) {
      if (node.estimated) continue
      const status = examNodeStatus(node, nowMs)
      if (status === 'today') {
        items.push({ exam, node, kind: 'today' })
        hasDirectToday.add(exam.id)
      } else if (status === 'active' && daysUntil(node.endISO, nowMs) === 0) {
        items.push({ exam, node, kind: 'endsToday' })
        hasDirectToday.add(exam.id)
      }
    }
  }
  for (const exam of exams) {
    if (hasDirectToday.has(exam.id)) continue
    for (const node of exam.nodes) {
      if (node.estimated) continue
      if (examNodeStatus(node, nowMs) === 'active' && daysUntil(node.startISO, nowMs) === 0) {
        items.push({ exam, node, kind: 'startsToday' })
      }
    }
  }
  return items
}

/**
 * 今日节点的接续节点（U-102，今日行展开区「接续安排」的数据源）。
 *
 * 只取当天有今日节点的考试、且不在今日集合内、仍可办（isNodeActionable）
 * 的节点，按 startISO 排序：文职 11-18 接续为准考证打印 + 全军统一笔试，
 * 京考接续为准考证打印 + 公安专业科目笔试 + 公共科目笔试；成考接续为
 * 三省复核 + 浙江志愿确认（estimated 的浙江成绩查询被 isNodeActionable
 * 排除）。全部取自节点数据，不写死日期、不新造节点——京考没有缴费节点，
 * 故「京考缴费」不可能出现。
 */
export interface TodayFollowUpItem {
  exam: ExamInfo
  node: ExamNode
}

export function todayFollowUpNodes(
  nowMs: number = Date.now(),
  exams: ExamInfo[] = EXAMS,
): TodayFollowUpItem[] {
  const today = todayNodes(nowMs, exams)
  const todayKeys = new Set(today.map((t) => `${t.exam.id}\n${t.node.label}`))
  const involved = new Set(today.map((t) => t.exam.id))
  const out: TodayFollowUpItem[] = []
  for (const exam of exams) {
    if (!involved.has(exam.id)) continue
    const rest = exam.nodes
      .filter((n) => !todayKeys.has(`${exam.id}\n${n.label}`))
      .filter((n) => isNodeActionable(n, exam, nowMs))
      .sort((a, b) => a.startISO.localeCompare(b.startISO))
    for (const node of rest) out.push({ exam, node })
  }
  return out
}

/** 最近一场：未结束的考试里首考日最早的；多日考试末日仍算未结束
 *（考研 12-19–20：12-20 当天条带仍在，与 /exam 倒计时岛「进行中 ·
 * 第 2 天」一致）；十一场全结束则返回 undefined（调用方渲染空态条带）。
 * 排序按首考日（firstExamDay），不是公共科目首日 startISO：有加试的
 * 考试（国考首考日 11-28 < startISO 11-29；京考首考日 12-05 < startISO
 * 12-06）应按考生实际最早开考日排。同日首考平局时数组在前者胜出
 *（stable sort）：教资面试首考日 12-05 与京考同日、且排在京考之前，
 * 故 11-30 起最近场为教资面试；军队文职首考日 12-13 独占，12-13
 * 当天最近场为军队文职（此前为考研）；exams 参数只为测试注入合成
 * 数据（2026-11-16 0922 C 线），调用方不传。 */
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
 * 11-18 峰值日时刻截止表（渲染层专用，考试峰值日包 W9，U-144 推广）。
 *
 * 覆盖 12 个已核实目标时刻（北京时间，表项为目标日期 + 距当日 0 点的分钟数；
 * 毫秒值按 shanghaiMidnightMs(目标日期) + 分钟数算，与 guokaoAdmissionPhase
 * 的 15:00 截止同款算法）：
 *  - 成考江西成绩查询 11-18 09:00、成考新疆成绩查询 11-18 12:00、成考广东
 *    成绩查询 11-18 16:20（三省 detail 原文所载公告时刻；广东取 16:20
 *    小程序自查开通时刻，16:00 仅短信推送；「已截止」只指公告时刻已过，
 *    不代表查分通道关闭，永不写「已开通」「已可查」）；
 *  - 京考报名 11-18 18:00、军队文职缴费 11-18 18:00（两节点 detail 原文所载截止时刻）；
 *  - 江苏自考成绩查询 11-18 10:00（查分行）、江苏自考成绩复核 11-20 17:00
 *    （截止行；复核目标日期是 11-20，绝不是 11-18——1020 分钟若配 11-18
 *    会错成 11-18 17:00，故表项必须带目标日期，不许只存分钟数）；
 *  - 广东自考成绩查询 11-18 15:00（查分行；自考 15:00，绝不是成考广东
 *    16:20、不是江苏 10:00）。
 *  - 上海自考成绩查询不入表（U-163 复审必改 1）：11-19 10:00 是开通时刻、
 *    不是截止时刻，且该行 kind startsToday、无 hideWhenPassed 保护，入表
 *    会在 10:00 后谎报「已截止」，与同行「可查至 12-18 16:00」自相矛盾；
 *    复核 11-20–22 只有日期区间、无截止时刻，同样不入表，不得编造时刻。
 *  - 海南成考成绩查询不入表（U-164）：11-19 17:00 是开通时刻、不是截止时刻；
 *    且该行 kind today、有 hideWhenPassed 保护，入表也不会显示「已截止」
 *    （17:00 后 chip 消失，与江苏查分 11-18 10:00 后同款；「已截止」误显示是
 *    startsToday 行才有的 failure mode，见上海 10:00）；不入表的理由是表是
 *    deadline 表、开通时刻不入（2322 轮复审定论），且入表会在 17:00 前多一个
 *    「剩 X 小时」chip、语义上把"距开通"写成 deadline 语言，与同日上海行不对称。
 *    公告未给查分关闭日，不得编造表项。
 *  - 天津成考成绩复核 11-19 18:00（U-162，转载级）：单日节点 kind today，
 *    截止时刻入表（与广东复核 15:00 同款，U-158）；18:00 前倒计时 chip、
 *    18:00 后 chip 消失、不显示「已截止」（hideWhenPassed）；结果窗口
 *    11-25 09:00 是开通时刻、11-30 17:00 是结果窗口末端，均不入表。
 *  - 山西成考成绩复核不入表（U-160）：复核窗口 11-19–20 只写「工作时间内」、
 *    无截止时刻，不得编造时刻；11 月 27 日前通知结果是结果通知日、不是节点
 *    截止时刻，同样不入表。节点 11-19→11-20：11-19 被海南直接节点抑制
 *    （startsToday 才抑制）；11-20 以 endsToday 进今日行，但无表项故无倒计时
 *    chip、全天「进行中」、不翻「已截止」。
 *  - 成考三省成绩复核 11-20 截止（U-158）：广东 15:00（单日节点，kind today，
 *    过期 chip 消失）、新疆 12:00、江西 17:00（两多日窗口末日，kind endsToday，
 *    过期显示「已截止」）；三者 detail 原文所载公告时刻，与江苏复核 11-20
 *    17:00 同机制。广东 15:00 取教育在线转载的省考试院 2026-11-09 通知逐字
 *    （“11 月 20 日 15:00 前”书面申请）；新疆 12:00 与江西 17:00 取省考试院
 *    公告原文直读（xjzk.gov.cn 2026-11-16、jxeea.cn 2026-11-13，W9 本轮直读逐字）。
 *  - 陷阱：广东成考复核 15:00 绝不是广东自考 11-18 15:00（键不同）；新疆复核
 *    12:00 绝不是新疆查分 11-18 12:00（date 不同）；江西复核 17:00 绝不是
 *    11-18 17:00。
 *
 * 不给 ExamNode 加时刻字段、不改 examNodeStatus / todayNodes：节点状态机
 * 与今日行仍是纯日期口径（todayNodes 的注释仍成立）；时刻判定只发生在
 * 渲染层，调用方用 `deadlineLabel ?? EXAM_NODE_STATUS_LABEL[status]` 取文案。
 * 守卫：只按 `${exam.id}:${node.label}` 查表，且节点日期须覆盖目标日期
 * （查 node.startISO / endISO），不以 label 裸匹配；其他节点一律 undefined / null。
 */
const PEAK_DAY_DEADLINE_MINUTES: Readonly<Record<string, { date: string; minutes: number }>> = {
  'chengkao:江西成绩查询': { date: '2026-11-18', minutes: 9 * 60 },
  'chengkao:新疆成绩查询': { date: '2026-11-18', minutes: 12 * 60 },
  'chengkao:广东成绩查询': { date: '2026-11-18', minutes: 16 * 60 + 20 },
  'chengkao:天津成绩复核': { date: '2026-11-19', minutes: 18 * 60 },
  'chengkao:广东成绩复核': { date: '2026-11-20', minutes: 15 * 60 },
  'chengkao:新疆成绩复核': { date: '2026-11-20', minutes: 12 * 60 },
  'chengkao:江西成绩复核': { date: '2026-11-20', minutes: 17 * 60 },
  'jingkao:报名': { date: '2026-11-18', minutes: 18 * 60 },
  'jundui-wenzhi:缴费': { date: '2026-11-18', minutes: 18 * 60 },
  'jiangsu-zikao:成绩查询': { date: '2026-11-18', minutes: 10 * 60 },
  'jiangsu-zikao:成绩复核': { date: '2026-11-20', minutes: 17 * 60 },
  'guangdong-zikao:成绩查询': { date: '2026-11-18', minutes: 15 * 60 },
}

/** 表内节点的目标时刻（UTC 毫秒数）；表外或节点日期不覆盖目标日期的返回 undefined */
function peakDayDeadlineMs(exam: ExamInfo, node: ExamNode): number | undefined {
  const target = PEAK_DAY_DEADLINE_MINUTES[`${exam.id}:${node.label}`]
  if (target === undefined) return undefined
  if (node.startISO > target.date || node.endISO < target.date) return undefined
  return shanghaiMidnightMs(target.date) + target.minutes * 60 * 1000
}

/** 今日行条目的目标时刻（UTC 毫秒数）：表外节点返回 undefined，供倒计时组件传 target 用 */
export function todayNodeDeadlineMs(item: TodayNodeItem): number | undefined {
  return peakDayDeadlineMs(item.exam, item.node)
}

/**
 * 节点时刻截止文案（渲染层用）：目标时刻已到（nowMs >= 目标时刻）返回
 * 「已截止」，未到或表外节点返回 null；调用方用
 * `examNodeDeadlineLabel(exam, node, nowMs) ?? EXAM_NODE_STATUS_LABEL[examNodeStatus(node, nowMs)]`
 * 取最终文案。
 */
export function examNodeDeadlineLabel(
  exam: ExamInfo,
  node: ExamNode,
  nowMs: number = Date.now(),
): '已截止' | null {
  const deadlineMs = peakDayDeadlineMs(exam, node)
  if (deadlineMs === undefined) return null
  return nowMs >= deadlineMs ? '已截止' : null
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
 * 十一场全结束返回 undefined（调用方隐藏该行，不写未公布日期）。
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
 * 事实来源（打印窗口与退场句 2026-11-14 按官方公告逐项核实；直链分工
 * U-59，2026-11-17 雷达第 16 轮定性）：
 *  - 打印窗口 11 月 23 日 0:00 至 11 月 29 日 15:00，逾期系统关闭、无法补打；
 *  - 退场句出自考场规则、不在公告正文；
 *  - 站内提醒唯一可点击入口是报名确认及准考证打印系统直达
 *    http://gwy.cpta.com.cn（官方 2026-10-25 公告《报名确认及准考证
 *    打印网址》所载，教育在线 2026-10-26 逐字转载；根路径实测 405，
 *    表单系统常见响应，非死链；链接写 http）；
 *  - 专题网站门户 http://bm.scs.gov.cn/kl2027（报名/审查入口，见
 *    GUOKAO_PORTAL_URL）实测仅 335 B JS 跳转页，当前直接访问会跳到
 *    scs.gov.cn 首页、找不到打印系统，故不作提醒的点击目标；
 * 文案（U-98）：card/strip 双写两层——登录专题网站 bm.scs.gov.cn/kl2027，
 * 选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）；点击目标仍只
 * 挂 gwy 直链，不挂门户。
 *  - 「考生考务入口」来源：2027 年度报考指南原文（报名确认段）——华图
 *    2026-10-31 文引原文“登录专题网站，选择「考生考务入口」（或报名确认
 *    及准考证打印网址）进入”；本轮未从 scs.gov.cn 原站直读该指南原文，
 *    上句仅转引华图所引原文口径，不作原站直读背书。
 *  - 未验证项：本机沙箱 curl 外网返回 000（DNS 黑洞），gwy 直链未从
 *    本机直访复核；也未能从 scs.gov.cn 原站直读 2026-10-25 公告。
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
    strip: '国考准考证明天 0:00 开放打印，11 月 29 日 15:00 截止；登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）',
    card: '2027 国考准考证明天（11 月 23 日）0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn），多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  open: {
    strip: '国考准考证打印已开放，11 月 29 日 15:00 截止，逾期无法补打；登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）',
    card: '2027 国考准考证打印已开放，11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn），多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  'last-call': {
    strip: '末班提醒：国考准考证 11 月 29 日 15:00 截止，逾期无法补打；今年新规：开考 15 分钟后不得入场，行测最晚 8:45、申论 13:45；登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）',
    card: '末班提醒：2027 国考准考证 11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn），多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
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
    const strip = `国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止；登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）`
    const card = `2027 国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站 bm.scs.gov.cn/kl2027，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn），多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。`
    return { phase, stripLine: strip, cardLine: card, url: GUOKAO_ADMISSION_URL }
  }
  const copy = GUOKAO_ADMISSION_COPY[phase]
  return { phase, stripLine: copy.strip, cardLine: copy.card, url: GUOKAO_ADMISSION_URL }
}
