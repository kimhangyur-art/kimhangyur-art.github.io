// 변형 모드 위 카드: 바꿔 볼 변수, 그리는 방식, 장수·시드, 묶음 이름, 시작/멈추기, 진행 상황
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Dices, HelpCircle, ListPlus, Minus, Play, Plus, Shuffle, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/use-toast'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
    CONFIRM_OVER,
    MAX_PER_VARIANT,
    MAX_VARIANT_ROWS,
    MIN_PER_VARIANT,
    VARIABLE_TEMPLATES,
    activeVariables,
    defaultRunName,
    missingFinds,
    variantLabel,
    type VariationMode,
} from '@/lib/variation'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { characterTextsOf, computePlan, mergedPromptOf, useVariationLive, useVariationStore } from '@/stores/variation-store'
import { PromptPreview, type PreviewBlock } from './PromptPreview'
import { VariableCard } from './VariableCard'

const MODES: Array<{ id: VariationMode; labelKey: string; label: string; descKey: string; desc: string }> = [
    {
        id: 'each',
        labelKey: 'comfy.variation.modeEach',
        label: '하나씩 바꾸기',
        descKey: 'comfy.variation.modeEachDesc',
        desc: '변수 하나만 바꾸고 나머지는 그대로 둡니다. 후보 하나가 한 줄이 됩니다. (처음이라면 이것을 추천합니다)',
    },
    {
        id: 'all',
        labelKey: 'comfy.variation.modeAll',
        label: '모든 조합',
        descKey: 'comfy.variation.modeAllDesc',
        desc: '모든 변수의 후보를 서로 섞어 가능한 조합을 전부 그립니다. 변수가 많으면 장수가 금방 늘어납니다.',
    },
    {
        id: 'random',
        labelKey: 'comfy.variation.modeRandom',
        label: '무작위 N개',
        descKey: 'comfy.variation.modeRandomDesc',
        desc: '가능한 조합 가운데 서로 다른 N개만 골라 그립니다. 아래 미리보기에 보이는 조합 그대로 그립니다.',
    },
]

/** 숫자 칸: 입력하는 동안은 그대로 두고, 칸을 벗어나거나 Enter 를 누르면 적용 */
function NumberField({ value, min, max, onCommit, className, disabled }: { value: number; min: number; max: number; onCommit: (n: number) => void; className?: string; disabled?: boolean }) {
    const [text, setText] = useState(String(value))
    useEffect(() => setText(String(value)), [value])
    const commit = () => {
        const n = Number(text)
        if (!text.trim() || !Number.isFinite(n)) {
            setText(String(value))
            return
        }
        onCommit(Math.max(min, Math.min(max, Math.round(n))))
    }
    return (
        <Input
            type="number"
            min={min}
            max={max}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
            }}
            className={cn('h-8 text-center', className)}
            disabled={disabled}
        />
    )
}

