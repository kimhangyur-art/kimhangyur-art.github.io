import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useShortcutStore, matchesBinding, SHORTCUT_ACTIONS, type ShortcutAction } from '@/stores/shortcut-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useFragmentStore } from '@/stores/fragment-store'

// 커스텀 이벤트 (다이얼로그 열기용)
export const SHORTCUT_EVENTS = {
    OPEN_FRAGMENT_DIALOG: 'shortcut:openFragmentDialog',
    OPEN_PARAMETER_SETTINGS: 'shortcut:openParameterSettings',
    OPEN_LORA_DIALOG: 'shortcut:openLoraDialog',
    OPEN_CHARACTER_PROMPT: 'shortcut:openCharacterPrompt',
    OPEN_PRESET_DIALOG: 'shortcut:openPresetDialog',
    RESET_FRAGMENT_COUNTERS: 'shortcut:resetFragmentCounters',
    /** @deprecated 예전 '이미지 참조' 단축키 자리. OPEN_LORA_DIALOG 와 같은 이벤트라 그쪽 이름을 쓰세요 */
    OPEN_IMAGE_REFERENCE: 'shortcut:openLoraDialog',
    /** @deprecated 'AI 프롬프트 생성'은 없어졌고 더 이상 보내지 않습니다 (변형 모드는 navigate:variations 로 이동) */
    OPEN_PROMPT_GENERATOR: 'shortcut:openPromptGenerator',
} as const

// 위쪽 메뉴 순서 (Tab / Shift+Tab 으로 차례로 옮겨 다닌다)
export const MENU_ROUTES = ['/', '/scenes', '/variations', '/library', '/settings'] as const

const NAVIGATE_ROUTES: Partial<Record<ShortcutAction, string>> = {
    'navigate:main': '/',
    'navigate:scenes': '/scenes',
    'navigate:variations': '/variations',
    'navigate:library': '/library',
    'navigate:settings': '/settings',
}

const DIALOG_EVENTS: Partial<Record<ShortcutAction, string>> = {
    'open:fragmentDialog': SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG,
    'open:parameterSettings': SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS,
    'open:loraDialog': SHORTCUT_EVENTS.OPEN_LORA_DIALOG,
    'open:characterPrompt': SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT,
    'open:presetDialog': SHORTCUT_EVENTS.OPEN_PRESET_DIALOG,
}

/** 지금 주소가 몇 번째 메뉴인지 ('/scenes/abc' 같은 하위 주소는 '/scenes'로 본다). 없으면 -1 */
export function menuIndexOf(pathname: string): number {
    return MENU_ROUTES.findIndex((r) => (r === '/' ? pathname === '/' : pathname === r || pathname.startsWith(`${r}/`)))
}

export function useShortcuts() {
    const navigate = useNavigate()
    const location = useLocation()
    const { bindings, enabled } = useShortcutStore()
    const generate = useGenerationStore(state => state.generate)
    const cancelGeneration = useGenerationStore(state => state.cancelGeneration)
    const isGenerating = useGenerationStore(state => state.isGenerating)
    const resetSequentialCounter = useFragmentStore(state => state.resetSequentialCounter)

    useEffect(() => {
        if (!enabled) return

        const handleKeyDown = (e: KeyboardEvent) => {
            for (const { action } of SHORTCUT_ACTIONS) {
                const binding = bindings[action]
                if (!binding || !matchesBinding(e, binding)) continue

                // 네비게이션은 입력 필드에서도 작동
                if (action.startsWith('navigate:')) {
                    // 다이얼로그가 열려 있으면 Tab/Shift+Tab은 네이티브 포커스 이동에 양보
                    if ((action === 'navigate:next' || action === 'navigate:prev') &&
                        document.querySelector('[role="dialog"][data-state="open"]')) {
                        return
                    }

                    e.preventDefault()

                    // 다음/이전 메뉴 이동
                    if (action === 'navigate:next' || action === 'navigate:prev') {
                        const currentIndex = menuIndexOf(location.pathname)
                        if (currentIndex === -1) return
                        const step = action === 'navigate:next' ? 1 : -1
                        const nextIndex = (currentIndex + step + MENU_ROUTES.length) % MENU_ROUTES.length
                        navigate(MENU_ROUTES[nextIndex])
                        return
                    }

                    const route = NAVIGATE_ROUTES[action]
                    if (route) navigate(route)
                    return
                }

                // 다이얼로그 열기
                const eventName = DIALOG_EVENTS[action]
                if (eventName) {
                    e.preventDefault()
                    window.dispatchEvent(new CustomEvent(eventName))
                    return
                }

                // 이미지 생성 / 중단 (메인 모드에서만)
                if (action === 'action:generate') {
                    if (location.pathname === '/') {
                        e.preventDefault()
                        if (isGenerating) {
                            cancelGeneration()
                        } else {
                            generate()
                        }
                        return
                    }
                    continue
                }

                // 순차 카운터 리셋
                if (action === 'action:resetFragmentCounters') {
                    e.preventDefault()
                    resetSequentialCounter()
                    window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.RESET_FRAGMENT_COUNTERS))
                    return
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [bindings, enabled, navigate, location.pathname, generate, cancelGeneration, isGenerating, resetSequentialCounter])
}
