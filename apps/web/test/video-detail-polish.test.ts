import { describe, it, expect, beforeEach } from 'vitest'
import {
  scoreVideoItem,
  getRelatedVideos,
  buildUserProfile,
} from '@/lib/video-recommendation'
import {
  savePlaybackPosition,
  getPlaybackRecord,
  clearPlaybackHistory,
} from '@/lib/video-playback-storage'
import type { NavigationSubItem } from '@/types/navigation'

describe('Video Detail Polish & Subcategory Affinity Engine', () => {
  beforeEach(() => {
    clearPlaybackHistory()
  })

  it('prioritizes videos in the same subcategory for related recommendations', () => {
    const currentVideo: NavigationSubItem = {
      id: 'current_arkts_1',
      title: 'HarmonyOS NEXT ArkTS 声明式 UI 核心实战',
      href: 'https://www.bilibili.com/video/BV1111111111',
      videoConfig: {
        type: 'bilibili',
        subCategoryId: 'sub_mob_harmony',
        subCategoryTitle: 'HarmonyOS 鸿蒙 NEXT 原生开发',
        author: '鸿蒙技术官',
        tags: ['HarmonyOS', 'ArkTS'],
        difficulty: 'beginner',
        qualityScore: 90,
        freshnessScore: 85,
      },
    }

    const companionVideoInSameSub: NavigationSubItem = {
      id: 'companion_arkts_2',
      title: 'ArkTS 状态管理与组件生命周期高级演进',
      href: 'https://www.bilibili.com/video/BV2222222222',
      videoConfig: {
        type: 'bilibili',
        subCategoryId: 'sub_mob_harmony',
        subCategoryTitle: 'HarmonyOS 鸿蒙 NEXT 原生开发',
        author: '鸿蒙技术官',
        tags: ['HarmonyOS', 'ArkTS'],
        difficulty: 'intermediate',
        qualityScore: 88,
        freshnessScore: 85,
      },
    }

    const unrelatedVideoInOtherCategory: NavigationSubItem = {
      id: 'unrelated_k8s_1',
      title: 'Kubernetes Pod 调度算法与生产级容器编排',
      href: 'https://www.bilibili.com/video/BV3333333333',
      videoConfig: {
        type: 'bilibili',
        subCategoryId: 'sub_cloud_k8s',
        subCategoryTitle: 'Docker 容器与 Kubernetes 编排',
        author: '云原生架构师',
        tags: ['K8s', 'Docker'],
        difficulty: 'intermediate',
        qualityScore: 99,
        freshnessScore: 90,
      },
    }

    const pool = [unrelatedVideoInOtherCategory, companionVideoInSameSub]
    const related = getRelatedVideos(currentVideo, pool, 2)

    expect(related.length).toBe(2)
    // Same subcategory + same author + shared tags must take precedence over an unrelated video with slightly higher raw quality
    expect(related[0].id).toBe('companion_arkts_2')
  })

  it('correctly saves and retrieves playback progress record for video cards', () => {
    savePlaybackPosition({
      videoId: 'vid_test_123',
      title: 'Rust 并发与 Tokio 深度解析',
      author: 'Rustacean',
      platform: 'bilibili',
      timestampSec: 600,
      durationSec: 1200,
    })

    const record = getPlaybackRecord('vid_test_123')
    expect(record).not.toBeNull()
    expect(record?.progressPercent).toBe(50)
    expect(record?.timestampSec).toBe(600)
    expect(record?.durationSec).toBe(1200)

    const nonexistent = getPlaybackRecord('vid_nonexistent')
    expect(nonexistent).toBeNull()
  })
})
