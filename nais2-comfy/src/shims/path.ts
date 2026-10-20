// @tauri-apps/api/path 대체. 폴더 위치는 실행 파일에서 받아 온다.
import { launcherInfo } from './server'

async function dir(key: string): Promise<string> {
    const info = await launcherInfo()
    const d = info.dirs[key]
    if (!d) throw new Error(`알 수 없는 폴더: ${key}`)
    return d
}

export const pictureDir = () => dir('Picture')
export const documentDir = () => dir('Document')
export const downloadDir = () => dir('Download')
export const desktopDir = () => dir('Desktop')
export const homeDir = () => dir('Home')
export const tempDir = () => dir('Temp')
export const appDataDir = () => dir('AppData')
export const appConfigDir = () => dir('AppConfig')
export const appLocalDataDir = () => dir('AppLocalData')
export const appCacheDir = () => dir('AppCache')
export const appLogDir = () => dir('AppLog')

/** 운영체제 구분자 (실행 파일 정보를 받기 전에는 경로에 쓰인 구분자로 짐작) */
let cachedSep: string | null = null
launcherInfo().then((i) => { cachedSep = i.sep }).catch(() => { /* 실행 파일 없이 열린 경우 */ })

export function sep(): string {
    return cachedSep ?? (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? '\\' : '/')
}

function sepFor(parts: string[]): string {
    if (cachedSep) return cachedSep
    // C:\ 또는 \\서버 로 시작하면 Windows 경로
    if (parts.some((p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.includes('\\'))) return '\\'
    return sep()
}

/** 경로 조각을 잇는다. 구분자는 운영체제 것으로 통일하고, 중복 구분자와 . 조각을 정리한다. */
export function joinSync(...parts: string[]): string {
    const s = sepFor(parts)
    const filtered = parts.filter((p) => p !== '')
    if (filtered.length === 0) return '.'
    const raw = filtered.join('/').replace(/[\\/]+/g, '/')
    const unc = s === '\\' && /^[\\/]{2}/.test(filtered[0])
    const out: string[] = []
    const segs = raw.split('/')
    const leading = raw.startsWith('/') ? '/' : ''
    for (const seg of segs) {
        if (seg === '' || seg === '.') continue
        if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..' && !/^[a-zA-Z]:$/.test(out[out.length - 1])) {
            out.pop()
            continue
        }
        out.push(seg)
    }
    let joined = out.join(s)
    if (/^[a-zA-Z]:$/.test(out[0] ?? '') && out.length === 1) joined += s
    if (unc) return '\\\\' + joined
    if (leading && s === '/') return '/' + joined
    if (leading && s === '\\' && !/^[a-zA-Z]:/.test(joined)) return '\\' + joined
    return joined
}

export async function join(...parts: string[]): Promise<string> {
    return joinSync(...parts)
}

export async function normalize(p: string): Promise<string> {
    return joinSync(p)
}

export async function resolve(...parts: string[]): Promise<string> {
    return joinSync(...parts)
}

export async function dirname(p: string): Promise<string> {
    const s = sepFor([p])
    const norm = joinSync(p)
    const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
    if (i <= 0) return s === '/' && norm.startsWith('/') ? '/' : norm
    const d = norm.slice(0, i)
    return /^[a-zA-Z]:$/.test(d) ? d + s : d
}

export async function basename(p: string, ext?: string): Promise<string> {
    const name = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name
}

export async function extname(p: string): Promise<string> {
    const name = p.split(/[\\/]/).pop() ?? ''
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i + 1) : ''
}

export async function isAbsolute(p: string): Promise<boolean> {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
}

export enum BaseDirectory {
    Audio = 1,
    Cache = 2,
    Config = 3,
    Data = 4,
    LocalData = 5,
    Document = 6,
    Download = 7,
    Picture = 8,
    Public = 9,
    Video = 10,
    Resource = 11,
    Temp = 12,
    AppConfig = 13,
    AppData = 14,
    AppLocalData = 15,
    AppCache = 16,
    AppLog = 17,
    Desktop = 18,
    Executable = 19,
    Font = 20,
    Home = 21,
    Runtime = 22,
    Template = 23,
}

const BASE_KEYS: Partial<Record<BaseDirectory, string>> = {
    [BaseDirectory.Cache]: 'AppCache',
    [BaseDirectory.Config]: 'AppConfig',
    [BaseDirectory.Data]: 'AppData',
    [BaseDirectory.LocalData]: 'AppLocalData',
    [BaseDirectory.Document]: 'Document',
    [BaseDirectory.Download]: 'Download',
    [BaseDirectory.Picture]: 'Picture',
    [BaseDirectory.Temp]: 'Temp',
    [BaseDirectory.AppConfig]: 'AppConfig',
    [BaseDirectory.AppData]: 'AppData',
    [BaseDirectory.AppLocalData]: 'AppLocalData',
    [BaseDirectory.AppCache]: 'AppCache',
    [BaseDirectory.AppLog]: 'AppLog',
    [BaseDirectory.Desktop]: 'Desktop',
    [BaseDirectory.Home]: 'Home',
}

/** BaseDirectory 기준 상대 경로를 절대 경로로 */
export async function resolveBase(path: string, baseDir?: BaseDirectory): Promise<string> {
    if (baseDir === undefined) return joinSync(path)
    const key = BASE_KEYS[baseDir]
    if (!key) throw new Error(`이 프로그램에서는 쓸 수 없는 폴더 종류입니다 (${BaseDirectory[baseDir]})`)
    return joinSync(await dir(key), path)
}
