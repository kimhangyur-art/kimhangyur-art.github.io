// 생성 설정: 고화질 (hires fix) — 그릴 때마다 한 번 더 크게 다듬기
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useGenerationStore, type HiresSettings } from '@/stores/generation-store'
import { useComfyStore } from '@/stores/comfy-store'
import { roundTo8 } from '@/services/comfy/workflow'
import { OptionSelect, ParamsHint, ParamsSection, SliderNumber, type OptionItem } from './ParamsShared'

export function ParamsHires({ id }: { id?: string }) {
    const { t } = useTranslation()
    const hires = useGenerationStore((s) => s.hires)
    const setHires = useGenerationStore((s) => s.setHires)
    const resolution = useGenerationStore((s) => s.selectedResolution)
    const upscaleModels = useComfyStore((s) => s.lists.upscaleModels)

    const methodOptions: OptionItem[] = [
        { value: 'latent', label: t('comfy.hires.methodLatent', '빠름 (latent)') },
        { value: 'pixel', label: t('comfy.hires.methodPixel', '깔끔 (pixel)') },
    ]
    // 업스케일 모델이 있을 때만 보인다. 이미 골라 둔 값이면 목록이 비어도 남겨 둔다
    if (upscaleModels.length > 0 || hires.method === 'model') {
        methodOptions.push({ value: 'model', label: t('comfy.hires.methodModel', '업스케일 모델') })
    }

    // services/comfy/workflow.ts 와 같은 방식으로 완성 크기를 계산한다
    const baseW = roundTo8(resolution.width)
    const baseH = roundTo8(resolution.height)
    const outW = hires.method === 'latent' ? roundTo8(Math.round((baseW / 8) * hires.scale) * 8) : roundTo8(baseW * hires.scale)
    const outH = hires.method === 'latent' ? roundTo8(Math.round((baseH / 8) * hires.scale) * 8) : roundTo8(baseH * hires.scale)

    return (
        <ParamsSection
            id={id}
            icon={<Sparkles className="h-4 w-4" />}
            title={t('comfy.hires.title', '고화질 (hires fix)')}
            description={t(
                'comfy.hires.desc',
                '켜면 그릴 때마다 한 번 더 크게 다듬어서 시간이 1.5~3배 걸립니다. 평소엔 끄고, 마음에 드는 그림만 오른쪽 기록에서 [고화질로 다시 그리기]를 해도 됩니다 (시드 고정 필요 없음).'
            )}
            action={
                <Switch
                    checked={hires.enabled}
                    onChange={(e) => setHires({ enabled: e.target.checked })}
                    aria-label={t('comfy.hires.enable', '고화질 켜기')}
                />
            }
        >
            {hires.enabled && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className="text-sm">{t('comfy.hires.method', '키우는 방식')}</Label>
                        <OptionSelect
                            value={hires.method}
                            options={methodOptions}
                            onChange={(v) => setHires({ method: v as HiresSettings['method'] })}
                        />
                        <ParamsHint>
                            {hires.method === 'latent'
                                ? t('comfy.hires.latentHint', '가장 빠릅니다. 세부가 조금 바뀔 수 있어 다듬는 정도를 0.5 안팎으로 두세요.')
                                : hires.method === 'pixel'
                                    ? t('comfy.hires.pixelHint', '그림을 그대로 키운 뒤 다듬습니다. 원래 그림과 가장 비슷하게 나옵니다.')
                                    : t('comfy.hires.modelHint', '4x-UltraSharp 같은 업스케일 모델로 키운 뒤 다듬습니다. 가장 선명하지만 조금 느립니다.')}
                        </ParamsHint>
                    </div>
                    {hires.method === 'model' && (
                        <div className="space-y-2">
                            <Label className="text-sm">{t('comfy.hires.upscaleModel', '업스케일 모델')}</Label>
                            <OptionSelect
                                value={hires.upscaleModel}
                                options={upscaleModels}
                                onChange={(v) => setHires({ upscaleModel: v })}
                                placeholder={t('comfy.hires.pickUpscaleModel', '업스케일 모델을 고르세요')}
                            />
                            {upscaleModels.length === 0 && (
                                <ParamsHint className="text-amber-600 dark:text-amber-400">
                                    {t('comfy.hires.noUpscaleModels', 'ComfyUI에 업스케일 모델이 없습니다. models/upscale_models 에 넣거나 다른 방식을 고르세요.')}
                                </ParamsHint>
                            )}
                        </div>
                    )}
                    <SliderNumber
                        label={t('comfy.hires.scale', '키우는 배율')}
                        value={hires.scale}
                        onChange={(v) => setHires({ scale: v })}
                        min={1.25}
                        max={2.5}
                        step={0.05}
                        hint={t('comfy.hires.scaleHint', '완성 크기: {{w}} × {{h}}. 크게 할수록 오래 걸리고 그래픽 메모리를 더 씁니다.', { w: outW, h: outH })}
                    />
                    <SliderNumber
                        label={t('comfy.hires.denoise', '다듬는 정도 (denoise)')}
                        value={hires.denoise}
                        onChange={(v) => setHires({ denoise: v })}
                        min={0.2}
                        max={0.7}
                        step={0.05}
                        hint={t('comfy.hires.denoiseHint', '낮으면 원래 그림 그대로 선명하게만, 높으면 세부를 새로 그립니다. 보통 0.35~0.5')}
                    />
                    <SliderNumber
                        label={t('comfy.hires.steps', '다듬는 스텝')}
                        value={hires.steps}
                        onChange={(v) => setHires({ steps: Math.round(v) })}
                        min={5}
                        max={40}
                        step={1}
                        hint={t('comfy.hires.stepsHint', '보통 15면 충분합니다.')}
                    />
                </div>
            )}
        </ParamsSection>
    )
}
