import { describe, expect, it, beforeEach } from 'vitest'
import { parseScenePresetJson, useSceneStore, isUpscaledSceneImage } from './scene-store'

describe('parseScenePresetJson (원래 NAIS2가 읽던 네 가지 형식)', () => {
    it('D 형식의 씬 부정 프롬프트(sceneNegative)를 지킨다', () => {
        const r = parseScenePresetJson({ name: 'p', scenes: [{ name: '울음', scenePrompt: 'crying', sceneNegative: 'blush' }, { name: '미소', scenePrompt: 'smile' }] })
        expect(r?.scenes.map(s => [s.name, s.sceneNegative])).toEqual([['울음', 'blush'], ['미소', undefined]])
    })

    it('A. 배열 형식', () => {
        const r = parseScenePresetJson([{ scene_name: '웃음', scene_prompt: 'smile' }, { scene_prompt: 'cry' }])
        expect(r?.scenes.map(s => [s.name, s.scenePrompt])).toEqual([['웃음', 'smile'], ['Untitled Scene', 'cry']])
    })

    it('B. 상호작용공유 형식: 켜진 항목의 모든 조합', () => {
        const r = parseScenePresetJson({
            name: '공유',
            scenes: {
                a: { name: '포옹', slots: [[{ prompt: 'hug' }, { prompt: 'kiss', enabled: true }, { prompt: 'off', enabled: false }], [{ prompt: 'indoors' }]] },
                b: { name: '혼자', slots: [[{ prompt: 'solo' }]] },
            },
        })
        expect(r?.name).toBe('공유')
        expect(r?.scenes.map(s => [s.name, s.scenePrompt])).toEqual([
            ['포옹_1', 'hug, indoors'],
            ['포옹_2', 'kiss, indoors'],
            ['혼자', 'solo'],
        ])
    })

    it('C. SDImageGenEasy 프리셋', () => {
        const r = parseScenePresetJson({ presets: { SDImageGenEasy: [{ name: 'x', frontPrompt: 'a', backPrompt: 'b' }, { name: 'y', frontPrompt: 'c' }] } })
        expect(r?.scenes.map(s => [s.name, s.scenePrompt])).toEqual([['x', 'a, b'], ['y', 'c']])
    })

    it('D. NAIS2 씬 프리셋: id는 새로 만들고 해상도·그림은 지킨다', () => {
        const json = {
            id: 'p1',
            name: '내 씬',
            scenes: [
                { id: 's1', name: '하나', scenePrompt: 'one', queueCount: 3, width: 1216, height: 832, images: [{ id: 'i1', url: 'C:/a.png', timestamp: 5, isFavorite: true }], createdAt: 1 },
                { id: 's1', name: '둘', scenePrompt: 'two', images: [] },
            ],
        }
        const r = parseScenePresetJson(json)!
        expect(r.name).toBe('내 씬')
        expect(r.scenes).toHaveLength(2)
        expect(r.scenes[0]).toMatchObject({ name: '하나', scenePrompt: 'one', queueCount: 0, width: 1216, height: 832, createdAt: 1 })
        expect(r.scenes[0].images[0]).toMatchObject({ url: 'C:/a.png', timestamp: 5, isFavorite: true })
        // 파일 안의 id가 겹쳐도 새 id
        expect(new Set(r.scenes.map(s => s.id)).size).toBe(2)
        expect(r.scenes[0].id).not.toBe('s1')
        expect(r.scenes[0].images[0].id).not.toBe('i1')
        expect(r.scenes[1].width).toBeUndefined()
    })

    it('모르는 형식은 null', () => {
        expect(parseScenePresetJson({ foo: 1 })).toBeNull()
        expect(parseScenePresetJson('x')).toBeNull()
        expect(parseScenePresetJson(null)).toBeNull()
    })
})

describe('scene-store', () => {
    beforeEach(() => {
        useSceneStore.setState({ presets: [{ id: 'scene-default', name: '기본', scenes: [], createdAt: 0 }], activePresetId: 'scene-default' })
    })

    it('같은 파일을 두 번 불러와도 프리셋·씬 id가 겹치지 않는다', () => {
        const json = { name: 'P', scenes: [{ id: 'same', name: 'a', scenePrompt: 'x' }] }
        expect(useSceneStore.getState().importPreset(json)).toBe(true)
        expect(useSceneStore.getState().importPreset(json)).toBe(true)
        const ps = useSceneStore.getState().presets
        expect(ps.map(p => p.name)).toEqual(['기본', 'P', 'P (1)'])
        expect(ps[1].id).not.toBe(ps[2].id)
        expect(ps[1].scenes[0].id).not.toBe(ps[2].scenes[0].id)
        expect(useSceneStore.getState().activePresetId).toBe(ps[2].id)
    })

    it('씬이 없거나 모르는 형식이면 false', () => {
        expect(useSceneStore.getState().importPreset({ scenes: [] })).toBe(false)
        expect(useSceneStore.getState().importPreset({ hello: 'world' })).toBe(false)
        expect(useSceneStore.getState().presets).toHaveLength(1)
    })

    it('고화질 그림이 즐겨찾기를 이어받는다', () => {
        const st = useSceneStore.getState()
        st.addScene('scene-default', '씬')
        const sceneId = useSceneStore.getState().presets[0].scenes[0].id
        const src = st.addImageToScene('scene-default', sceneId, 'C:/NAIS_Scene/기본/씬/NAIS_SCENE_1.png')
        const other = st.addImageToScene('scene-default', sceneId, 'C:/NAIS_Scene/기본/씬/NAIS_SCENE_2.png')
        expect(src).not.toBe(other)
        st.toggleFavorite('scene-default', sceneId, src)

        const hq = useSceneStore.getState().addUpscaledImage('scene-default', sceneId, src, 'C:/NAIS_Scene/기본/씬/NAIS_SCENE_3.png')
        const images = useSceneStore.getState().presets[0].scenes[0].images
        expect(images[0].id).toBe(hq) // 맨 앞(최신)
        expect(images.find(i => i.id === hq)).toMatchObject({ isFavorite: true, upscaled: true })
        expect(images.find(i => i.id === src)?.isFavorite).toBe(false)
        expect(images.find(i => i.id === other)?.isFavorite).toBe(false)
        expect(isUpscaledSceneImage(images[0])).toBe(true)
        expect(isUpscaledSceneImage({ id: 'x', url: 'D:\\p\\NAIS_SCENE_HQ_5.png', timestamp: 0, isFavorite: false })).toBe(true)
        expect(isUpscaledSceneImage({ id: 'y', url: 'D:\\p\\NAIS_SCENE_5.png', timestamp: 0, isFavorite: false })).toBe(false)
    })

    it('생성 중이 아닐 때 취소는 아무것도 걸어 두지 않는다', () => {
        useSceneStore.getState().cancelSceneGeneration()
        expect(useSceneStore.getState().isCancelling).toBe(false)
    })
})
