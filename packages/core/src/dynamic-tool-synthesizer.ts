/**
 * 动态工具合成器与安全执行沙箱 (Dynamic WebMCP Tool Synthesizer & Guarded Executor)
 *
 * 核心设计目标：
 * 1. 自动化接口工具化 (API-to-Tool Synthesis)：将 OpenAPI / REST 端点规格实时合成为标准 WebMCP 工具
 * 2. 站点检索动作工具化 (Site Action Synthesis)：将站点搜索引擎、聚合 API 动态注册为 AI Agent 可调用的工具
 * 3. 严格 SSRF 防护沙箱 (Guarded SSRF Shield)：阻断本地回环、内网私有地址、云元数据服务请求
 * 4. 弹性调用保障：具备可配置超时、响应体尺寸阈值截断与参数合法性校验
 */

export interface SynthesizedToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type SynthesizedToolHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export interface GuardOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowPrivateIps?: boolean;
  fetchFn?: typeof fetch;
  customHeaders?: Record<string, string>;
}

export interface RestParameterSpec {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  in: 'query' | 'path' | 'body' | 'header';
  default?: string | number | boolean;
}

export interface RestEndpointSpec {
  name: string;
  description: string;
  url: string; // 支持模板变量，如 "https://api.example.com/items/{id}"
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  parameters?: RestParameterSpec[];
  bodyType?: 'json' | 'form';
}

export interface SiteActionSpec {
  siteId: string;
  siteName: string;
  searchUrlTemplate?: string; // 如 "https://github.com/search?q={query}"
  apiEndpoint?: string;
  category?: string;
}

/**
 * 检验目标 URL 是否安全（SSRF 防御）
 */
export function isSafeUrl(rawUrl: string, allowPrivate = false): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // 必须是 http 或 https 协议
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  if (allowPrivate) {
    return { safe: true };
  }

  // 去掉尾随点：`localhost.` / `127.0.0.1.` 与不带点写法解析结果完全相同，
  // 但字符串比较会漏掉它们。
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  // 1. 本地域名阻断
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { safe: false, reason: 'Access to local domain is forbidden' };
  }

  // 1b. 非点分四段的 IP 变体：2130706433 / 0x7f000001 / 127.1 在多数解析器里
  //     都指向 127.0.0.1，但字符串层面看不出是私有地址。看不懂就拒绝，不做「尽力猜测」。
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/.test(hostname)) {
    return { safe: false, reason: 'Numeric-encoded host forbidden' };
  }
  if (/^\d+\.\d+$/.test(hostname)) {
    return { safe: false, reason: 'Shorthand IPv4 host forbidden' };
  }

  // 2. IPv4 私有及保留网段阻断
  // 匹配 IPv4 格式: d.d.d.d
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);
  if (match) {
    const octets = [
      Number.parseInt(match[1]!, 10),
      Number.parseInt(match[2]!, 10),
      Number.parseInt(match[3]!, 10),
      Number.parseInt(match[4]!, 10),
    ];

    if (octets.some((o) => o < 0 || o > 255)) {
      return { safe: false, reason: 'Invalid IPv4 octet' };
    }

    // 前导 0 的段会被解析器当八进制（0177 === 127），十进制 parseInt 看不出私有段
    const raw = [match[1]!, match[2]!, match[3]!, match[4]!];
    if (raw.some((o) => o.length > 1 && o.startsWith('0'))) {
      return { safe: false, reason: 'Octal-encoded IPv4 octet forbidden' };
    }

    const [b0, b1] = octets;

    // 0.0.0.0/8
    if (b0 === 0) return { safe: false, reason: 'Current network (0.0.0.0/8) forbidden' };
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return { safe: false, reason: 'Loopback address forbidden' };
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return { safe: false, reason: 'Private IP range (10.0.0.0/8) forbidden' };
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) {
      return { safe: false, reason: 'Private IP range (172.16.0.0/12) forbidden' };
    }
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) {
      return { safe: false, reason: 'Private IP range (192.168.0.0/16) forbidden' };
    }
    // 169.254.0.0/16 (Link-local & Cloud Metadata: AWS/GCP/Azure)
    if (b0 === 169 && b1 === 254) {
      return { safe: false, reason: 'Link-local / Cloud metadata service forbidden' };
    }
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 !== undefined && b1 >= 64 && b1 <= 127) {
      return { safe: false, reason: 'Carrier-grade NAT address forbidden' };
    }
  }

  // 3. IPv6 阻断：覆盖各种等价写法（::1 / 0:0:0:0:0:0:0:1 / IPv4 映射写法）
  const ipv6 = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (ipv6.includes(':')) {
    // IPv4 映射/兼容写法（::ffff:127.0.0.1）等价于内嵌的 IPv4，直接拒绝
    if (ipv6.includes('ffff:')) {
      return { safe: false, reason: 'IPv4-mapped IPv6 host forbidden' };
    }
    if (ipv6 === '::' || ipv6 === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(ipv6)) {
      return { safe: false, reason: 'IPv6 loopback/unspecified forbidden' };
    }
    if (
      ipv6.startsWith('fe80') ||
      ipv6.startsWith('fc') ||
      ipv6.startsWith('fd') ||
      ipv6.startsWith('ff')
    ) {
      return { safe: false, reason: 'IPv6 link-local/private/multicast range forbidden' };
    }
  }

  return { safe: true };
}

