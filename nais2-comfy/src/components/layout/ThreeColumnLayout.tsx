import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PromptPanel } from './PromptPanel'
import { HistoryPanel } from './HistoryPanel'
import { AnimatedNavBar, type NavItem } from './AnimatedNavBar'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
import { ComfyStatusPill } from '@/components/comfy/ComfyStatusPill'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import GlassSurface from '@/components/ui/GlassSurface'
import { Tip } from '@/components/ui/tooltip'
import {
    Home,
    Film,
    Shuffle,
    Images,
    Settings,
    PanelLeft,
    PanelRight,
} from 'lucide-react'
import { usePresetStore } from '@/stores/preset-store'
import { useLayoutStore } from '@/stores/layout-store'

interface ThreeColumnLayoutProps {
    children: ReactNode
}

const NAV_ITEMS: NavItem[] = [
    { path: '/', icon: Home, labelKey: 'nav.main', defaultLabel: '메인' },
    { path: '/scenes', icon: Film, labelKey: 'nav.scenes', defaultLabel: '씬 모드' },
    { path: '/variations', icon: Shuffle, labelKey: 'nav.variations', defaultLabel: '변형 모드' },
    { path: '/library', icon: Images, labelKey: 'nav.library', defaultLabel: '라이브러리' },
    { path: '/settings', icon: Settings, labelKey: 'nav.settings', defaultLabel: '설정' },
]

// 글자까지 보이는 메뉴 양옆에 남길 최소 여백
const NAV_SIDE_MARGIN = 24

// 가운데 칸 안쪽 여백 없이 꽉 채우는 화면
const FULL_BLEED_ROUTES = ['/', '/library']

export function ThreeColumnLayout({ children }: ThreeColumnLayoutProps) {
    const { t, i18n } = useTranslation()
    const location = useLocation()
    const { leftSidebarVisible, rightSidebarVisible, toggleLeftSidebar, toggleRightSidebar } = useLayoutStore()

    // Get active preset for header display
    const { presets, activePresetId } = usePresetStore()
    const activePreset = presets.find(p => p.id === activePresetId)

    // Preset dialog state (for shortcut support)
    const [presetDialogOpen, setPresetDialogOpen] = useState(false)

    // 가운데 칸 너비 (양쪽 칸을 접으면 넓어지므로 창 너비 대신 실제 너비로 메뉴 모양을 정한다)
    const centerRef = useRef<HTMLDivElement>(null)
    const [centerWidth, setCenterWidth] = useState<number | null>(null)

    // 글자까지 보이는 메뉴의 실제 너비 (언어마다 다르므로 그려 보고 잰다)
    const navRowRef = useRef<HTMLDivElement>(null)
    const [fullNavWidth, setFullNavWidth] = useState(0)
    const [navCompact, setNavCompact] = useState(false)

    // 언어를 바꾸면 글자 메뉴를 다시 그려서 다시 잰다
    useEffect(() => {
        setFullNavWidth(0)
        setNavCompact(false)
    }, [i18n.language])

    useLayoutEffect(() => {
        if (navCompact) return
        const w = navRowRef.current?.offsetWidth ?? 0
        if (w > 0 && w !== fullNavWidth) setFullNavWidth(w)
    })

    useEffect(() => {
        if (centerWidth === null || fullNavWidth === 0) return
        setNavCompact(centerWidth < fullNavWidth + NAV_SIDE_MARGIN)
    }, [centerWidth, fullNavWidth])

    useEffect(() => {
        const el = centerRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width
            if (typeof w === 'number') setCenterWidth(w)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // 프리셋 다이얼로그 단축키 이벤트 수신
    useEffect(() => {
        const handleOpenPreset = () => setPresetDialogOpen(prev => !prev)

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
        }
    }, [])

    return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            {/* 창 제목 줄은 앱 창(Edge)이 직접 그리므로 따로 그리지 않는다 */}

            {/* Main Layout */}
            <div className="flex flex-1 p-3 gap-3 overflow-hidden">
                {/* Left Panel - Prompt Input (Fixed, Rounded Box) */}
                <aside className={cn(
                    "w-[420px] xl:w-[460px] 2xl:w-[500px] flex-shrink-0 flex flex-col bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg transition-all duration-200",
                    !leftSidebarVisible && "hidden"
                )}>
                    {/* Header - Preset Title & ComfyUI Status */}
                    <div className="h-14 flex items-center justify-between gap-2 px-4">
                        {/* Preset Title + Dialog Trigger */}
                        <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-base font-semibold truncate max-w-[180px]">
                                {activePreset?.name || t('preset.default', '기본')}
                            </h2>
                            <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                        </div>

                        {/* ComfyUI 연결 상태 (+ 고화질로 다시 그리는 중인 개수) */}
                        <ComfyStatusPill className="shrink-0" />
                    </div>

                    {/* Prompt Panel */}
                    <PromptPanel />
                </aside>

                {/* Center Panel - Page Content (Rounded Box) */}
                <div
                    ref={centerRef}
                    className="flex-1 flex flex-col min-w-0 bg-card/30 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg"
                >
                    {/* Tab Navigation (Glass Surface) */}
                    <div className="shrink-0 flex items-center justify-center py-3 z-10">
                        <div ref={navRowRef} className="flex items-center gap-2">
                            {/* Left sidebar toggle */}
                            <Tip content={leftSidebarVisible
                                ? t('layout.hideLeftSidebar', '왼쪽 프롬프트 칸 접기')
                                : t('layout.showLeftSidebar', '왼쪽 프롬프트 칸 펼치기')}
                            >
                                <button
                                    onClick={toggleLeftSidebar}
                                    aria-label={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !leftSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelLeft className="h-4 w-4" />
                                </button>
                            </Tip>
                            <GlassSurface
                                width="fit-content"
                                height={52}
                                borderRadius={30}
                                opacity={0.6}
                                blur={15}
                                borderWidth={0.5}
                                className="flex items-center px-2"
                            >
                                <AnimatedNavBar items={NAV_ITEMS} compact={navCompact} />
                            </GlassSurface>
                            {/* Right sidebar toggle */}
                            <Tip content={rightSidebarVisible
                                ? t('layout.hideRightSidebar', '오른쪽 기록 칸 접기')
                                : t('layout.showRightSidebar', '오른쪽 기록 칸 펼치기')}
                            >
                                <button
                                    onClick={toggleRightSidebar}
                                    aria-label={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !rightSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelRight className="h-4 w-4" />
                                </button>
                            </Tip>
                        </div>
                    </div>

                    {/* Page Content */}
                    <main className={cn(
                        "flex-1 relative",
                        FULL_BLEED_ROUTES.includes(location.pathname) ? "p-0 overflow-hidden" : "p-4 overflow-y-auto"
                    )}>
                        {children}
                    </main>
                </div>

                {/* Right Panel - History Only (Rounded Box) */}
                <aside className={cn(
                    "w-[280px] flex-shrink-0 bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg transition-all duration-200",
                    !rightSidebarVisible && "hidden"
                )}>
                    <HistoryPanel />
                </aside>
            </div>
        </div>
    )
}
