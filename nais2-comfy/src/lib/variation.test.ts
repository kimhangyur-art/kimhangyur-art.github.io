import { describe, expect, it } from 'vitest'
import {
    applyVariant,
    applyVariantDetailed,
    applyVariantToFields,
    clampPerVariant,
    comboCount,
    containsFind,
    defaultRunName,
    detectFind,
    expandVariants,
    findRanges,
    missingFinds,
    parseOptions,
    planJobs,
    seededRng,
    variantFileLabel,
    variantFullLabel,
    variantLabel,
    variantValues,
    type VariationVariable,
} from './variation'

function v(id: string, name: string, find: string, options: string[], enabled = true): VariationVariable {
    return { id, name, find, options: options.join('\n'), enabled }
}

const PROMPT = '1girl, solo, long hair, blue eyes, school uniform'

describe('parseOptions', () => {
    it('ignores empty lines and trims', () => {
        expect(parseOptions('a\n\n  b  \n\r\nc\n')).toEqual(['a', 'b', 'c'])
    })
    it('drops duplicates ignoring case', () => {
        expect(parseOptions('Ponytail\nponytail\nbraid')).toEqual(['Ponytail', 'braid'])
    })
})

describe('applyVariant', () => {
    it('replaces the find text', () => {
        const out = applyVariant(PROMPT, { changes: [{ variableId: 'h', name: '헤어스타일', find: 'long hair', value: 'ponytail' }] })
        expect(out).toBe('1girl, solo, ponytail, blue eyes, school uniform')
    })
    it('is case-insensitive and replaces all occurrences', () => {
        const out = applyVariant('Long Hair, smile, {long hair}', { changes: [{ variableId: 'h', name: '', find: 'long hair', value: 'bob cut' }] })
        expect(out).toBe('bob cut, smile, {bob cut}')
    })
    it('appends when find is empty', () => {
        const out = applyVariant(PROMPT, { changes: [{ variableId: 'c', name: '머리색', find: '', value: 'silver hair' }] })
        expect(out).toBe(`${PROMPT}, silver hair`)
    })
    it('appends and reports when find is not in the prompt', () => {
        const r = applyVariantDetailed(PROMPT, { changes: [{ variableId: 'c', name: '머리색', find: 'black hair', value: 'pink hair' }] })
        expect(r.text).toBe(`${PROMPT}, pink hair`)
        expect(r.notFound).toEqual(['black hair'])
        expect(r.appended).toEqual(['pink hair'])
    })
    it('escapes regex special characters', () => {
        const prompt = 'hatsune miku \\(vocaloid\\), (smile:1.2), a+b, c.d'
        expect(applyVariant(prompt, { changes: [{ variableId: 'x', name: '', find: '(smile:1.2)', value: '(grin:1.2)' }] })).toBe('hatsune miku \\(vocaloid\\), (grin:1.2), a+b, c.d')
        expect(applyVariant(prompt, { changes: [{ variableId: 'x', name: '', find: 'a+b', value: 'x' }] })).toBe('hatsune miku \\(vocaloid\\), (smile:1.2), x, c.d')
        // '.' 은 아무 글자가 아니라 점만
        expect(applyVariant('cxd, c.d', { changes: [{ variableId: 'x', name: '', find: 'c.d', value: 'ok' }] })).toBe('cxd, ok')
        // '$' 가 들어간 후보도 그대로 들어간다
        expect(applyVariant('a, b', { changes: [{ variableId: 'x', name: '', find: 'b', value: '$1 $&' }] })).toBe('a, $1 $&')
    })
    it('does not match inside another word', () => {
        expect(containsFind('tired eyes', 'red eyes')).toBe(false)
        expect(containsFind('chair, red eyes', 'hair')).toBe(false)
        expect(applyVariant('tired eyes, red eyes', { changes: [{ variableId: 'x', name: '', find: 'red eyes', value: 'blue eyes' }] })).toBe('tired eyes, blue eyes')
    })
    it('treats spaces and underscores alike', () => {
        expect(applyVariant('1girl, long_hair', { changes: [{ variableId: 'x', name: '', find: 'long hair', value: 'short hair' }] })).toBe('1girl, short hair')
    })
    it('applies several changes at once without re-replacing', () => {
        const out = applyVariant('black hair, red eyes', {
            changes: [
                { variableId: 'a', name: '', find: 'black hair', value: 'red hair' },
                { variableId: 'b', name: '', find: 'red hair', value: 'blue hair' },
            ],
        })
        // 'red hair' 는 원래 프롬프트에 없으니 끝에 붙고, 바꿔 넣은 'red hair' 는 다시 바뀌지 않는다
        expect(out).toBe('red hair, red eyes, blue hair')
    })
    it('removes the find text for "-" / "없음" options and tidies commas', () => {
        expect(applyVariant('1girl, glasses, smile', { changes: [{ variableId: 'g', name: '안경', find: 'glasses', value: '' }] })).toBe('1girl, smile')
        expect(applyVariant('glasses, 1girl', { changes: [{ variableId: 'g', name: '', find: 'glasses', value: '' }] })).toBe('1girl')
        expect(applyVariant('1girl, {glasses}', { changes: [{ variableId: 'g', name: '', find: 'glasses', value: '' }] })).toBe('1girl')
    })
    it('keeps multi-line prompts working', () => {
        expect(applyVariant('1girl,\nlong hair,\nsmile', { changes: [{ variableId: 'h', name: '', find: 'long hair', value: 'ponytail' }] })).toBe('1girl,\nponytail,\nsmile')
    })
})

