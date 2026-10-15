/**
 * 浏览器端端侧 Model Context Protocol (WebMCP) 双向通信网桥适配器
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

  constructor() {
    this.registerBuiltInTools();
  }

  public registerTool(def: WebMcpToolDefinition, handler: WebMcpToolHandler): void {
    this.tools.set(def.name, { def, handler });
  }

  public listTools(): WebMcpToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.def);
  }

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

let globalBridge: WebMcpBridge | null = null;

export function getWebMcpBridge(): WebMcpBridge {
  if (!globalBridge) {
    globalBridge = new WebMcpBridge();
  }
  return globalBridge;
}
