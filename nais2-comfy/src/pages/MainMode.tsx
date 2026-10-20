import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon, ImagePlus, Download, Copy, RotateCcw, Save, FolderOpen, Maximize2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { regenerateFromImage, upscaleExisting } from '@/lib/comfy-params'
import { copyImageToClipboard } from '@/lib/image-utils'
import { toast } from '@/components/ui/use-toast'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { Command } from '@tauri-apps/plugin-shell'
import { save } from '@tauri-apps/plugin-dialog'
import { pictureDir, join } from '@tauri-apps/api/path'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'

/** 미리보기 그림에 대해 지금 하고 있는 일 (다시 생성 / 고화질로 다시 그리기) */
type PreviewAction = 'regenerate' | 'upscale'

export default function MainMode() {
    const { t } = useTranslation()
    const {
        previewImage,
        isGenerating,
        selectedResolution,
        seed,
        previewSeed,

        lastGenerationTime,
        batchCount,
        currentBatch,
        streamProgress,
        setPreviewImage,
        setSeed,
        setPreviewSeed,
    } = useGenerationStore()
    const upscaleScale = useSettingsStore((s) => s.upscaleScale)
    const upscaleDenoise = useSettingsStore((s) => s.upscaleDenoise)

    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [metadataImage, setMetadataImage] = useState<string | undefined>(undefined)
    const [isDragOver, setIsDragOver] = useState(false)

    // 다시 생성·고화질로 다시 그리기 진행 상태 (메인 생성의 isGenerating 은 건드리지 않는다)
    const [busyAction, setBusyAction] = useState<PreviewAction | null>(null)
    const [actionProgress, setActionProgress] = useState(0)

    /** 지금 미리보기를 생성 요청에 넘길 수 있는 형태로 (보통은 data URL) */
    const previewSource = async (): Promise<{ dataUrl?: string; bytes?: Uint8Array }> => {
        if (!previewImage) throw new Error(t('comfy.preview.none', '미리보기 그림이 없습니다'))
        if (previewImage.startsWith('data:')) return { dataUrl: previewImage }
        const res = await fetch(previewImage)
        return { bytes: new Uint8Array(await res.arrayBuffer()) }
    }

    /**
     * 결과를 미리보기에 띄운다. 그 사이 메인 생성이 시작됐으면 생성 화면을 덮지 않는다.
     * seed 를 주면 (다시 생성) 아래 정보 줄에 그 시드를 보여 주고, 누르면 다음 생성에 쓸 수 있다.
     */
    const showResult = (imageData: string, newSeed?: number) => {
        const g = useGenerationStore.getState()
        if (g.isGenerating) return
        setPreviewImage(`data:image/png;base64,${imageData}`)
        setPreviewSeed(newSeed && newSeed !== g.seed ? newSeed : null)
    }

    // 다시 생성: 이 그림의 생성 정보 그대로, 시드만 새로 뽑아 한 장 더
    const handleRegenerateWithMetadata = async () => {
        if (!previewImage || isGenerating || busyAction) return
        setBusyAction('regenerate')
        setActionProgress(0)
        toast({
            title: t('comfy.regen.startTitle', '같은 설정으로 다시 그리는 중…'),
            description: t('comfy.regen.startDesc', '이 그림의 생성 정보로 시드만 바꿔 한 장 더 그립니다.'),
        })
        try {
            const result = await regenerateFromImage(await previewSource(), {
                onProgress: (p) => setActionProgress(p),
            })
            if (result.success && result.imageData) {
                showResult(result.imageData, result.seed)
                toast({
                    title: t('toast.regenerated', '재생성 완료'),
                    description: t('comfy.regen.doneDesc', '새 시드 {{seed}} · 기록 패널에 추가했습니다', { seed: result.seed }),
                    variant: 'success',
                })
            } else if (result.interrupted) {
                toast({ title: t('comfy.regen.stopped', '다시 생성을 멈췄습니다') })
            } else {
                toast({
                    title: t('comfy.regen.failed', '다시 생성하지 못했습니다'),
                    description: result.error,
                    variant: 'destructive',
                })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
            toast({ title: t('comfy.regen.failed', '다시 생성하지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
        } finally {
            setBusyAction(null)
            setActionProgress(0)
        }
    }

    // 고화질로 다시 그리기: 그림 자체에서 시작하므로 시드가 필요 없다. 원본은 그대로 두고 새 파일로 저장
    const handleUpscale = async () => {
        if (!previewImage || isGenerating || busyAction) return
        setBusyAction('upscale')
        setActionProgress(0)
        toast({
            title: t('comfy.upscale.startTitle', '고화질로 다시 그리는 중…'),
            description: t('comfy.upscale.startDesc', '원본은 그대로 두고 새 파일로 저장합니다 ({{scale}}배, 다듬기 강도 {{denoise}})', { scale: upscaleScale, denoise: upscaleDenoise }),
        })
        try {
            const result = await upscaleExisting(await previewSource(), {
                onProgress: (p) => setActionProgress(p),
            })
            if (result.success && result.imageData) {
                showResult(result.imageData)
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
                toast({
                    title: t('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'),
                    description: result.error,
                    variant: 'destructive',
                })
            }
        } catch (e) {
            console.error('Upscale failed:', e)
            toast({ title: t('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
        } finally {
            setBusyAction(null)
            setActionProgress(0)
        }
    }

    const handleCopy = async () => {
        if (!previewImage) return
        try {
            const response = await fetch(previewImage)
            const blob = await response.blob()
            await copyImageToClipboard(blob, blob.type === 'image/jpeg' ? 'preview.jpg' : blob.type === 'image/webp' ? 'preview.webp' : 'preview.png')
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    // Save As with native Windows dialog (ComfyUI 결과는 PNG)
    const handleSaveAs = async () => {
        if (!previewImage) return
        try {
            const filePath = await save({
                defaultPath: `NAIS_${Date.now()}.png`,
                filters: [{ name: t('comfy.file.imageFilter', '{{ext}} 그림', { ext: 'PNG' }), extensions: ['png'] }],
            })

            if (filePath) {
                const response = await fetch(previewImage)
                const bytes = new Uint8Array(await response.arrayBuffer())
                await writeFile(/\.png$/i.test(filePath) ? filePath : `${filePath}.png`, bytes)
                toast({
                    title: t('toast.saved', '저장 완료'),
                    variant: 'success',
                })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({
                title: t('toast.saveFailed', '저장 실패'),
                variant: 'destructive',
            })
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async () => {
        try {
            // 저장할 때와 같은 규칙 (절대 경로를 정했으면 거기, 아니면 사진 폴더 아래)
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const folderPath = useAbsolutePath && savePath
                ? savePath
                : await join(await pictureDir(), savePath || 'NAIS_Output')

            const dirExists = await exists(folderPath)
            if (!dirExists) {
                await mkdir(folderPath, { recursive: true })
            }

            // Use explorer to enter the directory
            await Command.create('explorer', [folderPath]).execute()
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    // Metadata loading from current preview
    const handleLoadMetadata = () => {
        if (previewImage) {
            setMetadataImage(previewImage)
            setMetadataDialogOpen(true)
        }
    }

    // Drag counter to prevent flickering from child elements
    const dragCounter = useRef(0)

    // Drag & Drop for metadata loading
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
        setIsDragOver(false)

        const file = e.dataTransfer.files[0]
        if (file && file.type.startsWith('image/')) {
            // Convert file to base64
            const reader = new FileReader()
            reader.onload = () => {
                setMetadataImage(reader.result as string)
                setMetadataDialogOpen(true)
            }
            reader.readAsDataURL(file)
        }
    }, [])

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current++
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragOver(false)
        }
    }, [])

    // Memory cleanup on unmount - release large Base64 data when leaving main mode
    // This prevents OOM when switching between modes (Issue #6)
    useEffect(() => {
        return () => {
            console.log('[MainMode] Unmounting - clearing runtime data')
            useGenerationStore.getState().clearRuntimeData()
        }
    }, [])

    // Timer Logic
    const [elapsedTime, setElapsedTime] = useState(0)

    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined
        if (isGenerating) {
            const start = Date.now()
            setElapsedTime(0)
            interval = setInterval(() => {
                setElapsedTime(Date.now() - start)
            }, 100)
        } else {
            setElapsedTime(0)
        }
        return () => clearInterval(interval)
    }, [isGenerating])

    // Format time (s.ms)
    const formatTime = (ms: number) => (ms / 1000).toFixed(1)

    return (
        <div
            className="relative w-full h-full min-h-0 bg-background/50"
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Drag overlay - Modern glassmorphism style */}
            {isDragOver && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center">
                    <div className="relative">
                        {/* Animated ring */}
                        <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary via-purple-500 to-primary animate-pulse opacity-50 blur-xl" />

                        {/* Main card */}
                        <div className="relative bg-background/80 backdrop-blur-xl border border-white/20 rounded-3xl p-12 shadow-2xl">
                            <div className="text-center space-y-4">
                                {/* Animated icon container */}
                                <div className="relative mx-auto w-20 h-20">
                                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                                    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                                        <ImagePlus className="h-10 w-10 text-white" />
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xl font-semibold text-foreground">
                                        {t('metadata.dropToLoad', '이미지를 드롭하여 메타데이터 불러오기')}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {t('metadata.extractDesc', 'PNG 파일에서 프롬프트와 설정을 추출합니다')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Full Screen Image Area */}
            <div className="w-full h-full flex items-center justify-center overflow-hidden">
                {previewImage ? (
                    // Generated Image with Context Menu
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="relative w-full h-full group cursor-context-menu">
                                <img
                                    src={previewImage}
                                    alt="Generated preview"
                                    className="w-full h-full object-contain"
                                />
                                {/* Image Actions Overlay (Visible on hover; 작업 중에는 계속 보인다) */}
                                <div className={`absolute top-4 right-4 flex gap-2 transition-opacity duration-300 ${busyAction ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    <Tip content={t('comfy.regen.tip', '다시 생성 — 이 그림의 설정 그대로 시드만 바꿔 한 장 더')}>
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="rounded-full h-10 w-10 shadow-lg backdrop-blur-md bg-black/30 border border-white/10 hover:bg-black/50 text-white"
                                            onClick={handleRegenerateWithMetadata}
                                            disabled={isGenerating || !!busyAction}
                                        >
                                            {busyAction === 'regenerate'
                                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                                : <RotateCcw className="h-5 w-5" />}
                                        </Button>
                                    </Tip>
                                    <Tip
                                        side="bottom"
                                        content={
                                            <span className="block max-w-[280px] whitespace-normal leading-relaxed">
                                                <span className="block font-semibold">{t('comfy.upscale.action', '고화질로 다시 그리기')}</span>
                                                {t('comfy.upscale.tip', '이 그림을 {{scale}}배로 키운 뒤 다시 다듬어 새 파일로 저장합니다. 그림 자체에서 시작하므로 시드를 고정하지 않아도 됩니다. 크기와 다듬기 강도({{denoise}})는 설정 → ComfyUI에서 바꿀 수 있습니다.', { scale: upscaleScale, denoise: upscaleDenoise })}
                                            </span>
                                        }
                                    >
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="rounded-full h-10 w-10 shadow-lg backdrop-blur-md bg-black/30 border border-white/10 hover:bg-black/50 text-white"
                                            onClick={handleUpscale}
                                            disabled={isGenerating || !!busyAction}
                                        >
                                            {busyAction === 'upscale'
                                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                                : <Maximize2 className="h-5 w-5" />}
                                        </Button>
                                    </Tip>
                                    <Tip content={t('actions.copy', '복사')}>
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="rounded-full h-10 w-10 shadow-lg backdrop-blur-md bg-black/30 border border-white/10 hover:bg-black/50 text-white"
                                            onClick={handleCopy}
                                        >
                                            <Copy className="h-5 w-5" />
                                        </Button>
                                    </Tip>
                                    <Tip content={t('actions.saveAs', '다른 이름으로 저장')}>
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="rounded-full h-10 w-10 shadow-lg backdrop-blur-md bg-black/30 border border-white/10 hover:bg-black/50 text-white"
                                            onClick={handleSaveAs}
                                        >
                                            <Download className="h-5 w-5" />
                                        </Button>
                                    </Tip>
                                </div>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onClick={handleSaveAs}>
                                <Save className="h-4 w-4 mr-2" />
                                {t('actions.saveAs', '저장')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleCopy}>
                                <Copy className="h-4 w-4 mr-2" />
                                {t('actions.copy', '복사')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleRegenerateWithMetadata} disabled={isGenerating || !!busyAction}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                {t('actions.regenerate', '재생성')}
                            </ContextMenuItem>
                            {/* 스마트 툴·인페인팅·I2I 자리: 고화질로 다시 그리기 */}
                            <ContextMenuItem onClick={handleUpscale} disabled={isGenerating || !!busyAction} className="items-start">
                                <Maximize2 className="h-4 w-4 mr-2 mt-0.5" />
                                <span className="flex flex-col">
                                    <span>{t('comfy.upscale.action', '고화질로 다시 그리기')}</span>
                                    <span className="text-[10px] leading-tight text-muted-foreground">
                                        {t('comfy.upscale.menuHint', '시드 없이 이 그림에서 시작 · 새 파일로 저장')}
                                    </span>
                                </span>
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={handleOpenFolder}>
                                <FolderOpen className="h-4 w-4 mr-2" />
                                {t('actions.openFolder', '폴더 열기')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleLoadMetadata}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                {t('metadata.loadFromImage', '메타데이터 불러오기')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                ) : isGenerating ? (
                    // Loading State (Only shown when no previous image exists)
                    <div className="flex flex-col items-center justify-center z-10">
                        <div className="relative mb-6">
                            <div className="h-24 w-24 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                            <ImagePlus className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 text-primary" />
                        </div>
                        <p className="text-xl font-medium text-foreground mb-3">
                            {batchCount > 1
                                ? `${t('generate.loadingTitle')} (${currentBatch}/${batchCount})`
                                : t('generate.loadingTitle')
                            }
                        </p>
                        {/* Timer Display */}
                        <div className="text-sm font-mono text-muted-foreground bg-muted/20 px-3 py-1 rounded-full">
                            {formatTime(elapsedTime)}s
                            {lastGenerationTime && (
                                <span className="opacity-50 mx-1">/ ~{formatTime(lastGenerationTime)}s</span>
                            )}
                        </div>
                    </div>
                ) : (
                    // Empty State - Drop zone hint
                    <div className="flex flex-col items-center justify-center text-muted-foreground/50">
                        <div className="w-32 h-32 rounded-full bg-muted/20 flex items-center justify-center mb-6 border-4 border-dashed border-muted-foreground/20">
                            <ImageIcon className="h-16 w-16" />
                        </div>
                        <p className="text-xl font-medium text-foreground/80">{t('generate.emptyState')}</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t('generate.emptyDescription')}
                        </p>
                        <p className="mt-4 text-xs text-muted-foreground/60">
                            {t('metadata.dropHint', '이미지를 드래그하여 메타데이터를 불러올 수 있습니다')}
                        </p>
                    </div>
                )}
            </div>

            {/* Generation Progress Bar - Above Info Bar */}
            {isGenerating && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-xl flex items-center gap-4 text-sm text-white/90 transition-all hover:bg-black/50">
                    <div className="h-4 w-4 rounded-full border-2 border-primary/50 border-t-primary animate-spin" />
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-emerald-400 leading-none mb-0.5">
                            {t('generate.generating')}
                        </span>
                        <span className="text-[10px] font-mono text-white/60 leading-none">
                            {formatTime(elapsedTime)}s
                            {lastGenerationTime && (
                                <> / {formatTime(lastGenerationTime)}s</>
                            )}
                        </span>
                    </div>
                    {/* Streaming Progress */}
                    {streamProgress > 0 && streamProgress < 100 && (
                        <div className="flex items-center gap-2 ml-2">
                            <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-400 to-primary transition-[width] duration-300 ease-out"
                                    style={{ width: `${streamProgress}%` }}
                                />
                            </div>
                            <span className="text-[10px] font-mono text-emerald-400">{streamProgress}%</span>
                        </div>
                    )}
                </div>
            )}

            {/* 다시 생성·고화질로 다시 그리기 진행률 (메인 생성 진행률과 같은 모양) */}
            {!isGenerating && busyAction && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-xl flex items-center gap-4 text-sm text-white/90 transition-all hover:bg-black/50">
                    <div className="h-4 w-4 rounded-full border-2 border-primary/50 border-t-primary animate-spin" />
                    <span className="text-xs font-medium text-emerald-400 leading-none">
                        {busyAction === 'upscale'
                            ? t('comfy.upscale.running', '고화질로 다시 그리는 중…')
                            : t('comfy.regen.running', '같은 설정으로 다시 그리는 중…')}
                    </span>
                    {actionProgress > 0 && actionProgress < 100 && (
                        <div className="flex items-center gap-2 ml-2">
                            <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-400 to-primary transition-[width] duration-300 ease-out"
                                    style={{ width: `${actionProgress}%` }}
                                />
                            </div>
                            <span className="text-[10px] font-mono text-emerald-400">{actionProgress}%</span>
                        </div>
                    )}
                </div>
            )}

            {/* Bottom Info Bar Overlay */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-xl flex items-center gap-6 text-sm text-white/90 transition-all hover:bg-black/50">
                <span className="flex items-center gap-2">
                    <span className="opacity-60 text-xs uppercase tracking-wider">{t('settings.resolution')}</span>
                    <span className="font-medium">{selectedResolution.width} × {selectedResolution.height}</span>
                </span>
                <div className="w-px h-4 bg-white/20" />
                <span
                    className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${previewSeed ? 'text-yellow-400 font-bold' : ''}`}
                    onClick={() => {
                        const targetSeed = previewSeed ?? seed
                        if (targetSeed) {
                            // If previewing, apply the seed
                            if (previewSeed) {
                                setSeed(previewSeed)
                                setPreviewSeed(null) // Exit preview mode
                                toast({ title: t('toast.seedApplied', '시드 적용됨'), variant: 'success' })
                            } else {
                                // Normal behavior: Copy to clipboard
                                navigator.clipboard.writeText(targetSeed.toString())
                                toast({ title: t('toast.copied', '복사됨'), variant: 'success' })
                            }
                        }
                    }}
                >
                    <span className="opacity-60 text-xs uppercase tracking-wider">{t('settings.seed')}</span>
                    <span className="font-mono">{previewSeed ?? seed ?? t('settings.random')}</span>
                </span>
            </div>

            {/* Metadata Dialog */}
            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setMetadataImage(undefined)
                }}
                initialImage={metadataImage}
            />
        </div>
    )
}