/**
 * 创建受 SSRF 和超时保护的 API 执行器
 */
export function createGuardedApiExecutor(options: GuardOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxResponseBytes ?? 512 * 1024;
  const allowPrivate = options.allowPrivateIps ?? false;
  const fetchImpl = options.fetchFn ?? fetch;

  return async (
    targetUrl: string,
    init: RequestInit = {}
  ): Promise<{ status: number; data: unknown; headers: Record<string, string> }> => {
    /**
     * 逐跳校验：fetch 默认**自动跟随重定向**，公开 URL 只要 302 到
     * http://169.254.169.254/... 就能整体绕过校验（一次性 isSafeUrl 只看首跳）。
     * 改成手动跟跳，每一跳都重新校验目标。
     */
    const maxRedirects = 3;
    const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const mergedHeaders = {
        'User-Agent': 'NavHub-Agent/5.0 (Dynamic-Synthesizer)',
        Accept: 'application/json, text/plain, */*',
        ...options.customHeaders,
        ...(init.headers as Record<string, string>),
      };

      let currentUrl = targetUrl;
      let currentMethod = (init.method ?? 'GET').toUpperCase();
      let currentBody = init.body;
      const currentHeaders: Record<string, string> = { ...mergedHeaders };
      let res: Awaited<ReturnType<typeof fetchImpl>> | undefined;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const safety = isSafeUrl(currentUrl, allowPrivate);
        if (!safety.safe) {
          throw new Error(`SSRF Guard Violation: ${safety.reason} (${currentUrl})`);
        }
        const requestInit: RequestInit = {
          ...init,
          method: currentMethod,
          headers: currentHeaders,
          redirect: 'manual',
          signal: controller.signal,
        };
        if (currentMethod === 'GET' || currentMethod === 'HEAD') {
          requestInit.body = undefined;
        } else {
          requestInit.body = currentBody;
        }
        const response = await fetchImpl(currentUrl, requestInit);
        if (!REDIRECT_STATUS.has(response.status)) {
          res = response;
          break;
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response without Location header (${currentUrl})`);
        }
        // 丢弃中间响应体，避免连接悬挂
        try {
          await response.body?.cancel();
        } catch {
          // 取消失败无关紧要：这个响应不会再被使用
        }
        if (hop === maxRedirects) {
          throw new Error(`Too many redirects (>${maxRedirects}) from ${targetUrl}`);
        }
        const nextUrl = new URL(location, currentUrl);
        // 跨源跳转不携带调用方凭据，避免把 spec 里的 Authorization 带到另一主机。
        if (nextUrl.origin !== new URL(currentUrl).origin) {
          for (const key of Object.keys(currentHeaders)) {
            if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase())) {
              delete currentHeaders[key];
            }
          }
        }
        // 301/302 的 POST 与 303 的非 GET/HEAD 降级为 GET；307/308 保留方法和请求体。
        if (
          (response.status === 303 && currentMethod !== 'GET' && currentMethod !== 'HEAD') ||
          ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
        ) {
          currentMethod = 'GET';
          currentBody = undefined;
          delete currentHeaders['content-type'];
          delete currentHeaders['Content-Type'];
        }
        currentUrl = nextUrl.toString();
      }
      if (!res) {
        throw new Error(`Redirect chain exceeded limit (>${maxRedirects}) from ${targetUrl}`);
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      // 读取响应体并控制尺寸
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > maxBytes) {
        throw new Error(
          `Response payload exceeded threshold: ${arrayBuffer.byteLength} > ${maxBytes} bytes`
        );
      }

      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(arrayBuffer);

      let data: unknown = text;
      const contentType = responseHeaders['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(text);
        } catch {
          // 回退为文本
        }
      }

      return {
        status: res.status,
        data,
        headers: responseHeaders,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * 将 RestEndpointSpec 合成为标准 WebMCP 工具
 */
export function synthesizeRestTool(
  spec: RestEndpointSpec,
  options: GuardOptions = {}
): { definition: SynthesizedToolDefinition; handler: SynthesizedToolHandler } {
  // 构建 JSON Schema properties
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of spec.parameters || []) {
    properties[param.name] = {
      type: param.type,
      description: param.description || `Parameter ${param.name} (${param.in})`,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  const definition: SynthesizedToolDefinition = {
    name: spec.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    description: spec.description,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };

  const executor = createGuardedApiExecutor(options);

  const handler: SynthesizedToolHandler = async (params: Record<string, unknown>) => {
    // 1. 参数校验与分类装配
    let url = spec.url;
    const queryParams = new URLSearchParams();
    const bodyObj: Record<string, unknown> = {};
    const headerObj: Record<string, string> = { ...(spec.headers || {}) };

    for (const p of spec.parameters || []) {
      const val = params[p.name] ?? p.default;
      if (p.required && val === undefined) {
        throw new Error(`Missing required parameter: ${p.name}`);
      }
      if (val === undefined) continue;

      if (p.in === 'path') {
        url = url.replace(new RegExp(`\\{${p.name}\\}`, 'g'), encodeURIComponent(String(val)));
      } else if (p.in === 'query') {
        queryParams.set(p.name, String(val));
      } else if (p.in === 'header') {
        headerObj[p.name] = String(val);
      } else if (p.in === 'body') {
        bodyObj[p.name] = val;
      }
    }

    // 拼接 Query String
    const qs = queryParams.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }

    const requestInit: RequestInit = {
      method: spec.method,
      headers: headerObj,
    };

    if (spec.method !== 'GET' && Object.keys(bodyObj).length > 0) {
      if (spec.bodyType === 'form') {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(bodyObj)) {
          form.set(k, String(v));
        }
        requestInit.body = form.toString();
        headerObj['content-type'] = 'application/x-www-form-urlencoded';
      } else {
        requestInit.body = JSON.stringify(bodyObj);
        headerObj['content-type'] = 'application/json';
      }
    }

    const response = await executor(url, requestInit);
    return {
      status: response.status,
      data: response.data,
      endpoint: url,
    };
  };

  return { definition, handler };
}

/**
 * 将站点站内搜索能力合成为 WebMCP 工具
 */
export function synthesizeSiteSearchTool(site: SiteActionSpec): {
  definition: SynthesizedToolDefinition;
  handler: SynthesizedToolHandler;
} {
  const toolName = `search_${site.siteId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const definition: SynthesizedToolDefinition = {
    name: toolName,
    description: `在 ${site.siteName} (${site.category || '导航分类'}) 中搜索资源与内容`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
      },
      required: ['query'],
    },
  };

  const handler: SynthesizedToolHandler = (params: Record<string, unknown>) => {
    const q = typeof params.query === 'string' ? params.query.trim() : '';
    if (!q) {
      throw new Error('Query string cannot be empty');
    }

    let targetUrl = '';
    if (site.searchUrlTemplate) {
      targetUrl = site.searchUrlTemplate.replace(/\{query\}/g, encodeURIComponent(q));
    } else if (site.apiEndpoint) {
      const sep = site.apiEndpoint.includes('?') ? '&' : '?';
      targetUrl = `${site.apiEndpoint}${sep}q=${encodeURIComponent(q)}`;
    } else {
      targetUrl = `https://www.google.com/search?q=site:${site.siteId}+${encodeURIComponent(q)}`;
    }

    return {
      siteId: site.siteId,
      siteName: site.siteName,
      query: q,
      navigableUrl: targetUrl,
      action: 'NAVIGATE_OR_FETCH',
    };
  };

  return { definition, handler };
}

/**
 * 极简 OpenAPI 3.0 / Swagger 规范解析器
 */
export interface MinimalOpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title: string; description?: string };
  servers?: Array<{ url: string }>;
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        summary?: string;
        description?: string;
        parameters?: Array<{
          name: string;
          in: 'query' | 'path' | 'header';
          required?: boolean;
          description?: string;
          schema?: { type?: string };
        }>;
      }
    >
  >;
}

