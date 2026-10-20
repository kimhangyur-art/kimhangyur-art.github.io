import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FragmentPromptDialog } from '@/components/fragments/FragmentPromptDialog'
import { CharacterPromptPanel } from '@/components/character/CharacterPromptPanel'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import Counter from '@/components/ui/counter'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import {
    ImagePlus,
    SlidersHorizontal,
    Film,
    Puzzle,
    Users,
    Layers,
    Shuffle,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useVariationStore } from '@/stores/variation-store'
import { ParamsPanel } from '@/components/comfy/ParamsPanel'
import { LoraDialog, useEnabledLoraCount } from '@/components/comfy/LoraDialog'

type PanelMode = 'main' | 'scene' | 'variation'

const Spinner = () => (
    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
)

export function PromptPanel() {
    const { t } = useTranslation()
    const location = useLocation()
    const navigate = useNavigate()
    const isSceneMode = location.pathname.startsWith('/scenes')
    const isVariationMode = location.pathname.startsWith('/variations')
    const mode: PanelMode = isSceneMode ? 'scene' : isVariationMode ? 'variation' : 'main'

    // Zustand 선택적 구독 - sceneStore
    const activePresetId = useSceneStore(state => state.activePresetId)
    const getTotalQueueCount = useSceneStore(state => state.getTotalQueueCount)
    const sceneIsGenerating = useSceneStore(state => state.isGenerating)
    const sceneIsCancelling = useSceneStore(state => state.isCancelling)
    const cancelSceneGeneration = useSceneStore(state => state.cancelSceneGeneration)
    const startNewGenerationSession = useSceneStore(state => state.startNewGenerationSession)
    const completedCount = useSceneStore(state => state.completedCount)
    const totalQueuedCount = useSceneStore(state => state.totalQueuedCount)

    const sceneQueueCount = activePresetId ? getTotalQueueCount(activePresetId) : 0

    // Zustand 선택적 구독 - variationStore (변형 모드)
    const variationRunning = useVariationStore(state => state.isRunning)
    const variationCancelling = useVariationStore(state => state.isCancelling)
    const variationPerVariant = useVariationStore(state => state.perVariant)
    const setVariationPerVariant = useVariationStore(state => state.setPerVariant)
    const variationTotal = useVariationStore(state => state.totalJobs)
    const variationDone = useVariationStore(state => state.doneJobs)
    const variationPlanned = useVariationStore(state => state.plannedCount())

    // Zustand 선택적 구독 - generationStore (상태)
    const basePrompt = useGenerationStore(state => state.basePrompt)
    const additionalPrompt = useGenerationStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationStore(state => state.detailPrompt)
    const negativePrompt = useGenerationStore(state => state.negativePrompt)
    const isGenerating = useGenerationStore(state => state.isGenerating)
    const isCancelled = useGenerationStore(state => state.isCancelled)
    const model = useGenerationStore(state => state.model)
    const batchCount = useGenerationStore(state => state.batchCount)
    const currentBatch = useGenerationStore(state => state.currentBatch)
    const generatingMode = useGenerationStore(state => state.generatingMode)

    // Zustand 선택적 구독 - generationStore (액션)
    const setBasePrompt = useGenerationStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationStore(state => state.setNegativePrompt)
    const setBatchCount = useGenerationStore(state => state.setBatchCount)
    const generate = useGenerationStore(state => state.generate)
    const cancelGeneration = useGenerationStore(state => state.cancelGeneration)

    // Zustand 선택적 구독 - settingsStore
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const basePromptCollapsed = useSettingsStore(state => state.basePromptCollapsed)
    const setBasePromptCollapsed = useSettingsStore(state => state.setBasePromptCollapsed)
    const additionalPromptCollapsed = useSettingsStore(state => state.additionalPromptCollapsed)
    const setAdditionalPromptCollapsed = useSettingsStore(state => state.setAdditionalPromptCollapsed)
    const detailPromptCollapsed = useSettingsStore(state => state.detailPromptCollapsed)
    const setDetailPromptCollapsed = useSettingsStore(state => state.setDetailPromptCollapsed)
    const negativePromptCollapsed = useSettingsStore(state => state.negativePromptCollapsed)
    const setNegativePromptCollapsed = useSettingsStore(state => state.setNegativePromptCollapsed)

    // Zustand 선택적 구독 - characterPromptStore
    const characterCount = useCharacterPromptStore(state => state.characters.filter(c => c.enabled).length)
    const loraCount = useEnabledLoraCount()

    const [fragmentDialogOpen, setFragmentDialogOpen] = useState(false)
    const [characterPanelOpen, setCharacterPanelOpen] = useState(false)
    const [loraDialogOpen, setLoraDialogOpen] = useState(false)
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false)

    // 전역 단축키 이벤트 수신
    // (예전 'AI 프롬프트 생성' 단축키는 변형 모드로, '이미지 참조' 단축키는 LoRA 창으로 바꿨다)
    useEffect(() => {
        const handleOpenVariations = () => navigate('/variations')
        const handleOpenFragment = () => setFragmentDialogOpen(prev => !prev)
        const handleOpenParameters = () => setParameterDialogOpen(prev => !prev)
        const handleOpenCharacterPrompt = () => setCharacterPanelOpen(prev => !prev)
        const handleOpenLora = () => setLoraDialogOpen(prev => !prev)

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenVariations)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenLora)

        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenVariations)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenLora)
        }
    }, [navigate])

    // 어느 모드가 돌고 있는지 (한 번에 한 모드만 ComfyUI에 일을 보낸다)
    const mainBusy = isGenerating || generatingMode === 'main'
    const sceneBusy = sceneIsGenerating || sceneIsCancelling || generatingMode === 'scene'
    const variationBusy = variationRunning || variationCancelling || generatingMode === 'variation'
    const isConflict =
        mode === 'main' ? (sceneBusy || variationBusy)
            : mode === 'scene' ? (mainBusy || variationBusy)
                : (mainBusy || sceneBusy)

    const handleGenerateOrCancel = useCallback(() => {
        if (isConflict) return // 다른 모드가 돌고 있으면 막는다

        if (mode === 'scene') {
            // Toggle scene generation: start new session or cancel
            if (sceneIsGenerating || sceneIsCancelling) {
                cancelSceneGeneration()  // Cancel - invalidates session but keeps button locked
            } else {
                startNewGenerationSession()  // Start - creates new session ID
            }
            return
        }

        if (mode === 'variation') {
            const vs = useVariationStore.getState()
            if (vs.isRunning || vs.isCancelling) {
                vs.cancel()
            } else {
                void vs.start()
            }
            return
        }

        if (isGenerating) {
            cancelGeneration()
        } else {
            generate()
        }
    }, [isConflict, mode, sceneIsGenerating, sceneIsCancelling, cancelSceneGeneration, startNewGenerationSession, isGenerating, cancelGeneration, generate])

    const isRunningHere =
        mode === 'scene' ? (sceneIsGenerating || sceneIsCancelling)
            : mode === 'variation' ? (variationRunning || variationCancelling)
                : isGenerating

    const isDisabled =
        isConflict ||
        (mode === 'scene' && (
            (sceneQueueCount === 0 && !sceneIsGenerating && !sceneIsCancelling) ||
            sceneIsCancelling  // 취소 후 지금 그리는 장이 끝날 때까지 잠근다
        )) ||
        (mode === 'variation' && (
            (variationPlanned === 0 && !variationRunning) ||
            variationCancelling
        )) ||
        (mode === 'main' && isGenerating && isCancelled)  // 취소 후 ComfyUI가 멈출 때까지 잠근다

    const conflictHint = isConflict
        ? (mainBusy
            ? t('comfy.generate.busyMain', '메인 화면에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
            : sceneBusy
                ? t('comfy.generate.busyScene', '씬 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
                : t('comfy.generate.busyVariation', '변형 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.'))
        : undefined

    const renderButtonLabel = () => {
        if (mode === 'scene') {
            if (sceneIsCancelling) return <><Spinner />{t('common.cancelling', '취소 중...')}</>
            if (sceneIsGenerating) {
                return <><Spinner />{t('common.cancel', '취소')} {totalQueuedCount > 0 && `(${completedCount + 1}/${totalQueuedCount})`}</>
            }
            return <><Film className="mr-2 h-5 w-5" />{t('scene.generateAll', '씬 생성')} {sceneQueueCount > 0 && `(${sceneQueueCount})`}</>
        }
        if (mode === 'variation') {
            if (variationCancelling) return <><Spinner />{t('common.cancelling', '취소 중...')}</>
            if (variationRunning) {
                return (
                    <>
                        <Spinner />
                        {t('comfy.variation.running', '생성 중')} {variationDone}/{variationTotal}
                        <span className="ml-1.5 text-sm font-normal opacity-80">· {t('common.cancel', '취소')}</span>
                    </>
                )
            }
            return (
                <>
                    <Shuffle className="mr-2 h-5 w-5" />
                    {t('comfy.variation.generate', '변형 {{count}}장 생성', { count: variationPlanned })}
                </>
            )
        }
        if (isGenerating && isCancelled) return <><Spinner />{t('common.cancelling', '취소 중...')}</>
        if (isGenerating) {
            return <><Spinner />{batchCount > 1 ? `${t('generate.cancel')} (${currentBatch}/${batchCount})` : t('generate.cancel')}</>
        }
        return <><ImagePlus className="mr-2 h-5 w-5" />{t('generate.button')}</>
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden p-2">
            {/* Prompt Inputs Area (Flex Grow, No Scroll on Container) - relative 컨테이너 */}
            <div className="flex-1 flex flex-col min-h-0 gap-2 mb-2 relative">
                {/* Character Prompt Panel (Accordion Style) - 프롬프트 영역 위에 오버레이 */}
                <CharacterPromptPanel
                    open={characterPanelOpen}
                    onOpenChange={setCharacterPanelOpen}
                />

                {/* Base Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    basePromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[30%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setBasePromptCollapsed(!basePromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {basePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.base')}
                        {basePromptCollapsed && basePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {basePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!basePromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.basePlaceholder')}
                            value={basePrompt}
                            onChange={(e) => setBasePrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>

                {/* Additional Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    additionalPromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[25%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setAdditionalPromptCollapsed(!additionalPromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {additionalPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.additional')}
                        {additionalPromptCollapsed && additionalPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {additionalPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!additionalPromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.additionalPlaceholder')}
                            value={additionalPrompt}
                            onChange={(e) => setAdditionalPrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>

                {/* Detail Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    detailPromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[25%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setDetailPromptCollapsed(!detailPromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {detailPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.detail')}
                        {detailPromptCollapsed && detailPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {detailPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!detailPromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.detailPlaceholder')}
                            value={detailPrompt}
                            onChange={(e) => setDetailPrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>

                {/* Negative Prompt - 20% (collapsible, collapses downward) */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    negativePromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[20%]"
                )}>
                    <button
                        type="button"
                        onClick={() => setNegativePromptCollapsed(!negativePromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-destructive/80 mb-1 hover:text-destructive cursor-pointer flex-shrink-0"
                    >
                        {negativePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.negative')}
                        {negativePromptCollapsed && negativePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {negativePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!negativePromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.negativePlaceholder')}
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl border-destructive/20"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>
            </div>

            {/* Quick Actions & Parameters Button */}
            <div className="flex gap-2 mb-3">
                {/* LoRA Button (예전 '이미지 참조' 자리) */}
                <Tip content={t('comfy.lora.buttonTip', 'LoRA 고르기·세기 조절')}>
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs rounded-xl h-9 relative"
                        onClick={() => setLoraDialogOpen(true)}
                    >
                        <Layers className="h-3.5 w-3.5 mr-1.5" />
                        {t('comfy.lora.button', 'LoRA')}
                        {loraCount > 0 && (
                            <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-md px-1 py-0.5 min-w-[16px] h-[16px] flex items-center justify-center shadow-sm">
                                {loraCount}
                            </div>
                        )}
                    </Button>
                </Tip>
                {/* Character Prompt Toggle Button */}
                <Button
                    variant={characterPanelOpen ? "default" : "outline"}
                    size="sm"
                    className={cn(
                        "flex-1 text-xs rounded-xl h-9 relative",
                        characterPanelOpen && "bg-primary text-primary-foreground"
                    )}
                    onClick={() => setCharacterPanelOpen(!characterPanelOpen)}
                >
                    <Users className="h-3.5 w-3.5 mr-1.5" />
                    {t('prompt.character', '캐릭터')}
                    {characterCount > 0 && (
                        <div className={cn(
                            "absolute -top-1 -right-1 text-[9px] font-bold rounded-md px-1 py-0.5 min-w-[16px] h-[16px] flex items-center justify-center shadow-sm",
                            characterPanelOpen
                                ? "bg-primary-foreground text-primary"
                                : "bg-primary text-primary-foreground"
                        )}>
                            {characterCount}
                        </div>
                    )}
                </Button>
                {/* Fragment Prompt Button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs rounded-xl h-9"
                    onClick={() => setFragmentDialogOpen(true)}
                >
                    <Puzzle className="h-3.5 w-3.5 mr-1.5" />
                    {t('prompt.fragment')}
                </Button>
                {/* Variation Mode Button (예전 Gemini 버튼 자리) */}
                <Tip content={t('comfy.variation.navTip', '변형 모드: 헤어스타일·머리색 등을 여러 가지로 바꿔 한 번에 뽑기')}>
                    <Button
                        variant={isVariationMode ? "default" : "outline"}
                        size="icon"
                        className={cn("h-9 w-9 rounded-xl shrink-0", !isVariationMode && "hover:bg-accent")}
                        onClick={() => navigate('/variations')}
                    >
                        <Shuffle className="h-4 w-4" />
                    </Button>
                </Tip>
                {/* Parameter Settings Dialog */}
                <Dialog open={parameterDialogOpen} onOpenChange={setParameterDialogOpen}>
                    <Tip content={model
                        ? t('comfy.params.buttonTip', '생성 설정 (모델·LoRA·스텝·고화질)')
                        : t('comfy.params.buttonTipNoModel', '생성 설정: 먼저 체크포인트(모델)를 고르세요')}
                    >
                        <DialogTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl shrink-0 relative">
                                <SlidersHorizontal className="h-4 w-4" />
                                {!model && (
                                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-background" />
                                )}
                            </Button>
                        </DialogTrigger>
                    </Tip>
                    <DialogContent className="sm:max-w-[640px] h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
                        <DialogHeader>
                            <DialogTitle>{t('comfy.params.title', '생성 설정')}</DialogTitle>
                            <DialogDescription>
                                {t('comfy.params.description', 'ComfyUI로 그릴 때 쓰는 설정입니다. 바꾼 값은 바로 저장되고 지금 프리셋에도 들어갑니다.')}
                            </DialogDescription>
                        </DialogHeader>
                        <ParamsPanel />
                    </DialogContent>
                </Dialog>
            </div>

            <LoraDialog open={loraDialogOpen} onOpenChange={setLoraDialogOpen} />

            {/* Bottom Generate Button Area */}
            <div className="p-0">
                {/* Generate Button + Counter */}
                <div className="flex gap-2">
                    <Button
                        variant={isRunningHere ? "destructive" : "generate"}
                        size="lg"
                        className={cn(
                            "flex-1 h-12 rounded-xl text-base font-semibold shadow-lg transition-all duration-200",
                            isConflict && "opacity-50 cursor-not-allowed"
                        )}
                        onClick={handleGenerateOrCancel}
                        disabled={isDisabled}
                        title={conflictHint}
                    >
                        {renderButtonLabel()}
                    </Button>
                    {/* 변형 모드에서는 '변형마다 몇 장'을 정한다 */}
                    <Counter
                        value={isVariationMode ? variationPerVariant : batchCount}
                        onChange={isVariationMode ? setVariationPerVariant : setBatchCount}
                        min={1}
                        max={isVariationMode ? 8 : 9999}
                        fontSize={16}
                    />
                </div>
            </div>

            {/* Fragment Prompt Dialog */}
            <FragmentPromptDialog
                open={fragmentDialogOpen}
                onOpenChange={setFragmentDialogOpen}
            />
        </div>
    )
}
