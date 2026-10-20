// 만든 그림을 저장하고 오른쪽 기록 패널에 알린다.
// (원래 generation-store / MainMode / HistoryPanel / useSceneGeneration 에 따로 있던 저장 코드를 한 곳에 모았다)
//
// 폴더 (설정의 저장 위치 기준, 기본은 사진 폴더):
//   메인 생성       <저장 위치>/NAIS_<시각>.png                         (기본 저장 위치: 사진/NAIS_Output)
//   고화질 다시     <원본과 같은 폴더>/NAIS_UPSCALE_<시각>.png
//   씬             <사진 또는 절대 저장 위치>/NAIS_Scene/<프리셋>/<씬>/NAIS_SCENE_<시각>.png
//   변형 모드       <사진 또는 절대 저장 위치>/NAIS_Variation/<묶음>/NAIS_VAR_<변형>_<시각>.png
// 파일 이름 끝의 _<숫자>.png 는 기록 패널이 시간순 정렬에 쓴다.
import { useSettingsStore } from '@/stores/settings-store'
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { dirname, join, pictureDir } from '@tauri-apps/api/path'

export type OutputKind = 'main' | 'upscale' | 'scene' | 'variation'

export interface SaveOptions {
    kind: OutputKind
    presetName?: string
    sceneName?: string
    /** 변형 모드 묶음 이름 */
    groupName?: string
    /** 변형 이름 (파일 이름에 들어간다) */
    label?: string
    /** 고화질로 다시 그린 그림이면 원본 경로 (같은 폴더에 저장) */
    sourcePath?: string
}

export interface SaveResult {
    /** 저장한 경로. 자동 저장을 끈 경우 memory://… */
    path: string
    saved: boolean
    error?: string
}

/** Windows에서 못 쓰는 글자와 이름을 피한다 */
export function safeName(name: string | undefined, fallback: string): string {
    let s = (name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '')
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`
    return s || fallback
}

let lastStamp = 0
/** 같은 밀리초에 두 장이 저장돼도 이름이 겹치지 않게 */
function stamp(): number {
    const now = Date.now()
    lastStamp = now > lastStamp ? now : lastStamp + 1
    return lastStamp
}

async function outputRoot(): Promise<string> {
    const { savePath, useAbsolutePath } = useSettingsStore.getState()
    if (useAbsolutePath && savePath) return savePath
    return join(await pictureDir(), savePath || 'NAIS_Output')
}

/** 씬·변형 모드 폴더의 기준 (원래 NAIS2와 같이: 절대 경로를 정했으면 거기, 아니면 사진 폴더) */
export async function collectionRoot(): Promise<string> {
    const { savePath, useAbsolutePath } = useSettingsStore.getState()
    if (useAbsolutePath && savePath) return savePath
    return pictureDir()
}

export async function sceneFolder(presetName: string | undefined, sceneName: string | undefined): Promise<string> {
    return join(await collectionRoot(), 'NAIS_Scene', safeName(presetName, 'Default'), safeName(sceneName, 'Untitled_Scene'))
}

export async function variationFolder(groupName: string | undefined): Promise<string> {
    return join(await collectionRoot(), 'NAIS_Variation', safeName(groupName, 'Variation'))
}

async function folderFor(opts: SaveOptions): Promise<string> {
    switch (opts.kind) {
        case 'scene':
            return sceneFolder(opts.presetName, opts.sceneName)
        case 'variation':
            return variationFolder(opts.groupName)
        case 'upscale':
            if (opts.sourcePath && !opts.sourcePath.startsWith('memory://')) return dirname(opts.sourcePath)
            return outputRoot()
        default:
            return outputRoot()
    }
}

function fileNameFor(opts: SaveOptions, inScene: boolean): string {
    const t = stamp()
    switch (opts.kind) {
        case 'scene':
            return `NAIS_SCENE_${t}.png`
        case 'variation':
            return `NAIS_VAR_${safeName(opts.label, 'v').slice(0, 60).replace(/\s+/g, '_')}_${t}.png`
        case 'upscale':
            return inScene ? `NAIS_SCENE_HQ_${t}.png` : `NAIS_UPSCALE_${t}.png`
        default:
            return `NAIS_${t}.png`
    }
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64.replace(/^data:[^,]+,/, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

export function notifyNewImage(path: string, dataUrl?: string) {
    try {
        window.dispatchEvent(new CustomEvent('newImageGenerated', { detail: dataUrl ? { path, data: dataUrl } : { path } }))
    } catch (e) {
        console.warn('Failed to dispatch newImageGenerated event:', e)
    }
}

/**
 * 저장하고 기록 패널에 알린다.
 * 메인 생성은 설정에서 자동 저장을 끄면 파일 없이 기록 패널에만 보인다(memory://).
 * 씬·변형 모드는 그림 목록이 파일 경로를 기억하므로 언제나 저장한다.
 */
export async function saveOutputImage(image: Uint8Array | string, opts: SaveOptions): Promise<SaveResult> {
    const bytes = typeof image === 'string' ? base64ToBytes(image) : image
    const { autoSave } = useSettingsStore.getState()
    const alwaysSave = opts.kind === 'scene' || opts.kind === 'variation' || (opts.kind === 'upscale' && !!opts.sourcePath && !opts.sourcePath.startsWith('memory://'))
    if (!autoSave && !alwaysSave) {
        const memPath = `memory://NAIS_${opts.kind === 'upscale' ? 'UPSCALE_' : ''}${stamp()}.png`
        notifyNewImage(memPath, `data:image/png;base64,${typeof image === 'string' ? image.replace(/^data:[^,]+,/, '') : bytesToBase64(bytes)}`)
        return { path: memPath, saved: false }
    }
    try {
        const dir = await folderFor(opts)
        if (!(await exists(dir))) await mkdir(dir, { recursive: true })
        const inScene = /[\\/]NAIS_Scene[\\/]/.test(dir + '/')
        const path = await join(dir, fileNameFor(opts, inScene))
        await writeFile(path, bytes)
        notifyNewImage(path)
        return { path, saved: true }
    } catch (e) {
        // 파일로 못 쓰면(실행 파일 없이 연 경우 등) 내려받기로 대신한다
        console.warn('save failed, falling back to download:', e)
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
        const a = document.createElement('a')
        a.href = url
        a.download = fileNameFor(opts, false)
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        return { path: `memory://${a.download}`, saved: false, error: (e as Error).message }
    }
}

export function bytesToBase64(bytes: Uint8Array): string {
    let s = ''
    const chunk = 32768
    for (let i = 0; i < bytes.length; i += chunk) {
        s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))))
    }
    return btoa(s)
}