export function VariationSetupCard() {
    const { t } = useTranslation()

    const variables = useVariationStore((s) => s.variables)
    const mode = useVariationStore((s) => s.mode)
    const perVariant = useVariationStore((s) => s.perVariant)
    const randomCount = useVariationStore((s) => s.randomCount)
    const includeBase = useVariationStore((s) => s.includeBase)
    const sameSeed = useVariationStore((s) => s.sameSeed)
    const pickSeed = useVariationStore((s) => s.pickSeed)
    const runName = useVariationStore((s) => s.runName)
    const isRunning = useVariationStore((s) => s.isRunning)
    const isCancelling = useVariationStore((s) => s.isCancelling)
    const totalJobs = useVariationStore((s) => s.totalJobs)
    const doneJobs = useVariationStore((s) => s.doneJobs)
    const store = useVariationStore.getState()

    const liveProgress = useVariationLive((s) => s.progress)

    // 프롬프트가 바뀌면 다시 계산한다
    const basePrompt = useGenerationStore((s) => s.basePrompt)
    const additionalPrompt = useGenerationStore((s) => s.additionalPrompt)
    const detailPrompt = useGenerationStore((s) => s.detailPrompt)
    const characters = useCharacterPromptStore((s) => s.characters)
    const generatingMode = useGenerationStore((s) => s.generatingMode)
    const mainGenerating = useGenerationStore((s) => s.isGenerating)

    const merged = useMemo(() => mergedPromptOf(basePrompt, additionalPrompt, detailPrompt), [basePrompt, additionalPrompt, detailPrompt])
    const charTexts = useMemo(() => characterTextsOf(characters), [characters])
    const searchText = useMemo(() => [merged, ...charTexts.map((c) => c.prompt)].join('\n'), [merged, charTexts])
    const blocks = useMemo<PreviewBlock[]>(() => [{ text: merged }, ...charTexts.map((c) => ({ label: c.label, text: c.prompt }))], [merged, charTexts])
    const finds = useMemo(() => activeVariables(variables).map((v) => v.find.trim()).filter(Boolean), [variables])

    const plan = useMemo(
        () => computePlan({ variables, mode, perVariant, randomCount, includeBase, pickSeed }, searchText),
        [variables, mode, perVariant, randomCount, includeBase, pickSeed, searchText],
    )
    const missing = useMemo(() => missingFinds(searchText, variables), [searchText, variables])
    const activeCount = activeVariables(variables).length

    const otherBusy = generatingMode === 'main' || generatingMode === 'scene' || mainGenerating
    const busyHint = otherBusy
        ? generatingMode === 'scene'
            ? t('comfy.generate.busyScene', '씬 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
            : t('comfy.generate.busyMain', '메인 화면에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
        : ''

    const addTemplate = (id: string) => {
        const r = store.addTemplate(id)
        if (!r) return
        const tpl = VARIABLE_TEMPLATES.find((x) => x.id === id)
        toast({
            title: t('comfy.variation.templateAdded', '"{{name}}" 변수를 추가했습니다', { name: tpl?.name ?? '' }),
            description: r.find
                ? t('comfy.variation.templateAddedFind', '프롬프트에 있던 "{{find}}"를 바꿀 글로 넣었습니다. 후보는 자유롭게 고치세요.', { find: r.find })
                : t('comfy.variation.templateAddedAppend', '프롬프트에 후보와 같은 글이 없어서, 후보를 프롬프트 끝에 붙여 그립니다. 바꿀 글이 따로 있으면 직접 적어 주세요.'),
        })
    }

    const onStartStop = () => {
        if (isRunning) store.cancel()
        else void store.start()
    }

    const modeInfo = MODES.find((m) => m.id === mode) ?? MODES[0]
    const overallPct = totalJobs > 0 ? Math.min(100, ((doneJobs + (isRunning ? liveProgress / 100 : 0)) / totalJobs) * 100) : 0
    const rowsPreview = plan.variants.slice(0, 60)

    return (
        <section className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
            {/* 제목과 도움말 */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-2xl font-bold">
                        <Shuffle className="h-6 w-6 text-sky-400" />
                        {t('comfy.variation.title', '변형 모드')}
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        {t('comfy.variation.help', '왼쪽 프롬프트는 그대로 두고, 아래에 바꿔 볼 요소와 후보를 적으면 후보마다 한 장씩(또는 여러 장) 이어서 그립니다. 같은 시드로 비교하면 프롬프트 차이만 보입니다.')}
                    </p>
                </div>
            </div>

            <div className="mt-4">
                <PromptPreview blocks={blocks} finds={finds} />
            </div>

            {/* 변수 목록 */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                    {t('comfy.variation.variablesTitle', '바꿔 볼 요소 (변수)')}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('comfy.variation.variablesSub', '켜 둔 변수 {{count}}개', { count: activeCount })}
                    </span>
                </h2>
                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" >
                                <Sparkles className="h-3.5 w-3.5" />
                                {t('comfy.variation.addTemplate', '자주 쓰는 변수 추가')}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                {t('comfy.variation.templateHint', '후보가 미리 채워진 변수를 추가합니다')}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {VARIABLE_TEMPLATES.map((tpl) => (
                                <DropdownMenuItem key={tpl.id} onSelect={() => addTemplate(tpl.id)} className="flex flex-col items-start gap-0.5">
                                    <span className="text-sm font-medium">{tpl.name}</span>
                                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{tpl.options.join(', ')}</span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => store.addVariable()} >
                        <Plus className="h-3.5 w-3.5" />
                        {t('comfy.variation.addVariable', '빈 변수 추가')}
                    </Button>
                </div>
            </div>

            <div className="mt-2 space-y-2">
                {variables.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                            {t('comfy.variation.emptyVars', '아직 변수가 없습니다. 아래에서 바꿔 볼 요소를 골라 보세요.')}
                        </p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                            {VARIABLE_TEMPLATES.map((tpl) => (
                                <Button key={tpl.id} variant="outline" size="sm" className="h-8 rounded-full" onClick={() => addTemplate(tpl.id)}>
                                    <Plus className="mr-1 h-3 w-3" />
                                    {tpl.name}
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : (
                    variables.map((v, i) => (
                        <VariableCard key={v.id} variable={v} index={i} count={variables.length} searchText={searchText} />
                    ))
                )}
            </div>

            {/* 그리는 방식 */}
            <div className="mt-4 grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 lg:grid-cols-2">
                <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">{t('comfy.variation.modeTitle', '그리는 방식')}</div>
                    <div className="flex rounded-lg border border-border/60 bg-background/50 p-0.5">
                        {MODES.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => store.setMode(m.id)}
                                className={cn(
                                    'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                                    mode === m.id ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                )}
                            >
                                {t(m.labelKey, m.label)}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t(modeInfo.descKey, modeInfo.desc)}</p>
                    {mode === 'random' && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs">{t('comfy.variation.randomCount', '고를 조합 수')}</span>
                            <NumberField value={randomCount} min={1} max={MAX_VARIANT_ROWS} onCommit={store.setRandomCount} className="w-20" />
                            <Tip content={t('comfy.variation.rerollTip', '다른 조합으로 다시 뽑습니다')}>
                                <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg" onClick={store.rerollPick} >
                                    <Dices className="h-3.5 w-3.5" />
                                    {t('comfy.variation.reroll', '다시 뽑기')}
                                </Button>
                            </Tip>
                            <span className="text-[11px] text-muted-foreground">{t('comfy.variation.comboTotal', '가능한 조합 {{count}}개', { count: plan.combos })}</span>
                        </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 pt-1">
                        <Switch checked={includeBase} onChange={(e) => store.setIncludeBase(e.target.checked)} />
                        <span className="text-xs">
                            {t('comfy.variation.includeBase', '기준 그림 포함')}
                            <span className="ml-1 text-muted-foreground">{t('comfy.variation.includeBaseDesc', '— 아무것도 바꾸지 않은 그림을 첫 줄에 넣어 비교합니다')}</span>
                        </span>
                    </label>
                </div>

                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="w-28 text-xs font-semibold text-muted-foreground">{t('comfy.variation.perVariant', '변형마다 장수')}</span>
                        <div className="flex items-center rounded-lg border border-border/60 bg-background/50">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => store.setPerVariant(perVariant - 1)} disabled={perVariant <= MIN_PER_VARIANT}>
                                <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-8 text-center text-sm font-semibold tabular-nums">{perVariant}</span>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => store.setPerVariant(perVariant + 1)} disabled={perVariant >= MAX_PER_VARIANT}>
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{t('comfy.variation.perVariantDesc', '한 줄에 몇 장씩 그릴지 (1~8)')}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="w-28 text-xs font-semibold text-muted-foreground">{t('comfy.variation.sameSeed', '같은 시드로 비교')}</span>
                        <Switch checked={sameSeed} onChange={(e) => store.setSameSeed(e.target.checked)} />
                        <Tip
                            side="bottom"
                            content={
                                <span className="block max-w-xs whitespace-normal leading-relaxed">
                                    {t('comfy.variation.sameSeedTip', '켜면: 시드(그림의 밑바탕이 되는 무작위 노이즈)를 장수만큼만 뽑아 모든 줄이 같이 씁니다. 같은 열끼리는 프롬프트만 다르니, 바꾼 요소의 차이만 보입니다. 끄면: 그림마다 새 시드를 써서 더 다양하게 나옵니다. 메인 화면의 시드 고정과는 상관없습니다.')}
                                </span>
                            }
                        >
                            <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
                        </Tip>
                        <span className="text-[11px] text-muted-foreground">
                            {sameSeed
                                ? t('comfy.variation.sameSeedOn', '같은 열은 같은 시드 → 프롬프트 차이만 보입니다')
                                : t('comfy.variation.sameSeedOff', '그림마다 새 시드')}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="w-28 text-xs font-semibold text-muted-foreground">{t('comfy.variation.runName', '묶음 이름')}</span>
                        <Input
                            value={runName}
                            onChange={(e) => store.setRunName(e.target.value)}
                            placeholder={defaultRunName(new Date())}
                            className="h-8 min-w-0 flex-1 text-sm"
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        {t('comfy.variation.runNameDesc', '사진 폴더 → NAIS_Variation → 묶음 이름 폴더에 저장합니다. 비워 두면 날짜와 시각으로 이름을 붙입니다.')}
                    </p>
                </div>
            </div>

            {/* 미리보기와 시작 */}
            <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="text-sm">
                        {plan.rows > 0 ? (
                            <>
                                {t('comfy.variation.planSummary', '{{rows}}줄 × {{per}}장 = ', { rows: plan.rows, per: perVariant })}
                                <span className="text-lg font-bold tabular-nums text-primary">{t('comfy.variation.planTotal', '총 {{count}}장', { count: plan.images })}</span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">
                                {activeCount === 0
                                    ? t('comfy.variation.planNoVars', '변수를 추가하고 후보를 적으면 몇 장을 그릴지 여기 나옵니다.')
                                    : t('comfy.variation.planNoChange', '바꿀 후보가 없습니다. 바꿀 글과 다른 후보를 적어 주세요.')}
                            </span>
                        )}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <Tip content={busyHint || (isRunning ? t('comfy.variation.stopTip', '지금 그리던 그림을 바로 멈춥니다. 남은 칸은 나중에 이어서 그릴 수 있습니다.') : t('comfy.variation.startTip', '왼쪽 아래 생성 버튼을 눌러도 됩니다'))}>
                            <span>
                                <Button
                                    variant={isRunning ? 'destructive' : 'generate'}
                                    className="h-10 min-w-[150px] rounded-xl font-semibold"
                                    onClick={onStartStop}
                                    disabled={isCancelling || (!isRunning && (plan.rows === 0 || otherBusy))}
                                >
                                    {isRunning ? (
                                        <>
                                            <Square className="mr-2 h-4 w-4" />
                                            {isCancelling ? t('common.cancelling', '취소 중...') : t('comfy.variation.stop', '멈추기 ({{done}}/{{total}})', { done: doneJobs, total: totalJobs })}
                                        </>
                                    ) : (
                                        <>
                                            <Play className="mr-2 h-4 w-4" />
                                            {t('comfy.variation.start', '변형 {{count}}장 생성', { count: plan.images })}
                                        </>
                                    )}
                                </Button>
                            </span>
                        </Tip>
                    </div>
                </div>

                {(isRunning || isCancelling) && totalJobs > 0 && (
                    <div className="mt-3">
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-primary transition-all duration-300" style={{ width: `${overallPct}%` }} />
                        </div>
                        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                            <span>{t('comfy.variation.progressText', '{{done}} / {{total}}장 · 지금 그리는 그림 {{pct}}%', { done: doneJobs, total: totalJobs, pct: Math.round(liveProgress) })}</span>
                            <span>{t('comfy.variation.progressHint', '다른 화면으로 가도 계속 그립니다')}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            {t('comfy.variation.runningNote', '위의 변수와 설정은 그리는 동안 고쳐도 다음 묶음에만 쓰입니다. 왼쪽 프롬프트를 고치면 남은 그림에도 바로 반영되니 주의하세요.')}
                        </p>
                    </div>
                )}

                {missing.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                            {missing.map((v) => (
                                <div key={v.id}>
                                    {v.name ? `${v.name}: ` : ''}
                                    {t('comfy.variation.findMissing', '프롬프트에서 "{{find}}"를 못 찾아 끝에 붙입니다', { find: v.find.trim() })}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {plan.truncated && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {t('comfy.variation.truncated', '조합이 {{combos}}개나 되어 앞에서부터 {{max}}줄만 그립니다. [무작위 N개]로 일부만 골라 보는 것을 권합니다.', { combos: plan.combos, max: MAX_VARIANT_ROWS })}
                    </div>
                )}
                {plan.images > CONFIRM_OVER && !isRunning && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        {t('comfy.variation.manyHint', '{{max}}장이 넘어서 시작할 때 한 번 더 물어봅니다.', { max: CONFIRM_OVER })}
                    </p>
                )}

                {rowsPreview.length > 0 && (
                    <div className="mt-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                            <ListPlus className="h-3.5 w-3.5" />
                            {t('comfy.variation.rowsPreview', '이렇게 그립니다 (한 줄에 {{per}}장씩)', { per: perVariant })}
                        </div>
                        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                            {rowsPreview.map((v) => (
                                <span
                                    key={v.key || 'base'}
                                    className={cn(
                                        'rounded-full border px-2 py-0.5 text-[11px]',
                                        v.isBase ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 bg-muted/40',
                                    )}
                                >
                                    {variantLabel(v)}
                                </span>
                            ))}
                            {plan.variants.length > rowsPreview.length && (
                                <span className="px-1 text-[11px] text-muted-foreground">
                                    {t('comfy.variation.rowsMore', '외 {{count}}줄', { count: plan.variants.length - rowsPreview.length })}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}
