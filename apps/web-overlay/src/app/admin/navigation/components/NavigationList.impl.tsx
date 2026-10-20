'use client'

import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Droppable } from '@hello-pangea/dnd'
import { NavigationCard } from './NavigationCard'
import type { NavigationItem } from '@/types/navigation'

export interface NavigationListProps {
  items: NavigationItem[]
  onDragEnd: (result: DropResult) => void
  onUpdate: () => void
  onMoveToTop: (id: string) => void
  onMoveToBottom: (id: string) => void
}

/**
 * 拖拽列表实现。页面只静态引用同目录的 `NavigationList` 包装器，
 * 这个文件（以及 `@hello-pangea/dnd`、`NavigationCard` 的整套对话框依赖）
 * 会进入异步 chunk，列表数据渲染后才加载。
 */
export function NavigationList({
  items,
  onDragEnd,
  onUpdate,
  onMoveToTop,
  onMoveToBottom,
}: NavigationListProps) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="navigation-list">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className="space-y-4"
          >
            {items.map((item, index) => (
              <NavigationCard
                key={item.id}
                item={item}
                index={index}
                onUpdate={onUpdate}
                showMoveToTop={index > 0}
                showMoveToBottom={index < items.length - 1}
                onMoveToTop={() => onMoveToTop(item.id)}
                onMoveToBottom={() => onMoveToBottom(item.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}
