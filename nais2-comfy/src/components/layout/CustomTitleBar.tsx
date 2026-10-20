// 지금은 쓰지 않는다: NAIS2 Comfy 창은 Edge 앱 창이라 제목 줄(최소화·최대화·닫기)을 창이 직접 그린다.
// 사이드바 접기 버튼은 ThreeColumnLayout 가운데 메뉴 양옆에 있다.
// (창 조작은 shims/window.ts 에서 아무 일도 하지 않는 함수라 그대로 두어도 컴파일된다)
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft, PanelRight, Minus, Square, X, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout-store'
import { Tip } from '@/components/ui/tooltip'

export function CustomTitleBar() {
    const { t } = useTranslation()
    const [isMaximized, setIsMaximized] = useState(false)
    const appWindow = getCurrentWindow()

    const {
        leftSidebarVisible,
        rightSidebarVisible,
        toggleLeftSidebar,
        toggleRightSidebar
    } = useLayoutStore()

    useEffect(() => {
        appWindow.isMaximized().then(setIsMaximized)

        const unlisten = appWindow.onResized(async () => {
            setIsMaximized(await appWindow.isMaximized())
        })

        return () => {
            unlisten.then(fn => fn())
        }
    }, [appWindow])

    const handleMinimize = async () => {
        await appWindow.minimize()
    }

    const handleMaximize = async () => {
        await appWindow.toggleMaximize()
    }

    const handleClose = async () => {
        await appWindow.close()
    }

    const handleMouseDown = async (e: React.MouseEvent) => {
        // Only start dragging on single click, not double click
        if (e.button === 0 && e.detail === 1) {
            await appWindow.startDragging()
        }
    }

    const handleDoubleClick = async () => {
        await appWindow.toggleMaximize()
    }

    return (
        <div
            className="h-8 flex items-center justify-between bg-background select-none shrink-0"
        >
            {/* Drag Region */}
            <div
                className="flex-1 h-full cursor-default"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            />

            {/* Controls */}
            <div className="flex h-full">
                {/* Left Sidebar Toggle */}
                <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')} side="bottom">
                    <button
                        onClick={toggleLeftSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !leftSidebarVisible && "text-muted-foreground/50"
                        )}
                        aria-label="Toggle Left Sidebar"
                    >
                        <PanelLeft className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Right Sidebar Toggle */}
                <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')} side="bottom">
                    <button
                        onClick={toggleRightSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !rightSidebarVisible && "text-muted-foreground/50"
                        )}
                        aria-label="Toggle Right Sidebar"
                    >
                        <PanelRight className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Separator */}
                <div className="w-px h-4 my-auto bg-border/50 mx-1" />

                {/* Minimize */}
                <button
                    onClick={handleMinimize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    aria-label="Minimize"
                >
                    <Minus className="h-4 w-4" />
                </button>

                {/* Maximize/Restore */}
                <button
                    onClick={handleMaximize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Maximize2 className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                </button>

                {/* Close */}
                <button
                    onClick={handleClose}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-white hover:bg-red-500",
                        "transition-colors"
                    )}
                    aria-label="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}
