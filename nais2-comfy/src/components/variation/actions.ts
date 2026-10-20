// 변형 모드 화면의 버튼 동작: 고화질로 다시 그리기, 프롬프트에 적용, 폴더 열기
import { createElement } from 'react'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { convertFileSrc } from '@tauri-apps/api/core'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { upscaleExisting } from '@/lib/comfy-params'
import { variationFolder } from '@/lib/output-save'
import { applyVariantToFields } from '@/lib/variation'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { characterTextsOf, useVariationLive, useVariationStore, type VariationJob, type VariationRow, type VariationRun } from '@/stores/variation-store'

function tr(key: string, defaultValue: string, vars?: Record<string, unknown>): string {
    return String(i18n.t(key, { defaultValue, ...vars }))
}

export function isMemoryPath(path: string | undefined): boolean {
    return !path || path.startsWith('memory://')
}

/** 칸에 보여 줄 그림 주소 (고화질이 있으면 고화질) */
export function jobImageSrc(job: VariationJob, memoryImages: Record<string, string>, preferHq = true): string | null {
    if (preferHq && job.hqPath && !isMemoryPath(job.hqPath)) return convertFileSrc(job.hqPath)
    if (job.path && !isMemoryPath(job.path)) return convertFileSrc(job.path)
    return memoryImages[job.id] ?? null
}

function sourceOf(job: VariationJob): { path?: string; dataUrl?: string } | null {
    if (job.path && !isMemoryPath(job.path)) return { path: job.path }
    const mem = useVariationLive.getState().memoryImages[job.id]
    return mem ? { dataUrl: mem } : null
}

function setHq(jobId: string, progress: number | null) {
    useVariationLive.setState((s) => {
        const hq = { ...s.hq }
        if (progress === null) delete hq[jobId]
        else hq[jobId] = progress
        return { hq }
    })
}

let hqBatchAbort: AbortController | null = null

