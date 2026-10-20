import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { LibraryItem, useLibraryStore } from '@/stores/library-store'
import { Copy, FolderOpen, Save, Trash2, Pencil, FileSearch, Maximize2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, remove, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { copyImageToClipboard, imageExtension, withImageExtension } from '@/lib/image-utils'

interface LibraryContextMenuProps {
    item: LibraryItem
    children: React.ReactNode
    onRename?: () => void
    onLoadMetadata?: () => void
    /** 고화질로 다시 그리기 */
    onUpscale?: () => void
    /** 고화질로 다시 그리는 중 */
    isBusy?: boolean
}

export function LibraryContextMenu({ item, children, onRename, onLoadMetadata, onUpscale, isBusy }: LibraryContextMenuProps) {
    const { t } = useTranslation()
    const { removeItem } = useLibraryStore()

    const handleCopy = async () => {
        try {
            const data = await readFile(item.path)
            await copyImageToClipboard(data, item.path)
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed:', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    const handleSaveAs = async () => {
        try {
            const data = await readFile(item.path)
            // 라이브러리 이름에는 확장자가 없으므로 원본 파일의 확장자를 붙인다
            const ext = imageExtension(item.path)
            const filePath = await save({
                defaultPath: withImageExtension(item.name, ext),
                filters: [{ name: t('comfy.file.imageFilter', '{{ext}} 그림', { ext: ext.toUpperCase() }), extensions: [ext] }],
            })
            if (filePath) {
                await writeFile(withImageExtension(filePath, ext), data)
                toast({ title: t('toast.saved', '저장 완료'), variant: 'success' })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({ title: t('toast.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    const handleOpenFolder = async () => {
        try {
            await revealItemInDir(item.path)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleDelete = async () => {
        try {
            await remove(item.path)
            removeItem(item.id)
            toast({ title: t('actions.deleted', '삭제 완료'), variant: 'success' })
        } catch (e) {
            console.error('Delete failed:', e)
            removeItem(item.id) // Still remove from store if file not found
        }
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                <ContextMenuItem onClick={onRename}>
                    <Pencil className="h-4 w-4 mr-2" />
                    {t('actions.rename', '이름 변경')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleSaveAs}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '다른 이름으로 저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                {/* 스마트 툴·이미지 참조 자리: 고화질로 다시 그리기 */}
                {!item.isStack && (
                    <ContextMenuItem onClick={onUpscale} disabled={!onUpscale || isBusy} className="items-start">
                        {isBusy
                            ? <Loader2 className="h-4 w-4 mr-2 mt-0.5 animate-spin" />
                            : <Maximize2 className="h-4 w-4 mr-2 mt-0.5" />}
                        <span className="flex flex-col">
                            <span>{isBusy ? t('comfy.upscale.running', '고화질로 다시 그리는 중…') : t('comfy.upscale.action', '고화질로 다시 그리기')}</span>
                            <span className="text-[10px] leading-tight text-muted-foreground">
                                {t('comfy.upscale.menuHint', '시드 없이 이 그림에서 시작 · 새 파일로 저장')}
                            </span>
                        </span>
                    </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={onLoadMetadata}>
                    <FileSearch className="h-4 w-4 mr-2" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleOpenFolder}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}
