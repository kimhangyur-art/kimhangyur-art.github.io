// 변수 하나: 이름, 바꿀 글, 후보(한 줄에 하나)
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronUp, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { containsFind, detectFind, parseOptions, type VariationVariable } from '@/lib/variation'
import { useVariationStore } from '@/stores/variation-store'

interface VariableCardProps {
    variable: VariationVariable
    index: number
    count: number
    /** 바꿀 글을 찾는 글 (합친 프롬프트 + 캐릭터 프롬프트) */
    searchText: string
    disabled?: boolean
}

export const VariableCard = memo(function VariableCard({ variable, index, count, searchText, disabled }: VariableCardProps) {
    const { t } = useTranslation()
    const updateVariable = useVariationStore((s) => s.updateVariable)
    const removeVariable = useVariationStore((s) => s.removeVariable)
    const moveVariable = useVariationStore((s) => s.moveVariable)

    const options = parseOptions(variable.options)
    const find = variable.find.trim()
    const found = !find || containsFind(searchText, find)
    const sameAsFind = find ? options.filter((o) => o.trim().toLowerCase() === find.toLowerCase()).length : 0
    const usable = options.length - sameAsFind

    const autoFind = () => {
        const hit = detectFind(searchText, options)
        if (hit) {
            updateVariable(variable.id, { find: hit })
            toast({
                title: t('comfy.variation.autoFindHit', '바꿀 글을 찾았습니다: {{find}}', { find: hit }),
                description: t('comfy.variation.autoFindHitDesc', '프롬프트에 있던 이 글이 후보로 바뀝니다.'),
            })
        } else {
            toast({
                title: t('comfy.variation.autoFindMiss', '후보 중 프롬프트에 있는 글이 없습니다'),
                description: t('comfy.variation.autoFindMissDesc', '바꿀 글을 비워 두면 후보를 프롬프트 끝에 붙입니다. 직접 적어도 됩니다.'),
            })
        }
    }

    return (
        <div className={cn('rounded-xl border border-border/60 bg-background/40 p-3 transition-opacity', !variable.enabled && 'opacity-60')}>
            <div className="flex items-center gap-2">
                <Tip content={variable.enabled ? t('comfy.variation.varOnTip', '켜짐: 이 변수를 바꿔 가며 그립니다') : t('comfy.variation.varOffTip', '꺼짐: 이 변수는 건너뜁니다')}>
                    <span className="flex items-center">
                        <Switch
                            checked={variable.enabled}
                            onChange={(e) => updateVariable(variable.id, { enabled: e.target.checked })}
                            disabled={disabled}
                            aria-label={t('comfy.variation.varEnabled', '이 변수 사용')}
                        />
                    </span>
                </Tip>
                <Input
                    value={variable.name}
                    onChange={(e) => updateVariable(variable.id, { name: e.target.value })}
                    placeholder={t('comfy.variation.namePlaceholder', '이름 (예: 헤어스타일)')}
                    className="h-8 w-36 shrink-0 text-sm font-medium"
                    disabled={disabled}
                />
                <div className="relative min-w-0 flex-1">
                    <Input
                        value={variable.find}
                        onChange={(e) => updateVariable(variable.id, { find: e.target.value })}
                        placeholder={t('comfy.variation.findPlaceholder', '바꿀 글 (예: long hair) · 비우면 끝에 붙입니다')}
                        className={cn('h-8 pr-8 font-mono text-xs', !found && 'border-amber-500/60')}
                        disabled={disabled}
                    />
                    <Tip content={t('comfy.variation.autoFindTip', '후보 중 이미 프롬프트에 있는 글을 찾아 [바꿀 글]에 넣습니다')}>
                        <button
                            type="button"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                            onClick={autoFind}
                            disabled={disabled || options.length === 0}
                        >
                            <Wand2 className="h-3.5 w-3.5" />
                        </button>
                    </Tip>
                </div>
                <div className="flex shrink-0 items-center">
                    <Tip content={t('comfy.variation.moveUp', '위로')}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveVariable(variable.id, -1)} disabled={disabled || index === 0}>
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                    </Tip>
                    <Tip content={t('comfy.variation.moveDown', '아래로')}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveVariable(variable.id, 1)} disabled={disabled || index === count - 1}>
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                    </Tip>
                    <Tip content={t('comfy.variation.removeVar', '이 변수 지우기')}>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeVariable(variable.id)}
                            disabled={disabled}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </Tip>
                </div>
            </div>

            <Textarea
                value={variable.options}
                onChange={(e) => updateVariable(variable.id, { options: e.target.value })}
                placeholder={t('comfy.variation.optionsPlaceholder', '후보를 한 줄에 하나씩 적으세요\nponytail\ntwintails\nbob cut\n(- 또는 없음 = 바꿀 글을 지운 그림)')}
                className="mt-2 min-h-[84px] font-mono text-xs leading-relaxed"
                rows={4}
                spellCheck={false}
                disabled={disabled}
            />

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{t('comfy.variation.optionCount', '후보 {{count}}개', { count: options.length })}</span>
                {sameAsFind > 0 && (
                    <span>{t('comfy.variation.sameAsFind', '바꿀 글과 같은 후보 {{count}}개는 기준 그림과 같아서 하나씩 바꾸기에서는 건너뜁니다', { count: sameAsFind })}</span>
                )}
                {find && !found && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        {t('comfy.variation.findMissing', '프롬프트에서 "{{find}}"를 못 찾아 끝에 붙입니다', { find })}
                    </span>
                )}
                {!find && options.length > 0 && (
                    <span>{t('comfy.variation.appendHint', '바꿀 글이 없어서 후보를 프롬프트 끝에 붙입니다')}</span>
                )}
                {variable.enabled && options.length > 0 && usable === 0 && (
                    <span className="text-amber-600 dark:text-amber-400">{t('comfy.variation.noUsable', '바꿀 후보가 없습니다')}</span>
                )}
            </div>
        </div>
    )
})