describe('expandVariants', () => {
    const hair = v('h', '헤어스타일', 'long hair', ['long hair', 'ponytail', 'twintails', 'bob cut'])
    const color = v('c', '머리색', '', ['silver hair', 'pink hair'])
    const eyes = v('e', '눈색', 'blue eyes', ['red eyes', 'green eyes', 'Blue Eyes'])

    it('each: one row per option, skipping options identical to find, base first', () => {
        const rows = expandVariants([hair, color], 'each', { includeBase: true })
        expect(rows.map(variantLabel)).toEqual(['기준', '헤어스타일: ponytail', '헤어스타일: twintails', '헤어스타일: bob cut', '머리색: silver hair', '머리색: pink hair'])
        expect(rows[0].isBase).toBe(true)
    })
    it('each: without base', () => {
        expect(expandVariants([hair, color], 'each', { includeBase: false })).toHaveLength(5)
    })
    it('each: case-insensitive find match is a no-op', () => {
        const rows = expandVariants([eyes], 'each', { includeBase: false })
        expect(rows.map((r) => r.changes[0].value)).toEqual(['red eyes', 'green eyes'])
    })
    it('each: dedupes variants with the same final text', () => {
        const a = v('a', 'A', '', ['smile'])
        const b = v('b', 'B', '', ['smile', 'grin'])
        const rows = expandVariants([a, b], 'each', { includeBase: true, prompt: PROMPT })
        expect(rows.map(variantLabel)).toEqual(['기준', 'A: smile', 'B: grin'])
    })
    it('ignores disabled variables and variables without options', () => {
        const off = v('o', '꺼짐', '', ['x', 'y'], false)
        const empty = v('n', '비어 있음', '', [])
        expect(expandVariants([off, empty, color], 'each', { includeBase: false })).toHaveLength(2)
        expect(expandVariants([off, empty], 'each', { includeBase: true })).toEqual([])
    })
    it('returns nothing when every option is a no-op', () => {
        expect(expandVariants([v('h', 'h', 'long hair', ['long hair'])], 'each', { includeBase: true })).toEqual([])
    })
    it('all: cartesian product size', () => {
        const rows = expandVariants([hair, color], 'all', { includeBase: false })
        expect(rows).toHaveLength(4 * 2)
        expect(comboCount([hair, color])).toBe(8)
        expect(variantLabel(rows[0])).toBe('long hair · silver hair')
        expect(variantFullLabel(rows[0])).toBe('헤어스타일: long hair · 머리색: silver hair')
        expect(variantLabel(rows[1])).toBe('long hair · pink hair')
        expect(variantLabel(rows[2])).toBe('ponytail · silver hair')
    })
    it('all: three variables', () => {
        expect(expandVariants([hair, color, eyes], 'all', { includeBase: true })).toHaveLength(1 + 4 * 2 * 3)
    })
    it('all: the combination equal to the base is dropped when the base row is there', () => {
        const rows = expandVariants([hair, eyes], 'all', { includeBase: true })
        // long hair · Blue Eyes 는 기준과 같다
        expect(rows).toHaveLength(1 + 4 * 3 - 1)
    })
    it('all: caps at maxRows', () => {
        expect(expandVariants([hair, color, eyes], 'all', { includeBase: true, maxRows: 5 })).toHaveLength(5)
    })
    it('random: N distinct combinations', () => {
        const rows = expandVariants([hair, color, eyes], 'random', { includeBase: true, randomCount: 6, rng: seededRng(1) })
        expect(rows).toHaveLength(7)
        expect(rows[0].isBase).toBe(true)
        const keys = rows.map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
    })
    it('random: is repeatable with the same rng seed', () => {
        const a = expandVariants([hair, color, eyes], 'random', { includeBase: false, randomCount: 5, rng: seededRng(42) })
        const b = expandVariants([hair, color, eyes], 'random', { includeBase: false, randomCount: 5, rng: seededRng(42) })
        expect(a.map((r) => r.key)).toEqual(b.map((r) => r.key))
    })
    it('random: asking for more than exist returns every combination', () => {
        expect(expandVariants([hair, color], 'random', { includeBase: false, randomCount: 50, rng: seededRng(3) })).toHaveLength(8)
    })
})

