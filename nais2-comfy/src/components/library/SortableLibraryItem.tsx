import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LibraryItem as LibraryItemType } from '@/stores/library-store'
import { LibraryItem } from './LibraryItem'

interface SortableLibraryItemProps {
    item: LibraryItemType
    onRename: (item: LibraryItemType) => void
    onLoadMetadata: (item: LibraryItemType) => void
    onUpscale?: (item: LibraryItemType) => void
    isBusy?: boolean
    onImageClick?: (imageUrl: string) => void
    isEditMode?: boolean
    isSelected?: boolean
    onSelectionClick?: (e: React.MouseEvent) => void
    disabled?: boolean
}

export function SortableLibraryItem({ item, onRename, onLoadMetadata, onUpscale, isBusy, onImageClick, isEditMode, isSelected, onSelectionClick, disabled }: SortableLibraryItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id, disabled })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.0 : 1,
    }

    return (
        <div ref={setNodeRef} style={style} {...(disabled ? {} : { ...attributes, ...listeners })} id={item.id} className="w-full h-full">
            <LibraryItem 
                item={item} 
                onRename={onRename} 
                onLoadMetadata={onLoadMetadata} 
                onUpscale={onUpscale}
                isBusy={isBusy}
                onImageClick={onImageClick}
                isEditMode={isEditMode}
                isSelected={isSelected}
                onSelectionClick={onSelectionClick}
            />
        </div>
    )
}
