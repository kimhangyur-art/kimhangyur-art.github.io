// 비교표의 칸 하나: 그림 / 그리는 중(미리보기·진행률) / 대기 / 실패
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ImageOff, Loader2, RotateCcw, Star } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVariationLive, useVariationStore, type VariationJob } from '@/stores/variation-store'
import { jobImageSrc } from './actions'

interface VariationCellProps {
    runId: string
    job: VariationJob
    /** 칸 너비(px) */
    width: number
    /** 가로/세로 비율 */
    aspect: number
    /** 이 묶음이 지금 그려지는 중 */
    runActive: boolean
    /** 다른 생성이 돌고 있어 다시 그리기를 못 함 */
    retryDisabled: boolean
    onOpen: (jobId: string) => void
}

export const VariationCell = memo(function VariationCell({ runId, job, width, aspect, runActive, retryDisabled, onOpen }: VariationCellProps) {
    const { t } = useTranslation()
    const live = useVariationLive((s) => (s.jobId === job.id ? s : null))
    const memoryImage = useVariationLive((s) => s.memoryImages[job.id])
    const hqProgress = useVariationLive((s) => s.hq[job.id])
    const [broken, setBroken] = useState<string | null>(null)

    const src = job.status === 'done' ? jobImageSrc(job, memoryImage ? { [job.id]: memoryImage } : {}) : null
    const style = { width, aspectRatio: String(aspect) }
    const base = 'relative shrink-0 overflow-hidden rounded-lg border'

    if (job.status === 'done' && src && broken !== src) {
        return (
            <div className={cn(base, 'group cursor-pointer border-border/60 bg-muted/30', job.favorite && 'ring-2 ring-amber-400/70')} style={style} onClick={() => onOpen(job.id)}>
                <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" onError={() => setBroken(src)} />
                <button
                    type="button"
                    className={cn(
                        'absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white backdrop-blur-sm transition-opacity hover:bg-black/70',
                        job.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                    onClick={(e) => {
                        e.stopPropagation()
                        useVariationStore.getState().toggleFavorite(runId, job.id)
                    }}
                    title={job.favorite ? t('comfy.variation.unfavorite', '즐겨찾기 풀기') : t('comfy.variation.favorite', '즐겨찾기')}
                >
                    <Star className={cn('h-3.5 w-3.5', job.favorite && 'fill-amber-400 text-amber-400')} />
                </button>
                {job.hqPath && (
                    <span className="absolute bottom-1 left-1 rounded bg-sky-500/90 px-1.5 py-px text-[10px] font-semibold text-white">
                        {t('comfy.variation.hqBadge', '고화질')}
                    </span>
                )}
                {hqProgress !== undefined && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-[11px] tabular-nums">{t('comfy.variation.hqProgress', '고화질 {{pct}}%', { pct: Math.round(hqProgress) })}</span>
                    </div>
                )}
            </div>
        )
    }

    if (job.status === 'done') {
        // 파일을 옮겼거나 지웠다
        return (
            <div className={cn(base, 'flex flex-col items-center justify-center gap-1 border-dashed border-border/70 bg-muted/20 p-2 text-center text-[11px] text-muted-foreground')} style={style}>
                <ImageOff className="h-5 w-5" />
                {t('comfy.variation.fileMissing', '파일을 찾을 수 없습니다 (옮겼거나 지웠을 수 있습니다)')}
            </div>
        )
    }

    if (job.status === 'running') {
        const pct = live ? Math.round(live.progress) : 0
        return (
            <div className={cn(base, 'border-primary/60 bg-muted/30')} style={style}>
                {live?.preview ? (
                    <img src={live.preview} alt="" className="h-full w-full object-cover opacity-90" />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-[11px]">{t('comfy.variation.drawing', '그리는 중')}</span>
                    </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 pb-1 pt-0.5">
                    <div className="h-1 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 text-right text-[10px] tabular-nums text-white">{pct}%</div>
                </div>
            </div>
        )
    }

    if (job.status === 'failed') {
        return (
            <div className={cn(base, 'flex flex-col items-center justify-center gap-1.5 border-red-500/50 bg-red-500/10 p-2 text-center')} style={style}>
                <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400" />
                <span className="line-clamp-4 text-[10px] leading-snug text-red-600 dark:text-red-300" title={job.error}>
                    {job.error || t('comfy.variation.failed', '그리지 못했습니다')}
                </span>
                <Tip content={t('comfy.variation.retryTip', '이 칸만 다시 그립니다 (같은 시드, 지금 왼쪽 프롬프트로)')}>
                    <button
                        type="button"
                        className="mt-0.5 flex items-center gap-1 rounded-md border border-red-500/50 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-300"
                        disabled={retryDisabled}
                        onClick={() => void useVariationStore.getState().resume(runId, [job.id])}
                    >
                        <RotateCcw className="h-3 w-3" />
                        {t('comfy.variation.retry', '다시 그리기')}
                    </button>
                </Tip>
            </div>
        )
    }

    return (
        <div className={cn(base, 'flex items-center justify-center border-dashed border-border/70 bg-muted/10 text-[11px] text-muted-foreground')} style={style}>
            {runActive ? t('comfy.variation.queued', '대기 중') : t('comfy.variation.notDrawn', '아직 안 그림')}
        </div>
    )
})
