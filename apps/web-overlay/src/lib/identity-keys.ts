/**
 * 身份相关的 localStorage 键 —— 只在这里写一遍。
 *
 * 为什么单独一个模块：`user-settings.ts` 的健康巡检要检查匿名标识，但它当年读的是
 * 'navhub_anon_id'（一个从来没人写过的键），于是那一项永远报「正常就绪」——
 * 巡检看着全绿，其实什么都没查。键名散落在多个文件里就是这么慢慢漂走的。
 */

/** 匿名身份 id（`anon-` 前缀 + 随机串） */
export const ANON_ID_STORAGE_KEY = 'navhub.anonId'

/** 登录后的 canonical 用户 id；存在时优先于匿名 id */
export const USER_ID_STORAGE_KEY = 'navhub.userId'
