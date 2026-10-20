// 프롬프트 아래 [LoRA] 버튼이 여는 창 (생성 설정 창의 LoRA 구역과 같은 편집기)
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { useGenerationStore } from '@/stores/generation-store'
import { LoraListEditor } from './LoraListEditor'

interface LoraDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

/** 켜져 있고 파일을 고른 LoRA 수 (버튼 뱃지용) */
export function useEnabledLoraCount(): number {
    return useGenerationStore((s) => s.loras.filter((l) => l.enabled && l.name).length)
}

export function LoraDialog({ open, onOpenChange }: LoraDialogProps) {
    const { t } = useTranslation()
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Layers className="h-5 w-5" />
                        {t('comfy.lora.title', 'LoRA')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('comfy.lora.dialogDesc', '그림체·캐릭터를 더하는 LoRA를 고르고 세기를 정합니다. 바꾼 내용은 바로 저장되고 다음 그림부터 적용됩니다.')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 pb-1">
                    <LoraListEditor />
                </div>
            </DialogContent>
        </Dialog>
    )
}
