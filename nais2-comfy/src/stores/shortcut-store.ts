import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

// 단축키 액션 타입
// (NAIS2에 있던 스마트 툴·웹·이미지 참조·AI 프롬프트 생성 단축키는 기능과 함께 뺐다)
export type ShortcutAction =
    | 'navigate:main'
    | 'navigate:scenes'
    | 'navigate:variations'
    | 'navigate:library'
    | 'navigate:settings'
    | 'navigate:next'
    | 'navigate:prev'
    | 'open:fragmentDialog'
    | 'open:parameterSettings'
    | 'open:loraDialog'
    | 'open:characterPrompt'
    | 'open:presetDialog'
    | 'action:generate'
    | 'action:resetFragmentCounters'

// 단축키 바인딩 인터페이스
export interface KeyBinding {
    key: string           // 실제 키 (예: '1', 'g', 'Enter')
    ctrl?: boolean        // Ctrl/Cmd 키
    shift?: boolean       // Shift 키
    alt?: boolean         // Alt 키
    label: string         // 표시 이름
    description: string   // 설명 (i18n 키)
}

// 기본 단축키 설정 (Ctrl+1~5는 위쪽 메뉴 순서와 같다)
export const DEFAULT_BINDINGS: Record<ShortcutAction, KeyBinding> = {
    'navigate:main': { key: '1', ctrl: true, label: 'Ctrl+1', description: 'shortcuts.actions.navigateMain' },
    'navigate:scenes': { key: '2', ctrl: true, label: 'Ctrl+2', description: 'shortcuts.actions.navigateScenes' },
    'navigate:variations': { key: '3', ctrl: true, label: 'Ctrl+3', description: 'shortcuts.actions.navigateVariations' },
    'navigate:library': { key: '4', ctrl: true, label: 'Ctrl+4', description: 'shortcuts.actions.navigateLibrary' },
    'navigate:settings': { key: '5', ctrl: true, label: 'Ctrl+5', description: 'shortcuts.actions.navigateSettings' },
    'navigate:next': { key: 'Tab', label: 'Tab', description: 'shortcuts.actions.navigateNext' },
    'navigate:prev': { key: 'Tab', shift: true, label: 'Shift+Tab', description: 'shortcuts.actions.navigatePrev' },
    'open:fragmentDialog': { key: 'f', ctrl: true, label: 'Ctrl+F', description: 'shortcuts.actions.fragmentDialog' },
    'open:parameterSettings': { key: 'p', ctrl: true, label: 'Ctrl+P', description: 'shortcuts.actions.parameterSettings' },
    'open:loraDialog': { key: 'i', ctrl: true, label: 'Ctrl+I', description: 'shortcuts.actions.loraDialog' },
    'open:characterPrompt': { key: 'd', ctrl: true, label: 'Ctrl+D', description: 'shortcuts.actions.characterPrompt' },
    'open:presetDialog': { key: '`', ctrl: true, label: 'Ctrl+`', description: 'shortcuts.actions.presetDialog' },
    'action:generate': { key: 'Enter', ctrl: true, label: 'Ctrl+Enter', description: 'shortcuts.actions.generate' },
    'action:resetFragmentCounters': { key: 'r', ctrl: true, shift: true, label: 'Ctrl+Shift+R', description: 'shortcuts.actions.resetFragmentCounters' },
}

/** 설정 화면에 보여 줄 이름 (번역 파일에 없는 새 단축키도 한국어로 보이게) */
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
    'navigate:main': '메인 모드',
    'navigate:scenes': '씬 모드',
    'navigate:variations': '변형 모드',
    'navigate:library': '라이브러리',
    'navigate:settings': '설정',
    'navigate:next': '다음 메뉴',
    'navigate:prev': '이전 메뉴',
    'open:fragmentDialog': '조각 프롬프트',
    'open:parameterSettings': '생성 설정',
    'open:loraDialog': 'LoRA 목록',
    'open:characterPrompt': '캐릭터 프롬프트',
    'open:presetDialog': '프리셋 관리',
    'action:generate': '이미지 생성 / 중단',
    'action:resetFragmentCounters': '순차 카운터 리셋',
}

const ALL_ACTIONS = Object.keys(DEFAULT_BINDINGS) as ShortcutAction[]

function isShortcutAction(key: string): key is ShortcutAction {
    return Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS, key)
}

function sameKeys(a: Partial<KeyBinding> | undefined, b: Pick<KeyBinding, 'key' | 'ctrl' | 'shift' | 'alt'>): boolean {
    return !!a && a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt
}

/**
 * 저장된 바인딩 + 기본값. 지금은 없는 액션(예전 스마트 툴·웹 단축키 등)은 버리고,
 * 새로 생긴 액션은 기본값으로 채운다. 설명(i18n 키)은 언제나 지금 기본값을 쓴다.
 */
export function mergeBindings(saved: Partial<Record<string, KeyBinding>> | undefined | null): Record<ShortcutAction, KeyBinding> {
    const out = { ...DEFAULT_BINDINGS }
    if (!saved || typeof saved !== 'object') return out
    for (const [action, binding] of Object.entries(saved)) {
        if (!isShortcutAction(action)) continue
        if (!binding || typeof binding.key !== 'string' || binding.key === '') continue
        out[action] = { ...binding, description: DEFAULT_BINDINGS[action].description }
    }
    return out
}

