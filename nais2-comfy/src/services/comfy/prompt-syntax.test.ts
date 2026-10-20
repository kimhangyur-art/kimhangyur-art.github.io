import { describe, expect, it } from 'vitest'
import { flattenLines, joinPrompt, naiToComfy, removeComments } from './prompt-syntax'

describe('naiToComfy', () => {
    it('leaves plain prompts alone', () => {
        expect(naiToComfy('1girl, smile, blue eyes')).toBe('1girl, smile, blue eyes')
    })
    it('converts braces and brackets', () => {
        expect(naiToComfy('{blue eyes}, smile')).toBe('(blue eyes:1.05), smile')
        expect(naiToComfy('{{blue eyes}}')).toBe('(blue eyes:1.1)')
        expect(naiToComfy('[smile]')).toBe('(smile:0.95)')
        expect(naiToComfy('a, {b, c}, d')).toBe('a, (b, c:1.05), d')
    })
    it('nests braces multiplicatively', () => {
        expect(naiToComfy('{a {b}}')).toBe('(a:1.05) (b:1.1)')
    })
    it('escapes literal parentheses', () => {
        expect(naiToComfy('hatsune miku (vocaloid)')).toBe('hatsune miku \\(vocaloid\\)')
        expect(naiToComfy('{kafka (honkai: star rail)}')).toBe('(kafka \\(honkai: star rail\\):1.05)')
    })
    it('keeps ComfyUI weights and multiplies outer NAI weight', () => {
        expect(naiToComfy('(smile:1.2), {cat}')).toBe('(smile:1.2), (cat:1.05)')
        expect(naiToComfy('{(smile:1.2)}')).toBe('(smile:1.26)')
    })
    it('converts numeric NAI weights', () => {
        expect(naiToComfy('1.3::red hair::, smile')).toBe('(red hair:1.3), smile')
        expect(naiToComfy('a, 0.8::b, c::, d')).toBe('a, (b, c:0.8), d')
        expect(naiToComfy('-1::text::')).toBe('(text:-1.0)')
    })
    it('keeps escaped parens', () => {
        expect(naiToComfy('a \\(b\\)')).toBe('a \\(b\\)')
    })
    it('drops unmatched closers', () => {
        expect(naiToComfy('a}, b')).toBe('a, b')
    })
    it('does not treat artist:name as weight', () => {
        expect(naiToComfy('artist:wlop, {artist:mika}')).toBe('artist:wlop, (artist:mika:1.05)')
    })
})

describe('prompt helpers', () => {
    it('joins and trims', () => {
        expect(joinPrompt('a, ', '', ' ,b', undefined, 'c')).toBe('a, b, c')
    })
    it('removes comment lines', () => {
        expect(removeComments('a\n# note\nb')).toBe('a\nb')
    })
    it('flattens lines', () => {
        expect(flattenLines('a,\nb\n\nc')).toBe('a, b, c')
    })
})