/** 한 장을 고화질로 다시 그린다 (시드 없이 그림 자체에서 시작). quiet 이면 끝났다는 알림을 띄우지 않는다 */
export async function upscaleVariationJob(runId: string, jobId: string, opts: { quiet?: boolean; signal?: AbortSignal } = {}): Promise<boolean> {
    const run = useVariationStore.getState().runs.find((r) => r.id === runId)
    const job = run?.jobs.find((j) => j.id === jobId)
    if (!run || !job) return false
    if (useVariationLive.getState().hq[jobId] !== undefined) return false
    const source = sourceOf(job)
    if (!source) {
        toast({ title: tr('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: tr('comfy.variation.noImage', '이 칸에는 아직 그림이 없습니다.'), variant: 'destructive' })
        return false
    }
    if (!opts.quiet) {
        const { upscaleScale, upscaleDenoise } = useSettingsStore.getState()
        toast({
            title: tr('comfy.upscale.startTitle', '고화질로 다시 그리는 중…'),
            description: tr('comfy.variation.upscaleStartDesc', '{{scale}}배, 다듬기 강도 {{denoise}} · 시드를 몰라도 이 그림에서 시작합니다. 원본은 그대로 두고 같은 폴더에 새 파일로 저장합니다.', { scale: upscaleScale, denoise: upscaleDenoise }),
        })
    }
    setHq(jobId, 0)
    try {
        const r = await upscaleExisting(source, { signal: opts.signal, onProgress: (p) => setHq(jobId, p) })
        if (r.success && r.saved) {
            if (r.saved.saved) useVariationStore.getState().setJobHq(runId, jobId, r.saved.path)
            if (!opts.quiet) {
                toast({
                    title: tr('comfy.upscale.done', '고화질 그림을 저장했습니다'),
                    description: tr('comfy.variation.upscaleDoneDesc', '{{width}}×{{height}} · 이 칸에 [고화질] 표시가 붙고, 오른쪽 기록 패널에도 들어갔습니다.', { width: r.width, height: r.height }),
                    variant: 'success',
                })
            }
            return true
        }
        if (r.interrupted) {
            if (!opts.quiet) toast({ title: tr('comfy.upscale.stopped', '고화질로 다시 그리기를 멈췄습니다') })
            return false
        }
        toast({ title: tr('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: r.error, variant: 'destructive' })
        return false
    } catch (e) {
        console.error('[Variation] upscale failed:', e)
        toast({ title: tr('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
        return false
    } finally {
        setHq(jobId, null)
    }
}

/** 즐겨찾기 중 아직 고화질이 아닌 칸 */
export function favoritesToUpscale(run: VariationRun): VariationJob[] {
    return run.jobs.filter((j) => j.favorite && j.status === 'done' && !j.hqPath)
}

/** 즐겨찾기 칸을 차례로 고화질로. 이미 돌고 있으면 멈춘다 */
export async function toggleUpscaleFavorites(runId: string): Promise<void> {
    if (hqBatchAbort) {
        hqBatchAbort.abort()
        return
    }
    const run = useVariationStore.getState().runs.find((r) => r.id === runId)
    if (!run) return
    const targets = favoritesToUpscale(run)
    if (!targets.length) {
        toast({ title: tr('comfy.variation.noFavorites', '고화질로 다시 그릴 즐겨찾기가 없습니다'), description: tr('comfy.variation.noFavoritesDesc', '칸 오른쪽 위의 별을 눌러 마음에 드는 그림을 고르세요.') })
        return
    }
    const abort = new AbortController()
    hqBatchAbort = abort
    useVariationLive.setState({ hqBatchRunId: runId })
    toast({
        title: tr('comfy.variation.hqBatchStart', '즐겨찾기 {{count}}장을 고화질로 다시 그립니다', { count: targets.length }),
        description: tr('comfy.variation.hqBatchStartDesc', '한 장씩 차례로 그립니다. 같은 버튼을 다시 누르면 멈춥니다.'),
    })
    let ok = 0
    try {
        for (const job of targets) {
            if (abort.signal.aborted) break
            if (await upscaleVariationJob(runId, job.id, { quiet: true, signal: abort.signal })) ok++
        }
    } finally {
        hqBatchAbort = null
        useVariationLive.setState({ hqBatchRunId: null })
    }
    toast({
        title: abort.signal.aborted ? tr('comfy.upscale.stopped', '고화질로 다시 그리기를 멈췄습니다') : tr('comfy.variation.hqBatchDone', '즐겨찾기를 고화질로 다시 그렸습니다'),
        description: tr('comfy.variation.hqBatchDoneDesc', '{{ok}}장 완료 · 원본 옆에 NAIS_UPSCALE_… 파일로 저장했습니다.', { ok }),
        variant: abort.signal.aborted ? 'default' : 'success',
    })
}

/** '이 조합을 프롬프트에 적용': 바꾼 글을 왼쪽 프롬프트 칸에 그대로 옮긴다 */
export function applyRowToPrompt(row: VariationRow): void {
    if (useVariationStore.getState().isRunning) {
        toast({ title: tr('comfy.variation.applyBusy', '변형을 그리는 중에는 쓸 수 없습니다 (남은 그림의 프롬프트까지 바뀝니다). 끝나거나 멈춘 뒤에 누르세요.'), variant: 'destructive' })
        return
    }
    if (row.isBase || !row.changes.length) {
        toast({ title: tr('comfy.variation.applyNothing', '기준 그림은 바꾼 것이 없습니다') })
        return
    }
    const g = useGenerationStore.getState()
    const cs = useCharacterPromptStore.getState()
    // 켜 둔 캐릭터 프롬프트도 바꿀 곳에 넣는다 (주석을 빼지 않은 원래 글 그대로)
    const chars = characterTextsOf(cs.characters).map((c) => ({ ...c, prompt: cs.characters.find((x) => x.id === c.id)?.prompt ?? c.prompt }))
    const { fields, characters, notes } = applyVariantToFields({ basePrompt: g.basePrompt, additionalPrompt: g.additionalPrompt, detailPrompt: g.detailPrompt }, row, chars)
    if (!notes.length) {
        toast({ title: tr('comfy.variation.applyNoChange', '프롬프트가 이미 이 조합과 같습니다') })
        return
    }
    if (fields.basePrompt !== g.basePrompt) g.setBasePrompt(fields.basePrompt)
    if (fields.additionalPrompt !== g.additionalPrompt) g.setAdditionalPrompt(fields.additionalPrompt)
    if (fields.detailPrompt !== g.detailPrompt) g.setDetailPrompt(fields.detailPrompt)
    for (const c of characters) cs.updateCharacter(c.id, { prompt: c.prompt })
    const retargeted = useVariationStore.getState().retargetVariables(row.changes)
    toast({
        title: tr('comfy.variation.applied', '이 조합을 왼쪽 프롬프트에 적용했습니다'),
        description: createElement('div', { className: 'whitespace-pre-line' }, [
            ...notes,
            retargeted > 0 ? tr('comfy.variation.retargeted', '변수의 [바꿀 글]도 새 값으로 바꿔 두어, 이어서 다른 요소를 비교할 수 있습니다.') : '',
        ].filter(Boolean).join('\n')),
        variant: 'success',
    })
}

export async function revealJob(job: VariationJob): Promise<void> {
    const path = job.hqPath && !isMemoryPath(job.hqPath) ? job.hqPath : job.path
    if (!path || isMemoryPath(path)) {
        toast({ title: tr('comfy.variation.notOnDisk', '이 그림은 파일로 저장되지 않았습니다'), variant: 'destructive' })
        return
    }
    try {
        await revealItemInDir(path)
    } catch (e) {
        toast({ title: tr('comfy.variation.openFolderFailed', '폴더를 열지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
    }
}

export async function openRunFolder(run: VariationRun): Promise<void> {
    try {
        await openPath(await variationFolder(run.name))
    } catch (e) {
        toast({ title: tr('comfy.variation.openFolderFailed', '폴더를 열지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
    }
}
