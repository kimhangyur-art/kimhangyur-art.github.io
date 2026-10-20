// 변형 모드(랜덤 생성 모드) 상태와 생성 반복.
//
// 왼쪽 프롬프트는 그대로 두고, 변수(헤어스타일·머리색 …)의 후보를 바꿔 넣은 그림을 차례로 그린다.
//   1. 변수·방식으로 줄(변형)을 만든다 (lib/variation.ts)
//   2. 줄 × 장수 만큼 작업을 만들고 시드를 정한다 ('같은 시드로 비교'면 k번째 칸은 모든 줄이 같은 시드)
//   3. 작업마다 지금 프롬프트로 생성 요청을 만들고(buildGenerationParams) 합친 긍정 프롬프트에 변형을 적용해
//      ComfyUI로 그린 뒤 NAIS_Variation/<묶음 이름>/ 에 저장한다
// 반복은 이 모듈에서 돌기 때문에 다른 화면으로 가도 계속 그린다.
//
// PromptPanel 의 생성 버튼이 /variations 화면에서 start()/cancel()/plannedCount() 를 부른다.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { useGenerationStore } from './generation-store'
import { useSettingsStore } from './settings-store'
import { useComfyStore } from './comfy-store'
import { useCharacterPromptStore, type CharacterPrompt } from './character-prompt-store'
import { buildGenerationParams } from '@/lib/comfy-params'
import { saveOutputImage, bytesToBase64 } from '@/lib/output-save'
import { generateImage } from '@/services/comfyui-api'
import { interruptPrompt, pingComfy } from '@/services/comfy/client'
import { joinPrompt, removeComments } from '@/services/comfy/prompt-syntax'
import {
    CONFIRM_OVER,
    MAX_VARIANT_ROWS,
    VARIABLE_TEMPLATES,
    applyVariantToFields,
    applyVariantToTexts,
    clampPerVariant,
    comboCount,
    defaultRunName,
    detectFind,
    expandVariants,
    planJobs,
    seededRng,
    uniqueRunName,
    variantFileLabel,
    variantFullLabel,
    variantLabel,
    variantValues,
    type CharacterText,
    type Variant,
    type VariantChange,
    type VariationMode,
    type VariationVariable,
} from '@/lib/variation'

// ---------------------------------------------------------------------------
// 타입

export type VariationJobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface VariationJob {
    id: string
    /** 몇 번째 줄(변형) */
    row: number
    /** 몇 번째 칸 */
    col: number
    seed: number
    status: VariationJobStatus
    /** 저장한 그림 경로 (파일로 못 썼으면 memory://…) */
    path?: string
    /** 고화질로 다시 그린 그림 경로 */
    hqPath?: string
    error?: string
    favorite?: boolean
    /** 실제로 쓴 긍정 프롬프트 (변형 적용 뒤, 품질 태그 붙이기 전). 줄의 prompt 와 같으면 비워 둔다 */
    prompt?: string
}

export interface VariationRow {
    key: string
    isBase: boolean
    /** 짧은 이름: '기준', '헤어스타일: ponytail', 'ponytail · blonde hair' */
    label: string
    /** 자세한 이름: '헤어스타일: ponytail · 머리색: blonde hair' */
    fullLabel: string
    /** 파일 이름에 넣는 이름 */
    fileLabel: string
    changes: VariantChange[]
    /** 이 줄에서 처음 그린 그림의 프롬프트 (같은 줄의 칸은 보통 같아서 한 번만 적는다) */
    prompt?: string
}

export type VariationRunStatus = 'running' | 'done' | 'stopped'

export interface VariationRun {
    id: string
    /** 묶음 이름 (저장 폴더 이름) */
    name: string
    createdAt: number
    mode: VariationMode
    perVariant: number
    sameSeed: boolean
    /** 같은 시드로 비교할 때 칸마다 쓴 시드 */
    seeds: number[]
    width: number
    height: number
    checkpoint: string
    /** 시작할 때 왼쪽 프롬프트를 합친 글 + 켜 둔 캐릭터 프롬프트 (조각 프롬프트를 풀기 전) */
    basePrompt: string
    rows: VariationRow[]
    jobs: VariationJob[]
    status: VariationRunStatus
}

export type CellSize = 'sm' | 'md' | 'lg'

export interface VariationPlan {
    variants: Variant[]
    rows: number
    images: number
    /** 켜 둔 변수 후보의 모든 조합 수 */
    combos: number
    /** 모든 조합이 너무 많아 앞에서부터 줄 수 상한만큼만 그린다 */
    truncated: boolean
}

