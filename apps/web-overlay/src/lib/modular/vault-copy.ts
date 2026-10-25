/**
 * 金库重建的版本口径（单一事实源）。
 *
 * version=0 是写入前置条件「期望云端为空」，不是版本号；服务端首次 INSERT 写死
 * version=1（packages/store/src/repository/vault.ts），所以重建后的首版是 v1。
 * 这段文案曾在三处漂移（弹窗两处说 v0、io 兜底一处说 v0），统一在这里，
 * 避免同一事实再被各写一遍。
 */
export const VAULT_REBUILD_FIRST_VERSION = 1

export const VAULT_REBUILD_VERSION_COPY = `重建后云端会重新计版，第一版是 v${VAULT_REBUILD_FIRST_VERSION}`

export const VAULT_REBUILD_ACTION_LABEL = `以本机排版重建（第一版是 v${VAULT_REBUILD_FIRST_VERSION}）`
