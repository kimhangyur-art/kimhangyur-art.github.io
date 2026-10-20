// examples/ 의 예시 파일이 프로그램에서 그대로 읽히는지
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseScenePresetJson } from './scene-store'
import { removeComments } from '@/services/comfy/prompt-syntax'

const read = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../examples', name), 'utf8'))

describe('examples', () => {
    it('씬 프리셋: 26개 씬, 씬 부정 프롬프트, 가로 해상도, 주석', () => {
        const r = parseScenePresetJson(read('윤하린_장면26_씬프리셋.json'))!
        expect(r.name).toBe('윤하린 · 장면 26종')
        expect(r.scenes).toHaveLength(26)
        expect(r.scenes[0].sceneNegative).toBe('sweat')
        const dogeza = r.scenes.find((s) => s.name === '24 도게자')!
        expect([dogeza.width, dogeza.height]).toEqual([1216, 832])
        // # 주석 줄은 보낼 때 빠진다
        expect(removeComments(r.scenes[0].scenePrompt).trim()).toBe('expressionless, closed mouth')
    })
    it('생성 설정 백업: 백업 가져오기 형식', () => {
        const b = read('윤하린_생성설정_백업.json')
        expect(b._exportedAt).toBeTruthy()
        expect(b._version).toBeTruthy()
        const s = b['nais2-generation'].state
        expect(s.model).toBe('waiIllustriousSDXL_v170.safetensors')
        expect(s.loras).toHaveLength(3)
        expect(s.ucPreset).toBe(4)
    })
})
