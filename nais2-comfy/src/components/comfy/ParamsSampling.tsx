// 생성 설정: 스텝, CFG, CFG 보정, 샘플러, 스케줄러, CLIP skip
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { useGenerationStore } from '@/stores/generation-store'
import { useComfyStore } from '@/stores/comfy-store'
import { DEFAULT_SAMPLERS, DEFAULT_SCHEDULERS } from '@/services/comfy/families'
import { OptionSelect, ParamsHint, ParamsSection, SliderNumber } from './ParamsShared'

export function ParamsSampling({ id }: { id?: string }) {
    const { t } = useTranslation()
    const steps = useGenerationStore((s) => s.steps)
    const setSteps = useGenerationStore((s) => s.setSteps)
    const cfgScale = useGenerationStore((s) => s.cfgScale)
    const setCfgScale = useGenerationStore((s) => s.setCfgScale)
    const cfgRescale = useGenerationStore((s) => s.cfgRescale)
    const setCfgRescale = useGenerationStore((s) => s.setCfgRescale)
    const sampler = useGenerationStore((s) => s.sampler)
    const setSampler = useGenerationStore((s) => s.setSampler)
    const scheduler = useGenerationStore((s) => s.scheduler)
    const setScheduler = useGenerationStore((s) => s.setScheduler)
    const clipSkip = useGenerationStore((s) => s.clipSkip)
    const setClipSkip = useGenerationStore((s) => s.setClipSkip)
    const samplers = useComfyStore((s) => s.lists.samplers)
    const schedulers = useComfyStore((s) => s.lists.schedulers)

    const samplerList = samplers?.length ? samplers : DEFAULT_SAMPLERS
    const schedulerList = schedulers?.length ? schedulers : DEFAULT_SCHEDULERS

    return (
        <ParamsSection
            id={id}
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title={t('comfy.params.samplingTitle', '그리기 설정')}
            description={t('comfy.params.samplingDesc', '잘 모르겠으면 위의 [권장값 적용]을 누르고 그대로 두면 됩니다.')}
        >
            <SliderNumber
                label={t('comfy.params.steps', '스텝 (Steps)')}
                value={steps}
                onChange={(v) => setSteps(Math.round(v))}
                min={1}
                max={150}
                step={1}
                hint={t('comfy.params.stepsHint', '그림을 다듬는 횟수. 많을수록 오래 걸립니다. 보통 25~30')}
            />
            <SliderNumber
                label={t('comfy.params.cfg', 'CFG (프롬프트 따르는 정도)')}
                value={cfgScale}
                onChange={setCfgScale}
                min={1}
                max={30}
                step={0.5}
                hint={t('comfy.params.cfgHint', '높을수록 프롬프트를 강하게 따르지만 색이 타거나 딱딱해집니다. 애니 SDXL 모델은 보통 4~7')}
            />
            <SliderNumber
                label={t('comfy.params.cfgRescale', 'CFG 보정 (RescaleCFG)')}
                value={cfgRescale}
                onChange={setCfgRescale}
                min={0}
                max={1}
                step={0.05}
                hint={t('comfy.params.cfgRescaleHint', 'v-pred 모델은 계열 기본값(0.7)이 자동으로 들어갑니다. 보통 0')}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                    <Label className="text-sm">{t('comfy.params.sampler', '샘플러 (Sampler)')}</Label>
                    <OptionSelect value={sampler} options={samplerList} onChange={setSampler} />
                </div>
                <div className="space-y-2">
                    <Label className="text-sm">{t('comfy.params.scheduler', '스케줄러 (Scheduler)')}</Label>
                    <OptionSelect value={scheduler} options={schedulerList} onChange={setScheduler} />
                </div>
            </div>
            <ParamsHint>
                {t('comfy.params.samplerHint', '샘플러·스케줄러는 그리는 방식입니다. euler_ancestral + normal 이 무난하고, v-pred 모델은 euler + normal 을 쓰세요.')}
            </ParamsHint>
            <SliderNumber
                label={t('comfy.params.clipSkip', 'CLIP skip')}
                value={clipSkip}
                onChange={(v) => setClipSkip(Math.round(v))}
                min={1}
                max={4}
                step={1}
                hint={t('comfy.params.clipSkipHint', 'Illustrious·Pony 같은 SDXL 애니 모델은 2 (1 = 건너뛰지 않음)')}
            />
        </ParamsSection>
    )
}
