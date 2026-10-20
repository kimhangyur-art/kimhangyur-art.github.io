// 생성 설정 화면에서 같이 쓰는 작은 부품들
// (슬라이더+숫자 입력, 목록에 없는 값도 지키는 선택 상자, 검색되는 파일 고르기, 구역 제목)
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ChevronDown, RefreshCw, Search } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useComfyStore } from '@/stores/comfy-store'
import { cn } from '@/lib/utils'

export function clampNumber(v: number, min: number, max: number): number {
    if (!Number.isFinite(v)) return min
    return Math.min(max, Math.max(min, v))
}

function decimalsOf(step: number): number {
    const s = String(step)
    const dot = s.indexOf('.')
    return dot === -1 ? 0 : s.length - dot - 1
}

/** step 단위로 맞추고 소수점 찌꺼기를 없앤다 (0.1+0.2 같은 문제) */
export function snapToStep(v: number, step: number, min = 0): number {
    const d = decimalsOf(step)
    const snapped = Math.round((v - min) / step) * step + min
    return Number(snapped.toFixed(d))
}

/** "폴더\\이름.safetensors" → { name: '이름', folder: '폴더' } */
export function prettyFileName(path: string): { name: string; folder: string } {
    const parts = path.split(/[\\/]/)
    const file = parts.pop() ?? path
    return {
        name: file.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, ''),
        folder: parts.join('/'),
    }
}

// ---------------------------------------------------------------------------

interface SliderNumberProps {
    label: ReactNode
    value: number
    onChange: (v: number) => void
    min: number
    max: number
    step: number
    /** 숫자 칸에서는 슬라이더 범위를 넘는 값도 받을지 (예: 스텝 직접 입력) */
    inputMin?: number
    inputMax?: number
    hint?: ReactNode
    disabled?: boolean
    className?: string
    /** 슬라이더 오른쪽 숫자 칸 너비 */
    inputClassName?: string
}

/** 슬라이더와 숫자 입력 칸. 숫자 칸은 입력을 마치면(Enter·포커스 이동) 반영한다 */
export function SliderNumber({
    label, value, onChange, min, max, step, inputMin, inputMax, hint, disabled, className, inputClassName,
}: SliderNumberProps) {
    const d = decimalsOf(step)
    const [text, setText] = useState(value.toFixed(d))

    useEffect(() => {
        setText(value.toFixed(d))
    }, [value, d])

    const commit = () => {
        const n = parseFloat(text.replace(',', '.'))
        if (!Number.isFinite(n)) {
            setText(value.toFixed(d))
            return
        }
        const v = snapToStep(clampNumber(n, inputMin ?? min, inputMax ?? max), step, 0)
        onChange(v)
        setText(v.toFixed(d))
    }

    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">{label}</Label>
                <Input
                    type="text"
                    inputMode="decimal"
                    value={text}
                    disabled={disabled}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            commit()
                        }
                    }}
                    className={cn('h-7 w-16 rounded-lg px-2 text-right text-xs tabular-nums', inputClassName)}
                />
            </div>
            <Slider
                value={[clampNumber(value, min, max)]}
                onValueChange={([v]) => onChange(snapToStep(v, step, 0))}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                className="w-full"
            />
            {hint && <ParamsHint>{hint}</ParamsHint>}
        </div>
    )
}

// ---------------------------------------------------------------------------

export interface OptionItem {
    value: string
    label?: ReactNode
}

interface OptionSelectProps {
    value: string
    options: Array<string | OptionItem>
    onChange: (v: string) => void
    placeholder?: string
    disabled?: boolean
    className?: string
    /** 목록에 없는 값 옆에 붙일 글 */
    unknownSuffix?: string
}

