import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, memo } from 'react'
import { Clock, Trash2, FolderOpen, RefreshCw, FileSearch, Copy, RotateCcw, Save, Image as ImageIcon, Paintbrush, Maximize2, Film, Zap, PenTool, Pencil, Droplets, Smile, Sparkles, Shuffle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { readDir, readFile, remove, writeFile, exists } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { pictureDir, join } from '@tauri-apps/api/path'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { regenerateFromImage, upscaleExisting } from '@/lib/comfy-params'
import { bytesToBase64 } from '@/lib/output-save'
import { copyImageToClipboard, imageExtension, imageMimeType, withImageExtension } from '@/lib/image-utils'
import { toast } from '@/components/ui/use-toast'
import { useLibraryStore } from '@/stores/library-store'
import { useNavigate } from 'react-router-dom'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'

interface SavedImage {
    name: string
    path: string
    timestamp: number
    // i2i·inpaint·lineart 등은 예전 NAIS2(NovelAI)로 만든 파일 표시용
    type: 'main' | 'upscale' | 'scene' | 'variation' | 'i2i' | 'inpaint' | 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'declutter'
    isTemporary?: boolean
}

type BusyKind = 'regenerate' | 'upscale'

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i

/** 파일 이름·폴더로 어떤 그림인지 정한다 */
function classifyImage(name: string, path: string): SavedImage['type'] {
    const n = name.toUpperCase()
    if (n.startsWith('NAIS_VAR_')) return 'variation'
    if (n.includes('UPSCALE_') || n.includes('SCENE_HQ_')) return 'upscale'
    if (/[\\/]NAIS_Variation[\\/]/i.test(path)) return 'variation'
    if (n.includes('SCENE_') || /[\\/]NAIS_Scene[\\/]/i.test(path)) return 'scene'
    if (n.includes('INPAINT_')) return 'inpaint'
    if (n.includes('I2I_')) return 'i2i'
    if (n.includes('LINEART_')) return 'lineart'
    if (n.includes('SKETCH_')) return 'sketch'
    if (n.includes('COLORIZE_')) return 'colorize'
    if (n.includes('EMOTION_')) return 'emotion'
    if (n.includes('DECLUTTER_')) return 'declutter'
    return 'main'
}

/** 파일 이름 끝의 _<숫자> 가 만든 시각 */
function timestampOf(name: string): number {
    const match = name.match(/_(\d+)\.[^.]+$/)
    return match ? parseInt(match[1]) : 0
}

// Memoized HistoryImageItem - 불필요한 리렌더링 방지
interface HistoryImageItemProps {
    image: SavedImage
    thumbnail?: string
    index: number
    busy?: BusyKind
    getTypeIcon: (type: SavedImage['type']) => React.ReactNode
    onImageClick: (image: SavedImage) => void
    onDelete: (image: SavedImage, e?: React.MouseEvent) => void
    onSaveAs: (image: SavedImage) => void
    onCopy: (image: SavedImage) => void
    onRegenerate: (image: SavedImage) => void
    onUpscale: (image: SavedImage) => void
    onOpenFolder: (image: SavedImage) => void
    onLoadMetadata: (image: SavedImage) => void
    onLoadComplete: (path: string, data: string) => void
}

const HistoryImageItem = memo(function HistoryImageItem({
    image, thumbnail, index, busy, getTypeIcon,
    onImageClick, onDelete, onSaveAs, onCopy, onRegenerate, onUpscale,
    onOpenFolder, onLoadMetadata,
    onLoadComplete
}: HistoryImageItemProps) {
    const { t } = useTranslation()
    const [localThumbnail, setLocalThumbnail] = useState<string | undefined>(thumbnail)

    useEffect(() => {
        if (thumbnail) setLocalThumbnail(thumbnail)
    }, [thumbnail])

    useEffect(() => {
        if (image.isTemporary) return
        if (!localThumbnail) {
            // Use convertFileSrc for efficient native asset loading
            const assetUrl = convertFileSrc(image.path)
            setLocalThumbnail(assetUrl)
            onLoadComplete(image.path, assetUrl)
        }
    }, [image.path, localThumbnail, onLoadComplete, image.isTemporary])

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    className="aspect-square bg-muted/30 rounded-xl overflow-hidden hover:ring-2 hover:ring-primary hover:scale-[1.02] transition-all shadow-sm relative group cursor-pointer"
                    onClick={() => onImageClick(image)}
                >
                    {localThumbnail ? (
                        <img
                            draggable="true"
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', image.name);
                                e.dataTransfer.effectAllowed = 'copy';
                                useLibraryStore.getState().setDraggedSource({
                                    name: image.name,
                                    path: image.path
                                });

                                // Create custom drag preview with rounded corners using DOM element
                                const dragPreview = document.createElement('div');
                                dragPreview.style.cssText = `
                                    width: 80px;
                                    height: 80px;
                                    border-radius: 12px;
                                    overflow: hidden;
                                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                                    border: 2px solid rgba(255,255,255,0.3);
                                    position: fixed;
                                    top: -200px;
                                    left: -200px;
                                    z-index: 9999;
                                    pointer-events: none;
                                `;

                                const previewImg = document.createElement('img');
                                previewImg.src = localThumbnail || '';
                                previewImg.style.cssText = `
                                    width: 100%;
                                    height: 100%;
                                    object-fit: cover;
                                `;

                                dragPreview.appendChild(previewImg);
                                document.body.appendChild(dragPreview);

                                e.dataTransfer.setDragImage(dragPreview, 40, 40);

                                // Clean up after a short delay
                                setTimeout(() => {
                                    document.body.removeChild(dragPreview);
                                }, 0);
                            }}
                            onDragEnd={() => {
                                useLibraryStore.getState().setDraggedSource(null);
                            }}
                            src={localThumbnail}
                            alt={`Image ${index + 1}`}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                            Loading...
                        </div>
                    )}
                    {/* 다시 생성·고화질로 다시 그리는 중 */}
                    {busy && (
                        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1 text-white">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-[10px] font-medium px-1 text-center">
                                {busy === 'upscale'
                                    ? t('comfy.upscale.running', '고화질로 다시 그리는 중…')
                                    : t('comfy.regen.running', '같은 설정으로 다시 그리는 중…')}
                            </span>
                        </div>
                    )}
                    <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => onDelete(image, e)}
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                    <div className="absolute bottom-1 left-1 flex gap-1">
                        <div className="h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            {getTypeIcon(image.type)}
                        </div>
                        {image.isTemporary && (
                            <div className="h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                <Zap className="h-3 w-3 text-yellow-400" />
                            </div>
                        )}
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onSaveAs(image)}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onCopy(image)}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onRegenerate(image)} disabled={!!busy}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t('actions.regenerate', '재생성')}
                </ContextMenuItem>
                {/* 스마트 툴·인페인팅·I2I·이미지 참조 자리: 고화질로 다시 그리기 */}
                <ContextMenuItem onClick={() => onUpscale(image)} disabled={!!busy} className="items-start">
                    <Maximize2 className="h-4 w-4 mr-2 mt-0.5" />
                    <span className="flex flex-col">
                        <span>{t('comfy.upscale.action', '고화질로 다시 그리기')}</span>
                        <span className="text-[10px] leading-tight text-muted-foreground">
                            {t('comfy.upscale.menuHint', '시드 없이 이 그림에서 시작 · 새 파일로 저장')}
                        </span>
                    </span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onOpenFolder(image)} disabled={image.isTemporary}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onLoadMetadata(image)}>
                    <FileSearch className="h-4 w-4 mr-2" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
})

