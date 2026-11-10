/**
 * `enrichLlmOf` 的行为测试（2026-11-10）。
 *
 * ## 为什么补这个
 *
 * 覆盖率实测显示 `packages/core/src/llm-utils.ts` **零覆盖**——
 * 而 `enrichLlmOf` 被 4 个生产模块调用（MCP sites handler、metadata-refetch 任务、
 * /api/enrich 路由、/api/sites 路由）。它负责把「已解析的 LLM 配置」拍平成
 * 「带完整默认值的扁平配置」，任何一处默认值写错都会影响真实调用行为：
 *
 *   - timeoutMs 默认 20s（漏了会让请求无超时）
 *   - thinking 默认 **true**（唯一一个默认为真的开关，写错会静默关掉推理）
 *   - timeoutMsExplicit 用 === true 而不是 ??，表达「只有明确传 true 才算显式」
 *
 * 这些默认值没有任何测试看着，所以先把它们钉住。
 */
import { describe, expect, it } from 'vitest'
import { enrichLlmOf, type LlmProvider, type ResolvedLlm } from '../src/llm-utils'

/** 构造最小 provider，只覆盖需要的字段 */
function provider(patch: Partial<LlmProvider> = {}): LlmProvider {
  return { baseUrl: "https://api.example.com/v1", apiKey: null, model: "test-model", ...patch }
}

function resolved(patch: Partial<ResolvedLlm> = {}): ResolvedLlm {
  return { provider: provider(), fallbacks: [], source: "system", ...patch }
}

describe('enrichLlmOf：默认值合并', () => {
  it('未指定可选字段时给全套默认值', () => {
    const out = enrichLlmOf(resolved())
    expect(out.baseUrl).toBe("https://api.example.com/v1")
    expect(out.model).toBe("test-model")
    expect(out.apiKey).toBeNull()
    expect(out.timeoutMs).toBe(20_000)
    expect(out.timeoutMsExplicit).toBe(false)
    expect(out.jsonMode).toBe(false)
    expect(out.allowPrivateNetwork).toBe(false)
    // thinking 是唯一默认为 true 的开关：写错会静默关掉模型推理
    expect(out.thinking).toBe(true)
    expect(out.fallbacks).toEqual([])
  })

  it('显式值优先于默认值', () => {
    const out = enrichLlmOf(
      resolved({
        provider: provider({
          apiKey: "sk-test",
          timeoutMs: 5000,
          timeoutMsExplicit: true,
          jsonMode: true,
          allowPrivateNetwork: true,
          thinking: false,
        }),
      }),
    )
    expect(out.apiKey).toBe("sk-test")
    expect(out.timeoutMs).toBe(5000)
    expect(out.timeoutMsExplicit).toBe(true)
    expect(out.jsonMode).toBe(true)
    expect(out.allowPrivateNetwork).toBe(true)
    expect(out.thinking).toBe(false)
  })

  it('timeoutMsExplicit 只认 === true（undefined / false / 0 都算未显式）', () => {
    expect(enrichLlmOf(resolved({ provider: provider({ timeoutMsExplicit: undefined }) })).timeoutMsExplicit).toBe(false)
    expect(enrichLlmOf(resolved({ provider: provider({ timeoutMsExplicit: false }) })).timeoutMsExplicit).toBe(false)
  })

  it('apiKey 是 undefined 时归一成 null（不是空串）', () => {
    const out = enrichLlmOf(resolved({ provider: provider({ apiKey: undefined }) }))
    expect(out.apiKey).toBeNull()
  })
})

describe('enrichLlmOf：fallback 链', () => {
  it('逐个 fallback 独立补默认值', () => {
    const out = enrichLlmOf(
      resolved({
        fallbacks: [
          provider({ model: "fb-1" }),
          provider({ model: "fb-2", timeoutMs: 3000, thinking: false }),
        ],
      }),
    )
    expect(out.fallbacks).toHaveLength(2)
    expect(out.fallbacks[0]!.model).toBe("fb-1")
    expect(out.fallbacks[0]!.timeoutMs).toBe(20_000)
    expect(out.fallbacks[0]!.apiKey).toBeNull()
    expect(out.fallbacks[1]!.timeoutMs).toBe(3000)
  })

  it('fallback 不带 thinking 字段（它只在主 provider 上生效）', () => {
    const out = enrichLlmOf(resolved({ fallbacks: [provider()] }))
    expect(out.fallbacks[0]).not.toHaveProperty("thinking")
    expect(out.fallbacks[0]).not.toHaveProperty("label")
    expect(out.fallbacks[0]).not.toHaveProperty("enabled")
  })

  it('空 fallback 链不报错', () => {
    expect(enrichLlmOf(resolved({ fallbacks: [] })).fallbacks).toEqual([])
  })
})
