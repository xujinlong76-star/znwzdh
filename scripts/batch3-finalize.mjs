/**
 * 第三批：终结剩余 2 个空缺子分类，实现 100% 子分类全覆盖
 */

export const BATCH3_CANDIDATES = [
  // 1. 资讯媒体 / 独立媒体 (reg-independent-media)
  {
    url: "https://www.aisixiang.com",
    title: "爱思想网",
    description: "中国极具学术声誉的思想文化学术网站，汇聚法学、经济学、社会学等领域著名学者的独立深度学术专栏与长文评论。",
    categoryId: "reg-independent-media",
    tags: ["学术思想", "人文社科", "独立评论", "学者专栏"]
  },
  {
    url: "https://www.zhishifenzi.com",
    title: "知识分子",
    description: "由饶毅、鲁白、谢宇等顶尖科学家创办的独立科学文化传播新媒体，致力于分享专业权威的科学洞见与独立理性声音。",
    categoryId: "reg-independent-media",
    tags: ["科学文化", "学术前沿", "独立媒体", "理性批判"]
  },

  // 2. 公共服务 / 教育民生服务 (reg-education-and-civic-services)
  {
    url: "https://www.cscse.edu.cn",
    title: "中国留学网 (CSCSE)",
    description: "教育部留学服务中心官方直属门户，负责国(境)外学历学位认证、国家公派出国留学档案办理与回国落户咨询服务。",
    categoryId: "reg-education-and-civic-services",
    tags: ["学历认证", "留学服务中心", "留学生档案", "教育部官方"]
  },
  {
    url: "https://yz.chsi.com.cn",
    title: "中国研究生招生信息网 (研招网)",
    description: "教育部指定全国硕士研究生招生考试网上报名、准考证下载、考研成绩查询与网上调剂服务的官方唯一官方系统。",
    categoryId: "reg-education-and-civic-services",
    tags: ["研招网", "考研报名", "成绩查询", "研究生招生"]
  },
  {
    url: "https://www.ncss.cn",
    title: "国家大学生就业服务平台 (24365校园招聘)",
    description: "教育部高校学生司指导的国家级高校毕业生就业一站式综合服务门户，汇集全国央国企名企真实校招岗位与求职帮扶。",
    categoryId: "reg-education-and-civic-services",
    tags: ["24365校园招聘", "大学生就业", "名企校招", "教育部服务"]
  }
];

export async function run() {
  console.log("=== 正在写入第 3 批收尾站点 ===");
  const resp = await fetch("http://127.0.0.1:8787/api/sites/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sites: BATCH3_CANDIDATES })
  }).then(r => r.json());

  console.log("响应结果:", resp);
}

run().catch(console.error);