export function HistoryPanel() {
    const { t } = useTranslation()
    const { setPreviewImage } = useGenerationStore()
    const { savePath, useAbsolutePath, upscaleScale, upscaleDenoise } = useSettingsStore()
    const [savedImages, setSavedImages] = useState<SavedImage[]>([])
    const [imageThumbnails, setImageThumbnails] = useState<Record<string, string>>({})
    const [isLoading, setIsLoading] = useState(false)
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    // 다시 생성·고화질로 다시 그리는 중인 그림 (경로 → 하는 일)
    const [busyImages, setBusyImages] = useState<Record<string, BusyKind>>({})
    const navigate = useNavigate()

    // LRU cache limit for imageThumbnails to prevent memory bloat
    const MAX_THUMBNAIL_CACHE = 20

    const handleImageLoadComplete = useCallback((path: string, data: string) => {
        setImageThumbnails(prev => {
            // Skip if already cached with same data
            if (prev[path] === data) return prev

            const keys = Object.keys(prev)
            // If cache is full, remove oldest entries (first in object)
            if (keys.length >= MAX_THUMBNAIL_CACHE) {
                const keysToRemove = keys.slice(0, keys.length - MAX_THUMBNAIL_CACHE + 1)
                const newCache: Record<string, string> = {}
                // Only keep entries not in keysToRemove
                for (const k of keys) {
                    if (!keysToRemove.includes(k)) {
                        newCache[k] = prev[k]
                    }
                }
                newCache[path] = data
                return newCache
            }
            return { ...prev, [path]: data }
        })
    }, [])

    // Add new image instantly to history
    // Memory optimization: Use convertFileSrc for file-based images, only cache Base64 for temporary (memory://) images
    const addNewImage = useCallback((imagePath: string, imageData?: string) => {
        const isTemporary = imagePath.startsWith('memory://')
        const name = imagePath.split(/[/\\]/).pop() || `NAIS_${Date.now()}.png`
        // 저장 파일 이름의 시각을 쓴다 (다시 불러올 때와 같은 순서가 되게)
        const timestamp = timestampOf(name) || Date.now()

        const newImage: SavedImage = {
            name,
            path: imagePath,
            timestamp,
            type: classifyImage(name, imagePath),
            isTemporary
        }

        // Instantly add to list
        setSavedImages(prev => {
            let next = [newImage, ...prev.filter(img => img.path !== imagePath)]

            // Limit temporary images to 10
            if (isTemporary) {
                const tempImages = next.filter(img => img.isTemporary)
                if (tempImages.length > 10) {
                    // Sort temp images by timestamp (oldest first) to find the one to remove
                    const sortedTemp = [...tempImages].sort((a, b) => a.timestamp - b.timestamp)
                    const oldest = sortedTemp[0]
                    next = next.filter(img => img !== oldest)
                }
            }
            return next.slice(0, 50)
        })

        // Memory optimization: Only cache Base64 for temporary images, use convertFileSrc URL for files
        const cacheData = isTemporary && imageData
            ? imageData
            : convertFileSrc(imagePath)

        setImageThumbnails(prev => {
            const keys = Object.keys(prev)
            if (keys.length >= MAX_THUMBNAIL_CACHE) {
                const keysToRemove = keys.slice(0, keys.length - MAX_THUMBNAIL_CACHE + 1)
                const newCache = { ...prev }
                keysToRemove.forEach(k => delete newCache[k])
                return { ...newCache, [imagePath]: cacheData }
            }
            return { ...prev, [imagePath]: cacheData }
        })
    }, [])

    // Get icon component for generation type
    const getTypeIcon = (type: SavedImage['type']) => {
        switch (type) {
            case 'i2i': return <ImageIcon className="h-3 w-3 text-indigo-400" />
            case 'inpaint': return <Paintbrush className="h-3 w-3 text-pink-400" />
            case 'upscale': return <Maximize2 className="h-3 w-3 text-purple-400" />
            case 'scene': return <Film className="h-3 w-3 text-emerald-400" />
            case 'variation': return <Shuffle className="h-3 w-3 text-sky-400" />
            case 'lineart': return <PenTool className="h-3 w-3 text-slate-400" />
            case 'sketch': return <Pencil className="h-3 w-3 text-gray-400" />
            case 'colorize': return <Droplets className="h-3 w-3 text-cyan-400" />
            case 'emotion': return <Smile className="h-3 w-3 text-yellow-400" />
            case 'declutter': return <Sparkles className="h-3 w-3 text-emerald-400" />
            default: return <ImageIcon className="h-3 w-3 text-amber-500" />
        }
    }

    // Load images from save path
    // 폴더 규칙은 lib/output-save.ts 와 같다:
    //   메인·고화질   <저장 위치>                (절대 경로를 정했으면 거기, 아니면 사진/<저장 위치>)
    //   씬           <기준>/NAIS_Scene/<프리셋>/<씬>/   (예전 구조 <기준>/NAIS_Scene/<씬>/ 도)
    //   변형 모드     <기준>/NAIS_Variation/<묶음>/
    //   <기준> = 사진 폴더, 그리고 절대 경로를 정했으면 그 폴더도
    const loadSavedImages = useCallback(async () => {
        setIsLoading(true)
        try {
            const images: SavedImage[] = []
            const seen = new Set<string>()
            const picturePath = await pictureDir()

            const pushFile = async (dir: string, fileName: string) => {
                if (!IMAGE_FILE.test(fileName)) return
                const fullPath = await join(dir, fileName)
                if (seen.has(fullPath)) return
                seen.add(fullPath)
                images.push({
                    name: fileName,
                    path: fullPath,
                    timestamp: timestampOf(fileName),
                    type: classifyImage(fileName, fullPath),
                })
            }

            /** 폴더 안의 그림 파일. depth > 0 이면 하위 폴더도 그만큼 내려간다 */
            const scanDir = async (dir: string, depth: number) => {
                try {
                    if (!(await exists(dir))) return
                    const entries = await readDir(dir)
                    for (const entry of entries) {
                        if (!entry.name) continue
                        if (entry.isDirectory) {
                            if (depth > 0) await scanDir(await join(dir, entry.name), depth - 1)
                        } else {
                            await pushFile(dir, entry.name)
                        }
                    }
                } catch (e) {
                    console.warn('Failed to read history folder:', dir, e)
                }
            }

            // 1. 메인 생성·고화질 (설정한 저장 위치 + 예전 기본 위치 사진/NAIS_Output)
            const outputDirs = new Set<string>([
                useAbsolutePath && savePath ? savePath : await join(picturePath, savePath || 'NAIS_Output'),
                await join(picturePath, 'NAIS_Output'),
            ])
            for (const dir of outputDirs) await scanDir(dir, 0)

            // 2. 씬·변형 모드
            const collectionRoots = new Set<string>([picturePath, ...(useAbsolutePath && savePath ? [savePath] : [])])
            for (const root of collectionRoots) {
                await scanDir(await join(root, 'NAIS_Scene'), 2)
                await scanDir(await join(root, 'NAIS_Variation'), 1)
            }

            images.sort((a, b) => b.timestamp - a.timestamp)

            // MEMORY OPTIMIZATION: Limit total file entries to prevent large state
            const MAX_HISTORY_FILES = 200
            const limitedImages = images.slice(0, MAX_HISTORY_FILES)

            // Merge with existing temporary images
            setSavedImages(prev => {
                const tempImages = prev.filter(img => img.isTemporary)
                const sortedTemp = tempImages.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)

                const combined = [...limitedImages, ...sortedTemp]
                return combined.sort((a, b) => b.timestamp - a.timestamp)
            })

            // NOTE: Removed pre-loading of thumbnails using readFile to prevent UI lag.
            // Using convertFileSrc in the render loop is much more efficient as it uses native asset handling.
        } catch (error) {
            console.error('Failed to load history:', error)
            setSavedImages([])
        }
        setIsLoading(false)
    }, [savePath, useAbsolutePath])

    useEffect(() => {
        loadSavedImages()
    }, [loadSavedImages])

    // Listen for instant image updates from generation
    useEffect(() => {
        const handler = (e: CustomEvent<{ path: string; data?: string }>) => {
            const { path, data } = e.detail
            addNewImage(path, data)
        }

        window.addEventListener('newImageGenerated', handler as EventListener)
        return () => window.removeEventListener('newImageGenerated', handler as EventListener)
    }, [addNewImage])

    // PERFORMANCE: Removed auto-refresh after every generation.
    // The newImageGenerated event (above) already adds images instantly.
    // Full directory scan (loadSavedImages) is only needed on initial mount + manual refresh.
    // For users generating 1000+ images, scanning the entire directory after EVERY generation
    // was the #1 cause of progressive slowdown.

    /** 파일이면 경로, 임시 그림이면 data URL (생성 요청에 넘길 수 있는 형태) */
    const sourceOf = (image: SavedImage): { path?: string; dataUrl?: string } | null => {
        if (!image.isTemporary) return { path: image.path }
        const data = imageThumbnails[image.path]
        return data && data.startsWith('data:') ? { dataUrl: data } : null
    }

    /** 전체 그림을 data URL 로 (미리보기·메타데이터용) */
    const loadDataUrl = async (image: SavedImage): Promise<string | undefined> => {
        const cached = imageThumbnails[image.path]
        if (cached && cached.startsWith('data:')) return cached
        if (image.isTemporary) return undefined
        const data = await readFile(image.path)
        return `data:${imageMimeType(image.name)};base64,${bytesToBase64(data)}`
    }

    const setBusy = (path: string, kind: BusyKind | null) => {
        setBusyImages(prev => {
            const next = { ...prev }
            if (kind) next[path] = kind
            else delete next[path]
            return next
        })
    }

    /** 결과를 메인 미리보기에 띄운다 (메인 생성 중이면 생성 화면을 덮지 않는다). 다시 생성이면 새 시드를 정보 줄에 */
    const showInPreview = (imageData: string, newSeed?: number) => {
        const g = useGenerationStore.getState()
        if (g.isGenerating) return
        setPreviewImage(`data:image/png;base64,${imageData}`)
        g.setPreviewSeed(newSeed && newSeed !== g.seed ? newSeed : null)
    }

    const handleImageClick = async (image: SavedImage) => {
        let finalDataUrl: string | undefined
        try {
            finalDataUrl = await loadDataUrl(image)
        } catch (e) {
            console.error('Failed to load image:', e)
            return
        }
        if (!finalDataUrl) return

        // Set preview
        setPreviewImage(finalDataUrl)

        // Show seed (Preview only)
        try {
            const metadata = await parseMetadataFromBase64(finalDataUrl)
            if (metadata && metadata.seed) {
                // Determine if this seed is different from current generation seed
                const genStore = useGenerationStore.getState()
                if (genStore.seed !== metadata.seed) {
                    genStore.setPreviewSeed(metadata.seed)
                } else {
                    genStore.setPreviewSeed(null)
                }
            } else {
                useGenerationStore.getState().setPreviewSeed(null)
            }
        } catch (error) {
            console.warn('Failed to parse metadata for seed sync:', error)
            useGenerationStore.getState().setPreviewSeed(null)
        }

        navigate('/') // Navigate to main mode to show the image
    }

    const handleDeleteImage = async (image: SavedImage, e?: React.MouseEvent) => {
        e?.stopPropagation()

        // Handle temporary image deletion (just state update)
        if (image.isTemporary) {
            setSavedImages(prev => prev.filter(img => img.path !== image.path))
            setImageThumbnails(prev => {
                const next = { ...prev }
                delete next[image.path]
                return next
            })
            return
        }

        try {
            await remove(image.path)
            setSavedImages(prev => prev.filter(img => img.path !== image.path))
            setImageThumbnails(prev => {
                const next = { ...prev }
                delete next[image.path]
                return next
            })
        } catch (e) {
            console.error('Failed to delete image:', e)
        }
    }

    const handleLoadMetadata = async (image: SavedImage) => {
        // Always load as base64 for MetadataDialog (file URLs are not parsed there)
        let imageData: string | undefined
        try {
            imageData = await loadDataUrl(image)
        } catch {
            return
        }
        if (!imageData) return

        setSelectedImageForMetadata(imageData)
        setMetadataDialogOpen(true)
    }

    const handleCopyImage = async (image: SavedImage) => {
        try {
            if (image.isTemporary) {
                const imageData = imageThumbnails[image.path]
                if (!imageData) return
                const blob = await (await fetch(imageData)).blob()
                await copyImageToClipboard(blob, image.name)
            } else {
                await copyImageToClipboard(await readFile(image.path), image.name)
            }
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed:', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    // 다시 생성: 이 그림의 생성 정보 그대로, 시드만 새로 뽑아 한 장 더 (메인 저장 위치에 저장)
    const handleRegenerate = async (image: SavedImage) => {
        if (busyImages[image.path]) return
        const source = sourceOf(image)
        if (!source) {
            toast({ title: t('comfy.regen.failed', '다시 생성하지 못했습니다'), description: t('comfy.history.noData', '이 임시 그림의 데이터가 더 이상 없습니다.'), variant: 'destructive' })
            return
        }
        setBusy(image.path, 'regenerate')
        toast({
            title: t('comfy.regen.startTitle', '같은 설정으로 다시 그리는 중…'),
            description: t('comfy.regen.startDesc', '이 그림의 생성 정보로 시드만 바꿔 한 장 더 그립니다.'),
        })
        try {
            const result = await regenerateFromImage(source)
            if (result.success && result.imageData) {
                showInPreview(result.imageData, result.seed)
                toast({
                    title: t('toast.regenerated', '재생성 완료'),
                    description: t('comfy.regen.doneDesc', '새 시드 {{seed}} · 기록 패널에 추가했습니다', { seed: result.seed }),
                    variant: 'success',
                })
            } else if (result.interrupted) {
                toast({ title: t('comfy.regen.stopped', '다시 생성을 멈췄습니다') })
            } else {
                toast({ title: t('comfy.regen.failed', '다시 생성하지 못했습니다'), description: result.error, variant: 'destructive' })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
            toast({ title: t('comfy.regen.failed', '다시 생성하지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
        } finally {
            setBusy(image.path, null)
        }
    }

    // 고화질로 다시 그리기: 그림 자체에서 시작하므로 시드가 없어도 된다. 원본 옆(씬 그림이면 씬 폴더)에 새 파일로 저장
    const handleUpscale = async (image: SavedImage) => {
        if (busyImages[image.path]) return
        const source = sourceOf(image)
        if (!source) {
            toast({ title: t('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: t('comfy.history.noData', '이 임시 그림의 데이터가 더 이상 없습니다.'), variant: 'destructive' })
            return
        }
        setBusy(image.path, 'upscale')
        toast({
            title: t('comfy.upscale.startTitle', '고화질로 다시 그리는 중…'),
            description: t('comfy.upscale.startDesc', '원본은 그대로 두고 새 파일로 저장합니다 ({{scale}}배, 다듬기 강도 {{denoise}})', { scale: upscaleScale, denoise: upscaleDenoise }),
        })
        try {
            const result = await upscaleExisting(source)
            if (result.success && result.imageData) {
                showInPreview(result.imageData)
                const fileName = result.saved?.path.split(/[\\/]/).pop() ?? ''
                toast({
                    title: t('comfy.upscale.done', '고화질 그림을 저장했습니다'),
                    description: result.saved?.saved
                        ? t('comfy.upscale.doneDesc', '{{file}} · {{width}}×{{height}} · 기록 패널에 추가했습니다', { file: fileName, width: result.width, height: result.height })
                        : t('comfy.upscale.doneMemory', '{{width}}×{{height}} · 자동 저장이 꺼져 있어 기록 패널에만 있습니다', { width: result.width, height: result.height }),
                    variant: 'success',
                })
            } else if (result.interrupted) {
                toast({ title: t('comfy.upscale.stopped', '고화질로 다시 그리기를 멈췄습니다') })
            } else {
                toast({ title: t('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: result.error, variant: 'destructive' })
            }
        } catch (e) {
            console.error('Upscale failed:', e)
            toast({ title: t('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
        } finally {
            setBusy(image.path, null)
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async (image: SavedImage) => {
        if (image.isTemporary) return
        try {
            await revealItemInDir(image.path)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleSaveAs = async (image: SavedImage) => {
        try {
            let data: Uint8Array

            if (image.isTemporary) {
                const base64 = imageThumbnails[image.path]
                if (!base64) throw new Error("Image data not found")
                // Convert base64 back to Uint8Array
                const binaryString = atob(base64.split(',')[1])
                data = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                    data[i] = binaryString.charCodeAt(i)
                }
            } else {
                data = await readFile(image.path)
            }

            const ext = imageExtension(image.name)
            const filePath = await save({
                defaultPath: withImageExtension(image.name, ext),
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

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="h-12 flex items-center justify-between px-4">
                <span className="text-sm font-medium flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-400" />
                    {t('history.title')}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {t('history.count', { count: savedImages.length })}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={loadSavedImages}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* History Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {savedImages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                        <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                            <Clock className="h-6 w-6 opacity-50" />
                        </div>
                        <span className="text-xs">{t('history.empty')}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {savedImages.slice(0, 20).map((image, index) => (
                            <HistoryImageItem
                                key={image.path}
                                image={image}
                                thumbnail={imageThumbnails[image.path]}
                                onLoadComplete={handleImageLoadComplete}
                                index={index}
                                busy={busyImages[image.path]}
                                getTypeIcon={getTypeIcon}
                                onImageClick={handleImageClick}
                                onDelete={handleDeleteImage}
                                onSaveAs={handleSaveAs}
                                onCopy={handleCopyImage}
                                onRegenerate={handleRegenerate}
                                onUpscale={handleUpscale}
                                onOpenFolder={handleOpenFolder}
                                onLoadMetadata={handleLoadMetadata}
                            />
                        ))}
                    </div>
                )}
            </div>

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />
        </div>
    )
}
