// 생성 설정: 해상도와 시드
import { useTranslation } from 'react-i18next'
import { Dice5, Lock, Maximize2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tooltip'
import { ResolutionSelector } from '@/components/ui/ResolutionSelector'
import { useGenerationStore } from '@/stores/generation-store'
import { cn, generateRandomSeed } from '@/lib/utils'
import { ParamsHint, ParamsSection } from './ParamsShared'

const MAX_SEED = 4294967295

export function ParamsSizeSeed({ id }: { id?: string }) {
    const { t } = useTranslation()
    const selectedResolution = useGenerationStore((s) => s.selectedResolution)
    const setSelectedResolution = useGenerationStore((s) => s.setSelectedResolution)
    const isGenerating = useGenerationStore((s) => s.isGenerating)
    const seed = useGenerationStore((s) => s.seed)
    const setSeed = useGenerationStore((s) => s.setSeed)
    const seedLocked = useGenerationStore((s) => s.seedLocked)
    const setSeedLocked = useGenerationStore((s) => s.setSeedLocked)

    return (
        <ParamsSection
            id={id}
            icon={<Maximize2 className="h-4 w-4" />}
            title={t('comfy.params.sizeTitle', '크기 · 시드')}
        >
            <div className="space-y-2">
                <Label className="text-sm">{t('settingsPage.general.resolution', '해상도')}</Label>
                <ResolutionSelector
                    value={selectedResolution}
                    onChange={setSelectedResolution}
                    disabled={isGenerating}
                />
                <ParamsHint>
                    {t('comfy.params.resolutionHint', 'SDXL 계열은 832×1216 처럼 약 100만 화소, SD1.5 계열은 512×768 정도가 가장 잘 나옵니다. 더 크게 하려면 아래 [고화질]을 쓰세요.')}
                </ParamsHint>
            </div>

            <div className="space-y-2">
                <Label className="text-sm">{t('settings.seed', '시드')}</Label>
                <div className="flex gap-2">
                    <Input
                        type="number"
                        min={0}
                        max={MAX_SEED}
                        value={seed}
                        onChange={(e) => {
                            const n = Math.floor(Number(e.target.value))
                            setSeed(Number.isFinite(n) ? Math.min(MAX_SEED, Math.max(0, n)) : 0)
                        }}
                        disabled={seedLocked}
                        className="flex-1 h-9 text-xs rounded-xl"
                    />
                    <Tip content={seedLocked ? t('comfy.params.seedUnlock', '고정 풀기 (그림마다 새 시드)') : t('comfy.params.seedLock', '이 시드로 고정')}>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className={cn('h-9 w-9 rounded-xl shrink-0', seedLocked && 'border-primary text-primary bg-primary/10')}
                            onClick={() => setSeedLocked(!seedLocked)}
                        >
                            {seedLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                        </Button>
                    </Tip>
                    <Tip content={t('comfy.params.seedRandom', '새 시드 뽑기')}>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl shrink-0"
                            onClick={() => { if (!seedLocked) setSeed(generateRandomSeed()) }}
                            disabled={seedLocked}
                        >
                            <Dice5 className="h-3.5 w-3.5" />
                        </Button>
                    </Tip>
                </div>
                <ParamsHint>
                    {t(
                        'comfy.params.seedHint',
                        '시드는 그림마다 저절로 바뀝니다. 똑같은 그림을 다시 뽑을 때만 자물쇠로 고정하세요. 고화질로 다시 그리기에는 시드 고정이 필요 없습니다.'
                    )}
                </ParamsHint>
            </div>
        </ParamsSection>
    )
}
