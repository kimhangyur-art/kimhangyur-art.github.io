// 설정 → ComfyUI
//   연결(주소·상태·목록 개수), 저장 방식, NAI 문법 변환, 품질 태그·부정 프롬프트 직접 쓰기,
//   '고화질로 다시 그리기' 기본값, ComfyUI 켜는 법 도움말
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
    AlertTriangle,
    Braces,
    FolderOutput,
    HelpCircle,
    Loader2,
    PlugZap,
    RotateCcw,
    Server,
    Sparkles,
    Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { useComfyStore } from '@/stores/comfy-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'
import { getFamily } from '@/services/comfy/families'
import { cn } from '@/lib/utils'
import { OptionSelect, SliderNumber, useComfyAutoRefresh, type OptionItem } from './ParamsShared'
import { useComfyDisplayStatus } from './ComfyStatusPill'

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

// 설정 저장소의 처음 값과 같다 (settings-store.ts)
const UPSCALE_DEFAULTS = { upscaleScale: 1.5, upscaleDenoise: 0.4, upscaleMethod: 'pixel' as const, upscaleModel: '' }

/** "127.0.0.1:8188/" → "http://127.0.0.1:8188" */
export function normalizeComfyUrl(input: string): string {
    let v = input.trim()
    if (!v) return ''
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`
    return v.replace(/\/+$/, '')
}

function StatBox({ label, count, muted }: { label: string; count: number; muted?: boolean }) {
    const { t } = useTranslation()
    return (
        <div className={cn('flex flex-col justify-between gap-1 rounded-lg border border-border/40 bg-muted/20 px-3 py-2', muted && 'opacity-60')}>
            <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums">
                {t('comfy.settings.countUnit', '{{count}}개', { count })}
            </div>
        </div>
    )
}

function SettingRow({ icon, title, description, control }: { icon: ReactNode; title: ReactNode; description: ReactNode; control: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
                <label className="text-sm font-medium flex items-center gap-2">
                    {icon}
                    {title}
                </label>
                <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
            </div>
            <div className="shrink-0 pt-0.5">{control}</div>
        </div>
    )
}

function Code({ children }: { children: ReactNode }) {
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>
}

export function ComfySettingsSection() {
    const { t } = useTranslation()

    // ComfyUI 연결
    const url = useComfyStore((s) => s.url)
    const rawStatus = useComfyStore((s) => s.status)
    const version = useComfyStore((s) => s.version)
    const device = useComfyStore((s) => s.device)
    const error = useComfyStore((s) => s.error)
    const lists = useComfyStore((s) => s.lists)
    const listsFetchedAt = useComfyStore((s) => s.listsFetchedAt)
    const [localUrl, setLocalUrl] = useState(url)
    const [checking, setChecking] = useState(false)
    const status = useComfyDisplayStatus(checking)

    useEffect(() => {
        setLocalUrl(url)
    }, [url])

    // 이 화면을 열 때 꺼져 있었으면 한 번 더 확인한다 (그사이 ComfyUI를 켰을 수 있으므로)
    useComfyAutoRefresh(true)

    // 설정
    const comfyOutput = useSettingsStore((s) => s.comfyOutput)
    const setComfyOutput = useSettingsStore((s) => s.setComfyOutput)
    const naiSyntax = useSettingsStore((s) => s.naiSyntax)
    const setNaiSyntax = useSettingsStore((s) => s.setNaiSyntax)
    const qualityTagsCustom = useSettingsStore((s) => s.qualityTagsCustom)
    const setQualityTagsCustom = useSettingsStore((s) => s.setQualityTagsCustom)
    const negativePresetCustom = useSettingsStore((s) => s.negativePresetCustom)
    const setNegativePresetCustom = useSettingsStore((s) => s.setNegativePresetCustom)
    const upscaleScale = useSettingsStore((s) => s.upscaleScale)
    const upscaleDenoise = useSettingsStore((s) => s.upscaleDenoise)
    const upscaleMethod = useSettingsStore((s) => s.upscaleMethod)
    const upscaleModel = useSettingsStore((s) => s.upscaleModel)
    const setUpscaleDefaults = useSettingsStore((s) => s.setUpscaleDefaults)

    // 지금 고른 체크포인트의 계열 (품질 태그·부정 프롬프트 권장값을 보여 주려고)
    const model = useGenerationStore((s) => s.model)
    const modelFamily = useGenerationStore((s) => s.modelFamily)
    const family = getFamily(modelFamily, model)

    const normalizedLocal = normalizeComfyUrl(localUrl)
    const urlChanged = normalizedLocal !== '' && normalizedLocal !== url

    const handleCheck = async () => {
        const next = normalizedLocal || DEFAULT_COMFY_URL
        setChecking(true)
        try {
            const store = useComfyStore.getState()
            if (next !== store.url) {
                await store.setUrl(next) // 주소를 저장하고 바로 다시 확인한다
            } else {
                await store.refresh()
            }
            const s = useComfyStore.getState()
            if (s.status === 'online') {
                toast({
                    title: t('comfy.settings.connected', 'ComfyUI와 연결되었습니다'),
                    description: t('comfy.settings.connectedDesc', '체크포인트 {{ckpt}}개 · LoRA {{lora}}개를 불러왔습니다', {
                        ckpt: s.lists.checkpoints.length,
                        lora: s.lists.loras.length,
                    }),
                    variant: 'success',
                })
            } else {
                toast({
                    title: t('comfy.settings.notConnected', 'ComfyUI에 연결하지 못했습니다'),
                    description: s.error || t('comfy.settings.notConnectedDesc', 'ComfyUI가 켜져 있는지, 주소가 맞는지 확인하세요.'),
                    variant: 'destructive',
                })
            }
        } catch (e) {
            toast({
                title: t('comfy.settings.urlSaveFailed', '주소를 바꾸지 못했습니다'),
                description: (e as Error).message,
                variant: 'destructive',
            })
        } finally {
            setChecking(false)
        }
    }

    const methodOptions: OptionItem[] = [
        { value: 'pixel', label: t('comfy.settings.upscalePixel', '그대로 키운 뒤 다듬기 (pixel)') },
    ]
    if (lists.upscaleModels.length > 0 || upscaleMethod === 'model') {
        methodOptions.push({ value: 'model', label: t('comfy.settings.upscaleModelMethod', '업스케일 모델로 키운 뒤 다듬기') })
    }

    const statusDot = status === 'online' ? 'bg-emerald-500' : status === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
    const statusText = status === 'online'
        ? t('comfy.status.online', 'ComfyUI 연결됨')
        : status === 'checking'
            ? t('comfy.status.checking', 'ComfyUI 확인 중')
            : t('comfy.status.offline', 'ComfyUI 꺼짐')

    return (
        <section className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold">{t('settingsPage.sections.comfy', 'ComfyUI')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    {t('comfy.settings.description', '이 앱은 내 컴퓨터에서 켜 둔 ComfyUI에게 그림을 그려 달라고 부탁합니다. 여기서 ComfyUI 주소와 그리는 방식을 정합니다.')}
                </p>
            </div>

            {/* 연결 */}
            <div className="border border-border/50 rounded-xl p-6 space-y-5 bg-card/30">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium flex items-center gap-2">
                            <Server className="h-4 w-4 text-muted-foreground" />
                            {t('comfy.settings.address', 'ComfyUI 주소')}
                        </label>
                        {url !== DEFAULT_COMFY_URL && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => setLocalUrl(DEFAULT_COMFY_URL)}
                            >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                {t('comfy.settings.resetAddress', '기본 주소로')}
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Input
                            value={localUrl}
                            onChange={(e) => setLocalUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void handleCheck()
                                }
                            }}
                            placeholder={DEFAULT_COMFY_URL}
                            spellCheck={false}
                            className="flex-1 min-w-[220px] font-mono"
                        />
                        <Button
                            onClick={() => { void handleCheck() }}
                            disabled={checking || rawStatus === 'checking'}
                            className={cn(urlChanged && 'bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-500/50')}
                        >
                            {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
                            {urlChanged ? t('comfy.settings.saveAndCheck', '저장하고 연결 확인') : t('comfy.settings.check', '연결 확인')}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('comfy.settings.addressHelp', '보통은 그대로 두면 됩니다 (http://127.0.0.1:8188). ComfyUI를 다른 포트로 켰거나(--port) 다른 컴퓨터에서 켰을 때만 바꾸세요.')}
                    </p>
                </div>

                {/* 상태 */}
                <div className="pt-4 border-t border-border/30 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                            <span className={cn('h-2 w-2 rounded-full', statusDot)} />
                            {statusText}
                        </span>
                        {status === 'online' && version && (
                            <span className="text-xs text-muted-foreground">
                                {t('comfy.status.version', '버전')} {version}
                            </span>
                        )}
                        {status === 'online' && device && (
                            <span className="text-xs text-muted-foreground truncate max-w-full">
                                {t('comfy.status.device', '그래픽카드')}: {device}
                            </span>
                        )}
                    </div>
                    {status === 'offline' && (
                        <p className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 leading-relaxed">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                                {t('comfy.status.howToStart', 'ComfyUI를 먼저 켜세요 (포터블: run_nvidia_gpu.bat). 기본 주소는 http://127.0.0.1:8188 이고, 다르면 설정 → ComfyUI에서 바꿉니다')}
                                {error && <span className="block mt-1 opacity-80 break-words">{error}</span>}
                            </span>
                        </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                        <StatBox label={t('comfy.settings.checkpoints', '체크포인트')} count={lists.checkpoints.length} muted={status !== 'online'} />
                        <StatBox label={t('comfy.settings.loras', '로라')} count={lists.loras.length} muted={status !== 'online'} />
                        <StatBox label={t('comfy.settings.upscaleModels', '업스케일 모델')} count={lists.upscaleModels.length} muted={status !== 'online'} />
                    </div>
                    {status !== 'online' && listsFetchedAt && (
                        <p className="text-xs text-muted-foreground">
                            {t('comfy.settings.cachedLists', '지금은 연결되지 않아, 마지막으로 받아 둔 목록({{time}})을 보여 줍니다.', {
                                time: new Date(listsFetchedAt).toLocaleString(),
                            })}
                        </p>
                    )}
                    {status === 'online' && lists.checkpoints.length === 0 && (
                        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                            {t('comfy.status.noCheckpoints', '체크포인트가 하나도 없습니다. ComfyUI 폴더의 models/checkpoints 에 모델 파일을 넣고 [다시 확인]을 누르세요.')}
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {t('comfy.settings.listsHelp', '모델·LoRA 파일을 ComfyUI 폴더에 새로 넣었다면 [연결 확인]을 누르면 목록에 나타납니다.')}
                    </p>
                </div>
            </div>

            {/* 그리는 방식 */}
            <div className="border border-border/50 rounded-xl p-6 space-y-5 bg-card/30">
                <SettingRow
                    icon={<FolderOutput className="h-4 w-4 text-blue-500" />}
                    title={t('comfy.settings.saveToComfy', 'ComfyUI output 폴더에도 저장')}
                    description={t(
                        'comfy.settings.saveToComfyHelp',
                        '꺼 두면(기본) 그림은 이 앱의 저장 폴더(설정 → 저장)에만 남습니다. 켜면 ComfyUI 폴더의 output 에도 같은 그림이 한 장 더 저장됩니다 (디스크를 두 배로 씁니다).',
                    )}
                    control={
                        <Switch
                            checked={comfyOutput === 'save'}
                            onChange={(e) => setComfyOutput(e.target.checked ? 'save' : 'preview')}
                        />
                    }
                />
                <div className="pt-4 border-t border-border/30">
                    <SettingRow
                        icon={<Braces className="h-4 w-4 text-violet-500" />}
                        title={t('comfy.settings.naiSyntax', 'NAI 문법 자동 변환')}
                        description={
                            <>
                                {t('comfy.settings.naiSyntaxHelp', 'NovelAI 식으로 쓴 강조를 ComfyUI가 알아듣는 글로 바꿔서 보냅니다. NAIS2에서 쓰던 프롬프트를 그대로 쓰려면 켜 두세요.')}
                                <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                                    <span><Code>{'{태그}'}</Code> = {t('comfy.settings.syntaxStronger', '1.05배')}</span>
                                    <span><Code>[태그]</Code> = {t('comfy.settings.syntaxWeaker', '약하게')}</span>
                                    <span><Code>1.2::태그::</Code> = {t('comfy.settings.syntaxNumeric', '1.2배')}</span>
                                    <span><Code>(태그)</Code> = {t('comfy.settings.syntaxLiteral', '괄호 글자 그대로')}</span>
                                </span>
                                <span className="mt-1 block">
                                    {t('comfy.settings.naiSyntaxMixed', 'ComfyUI 식 (태그:1.2) 도 그대로 쓸 수 있습니다. 끄면 쓴 글을 바꾸지 않고 보냅니다.')}
                                </span>
                            </>
                        }
                        control={
                            <Switch
                                checked={naiSyntax}
                                onChange={(e) => setNaiSyntax(e.target.checked)}
                            />
                        }
                    />
                </div>
            </div>

            {/* 품질 태그 · 부정 프롬프트 */}
            <div className="border border-border/50 rounded-xl p-6 space-y-5 bg-card/30">
                <div className="space-y-1">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                        <Wand2 className="h-4 w-4 text-amber-500" />
                        {t('comfy.settings.presetsTitle', '품질 태그 · 부정 프롬프트 직접 정하기')}
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t(
                            'comfy.settings.presetsHelp',
                            '비워 두면 지금 체크포인트 계열에 맞는 권장값(칸 안의 흐린 글)을 씁니다. 지금 계열: {{family}}. 체크포인트를 바꾸면 권장값도 따라 바뀝니다.',
                            { family: family.label },
                        )}
                    </p>
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm">{t('comfy.settings.qualityTags', '품질 태그')}</Label>
                        {qualityTagsCustom && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setQualityTagsCustom('')}>
                                <RotateCcw className="h-3 w-3 mr-1" />
                                {t('comfy.settings.useRecommended', '권장값 쓰기')}
                            </Button>
                        )}
                    </div>
                    <Textarea
                        value={qualityTagsCustom}
                        onChange={(e) => setQualityTagsCustom(e.target.value)}
                        placeholder={family.qualityTags}
                        rows={3}
                        spellCheck={false}
                        className="text-xs font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('comfy.settings.qualityTagsHelp', '프롬프트 칸의 [품질 태그 추가]를 켰을 때 프롬프트에 붙는 글입니다.')}
                    </p>
                </div>
                <div className="space-y-2 pt-4 border-t border-border/30">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm">{t('comfy.settings.negativePreset', '기본 부정 프롬프트')}</Label>
                        {negativePresetCustom && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setNegativePresetCustom('')}>
                                <RotateCcw className="h-3 w-3 mr-1" />
                                {t('comfy.settings.useRecommended', '권장값 쓰기')}
                            </Button>
                        )}
                    </div>
                    <Textarea
                        value={negativePresetCustom}
                        onChange={(e) => setNegativePresetCustom(e.target.value)}
                        placeholder={family.negativeHeavy}
                        rows={4}
                        spellCheck={false}
                        className="text-xs font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('comfy.settings.negativePresetHelp', '[UC 프리셋]이 \'없음\'이 아닐 때 부정 프롬프트 앞에 붙는 글입니다. 여기에 쓰면 \'강하게\'·\'가볍게\' 모두 이 글로 바뀝니다.')}
                    </p>
                </div>
            </div>

            {/* 고화질로 다시 그리기 기본값 */}
            <div className="border border-border/50 rounded-xl p-6 space-y-5 bg-card/30">
                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-violet-500" />
                            {t('comfy.settings.upscaleTitle', "'고화질로 다시 그리기' 기본값")}
                        </h4>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs shrink-0"
                            onClick={() => setUpscaleDefaults(UPSCALE_DEFAULTS)}
                        >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            {t('comfy.settings.resetDefaults', '기본값으로')}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t(
                            'comfy.settings.upscaleHelp',
                            '기록·라이브러리·씬 그림의 [고화질로 다시 그리기]에 쓰는 값입니다. 시드를 몰라도, 고정하지 않았어도 지금 그림을 바탕으로 더 크고 선명하게 다시 그려 원본 옆에 저장합니다.',
                        )}
                    </p>
                </div>
                <SliderNumber
                    label={t('comfy.settings.upscaleScale', '키우는 배율')}
                    value={upscaleScale}
                    onChange={(v) => setUpscaleDefaults({ upscaleScale: v })}
                    min={1.25}
                    max={2.5}
                    step={0.05}
                    hint={t('comfy.settings.upscaleScaleHint', '1.5면 가로·세로가 1.5배가 됩니다 (832×1216 → 1248×1824). 크게 할수록 오래 걸리고 그래픽 메모리를 더 씁니다.')}
                />
                <SliderNumber
                    label={t('comfy.settings.upscaleDenoise', '다듬는 정도 (denoise)')}
                    value={upscaleDenoise}
                    onChange={(v) => setUpscaleDefaults({ upscaleDenoise: v })}
                    min={0.2}
                    max={0.7}
                    step={0.05}
                    hint={t('comfy.settings.upscaleDenoiseHint', '낮으면 원래 그림 그대로 선명하게만, 높으면 세부를 새로 그립니다 (얼굴·손이 바뀔 수 있음). 보통 0.3~0.45')}
                />
                <div className="space-y-2">
                    <Label className="text-sm">{t('comfy.settings.upscaleMethod', '키우는 방식')}</Label>
                    <OptionSelect
                        value={upscaleMethod}
                        options={methodOptions}
                        onChange={(v) => setUpscaleDefaults({ upscaleMethod: v === 'model' ? 'model' : 'pixel' })}
                    />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {upscaleMethod === 'model'
                            ? t('comfy.settings.upscaleModelHint', '4x-UltraSharp 같은 업스케일 모델로 키운 뒤 다듬습니다. 가장 선명하지만 조금 느립니다.')
                            : t('comfy.settings.upscalePixelHint', '그림을 그대로 키운 뒤 다듬습니다. 따로 받을 파일이 없고, 원래 그림과 가장 비슷하게 나옵니다.')}
                        {lists.upscaleModels.length === 0 && upscaleMethod !== 'model' && (
                            <> {t('comfy.settings.noUpscaleModelsHint', '(업스케일 모델 파일을 ComfyUI의 models/upscale_models 에 넣으면 그 방식도 고를 수 있습니다)')}</>
                        )}
                    </p>
                </div>
                {upscaleMethod === 'model' && (
                    <div className="space-y-2">
                        <Label className="text-sm">{t('comfy.settings.upscaleModel', '업스케일 모델')}</Label>
                        <OptionSelect
                            value={upscaleModel}
                            options={lists.upscaleModels}
                            onChange={(v) => setUpscaleDefaults({ upscaleModel: v })}
                            placeholder={t('comfy.settings.pickUpscaleModel', '업스케일 모델을 고르세요')}
                        />
                        {lists.upscaleModels.length === 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                {t('comfy.settings.noUpscaleModels', 'ComfyUI에 업스케일 모델이 없습니다. models/upscale_models 에 넣거나 [그대로 키운 뒤 다듬기]를 고르세요.')}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* 도움말 */}
            <div className="border border-blue-500/30 rounded-xl p-5 bg-blue-500/5 space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <HelpCircle className="h-4 w-4" />
                    {t('comfy.settings.helpTitle', 'ComfyUI 켜는 법')}
                </h4>
                <ol className="list-decimal pl-5 space-y-2 text-xs leading-relaxed">
                    <li>
                        {t('comfy.settings.help1', 'ComfyUI 포터블 폴더에서 run_nvidia_gpu.bat 을 두 번 눌러 켭니다 (NVIDIA 그래픽카드가 없으면 run_cpu.bat). 검은 창에 "To see the GUI go to: http://127.0.0.1:8188" 이 나오면 준비된 것입니다. 이 창은 그림을 그리는 동안 닫지 마세요.')}
                    </li>
                    <li>
                        {t('comfy.settings.help2', 'ComfyUI 데스크톱 앱을 쓴다면 앱을 켜 두기만 하면 됩니다. 주소가 http://127.0.0.1:8000 처럼 다르면 위 주소 칸에 그대로 적고 [연결 확인]을 누르세요.')}
                    </li>
                    <li>
                        {t('comfy.settings.help3', 'CORS 설정은 필요 없습니다. 이 앱은 자기 exe를 거쳐 ComfyUI와 이야기하므로 --enable-cors-header 를 붙이지 않아도 됩니다.')}
                    </li>
                    <li>
                        {t('comfy.settings.help4', '그리는 도중의 그림(실시간 미리보기)을 보려면 ComfyUI를 --preview-method auto 를 붙여 켜야 합니다. run_nvidia_gpu.bat 을 메모장으로 열어 python 으로 시작하는 줄 맨 끝에 한 칸 띄우고 --preview-method auto 를 덧붙인 뒤 저장하고, ComfyUI를 다시 켜세요.')}
                    </li>
                </ol>
            </div>
        </section>
    )
}