/** 지난 묶음은 이만큼만 기억한다 (그림 파일은 지우지 않는다) */
export const MAX_RUNS = 20
/** 기억하는 칸 수 상한 (넘으면 오래된 묶음부터 목록에서 뺀다) */
const MAX_STORED_JOBS = 6000
const MAX_FAILS_IN_A_ROW = 3

interface VariationState {
    // 설정 (저장)
    variables: VariationVariable[]
    mode: VariationMode
    /** 변형마다 장수 */
    perVariant: number
    /** 무작위 N개 */
    randomCount: number
    /** 바꾸지 않은 그림을 첫 줄에 */
    includeBase: boolean
    /** 같은 시드로 비교 */
    sameSeed: boolean
    /** 무작위 N개를 고르는 시작값 (미리 보여 준 조합 그대로 그리려고) */
    pickSeed: number
    cellSize: CellSize
    /** 묶음 이름 (비우면 '변형 날짜 시각') */
    runName: string

    // 지난 묶음 (저장)
    runs: VariationRun[]
    selectedRunId: string | null

    // 실행 상태 (저장 안 함)
    isRunning: boolean
    isCancelling: boolean
    totalJobs: number
    doneJobs: number
    activeRunId: string | null

    // 변수
    addVariable: (init?: Partial<Omit<VariationVariable, 'id'>>) => string
    /** 자주 쓰는 변수 추가. 프롬프트에 이미 있는 후보를 찾아 '바꿀 글'에 넣는다 */
    addTemplate: (templateId: string) => { id: string; find: string } | null
    updateVariable: (id: string, patch: Partial<Omit<VariationVariable, 'id'>>) => void
    removeVariable: (id: string) => void
    moveVariable: (id: string, delta: number) => void
    clearVariables: () => void
    /** 프롬프트에 적용한 변형의 새 값을 그 변수의 '바꿀 글'로 (다음 비교가 바로 이어지게) */
    retargetVariables: (changes: VariantChange[]) => number

    setMode: (mode: VariationMode) => void
    setPerVariant: (n: number) => void
    setRandomCount: (n: number) => void
    setIncludeBase: (v: boolean) => void
    setSameSeed: (v: boolean) => void
    setCellSize: (v: CellSize) => void
    setRunName: (name: string) => void
    rerollPick: () => void

    // 묶음
    selectRun: (id: string | null) => void
    /** 목록에서만 지운다 (파일은 남는다). 그리는 중인 묶음은 못 지운다 */
    deleteRun: (id: string) => boolean
    toggleFavorite: (runId: string, jobId: string) => void
    setJobHq: (runId: string, jobId: string, path: string) => void

    /** 지금 설정으로 변형 생성을 시작한다 (만들 그림이 없거나 시작하지 못하면 false). 그리기는 뒤에서 이어진다 */
    start: () => Promise<boolean>
    /** 지난 묶음의 남은(또는 고른) 칸을 지금 왼쪽 프롬프트로 이어서 그린다 */
    resume: (runId: string, jobIds?: string[]) => Promise<boolean>
    cancel: () => void
    /** 지금 설정으로 만들 그림 수 */
    plannedCount: () => number
}

// ---------------------------------------------------------------------------
// 그리는 중인 칸의 진행률·미리보기 (자주 바뀌므로 저장하는 상태와 따로 둔다)

interface VariationLiveState {
    runId: string | null
    jobId: string | null
    progress: number
    preview: string | null
    /** 파일로 저장하지 못한 그림 (이번 실행 동안만) */
    memoryImages: Record<string, string>
    /** 고화질로 다시 그리는 중인 칸: 작업 id → 진행률 */
    hq: Record<string, number>
    /** '즐겨찾기 고화질로' 묶음이 도는 중인 묶음 id */
    hqBatchRunId: string | null
}

export const useVariationLive = create<VariationLiveState>()(() => ({
    runId: null,
    jobId: null,
    progress: 0,
    preview: null,
    memoryImages: {},
    hq: {},
    hqBatchRunId: null,
}))

// ---------------------------------------------------------------------------
// 도우미

function tr(key: string, defaultValue: string, vars?: Record<string, unknown>): string {
    return String(i18n.t(key, { defaultValue, ...vars }))
}

