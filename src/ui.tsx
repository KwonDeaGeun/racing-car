import { useEffect, useState, type PropsWithChildren } from 'react'

export function usePageVisible() {
    const [visible, setVisible] = useState(() => {
        if (typeof document === 'undefined') {
            return true
        }

        return document.visibilityState !== 'hidden'
    })

    useEffect(() => {
        const updateVisibility = () => {
            setVisible(document.visibilityState !== 'hidden')
        }

        updateVisibility()

        document.addEventListener('visibilitychange', updateVisibility)

        return () => {
            document.removeEventListener('visibilitychange', updateVisibility)
        }
    }, [])

    return visible
}

export function Instructions({ children }: PropsWithChildren) {
    return (
        <div
            style={{
                position: 'fixed',
                left: '50%',
                bottom: '1.5rem',
                transform: 'translateX(-50%)',
                padding: '0.75rem 1rem',
                borderRadius: '999px',
                background: 'rgba(17, 17, 17, 0.82)',
                color: '#fff',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '0.875rem',
                letterSpacing: '0.02em',
                lineHeight: 1,
                pointerEvents: 'none',
                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.24)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                zIndex: 10,
            }}
        >
            {children}
        </div>
    )
}
