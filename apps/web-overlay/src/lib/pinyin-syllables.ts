/**
 * 汉语拼音合法音节与声母表（纯数据，无依赖）。
 *
 * 为什么单独拆一个文件：linucb.ts 里的特征提取要用它做 DP 切分，
 * 而音节表本身是「语言事实」，不该埋在算法文件里被一次改动的 diff 淹没。
 * 同时这份表可被单测直接 import，避免测试复制粘贴第二份真相。
 */

/** 约 400 个合法无声调音节（含 ü 的常见省写 v）。 */
export const PINYIN_SYLLABLES: ReadonlySet<string> = new Set([
  'a','ai','an','ang','ao',
  'ba','bai','ban','bang','bao','bei','ben','beng','bi','bian','biao','bie','bin','bing','bo','bu',
  'ca','cai','can','cang','cao','ce','cen','ceng','cha','chai','chan','chang','chao','che','chen',
  'cheng','chi','chong','chou','chu','chua','chuai','chuan','chuang','chui','chun','chuo','ci','cong',
  'cou','cu','cuan','cui','cun','cuo',
  'da','dai','dan','dang','dao','de','dei','deng','di','dian','diao','die','ding','diu','dong','dou',
  'du','duan','dui','dun','duo',
  'e','ei','en','eng','er',
  'fa','fan','fang','fei','fen','feng','fo','fou','fu',
  'ga','gai','gan','gang','gao','ge','gei','gen','geng','gong','gou','gu','gua','guai','guan','guang',
  'gui','gun','guo',
  'ha','hai','han','hang','hao','he','hei','hen','heng','hong','hou','hu','hua','huai','huan','huang',
  'hui','hun','huo',
  'ji','jia','jian','jiang','jiao','jie','jin','jing','jiong','jiu','ju','juan','jue','jun',
  'ka','kai','kan','kang','kao','ke','ken','keng','kong','kou','ku','kua','kuai','kuan','kuang','kui',
  'kun','kuo',
  'la','lai','lan','lang','lao','le','lei','leng','li','lia','lian','liang','liao','lie','lin','ling',
  'liu','lo','long','lou','lu','luan','lue','lun','luo','lv','lve',
  'ma','mai','man','mang','mao','me','mei','men','meng','mi','mian','miao','mie','min','ming','miu',
  'mo','mou','mu',
  'na','nai','nan','nang','nao','ne','nei','nen','neng','ni','nian','niang','niao','nie','nin','ning',
  'niu','nong','nou','nu','nuan','nue','nuo','nv','nve',
  'o','ou',
  'pa','pai','pan','pang','pao','pei','pen','peng','pi','pian','piao','pie','pin','ping','po','pou','pu',
  'qi','qia','qian','qiang','qiao','qie','qin','qing','qiong','qiu','qu','quan','que','qun',
  'ran','rang','rao','re','ren','reng','ri','rong','rou','ru','ruan','rui','run','ruo',
  'sa','sai','san','sang','sao','se','sen','seng','sha','shai','shan','shang','shao','she','shen','sheng',
  'shi','shou','shu','shua','shuai','shuan','shuang','shui','shun','shuo','si','song','sou','su','suan',
  'sui','sun','suo',
  'ta','tai','tan','tang','tao','te','teng','ti','tian','tiao','tie','ting','tong','tou','tu','tuan',
  'tui','tun','tuo',
  'wa','wai','wan','wang','wei','wen','weng','wo','wu',
  'xi','xia','xian','xiang','xiao','xie','xin','xing','xiong','xiu','xu','xuan','xue','xun',
  'ya','yan','yang','yao','ye','yi','yin','ying','yo','yong','you','yu','yuan','yue','yun',
  'za','zai','zan','zang','zao','ze','zei','zen','zeng','zha','zhai','zhan','zhang','zhao','zhe','zhen',
  'zheng','zhi','zhong','zhou','zhu','zhua','zhuai','zhuan','zhuang','zhui','zhun','zhuo','zi','zong',
  'zou','zu','zuan','zui','zun','zuo',
])

/**
 * 合法声母（含 zh/ch/sh 双字母）。
 * 用于判断「纯声母简拼」——如 qdjb → q+d+j+b（启动脚本）。
 * 注意：v 不是汉语拼音声母（ü 只作韵母），因此不在表内。
 */
export const PINYIN_INITIALS: ReadonlySet<string> = new Set([
  'b','p','m','f','d','t','n','l','g','k','h',
  'j','q','x','zh','ch','sh','r','z','c','s','y','w',
])

/**
 * 常见英文词/技术缩写白名单：先于拼音判定排除。
 *
 * 为什么必须显式列出而不是只靠「不是合法音节」判断：
 * 有些英文词恰好能切成合法音节（如 'react' → re+a+ct 失败，但
 * 'nestjs' 之类有歧义），而真正高频的是下面这批——直接判定为非拼音
 * 既准确又省掉误判。命中即给极低分。
 */
export const NON_PINYIN_WORDS: ReadonlySet<string> = new Set([
  'vsc','vscode','react','vue','angular','svelte','next','nuxt','nest','nestjs',
  'github','gitlab','gitee','git','npm','pnpm','yarn','node','deno','bun',
  'nginx','apache','docker','k8s','kubernetes','redis','mysql','postgres','pg',
  'http','https','html','css','scss','less','json','yaml','xml','sql','api','sdk','cli','gui','ide',
  'linux','unix','windows','macos','ios','android','chrome','firefox','safari','edge',
  'python','java','golang','rust','swift','kotlin','scala','ruby','php','perl','lua','dart',
  'tensorflow','pytorch','numpy','pandas','jupyter','colab','hugging','openai','chatgpt',
  'figma','sketch','notion','slack','discord','zoom','trello','jira','vercel','netlify',
])