let idSeq = 0
function newId(prefix: string): string {
    idSeq += 1
    return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

function randomPick(): number {
    return Math.floor(Math.random() * 2147483647)
}

/** 기본 + 추가 + 세부 프롬프트를 합친 글. 주석은 빼고, 조각 프롬프트는 풀지 않는다 */
export function mergedPromptOf(base: string, additional: string, detail: string): string {
    return joinPrompt(removeComments(base), removeComments(additional), removeComments(detail))
}

/** 켜 둔 캐릭터 프롬프트 (변수의 바꿀 글은 여기서도 찾는다) */
export function characterTextsOf(characters: CharacterPrompt[]): CharacterText[] {
    return characters
        .filter((c) => c.enabled)
        .map((c, i) => ({ id: c.id, label: c.name?.trim() || tr('comfy.variation.characterN', '캐릭터 {{n}}', { n: i + 1 }), prompt: removeComments(c.prompt) }))
        .filter((c) => c.prompt.trim())
}

/** 지금 왼쪽 프롬프트를 합친 글 */
export function currentBasePrompt(): string {
    const g = useGenerationStore.getState()
    return mergedPromptOf(g.basePrompt, g.additionalPrompt, g.detailPrompt)
}

export function currentCharacterTexts(): CharacterText[] {
    return characterTextsOf(useCharacterPromptStore.getState().characters)
}

/** 바꿀 글을 찾는 범위 전체: 합친 프롬프트 + 켜 둔 캐릭터 프롬프트 */
export function currentSearchText(): string {
    return [currentBasePrompt(), ...currentCharacterTexts().map((c) => c.prompt)].join('\n')
}

type PlanInput = Pick<VariationState, 'variables' | 'mode' | 'perVariant' | 'randomCount' | 'includeBase' | 'pickSeed'>

let planCache: { key: string; plan: VariationPlan } | null = null

/** 지금 설정으로 그릴 줄과 장수 (같은 설정이면 계산을 다시 하지 않는다) */
export function computePlan(s: PlanInput, prompt: string): VariationPlan {
    const key = JSON.stringify([s.variables, s.mode, s.perVariant, s.randomCount, s.includeBase, s.pickSeed, prompt])
    if (planCache?.key === key) return planCache.plan
    const variants = expandVariants(s.variables, s.mode, {
        includeBase: s.includeBase,
        randomCount: s.randomCount,
        rng: seededRng(s.pickSeed),
        prompt,
    })
    const combos = comboCount(s.variables)
    const plan: VariationPlan = {
        variants,
        rows: variants.length,
        images: variants.length * clampPerVariant(s.perVariant),
        combos,
        truncated: s.mode === 'all' && variants.length >= MAX_VARIANT_ROWS && combos + (s.includeBase ? 1 : 0) > variants.length,
    }
    planCache = { key, plan }
    return plan
}

function toRow(v: Variant): VariationRow {
    return {
        key: v.key,
        isBase: v.isBase,
        label: variantLabel(v),
        fullLabel: variantFullLabel(v),
        fileLabel: variantFileLabel(v),
        changes: v.changes,
    }
}

function findRun(runId: string): VariationRun | undefined {
    return useVariationStore.getState().runs.find((r) => r.id === runId)
}

function patchRun(runId: string, patch: Partial<VariationRun>) {
    useVariationStore.setState((s) => ({ runs: s.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)) }))
}

function patchJob(runId: string, jobId: string, patch: Partial<VariationJob>) {
    useVariationStore.setState((s) => ({
        runs: s.runs.map((r) => (r.id === runId ? { ...r, jobs: r.jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)) } : r)),
    }))
}

/** 칸의 프롬프트를 적는다: 줄에 처음 적고, 줄과 다를 때만(조각 프롬프트 등) 칸에 적는다 */
function promptPatch(runId: string, rowIndex: number, prompt: string): Pick<VariationJob, 'prompt'> {
    const run = findRun(runId)
    const row = run?.rows[rowIndex]
    if (!run || !row) return { prompt }
    if (row.prompt === undefined) {
        patchRun(runId, { rows: run.rows.map((r, i) => (i === rowIndex ? { ...r, prompt } : r)) })
        return { prompt: undefined }
    }
    return { prompt: row.prompt === prompt ? undefined : prompt }
}

/** 칸에 쓴 프롬프트 */
export function jobPrompt(run: VariationRun, job: VariationJob): string | undefined {
    return job.prompt ?? run.rows[job.row]?.prompt
}

function runFinished(run: VariationRun): boolean {
    return run.jobs.every((j) => j.status === 'done' || j.status === 'failed')
}

/**
 * 새 묶음을 앞에 넣고 최근 MAX_RUNS 개만 남긴다. 칸 수가 너무 많아지면(저장이 느려진다) 오래된 묶음부터 뺀다.
 * 그리는 중인 묶음과 가장 최근 묶음은 늘 남긴다. 그림 파일은 지우지 않는다.
 */
