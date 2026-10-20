// 생성 설정: 품질 태그 자동 추가, 부정 프롬프트 자동 추가(UC 프리셋)
// NAI는 서버가 이 글을 붙이지만 ComfyUI는 그런 기능이 없어서, 같은 스위치를 켜면 프로그램이 직접 붙인다.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BadgeCheck } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { getFamily } from '@/services/comfy/families'
import { UC_PRESET_NONE } from '@/services/comfyui-api'
import { OptionSelect, ParamsHint, ParamsSection } from './ParamsShared'

/** 예전 NAI 값(2 = Furry, 3 = Human)은 '강하게'로 본다 */
export function normalizeUcPreset(v: number | undefined | null): number {
    return v === 1 || v === UC_PRESET_NONE ? v : 0
}

function PreviewBox({ text, empty }: { text: string; empty: string }) {
    return (
        <div className="rounded-lg border border-border/40 bg-background/60 px-2.5 py-1.5 text-xs font-mono leading-relaxed text-muted-foreground break-words max-h-24 overflow-y-auto">
            {text || <span className="italic">{empty}</span>}
        </div>
    )
}

export function ParamsQuality({ id }: { id?: string }) {
    const { t } = useTranslation()
    const model = useGenerationStore((s) => s.model)
    const modelFamily = useGenerationStore((s) => s.modelFamily)
    const qualityToggle = useGenerationStore((s) => s.qualityToggle)
    const setQualityToggle = useGenerationStore((s) => s.setQualityToggle)
    const ucPreset = useGenerationStore((s) => s.ucPreset)
    const setUcPreset = useGenerationStore((s) => s.setUcPreset)
    const qualityTagsCustom = useSettingsStore((s) => s.qualityTagsCustom)
    const negativePresetCustom = useSettingsStore((s) => s.negativePresetCustom)

    const uc = normalizeUcPreset(ucPreset)
    useEffect(() => {
        if (uc !== ucPreset) setUcPreset(uc)
    }, [uc, ucPreset, setUcPreset])

    const family = getFamily(modelFamily, model)
    const customTags = qualityTagsCustom.trim()
    const qualityTags = customTags || family.qualityTags
    const customNeg = negativePresetCustom.trim()
    const negativeText = uc === UC_PRESET_NONE ? '' : customNeg || (uc === 1 ? family.negativeLight : family.negativeHeavy)

    return (
        <ParamsSection
            id={id}
            icon={<BadgeCheck className="h-4 w-4" />}
            title={t('comfy.quality.title', '품질 태그 · 부정 프롬프트')}
            description={t('comfy.quality.desc', '모델 계열에 맞는 글을 프롬프트에 자동으로 붙입니다. 직접 적은 프롬프트는 바뀌지 않습니다.')}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                    <Label className="cursor-pointer" onClick={() => setQualityToggle(!qualityToggle)}>
                        {t('comfy.quality.toggle', '품질 태그 자동 추가')}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                        {family.qualityAtEnd
                            ? t('comfy.quality.atEnd', '켜면 아래 태그를 프롬프트 끝에 붙입니다')
                            : t('comfy.quality.atStart', '켜면 아래 태그를 프롬프트 앞에 붙입니다')}
                        {customTags && ` · ${t('comfy.quality.custom', '설정에서 직접 정한 태그')}`}
                    </span>
                </div>
                <Switch
                    checked={qualityToggle}
                    onChange={(e) => setQualityToggle(e.target.checked)}
                    aria-label={t('comfy.quality.toggle', '품질 태그 자동 추가')}
                />
            </div>
            <div className={qualityToggle ? '' : 'opacity-50'}>
                <PreviewBox text={qualityTags} empty={t('comfy.quality.noTags', '(붙일 태그 없음)')} />
            </div>

            <div className="space-y-2 pt-2">
                <Label className="text-sm">{t('comfy.quality.uc', '부정 프롬프트 자동 추가 (UC 프리셋)')}</Label>
                <OptionSelect
                    value={String(uc)}
                    options={[
                        { value: '0', label: t('comfy.quality.ucHeavy', '강하게 (권장)') },
                        { value: '1', label: t('comfy.quality.ucLight', '가볍게') },
                        { value: String(UC_PRESET_NONE), label: t('comfy.quality.ucNone', '없음') },
                    ]}
                    onChange={(v) => setUcPreset(Number(v))}
                />
                <ParamsHint>
                    {t('comfy.quality.ucHint', '그림에 나오지 않았으면 하는 것(저품질, 글자, 망가진 손 등)을 네거티브 프롬프트 앞에 붙입니다.')}
                    {customNeg && uc !== UC_PRESET_NONE && ` ${t('comfy.quality.ucCustom', '설정에서 직접 정한 글을 씁니다.')}`}
                </ParamsHint>
                <PreviewBox text={negativeText} empty={t('comfy.quality.ucNoneText', '(붙이지 않음)')} />
            </div>
        </ParamsSection>
    )
}
