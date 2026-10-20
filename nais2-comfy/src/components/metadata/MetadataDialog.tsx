import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { NAIMetadata, parseMetadataFromFile, parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { usePresetStore } from '@/stores/preset-store'
import { useGenerationStore, newLoraId } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useComfyStore } from '@/stores/comfy-store'
import { normalizeSampler, normalizeScheduler } from '@/services/comfy/families'
import { toast } from '@/components/ui/use-toast'
import { FileImage, Download, AlertCircle } from 'lucide-react'

/** 이 그림의 체크포인트 파일 이름 (NovelAI 그림처럼 파일 이름이 아니면 없음) */
function checkpointOf(meta: NAIMetadata): string | undefined {
    const comfy = (meta.raw as { comfy?: { checkpoint?: unknown } } | undefined)?.comfy
    if (meta.checkpoint) return meta.checkpoint
    if (typeof comfy?.checkpoint === 'string' && comfy.checkpoint) return comfy.checkpoint
    if (meta.model && /\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i.test(meta.model)) return meta.model
    return undefined
}

/** NAIS2 Comfy·ComfyUI 그림인지 (Comment.comfy 또는 ComfyUI 그래프에서 읽었는지) */
function isComfyMeta(meta: NAIMetadata): boolean {
    return !!(meta.raw as { comfy?: unknown } | undefined)?.comfy
}

const baseName = (p: string) => (p.split(/[\\/]/).pop() ?? p).toLowerCase()

/**
 * ComfyUI 목록에서 같은 파일을 찾는다. 목록이 비어 있으면(아직 못 받았으면) 그대로 쓴다.
 * 하위 폴더가 달라도 파일 이름이 같으면 목록 쪽 이름을 쓴다.
 */
function findInList(list: string[], name: string): string | null {
    if (list.length === 0) return name
    if (list.includes(name)) return name
    const b = baseName(name)
    return list.find((x) => baseName(x) === b) ?? null
}

function fmtNum(n: number | undefined): string {
    if (n === undefined || !Number.isFinite(n)) return '-'
    return String(Math.round(n * 100) / 100)
}

function MetaCell({ label, value, title, className }: { label: string; value: React.ReactNode; title?: string; className?: string }) {
    return (
        <div className={`bg-muted/30 rounded-lg p-2 min-w-0 ${className ?? ''}`} title={title}>
            <span className="text-muted-foreground">{label}:</span>
            <span className="ml-1 font-medium break-all">{value}</span>
        </div>
    )
}

interface MetadataDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialImage?: string // base64 data URL
}

interface LoadOptions {
    prompts: boolean
    parameters: boolean
    resolution: boolean
    seed: boolean
    characterPrompts: boolean
}