function keepRecent(runs: VariationRun[], activeRunId: string | null): VariationRun[] {
    const kept: VariationRun[] = []
    let jobs = 0
    for (const r of runs) {
        const must = kept.length === 0 || r.id === activeRunId
        if (!must && (kept.length >= MAX_RUNS || jobs + r.jobs.length > MAX_STORED_JOBS)) continue
        kept.push(r)
        jobs += r.jobs.length
    }
    return kept
}

async function comfyReachable(): Promise<boolean> {
    let ok = false
    try {
        ok = (await pingComfy()).ok
    } catch {
        ok = false
    }
    // 위쪽 연결 표시가 '꺼짐'으로 남아 있으면 다시 확인해 맞춘다
    if (ok && useComfyStore.getState().status === 'offline') void useComfyStore.getState().refresh()
    return ok
}

function offlineToast() {
    const url = useComfyStore.getState().url
    void useComfyStore.getState().refresh() // 연결 표시도 '꺼짐'으로
    toast({
        title: tr('comfy.variation.offlineTitle', 'ComfyUI에 연결할 수 없습니다'),
        description: tr('comfy.variation.offlineDesc', 'ComfyUI를 먼저 켜 주세요. 이미 켜져 있다면 설정 → ComfyUI에서 주소({{url}})가 맞는지 확인하세요.', { url }),
        variant: 'destructive',
    })
}

/** 다른 모드가 돌고 있거나 체크포인트가 없으면 알리고 false */
function preflight(): boolean {
    const g = useGenerationStore.getState()
    const busy = g.generatingMode
    if (busy === 'main' || busy === 'scene' || g.isGenerating) {
        toast({
            title: tr('common.error', '오류'),
            description: busy === 'scene'
                ? tr('comfy.generate.busyScene', '씬 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
                : tr('comfy.generate.busyMain', '메인 화면에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.'),
            variant: 'destructive',
        })
        return false
    }
    if (!g.model) {
        toast({
            title: tr('comfy.noCheckpointTitle', '체크포인트를 고르세요'),
            description: tr('comfy.noCheckpointDesc', '프롬프트 아래 생성 설정(톱니바퀴)에서 ComfyUI 체크포인트를 고르세요.'),
            variant: 'destructive',
        })
        return false
    }
    return true
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(done, ms)
        function done() {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
        signal.addEventListener('abort', done)
    })
}

// ---------------------------------------------------------------------------
// 생성 반복

let runnerAbort: AbortController | null = null

type JobOutcome = { kind: 'ok' } | { kind: 'cancelled' } | { kind: 'offline' } | { kind: 'failed'; error: string }

async function failureOutcome(error: string | undefined): Promise<JobOutcome> {
    if (!(await comfyReachable())) return { kind: 'offline' }
    return { kind: 'failed', error: error || tr('toast.unknownError', '알 수 없는 오류가 발생했습니다.') }
}

let saveWarned = false

