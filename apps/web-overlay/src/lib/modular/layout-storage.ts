/**
 * 模块化工作台的 localStorage 键。
 *
 * 独立成轻量模块的原因：workbench-bridge 只需要这个字符串；若从
 * use-modular-layout 导入，会把 registry → 全部 widget 组件静态拉进首页首屏。
 */
export const STORAGE_KEY = 'navhub_modular_multi_boards_v2'
