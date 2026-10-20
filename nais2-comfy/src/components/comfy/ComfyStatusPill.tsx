// 왼쪽 위 ComfyUI 연결 표시 (NAIS2의 Anlas 표시 자리)
//   초록: 연결됨 (마우스를 올리면 주소·버전·그래픽카드·목록 개수)
//   노랑: 확인 중
//   빨강: 꺼짐 (누르면 켜는 방법 안내)
// 옆의 작은 표시는 지금 돌고 있는 '고화질로 다시 그리기' 개수다.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { useComfyStore } from '@/stores/comfy-store'
import { onUpscaleCount } from '@/lib/comfy-params'
import { cn } from '@/lib/utils'

export type ComfyDisplayStatus = 'online' | 'checking' | 'offline'

/**
 * 화면에 보일 상태. 연결된 뒤 몇십 초마다 하는 재확인 때문에 표시가 깜박이지 않도록,
 * 이미 연결됐거나 꺼진 것을 알고 있으면 확인하는 동안에도 그 상태를 그대로 보여 준다.
 * (직접 '다시 확인'을 누른 경우에만 노란색으로 바꾼다)
 */
export function useComfyDisplayStatus(manualCheck = false): ComfyDisplayStatus {
    const status = useComfyStore((s) => s.status)
    const [settled, setSettled] = useState<'online' | 'offline' | null>(
        status === 'online' || status === 'offline' ? status : null,
    )
    useEffect(() => {
        if (status === 'online' || status === 'offline') setSettled(status)
    }, [status])
    if (status === 'online') return 'online'
    if (status === 'offline') return 'offline'
    if (!manualCheck && settled) return settled
    return 'checking'
}

/** 지금 돌고 있는 '고화질로 다시 그리기' 개수 */
export function useComfyUpscaleCount(): number {
    const [count, setCount] = useState(0)
    useEffect(() => {
        const off = onUpscaleCount(setCount)
        return () => {
            off()
        }
    }, [])
    return count
}

export function ComfyUpscaleBadge({ className }: { className?: string }) {
    const { t } = useTranslation()
    const count = useComfyUpscaleCount()
    if (count <= 0) return null
    return (
        <Tip content={t('comfy.status.upscaleRunning', '고화질로 다시 그리는 중: {{count}}장. 끝나면 원본 옆에 저장되고 오른쪽 기록에 뜹니다.', { count })}>
            <div
                className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-semibold',
                    'bg-violet-500/10 border-violet-500/30 text-violet-500 animate-in fade-in slide-in-from-right-2',
                    className,
                )}
            >
                <Sparkles className="h-3 w-3" />
                <span className="tabular-nums">{count}</span>
                <Loader2 className="h-3 w-3 animate-spin" />
            </div>
        </Tip>
    )
}

const DOT: Record<ComfyDisplayStatus, string> = {
    online: 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/70',
    checking: 'bg-amber-500 animate-pulse',
    offline: 'bg-red-500',
}

const PILL: Record<ComfyDisplayStatus, string> = {
    online: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15',
    checking: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15',
    offline: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/15',
}