/** 한 칸 그리기 */
async function runJob(run: VariationRun, row: VariationRow, job: VariationJob, signal: AbortSignal): Promise<JobOutcome> {
    patchJob(run.id, job.id, { status: 'running', error: undefined })
    useVariationLive.setState({ runId: run.id, jobId: job.id, progress: 0, preview: null })
    const backToQueue = () => patchJob(run.id, job.id, { status: 'queued' })
    try {
        const variant = { changes: row.changes }
        // 조각(와일드카드)은 장마다 새로 뽑고, 다 푼 프롬프트(+ 캐릭터 프롬프트)에 변형을 적용한다.
        // 바꿀 글이 캐릭터 프롬프트에만 있으면 거기서 바꾸고, 어디에도 없으면 합친 프롬프트 끝에 붙인다.
        const params = await buildGenerationParams({ seed: job.seed })
        const chars = params.characterPrompts ?? []
        const applied = applyVariantToTexts([params.prompt, ...chars.map((c) => c.prompt)], variant)
        params.prompt = applied.texts[0]
        params.characterPrompts = chars.map((c, i) => ({ ...c, prompt: applied.texts[i + 1] ?? c.prompt }))
        // 메타데이터의 프롬프트 칸도 변형에 맞춘다 (나중에 이 그림의 프롬프트를 불러오면 이 조합이 된다)
        if (params.promptParts) {
            const pp = params.promptParts
            const f = applyVariantToFields({ basePrompt: pp.base, additionalPrompt: pp.additional, detailPrompt: pp.detail }, variant).fields
            params.promptParts = { ...pp, base: f.basePrompt, additional: f.additionalPrompt, detail: f.detailPrompt }
        }
        params.variant = { label: row.fullLabel, values: variantValues(row) }
        const usedPrompt = joinPrompt(params.prompt, ...params.characterPrompts.filter((c) => c.enabled).map((c) => c.prompt))
        if (signal.aborted) {
            backToQueue()
            return { kind: 'cancelled' }
        }
        const showPreview = useSettingsStore.getState().useStreaming
        const result = await generateImage(params, {
            signal,
            onQueued: (promptId) => {
                useGenerationStore.getState().setCurrentPromptId(promptId)
                if (signal.aborted) void interruptPrompt(promptId)
            },
            onProgress: (pct, preview) => {
                if (signal.aborted) return
                useVariationLive.setState(showPreview && preview ? { progress: pct, preview } : { progress: pct })
            },
        })

        // 취소를 누른 순간 마침 다 그렸으면 버리지 않고 저장한다
        if (result.success && (result.bytes || result.imageData)) {
            const image = result.bytes ?? result.imageData ?? ''
            const saved = await saveOutputImage(image, { kind: 'variation', groupName: run.name, label: row.fileLabel })
            if (!saved.saved) {
                const b64 = result.imageData ?? (result.bytes ? bytesToBase64(result.bytes) : '')
                useVariationLive.setState((s) => ({ memoryImages: { ...s.memoryImages, [job.id]: `data:image/png;base64,${b64}` } }))
                if (!saveWarned) {
                    saveWarned = true
                    toast({
                        title: tr('comfy.variation.saveFailed', '그림을 폴더에 저장하지 못했습니다'),
                        description: tr('comfy.variation.saveFailedDesc', '대신 브라우저 다운로드로 받았습니다. 이 화면에는 앱을 끌 때까지만 보입니다. 설정에서 저장 위치를 확인하세요. ({{error}})', { error: saved.error ?? '' }),
                        variant: 'destructive',
                    })
                }
            }
            patchJob(run.id, job.id, { status: 'done', path: saved.path, seed: result.seed, error: undefined, ...promptPatch(run.id, job.row, usedPrompt) })
            return { kind: 'ok' }
        }
        if (result.interrupted || signal.aborted) {
            backToQueue()
            return { kind: 'cancelled' }
        }
        const out = await failureOutcome(result.error)
        if (out.kind === 'failed') patchJob(run.id, job.id, { status: 'failed', error: out.error, ...promptPatch(run.id, job.row, usedPrompt) })
        else backToQueue()
        return out
    } catch (e) {
        if (signal.aborted) {
            backToQueue()
            return { kind: 'cancelled' }
        }
        console.error('[Variation] job failed:', e)
        const out = await failureOutcome((e as Error)?.message ?? String(e))
        if (out.kind === 'failed') patchJob(run.id, job.id, { status: 'failed', error: out.error })
        else backToQueue()
        return out
    } finally {
        useGenerationStore.getState().setCurrentPromptId(null)
        useVariationLive.setState({ jobId: null, progress: 0, preview: null })
    }
}

type StopReason = 'done' | 'cancelled' | 'offline' | 'streak' | 'error'

/** 고른 작업들을 차례로 그린다. 이 함수가 도는 동안 generatingMode 는 'variation' */
async function runJobs(runId: string, jobIds: string[]): Promise<void> {
    const abort = new AbortController()
    runnerAbort = abort
    // 여기까지는 바로 실행된다: 버튼이 곧장 '생성 중'으로 바뀐다
    useVariationStore.setState({ isRunning: true, isCancelling: false, totalJobs: jobIds.length, doneJobs: 0, activeRunId: runId })
    useGenerationStore.getState().setGeneratingMode('variation')
    patchRun(runId, { status: 'running' })

    let reason: StopReason = 'done'
    let ok = 0
    let failed = 0
    let streak = 0
    let lastError = ''
    try {
        for (let i = 0; i < jobIds.length; i++) {
            if (abort.signal.aborted) {
                reason = 'cancelled'
                break
            }
            const run = findRun(runId)
            const job = run?.jobs.find((j) => j.id === jobIds[i])
            const row = job ? run?.rows[job.row] : undefined
            if (!run || !job || !row) continue

            const outcome = await runJob(run, row, job, abort.signal)
            if (outcome.kind === 'cancelled') {
                reason = 'cancelled'
                break
            }
            if (outcome.kind === 'offline') {
                reason = 'offline'
                break
            }
            if (outcome.kind === 'ok') {
                ok++
                streak = 0
            } else {
                failed++
                streak++
                lastError = outcome.error
                if (streak >= MAX_FAILS_IN_A_ROW) {
                    reason = 'streak'
                    break
                }
                if (failed === 1) {
                    toast({
                        title: tr('comfy.variation.failedOne', '"{{label}}" 칸을 그리지 못했습니다', { label: row.label }),
                        description: tr('comfy.variation.failedOneDesc', '{{error}} · 다음 칸으로 넘어갑니다. 실패한 칸은 나중에 다시 그릴 수 있습니다.', { error: outcome.error }),
                        variant: 'destructive',
                    })
                }
            }
            useVariationStore.setState((s) => ({ doneJobs: s.doneJobs + 1 }))

            const { generationDelay } = useSettingsStore.getState()
            if (generationDelay > 0 && i < jobIds.length - 1) await sleep(generationDelay, abort.signal)
        }
    } catch (e) {
        console.error('[Variation] run error:', e)
        reason = 'error'
        lastError = (e as Error)?.message ?? String(e)
    } finally {
        if (runnerAbort === abort) runnerAbort = null
        // 그리던 칸이 남아 있으면 대기로 되돌린다
        const run = findRun(runId)
        if (run) {
            const jobs = run.jobs.map((j) => (j.status === 'running' ? { ...j, status: 'queued' as const } : j))
            const next = { ...run, jobs }
            patchRun(runId, { jobs, status: runFinished(next) ? 'done' : 'stopped' })
        }
        useVariationLive.setState({ runId: null, jobId: null, progress: 0, preview: null })
        useVariationStore.setState({ isRunning: false, isCancelling: false, activeRunId: null })
        const g = useGenerationStore.getState()
        if (g.generatingMode === 'variation') {
            g.setGeneratingMode(null)
            g.setCurrentPromptId(null)
        }
    }
    summaryToast(reason, ok, failed, lastError)
}

