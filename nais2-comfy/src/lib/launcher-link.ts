// exe(launcher)와 연결 유지: 10초마다 신호를 보내고, 창을 닫으면 "닫힘"을 알린다.
// 신호가 끊기면 exe가 스스로 끝난다 (comfy-asset-tool 과 같은 방식).
import { hasLauncher } from '@/shims/server'

let started = false

export function connectLauncher(): void {
    if (started || !hasLauncher()) return
    started = true
    const beat = () => {
        fetch('/__heartbeat', { method: 'POST', keepalive: true }).catch(() => { /* exe가 이미 끝났으면 무시 */ })
    }
    beat()
    setInterval(beat, 10_000)
    window.addEventListener('pagehide', () => {
        try {
            navigator.sendBeacon('/__bye')
        } catch { /* empty */ }
    })
}
