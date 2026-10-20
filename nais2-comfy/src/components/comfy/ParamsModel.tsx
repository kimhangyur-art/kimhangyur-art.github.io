// 생성 설정: 체크포인트(모델 파일)와 모델 계열, 계열 권장값 적용
import { useTranslation } from 'react-i18next'
import { Cpu, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/use-toast'
import { useGenerationStore } from '@/stores/generation-store'
import { useComfyStore } from '@/stores/comfy-store'
import { FAMILIES, FALLBACK_FAMILY, detectFamily, getFamily, type FamilyId } from '@/services/comfy/families'
import { cn } from '@/lib/utils'
import { ComfyOfflineHint, ComfyRefreshButton, FilePicker, OptionSelect, ParamsHint, ParamsSection } from './ParamsShared'

export function ParamsModel({ id }: { id?: string }) {
    const { t } = useTranslation()
    const model = useGenerationStore((s) => s.model)
    const setModel = useGenerationStore((s) => s.setModel)
    const modelFamily = useGenerationStore((s) => s.modelFamily)
    const setModelFamily = useGenerationStore((s) => s.setModelFamily)
    const applyFamilyDefaults = useGenerationStore((s) => s.applyFamilyDefaults)
    const steps = useGenerationStore((s) => s.steps)
    const cfgScale = useGenerationStore((s) => s.cfgScale)
    const sampler = useGenerationStore((s) => s.sampler)
    const scheduler = useGenerationStore((s) => s.scheduler)
    const clipSkip = useGenerationStore((s) => s.clipSkip)
    const checkpoints = useComfyStore((s) => s.lists.checkpoints)
    const status = useComfyStore((s) => s.status)

    const detected = detectFamily(model)
    const family = getFamily(modelFamily, model)
    const fallbackLabel = FAMILIES.find((f) => f.id === FALLBACK_FAMILY)?.label ?? FALLBACK_FAMILY

    const differs =
        steps !== family.steps ||
        cfgScale !== family.cfg ||
        sampler !== family.sampler ||
        scheduler !== family.scheduler ||
        clipSkip !== family.clipSkip

    const familyOptions = [
        { value: 'auto', label: t('comfy.params.familyAuto', '자동 (파일 이름으로 짐작)') },
        ...FAMILIES.map((f) => ({ value: f.id, label: f.label })),
    ]

    const handleApply = () => {
        applyFamilyDefaults()
        toast({
            title: t('comfy.params.appliedTitle', '권장값을 적용했습니다'),
            description: t('comfy.params.appliedDesc', '{{family}} 계열에 맞춰 스텝·CFG·샘플러·스케줄러·CLIP skip·고화질 값을 바꿨습니다.', { family: family.label }),
        })
    }

    return (
        <ParamsSection
            id={id}
            icon={<Cpu className="h-4 w-4" />}
            title={t('comfy.params.modelTitle', '모델 (체크포인트)')}
            description={t('comfy.params.modelDesc', '그림을 그리는 본체 파일입니다. ComfyUI의 models/checkpoints 폴더에 넣은 파일 중에서 고릅니다.')}
        >
            <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                    <FilePicker
                        value={model}
                        files={checkpoints}
                        onChange={setModel}
                        placeholder={t('comfy.params.pickCheckpoint', '체크포인트를 고르세요')}
                        emptyText={t('comfy.params.noCheckpointsShort', '체크포인트 목록이 비어 있습니다. 새로고침을 눌러 보세요.')}
                    />
                </div>
                <ComfyRefreshButton />
            </div>
            <ComfyOfflineHint />
            {status === 'online' && checkpoints.length === 0 && (
                <ParamsHint className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                    {t('comfy.params.noCheckpoints', 'ComfyUI에 체크포인트 파일이 없습니다. ComfyUI 폴더의 models/checkpoints 에 파일을 넣고 새로고침 버튼을 누르세요.')}
                </ParamsHint>
            )}
            {!model && (
                <ParamsHint className="text-amber-600 dark:text-amber-400">
                    {t('comfy.params.needCheckpoint', '체크포인트를 골라야 그림을 만들 수 있습니다.')}
                </ParamsHint>
            )}

            <div className="space-y-2 pt-1">
                <Label className="text-sm">{t('comfy.params.family', '모델 계열')}</Label>
                <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                        <OptionSelect
                            value={modelFamily}
                            options={familyOptions}
                            onChange={(v) => setModelFamily(v as FamilyId | 'auto')}
                        />
                    </div>
                    <Tip
                        content={t(
                            'comfy.params.applyTip',
                            '이 계열에 맞는 스텝·CFG·샘플러·스케줄러·CLIP skip·고화질 값으로 한 번에 맞춥니다. 프롬프트와 해상도는 그대로 둡니다.'
                        )}
                    >
                        <Button
                            type="button"
                            variant={differs ? 'default' : 'outline'}
                            className="h-9 rounded-xl shrink-0"
                            onClick={handleApply}
                        >
                            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                            {t('comfy.params.apply', '권장값 적용')}
                        </Button>
                    </Tip>
                </div>
                {modelFamily === 'auto' && model && (
                    <ParamsHint>
                        {detected
                            ? t('comfy.params.detected', '파일 이름으로 짐작한 계열: {{label}}', { label: family.label })
                            : t('comfy.params.notDetected', '파일 이름으로 계열을 정하지 못해 {{label}}로 봅니다. 맞지 않으면 위에서 직접 고르세요.', { label: fallbackLabel })}
                    </ParamsHint>
                )}
                <ParamsHint>
                    {family.description}{' '}
                    {t('comfy.params.familyEffect', '계열에 따라 붙는 품질 태그와 부정 프롬프트, 권장 설정이 달라집니다.')}
                </ParamsHint>
                <ParamsHint className={cn(differs && 'text-amber-600 dark:text-amber-400')}>
                    {differs
                        ? t('comfy.params.recommendedDiff', '지금 설정이 권장값과 다릅니다. 권장: ')
                        : t('comfy.params.recommendedSame', '권장값대로 맞춰져 있습니다: ')}
                    <span className="font-mono">
                        {t('comfy.params.recommendedLine', '스텝 {{steps}} · CFG {{cfg}} · {{sampler}} · {{scheduler}} · CLIP skip {{clip}}', {
                            steps: family.steps,
                            cfg: family.cfg,
                            sampler: family.sampler,
                            scheduler: family.scheduler,
                            clip: family.clipSkip,
                        })}
                    </span>
                </ParamsHint>
            </div>
        </ParamsSection>
    )
}
