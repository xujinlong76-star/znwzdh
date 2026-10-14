/**
 * 极客键盘流焦点漫游与跨网格导航纯算法 (Keyboard-First Vim Navigator Engine)
 * 纯算法实现，0 DOM 依赖，跨端与单元测试友好。
 */

export type NavigationDirection = 'up' | 'down' | 'left' | 'right' | 'first' | 'last'

export interface GridNavigatorOptions {
  columns?: number // 当前视口每行卡片列数，默认 4
  loop?: boolean // 到达边界是否回环循环，默认 false
}

/**
 * 1. 计算单分类网格内下一个获得焦点的卡片索引
 */
export function calculateNextGridFocusIndex(
  totalCount: number,
  currentIndex: number,
  direction: NavigationDirection,
  options: GridNavigatorOptions = {}
): number {
  if (totalCount <= 0) return -1
  if (currentIndex < 0 || currentIndex >= totalCount) {
    return direction === 'last' || direction === 'up' ? totalCount - 1 : 0
  }

  const { columns = 4, loop = false } = options
  const cols = Math.max(1, columns)

  let nextIndex = currentIndex

  switch (direction) {
    case 'left':
      if (currentIndex % cols > 0) {
        nextIndex = currentIndex - 1
      } else if (loop) {
        nextIndex = Math.min(totalCount - 1, currentIndex + cols - 1)
      }
      break

    case 'right':
      if (currentIndex + 1 < totalCount && (currentIndex + 1) % cols !== 0) {
        nextIndex = currentIndex + 1
      } else if (loop) {
        nextIndex = Math.max(0, currentIndex - (currentIndex % cols))
      }
      break

    case 'up':
      if (currentIndex - cols >= 0) {
        nextIndex = currentIndex - cols
      } else if (loop) {
        // 跳到底部对应列
        const colPos = currentIndex % cols
        const lastRowStart = Math.floor((totalCount - 1) / cols) * cols
        nextIndex = Math.min(totalCount - 1, lastRowStart + colPos)
      }
      break

    case 'down':
      if (currentIndex + cols < totalCount) {
        nextIndex = currentIndex + cols
      } else if (loop) {
        nextIndex = currentIndex % cols
      }
      break

    case 'first':
      nextIndex = 0
      break

    case 'last':
      nextIndex = totalCount - 1
      break
  }

  return Math.max(0, Math.min(totalCount - 1, nextIndex))
}

export interface CategoryCardPointer {
  categoryIndex: number
  cardIndex: number
}

/**
 * 2. 跨分类网格流体漫游算法 (上一分类 / 下一分类)
 */
export function calculateNextCategoryPointer(
  categoriesItemCounts: number[],
  currentPointer: CategoryCardPointer,
  step: 'next_category' | 'prev_category' | 'next_card' | 'prev_card'
): CategoryCardPointer {
  const totalCats = categoriesItemCounts.length
  if (totalCats === 0) return { categoryIndex: -1, cardIndex: -1 }

  let { categoryIndex, cardIndex } = currentPointer

  if (categoryIndex < 0 || categoryIndex >= totalCats) {
    categoryIndex = 0
    cardIndex = 0
  }

  switch (step) {
    case 'next_category': {
      let nextCat = (categoryIndex + 1) % totalCats
      // 跳过空分类
      for (let i = 0; i < totalCats; i++) {
        if ((categoriesItemCounts[nextCat] || 0) > 0) break
        nextCat = (nextCat + 1) % totalCats
      }
      return { categoryIndex: nextCat, cardIndex: 0 }
    }

    case 'prev_category': {
      let prevCat = (categoryIndex - 1 + totalCats) % totalCats
      for (let i = 0; i < totalCats; i++) {
        if ((categoriesItemCounts[prevCat] || 0) > 0) break
        prevCat = (prevCat - 1 + totalCats) % totalCats
      }
      return { categoryIndex: prevCat, cardIndex: 0 }
    }

    case 'next_card': {
      const currentCatCount = categoriesItemCounts[categoryIndex] || 0
      if (cardIndex + 1 < currentCatCount) {
        return { categoryIndex, cardIndex: cardIndex + 1 }
      }
      // 跨入下一分类首张卡片
      return calculateNextCategoryPointer(categoriesItemCounts, currentPointer, 'next_category')
    }

    case 'prev_card': {
      if (cardIndex - 1 >= 0) {
        return { categoryIndex, cardIndex: cardIndex - 1 }
      }
      // 跨入上一分类最后一张卡片
      const prevCatPtr = calculateNextCategoryPointer(categoriesItemCounts, currentPointer, 'prev_category')
      const prevCatCount = categoriesItemCounts[prevCatPtr.categoryIndex] || 0
      return { categoryIndex: prevCatPtr.categoryIndex, cardIndex: Math.max(0, prevCatCount - 1) }
    }
  }
}
