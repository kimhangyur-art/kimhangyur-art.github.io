import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSceneGeneration } from '@/hooks/useSceneGeneration'
import { useShortcuts } from '@/hooks/useShortcuts'
import MainMode from '@/pages/MainMode'
import SceneMode from '@/pages/SceneMode'
import SceneDetail from '@/pages/SceneDetail'
import VariationMode from '@/pages/VariationMode'
import Library from '@/pages/Library'
import Settings from '@/pages/Settings'

function AppContent() {
    // Scene generation hook at App level - persists across page navigation
    useSceneGeneration()
    useShortcuts()

    // Disable right-click globally except for allowed elements
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            // Check if the target or any parent has data-allow-context-menu attribute
            let element = e.target as HTMLElement | null
            while (element) {
                if (element.hasAttribute('data-allow-context-menu')) {
                    return // Allow context menu
                }
                element = element.parentElement
            }
            e.preventDefault() // Block context menu
        }

        document.addEventListener('contextmenu', handleContextMenu)
        return () => document.removeEventListener('contextmenu', handleContextMenu)
    }, [])

    // 드롭 영역이 아닌 데에 그림 파일(또는 앱 안의 그림)을 떨어뜨리면 브라우저가 그것을 열어
    // 앱 화면이 사라진다. 그것만 막는다. 각 화면의 드롭 영역은 그대로 동작하도록 preventDefault만 하고
    // 전파는 막지 않는다 (드롭 영역은 이벤트가 window에 닿기 전에 먼저 받는다).
    // 글 입력 칸에 글자를 끌어 넣는 것은 브라우저 기본 동작이므로 파일이 아니면 건드리지 않는다.
    useEffect(() => {
        const keepPage = (e: DragEvent) => {
            const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
            const hasFiles = types.includes('Files')
            const target = e.target instanceof Element ? e.target : null
            const editable = !!target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
            if (hasFiles || !editable) e.preventDefault()
        }
        window.addEventListener('dragover', keepPage)
        window.addEventListener('drop', keepPage)
        return () => {
            window.removeEventListener('dragover', keepPage)
            window.removeEventListener('drop', keepPage)
        }
    }, [])

    return (
        <ThreeColumnLayout>
            <Routes>
                <Route path="/" element={<MainMode />} />
                <Route path="/scenes" element={<SceneMode />} />
                <Route path="/scenes/:id" element={<SceneDetail />} />
                <Route path="/variations" element={<VariationMode />} />
                <Route path="/library" element={<Library />} />
                <Route path="/settings" element={<Settings />} />
            </Routes>
        </ThreeColumnLayout>
    )
}

function App() {
    return (
        <TooltipProvider delayDuration={300}>
            <BrowserRouter>
                <AppContent />
                <Toaster />
            </BrowserRouter>
        </TooltipProvider>
    )
}

export default App
