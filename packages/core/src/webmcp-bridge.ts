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
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export type WebMcpToolHandler = (params: Record<string, any>) => Promise<any> | any;

export class WebMcpBridge {
  private tools: Map<string, { def: WebMcpToolDefinition; handler: WebMcpToolHandler }> = new Map();
  private allowedOrigins: Set<string>;

  constructor(options?: { allowedOrigins?: string[] }) {
    this.allowedOrigins = new Set(options?.allowedOrigins || ['*']);
    this.registerBuiltInTools();
  }

  /**
   * 注册自定义 MCP 工具
   */
  public registerTool(def: WebMcpToolDefinition, handler: WebMcpToolHandler): void {
    this.tools.set(def.name, { def, handler });
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
        const toolArgs = params?.arguments || {};

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
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data: err?.message || String(err) },
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
      (args) => ({ echoed: args.message, receivedAt: new Date().toISOString() })
    );

    this.registerTool(
      {
        name: 'navhub_system_info',
        description: 'Returns NavHub runtime architecture capabilities',
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
