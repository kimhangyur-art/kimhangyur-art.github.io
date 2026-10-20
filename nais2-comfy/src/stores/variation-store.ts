// 변형 모드 상태 (임시: 변형 모드 작업에서 채운다)
// PromptPanel의 생성 버튼이 /variations 화면에서 start()/cancel()을 부른다.
import { create } from 'zustand'

interface VariationState {
    isRunning: boolean
    isCancelling: boolean
    totalJobs: number
    doneJobs: number
    /** 지금 설정으로 변형 생성을 시작한다 (만들 그림이 없으면 false) */
    start: () => Promise<boolean>
    cancel: () => void
    /** 지금 설정으로 만들 그림 수 */
    plannedCount: () => number
}

export const useVariationStore = create<VariationState>()(() => ({
    isRunning: false,
    isCancelling: false,
    totalJobs: 0,
    doneJobs: 0,
    start: async () => false,
    cancel: () => { },
    plannedCount: () => 0,
}))
