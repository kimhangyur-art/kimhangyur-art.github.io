// 왼쪽 프롬프트를 합친 모습 (읽기 전용). 변수의 '바꿀 글'이 있는 곳을 칠해 보여 준다.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { findRanges } from '@/lib/variation'

export interface PreviewBlock {
    /** 캐릭터 프롬프트면 이름 */
    label?: string
    text: string
}

interface PromptPreviewProps {
    blocks: PreviewBlock[]
    /** 칠할 글 (켜 둔 변수의 바꿀 글) */
    finds: string[]
}

function highlight(text: string, finds: string[]): Array<{ text: string; hit: boolean }> {
    const ranges = findRanges(text, finds)
    const out: Array<{ text: string; hit: boolean }> = []
    let at = 0
    for (const r of ranges) {
        if (r.start > at) out.push({ text: text.slice(at, r.start), hit: false })
        out.push({ text: text.slice(r.start, r.end), hit: true })
        at = r.end
    }
    if (at < text.length) out.push({ text: text.slice(at), hit: false })
    return out
}

export function PromptPreview({ blocks, finds }: PromptPreviewProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(true)
    const shown = useMemo(
        () => blocks.filter((b) => b.text.trim()).map((b) => ({ label: b.label, parts: highlight(b.text, finds) })),
        [blocks, finds],
    )

    return (
        <div className="rounded-xl border border-border/60 bg-muted/20">
            <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setOpen((v) => !v)}
            >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <FileText className="h-3.5 w-3.5" />
                {t('comfy.variation.previewTitle', '기준 프롬프트 (왼쪽 기본·추가·세부 프롬프트와 켜 둔 캐릭터 프롬프트)')}
            </button>
            {open && (
                <div className="px-3 pb-3">
                    {shown.length ? (
                        <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed">
                            {shown.map((b, bi) => (
                                <div key={bi} className="whitespace-pre-wrap break-words">
                                    {b.label && <span className="mr-1.5 rounded bg-muted px-1 py-px font-sans text-[10px] text-muted-foreground">{b.label}</span>}
                                    {b.parts.map((p, i) => (
                                        <span
                                            key={i}
                                            className={cn(p.hit && 'rounded bg-amber-400/25 px-0.5 text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-200')}
                                        >
                                            {p.text}
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                            {t('comfy.variation.previewEmpty', '왼쪽 프롬프트가 비어 있습니다. 먼저 캐릭터의 기본 프롬프트(의상·체형 등)를 적어 주세요.')}
                        </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {t('comfy.variation.previewHint', '노랗게 칠한 곳이 후보로 바뀌는 글입니다. 조각 프롬프트(<…>, a/b)는 그릴 때마다 먼저 풀린 뒤에 바뀝니다.')}
                    </p>
                </div>
            )}
        </div>
    )
}