function summaryToast(reason: StopReason, ok: number, failed: number, lastError: string) {
    const leftover = tr('comfy.variation.leftover', '남은 칸은 아래 [남은 칸 이어서 그리기]로 이어서 그릴 수 있습니다.')
    switch (reason) {
        case 'done':
            if (ok === 0 && failed === 0) return
            toast({
                title: tr('comfy.variation.doneTitle', '변형 생성 완료'),
                description: failed > 0
                    ? tr('comfy.variation.doneDescWithFail', '{{ok}}장을 그렸고 {{failed}}장은 실패했습니다.', { ok, failed })
                    : tr('comfy.variation.doneDesc', '{{ok}}장을 모두 그렸습니다. 마음에 드는 그림은 눌러서 고화질로 다시 그리거나 프롬프트에 적용할 수 있습니다.', { ok }),
                variant: failed > 0 ? 'default' : 'success',
            })
            return
        case 'cancelled':
            toast({
                title: tr('comfy.variation.cancelledTitle', '변형 생성을 멈췄습니다'),
                description: `${tr('comfy.variation.cancelledDesc', '그리던 그림은 ComfyUI에서 바로 멈췄습니다.')} ${leftover}`,
            })
            return
        case 'offline':
            offlineToast()
            return
        case 'streak':
            toast({
                title: tr('comfy.variation.streakTitle', '연속으로 {{count}}장을 그리지 못해 멈췄습니다', { count: MAX_FAILS_IN_A_ROW }),
                description: `${lastError} ${leftover}`.trim(),
                variant: 'destructive',
            })
            return
        case 'error':
            toast({
                title: tr('comfy.variation.errorTitle', '변형 생성 중 문제가 생겨 멈췄습니다'),
                description: `${lastError} ${leftover}`.trim(),
                variant: 'destructive',
            })
            return
    }
}

// ---------------------------------------------------------------------------
// 저장소

interface PersistedVariation {
    variables: VariationVariable[]
    mode: VariationMode
    perVariant: number
    randomCount: number
    includeBase: boolean
    sameSeed: boolean
    pickSeed: number
    cellSize: CellSize
    runs: VariationRun[]
    selectedRunId: string | null
}

/** 앱을 끈 사이에 '그리는 중'으로 남은 칸·묶음을 정리한다 */
function sanitizeRuns(runs: unknown): VariationRun[] {
    if (!Array.isArray(runs)) return []
    return (runs as VariationRun[])
        .filter((r) => r && Array.isArray(r.jobs) && Array.isArray(r.rows))
        .map((r) => {
            const jobs = r.jobs.map((j) => (j.status === 'running' ? { ...j, status: 'queued' as const } : j))
            const status: VariationRunStatus = r.status === 'running' ? 'stopped' : r.status
            return { ...r, jobs, status }
        })
        .slice(0, MAX_RUNS)
}

