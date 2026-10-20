import { describe, expect, it, vi } from 'vitest'
import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import { DEFAULT_BINDINGS, SHORTCUT_ACTIONS, SHORTCUT_LABELS, mergeBindings, useShortcutStore, type KeyBinding } from './shortcut-store'

describe('mergeBindings', () => {
    it('returns defaults when nothing was saved', () => {
        expect(mergeBindings(undefined)).toEqual(DEFAULT_BINDINGS)
        expect(mergeBindings(null)).toEqual(DEFAULT_BINDINGS)
    })

    it('drops stale NAIS2 actions and fills new ones', () => {
        const saved: Record<string, KeyBinding> = {
            'navigate:tools': { key: '3', ctrl: true, label: 'Ctrl+3', description: 'shortcuts.actions.navigateTools' },
            'navigate:web': { key: '4', ctrl: true, label: 'Ctrl+4', description: 'shortcuts.actions.navigateWeb' },
            'open:promptGenerator': { key: 'g', ctrl: true, label: 'Ctrl+G', description: 'shortcuts.actions.promptGenerator' },
            'open:imageReference': { key: 'i', ctrl: true, label: 'Ctrl+I', description: 'shortcuts.actions.imageReference' },
            'open:fragmentDialog': { key: 'k', ctrl: true, label: 'Ctrl+K', description: 'old' },
        }
        const merged = mergeBindings(saved)
        expect(Object.keys(merged).sort()).toEqual(Object.keys(DEFAULT_BINDINGS).sort())
        expect(merged['navigate:variations']).toEqual(DEFAULT_BINDINGS['navigate:variations'])
        // 사용자가 바꾼 키는 남기고, 설명은 지금 기본값으로
        expect(merged['open:fragmentDialog'].key).toBe('k')
        expect(merged['open:fragmentDialog'].description).toBe(DEFAULT_BINDINGS['open:fragmentDialog'].description)
    })

    it('ignores broken entries', () => {
        const merged = mergeBindings({ 'navigate:main': { key: '', label: '', description: '' } })
        expect(merged['navigate:main']).toEqual(DEFAULT_BINDINGS['navigate:main'])
    })
})

describe('shortcut actions', () => {
    it('every action has a category and a Korean label', () => {
        expect(SHORTCUT_ACTIONS.map((a) => a.action).sort()).toEqual(Object.keys(DEFAULT_BINDINGS).sort())
        for (const { action, category } of SHORTCUT_ACTIONS) {
            expect(['navigation', 'dialog', 'action']).toContain(category)
            expect(SHORTCUT_LABELS[action]).toBeTruthy()
        }
    })

    it('default bindings do not collide', () => {
        const seen = new Map<string, string>()
        for (const [action, b] of Object.entries(DEFAULT_BINDINGS)) {
            const k = `${b.ctrl ? 'C' : ''}${b.shift ? 'S' : ''}${b.alt ? 'A' : ''}+${b.key.toLowerCase()}`
            expect(seen.get(k), `${action} collides with ${seen.get(k)}`).toBeUndefined()
            seen.set(k, action)
        }
    })
})

describe('persisted NAIS2 shortcuts', () => {
    it('moves untouched library/settings keys to the new menu order and drops stale actions', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const mem = new Map<string, string>()
        const storage: StateStorage = {
            getItem: (k) => mem.get(k) ?? null,
            setItem: (k, v) => { mem.set(k, v) },
            removeItem: (k) => { mem.delete(k) },
        }
        mem.set('nais2-shortcuts', JSON.stringify({
            version: 0,
            state: {
                enabled: false,
                bindings: {
                    'navigate:main': { key: '1', ctrl: true, label: 'Ctrl+1', description: 'shortcuts.actions.navigateMain' },
                    'navigate:tools': { key: '3', ctrl: true, label: 'Ctrl+3', description: 'shortcuts.actions.navigateTools' },
                    'navigate:web': { key: '4', ctrl: true, label: 'Ctrl+4', description: 'shortcuts.actions.navigateWeb' },
                    'navigate:library': { key: '5', ctrl: true, label: 'Ctrl+5', description: 'shortcuts.actions.navigateLibrary' },
                    'navigate:settings': { key: '9', ctrl: true, label: 'Ctrl+9', description: 'shortcuts.actions.navigateSettings' },
                },
            },
        }))
        useShortcutStore.persist.setOptions({ storage: createJSONStorage(() => storage) })
        await useShortcutStore.persist.rehydrate()
        const s = useShortcutStore.getState()
        expect(s.enabled).toBe(false)
        expect(s.bindings['navigate:library'].key).toBe('4')   // NAIS2 기본값(Ctrl+5)이라 새 기본값으로
        expect(s.bindings['navigate:settings'].key).toBe('9')  // 사용자가 바꾼 값은 그대로
        expect(s.bindings['navigate:variations'].key).toBe('3')
        expect(Object.keys(s.bindings)).not.toContain('navigate:tools')
        expect(Object.keys(s.bindings)).not.toContain('navigate:web')
    })
})