export function ComfyStatusPill({ className }: { className?: string }) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const url = useComfyStore((s) => s.url)
    const version = useComfyStore((s) => s.version)
    const device = useComfyStore((s) => s.device)
    const error = useComfyStore((s) => s.error)
    const checkpointCount = useComfyStore((s) => s.lists.checkpoints.length)
    const loraCount = useComfyStore((s) => s.lists.loras.length)
    const rawStatus = useComfyStore((s) => s.status)
    const [manualCheck, setManualCheck] = useState(false)
    const [open, setOpen] = useState(false)
    const status = useComfyDisplayStatus(manualCheck)

    useEffect(() => {
        if (rawStatus !== 'checking') setManualCheck(false)
    }, [rawStatus])

    const recheck = () => {
        setManualCheck(true)
        void useComfyStore.getState().refresh()
    }

    const openSettings = () => {
        setOpen(false)
        navigate('/settings?section=comfy')
    }

    const label = status === 'online'
        ? t('comfy.status.online', 'ComfyUI 연결됨')
        : status === 'checking'
            ? t('comfy.status.checking', 'ComfyUI 확인 중')
            : t('comfy.status.offline', 'ComfyUI 꺼짐')

    const details = (
        <span className="block space-y-0.5 text-left">
            <span className="block font-medium">{label}</span>
            <span className="block opacity-80">{t('comfy.status.address', '주소')}: {url}</span>
            {status === 'online' && version && <span className="block opacity-80">{t('comfy.status.version', '버전')}: {version}</span>}
            {status === 'online' && device && <span className="block opacity-80">{t('comfy.status.device', '그래픽카드')}: {device}</span>}
            {status === 'online' && (
                <span className="block opacity-80">
                    {t('comfy.status.counts', '체크포인트 {{ckpt}}개 · LoRA {{lora}}개', { ckpt: checkpointCount, lora: loraCount })}
                </span>
            )}
            {status !== 'online' && <span className="block opacity-80">{t('comfy.status.clickForHelp', '눌러서 켜는 방법을 확인하세요')}</span>}
        </span>
    )

    return (
        <div className={cn('flex items-center gap-1.5 min-w-0', className)}>
            <ComfyUpscaleBadge />
            <Popover open={open} onOpenChange={setOpen}>
                <Tip content={details} side="bottom" align="end" disabled={open}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors',
                                PILL[status],
                            )}
                            aria-label={label}
                        >
                            <span className={cn('h-2 w-2 rounded-full shrink-0', DOT[status])} />
                            <span>{label}</span>
                        </button>
                    </PopoverTrigger>
                </Tip>
                <PopoverContent align="end" className="w-80 rounded-xl space-y-3 text-sm">
                    {status === 'online' ? (
                        <>
                            <div className="flex items-center gap-2 font-semibold">
                                <span className={cn('h-2 w-2 rounded-full', DOT.online)} />
                                {t('comfy.status.onlineTitle', 'ComfyUI와 연결되어 있습니다')}
                            </div>
                            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                                <dt className="text-muted-foreground">{t('comfy.status.address', '주소')}</dt>
                                <dd className="font-mono break-all">{url}</dd>
                                {version && (
                                    <>
                                        <dt className="text-muted-foreground">{t('comfy.status.version', '버전')}</dt>
                                        <dd>{version}</dd>
                                    </>
                                )}
                                {device && (
                                    <>
                                        <dt className="text-muted-foreground">{t('comfy.status.device', '그래픽카드')}</dt>
                                        <dd className="break-words">{device}</dd>
                                    </>
                                )}
                                <dt className="text-muted-foreground">{t('comfy.status.lists', '목록')}</dt>
                                <dd>{t('comfy.status.counts', '체크포인트 {{ckpt}}개 · LoRA {{lora}}개', { ckpt: checkpointCount, lora: loraCount })}</dd>
                            </dl>
                            {checkpointCount === 0 && (
                                <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                                    {t('comfy.status.noCheckpoints', '체크포인트가 하나도 없습니다. ComfyUI 폴더의 models/checkpoints 에 모델 파일을 넣고 [다시 확인]을 누르세요.')}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {t('comfy.status.recheckHint', '모델·LoRA 파일을 새로 넣었다면 [다시 확인]을 누르면 목록에 나타납니다.')}
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 font-semibold">
                                <span className={cn('h-2 w-2 rounded-full', DOT[status])} />
                                {status === 'checking'
                                    ? t('comfy.status.checkingTitle', 'ComfyUI를 찾는 중입니다…')
                                    : t('comfy.status.offlineTitle', 'ComfyUI에 연결되지 않았습니다')}
                            </div>
                            <p className="text-xs leading-relaxed">
                                {t(
                                    'comfy.status.howToStart',
                                    'ComfyUI를 먼저 켜세요 (포터블: run_nvidia_gpu.bat). 기본 주소는 http://127.0.0.1:8188 이고, 다르면 설정 → ComfyUI에서 바꿉니다',
                                )}
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {t('comfy.status.startedHint', 'ComfyUI 창에 "To see the GUI go to: http://…" 가 보이면 켜진 것입니다. 켜진 뒤 [다시 확인]을 누르세요. 이 앱은 15초마다 저절로 다시 확인합니다.')}
                            </p>
                            <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                                <span className="text-muted-foreground">{t('comfy.status.currentAddress', '지금 찾는 주소')}: </span>
                                <span className="font-mono break-all">{url}</span>
                            </div>
                            {error && status === 'offline' && (
                                <p className="text-[11px] text-muted-foreground break-words">{error}</p>
                            )}
                        </>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={openSettings}>
                            <Settings className="h-3.5 w-3.5 mr-1.5" />
                            {t('comfy.status.openSettings', '설정 → ComfyUI')}
                        </Button>
                        <Button size="sm" className="h-8 rounded-lg" onClick={recheck} disabled={rawStatus === 'checking'}>
                            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', rawStatus === 'checking' && 'animate-spin')} />
                            {t('comfy.status.recheck', '다시 확인')}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
}