export const useVariationStore = create<VariationState>()(
    persist(
        (set, get) => ({
            variables: [],
            mode: 'each',
            perVariant: 2,
            randomCount: 12,
            includeBase: true,
            sameSeed: true,
            pickSeed: randomPick(),
            cellSize: 'md',
            runName: '',

            runs: [],
            selectedRunId: null,

            isRunning: false,
            isCancelling: false,
            totalJobs: 0,
            doneJobs: 0,
            activeRunId: null,

            addVariable: (init = {}) => {
                const id = newId('var')
                const n = get().variables.length + 1
                const variable: VariationVariable = {
                    id,
                    name: init.name ?? tr('comfy.variation.defaultVarName', '변수 {{n}}', { n }),
                    find: init.find ?? '',
                    options: init.options ?? '',
                    enabled: init.enabled ?? true,
                }
                set((s) => ({ variables: [...s.variables, variable] }))
                return id
            },

            addTemplate: (templateId) => {
                const tpl = VARIABLE_TEMPLATES.find((t) => t.id === templateId)
                if (!tpl) return null
                const find = detectFind(currentSearchText(), tpl.options)
                const id = get().addVariable({ name: tpl.name, find, options: tpl.options.join('\n') })
                return { id, find }
            },

            updateVariable: (id, patch) => set((s) => ({ variables: s.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
            removeVariable: (id) => set((s) => ({ variables: s.variables.filter((v) => v.id !== id) })),
            moveVariable: (id, delta) => set((s) => {
                const i = s.variables.findIndex((v) => v.id === id)
                const j = i + delta
                if (i < 0 || j < 0 || j >= s.variables.length) return {}
                const next = [...s.variables]
                const [item] = next.splice(i, 1)
                next.splice(j, 0, item)
                return { variables: next }
            }),
            clearVariables: () => set({ variables: [] }),

            retargetVariables: (changes) => {
                let count = 0
                set((s) => ({
                    variables: s.variables.map((v) => {
                        const c = changes.find((x) => x.variableId === v.id)
                        if (!c || v.find.trim().toLowerCase() !== c.find.trim().toLowerCase()) return v
                        const nextFind = c.value.trim()
                        if (nextFind.toLowerCase() === v.find.trim().toLowerCase()) return v
                        count++
                        return { ...v, find: nextFind }
                    }),
                }))
                return count
            },

            setMode: (mode) => set({ mode }),
            setPerVariant: (n) => set({ perVariant: clampPerVariant(n) }),
            setRandomCount: (n) => set({ randomCount: Math.max(1, Math.min(MAX_VARIANT_ROWS, Math.round(Number.isFinite(n) ? n : 1))) }),
            setIncludeBase: (includeBase) => set({ includeBase }),
            setSameSeed: (sameSeed) => set({ sameSeed }),
            setCellSize: (cellSize) => set({ cellSize }),
            setRunName: (runName) => set({ runName }),
            rerollPick: () => set({ pickSeed: randomPick() }),

            selectRun: (selectedRunId) => set({ selectedRunId }),
            deleteRun: (id) => {
                if (get().activeRunId === id) return false
                set((s) => {
                    const runs = s.runs.filter((r) => r.id !== id)
                    return { runs, selectedRunId: s.selectedRunId === id ? runs[0]?.id ?? null : s.selectedRunId }
                })
                return true
            },
            toggleFavorite: (runId, jobId) => {
                const job = findRun(runId)?.jobs.find((j) => j.id === jobId)
                if (job) patchJob(runId, jobId, { favorite: !job.favorite })
            },
            setJobHq: (runId, jobId, path) => patchJob(runId, jobId, { hqPath: path }),

            start: async () => {
                if (get().isRunning || runnerAbort) return false
                if (!useVariationStore.persist.hasHydrated()) await useVariationStore.persist.rehydrate()
                if (!preflight()) return false

                const s = get()
                const prompt = currentSearchText()
                const plan = computePlan(s, prompt)
                if (plan.rows === 0) {
                    toast({
                        title: tr('comfy.variation.nothingTitle', '바꿔 볼 후보가 없습니다'),
                        description: tr('comfy.variation.nothingDesc', '변수를 하나 추가하고 후보를 한 줄에 하나씩 적어 주세요. (바꿀 글과 똑같은 후보는 빼고 셉니다)'),
                        variant: 'destructive',
                    })
                    return false
                }
                if (plan.images > CONFIRM_OVER) {
                    const okToGo = window.confirm(tr('comfy.variation.confirmMany', '{{count}}장을 그립니다. 시간이 꽤 걸릴 수 있습니다. 시작할까요?\n(도중에 생성 버튼을 다시 누르면 멈출 수 있습니다)', { count: plan.images }))
                    if (!okToGo) return false
                }
                if (!(await comfyReachable())) {
                    offlineToast()
                    return false
                }
                // 기다리는 사이에 다른 모드가 시작했을 수 있다
                if (get().isRunning || runnerAbort || !preflight()) return false

                const g = useGenerationStore.getState()
                const rows = plan.variants.map(toRow)
                const perVariant = clampPerVariant(s.perVariant)
                const planned = planJobs(rows.length, perVariant, s.sameSeed)
                const run: VariationRun = {
                    id: newId('run'),
                    name: uniqueRunName(s.runName.trim() || defaultRunName(new Date()), get().runs.map((r) => r.name)),
                    createdAt: Date.now(),
                    mode: s.mode,
                    perVariant,
                    sameSeed: s.sameSeed,
                    seeds: planned.seeds,
                    width: g.selectedResolution.width,
                    height: g.selectedResolution.height,
                    checkpoint: g.model,
                    basePrompt: prompt,
                    rows,
                    jobs: planned.jobs.map((j) => ({ id: newId('job'), row: j.row, col: j.col, seed: j.seed, status: 'queued' })),
                    status: 'running',
                }
                set((st) => ({
                    runs: keepRecent([run, ...st.runs], run.id),
                    selectedRunId: run.id,
                    runName: '',
                    // 다음 '무작위 N개'는 다른 조합으로
                    ...(st.mode === 'random' ? { pickSeed: randomPick() } : {}),
                }))
                void runJobs(run.id, run.jobs.map((j) => j.id))
                return true
            },

            resume: async (runId, jobIds) => {
                if (get().isRunning || runnerAbort) return false
                const run = findRun(runId)
                if (!run) return false
                const ids = (jobIds ?? run.jobs.filter((j) => j.status === 'queued' || j.status === 'failed').map((j) => j.id))
                    .filter((id) => run.jobs.some((j) => j.id === id && j.status !== 'running'))
                if (!ids.length) return false
                if (!preflight()) return false
                if (!(await comfyReachable())) {
                    offlineToast()
                    return false
                }
                if (get().isRunning || runnerAbort || !preflight()) return false
                if (currentSearchText() !== run.basePrompt) {
                    toast({
                        title: tr('comfy.variation.resumeChangedTitle', '지금 왼쪽 프롬프트로 이어서 그립니다'),
                        description: tr('comfy.variation.resumeChangedDesc', '이 묶음을 시작한 뒤 왼쪽 프롬프트가 바뀌어, 먼저 그린 칸과 조금 다를 수 있습니다.'),
                    })
                }
                for (const id of ids) patchJob(runId, id, { status: 'queued', error: undefined })
                set({ selectedRunId: runId })
                void runJobs(runId, ids)
                return true
            },

            cancel: () => {
                if (!get().isRunning) return
                set({ isCancelling: true })
                runnerAbort?.abort()
            },

            plannedCount: () => computePlan(get(), currentSearchText()).images,
        }),
        {
            name: 'nais2-variations',
            version: 1,
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (s): PersistedVariation => ({
                variables: s.variables,
                mode: s.mode,
                perVariant: s.perVariant,
                randomCount: s.randomCount,
                includeBase: s.includeBase,
                sameSeed: s.sameSeed,
                pickSeed: s.pickSeed,
                cellSize: s.cellSize,
                runs: s.runs,
                selectedRunId: s.selectedRunId,
            }),
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Partial<PersistedVariation>
                const runs = sanitizeRuns(p.runs)
                const mode: VariationMode = p.mode === 'all' || p.mode === 'random' || p.mode === 'each' ? p.mode : current.mode
                return {
                    ...current,
                    variables: Array.isArray(p.variables) ? p.variables.filter((v) => v && typeof v.id === 'string') : current.variables,
                    mode,
                    perVariant: clampPerVariant(p.perVariant ?? current.perVariant),
                    randomCount: typeof p.randomCount === 'number' ? p.randomCount : current.randomCount,
                    includeBase: typeof p.includeBase === 'boolean' ? p.includeBase : current.includeBase,
                    sameSeed: typeof p.sameSeed === 'boolean' ? p.sameSeed : current.sameSeed,
                    pickSeed: typeof p.pickSeed === 'number' ? p.pickSeed : current.pickSeed,
                    cellSize: p.cellSize === 'sm' || p.cellSize === 'lg' || p.cellSize === 'md' ? p.cellSize : current.cellSize,
                    runs,
                    selectedRunId: p.selectedRunId && runs.some((r) => r.id === p.selectedRunId) ? p.selectedRunId : runs[0]?.id ?? null,
                }
            },
        },
    ),
)
