import { useState, useRef, useEffect, useId, Fragment, KeyboardEvent, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Editor from 'react-simple-code-editor'
import { getCaretCoordinates } from '@/utils/caret-coords'
import { cn } from '@/lib/utils'
import { useFragmentStore } from '@/stores/fragment-store'
import { useSettingsStore } from '@/stores/settings-store'

// --- Types ---
interface Tag {
    label: string
    value: string
    count: number
    type: string
}

interface SuggestionItem {
    label: string
    value: string
    count?: number
    type: string
    _lower?: string
}

interface AutocompleteTextareaProps {
    value: string
    onChange: (e: { target: { value: string } }) => void
    className?: string
    maxSuggestions?: number
    style?: React.CSSProperties
    placeholder?: string
    disabled?: boolean
    readOnly?: boolean
}

// --- Tag dictionary (lazy) ---
// tags.json 은 28MB 라서 처음 입력 칸을 누를 때 따로 불러온다 (첫 화면이 빨리 뜨도록)
interface IndexedTag extends Tag {
    _lower: string
}

interface TagDictionary {
    all: IndexedTag[]
    // 첫 글자별 인덱스 (O(1) 접근)
    byFirstChar: Record<string, IndexedTag[]>
}

let tagDictionary: TagDictionary | null = null
let tagDictionaryPromise: Promise<TagDictionary> | null = null

function loadTagDictionary(): Promise<TagDictionary> {
    if (tagDictionary) return Promise.resolve(tagDictionary)
    if (!tagDictionaryPromise) {
        tagDictionaryPromise = import('@/assets/tags.json')
            .then((mod) => {
                const raw = mod.default as unknown as Tag[]
                // 사전 처리: 소문자 변환된 label 캐싱 (최초 1회만)
                const all: IndexedTag[] = raw.map(tag => ({ ...tag, _lower: tag.label.toLowerCase() }))
                const byFirstChar: Record<string, IndexedTag[]> = {}
                for (const tag of all) {
                    const firstChar = tag._lower[0] || '_'
                    if (!byFirstChar[firstChar]) byFirstChar[firstChar] = []
                    byFirstChar[firstChar].push(tag)
                }
                tagDictionary = { all, byFirstChar }
                return tagDictionary
            })
            .catch((err) => {
                // 다음에 다시 시도할 수 있게
                tagDictionaryPromise = null
                throw err
            })
    }
    return tagDictionaryPromise
}

// 지금 입력 중인 단어의 경계: 쉼표, 줄바꿈, :: 가중치, 괄호 ( ) { } [ ], 와일드카드 구분자 |
const CURRENT_WORD_RE = /[^,\n:(){}[\]|]*$/
// 이 글자 바로 뒤에는 띄어쓰기 없이 붙여 넣는다
const NO_SPACE_AFTER = [' ', '\n', ':', '(', '{', '[', '|']

/** ComfyUI 문법에서 괄호는 가중치라서 글자 괄호는 \( \) 로 써야 한다 */
function escapeParens(text: string): string {
    return text.replace(/(?<!\\)([()])/g, '\\$1')
}

// 하이라이트: NAI 가중치 1.2::태그::, ComfyUI 가중치 (태그:1.2), 조각 <이름>
const HIGHLIGHT_RE = /(-?[\d.]+::.*?::)|((?<!\\)\((?:[^()\\\n]|\\.)*?:\s*-?\d*\.?\d+\s*\))|(<[^>]+>)/g
const NAI_WEIGHT_RE = /^-?[\d.]+::.*::$/
const COMFY_WEIGHT_RE = /^\((?:[^()\\\n]|\\.)*?:\s*(-?\d*\.?\d+)\s*\)$/

// Single source of truth for Typography to ensure Textarea and Pre match perfectly.
const TYPOGRAPHY = {
    fontFamily: '"Inter", "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    lineHeight: '1.5',
    letterSpacing: 'normal',
    fontVariantLigatures: 'none',
    tabSize: 4,
}

export function AutocompleteTextarea({
    value,
    onChange,
    className,
    maxSuggestions = 15,
    style, // mainly used for fontSize
    placeholder,
    ...props
}: AutocompleteTextareaProps) {
    // --- Refs ---
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const containerRef = useRef<HTMLDivElement>(null) // The scrolling container
    const listRef = useRef<HTMLDivElement>(null)

    // 칸마다 다른 textarea id
    const reactId = useId()
    const textareaId = `prompt-editor-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`

    // onChange 디바운스를 위한 타이머 ref + 아직 보내지 않은 값
    const onChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingValueRef = useRef<string | null>(null)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // Fragment Store 구독 (조각 프롬프트 목록)
    const fragmentFiles = useFragmentStore(state => state.files)
    // NAI 문법 변환이 켜져 있으면 글자 괄호는 보낼 때 변환기가 \( \) 로 바꾼다
    const naiSyntax = useSettingsStore(state => state.naiSyntax)

    // --- State ---
    // 내부 state로 즉시 렌더링 (uncontrolled 방식)
    const [internalValue, setInternalValue] = useState(value)
    const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isVisible, setIsVisible] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const [suggestionMode, setSuggestionMode] = useState<'tag' | 'wildcard'>('tag')

    // 외부 value가 변경되면 내부 state 동기화 (예: 프리셋 로드)
    // 단, 내부값과 동일하면 동기화 스킵 (커서 점프 방지)
    useEffect(() => {
        if (value !== internalValue) {
            setInternalValue(value)
        }
    }, [value]) // internalValue는 의도적으로 dependency에서 제외

    // --- onChange 디바운스 ---
    const flushChange = useCallback(() => {
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current)
            onChangeTimerRef.current = null
        }
        const pending = pendingValueRef.current
        if (pending !== null) {
            pendingValueRef.current = null
            onChangeRef.current({ target: { value: pending } })
        }
    }, [])

    const scheduleChange = useCallback((next: string, delay: number) => {
        pendingValueRef.current = next
        if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
        onChangeTimerRef.current = setTimeout(flushChange, delay)
    }, [flushChange])

    // --- Helpers ---
    const getCurrentWord = (text: string, position: number) => {
        const left = text.slice(0, position)
        // 쉼표·줄바꿈·::(NAI 가중치)·괄호·| 까지 거슬러 올라간다
        const match = left.match(CURRENT_WORD_RE)
        return match ? match[0].trimStart() : ''
    }

    // `<` 이후의 와일드카드 이름 추출
    const getWildcardWord = (text: string, position: number): string | null => {
        const left = text.slice(0, position)
        // `<` 이후의 텍스트 찾기 (아직 닫히지 않은 경우)
        const match = left.match(/<([^<>]*)$/)
        return match ? match[1] : null
    }

    // --- Autocomplete Logic ---
    const checkAutocomplete = useCallback((val: string, el: HTMLTextAreaElement) => {

        const pos = el.selectionEnd || val.length

        // 1. 조각 모드 체크 (`<` 이후)
        const wildcardWord = getWildcardWord(val, pos)
        if (wildcardWord !== null) {
            // 조각 프롬프트 자동완성 (즉시, 디바운스 없음)
            const lower = wildcardWord.toLowerCase()
            const matches: SuggestionItem[] = []

            for (const file of fragmentFiles) {
                if (matches.length >= maxSuggestions) break
                const fullPath = file.folder ? `${file.folder}/${file.name}` : file.name
                const fullPathLower = fullPath.toLowerCase()

                // 빈 문자열이면 모든 파일 표시, 아니면 필터링
                if (wildcardWord === '' || fullPathLower.includes(lower)) {
                    matches.push({
                        label: fullPath,
                        value: fullPath,
                        count: file.lineCount,
                        type: 'fragment'
                    })
                }
            }

            if (matches.length > 0) {
                setSuggestions(matches)
                setSuggestionMode('wildcard')
                setSelectedIndex(0)

                const rect = el.getBoundingClientRect()
                const caret = getCaretCoordinates(el, pos)

                setCoords({
                    top: rect.top + window.scrollY + caret.top + 24,
                    left: rect.left + window.scrollX + caret.left
                })
                setIsVisible(true)
            } else {
                setIsVisible(false)
            }
            return
        }

        // 2. 일반 태그 자동완성
        const word = getCurrentWord(val, pos)
        if (word.length < 2) {
            setIsVisible(false)
            return
        }

        // 태그 사전이 아직 없으면 불러온 뒤 다시 확인한다
        const dict = tagDictionary
        if (!dict) {
            loadTagDictionary()
                .then(() => {
                    const current = textareaRef.current
                    if (current && current === el && document.activeElement === el) {
                        checkAutocompleteRef.current(current.value, current)
                    }
                })
                .catch((err) => console.warn('[Autocomplete] 태그 사전을 불러오지 못했습니다:', err))
            setIsVisible(false)
            return
        }

        // 즉시 검색 (디바운스 없음 - 빠른 반응성)
        const lower = word.toLowerCase()
        const firstChar = lower[0] || ''

        // 인덱스 기반 검색 (해당 첫 글자 태그만 검색)
        const indexedTags = dict.byFirstChar[firstChar] || []
        const matches: SuggestionItem[] = []

        // 1단계: 인덱스된 태그에서 startsWith 매칭
        for (const tag of indexedTags) {
            if (matches.length >= maxSuggestions) break
            if (tag._lower.startsWith(lower)) {
                matches.push(tag)
            }
        }

        // 2단계: 부족하면 전체에서 includes 검색 (느리지만 fallback)
        if (matches.length < maxSuggestions) {
            for (const tag of dict.all) {
                if (matches.length >= maxSuggestions) break
                if (!tag._lower.startsWith(lower) && tag._lower.includes(lower)) {
                    matches.push(tag)
                }
            }
        }

        if (matches.length > 0) {
            setSuggestions(matches)
            setSuggestionMode('tag')
            setSelectedIndex(0)

            const rect = el.getBoundingClientRect()
            const caret = getCaretCoordinates(el, pos)

            setCoords({
                top: rect.top + window.scrollY + caret.top + 24,
                left: rect.left + window.scrollX + caret.left
            })
            setIsVisible(true)
        } else {
            setIsVisible(false)
        }
    }, [maxSuggestions, fragmentFiles])

    // 사전을 다 불러온 뒤 최신 함수로 다시 확인하려고 둔다
    const checkAutocompleteRef = useRef(checkAutocomplete)
    checkAutocompleteRef.current = checkAutocomplete

    const insertSuggestion = (suggestion: SuggestionItem) => {
        if (!textareaRef.current) return
        const el = textareaRef.current
        const val = internalValue  // Use internal value for immediate update
        const pos = el.selectionEnd || 0

        if (suggestionMode === 'wildcard') {
            // 와일드카드 삽입: <name> 형태로
            const wildcardWord = getWildcardWord(val, pos)
            if (wildcardWord === null) return

            // `<` 위치 찾기
            const left = val.slice(0, pos)
            const bracketPos = left.lastIndexOf('<')
            if (bracketPos === -1) return

            const before = val.slice(0, bracketPos)
            const after = val.slice(pos)

            // <name> 형태로 삽입 (닫는 괄호 포함)
            const newValue = before + '<' + suggestion.value + '>' + after
            const newCursorPos = bracketPos + suggestion.value.length + 2 // <name>

            // Update internal state immediately (no flicker)
            setInternalValue(newValue)
            setIsVisible(false)

            // Set cursor position immediately
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                }
            })

            // Debounce external onChange to avoid re-render resetting cursor
            scheduleChange(newValue, 50)
        } else {
            // 일반 태그 삽입 (:: 문법 지원)
            const left = val.slice(0, pos)
            const wordMatch = left.match(CURRENT_WORD_RE)
            if (!wordMatch) return

            const wordStart = wordMatch.index!
            const before = val.slice(0, wordStart)
            const after = val.slice(pos)

            // Add space only if not at start and not after special chars
            const lastChar = before.slice(-1)
            const needsSpace = before.length > 0 && !NO_SPACE_AFTER.includes(lastChar)
            const prefix = needsSpace ? ' ' : ''

            // Always use ", " as suffix (user will close :: manually if needed)
            const suffix = ', '

            // NAI 문법 변환을 끈 경우에만 글자 괄호를 \( \) 로 바꿔 넣는다
            // (켜져 있으면 보낼 때 변환기가 바꾸므로 그대로 둔다. 두 번 바꾸면 \\( 가 된다)
            const inserted = naiSyntax ? suggestion.value : escapeParens(suggestion.value)

            // Keep after as-is to preserve newlines and formatting
            const newValue = before + prefix + inserted + suffix + after

            // Calculate new cursor position
            const newCursorPos = wordStart + prefix.length + inserted.length + suffix.length

            // Update internal state immediately (no flicker)
            setInternalValue(newValue)
            setIsVisible(false)

            // Set cursor position immediately
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                    scrollToCaret()
                }
            })

            // Debounce external onChange to avoid re-render resetting cursor
            scheduleChange(newValue, 50)
        }
    }

    // --- Scroll Sync Logic ---
    // Manually scrolls the container to keep the caret in view during typing/navigation
    const scrollToCaret = () => {
        if (!textareaRef.current || !containerRef.current) return
        const el = textareaRef.current
        const container = containerRef.current

        requestAnimationFrame(() => {
            const { top, height } = getCaretCoordinates(el, el.selectionEnd)
            // Padding offset (must match Editor padding prop)
            const PADDING_OFFSET = 12
            const caretTop = top + PADDING_OFFSET
            const caretBottom = caretTop + height + 4 // Small buffer

            const containerTop = container.scrollTop
            const containerBottom = containerTop + container.clientHeight

            // Scroll if out of bounds
            if (caretBottom > containerBottom) {
                container.scrollTop = caretBottom - container.clientHeight
            } else if (caretTop < containerTop) {
                container.scrollTop = caretTop
            }
        })
    }

    // --- Event Handlers ---
    const handleValueChange = (code: string) => {
        // 내부 state 즉시 업데이트 (UI 반응성)
        setInternalValue(code)

        // onChange를 100ms 디바운스 (Zustand 업데이트 지연으로 렉 방지)
        scheduleChange(code, 100)

        if (textareaRef.current) {
            checkAutocomplete(code, textareaRef.current)
            scrollToCaret()
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
        // Ensure ref is captured
        if (e.target instanceof HTMLTextAreaElement) {
            textareaRef.current = e.target
        }

        if (isVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex(prev => (prev + 1) % suggestions.length)
                return
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
                return
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation() // Prevent default newline
                if (suggestions[selectedIndex]) {
                    insertSuggestion(suggestions[selectedIndex])
                }
                return
            } else if (e.key === 'Escape') {
                setIsVisible(false)
                return
            }
        }
    }

    // --- Effects ---
    // 언마운트 시 아직 보내지 않은 입력을 마저 보낸다 (칸을 접거나 창을 닫아도 마지막 글자가 사라지지 않게)
    useEffect(() => {
        return () => flushChange()
    }, [flushChange])

    // Scroll active suggestion into view
    useEffect(() => {
        if (!isVisible || !listRef.current) return
        const list = listRef.current
        const item = list.children[0]?.children[selectedIndex] as HTMLElement
        if (item) {
            const itemTop = item.offsetTop
            const itemBottom = itemTop + item.offsetHeight
            const listTop = list.scrollTop
            const listBottom = listTop + list.clientHeight
            if (itemTop < listTop) list.scrollTop = itemTop
            else if (itemBottom > listBottom) list.scrollTop = itemBottom - list.clientHeight
        }
    }, [selectedIndex, isVisible])

    // Close on outside events
    useEffect(() => {
        const handleWindowEvents = (e: Event) => {
            if (isVisible && listRef.current && !listRef.current.contains(e.target as Node)) {
                setIsVisible(false)
            }
        }
        if (isVisible) {
            window.addEventListener('scroll', handleWindowEvents, true)
            window.addEventListener('resize', handleWindowEvents)
            window.addEventListener('click', handleWindowEvents)
        }
        return () => {
            window.removeEventListener('scroll', handleWindowEvents, true)
            window.removeEventListener('resize', handleWindowEvents)
            window.removeEventListener('click', handleWindowEvents)
        }
    }, [isVisible])

    // --- Highlighting ---
    const renderHighlights = (text: string) => {
        if (!text) return null

        // 먼저 줄 단위로 분리하여 주석 처리
        const lines = text.split('\n')

        return (
            <Fragment>
                {lines.map((line, lineIndex) => {
                    const isComment = line.trimStart().startsWith('#')
                    const isLastLine = lineIndex === lines.length - 1

                    // 주석 줄인 경우 전체를 회색 배경으로
                    if (isComment) {
                        return (
                            <Fragment key={lineIndex}>
                                <span className="bg-muted-foreground/20 text-muted-foreground rounded-[2px]">{line}</span>
                                {!isLastLine && '\n'}
                            </Fragment>
                        )
                    }

                    // 일반 줄: 기존 구문 하이라이팅 적용
                    // 1. NAI 가중치: 1.2::tag:: OR -0.5::tag::
                    // 2. ComfyUI 가중치: (tag:1.2) — 1보다 작으면 파란색
                    // 3. 조각: <fragment>
                    const parts = line.split(HIGHLIGHT_RE)

                    return (
                        <Fragment key={lineIndex}>
                            {parts.map((part, i) => {
                                if (part === undefined || part === '') return null
                                let styleClass = ""
                                const comfyWeight = COMFY_WEIGHT_RE.exec(part)
                                if (NAI_WEIGHT_RE.test(part)) {
                                    styleClass = part.startsWith('-')
                                        ? "bg-sky-500/30 rounded-[2px]"
                                        : "bg-pink-500/30 rounded-[2px]"
                                } else if (comfyWeight) {
                                    styleClass = parseFloat(comfyWeight[1]) < 1
                                        ? "bg-sky-500/30 rounded-[2px]"
                                        : "bg-pink-500/30 rounded-[2px]"
                                } else if (/^<[^>]+>$/.test(part)) {
                                    styleClass = "bg-green-500/30 rounded-[2px]"
                                }
                                return <span key={i} className={styleClass}>{part}</span>
                            })}
                            {!isLastLine && '\n'}
                        </Fragment>
                    )
                })}
            </Fragment>
        )
    }

    // --- Styles ---
    // Force sync styles for both Pre (generated by Editor) and Textarea


    return (
        <div
            className={cn(
                "prompt-editor-wrapper relative w-full h-full flex flex-col border rounded-md border-input bg-transparent overflow-hidden group focus-within:ring-1 focus-within:ring-ring",
                className
            )}
        >
            <style>{`
                .prompt-editor-wrapper pre,
                .prompt-editor-wrapper textarea {
                    font-family: "Inter", "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                    line-height: 1.5 !important;
                    font-size: inherit !important;
                    letter-spacing: normal !important;
                    font-variant-ligatures: none !important;
                    tab-size: 4 !important;
                    white-space: pre-wrap !important;
                    overflow-wrap: break-word !important;
                    word-break: normal !important;
                    box-sizing: border-box !important;
                }
                .prompt-editor-wrapper textarea {
                    overflow: hidden !important;
                    height: 100% !important; /* Prevent internal scroll by matching container height */
                }
            `}</style>

            {/* Scrollable Container */}
            <div
                ref={containerRef}
                className="flex-1 w-full relative overflow-y-auto"
                style={{ scrollBehavior: 'smooth' }} // Optional smooth scroll
            >
                <Editor
                    value={internalValue}
                    onValueChange={handleValueChange}
                    highlight={renderHighlights}
                    padding={12}
                    textareaId={textareaId}

                    // Core Editor Style
                    style={{
                        ...TYPOGRAPHY,
                        fontSize: style?.fontSize || 'inherit',
                        minHeight: '100%',
                        height: 'auto',
                        overflow: 'visible',
                    }}

                    // Wrapper Class
                    className="min-h-full w-full"

                    // Textarea Class
                    // Styles are now handled by global CSS injection above
                    textareaClassName="focus:outline-none bg-transparent min-h-full resize-none"

                    // Event wiring
                    onFocus={(e) => {
                        textareaRef.current = e.target as HTMLTextAreaElement
                        // 태그 사전은 처음 누를 때 미리 불러 둔다
                        void loadTagDictionary().catch(() => { })
                    }}
                    onBlur={flushChange}
                    onClick={(e) => {
                        textareaRef.current = e.target as HTMLTextAreaElement
                        scrollToCaret()
                    }}
                    onKeyUp={scrollToCaret} // Handle arrow keys
                    onKeyDown={handleKeyDown}

                    placeholder={placeholder}
                    readOnly={props.readOnly}
                    disabled={props.disabled}
                    {...props}
                />
            </div>

            {/* Autocomplete Dropdown */}
            {isVisible && suggestions.length > 0 && createPortal(
                <div
                    ref={listRef}
                    className="fixed z-[9999] w-64 bg-popover/95 backdrop-blur-md text-popover-foreground rounded-lg border border-border shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                    style={{
                        top: coords.top,
                        left: coords.left,
                        maxHeight: '300px',
                        overflowY: 'auto'
                    }}
                >
                    <div className="p-1">
                        {suggestions.map((item, index) => (
                            <div
                                key={item.value + index}
                                className={cn(
                                    "flex items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer select-none transition-colors",
                                    index === selectedIndex ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                                )}
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    insertSuggestion(item)
                                }}
                            >
                                <div className="flex flex-col overflow-hidden">
                                    <span className="truncate font-semibold">
                                        {item.type === 'fragment' ? `<${item.label}>` : item.label}
                                    </span>
                                    <div className="flex items-center gap-2 text-[10px] opacity-80">
                                        <span className={cn(
                                            "uppercase tracking-wider font-bold",
                                            item.type === 'fragment' ? "text-green-300" :
                                                item.type === 'artist' ? "text-yellow-300" :
                                                    item.type === 'character' ? "text-green-300" :
                                                        item.type === 'copyright' ? "text-fuchsia-300" :
                                                            "text-blue-300"
                                        )}>
                                            {item.type}
                                        </span>
                                        <span>
                                            {item.type === 'fragment'
                                                ? `${item.count} lines`
                                                : (item.count ?? 0) >= 1000 ? ((item.count ?? 0) / 1000).toFixed(1) + 'k' : item.count}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
