// 생성 설정 창의 본문 (프롬프트 아래 톱니바퀴 버튼). 구역별로 나눠 한 창에서 위아래로 넘겨 본다.
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { useGenerationStore } from '@/stores/generation-store'
import { LoraListEditor } from './LoraListEditor'
import { ParamsHires } from './ParamsHires'
import { ParamsModel } from './ParamsModel'
import { ParamsQuality } from './ParamsQuality'
import { ParamsSampling } from './ParamsSampling'
import { ParamsSection } from './ParamsShared'
import { ParamsSizeSeed } from './ParamsSizeSeed'

const SECTION_IDS = {
    model: 'params-model',
    lora: 'params-lora',
    size: 'params-size',
    sampling: 'params-sampling',
    hires: 'params-hires',
    quality: 'params-quality',
} as const

export function ParamsPanel() {
    const { t } = useTranslation()
    const scrollRef = useRef<HTMLDivElement>(null)
    const loraCount = useGenerationStore((s) => s.loras.filter((l) => l.enabled && l.name).length)
    const hiresOn = useGenerationStore((s) => s.hires.enabled)

    const nav: Array<{ id: string; label: string }> = [
        { id: SECTION_IDS.model, label: t('comfy.params.navModel', '모델') },
        { id: SECTION_IDS.lora, label: loraCount > 0 ? `LoRA ${loraCount}` : 'LoRA' },
        { id: SECTION_IDS.size, label: t('comfy.params.navSize', '크기·시드') },
        { id: SECTION_IDS.sampling, label: t('comfy.params.navSampling', '그리기') },
        { id: SECTION_IDS.hires, label: hiresOn ? t('comfy.params.navHiresOn', '고화질 켜짐') : t('comfy.params.navHires', '고화질') },
        { id: SECTION_IDS.quality, label: t('comfy.params.navQuality', '품질 태그') },
    ]

    const jump = (id: string) => {
        const root = scrollRef.current
        const el = root?.querySelector<HTMLElement>(`#${id}`)
        // 스크롤 상자가 relative 라서 offsetTop 은 상자 안에서의 위치다
        if (root && el) root.scrollTo({ top: Math.max(0, el.offsetTop - 4), behavior: 'smooth' })
    }

    return (
        <div className="flex flex-col min-h-0 flex-1 gap-3">
            <div className="flex flex-wrap gap-1.5 shrink-0">
                {nav.map((n) => (
                    <button
                        key={n.id}
                        type="button"
                        onClick={() => jump(n.id)}
                        className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                        {n.label}
                    </button>
                ))}
            </div>
            <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-y-auto -mx-6 px-6 pb-2 space-y-4">
                <ParamsModel id={SECTION_IDS.model} />
                <ParamsSection
                    id={SECTION_IDS.lora}
                    icon={<Layers className="h-4 w-4" />}
                    title="LoRA"
                    description={t(
                        'comfy.lora.intro',
                        'LoRA는 그림체·캐릭터·옷 같은 특징을 더해 주는 작은 추가 모델입니다. 켜 둔 줄만 적용됩니다. LoRA에 정해진 트리거 단어가 있으면 프롬프트에 직접 적어 주세요.'
                    )}
                >
                    <LoraListEditor showIntro={false} />
                </ParamsSection>
                <ParamsSizeSeed id={SECTION_IDS.size} />
                <ParamsSampling id={SECTION_IDS.sampling} />
                <ParamsHires id={SECTION_IDS.hires} />
                <ParamsQuality id={SECTION_IDS.quality} />
            </div>
        </div>
    )
}