export function parseOpenApiToSpecs(
  spec: MinimalOpenApiSpec,
  fallbackBaseUrl = 'https://api.example.com'
): RestEndpointSpec[] {
  const specs: RestEndpointSpec[] = [];
  const baseUrl = spec.servers?.[0]?.url || fallbackBaseUrl;

  const validMethods = ['get', 'post', 'put', 'delete', 'patch'];

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      const mLower = method.toLowerCase();
      if (!validMethods.includes(mLower)) continue;

      const fullUrl = baseUrl.endsWith('/') && path.startsWith('/')
        ? `${baseUrl.slice(0, -1)}${path}`
        : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

      const name =
        op.operationId ||
        `${mLower}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;

      const parameters: RestParameterSpec[] = (op.parameters || []).map((p) => {
        let pType: 'string' | 'number' | 'boolean' = 'string';
        if (p.schema?.type === 'integer' || p.schema?.type === 'number') {
          pType = 'number';
        } else if (p.schema?.type === 'boolean') {
          pType = 'boolean';
        }

        return {
          name: p.name,
          type: pType,
          description: p.description,
          required: Boolean(p.required),
          in: p.in,
        };
      });

      specs.push({
        name,
        description: op.summary || op.description || `Call ${method.toUpperCase()} ${path}`,
        url: fullUrl,
        method: method.toUpperCase() as RestEndpointSpec['method'],
        parameters,
      });
    }
  }

  return specs;
}
