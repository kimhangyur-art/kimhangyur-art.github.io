// 변형 모드 (사용자가 '랜덤 생성 모드'라고 부르는 것)
// 의상·체형 등을 정한 캐릭터에서 헤어스타일·머리색·눈 같은 요소만 여러 후보로 바꿔 가며 이어서 그리고,
// 줄마다 나란히 놓아 비교한다. 상태와 생성 반복은 stores/variation-store.ts, 계산은 lib/variation.ts.
import { VariationSetupCard } from '@/components/variation/VariationSetupCard'
import { VariationResults } from '@/components/variation/VariationResults'

export default function VariationMode() {
    return (
        <div className="flex flex-col gap-4 pb-6">
            <VariationSetupCard />
            <VariationResults />
        </div>
    )
}
