// LoRA 목록 편집 (생성 설정 창과 LoRA 창이 같이 쓴다)
// 줄마다: 켜기/끄기, 파일 고르기, 모델 강도, CLIP 강도, 지우기
import { useTranslation } from 'react-i18next'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useGenerationStore, type LoraEntry } from '@/stores/generation-store'
import { useComfyStore } from '@/stores/comfy-store'
import { cn } from '@/lib/utils'
import { ComfyOfflineHint, ComfyRefreshButton, FilePicker, ParamsHint, SliderNumber } from './ParamsShared'

const STRENGTH_MIN = -2
const STRENGTH_MAX = 2
const STRENGTH_STEP = 0.05

interface LoraListEditorProps {
    disabled?: boolean
    /** 맨 위 설명 문단을 보일지 */
    showIntro?: boolean
    className?: string
}

export function LoraListEditor({ disabled, showIntro = true, className }: LoraListEditorProps) {
    const { t } = useTranslation()
    const loras = useGenerationStore((s) => s.loras)
    const addLora = useGenerationStore((s) => s.addLora)
    const updateLora = useGenerationStore((s) => s.updateLora)
    const removeLora = useGenerationStore((s) => s.removeLora)
    const files = useComfyStore((s) => s.lists.loras)
    const status = useComfyStore((s) => s.status)

    const enabledCount = loras.filter((l) => l.enabled && l.name).length

    return (
        <div className={cn('space-y-3', className)}>
            {showIntro && (
                <ParamsHint>
                    {t(
                        'comfy.lora.intro',
                        'LoRA는 그림체·캐릭터·옷 같은 특징을 더해 주는 작은 추가 모델입니다. 켜 둔 줄만 적용됩니다. LoRA에 정해진 트리거 단어가 있으면 프롬프트에 직접 적어 주세요.'
                    )}
                </ParamsHint>
            )}

            <ComfyOfflineHint />
            {status === 'online' && files.length === 0 && (
                <ParamsHint className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                    {t('comfy.lora.noFiles', 'ComfyUI에 LoRA 파일이 없습니다. ComfyUI 폴더의 models/loras 에 파일을 넣고 새로고침 버튼을 누르세요.')}
                </ParamsHint>
            )}

            {loras.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/60 py-6 text-center text-muted-foreground">
                    <Layers className="h-6 w-6 opacity-40" />
                    <p className="text-sm">{t('comfy.lora.empty', '아직 넣은 LoRA가 없습니다')}</p>
                    <p className="text-xs">{t('comfy.lora.emptyHint', '아래 [추가]를 눌러 LoRA를 고르세요')}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {loras.map((lora, i) => (
                        <LoraRow
                            key={lora.id}
                            index={i}
                            lora={lora}
                            files={files}
                            disabled={disabled}
                            onChange={(patch) => updateLora(lora.id, patch)}
                            onRemove={() => removeLora(lora.id)}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 rounded-xl"
                    disabled={disabled}
                    onClick={() => addLora('')}
                >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {t('comfy.lora.add', '추가')}
                </Button>
                <ComfyRefreshButton />
            </div>
            {loras.length > 0 && (
                <ParamsHint>
                    {t('comfy.lora.summary', '지금 적용되는 LoRA: {{count}}개', { count: enabledCount })}
                </ParamsHint>
            )}
        </div>
    )
}

interface LoraRowProps {
    index: number
    lora: LoraEntry
    files: string[]
    disabled?: boolean
    onChange: (patch: Partial<LoraEntry>) => void
    onRemove: () => void
}

function LoraRow({ index, lora, files, disabled, onChange, onRemove }: LoraRowProps) {
    const { t } = useTranslation()
    const off = !lora.enabled
    return (
        <div className={cn('rounded-xl border border-border/50 bg-background/60 p-3 space-y-3 transition-opacity', off && 'opacity-60')}>
            <div className="flex items-center gap-2">
                <Tip content={lora.enabled ? t('comfy.lora.turnOff', '끄기 (목록에는 남겨 둡니다)') : t('comfy.lora.turnOn', '켜기')}>
                    <span className="shrink-0">
                        <Switch
                            checked={lora.enabled}
                            disabled={disabled}
                            onChange={(e) => onChange({ enabled: e.target.checked })}
                            aria-label={t('comfy.lora.enabled', 'LoRA 켜기')}
                        />
                    </span>
                </Tip>
                <span className="w-5 h-5 rounded-md bg-muted-foreground/20 text-muted-foreground text-[10px] font-semibold flex items-center justify-center shrink-0">
                    {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                    <FilePicker
                        value={lora.name}
                        files={files}
                        onChange={(name) => onChange({ name })}
                        placeholder={t('comfy.lora.pick', 'LoRA 고르기')}
                        emptyText={t('comfy.lora.noFilesShort', 'LoRA 목록이 비어 있습니다. 새로고침을 눌러 보세요.')}
                        disabled={disabled}
                        className="h-9"
                    />
                </div>
                <Tip content={t('comfy.lora.remove', '이 LoRA 줄 지우기')}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={disabled}
                        onClick={onRemove}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </Tip>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <SliderNumber
                    label={<span className="text-xs">{t('comfy.lora.strengthModel', '모델 강도')}</span>}
                    value={lora.strengthModel}
                    onChange={(v) => onChange({ strengthModel: v })}
                    min={STRENGTH_MIN}
                    max={STRENGTH_MAX}
                    step={STRENGTH_STEP}
                    disabled={disabled}
                    hint={t('comfy.lora.strengthModelHint', '그림에 주는 힘. 보통 0.6~1, 0이면 효과 없음, 음수면 그 특징을 뺍니다')}
                />
                <SliderNumber
                    label={<span className="text-xs">{t('comfy.lora.strengthClip', 'CLIP 강도')}</span>}
                    value={lora.strengthClip}
                    onChange={(v) => onChange({ strengthClip: v })}
                    min={STRENGTH_MIN}
                    max={STRENGTH_MAX}
                    step={STRENGTH_STEP}
                    disabled={disabled}
                    hint={t('comfy.lora.strengthClipHint', '프롬프트 글을 읽는 쪽에 주는 힘. 잘 모르면 모델 강도와 같게 두세요')}
                />
            </div>
        </div>
    )
}
