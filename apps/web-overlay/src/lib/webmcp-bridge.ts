// @core-mirror:parity-ignore-start
// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。
// 事实源：packages/core/src/webmcp-bridge.ts
// 同步命令：node scripts/sync-core-mirrors.mjs
// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）
// @core-mirror:parity-ignore-end
/**
 * 浏览器端端侧 Model Context Protocol (WebMCP) 双向通信网桥
 *
 * 核心设计目标：
 * 为端侧 AI Agent、浏览器扩展、本地小模型 (WebLLM / Chrome Built-in AI)
 * 提供标准化的 JSON-RPC 2.0 协议交互入口，使 AI 能够直接查询 NavHub 知识库与图谱。
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type WebMcpToolHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export class WebMcpBridge {
  private tools: Map<string, { def: WebMcpToolDefinition; handler: WebMcpToolHandler }> = new Map();
  private allowedOrigins: Set<string>;
  /** 动态注册表上限：防止 /api/tools/synthesize 被滥用导致内存无限增长 */
  private readonly maxTools: number;

  constructor(options?: { allowedOrigins?: string[]; maxTools?: number }) {
    this.allowedOrigins = new Set(options?.allowedOrigins || ['*']);
    // 下限 16（覆盖内置工具），上限 4096（防误配）；默认 512
    this.maxTools = Math.max(16, Math.min(options?.maxTools ?? 512, 4096));
    this.registerBuiltInTools();
  }

  /**
   * 注册自定义 MCP 工具
   */
  /**
   * 注册自定义 MCP 工具。
   * @returns 注册成功返回 true；同名覆盖返回 true；达到 maxTools 上限且为新工具时返回 false（调用方应回 429）
   */
  public registerTool(def: WebMcpToolDefinition, handler: WebMcpToolHandler): boolean {
    if (!this.tools.has(def.name) && this.tools.size >= this.maxTools) return false;
    this.tools.set(def.name, { def, handler });
    return true;
  }

  public get toolCount(): number {
    return this.tools.size;
  }

  public get maxToolCount(): number {
    return this.maxTools;
  }

  /**
   * 列出所有可用工具
   */
  public listTools(): WebMcpToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.def);
  }

  /**
   * 核心 JSON-RPC 2.0 请求处理器
   */
  public async handleRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!request || request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? 0,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      };
    }

    const { id, method, params } = request;

    try {
      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.listTools(),
          },
        };
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        const rawArgs = params?.arguments;
        const toolArgs: Record<string, unknown> =
          typeof rawArgs === 'object' && rawArgs !== null
            ? (rawArgs as Record<string, unknown>)
            : {};

        if (!toolName || typeof toolName !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: "name" is required' },
          };
        }

        const registered = this.tools.get(toolName);
        if (!registered) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        const executionResult = await registered.handler(toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof executionResult === 'string' ? executionResult : JSON.stringify(executionResult, null, 2),
              },
            ],
          },
        };
      }

      if (method === 'ping') {
        return {
          jsonrpc: '2.0',
          id,
          result: { status: 'pong', timestamp: Date.now() },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    } catch (err: unknown) {
      const data = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data },
      };
    }
  }

  /**
   * 注册内置核心工具
   */
  private registerBuiltInTools(): void {
    this.registerTool(
      {
        name: 'navhub_echo',
        description: 'Echoes back the provided message for connection testing',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to echo back' },
          },
          required: ['message'],
        },
      },
      (args) => ({ echoed: String(args.message ?? ''), receivedAt: new Date().toISOString() })
    );

    this.registerTool(
      {
        name: 'navhub_system_info',
        description: 'Returns 山羊胡 runtime architecture capabilities',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      () => ({
        version: '4.0.0-nextgen',
        capabilities: [
          'vector_search_int8',
          'p2p_mesh_sync',
          'speculative_prerender',
          'autonomous_healing',
          'knowledge_graph',
          'visual_fingerprint',
          'federated_ldp',
        ],
      })
    );
  }
}

/**
 * 进程/页面级单例。
 *
 * 浏览器侧只有一份桥（所有端侧 Agent 与扩展共享同一注册表），
 * Node 侧同样应该是单例——否则同进程内多个 Agent 各自注册工具互不可见。
 * 这里做在 core 事实源里，前端镜像才能保持逐字节一致（见 scripts/core-mirrors.json）。
 */
let globalBridge: WebMcpBridge | null = null;

export function getWebMcpBridge(): WebMcpBridge {
  if (!globalBridge) {
    globalBridge = new WebMcpBridge();
  }
  return globalBridge;
}