export function MetadataDialog({ open, onOpenChange, initialImage }: MetadataDialogProps) {
    const { t } = useTranslation()
    const { presets, activePresetId, loadPreset, syncFromGenerationStore } = usePresetStore()
    const charStore = useCharacterPromptStore()
    const comfyLists = useComfyStore((s) => s.lists)

    const [metadata, setMetadata] = useState<NAIMetadata | null>(null)
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [selectedPresetId, setSelectedPresetId] = useState<string>(activePresetId || 'default')
    const [loadOptions, setLoadOptions] = useState<LoadOptions>({
        prompts: true,
        parameters: true,
        resolution: true,
        // 시드는 기본으로 불러오지 않는다 (대부분 시드를 고정하지 않고 쓰므로)
        seed: false,
        characterPrompts: true,
    })
    const [isDragOver, setIsDragOver] = useState(false)

    // Load metadata from initial image when dialog opens with an image
    useEffect(() => {
        if (open && initialImage) {
            setImageDataUrl(initialImage)
            loadFromBase64(initialImage)
        }
        // Reset when dialog closes
        if (!open) {
            setMetadata(null)
            setImageDataUrl(null)
            // 다음에 열 때도 시드는 꺼진 채로 시작한다
            setLoadOptions(prev => (prev.seed ? { ...prev, seed: false } : prev))
        }
    }, [open, initialImage])

    const loadFromBase64 = async (base64: string) => {
        setIsLoading(true)
        try {
            const meta = await parseMetadataFromBase64(base64)
            setMetadata(meta)
            if (!meta) {
                toast({
                    title: t('metadata.noData', '메타데이터 없음'),
                    description: t('metadata.noDataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다.'),
                    variant: 'destructive',
                })
            }
        } catch (error) {
            console.error('Failed to load metadata:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleFileDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        const file = e.dataTransfer.files[0]
        if (!file || !file.type.startsWith('image/')) {
            toast({
                title: t('metadata.invalidFile', '잘못된 파일'),
                description: t('metadata.invalidFileDesc', 'PNG 이미지 파일만 지원합니다.'),
                variant: 'destructive',
            })
            return
        }

        setIsLoading(true)
        try {
            // Read file as data URL for preview
            const reader = new FileReader()
            reader.onload = async () => {
                const dataUrl = reader.result as string
                setImageDataUrl(dataUrl)

                // Parse metadata
                const meta = await parseMetadataFromFile(file)
                setMetadata(meta)
                if (!meta) {
                    toast({
                        title: t('metadata.noData', '메타데이터 없음'),
                        description: t('metadata.noDataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다.'),
                        variant: 'destructive',
                    })
                }
                setIsLoading(false)
            }
            reader.readAsDataURL(file)
        } catch (error) {
            console.error('Failed to parse file:', error)
            setIsLoading(false)
        }
    }, [t])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
    }

    const handleApply = () => {
        if (!metadata) return

        // First, load the target preset
        if (selectedPresetId !== activePresetId) {
            loadPreset(selectedPresetId)
        }

        // (항상 붙어 있는 대화상자라 생성 진행률마다 다시 그리지 않도록 구독하지 않고 꺼내 쓴다)
        const genStore = useGenerationStore.getState()

        // 적용하면서 바꾸지 못한 것 (알림에 함께 보여 준다)
        const notes: string[] = []

        // Apply selected metadata to generation store
        if (loadOptions.prompts) {
            if (metadata.promptParts) {
                // NAIS2-generated image: restore each section separately.
                genStore.setBasePrompt(metadata.promptParts.base)
                genStore.setAdditionalPrompt(metadata.promptParts.additional)
                genStore.setDetailPrompt(metadata.promptParts.detail)
                if (metadata.promptParts.negative !== undefined) {
                    genStore.setNegativePrompt(metadata.promptParts.negative)
                }
            } else if (metadata.prompt) {
                // External image: merged prompt lands in basePrompt (fallback).
                genStore.setBasePrompt(metadata.prompt)
            }
            // V4 negative prompt has priority over legacy uc when not already set
            // by promptParts above.
            if (!metadata.promptParts?.negative) {
                if (metadata.v4_negative_prompt?.caption?.base_caption) {
                    genStore.setNegativePrompt(metadata.v4_negative_prompt.caption.base_caption)
                } else if (metadata.negativePrompt) {
                    genStore.setNegativePrompt(metadata.negativePrompt)
                }
            }
        }

        if (loadOptions.parameters) {
            const lists = useComfyStore.getState().lists

            // 체크포인트: ComfyUI에 있는 것만 (목록을 아직 못 받았으면 그대로)
            const ckpt = checkpointOf(metadata)
            if (ckpt) {
                const found = findInList(lists.checkpoints, ckpt)
                if (found) genStore.setModel(found)
                else notes.push(t('comfy.meta.ckptMissingNote', '체크포인트 {{name}} 가 ComfyUI에 없어 지금 체크포인트를 그대로 둡니다.', { name: ckpt }))
            } else if (metadata.model) {
                notes.push(t('comfy.meta.naiModelNote', 'NovelAI 그림이라 체크포인트는 지금 것을 그대로 둡니다.'))
            }

            // LoRA: 새 id 로. ComfyUI에 없는 LoRA는 꺼 둔다 (켜 두면 생성이 실패한다)
            if (metadata.loras) {
                let missing = 0
                genStore.setLoras(metadata.loras.map((l) => {
                    const found = findInList(lists.loras, l.name)
                    if (!found) missing++
                    return {
                        id: newLoraId(),
                        name: found ?? l.name,
                        enabled: !!found,
                        strengthModel: l.strengthModel,
                        strengthClip: l.strengthClip,
                    }
                }))
                if (missing > 0) notes.push(t('comfy.meta.loraMissingNote', 'ComfyUI에 없는 LoRA {{count}}개는 꺼 두었습니다.', { count: missing }))
            }
            if (typeof metadata.clipSkip === 'number') genStore.setClipSkip(metadata.clipSkip)

            if (metadata.steps) genStore.setSteps(metadata.steps)
            if (metadata.cfgScale) genStore.setCfgScale(metadata.cfgScale)
            // CFG 보정(RescaleCFG)은 ComfyUI 그림의 값만 쓴다 (NovelAI의 rescale 은 뜻이 달라서)
            if (isComfyMeta(metadata)) genStore.setCfgRescale(metadata.cfgRescale ?? 0)
            if (metadata.sampler) genStore.setSampler(normalizeSampler(metadata.sampler))
            if (metadata.scheduler) genStore.setScheduler(normalizeScheduler(metadata.scheduler))
            if (typeof metadata.qualityToggle === 'boolean') genStore.setQualityToggle(metadata.qualityToggle)
            if (typeof metadata.ucPreset === 'number') {
                // 2(Furry)·3(Human)은 NovelAI 전용이라 '강하게'(0)로
                genStore.setUcPreset(metadata.ucPreset === 2 || metadata.ucPreset === 3 ? 0 : metadata.ucPreset)
            }
        }

        if (loadOptions.resolution && metadata.width && metadata.height) {
            genStore.setSelectedResolution({
                label: `${metadata.width}x${metadata.height}`,
                width: metadata.width,
                height: metadata.height,
            })
        }

        // 시드는 다음 한 장에만 쓴다. 고정(잠금)은 하지 않는다 — 고정하려면 사용자가 직접 잠근다
        if (loadOptions.seed && metadata.seed) {
            genStore.setSeed(metadata.seed)
        }

        if (loadOptions.characterPrompts && metadata.v4_prompt?.caption?.char_captions) {
            // 기존 캐릭터 프롬프트 유지하고 새 캐릭터 추가 (병합 방식)
            const negativeCharCaptions = metadata.v4_negative_prompt?.caption?.char_captions || []

            metadata.v4_prompt.caption.char_captions.forEach((cap, index) => {
                const presetId = Date.now().toString() + Math.random().toString(36).substr(2, 9) + index

                // 해당 인덱스의 캐릭터 네거티브 프롬프트 가져오기
                const charNegative = negativeCharCaptions[index]?.char_caption || ''

                // 1. Add to Library (Presets)
                charStore.addPreset({
                    id: presetId,
                    name: `Imported ${index + 1}`,
                    prompt: cap.char_caption,
                    negative: charNegative
                })

                // 2. Add to Stage (Linked)
                cap.centers.forEach(center => {
                    charStore.addCharacter({
                        presetId: presetId,
                        prompt: cap.char_caption,
                        negative: charNegative,
                        position: center,
                        enabled: true
                    })
                })
            })
        }

        // Save to preset
        syncFromGenerationStore()

        toast({
            title: t('metadata.applied', '메타데이터 적용됨'),
            description: notes.length
                ? notes.join(' ')
                : t('metadata.appliedDesc', '선택한 설정이 프리셋에 적용되었습니다.'),
            variant: 'success',
        })

        onOpenChange(false)
    }

    const toggleOption = (key: keyof LoadOptions) => {
        setLoadOptions(prev => ({ ...prev, [key]: !prev[key] }))
    }

    const allSelected = Object.values(loadOptions).every(v => v)
    const toggleAll = () => {
        const newValue = !allSelected
        setLoadOptions({
            prompts: newValue,
            parameters: newValue,
            resolution: newValue,
            seed: newValue,
            characterPrompts: newValue,
        })
    }

    const resetAndLoadAnother = () => {
        setMetadata(null)
        setImageDataUrl(null)
    }

    const metadataCheckpoint = metadata ? checkpointOf(metadata) : undefined
    const checkpointMissing = !!metadataCheckpoint && !findInList(comfyLists.checkpoints, metadataCheckpoint)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileImage className="h-5 w-5" />
                        {t('metadata.title', '메타데이터 불러오기')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('metadata.description', '이미지에서 생성 설정을 추출하여 프리셋에 적용합니다.')}
                    </DialogDescription>
                </DialogHeader>

                {!metadata ? (
                    // Drop zone
                    <div
                        className={`
                            border-2 border-dashed rounded-xl p-12 text-center transition-colors
                            ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}
                            ${isLoading ? 'opacity-50' : 'cursor-pointer hover:border-primary/50'}
                        `}
                        onDrop={handleFileDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                    >
                        <Download className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-base font-medium mb-2">
                            {isLoading ? t('metadata.loading', '불러오는 중...') : t('metadata.dropHere', '이미지를 여기에 드롭하세요')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t('comfy.meta.dropDesc', 'NAIS2·NovelAI·ComfyUI로 만든 PNG에서 프롬프트와 설정을 읽습니다')}
                        </p>
                    </div>
                ) : (
                    // Two-column layout: Image | Info
                    <div className="flex gap-4 min-h-0 flex-1 overflow-hidden">
                        {/* Left: Image Preview */}
                        <div className="w-1/3 flex-shrink-0">
                            {imageDataUrl && (
                                <div className="rounded-xl overflow-hidden bg-muted/30 border">
                                    <img
                                        src={imageDataUrl}
                                        alt="Preview"
                                        className="w-full h-auto object-contain max-h-[400px]"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Right: Metadata Info */}
                        <div className="flex-1 flex flex-col min-h-0 min-w-0">
                            <ScrollArea className="flex-1 pr-2">
                                <div className="space-y-4">
                                    {/* Prompt */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-prompts"
                                                checked={loadOptions.prompts}
                                                onCheckedChange={() => toggleOption('prompts')}
                                            />
                                            <Label htmlFor="opt-prompts" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optPrompts', '프롬프트')}
                                            </Label>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs font-medium text-muted-foreground">
                                                Positive Prompt
                                            </Label>
                                            <Textarea
                                                value={metadata.prompt || ''}
                                                readOnly
                                                className="text-xs resize-none h-48 bg-muted/30 cursor-text select-text"
                                                placeholder="No prompt found"
                                            />
                                        </div>
                                    </div>

                                    {/* Negative Prompt */}
                                    {(metadata.negativePrompt || metadata.v4_negative_prompt?.caption?.base_caption) && (
                                        <div className="space-y-1">
                                            <Label className="text-xs font-medium text-muted-foreground">
                                                Negative Prompt
                                            </Label>
                                            <Textarea
                                                value={metadata.v4_negative_prompt?.caption?.base_caption || metadata.negativePrompt || ''}
                                                readOnly
                                                className="text-xs resize-none h-24 bg-muted/30 cursor-text select-text"
                                            />
                                        </div>
                                    )}

                                    <Separator />

                                    {/* Parameters */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-params"
                                                checked={loadOptions.parameters}
                                                onCheckedChange={() => toggleOption('parameters')}
                                            />
                                            <Label htmlFor="opt-params" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optParams', '파라미터')}
                                            </Label>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <MetaCell label={t('comfy.meta.steps', '스텝')} value={metadata.steps || '-'}
                                                title={t('comfy.meta.stepsHint', '몇 번에 걸쳐 그림을 다듬는지. 많을수록 느리고 조금 더 정교합니다.')} />
                                            <MetaCell label="CFG" value={metadata.cfgScale || '-'}
                                                title={t('comfy.meta.cfgHint', '프롬프트를 얼마나 강하게 따를지 (NovelAI의 Guidance)')} />
                                            <MetaCell label={t('comfy.meta.sampler', '샘플러')} value={metadata.sampler ? normalizeSampler(metadata.sampler) : '-'}
                                                title={metadata.sampler} />
                                            <MetaCell label={t('comfy.meta.scheduler', '스케줄러')} value={metadata.scheduler ? normalizeScheduler(metadata.scheduler) : '-'}
                                                title={metadata.scheduler} />
                                            <MetaCell label="CLIP skip" value={metadata.clipSkip ?? '-'}
                                                title={t('comfy.meta.clipSkipHint', '1 = 건너뛰지 않음, 2 = 마지막 층 하나 건너뜀 (애니 계열 모델 권장)')} />
                                            <MetaCell label={t('comfy.meta.hires', '고화질 단계')}
                                                value={metadata.hires?.enabled
                                                    ? `×${fmtNum(metadata.hires.scale)} · ${fmtNum(metadata.hires.denoise)}`
                                                    : metadata.hires === null ? t('comfy.meta.off', '꺼짐') : '-'}
                                                title={metadata.hires?.enabled
                                                    ? t('comfy.meta.hiresDetail', '{{method}} 방식으로 {{scale}}배 키운 뒤 강도 {{denoise}}, {{steps}}스텝으로 다듬음', {
                                                        method: metadata.hires.method === 'latent' ? t('comfy.meta.hiresLatent', '잠재(latent)')
                                                            : metadata.hires.method === 'model' ? t('comfy.meta.hiresModel', '업스케일 모델') : t('comfy.meta.hiresPixel', '그림 확대'),
                                                        scale: fmtNum(metadata.hires.scale),
                                                        denoise: fmtNum(metadata.hires.denoise),
                                                        steps: metadata.hires.steps,
                                                    })
                                                    : t('comfy.meta.hiresHint', '생성하면서 한 번 더 크게 다듬는 단계')} />
                                            <MetaCell className="col-span-3" label={t('comfy.meta.checkpoint', '체크포인트')}
                                                value={metadataCheckpoint
                                                    ? <>
                                                        {metadataCheckpoint}
                                                        {checkpointMissing && (
                                                            <span className="ml-2 text-amber-500">{t('comfy.meta.notInComfy', '(ComfyUI에 없음)')}</span>
                                                        )}
                                                    </>
                                                    : metadata.model
                                                        ? <>{metadata.model} <span className="text-muted-foreground">{t('comfy.meta.naiModel', '(NovelAI 모델 · 적용 안 함)')}</span></>
                                                        : '-'}
                                                title={metadataCheckpoint ?? metadata.model} />
                                            <MetaCell className="col-span-3" label="LoRA"
                                                value={metadata.loras === undefined
                                                    ? '-'
                                                    : metadata.loras.length === 0
                                                        ? t('comfy.meta.none', '없음')
                                                        : metadata.loras.map((l, i) => {
                                                            const missing = !findInList(comfyLists.loras, l.name)
                                                            return (
                                                                <span key={i} className={`inline-block mr-2 ${missing ? 'text-amber-500' : ''}`}>
                                                                    {l.name.split(/[\\/]/).pop()} {fmtNum(l.strengthModel)}/{fmtNum(l.strengthClip)}
                                                                    {missing && ` ${t('comfy.meta.notInComfy', '(ComfyUI에 없음)')}`}
                                                                </span>
                                                            )
                                                        })}
                                                title={t('comfy.meta.loraHint', '이름 뒤의 숫자는 모델 강도 / CLIP 강도')} />
                                            {metadata.variant?.label && (
                                                <MetaCell className="col-span-3" label={t('comfy.meta.variant', '변형')} value={metadata.variant.label} />
                                            )}
                                            {metadata.upscaledFrom && (
                                                <MetaCell className="col-span-3" label={t('comfy.meta.upscaledFrom', '고화질로 다시 그림')}
                                                    value={t('comfy.meta.upscaledFromValue', '{{scale}}배, 다듬기 강도 {{denoise}}', { scale: fmtNum(metadata.upscaledFrom.scale), denoise: fmtNum(metadata.upscaledFrom.denoise) })} />
                                            )}
                                        </div>
                                        {checkpointMissing && (
                                            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                                    {t('comfy.meta.ckptMissingWarn', '이 그림의 체크포인트가 ComfyUI에 없습니다. 적용해도 체크포인트는 지금 고른 것을 그대로 씁니다.')}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Resolution */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-resolution"
                                                checked={loadOptions.resolution}
                                                onCheckedChange={() => toggleOption('resolution')}
                                            />
                                            <Label htmlFor="opt-resolution" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optResolution', '해상도')}
                                            </Label>
                                            <span className="text-sm text-muted-foreground ml-auto">
                                                {metadata.width && metadata.height
                                                    ? `${metadata.width} × ${metadata.height}`
                                                    : '-'
                                                }
                                            </span>
                                        </div>
                                    </div>

                                    {/* Seed */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-seed"
                                                checked={loadOptions.seed}
                                                onCheckedChange={() => toggleOption('seed')}
                                            />
                                            <Label htmlFor="opt-seed" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optSeed', '시드')}
                                            </Label>
                                            <span className="text-sm font-mono text-muted-foreground ml-auto">
                                                {metadata.seed || '-'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground pl-6">
                                            {t('comfy.meta.seedHint', '켜면 다음 한 장에만 이 시드를 씁니다. 시드를 고정하지는 않습니다.')}
                                        </p>
                                    </div>

                                    {/* Character Prompts */}
                                    {metadata.v4_prompt?.caption?.char_captions && metadata.v4_prompt.caption.char_captions.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="opt-char-prompts"
                                                    checked={loadOptions.characterPrompts}
                                                    onCheckedChange={() => toggleOption('characterPrompts')}
                                                />
                                                <Label htmlFor="opt-char-prompts" className="text-sm font-medium cursor-pointer">
                                                    {t('metadata.optCharPrompts', '캐릭터 프롬프트')}
                                                </Label>
                                            </div>
                                            <div className="pl-6 space-y-1">
                                                {metadata.v4_prompt.caption.char_captions.map((cap, idx) => (
                                                    <div key={idx} className="bg-muted/30 rounded-lg p-2 text-xs">
                                                        <div className="font-medium text-muted-foreground mb-1">
                                                            Pos: {cap.centers.map(c => `(${c.x.toFixed(2)}, ${c.y.toFixed(2)})`).join(', ')}
                                                        </div>
                                                        <Textarea
                                                            value={cap.char_caption}
                                                            readOnly
                                                            className="text-xs resize-none h-20 bg-transparent border-0 p-0 focus-visible:ring-0 cursor-text select-text"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>

                            <Separator className="my-3" />

                            {/* Bottom Actions */}
                            <div className="space-y-3">
                                {/* Preset selector */}
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm whitespace-nowrap">{t('metadata.targetPreset', '적용할 프리셋')}</Label>
                                    <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
                                        <SelectTrigger className="flex-1 h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {presets.map(preset => (
                                                <SelectItem key={preset.id} value={preset.id}>
                                                    {preset.isDefault ? t('preset.default', '기본') : preset.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
                                        {allSelected ? t('metadata.deselectAll', '전체 해제') : t('metadata.selectAll', '전체 선택')}
                                    </Button>
                                    <div className="flex-1" />
                                    <Button variant="outline" size="sm" onClick={resetAndLoadAnother}>
                                        {t('metadata.loadAnother', '다른 이미지')}
                                    </Button>
                                    <Button size="sm" onClick={handleApply}>
                                        {t('metadata.apply', '적용')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
