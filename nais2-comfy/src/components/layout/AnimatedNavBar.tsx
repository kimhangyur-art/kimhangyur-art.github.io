import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'

export interface NavItem {
    path: string
    icon: LucideIcon
    labelKey: string
    /** 번역 파일에 없는 새 메뉴의 기본 이름 */
    defaultLabel?: string
}

interface AnimatedNavBarProps {
    items: NavItem[]
    /** 아이콘만 보이기. 주지 않으면 창 너비로 정한다 */
    compact?: boolean
}

/** '/scenes' 는 '/scenes/abc' 에서도 켜진다 ('/' 는 정확히 '/' 일 때만) */
export function isNavActive(itemPath: string, pathname: string): boolean {
    if (itemPath === '/') return pathname === '/'
    return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function AnimatedNavBar({ items, compact }: AnimatedNavBarProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const [narrowWindow, setNarrowWindow] = useState(window.innerWidth < 1382)

    useEffect(() => {
        if (compact !== undefined) return
        const handleResize = () => {
            setNarrowWindow(window.innerWidth < 1382)
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [compact])

    const isCompact = compact ?? narrowWindow

    return (
        <nav className="flex items-center gap-1 p-1">
            {items.map((item) => {
                const isActive = isNavActive(item.path, location.pathname)
                const label = t(item.labelKey, item.defaultLabel ?? item.labelKey)
                return (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        title={isCompact ? label : undefined}
                        aria-label={label}
                        className={cn(
                            "relative rounded-full text-sm font-medium transition-colors z-0 whitespace-nowrap",
                            isCompact ? "p-2" : "px-4 py-2",
                            isActive
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground/80"
                        )}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute inset-0 bg-foreground/10 backdrop-blur-md rounded-full border border-foreground/10 shadow-sm -z-10"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                        <span className="flex items-center gap-2 relative z-10">
                            <item.icon className="h-4 w-4" />
                            {!isCompact && <span>{label}</span>}
                        </span>
                    </NavLink>
                )
            })}
        </nav>
    )
}
