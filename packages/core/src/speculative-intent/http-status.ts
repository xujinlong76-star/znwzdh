/**
 * HTTP 状态码标准字典与故障排查速查 (HTTP Status Encyclopedia)。
 */
import type { SpeculativeIntentResult } from './types.ts'

interface HttpStatusDef {
  code: number;
  phrase: string;
  nameCn: string;
  meaning: string;
  resolution: string;
}

const HTTP_STATUS_DICT: Record<number, HttpStatusDef> = {
  100: { code: 100, phrase: "Continue", nameCn: "继续", meaning: "客户端应继续其请求，服务器已收到第一部分", resolution: "通常在 Expect: 100-continue 握手由 HTTP 客户端自动处理" },
  101: { code: 101, phrase: "Switching Protocols", nameCn: "协议切换", meaning: "服务器同意按照 Upgrade 请求头切换协议（如 WebSocket）", resolution: "检查 WebSocket 握手或 HTTP/2 升级配置" },
  200: { code: 200, phrase: "OK", nameCn: "成功", meaning: "请求已成功处理，通常返回所请求的资源", resolution: "正常响应，无需干预" },
  201: { code: 201, phrase: "Created", nameCn: "已创建", meaning: "请求成功且服务器已创建了新资源（常见于 POST）", resolution: "通过 Location 头或响应体验证新资源 ID" },
  202: { code: 202, phrase: "Accepted", nameCn: "已接受", meaning: "服务器已接受请求但尚未处理完毕（异步任务）", resolution: "轮询任务 ID 或监听 webhook 异步通知" },
  204: { code: 204, phrase: "No Content", nameCn: "无内容", meaning: "请求成功，但响应报文不包含实体主体（常见于 DELETE/PUT）", resolution: "客户端不应尝试解析 JSON 响应体" },
  301: { code: 301, phrase: "Moved Permanently", nameCn: "永久重定向", meaning: "目标资源已被永久分配了新的 URI", resolution: "更新客户端/书签指向新地址；SEO 权重会传递至新地址" },
  302: { code: 302, phrase: "Found", nameCn: "临时重定向", meaning: "目标资源临时位于不同的 URI", resolution: "客户端应继续使用原有 URI 发起未来请求" },
  304: { code: 304, phrase: "Not Modified", nameCn: "未修改", meaning: "资源未改变，可直接使用客户端本地缓存（协商缓存）", resolution: "结合 If-None-Match (ETag) / If-Modified-Since 使用" },
  307: { code: 307, phrase: "Temporary Redirect", nameCn: "临时重定向（严格）", meaning: "临时重定向，且不允许客户端改变 HTTP 请求方法", resolution: "POST 请求重定向后必须继续保持 POST 方法" },
  308: { code: 308, phrase: "Permanent Redirect", nameCn: "永久重定向（严格）", meaning: "永久重定向，且不允许改变请求方法", resolution: "更新原地址；客户端需保持原始 HTTP 方法" },
  400: { code: 400, phrase: "Bad Request", nameCn: "错误请求", meaning: "服务器无法理解请求（语法无效、参数校验失败、请求体畸形）", resolution: "检查请求 JSON 格式、必填字段与类型校验错误详情" },
  401: { code: 401, phrase: "Unauthorized", nameCn: "未授权", meaning: "请求需要身份验证（缺 Token、Token 过期或格式无效）", resolution: "提供有效的 Authorization: Bearer <token> 或重新登录" },
  403: { code: 403, phrase: "Forbidden", nameCn: "拒绝访问", meaning: "服务器理解请求但拒绝执行（无对应 scope/角色/权限）", resolution: "检查凭据的 scopes 权限范围（read/write/admin）或 IP 白名单" },
  404: { code: 404, phrase: "Not Found", nameCn: "未找到", meaning: "服务器找不到请求的资源或对应路由端点不存在", resolution: "核对请求 URL 拼写、路由前缀；必要时尝试 Wayback 时间机器快照" },
  405: { code: 405, phrase: "Method Not Allowed", nameCn: "方法不被允许", meaning: "该资源不支持当前 HTTP 请求动词（如 GET 访问了 POST 端点）", resolution: "查看响应头 Allow，核对 API 文档规定的请求方法" },
  408: { code: 408, phrase: "Request Timeout", nameCn: "请求超时", meaning: "服务器在等待客户端发送完整请求时发生超时", resolution: "排查客户端网络链路延迟或上传大文件体连接过慢问题" },
  409: { code: 409, phrase: "Conflict", nameCn: "冲突", meaning: "请求与服务器当前状态冲突（如主键唯一约束冲突、状态并发冲突）", resolution: "检查是否重复提交已有唯一键（如同一 URL 或重名项）" },
  410: { code: 410, phrase: "Gone", nameCn: "资源已永久删除", meaning: "资源已被永久移除且不再有重定向地址", resolution: "从客户端移除该链接；搜索引擎会立即移除收录" },
  413: { code: 413, phrase: "Payload Too Large", nameCn: "请求体过大", meaning: "请求体体积超出服务器配置的处理上限", resolution: "调大反向代理 client_max_body_size 或分片分批上传" },
  415: { code: 415, phrase: "Unsupported Media Type", nameCn: "不支持的媒体类型", meaning: "服务器不支持请求实体的内容编码或 Content-Type", resolution: "设置规范的 Content-Type: application/json 或对应 MIME" },
  418: { code: 418, phrase: "I'm a teapot", nameCn: "我是一个茶壶", meaning: "RFC 2324 愚人节彩蛋：任何尝试用茶壶冲泡咖啡的请求都会被拒绝", resolution: "极客经典彩蛋；不可用于实际生产错误处理" },
  422: { code: 422, phrase: "Unprocessable Entity", nameCn: "无法处理的实体", meaning: "请求语法正确但语义有误（如字段类型或业务规则校验未通过）", resolution: "根据响应体的 detail.issues 逐项修正业务参数约束" },
  429: { code: 429, phrase: "Too Many Requests", nameCn: "请求过多 (限流)", meaning: "客户端在短时间内发送了过多请求，已触发限流策略", resolution: "读取 Retry-After 头延时重试；降低调用频率或申请提升配额" },
  451: { code: 451, phrase: "Unavailable For Legal Reasons", nameCn: "因法律原因不可用", meaning: "由于政府法令或版权审查要求导致资源无法访问", resolution: "致敬科幻小说《华氏451度》；涉及合规阻断" },
  500: { code: 500, phrase: "Internal Server Error", nameCn: "服务器内部错误", meaning: "服务器遇到了未预料的情况，导致无法完成请求", resolution: "检查服务端运行时错误日志与未捕获异常堆栈" },
  501: { code: 501, phrase: "Not Implemented", nameCn: "未实现", meaning: "服务器不支持当前请求所要求的功能（如未支持的 HTTP 动词）", resolution: "核对服务功能规范，改用已被支持的特性" },
  502: { code: 502, phrase: "Bad Gateway", nameCn: "错误网关", meaning: "反向代理（如 Nginx）向上游服务尝试发起请求时收到无效响应", resolution: "检查上游应用进程是否存活、监听端口是否正确、连接池是否耗尽" },
  503: { code: 503, phrase: "Service Unavailable", nameCn: "服务不可用", meaning: "服务器当前无法处理请求（因临时超载或正在停机维护）", resolution: "通常为临时状态，关注 Retry-After 头稍后重试；排查系统负载" },
  504: { code: 504, phrase: "Gateway Timeout", nameCn: "网关超时", meaning: "反向代理在规定时间内未能从上游服务器接收到响应", resolution: "排查上游慢查询、密集计算或调大 proxy_read_timeout" },
  505: { code: 505, phrase: "HTTP Version Not Supported", nameCn: "HTTP 版本不受支持", meaning: "服务器不支持请求中使用的 HTTP 协议主要版本", resolution: "切换客户端 HTTP/1.1 或 HTTP/2 协议协商" },
  521: { code: 521, phrase: "Web Server Is Down", nameCn: "源服务器停机 (Cloudflare)", meaning: "Cloudflare 边缘节点无法与源站建立 TCP 连接", resolution: "检查源站服务器防火墙、Web 守护进程 (Nginx/Node) 状态" },
  522: { code: 522, phrase: "Connection Timed Out", nameCn: "源站连接超时 (Cloudflare)", meaning: "Cloudflare 与源站的 TCP 握手发生超时", resolution: "排查源站网络丢包、防火墙拦截 Cloudflare IP 段或主机宕机" },
  524: { code: 524, phrase: "A Timeout Occurred", nameCn: "源站处理超时 (Cloudflare)", meaning: "TCP 已连接但源站 100 秒内未返回 HTTP 响应数据", resolution: "将长时间耗时操作改为后台异步任务，或调高响应超时配额" },
};

