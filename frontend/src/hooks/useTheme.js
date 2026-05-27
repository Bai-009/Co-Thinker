import { useCallback, useEffect, useState } from 'react'

import { applySense } from '../lib/sense'

// Theme = 'light' | 'dark'.
// Order of resolution at first paint:
//   1. localStorage (user has explicitly chosen before)
//   2. prefers-color-scheme (system pref)
//   3. fallback 'light'
//
// Once the user clicks the toggle, their choice wins until cleared.
// The DOM dataset is the source of truth for CSS — every state change
// writes both the dataset and re-runs applySense so sense corners get
// re-interpolated for the new theme without waiting for the next turn.

const STORAGE_KEY = 'cothinker-theme'

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function readSystem() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getInitial() {
  return readStored() ?? readSystem()
}

export default function useTheme() {
  const [theme, setTheme] = useState(getInitial)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // localStorage may be unavailable (e.g. private mode); not fatal.
    }
    // Re-run sense interpolation so the 4 corners switch to the right
    // theme's set. Default values 0.5/0.5 are fine — actual values get
    // overwritten on next foundation poll.
    applySense(0.5, 0.5)
  }, [theme])

  // Track system preference changes — but only when the user has NOT
  // explicitly chosen. Clearing localStorage re-enables system sync.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      if (readStored() == null) {
        setTheme(e.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle, setTheme }
}
