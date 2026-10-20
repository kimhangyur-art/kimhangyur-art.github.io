import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import {
    Server,
    Settings2,
    Save,
    Check,
    X,
    Sun,
    Moon,
    Monitor,
    Languages,
    Loader2,
    FolderOpen,
    Palette,
    Type,
    Eye,
    RotateCcw,
    Info,
    RefreshCw,
    Download,
    Timer,
    Keyboard,
    Upload,
    Database,
    AlertTriangle,
    HardDrive,
    ExternalLink,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useComfyStore } from '@/stores/comfy-store'
import { useShortcutStore, SHORTCUT_ACTIONS, SHORTCUT_LABELS, DEFAULT_BINDINGS, formatKeyBinding, type ShortcutAction, type KeyBinding } from '@/stores/shortcut-store'
import { toast } from '@/components/ui/use-toast'
import { ComfySettingsSection } from '@/components/comfy/ComfySettingsSection'
import { open, save } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { exportAllData, importAllData, getStoreSizes } from '@/lib/indexed-db'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'

const LANGUAGES = [
    { code: 'ko', name: '한국어' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
]

type SettingsSection = 'comfy' | 'general' | 'appearance' | 'storage' | 'shortcuts' | 'backup'

const SECTIONS: { id: SettingsSection; icon: typeof Server; labelKey: string; defaultLabel: string }[] = [
    { id: 'comfy', icon: Server, labelKey: 'settingsPage.sections.comfy', defaultLabel: 'ComfyUI' },
    { id: 'general', icon: Settings2, labelKey: 'settingsPage.sections.general', defaultLabel: '일반' },
    { id: 'appearance', icon: Palette, labelKey: 'settingsPage.sections.appearance', defaultLabel: '외관' },
    { id: 'storage', icon: FolderOpen, labelKey: 'settingsPage.sections.storage', defaultLabel: '저장' },
    { id: 'shortcuts', icon: Keyboard, labelKey: 'settingsPage.sections.shortcuts', defaultLabel: '단축키' },
    { id: 'backup', icon: Database, labelKey: 'settingsPage.backup.title', defaultLabel: '백업' },
]

const DEFAULT_SECTION: SettingsSection = 'comfy'

function parseSection(v: string | null): SettingsSection | null {
    return SECTIONS.some(s => s.id === v) ? (v as SettingsSection) : null
}

/** 단축키 이름: 번역 파일에 있으면 그것, 없으면 한국어 기본 이름 */
function shortcutName(t: ReturnType<typeof useTranslation>['t'], action: ShortcutAction): string {
    return t(DEFAULT_BINDINGS[action].description, SHORTCUT_LABELS[action])
}

export default function Settings() {
    const { t, i18n } = useTranslation()
    const { theme, setTheme } = useThemeStore()
    const { savePath, autoSave, setSavePath, setAutoSave, promptFontSize, setPromptFontSize, useStreaming, setUseStreaming, generationDelay, setGenerationDelay, useAbsolutePath, libraryPath, useAbsoluteLibraryPath, setLibraryPath } = useSettingsStore()
    const { bindings, enabled: shortcutsEnabled, setBinding, resetBinding, resetAllBindings, setEnabled: setShortcutsEnabled } = useShortcutStore()
    const comfyUrl = useComfyStore(s => s.url)
    const comfyStatus = useComfyStore(s => s.status)
    const comfyVersion = useComfyStore(s => s.version)

    // 지금 보이는 구역은 주소의 ?section= 으로 정한다 (예: /settings?section=comfy)
    const [searchParams, setSearchParams] = useSearchParams()
    const activeSection: SettingsSection = parseSection(searchParams.get('section')) ?? DEFAULT_SECTION
    const setActiveSection = (section: SettingsSection) => {
        const next = new URLSearchParams(searchParams)
        next.set('section', section)
        setSearchParams(next, { replace: true })
    }

    const [localSavePath, setLocalSavePath] = useState(savePath)
    const [isAbsolutePath, setIsAbsolutePath] = useState(useAbsolutePath)
    const [localLibraryPath, setLocalLibraryPath] = useState(libraryPath)
    const [isAbsoluteLibraryPath, setIsAbsoluteLibraryPath] = useState(useAbsoluteLibraryPath)
    const [appVersion, setAppVersion] = useState('')

    // 키바인드 편집 상태
    const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null)
    const [recordedBinding, setRecordedBinding] = useState<KeyBinding | null>(null)
    
    // 백업 관련 상태
    const [isExporting, setIsExporting] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [storeSizes, setStoreSizes] = useState<{ [key: string]: number }>({})
    const [lastBackupTime, setLastBackupTime] = useState<string | null>(null)

    useEffect(() => {
        getVersion().then(setAppVersion).catch(() => setAppVersion('dev'))
        // 마지막 백업 시간 로드
        const lastBackup = localStorage.getItem('nais2-last-backup-time')
        if (lastBackup) setLastBackupTime(lastBackup)
    }, [])
    
    // 데이터 크기 로드 (backup 섹션 진입 시)
    useEffect(() => {
        if (activeSection === 'backup') {
            getStoreSizes().then(setStoreSizes).catch(console.error)
        }
    }, [activeSection])

    // 저장 경로가 다른 곳(백업 복원 등)에서 바뀌면 입력 칸도 맞춘다
    useEffect(() => {
        setLocalSavePath(savePath)
        setIsAbsolutePath(useAbsolutePath)
    }, [savePath, useAbsolutePath])

    useEffect(() => {
        setLocalLibraryPath(libraryPath)
        setIsAbsoluteLibraryPath(useAbsoluteLibraryPath)
    }, [libraryPath, useAbsoluteLibraryPath])

    const handleSavePath = () => {
        setSavePath(localSavePath, isAbsolutePath)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    // Browse for folder using native dialog
    const handleBrowseFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: t('settingsPage.save.selectFolder', 'Select Save Folder'),
            })
            if (selected && typeof selected === 'string') {
                setLocalSavePath(selected)
                setIsAbsolutePath(true)
            }
        } catch (e) {
            console.error('Folder selection failed:', e)
        }
    }

    // Reset to default Pictures subfolder
    const handleResetToDefault = async () => {
        setLocalSavePath('NAIS_Output')
        setIsAbsolutePath(false)
        setSavePath('NAIS_Output', false)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    // Library path handlers
    const handleSaveLibraryPath = () => {
        setLibraryPath(localLibraryPath, isAbsoluteLibraryPath)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    const handleBrowseLibraryFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: t('settingsPage.library.selectFolder', 'Select Library Folder'),
            })
            if (selected && typeof selected === 'string') {
                setLocalLibraryPath(selected)
                setIsAbsoluteLibraryPath(true)
            }
        } catch (e) {
            console.error('Folder selection failed:', e)
        }
    }

    const handleResetLibraryToDefault = async () => {
        setLocalLibraryPath('NAIS_Library')
        setIsAbsoluteLibraryPath(false)
        setLibraryPath('NAIS_Library', false)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }
    
    // 백업 내보내기
    const handleExportBackup = async () => {
        setIsExporting(true)
        try {
            const backup = await exportAllData()
            const storeCount = Object.keys(backup).filter(k => !k.startsWith('_')).length
            
            // 파일 저장 다이얼로그
            const filePath = await save({
                title: t('settingsPage.backup.export'),
                defaultPath: `nais2-backup-${new Date().toISOString().split('T')[0]}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            })
            
            if (filePath) {
                await writeTextFile(filePath, JSON.stringify(backup, null, 2))
                
                // 마지막 백업 시간 저장
                const now = new Date().toISOString()
                localStorage.setItem('nais2-last-backup-time', now)
                setLastBackupTime(now)
                
                toast({
                    title: t('settingsPage.backup.exported'),
                    description: t('settingsPage.backup.exportedDesc', { count: storeCount }),
                    variant: 'success',
                })
            }
        } catch (err) {
            console.error('Backup export failed:', err)
            toast({
                title: t('settingsPage.backup.exportFailed'),
                description: String(err),
                variant: 'destructive',
            })
        } finally {
            setIsExporting(false)
        }
    }
    
    // 백업 복원
    const handleImportBackup = async () => {
        try {
            // 파일 선택 다이얼로그
            const filePath = await open({
                title: t('settingsPage.backup.import'),
                filters: [{ name: 'JSON', extensions: ['json'] }],
                multiple: false,
            })
            
            if (!filePath || typeof filePath !== 'string') return
            
            // 확인 다이얼로그
            const confirmed = window.confirm(
                `${t('settingsPage.backup.confirmRestoreDesc')}\n\n${t('settingsPage.backup.restoreWarning')}`
            )
            if (!confirmed) return
            
            setIsImporting(true)
            
            const content = await readTextFile(filePath)
            const backup = JSON.parse(content)
            
            // 유효성 검증
            if (!backup._exportedAt || !backup._version) {
                toast({
                    title: t('settingsPage.backup.importFailed'),
                    description: t('settingsPage.backup.invalidFile'),
                    variant: 'destructive',
                })
                return
            }
            
            const result = await importAllData(backup, true)
            
            toast({
                title: t('settingsPage.backup.imported'),
                description: t('settingsPage.backup.importedDesc', { success: result.success.length }),
                variant: 'success',
            })
            
            // 앱 재시작
            setTimeout(() => {
                relaunch()
            }, 1500)
            
        } catch (err) {
            console.error('Backup import failed:', err)
            toast({
                title: t('settingsPage.backup.importFailed'),
                description: String(err),
                variant: 'destructive',
            })
        } finally {
            setIsImporting(false)
        }
    }
    
    // 데이터 크기 포맷팅
    const formatSize = (bytes: number) => {
        if (bytes < 0) return 'Error'
        if (bytes === 0) return '0 B'
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }
    
    const totalSize = Object.values(storeSizes).reduce((sum, size) => sum + (size > 0 ? size : 0), 0)

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-56 border-r border-border/50 p-4 space-y-1">
                <h2 className="text-lg font-semibold mb-4 px-2">{t('settingsPage.title')}</h2>
                {SECTIONS.map((section) => (
                    <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                            activeSection === section.id
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        )}
                    >
                        <section.icon className="h-4 w-4" />
                        {t(section.labelKey, section.defaultLabel)}
                    </button>
                ))}

                {/* ComfyUI 자체 화면 열기 (모델 관리·노드 확인용) */}
                <div className="pt-2 mt-2 border-t border-border/50">
                    <Tip content={t('settingsPage.openComfyTip', 'ComfyUI 원래 화면을 웹 브라우저로 엽니다 ({{url}})', { url: comfyUrl })} side="right">
                        <button
                            onClick={() => {
                                openUrl(comfyUrl).catch((e) => {
                                    toast({ title: t('settingsPage.openComfyFailed', 'ComfyUI 화면을 열지 못했습니다'), description: String(e), variant: 'destructive' })
                                })
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        >
                            <span className="h-4 w-4 shrink-0 flex items-center justify-center">
                                <span className={cn(
                                    'h-2 w-2 rounded-full',
                                    comfyStatus === 'online' ? 'bg-emerald-500' : comfyStatus === 'offline' ? 'bg-red-500' : 'bg-amber-500'
                                )} />
                            </span>
                            <span className="flex-1 text-left whitespace-nowrap">{t('settingsPage.openComfy', 'ComfyUI 열기')}</span>
                            <ExternalLink className="h-3 w-3 opacity-60" />
                        </button>
                    </Tip>
                </div>
            </aside>

            {/* Content */}
            <main className="flex-1 p-6 overflow-y-auto">
                <div className="max-w-2xl space-y-8">
                    {/* ComfyUI Section */}
                    {activeSection === 'comfy' && <ComfySettingsSection />}

                    {/* General Section */}
                    {activeSection === 'general' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.general')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.language.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Languages className="h-4 w-4 text-muted-foreground" />
                                            {t('settingsPage.language.select')}
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.language.description')}
                                        </p>
                                    </div>
                                    <Select value={i18n.language} onValueChange={(v) => i18n.changeLanguage(v)}>
                                        <SelectTrigger className="w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LANGUAGES.map((lang) => (
                                                <SelectItem key={lang.code} value={lang.code}>
                                                    {lang.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* 실시간 미리보기 */}
                                <div className="flex items-center justify-between gap-4 pt-4 border-t border-border/30">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Eye className="h-4 w-4 text-yellow-500" />
                                            {t('comfy.settings.livePreview', '실시간 미리보기')}
                                        </label>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            {t('comfy.settings.livePreviewHelp', '그리는 동안 진행 중인 그림을 미리 보여 줍니다. ComfyUI를 --preview-method auto 를 붙여 켜야 보입니다 (방법은 설정 → ComfyUI 도움말). 꺼도 진행률은 보입니다.')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={useStreaming}
                                        onChange={(e) => setUseStreaming(e.target.checked)}
                                    />
                                </div>

                                {/* Generation Delay */}
                                <div className="space-y-3 pt-4 border-t border-border/30">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Timer className="h-4 w-4 text-blue-500" />
                                            {t('comfy.settings.generationDelay', '연속 생성 사이 쉬는 시간')}
                                        </label>
                                        <span className="text-sm text-muted-foreground">{generationDelay}ms</span>
                                    </div>
                                    <Slider
                                        value={[generationDelay]}
                                        onValueChange={([v]) => setGenerationDelay(v)}
                                        min={0}
                                        max={5000}
                                        step={100}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('comfy.settings.generationDelayHelp', '여러 장을 연속으로 그릴 때 사이에 쉬는 시간. 로컬 ComfyUI는 보통 0')}
                                    </p>
                                </div>

                                {/* Version Info */}
                                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Info className="h-4 w-4 text-blue-500" />
                                            {t('settingsPage.version.title', 'Version')}
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            NAIS2 Comfy v{appVersion}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t('comfy.settings.basedOn', 'NAIS2(NovelAI Image Studio 2)의 화면을 그대로 옮겨 로컬 ComfyUI로 그리게 만든 판입니다.')}
                                        </p>
                                    </div>
                                    <span className={cn(
                                        'text-xs px-2 py-0.5 rounded-full shrink-0',
                                        comfyStatus === 'online' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                                    )}>
                                        {comfyStatus === 'online'
                                            ? `ComfyUI ${comfyVersion || ''}`.trim()
                                            : t('comfy.status.offline', 'ComfyUI 꺼짐')}
                                    </span>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Appearance Section */}
                    {activeSection === 'appearance' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.appearance')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.theme.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <label className="text-sm font-medium">{t('settingsPage.theme.mode')}</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { value: 'light' as const, icon: Sun, labelKey: 'settingsPage.theme.light' },
                                            { value: 'dark' as const, icon: Moon, labelKey: 'settingsPage.theme.dark' },
                                            { value: 'system' as const, icon: Monitor, labelKey: 'settingsPage.theme.system' },
                                        ].map((option) => (
                                            <button
                                                key={option.value}
                                                onClick={() => setTheme(option.value)}
                                                className={cn(
                                                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                                                    theme === option.value
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border/50 hover:border-border hover:bg-muted/30'
                                                )}
                                            >
                                                <option.icon className={cn(
                                                    'h-6 w-6',
                                                    theme === option.value ? 'text-primary' : 'text-muted-foreground'
                                                )} />
                                                <span className={cn(
                                                    'text-sm font-medium',
                                                    theme === option.value ? 'text-primary' : 'text-muted-foreground'
                                                )}>
                                                    {t(option.labelKey)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Type className="h-4 w-4" />
                                            {t('settingsPage.theme.fontSize', 'Prompt Font Size')}
                                        </label>
                                        <span className="text-sm text-muted-foreground">{promptFontSize}px</span>
                                    </div>
                                    <Slider
                                        value={[promptFontSize]}
                                        onValueChange={([v]) => setPromptFontSize(v)}
                                        min={12}
                                        max={24}
                                        step={1}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('settingsPage.theme.fontSizeHelp', 'Adjust the font size of the prompt input areas.')}
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Storage Section */}
                    {activeSection === 'storage' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.storage')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.save.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">{t('settingsPage.save.folder')}</label>
                                        {isAbsolutePath && (
                                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                {t('settingsPage.save.customPath', 'Custom Path')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            value={localSavePath}
                                            onChange={(e) => {
                                                setLocalSavePath(e.target.value)
                                                // If user manually types, assume it's relative unless it looks like an absolute path
                                                const isAbsolute = /^[A-Za-z]:[\\/]/.test(e.target.value) || e.target.value.startsWith('/')
                                                setIsAbsolutePath(isAbsolute)
                                            }}
                                            placeholder="NAIS_Output"
                                            className="flex-1"
                                        />
                                        <Button variant="outline" onClick={handleBrowseFolder}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            {t('settingsPage.save.browse', 'Browse')}
                                        </Button>
                                        <Button
                                            onClick={handleSavePath}
                                            variant={(localSavePath !== savePath || isAbsolutePath !== useAbsolutePath) ? "default" : "outline"}
                                            className={(localSavePath !== savePath || isAbsolutePath !== useAbsolutePath)
                                                ? "animate-pulse bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-500/50"
                                                : ""}
                                        >
                                            <Save className="h-4 w-4 mr-2" />
                                            {t('settingsPage.saveBtn')}
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground">
                                            {isAbsolutePath
                                                ? t('settingsPage.save.absolutePathHelp', 'Images will be saved to this exact folder.')
                                                : t('settingsPage.save.folderHelp')}
                                        </p>
                                        {isAbsolutePath && (
                                            <Button variant="ghost" size="sm" onClick={handleResetToDefault} className="h-6 text-xs">
                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                {t('settingsPage.save.resetDefault', 'Reset to Default')}
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium">{t('settingsPage.save.autoSave')}</label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.save.autoSaveHelp')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={autoSave}
                                        onChange={(e) => setAutoSave(e.target.checked)}
                                    />
                                </div>
                            </div>

                            {/* Library Path Setting */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">{t('settingsPage.library.folder', 'Library Folder')}</label>
                                        {isAbsoluteLibraryPath && (
                                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                {t('settingsPage.save.customPath', 'Custom Path')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            value={localLibraryPath}
                                            onChange={(e) => {
                                                setLocalLibraryPath(e.target.value)
                                                const isAbsolute = /^[A-Za-z]:[\\/]/.test(e.target.value) || e.target.value.startsWith('/')
                                                setIsAbsoluteLibraryPath(isAbsolute)
                                            }}
                                            placeholder="NAIS_Library"
                                            className="flex-1"
                                        />
                                        <Button variant="outline" onClick={handleBrowseLibraryFolder}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            {t('settingsPage.save.browse', 'Browse')}
                                        </Button>
                                        <Button
                                            onClick={handleSaveLibraryPath}
                                            variant={(localLibraryPath !== libraryPath || isAbsoluteLibraryPath !== useAbsoluteLibraryPath) ? "default" : "outline"}
                                            className={(localLibraryPath !== libraryPath || isAbsoluteLibraryPath !== useAbsoluteLibraryPath)
                                                ? "animate-pulse bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-500/50"
                                                : ""}
                                        >
                                            <Save className="h-4 w-4 mr-2" />
                                            {t('settingsPage.saveBtn')}
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground">
                                            {isAbsoluteLibraryPath
                                                ? t('settingsPage.library.absolutePathHelp', 'Library files will be saved to this exact folder.')
                                                : t('settingsPage.library.folderHelp', 'Default: Pictures/NAIS_Library')}
                                        </p>
                                        {isAbsoluteLibraryPath && (
                                            <Button variant="ghost" size="sm" onClick={handleResetLibraryToDefault} className="h-6 text-xs">
                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                {t('settingsPage.save.resetDefault', 'Reset to Default')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>

                        </section>
                    )}

                    {/* Shortcuts Section */}
                    {activeSection === 'shortcuts' && (
                        <section className="space-y-6">
                            <div>
                                <h2 className="text-xl font-semibold">{t('settingsPage.shortcuts.title', '단축키')}</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.shortcuts.description', '전역 단축키를 설정합니다.')}
                                </p>
                            </div>

                            {/* Enable/Disable Shortcuts */}
                            <div className="border border-border/50 rounded-xl p-6 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-medium">{t('settingsPage.shortcuts.enable', '단축키 활성화')}</label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {t('settingsPage.shortcuts.enableHelp', '전역 단축키를 활성화하거나 비활성화합니다.')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={shortcutsEnabled}
                                        onChange={(e) => setShortcutsEnabled(e.target.checked)}
                                    />
                                </div>
                            </div>

                            {/* Shortcut Bindings */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-4 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-medium">{t('settingsPage.shortcuts.bindings', '키 바인딩')}</h3>
                                    <Button variant="ghost" size="sm" onClick={resetAllBindings}>
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                        {t('settingsPage.shortcuts.resetAll', '전체 초기화')}
                                    </Button>
                                </div>

                                {/* Navigation */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.navigation', '네비게이션')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'navigation').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>

                                {/* Dialogs */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.dialogs', '다이얼로그')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'dialog').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>

                                {/* Actions */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.actions', '액션')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'action').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>
                            </div>
                        </section>
                    )}
                    
                    {/* Backup Section */}
                    {activeSection === 'backup' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.backup.title')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.backup.description')}
                                </p>
                            </div>
                            
                            {/* Export/Import */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <label className="text-sm font-medium flex items-center gap-2">
                                                <Download className="h-4 w-4 text-blue-500" />
                                                {t('settingsPage.backup.export')}
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('settingsPage.backup.exportDesc')}
                                            </p>
                                        </div>
                                        <Button onClick={handleExportBackup} disabled={isExporting}>
                                            {isExporting ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <Download className="h-4 w-4 mr-2" />
                                            )}
                                            {isExporting ? t('settingsPage.backup.exporting') : t('settingsPage.backup.export')}
                                        </Button>
                                    </div>
                                </div>
                                
                                <div className="border-t border-border/30 pt-6">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <label className="text-sm font-medium flex items-center gap-2">
                                                <Upload className="h-4 w-4 text-green-500" />
                                                {t('settingsPage.backup.import')}
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('settingsPage.backup.importDesc')}
                                            </p>
                                        </div>
                                        <Button variant="outline" onClick={handleImportBackup} disabled={isImporting}>
                                            {isImporting ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <Upload className="h-4 w-4 mr-2" />
                                            )}
                                            {isImporting ? t('settingsPage.backup.importing') : t('settingsPage.backup.import')}
                                        </Button>
                                    </div>
                                </div>
                                
                                {/* Last Backup Time */}
                                {lastBackupTime && (
                                    <div className="border-t border-border/30 pt-4">
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.backup.lastBackup')}: {new Date(lastBackupTime).toLocaleString()}
                                        </p>
                                    </div>
                                )}
                            </div>
                            
                            {/* Data Sizes */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-4 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium flex items-center gap-2">
                                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                                        {t('settingsPage.backup.sizes')}
                                    </h4>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => getStoreSizes().then(setStoreSizes)}
                                    >
                                        <RefreshCw className="h-3 w-3 mr-1" />
                                        {t('common.change', 'Refresh')}
                                    </Button>
                                </div>
                                
                                <div className="space-y-2 text-sm">
                                    {Object.entries(storeSizes).map(([key, size]) => (
                                        <div key={key} className="flex items-center justify-between py-1">
                                            <span className="text-muted-foreground">
                                                {key.replace('nais2-', '')}
                                            </span>
                                            <span className={cn(
                                                "font-mono",
                                                size > 1024 * 1024 && "text-yellow-500",
                                                size > 5 * 1024 * 1024 && "text-red-500"
                                            )}>
                                                {formatSize(size)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="border-t border-border/30 pt-2 flex items-center justify-between font-medium">
                                        <span>{t('settingsPage.backup.totalSize')}</span>
                                        <span className="font-mono">{formatSize(totalSize)}</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Warning */}
                            <div className="border border-yellow-500/30 rounded-xl p-4 bg-yellow-500/5">
                                <div className="flex gap-3">
                                    <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                                        <p className="font-medium">{t('settingsPage.backup.restoreWarning')}</p>
                                        <p className="text-xs mt-1 opacity-80">
                                            {t('settingsPage.backup.confirmRestoreDesc')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </main>
        </div>
    )
}

// 단축키 행 컴포넌트
interface ShortcutRowProps {
    action: ShortcutAction
    binding: KeyBinding
    allBindings: Record<ShortcutAction, KeyBinding>
    isEditing: boolean
    recordedBinding: KeyBinding | null
    onStartEdit: () => void
    onSave: (binding: KeyBinding) => void
    onCancel: () => void
    onReset: () => void
    onKeyRecord: (binding: KeyBinding) => void
    t: ReturnType<typeof useTranslation>['t']
}

function ShortcutRow({ action, binding, allBindings, isEditing, recordedBinding, onStartEdit, onSave, onCancel, onReset, onKeyRecord, t }: ShortcutRowProps) {
    const [conflictAction, setConflictAction] = useState<ShortcutAction | null>(null)

    // 충돌 체크 함수
    const checkConflict = (newBinding: KeyBinding): ShortcutAction | null => {
        for (const [otherAction, otherBinding] of Object.entries(allBindings)) {
            if (otherAction === action) continue // 자기 자신은 제외

            // 키 조합이 정확히 같은지 확인
            if (
                otherBinding.key === newBinding.key &&
                !!otherBinding.ctrl === !!newBinding.ctrl &&
                !!otherBinding.shift === !!newBinding.shift &&
                !!otherBinding.alt === !!newBinding.alt
            ) {
                return otherAction as ShortcutAction
            }
        }
        return null
    }

    const handleSave = () => {
        if (!recordedBinding) return

        const conflict = checkConflict(recordedBinding)
        if (conflict) {
            setConflictAction(conflict)
            return
        }

        onSave(recordedBinding)
        setConflictAction(null)
    }

    const handleForceOverride = () => {
        if (!recordedBinding) return
        onSave(recordedBinding)
        setConflictAction(null)
    }
    useEffect(() => {
        if (!isEditing) return

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()

            // Escape로 취소
            if (e.key === 'Escape') {
                onCancel()
                return
            }

            // 단독 modifier 키는 무시
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return
            }

            const newBinding: KeyBinding = {
                key: e.key,
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                label: '',
                description: binding.description,
            }
            newBinding.label = formatKeyBinding(newBinding)
            onKeyRecord(newBinding)
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [isEditing, binding.description, onCancel, onKeyRecord])

    const displayBinding = recordedBinding || binding

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                <span className="text-sm">{shortcutName(t, action)}</span>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <div className={cn(
                                "px-3 py-1.5 rounded-md text-sm font-mono min-w-[100px] text-center",
                                recordedBinding ? "bg-primary text-primary-foreground" : "bg-muted animate-pulse"
                            )}>
                                {recordedBinding ? recordedBinding.label : t('settingsPage.shortcuts.pressKey', '키 입력...')}
                            </div>
                            <Button size="sm" variant="ghost" onClick={onCancel}>
                                <X className="h-4 w-4" />
                            </Button>
                            {recordedBinding && (
                                <Button size="sm" variant="default" onClick={handleSave}>
                                    <Check className="h-4 w-4" />
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            <button
                                onClick={onStartEdit}
                                className="px-3 py-1.5 rounded-md text-sm font-mono bg-muted hover:bg-muted/80 min-w-[100px] text-center"
                            >
                                {displayBinding.label}
                            </button>
                            <Tip content={t('settingsPage.shortcuts.reset', '초기화')}>
                                <Button size="sm" variant="ghost" onClick={onReset}>
                                    <RotateCcw className="h-3 w-3" />
                                </Button>
                            </Tip>
                        </>
                    )}
                </div>
            </div>

            {/* 충돌 경고 */}
            {conflictAction && recordedBinding && (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                        <Info className="h-4 w-4" />
                        <span>
                            {t('settingsPage.shortcuts.conflict', '이미 사용 중:')} {shortcutName(t, conflictAction)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConflictAction(null)}
                            className="text-destructive hover:text-destructive"
                        >
                            {t('common.cancel', '취소')}
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleForceOverride}
                        >
                            {t('settingsPage.shortcuts.override', '덮어쓰기')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