// NAIS2 원본의 기본 단축키 (손대지 않은 값이면 새 기본값으로 바꾸기 위해)
const NAIS2_ORIGINAL_DEFAULTS: Partial<Record<ShortcutAction, Pick<KeyBinding, 'key' | 'ctrl'>>> = {
    'navigate:library': { key: '5', ctrl: true },
    'navigate:settings': { key: '6', ctrl: true },
}

interface ShortcutState {
    bindings: Record<ShortcutAction, KeyBinding>
    enabled: boolean  // 전역 단축키 활성화/비활성화

    // Actions
    setBinding: (action: ShortcutAction, binding: KeyBinding) => void
    resetBinding: (action: ShortcutAction) => void
    resetAllBindings: () => void
    setEnabled: (enabled: boolean) => void
    getBindingLabel: (action: ShortcutAction) => string
}

// 키 조합을 문자열로 변환
export function formatKeyBinding(binding: KeyBinding): string {
    const parts: string[] = []
    if (binding.ctrl) parts.push('Ctrl')
    if (binding.shift) parts.push('Shift')
    if (binding.alt) parts.push('Alt')
    
    // 특수 키 처리
    let keyDisplay = binding.key
    if (binding.key === 'Enter') keyDisplay = 'Enter'
    else if (binding.key === ' ') keyDisplay = 'Space'
    else if (binding.key === 'Escape') keyDisplay = 'Esc'
    else if (binding.shift && /^[!@#$%^&*()]$/.test(binding.key)) {
        // Shift+숫자 조합
        const shiftMap: Record<string, string> = {
            '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
            '^': '6', '&': '7', '*': '8', '(': '9', ')': '0'
        }
        keyDisplay = shiftMap[binding.key] || binding.key
    } else {
        keyDisplay = binding.key.toUpperCase()
    }
    
    parts.push(keyDisplay)
    return parts.join('+')
}

// 키 이벤트가 바인딩과 일치하는지 확인
export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
    const ctrlMatch = binding.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
    const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey
    const altMatch = binding.alt ? e.altKey : !e.altKey
    const keyMatch = e.key === binding.key || e.key.toLowerCase() === binding.key.toLowerCase()
    
    return ctrlMatch && shiftMatch && altMatch && keyMatch
}

export const useShortcutStore = create<ShortcutState>()(
    persist(
        (set, get) => ({
            bindings: { ...DEFAULT_BINDINGS },
            enabled: true,

            setBinding: (action, binding) => {
                set((state) => ({
                    bindings: {
                        ...state.bindings,
                        [action]: { ...binding, label: formatKeyBinding(binding) }
                    }
                }))
            },

            resetBinding: (action) => {
                set((state) => ({
                    bindings: {
                        ...state.bindings,
                        [action]: DEFAULT_BINDINGS[action]
                    }
                }))
            },

            resetAllBindings: () => {
                set({ bindings: { ...DEFAULT_BINDINGS } })
            },

            setEnabled: (enabled) => {
                set({ enabled })
            },

            getBindingLabel: (action) => {
                return get().bindings[action]?.label || ''
            },
        }),
        {
            name: 'nais2-shortcuts',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (s) => ({ bindings: s.bindings, enabled: s.enabled }),
            version: 1,
            // NAIS2에서 가져온 설정(백업 복원 등): 라이브러리 Ctrl+5, 설정 Ctrl+6 을 손대지 않았으면
            // 새 메뉴 순서(Ctrl+4, Ctrl+5)로 옮긴다
            migrate: (persisted, version) => {
                const s = (persisted ?? {}) as { bindings?: Record<string, KeyBinding>; enabled?: boolean }
                if (version < 1 && s.bindings && typeof s.bindings === 'object') {
                    const b = { ...s.bindings }
                    for (const [action, original] of Object.entries(NAIS2_ORIGINAL_DEFAULTS)) {
                        if (original && sameKeys(b[action], original)) delete b[action]
                    }
                    s.bindings = b
                }
                return s as unknown as ShortcutState
            },
            // 저장된 값과 기본값을 합친다 (없어진 액션은 버리고, 새 액션은 기본값으로)
            merge: (persistedState, currentState) => {
                const persisted = (persistedState ?? {}) as Partial<Pick<ShortcutState, 'bindings' | 'enabled'>>
                return {
                    ...currentState,
                    enabled: typeof persisted.enabled === 'boolean' ? persisted.enabled : currentState.enabled,
                    bindings: mergeBindings(persisted.bindings),
                }
            },
        }
    )
)

// 액션 목록 (설정 UI용)
const CATEGORY: Record<ShortcutAction, 'navigation' | 'dialog' | 'action'> = {
    'navigate:main': 'navigation',
    'navigate:scenes': 'navigation',
    'navigate:variations': 'navigation',
    'navigate:library': 'navigation',
    'navigate:settings': 'navigation',
    'navigate:next': 'navigation',
    'navigate:prev': 'navigation',
    'open:fragmentDialog': 'dialog',
    'open:parameterSettings': 'dialog',
    'open:loraDialog': 'dialog',
    'open:characterPrompt': 'dialog',
    'open:presetDialog': 'dialog',
    'action:generate': 'action',
    'action:resetFragmentCounters': 'action',
}

export const SHORTCUT_ACTIONS: { action: ShortcutAction; category: string }[] = ALL_ACTIONS.map((action) => ({
    action,
    category: CATEGORY[action],
}))