/** 고르기 상자. 지금 값이 목록에 없어도(ComfyUI가 꺼져 있거나 이름이 바뀐 경우) 지우지 않고 보여 준다 */
export function OptionSelect({ value, options, onChange, placeholder, disabled, className, unknownSuffix }: OptionSelectProps) {
    const { t } = useTranslation()
    const items: OptionItem[] = options.map((o) => (typeof o === 'string' ? { value: o } : o)).filter((o) => o.value !== '')
    const known = items.some((o) => o.value === value)
    const suffix = unknownSuffix ?? t('comfy.params.notInList', '(목록에 없음)')
    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={cn('rounded-xl', className)}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {value && !known && (
                    <SelectItem value={value}>
                        {value} <span className="text-muted-foreground">{suffix}</span>
                    </SelectItem>
                )}
                {items.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label ?? o.value}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

// ---------------------------------------------------------------------------

interface FilePickerProps {
    value: string
    files: string[]
    onChange: (v: string) => void
    placeholder: string
    emptyText: ReactNode
    disabled?: boolean
    className?: string
}

/** 체크포인트·LoRA처럼 많은 파일에서 하나 고르기 (이름 검색 가능) */
export function FilePicker({ value, files, onChange, placeholder, emptyText, disabled, className }: FilePickerProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')

    useEffect(() => {
        if (!open) setQuery('')
    }, [open])

    const known = !value || files.includes(value)
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        const all = known ? files : [value, ...files]
        if (!q) return all
        return all.filter((f) => f.toLowerCase().includes(q))
    }, [files, query, known, value])

    const current = value ? prettyFileName(value) : null

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn('w-full justify-between rounded-xl font-normal min-w-0', className)}
                    title={value || undefined}
                >
                    <span className={cn('truncate text-left', !current && 'text-muted-foreground')}>
                        {current ? current.name : placeholder}
                        {current?.folder && <span className="ml-1.5 text-xs text-muted-foreground">{current.folder}</span>}
                        {value && !known && (
                            <span className="ml-1.5 text-xs text-amber-500">{t('comfy.params.notInList', '(목록에 없음)')}</span>
                        )}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="p-0"
                align="start"
                style={{ width: 'max(var(--radix-popover-trigger-width), 280px)' }}
            >
                <div className="p-2 border-b">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('comfy.params.searchFile', '이름으로 찾기...')}
                            className="h-8 pl-8 text-sm rounded-lg"
                        />
                    </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                            {files.length === 0 ? emptyText : t('comfy.params.noMatch', '찾는 이름이 없습니다')}
                        </div>
                    ) : (
                        filtered.map((f) => {
                            const p = prettyFileName(f)
                            const selected = f === value
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => {
                                        onChange(f)
                                        setOpen(false)
                                    }}
                                    title={f}
                                    className={cn(
                                        'flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm text-left hover:bg-accent hover:text-accent-foreground cursor-pointer',
                                        selected && 'bg-accent'
                                    )}
                                >
                                    {selected ? <Check className="h-4 w-4 shrink-0" /> : <span className="w-4 shrink-0" />}
                                    <span className="truncate flex-1">{p.name}</span>
                                    {p.folder && <span className="text-xs text-muted-foreground truncate max-w-[40%]">{p.folder}</span>}
                                </button>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}

// ---------------------------------------------------------------------------

interface ParamsSectionProps {
    id?: string
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    /** 제목 줄 오른쪽 (스위치, 버튼 등) */
    action?: ReactNode
    children?: ReactNode
    className?: string
}

/** 설정 창의 한 구역 (제목 + 한 줄 설명 + 내용) */
export function ParamsSection({ id, icon, title, description, action, children, className }: ParamsSectionProps) {
    return (
        <section id={id} className={cn('space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4 scroll-mt-2', className)}>
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        {icon}
                        {title}
                    </h3>
                    {description && <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            {children}
        </section>
    )
}

export function ParamsHint({ children, className }: { children: ReactNode; className?: string }) {
    return <p className={cn('text-xs text-muted-foreground leading-relaxed', className)}>{children}</p>
}

// ---------------------------------------------------------------------------

/**
 * 설정 창을 열 때 ComfyUI 상태를 아직 모르거나 꺼져 있었으면 한 번 다시 확인하고 목록을 받아 온다
 * (ComfyUI를 나중에 켰거나 새 파일을 넣은 경우에도 바로 보이게)
 */
export function useComfyAutoRefresh(active: boolean) {
    useEffect(() => {
        if (!active) return
        const s = useComfyStore.getState()
        if (s.status === 'unknown' || s.status === 'offline') void s.refresh()
    }, [active])
}

/** ComfyUI 목록(체크포인트·LoRA·샘플러…)을 다시 받아 오는 작은 버튼 */
export function ComfyRefreshButton({ className }: { className?: string }) {
    const { t } = useTranslation()
    const status = useComfyStore((s) => s.status)
    const checking = status === 'checking'
    return (
        <Tip content={t('comfy.params.refreshTip', 'ComfyUI에서 체크포인트·LoRA 목록을 다시 불러옵니다 (파일을 새로 넣었을 때)')}>
            <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('h-9 w-9 rounded-xl shrink-0', className)}
                disabled={checking}
                onClick={() => { void useComfyStore.getState().refresh() }}
            >
                <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
            </Button>
        </Tip>
    )
}

/** ComfyUI가 꺼져 있을 때 보여 주는 안내 */
export function ComfyOfflineHint({ className }: { className?: string }) {
    const { t } = useTranslation()
    const status = useComfyStore((s) => s.status)
    if (status !== 'offline') return null
    return (
        <p className={cn('flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400', className)}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {t('comfy.params.offline', 'ComfyUI가 꺼져 있거나 주소가 다릅니다 (설정 → ComfyUI)')}
        </p>
    )
}
