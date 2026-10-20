import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { Copy, FolderOpen, Save, Trash2, FileSearch, Maximize2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, remove, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { copyImageToClipboard, imageExtension, withImageExtension } from '@/lib/image-utils'
import { SceneImage } from '@/stores/scene-store'

interface SceneContextMenuProps {
    image: SceneImage
    children: React.ReactNode
    onDelete: () => void
    onLoadMetadata?: () => void
    /** 고화질로 다시 그리기 (씬 폴더에 새 파일로 저장하고 즐겨찾기를 넘겨받는다) */
    onUpscale?: () => void
    /** 이 그림을 지금 고화질로 다시 그리는 중 */
    upscaling?: boolean
}

export function SceneImageContextMenu({ image, children, onDelete, onLoadMetadata, onUpscale, upscaling }: SceneContextMenuProps) {
    const { t } = useTranslation()

    // image.url 은 보통 저장된 파일 경로다. 예전 데이터는 data: URL 일 수도 있다.
    const isFile = !image.url.startsWith('data:')
    const fileName = isFile ? (image.url.split(/[\\/]/).pop() || `NAIS_${image.timestamp}.png`) : `NAIS_${image.timestamp}.png`

    const readBytes = async (): Promise<Uint8Array> => {
        if (isFile) return readFile(image.url)
        const res = await fetch(image.url)
        return new Uint8Array(await res.arrayBuffer())
    }

    const handleCopy = async () => {
        try {
            await copyImageToClipboard(await readBytes(), fileName)
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed:', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    const handleSaveAs = async () => {
        try {
            const data = await readBytes()
            const ext = imageExtension(fileName)
            const filePath = await save({
                defaultPath: fileName,
                filters: [{ name: 'Image', extensions: [ext] }],
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
        if (!isFile) return
        try {
            await revealItemInDir(image.url)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleDelete = async () => {
        if (isFile) {
            try {
                await remove(image.url)
            } catch (e) {
                console.error('File delete failed (might already be deleted):', e)
            }
        }
        // Always call parent onDelete to remove from UI store
        onDelete()
        toast({ title: t('actions.deleted', '삭제 완료'), variant: 'success' })
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                <ContextMenuItem onClick={handleSaveAs}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '다른 이름으로 저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                <ContextMenuSeparator />

                {/* 스마트 툴·인페인팅·I2I 자리: 고화질로 다시 그리기 (시드 없이 그림 자체에서 시작) */}
                {onUpscale && (
                    <>
                        <ContextMenuItem onClick={onUpscale} disabled={upscaling} className="items-start">
                            {upscaling
                                ? <Loader2 className="h-4 w-4 mr-2 mt-0.5 animate-spin" />
                                : <Maximize2 className="h-4 w-4 mr-2 mt-0.5" />}
                            <span className="flex flex-col">
                                <span>
                                    {upscaling
                                        ? t('comfy.upscale.running', '고화질로 다시 그리는 중…')
                                        : t('comfy.upscale.action', '고화질로 다시 그리기')}
                                </span>
                                <span className="text-[10px] leading-tight text-muted-foreground">
                                    {t('comfy.scene.upscaleMenuHint', '시드 없이 이 그림에서 시작 · 고화질 그림이 즐겨찾기를 이어받음')}
                                </span>
                            </span>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}

                {onLoadMetadata && (
                    <ContextMenuItem onClick={onLoadMetadata}>
                        <FileSearch className="h-4 w-4 mr-2" />
                        {t('metadata.loadFromImage', '메타데이터 불러오기')}
                    </ContextMenuItem>
                )}

                {isFile && (
                    <ContextMenuItem onClick={handleOpenFolder}>
                        <FolderOpen className="h-4 w-4 mr-2" />
                        {t('comfy.scene.revealImage', '탐색기에서 이 그림 보기')}
                    </ContextMenuItem>
                )}

                <ContextMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}
