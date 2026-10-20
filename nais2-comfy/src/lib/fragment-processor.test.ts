import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 조각 프롬프트 스토어는 IndexedDB를 쓰므로 가짜로 바꾼다
const fragmentLines: Record<string, string> = {
    hair: 'long hair',
    'outfit/school': 'school uniform',
}
const getRandomLine = vi.fn(async (path: string) => fragmentLines[path] ?? null)
const getSequentialLine = vi.fn(async (path: string) => fragmentLines[path] ?? null)

vi.mock('@/stores/fragment-store', () => ({
    useFragmentStore: {
        getState: () => ({
            getRandomLine,
            getSequentialLine,
            resetSequentialCounter: () => { },
        }),
    },
    normalizeFragmentPath: (p: string) => p.trim().replace(/^\/+|\/+$/g, ''),
}))

const { processWildcards, hasWildcards } = await import('./fragment-processor')

describe('fragment-processor: ComfyUI 문법은 그대로 둔다', () => {
    beforeEach(() => {
        getRandomLine.mockClear()
        getSequentialLine.mockClear()
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('(a:1.2) 가중치는 건드리지 않는다', async () => {
        expect(await processWildcards('(a:1.2)')).toBe('(a:1.2)')
        expect(await processWildcards('1girl, (smile:1.1), (blue eyes:0.8)')).toBe('1girl, (smile:1.1), (blue eyes:0.8)')
    })

    it('슬래시가 들어간 가중치 묶음도 그대로 둔다', async () => {
        expect(await processWildcards('(fate/stay night:1.2)')).toBe('(fate/stay night:1.2)')
        expect(await processWildcards('(fate/stay_night:1.2)')).toBe('(fate/stay_night:1.2)')
    })

    it('\\(fate/stay night\\) 글자 괄호는 그대로 둔다', async () => {
        expect(await processWildcards('\\(fate/stay night\\)')).toBe('\\(fate/stay night\\)')
        expect(await processWildcards('saber, \\(fate/stay_night\\)')).toBe('saber, \\(fate/stay_night\\)')
    })

    it('embedding: 과 <lora:...> 는 그대로 두고 조각 파일로 찾지 않는다', async () => {
        expect(await processWildcards('embedding:neg/easynegative')).toBe('embedding:neg/easynegative')
        expect(await processWildcards('1girl, <lora:style/foo:0.8>')).toBe('1girl, <lora:style/foo:0.8>')
        expect(getRandomLine).not.toHaveBeenCalled()
    })

    it('a/b 는 여전히 하나를 고른다', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)
        expect(await processWildcards('a/b')).toBe('a')
        vi.spyOn(Math, 'random').mockReturnValue(0.99)
        expect(await processWildcards('a/b')).toBe('b')
    })

    it('(x/y) 는 여전히 하나를 고른다', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)
        expect(await processWildcards('(x/y)')).toBe('x')
        vi.spyOn(Math, 'random').mockReturnValue(0.99)
        expect(await processWildcards('(x/y)')).toBe('y')
        // 쉼표가 들어간 묶음
        vi.spyOn(Math, 'random').mockReturnValue(0.99)
        expect(await processWildcards('1girl, (white hair, blue eyes/red hair, purple eyes)')).toBe('1girl, red hair, purple eyes')
    })

    it('섞어 써도 와일드카드만 바뀐다', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)
        const out = await processWildcards('1girl, (smile:1.1), red/blue, \\(fate/stay night\\), (cat/dog), <hair>')
        expect(out).toBe('1girl, (smile:1.1), red, \\(fate/stay night\\), cat, long hair')
    })

    it('조각 파일 <이름> 은 계속 동작한다', async () => {
        expect(await processWildcards('<hair>, <outfit/school>')).toBe('long hair, school uniform')
        expect(getRandomLine).toHaveBeenCalledWith('hair')
    })

    it('hasWildcards 는 ComfyUI 문법을 와일드카드로 보지 않는다', () => {
        expect(hasWildcards('(a:1.2), \\(fate/stay night\\), embedding:x/y, <lora:a/b:1>')).toBe(false)
        expect(hasWildcards('(x/y)')).toBe(true)
        expect(hasWildcards('a/b')).toBe(true)
        expect(hasWildcards('<hair>')).toBe(true)
    })
})
