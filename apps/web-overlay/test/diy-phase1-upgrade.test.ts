import { describe, expect, it } from 'vitest'
import {
  sortCategoryItemsWithOrder,
  validateAndCleanDIYConfig,
} from '@/lib/modular/diy-presets'
import { resolveCardSortDrop } from '@/lib/modular/diy-drag'
import { combineAndSortCategories } from '@/lib/modular/category-combine'
import { bumpClocks, diffChangedSlots, mergeLayoutSlots } from '@/lib/modular/layout-sync'

describe('DIY Phase 1 Upgrade (Modules B/C)', () => {
  it('reorders cards within a category via siteOrderByCategory while preserving unlisted catalog items', () => {
    const catalog = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const ordered = sortCategoryItemsWithOrder(catalog, ['c', 'a'], [])
    expect(ordered.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
    // Original catalog array must never be mutated
    expect(catalog.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('resolves intra-category reorder and cross-category exact-index drops cleanly', () => {
    const reorder = resolveCardSortDrop({
      isEditing: true,
      source: {
        kind: 'card',
        siteId: 's1',
        title: 'Site 1',
        href: 'https://s1.example',
        containerId: 'cat-a',
        index: 0,
        displayedIds: ['s1', 's2', 's3'],
      },
      target: {
        kind: 'card',
        siteId: 's3',
        title: 'Site 3',
        href: 'https://s3.example',
        containerId: 'cat-a',
        index: 2,
        displayedIds: ['s1', 's2', 's3'],
      },
    })
    expect(reorder).toEqual({
      action: 'reorder',
      containerId: 'cat-a',
      orderedIds: ['s2', 's3', 's1'],
      fromIndex: 0,
      toIndex: 2,
    })

    const cross = resolveCardSortDrop({
      isEditing: true,
      source: {
        kind: 'card',
        siteId: 's1',
        title: 'Site 1',
        href: 'https://s1.example',
        containerId: 'cat-a',
        index: 0,
        displayedIds: ['s1', 's2'],
      },
      target: {
        kind: 'card',
        siteId: 't2',
        title: 'Target 2',
        href: 'https://t2.example',
        containerId: 'cat-b',
        index: 1,
        displayedIds: ['t1', 't2', 't3'],
      },
    })
    expect(cross.action).toBe('move-to-index')
    if (cross.action === 'move-to-index') {
      expect(cross.targetCategoryId).toBe('cat-b')
      expect(cross.targetIndex).toBe(1)
    }
  })

  it('remaps sites across both direct items and subCategories without losing catalog data', () => {
    const result = combineAndSortCategories({
      custom: [],
      navigation: [
        {
          id: 'cat-1',
          title: 'AI',
          items: [],
          subCategories: [
            {
              id: 'sub-1',
              title: 'Chat',
              items: [
                { id: 'site-1', title: 'S1', href: 'https://s1.example' },
                { id: 'site-2', title: 'S2', href: 'https://s2.example' },
              ],
            },
          ],
        },
        {
          id: 'cat-2',
          title: 'Dev',
          items: [],
          subCategories: [
            {
              id: 'sub-2',
              title: 'Frameworks',
              items: [{ id: 'site-3', title: 'S3', href: 'https://s3.example' }],
            },
          ],
        },
      ],
      siteCategoryOverrides: { 'site-1': 'sub-2' },
    })

    const sub1 = result.sortedCategories[0]?.subCategories[0]
    const sub2 = result.sortedCategories[1]?.subCategories[0]
    expect(sub1?.items?.map((x) => x.id)).toEqual(['site-2'])
    expect(sub2?.items?.map((x) => x.id)).toEqual(['site-3', 'site-1'])
  })

  it('migrates legacy v3 configs losslessly and preserves siteOrderByCategory + blockOverrides', () => {
    const cleaned = validateAndCleanDIYConfig({
      version: 3,
      viewMode: 'hybrid',
      siteOrderByCategory: { 'sub-1': ['site-2', 'site-1', 'site-2'] },
      blockOverrides: { 'cat-1': { colSpan: 6, rowSpan: 2, order: 1 } },
    })
    expect(cleaned.valid).toBe(true)
    expect(cleaned.config.siteOrderByCategory).toEqual({ 'sub-1': ['site-2', 'site-1'] })
    expect(cleaned.config.blockOverrides).toEqual({ 'cat-1': { colSpan: 6, rowSpan: 2, order: 1 } })
  })

  it('merges per-category siteOrderByCategory slots across tabs with Lamport LWW clocks', () => {
    const base = { siteOrderByCategory: { 'cat-a': ['a1', 'a2'], 'cat-b': ['b1', 'b2'] }, updatedAt: 1 }
    const localCfg = { siteOrderByCategory: { 'cat-a': ['a2', 'a1'], 'cat-b': ['b1', 'b2'] }, updatedAt: 2 }
    const remoteCfg = { siteOrderByCategory: { 'cat-a': ['a1', 'a2'], 'cat-b': ['b2', 'b1'] }, updatedAt: 3 }
    const localClocks = bumpClocks({}, diffChangedSlots(base, localCfg), 1)
    const remoteClocks = bumpClocks({}, diffChangedSlots(base, remoteCfg), 2)
    const merged = mergeLayoutSlots(
      { config: localCfg, clocks: localClocks },
      { config: remoteCfg, clocks: remoteClocks },
    )
    expect(merged.changed).toBe(true)
    expect(merged.config.siteOrderByCategory['cat-a']).toEqual(['a2', 'a1'])
    expect(merged.config.siteOrderByCategory['cat-b']).toEqual(['b2', 'b1'])
  })
})
