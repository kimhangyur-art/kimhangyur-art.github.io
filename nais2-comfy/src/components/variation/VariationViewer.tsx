// 비교표에서 칸을 누르면 뜨는 크게 보기 창: 좌우로 넘기기, 이름표·시드·프롬프트, 고화질로 다시 그리기 등
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Copy, FolderOpen, Loader2, Maximize2, Star, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { jobPrompt, useVariationLive, useVariationStore, type VariationRun } from '@/stores/variation-store'
import { applyRowToPrompt, isMemoryPath, jobImageSrc, revealJob, upscaleVariationJob } from './actions'

interface VariationViewerProps {
    run: VariationRun
    jobId: string | null
    onChange: (jobId: string | null) => void
}

export function VariationViewer({ run, jobId, onChange }: VariationViewerProps) {
    const { t } = useTranslation()
    const memoryImages = useVariationLive((s) => s.memoryImages)
    const hq = useVariationLive((s) => s.hq)
    const [showOriginal, setShowOriginal] = useState(false)
    // 그리는 중에 왼쪽 프롬프트를 바꾸면 남은 그림이 달라지므로 적용을 막는다
    const variationRunning = useVariationStore((s) => s.isRunning)

    // 넘겨 볼 수 있는 칸: 다 그린 칸 (줄 순서, 칸 순서)
    const list = useMemo(
        () => run.jobs.filter((j) => j.status === 'done').sort((a, b) => a.row - b.row || a.col - b.col),
        [run.jobs],
    )
    const index = list.findIndex((j) => j.id === jobId)
    const job = index >= 0 ? list[index] : null
    const row = job ? run.rows[job.row] : undefined

    useEffect(() => setShowOriginal(false), [jobId])

    const go = useCallback(
        (delta: number) => {
            if (!list.length || index < 0) return
            const next = (index + delta + list.length) % list.length
            onChange(list[next].id)
        },
        [list, index, onChange],
    )

    useEffect(() => {
        if (!job) return
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            if (target?.closest('input, textarea')) return
            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                go(-1)
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                go(1)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [job, go])

    const src = job ? jobImageSrc(job, memoryImages, !showOriginal) : null
    const upscaling = job ? hq[job.id] : undefined
    const seedShared = run.sameSeed && job ? run.seeds[job.col] === job.seed : false

    const prompt = job ? jobPrompt(run, job) : undefined

    const copyPrompt = async () => {
        if (!prompt) return
        try {
            await navigator.clipboard.writeText(prompt)
            toast({ title: t('comfy.variation.promptCopied', '프롬프트를 복사했습니다'), variant: 'success' })
        } catch {
            toast({ title: t('comfy.variation.copyFailed', '복사하지 못했습니다'), variant: 'destructive' })
        }
    }

    return (
        <Dialog open={!!job} onOpenChange={(open) => !open && onChange(null)}>
            <DialogContent className="flex h-[88vh] max-w-6xl flex-col gap-0 overflow-hidden p-0 md:flex-row">
                {job && row && (
                    <>
                        {/* 그림 */}
                        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/80">
                            {src ? (
                                <img src={src} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                            ) : (
                                <span className="text-sm text-white/70">{t('comfy.variation.noImage', '이 칸에는 아직 그림이 없습니다.')}</span>
                            )}
                            {list.length > 1 && (
                                <>
                                    <button
                                        type="button"
                                        className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                                        onClick={() => go(-1)}
                                        aria-label={t('comfy.variation.prev', '이전 그림')}
                                    >
                                        <ChevronLeft className="h-6 w-6" />
                                    </button>
                                    <button
                                        type="button"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                                        onClick={() => go(1)}
                                        aria-label={t('comfy.variation.next', '다음 그림')}
                                    >
                                        <ChevronRight className="h-6 w-6" />
                                    </button>
                                </>
                            )}
                            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums text-white">
                                {index + 1} / {list.length}
                            </span>
                            {job.hqPath && !isMemoryPath(job.hqPath) && (
                                <div className="absolute left-3 top-3 flex overflow-hidden rounded-lg border border-white/20 bg-black/50 text-xs text-white">
                                    <button type="button" className={cn('px-2.5 py-1', !showOriginal && 'bg-sky-500/80')} onClick={() => setShowOriginal(false)}>
                                        {t('comfy.variation.hqBadge', '고화질')}
                                    </button>
                                    <button type="button" className={cn('px-2.5 py-1', showOriginal && 'bg-white/20')} onClick={() => setShowOriginal(true)}>
                                        {t('comfy.variation.original', '원본')}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* 정보와 버튼 */}
                        <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-border p-4 md:w-80 md:border-l md:border-t-0">
                            <div className="pr-6">
                                <DialogTitle className="text-base leading-snug">{row.fullLabel}</DialogTitle>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t('comfy.variation.viewerWhere', '{{row}}번째 줄 · {{col}}번째 장', { row: job.row + 1, col: job.col + 1 })}
                                </p>
                            </div>

                            <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">{t('comfy.variation.seed', '시드')}</span>
                                    <span className="font-mono tabular-nums">{job.seed}</span>
                                </div>
                                {seedShared && (
                                    <p className="text-[11px] text-muted-foreground">{t('comfy.variation.seedSharedNote', '같은 열의 다른 줄도 이 시드를 썼습니다')}</p>
                                )}
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">{t('comfy.variation.batch', '묶음')}</span>
                                    <span className="truncate" title={run.name}>{run.name}</span>
                                </div>
                            </div>

                            <div>
                                <div className="mb-1 flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">{t('comfy.variation.finalPrompt', '이 그림에 쓴 프롬프트')}</span>
                                    <Tip content={t('comfy.variation.copyPrompt', '프롬프트 복사')}>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyPrompt} disabled={!prompt}>
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </Tip>
                                </div>
                                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] leading-relaxed">
                                    {prompt || t('comfy.variation.noPrompt', '(기록 없음)')}
                                </div>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    {t('comfy.variation.finalPromptNote', '품질 태그·부정 프롬프트 프리셋은 그릴 때 따로 붙습니다.')}
                                </p>
                            </div>

                            <div className="mt-auto space-y-2">
                                <Tip content={t('comfy.variation.upscaleTip', '시드를 몰라도 이 그림에서 시작해 더 크게, 더 또렷하게 다시 그립니다. 원본은 그대로 남습니다.')}>
                                    <Button
                                        className="w-full justify-start gap-2"
                                        onClick={() => void upscaleVariationJob(run.id, job.id)}
                                        disabled={upscaling !== undefined}
                                    >
                                        {upscaling !== undefined ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
                                        {upscaling !== undefined
                                            ? t('comfy.variation.upscaling', '고화질로 그리는 중 {{pct}}%', { pct: Math.round(upscaling) })
                                            : t('comfy.upscale.action', '고화질로 다시 그리기')}
                                    </Button>
                                </Tip>
                                <Tip content={variationRunning
                                    ? t('comfy.variation.applyBusy', '변형을 그리는 중에는 쓸 수 없습니다 (남은 그림의 프롬프트까지 바뀝니다). 끝나거나 멈춘 뒤에 누르세요.')
                                    : t('comfy.variation.applyTip', '이 그림에서 바꾼 글을 왼쪽 프롬프트에 그대로 옮깁니다. 마음에 드는 조합을 정한 뒤 다른 요소를 이어서 비교할 때 쓰세요.')}>
                                    <span className="block">
                                    <Button variant="secondary" className="w-full justify-start gap-2" onClick={() => applyRowToPrompt(row)} disabled={row.isBase || variationRunning}>
                                        <Wand2 className="h-4 w-4" />
                                        {t('comfy.variation.apply', '이 조합을 프롬프트에 적용')}
                                    </Button>
                                    </span>
                                </Tip>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        className="flex-1 gap-2"
                                        onClick={() => useVariationStore.getState().toggleFavorite(run.id, job.id)}
                                    >
                                        <Star className={cn('h-4 w-4', job.favorite && 'fill-amber-400 text-amber-400')} />
                                        {job.favorite ? t('comfy.variation.unfavorite', '즐겨찾기 풀기') : t('comfy.variation.favorite', '즐겨찾기')}
                                    </Button>
                                    <Button variant="outline" className="flex-1 gap-2" onClick={() => void revealJob(job)} disabled={isMemoryPath(job.path)}>
                                        <FolderOpen className="h-4 w-4" />
                                        {t('comfy.variation.openFolder', '폴더 열기')}
                                    </Button>
                                </div>
                                <p className="text-center text-[10px] text-muted-foreground">{t('comfy.variation.viewerKeys', '← → 키로 넘겨 볼 수 있습니다')}</p>
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
