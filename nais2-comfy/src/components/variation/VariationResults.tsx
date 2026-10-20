// 변형 모드 아래: 묶음 고르기와 비교표 (줄 = 변형, 열 = 같은 시드)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, FolderOpen, Images, ListRestart, Loader2, Maximize2, PauseCircle, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'
import { MAX_RUNS, useVariationLive, useVariationStore, type CellSize, type VariationJob, type VariationRun } from '@/stores/variation-store'
import { favoritesToUpscale, openRunFolder, toggleUpscaleFavorites } from './actions'
import { VariationCell } from './VariationCell'
import { VariationViewer } from './VariationViewer'

const CELL_WIDTH: Record<CellSize, number> = { sm: 120, md: 180, lg: 260 }
const MODE_LABEL: Record<VariationRun['mode'], [string, string]> = {
    each: ['comfy.variation.modeEach', '하나씩 바꾸기'],
    all: ['comfy.variation.modeAll', '모든 조합'],
    random: ['comfy.variation.modeRandom', '무작위 N개'],
}

function formatTime(ms: number): string {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function countDone(run: VariationRun): number {
    return run.jobs.filter((j) => j.status === 'done').length
}

export function VariationResults() {
    const { t } = useTranslation()
    const runs = useVariationStore((s) => s.runs)
    const selectedRunId = useVariationStore((s) => s.selectedRunId)
    const activeRunId = useVariationStore((s) => s.activeRunId)
    const isRunning = useVariationStore((s) => s.isRunning)
    const cellSize = useVariationStore((s) => s.cellSize)
    const hqBatchRunId = useVariationLive((s) => s.hqBatchRunId)
    const generatingMode = useGenerationStore((s) => s.generatingMode)
    const mainGenerating = useGenerationStore((s) => s.isGenerating)

    const [viewJobId, setViewJobId] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)

    const run = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null
    const store = useVariationStore.getState()
    const otherBusy = generatingMode === 'main' || generatingMode === 'scene' || mainGenerating
    const runActive = !!run && activeRunId === run.id
    const cantDraw = isRunning || otherBusy

    // 줄마다 칸을 모아 둔다
    const grid = useMemo(() => {
        if (!run) return [] as VariationJob[][]
        const rows: VariationJob[][] = run.rows.map(() => [])
        for (const j of run.jobs) rows[j.row]?.push(j)
        rows.forEach((r) => r.sort((a, b) => a.col - b.col))
        return rows
    }, [run])

    const openCell = useCallback((jobId: string) => setViewJobId(jobId), [])

    // 새로 그리기 시작하면 비교표가 보이게 내린다 (생성 버튼이 어느 쪽이든)
    const sectionRef = useRef<HTMLElement>(null)
    const lastActive = useRef<string | null>(activeRunId)
    useEffect(() => {
        if (activeRunId && activeRunId !== lastActive.current) {
            sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        lastActive.current = activeRunId
    }, [activeRunId])

    if (!run) {
        return (
            <section className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
                <Images className="h-10 w-10 text-muted-foreground/60" />
                <p className="text-sm font-medium">{t('comfy.variation.noRuns', '아직 그린 묶음이 없습니다')}</p>
                <p className="max-w-md text-xs text-muted-foreground">
                    {t('comfy.variation.noRunsDesc', '위에서 바꿔 볼 요소와 후보를 적고 [변형 생성]을 누르면, 여기에 줄마다 비교할 수 있게 그림이 나란히 놓입니다.')}
                </p>
            </section>
        )
    }

    const done = countDone(run)
    const failed = run.jobs.filter((j) => j.status === 'failed').length
    const leftover = run.jobs.filter((j) => j.status === 'queued' || j.status === 'failed').length
    const favCount = run.jobs.filter((j) => j.favorite).length
    const favToHq = favoritesToUpscale(run).length
    const cellW = CELL_WIDTH[cellSize]
    const aspect = run.width > 0 && run.height > 0 ? run.width / run.height : 832 / 1216
    const labelW = cellSize === 'sm' ? 130 : 170

    return (
        <section ref={sectionRef} className="scroll-mt-2 rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
            {/* 묶음 고르기와 도구 */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[220px] max-w-[360px] flex-1">
                    <Select value={run.id} onValueChange={(id) => store.selectRun(id)}>
                        <SelectTrigger className="h-9 rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[320px]">
                            {runs.map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                    {r.name} · {countDone(r)}/{r.jobs.length}{t('comfy.variation.sheets', '장')} · {formatTime(r.createdAt)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <span
                    className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                        runActive ? 'bg-primary/15 text-primary' : run.status === 'done' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                    )}
                >
                    {runActive ? <Loader2 className="h-3 w-3 animate-spin" /> : run.status === 'done' ? <CheckCircle2 className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
                    {runActive
                        ? t('comfy.variation.statusRunning', '그리는 중 {{done}}/{{total}}', { done, total: run.jobs.length })
                        : run.status === 'done'
                            ? failed > 0
                                ? t('comfy.variation.statusDoneFail', '끝남 · {{failed}}장 실패', { failed })
                                : t('comfy.variation.statusDone', '다 그렸습니다')
                            : t('comfy.variation.statusStopped', '멈춤 · 남은 칸 {{count}}개', { count: leftover })}
                </span>

                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {leftover > 0 && !runActive && (
                        <Tip content={otherBusy ? t('comfy.variation.busyOther', '다른 화면에서 생성 중입니다. 끝난 뒤에 누르세요.') : t('comfy.variation.resumeTip', '아직 안 그린 칸과 실패한 칸을 같은 시드로 이어서 그립니다. 프롬프트는 지금 왼쪽 프롬프트를 씁니다.')}>
                            <span>
                                <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => void store.resume(run.id)} disabled={cantDraw}>
                                    <ListRestart className="h-3.5 w-3.5" />
                                    {t('comfy.variation.resume', '남은 칸 이어서 그리기 ({{count}})', { count: leftover })}
                                </Button>
                            </span>
                        </Tip>
                    )}
                    <Tip content={hqBatchRunId === run.id
                        ? t('comfy.variation.hqBatchStopTip', '즐겨찾기 고화질 작업을 멈춥니다')
                        : t('comfy.variation.hqBatchTip', '별표(즐겨찾기)한 그림을 차례로 고화질로 다시 그립니다. 시드는 필요 없습니다.')}>
                        <span>
                            <Button
                                variant={hqBatchRunId === run.id ? 'destructive' : 'outline'}
                                size="sm"
                                className="h-8 gap-1.5 rounded-lg"
                                onClick={() => void toggleUpscaleFavorites(run.id)}
                                disabled={hqBatchRunId !== null && hqBatchRunId !== run.id}
                            >
                                {hqBatchRunId === run.id ? <Square className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                                {hqBatchRunId === run.id
                                    ? t('comfy.variation.hqBatchStop', '고화질 멈추기')
                                    : t('comfy.variation.hqBatch', '즐겨찾기 고화질로 ({{count}})', { count: favToHq })}
                            </Button>
                        </span>
                    </Tip>
                    <Tip content={t('comfy.variation.openRunFolder', '이 묶음의 그림이 저장된 폴더를 엽니다')}>
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => void openRunFolder(run)}>
                            <FolderOpen className="h-4 w-4" />
                        </Button>
                    </Tip>
                    <div className="flex items-center rounded-lg border border-border/60 bg-background/50 p-0.5">
                        {(['sm', 'md', 'lg'] as CellSize[]).map((size) => (
                            <button
                                key={size}
                                type="button"
                                onClick={() => store.setCellSize(size)}
                                className={cn('rounded-md px-2 py-1 text-xs', cellSize === size ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
                                title={t('comfy.variation.cellSize', '칸 크기')}
                            >
                                {size === 'sm' ? t('comfy.variation.sizeS', '작게') : size === 'md' ? t('comfy.variation.sizeM', '보통') : t('comfy.variation.sizeL', '크게')}
                            </button>
                        ))}
                    </div>
                    <Tip content={runActive ? t('comfy.variation.deleteRunning', '그리는 중인 묶음은 지울 수 없습니다') : t('comfy.variation.deleteRunTip', '목록에서만 지웁니다. 그림 파일은 폴더에 그대로 남습니다.')}>
                        <span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setConfirmDelete(true)}
                                disabled={runActive}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </span>
                    </Tip>
                </div>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
                {[
                    t(MODE_LABEL[run.mode][0], MODE_LABEL[run.mode][1]),
                    run.sameSeed ? t('comfy.variation.sameSeedShort', '같은 시드로 비교') : t('comfy.variation.randomSeedShort', '그림마다 새 시드'),
                    `${run.width}×${run.height}`,
                    run.checkpoint,
                    favCount > 0 ? t('comfy.variation.favCount', '즐겨찾기 {{count}}장', { count: favCount }) : '',
                ].filter(Boolean).join(' · ')}
                <span className="ml-1">{t('comfy.variation.keepRuns', '(최근 {{max}}묶음까지 기억합니다)', { max: MAX_RUNS })}</span>
            </p>

            {/* 비교표 */}
            <div className="mt-3 overflow-x-auto rounded-xl border border-border/50">
                <div className="inline-block min-w-full">
                    {/* 열 머리 */}
                    <div className="flex items-end gap-2 border-b border-border/50 bg-background px-2 py-1.5">
                        <div className="sticky left-0 z-10 shrink-0 bg-background text-[11px] font-medium text-muted-foreground" style={{ width: labelW }}>
                            {t('comfy.variation.rowHeader', '바꾼 것')}
                        </div>
                        {Array.from({ length: run.perVariant }, (_, c) => (
                            <div key={c} className="shrink-0 text-center text-[11px] text-muted-foreground" style={{ width: cellW }}>
                                {run.sameSeed && run.seeds[c] !== undefined
                                    ? <Tip content={t('comfy.variation.seedColTip', '이 열의 그림은 모두 이 시드로 그렸습니다')}><span className="cursor-help font-mono">{t('comfy.variation.seedCol', '시드 {{seed}}', { seed: run.seeds[c] })}</span></Tip>
                                    : t('comfy.variation.colN', '{{n}}번째', { n: c + 1 })}
                            </div>
                        ))}
                    </div>

                    {/* 줄 */}
                    {run.rows.map((row, r) => (
                        <div key={`${row.key}-${r}`} className={cn('flex items-stretch gap-2 px-2 py-1.5', r % 2 === 1 && 'bg-muted/10')}>
                            <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center rounded-lg bg-background pr-1" style={{ width: labelW }}>
                                <span
                                    className={cn('line-clamp-3 break-words text-xs font-medium leading-snug', row.isBase && 'text-primary')}
                                    title={row.fullLabel}
                                >
                                    {row.label}
                                </span>
                                {!row.isBase && row.changes.length > 1 && (
                                    <span className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{row.changes.map((c) => c.name).filter(Boolean).join(' · ')}</span>
                                )}
                            </div>
                            {(grid[r] ?? []).map((job) => (
                                <VariationCell
                                    key={job.id}
                                    runId={run.id}
                                    job={job}
                                    width={cellW}
                                    aspect={aspect}
                                    runActive={runActive}
                                    retryDisabled={cantDraw}
                                    onOpen={openCell}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            <VariationViewer run={run} jobId={viewJobId} onChange={setViewJobId} />

            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={t('comfy.variation.deleteRunTitle', '이 묶음을 목록에서 지울까요?')}
                description={t('comfy.variation.deleteRunDesc', '"{{name}}" 묶음을 이 화면의 목록에서만 지웁니다. 저장된 그림 파일은 폴더에 그대로 남고, 라이브러리·기록 패널에서도 계속 볼 수 있습니다.', { name: run.name })}
                confirmText={t('comfy.variation.deleteRunConfirm', '목록에서 지우기')}
                variant="destructive"
                onConfirm={() => {
                    store.deleteRun(run.id)
                    setViewJobId(null)
                }}
            />
        </section>
    )
}
