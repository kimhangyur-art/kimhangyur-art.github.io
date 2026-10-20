import { describe, expect, it } from 'vitest'
import { embedTextChunks, readTextChunks, textChunk } from './png-text'

function tinyPng(extra: Uint8Array[] = []): Uint8Array {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    // IHDR 1x1 RGB (crc not validated by our reader)
    const ihdr = new Uint8Array([0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 0, 0, 0])
    const iend = new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82])
    const parts = [new Uint8Array(sig), ihdr, ...extra, iend]
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    return out
}

describe('png text chunks', () => {
    it('embeds, replaces and reads', () => {
        const base = tinyPng([textChunk('prompt', '{"1":{}}'), textChunk('Comment', 'old')])
        const out = embedTextChunks(base, [['Comment', '{"a":1}'], ['Source', 'model.safetensors']])
        const t = readTextChunks(out)
        expect(t.Comment).toBe('{"a":1}')
        expect(t.Source).toBe('model.safetensors')
        expect(t.prompt).toBe('{"1":{}}')
        // 이름이 같은 조각은 하나만
        expect(Object.keys(t).filter((k) => k === 'Comment')).toHaveLength(1)
        expect(out.slice(-12)).toEqual(base.slice(-12))
    })
    it('returns non-png untouched', () => {
        const b = new Uint8Array([1, 2, 3])
        expect(embedTextChunks(b, [['a', 'b']])).toBe(b)
    })
})
