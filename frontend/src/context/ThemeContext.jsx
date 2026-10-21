import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

const THEMES = ['auto', 'light', 'dark']
const STORAGE_KEY = 'asklio.theme'

function initialTheme() {
  try {
    if (THEMES.includes(localStorage.getItem(STORAGE_KEY))) return localStorage.getItem(STORAGE_KEY)
  } catch {
    /* fall through to auto */
  }
  return 'auto'
}

function applyTheme(theme) {
  if (theme === 'auto') {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = theme
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* per-viewer convenience only */
    }
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      cycle() {
        setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])
      },
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}