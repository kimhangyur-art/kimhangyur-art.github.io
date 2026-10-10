// exe(런처)로 실행했을 때만 쓰는 부분: 창이 열려 있는 동안 신호를 보내고, 닫히면 알린다.
// 신호가 끊기면 런처가 스스로 끝난다. 개발 서버나 다른 곳에서 열면 아무것도 하지 않는다.

export async function connectLauncher(): Promise<boolean> {
  try {
    const res = await fetch('./__launcher', { cache: 'no-store' });
    if (!res.ok) return false;
    const info = (await res.json()) as { app?: string };
    if (info.app !== 'comfy-asset-tool') return false;
  } catch {
    return false;
  }
  const beat = () => void fetch('./__heartbeat', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
  beat();
  setInterval(beat, 10_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && beat());
  window.addEventListener('pagehide', () => navigator.sendBeacon('./__bye'));
  return true;
}