describe('labels', () => {
    it('base', () => {
        expect(variantLabel({ isBase: true, changes: [] })).toBe('기준')
        expect(variantFileLabel({ isBase: true, changes: [] })).toBe('기준')
    })
    it('removal shows 없음', () => {
        const rows = expandVariants([v('g', '안경', 'glasses', ['-', 'sunglasses'])], 'each', { includeBase: false })
        expect(rows.map(variantLabel)).toEqual(['안경: 없음', '안경: sunglasses'])
        expect(variantValues(rows[0])).toEqual({ 안경: '없음' })
    })
    it('file label strips prompt syntax', () => {
        expect(variantFileLabel({ isBase: false, changes: [{ variableId: 'a', name: 'a', find: '', value: '{pony:tail}' }] })).toBe('ponytail')
    })
})

describe('planJobs', () => {
    it('same seed: column k shares seed k across rows', () => {
        const { seeds, jobs } = planJobs(3, 2, true, seededRng(7))
        expect(seeds).toHaveLength(2)
        expect(jobs).toHaveLength(6)
        for (const j of jobs) expect(j.seed).toBe(seeds[j.col])
        expect(seeds[0]).toBeGreaterThan(0)
    })
    it('random seeds: every image gets its own seed', () => {
        const { seeds, jobs } = planJobs(3, 2, false, seededRng(7))
        expect(seeds).toEqual([])
        expect(new Set(jobs.map((j) => j.seed)).size).toBe(6)
    })
    it('clamps the count per variant', () => {
        expect(clampPerVariant(0)).toBe(1)
        expect(clampPerVariant(20)).toBe(8)
        expect(clampPerVariant(Number.NaN)).toBe(2)
    })
})

describe('helpers', () => {
    it('defaultRunName', () => {
        expect(defaultRunName(new Date(2026, 9, 5, 9, 3))).toBe('변형 2026-10-05 09-03')
    })
    it('detectFind picks the longest option already in the prompt', () => {
        expect(detectFind('1girl, very long hair', ['long hair', 'very long hair', 'bob cut'])).toBe('very long hair')
        expect(detectFind('1girl', ['long hair'])).toBe('')
    })
    it('missingFinds', () => {
        const vars = [v('a', 'A', 'long hair', ['x']), v('b', 'B', 'black hair', ['y']), v('c', 'C', '', ['z'])]
        expect(missingFinds(PROMPT, vars).map((x) => x.id)).toEqual(['b'])
    })
    it('findRanges', () => {
        expect(findRanges('long hair, blue eyes', ['blue eyes', 'long hair'])).toEqual([
            { start: 0, end: 9, find: 'long hair' },
            { start: 11, end: 20, find: 'blue eyes' },
        ])
    })
})

describe('applyVariantToFields', () => {
    it('replaces in the field that has the text and appends the rest to detail', () => {
        const { fields, notes } = applyVariantToFields(
            { basePrompt: '1girl, long hair', additionalPrompt: 'blue eyes', detailPrompt: 'smile' },
            {
                changes: [
                    { variableId: 'h', name: '헤어스타일', find: 'long hair', value: 'ponytail' },
                    { variableId: 'c', name: '머리색', find: '', value: 'silver hair' },
                    { variableId: 'e', name: '눈색', find: 'red eyes', value: 'green eyes' },
                ],
            },
        )
        expect(fields).toEqual({ basePrompt: '1girl, ponytail', additionalPrompt: 'blue eyes', detailPrompt: 'smile, silver hair, green eyes' })
        expect(notes).toHaveLength(3)
        expect(notes[0]).toContain('기본 프롬프트')
    })
    it('skips no-op changes', () => {
        const r = applyVariantToFields({ basePrompt: 'long hair', additionalPrompt: '', detailPrompt: '' }, { changes: [{ variableId: 'h', name: '', find: 'long hair', value: 'Long Hair' }] })
        expect(r.fields.basePrompt).toBe('long hair')
        expect(r.notes).toEqual([])
    })
    it('appends to an empty detail prompt without a leading comma', () => {
        const r = applyVariantToFields({ basePrompt: 'a', additionalPrompt: '', detailPrompt: '\n' }, { changes: [{ variableId: 'h', name: '', find: '', value: 'x' }] })
        expect(r.fields.detailPrompt).toBe('x')
    })
})