export function tryParseHttpStatus(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  let codeNum: number | null = null;

  const explicitMatch = trimmed.match(/^(?:http|status|code|httpstatus|httpcode|状态码)\s*:?\s*(\d{3})$/i)
    || trimmed.match(/^(\d{3})\s*(?:status|http|状态码)$/i);

  if (explicitMatch) {
    codeNum = parseInt(explicitMatch[1]!, 10);
  } else if (/^\d{3}$/.test(trimmed)) {
    const candidate = parseInt(trimmed, 10);
    if (candidate in HTTP_STATUS_DICT) {
      codeNum = candidate;
    }
  }

  if (codeNum === null || !(codeNum in HTTP_STATUS_DICT)) return null;

  const def = HTTP_STATUS_DICT[codeNum]!;
  let category = '';
  if (codeNum >= 100 && codeNum < 200) category = '1xx 信息响应 (Informational)';
  else if (codeNum >= 200 && codeNum < 300) category = '2xx 成功 (Successful)';
  else if (codeNum >= 300 && codeNum < 400) category = '3xx 重定向 (Redirection)';
  else if (codeNum >= 400 && codeNum < 500) category = '4xx 客户端错误 (Client Error)';
  else if (codeNum >= 500 && codeNum < 600) category = '5xx 服务端错误 (Server Error)';

  const preview = `HTTP ${def.code} ${def.phrase} (${def.nameCn})\n\n分类: ${category}\n含义: ${def.meaning}\n\n常见排查与处理建议:\n${def.resolution}`;

  return {
    type: 'http_status',
    title: `HTTP ${def.code} ${def.phrase} (${def.nameCn})`,
    subtitle: `${category} | ${def.meaning}`,
    previewValue: preview,
    actionLabel: '复制状态说明',
    copyValue: `HTTP ${def.code} ${def.phrase} (${def.nameCn}): ${def.meaning}`,
    details: {
      '状态码': String(def.code),
      '标准短语': def.phrase,
      '中文名': def.nameCn,
      '分类': category,
    },
  };
}
