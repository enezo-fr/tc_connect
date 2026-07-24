'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownTrayIcon, XMarkIcon, ShareIcon } from '@heroicons/react/24/outline'
import { useBrand } from '@/context/BrandContext'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed'
/** « Plus tard » veut dire plus tard, pas jamais : on se tait un mois. */
const SILENCE_JOURS = 30

/**
 * Le bandeau est-il masqué ? La valeur stockée est l'horodatage du refus.
 * Les anciennes installations ont un `'1'` sans date : on le convertit au vol,
 * sinon le bandeau resterait masqué pour toujours.
 */
function estMasque(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY)
    if (!v) return false
    if (v === '1') { localStorage.setItem(DISMISS_KEY, String(Date.now())); return true }
    const t = Number(v)
    if (!Number.isFinite(t)) return false
    return Date.now() - t < SILENCE_JOURS * 86_400_000
  } catch {
    return false
  }
}

export default function PwaInstallPrompt() {
  const { brand } = useBrand()
  const nomApp = brand === 'enezo' ? 'Enezo' : 'TC Connect'
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)
  // Refus de la session en cours : `beforeinstallprompt` est ré-émis par Chrome
  // à chaque navigation, et l'état React seul ne survit pas à un remontage.
  const refuse = useRef(false)

  const dismiss = useCallback(() => {
    refuse.current = true
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Déjà installée (mode standalone) → rien à proposer
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as any).standalone === true
    if (standalone) return
    if (estMasque()) return

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIos(ios)

    const onBip = (e: Event) => {
      e.preventDefault()
      // ⚠️ LE BUG D'ORIGINE ÉTAIT ICI : l'événement rouvrait le bandeau sans
      // vérifier le refus, donc « Plus tard » ne tenait pas d'une page à l'autre.
      if (refuse.current || estMasque()) return
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    // iOS Safari n'émet pas beforeinstallprompt → on affiche un bandeau d'aide
    if (ios) setVisible(true)

    const onInstalled = () => dismiss()
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismiss])

  const install = async () => {
    if (deferred) {
      await deferred.prompt()
      try { await deferred.userChoice } catch {}
      setDeferred(null)
      dismiss()
    } else if (isIos) {
      setShowIosHelp((v) => !v)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-24 lg:bottom-4 z-[55] px-3 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-white border border-gray-200 shadow-lg rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <ArrowDownTrayIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Installer {nomApp}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Ajoutez l&apos;app à votre écran d&apos;accueil pour une vraie expérience d&apos;application et recevoir les notifications.
            </p>
          </div>
          <button onClick={dismiss} className="p-1 text-gray-300 hover:text-gray-500 transition shrink-0" title="Plus tard">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {showIosHelp && isIos && (
          <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-gray-700 space-y-1.5">
            <p className="flex items-center gap-1.5">
              1. Appuyez sur <ShareIcon className="w-4 h-4 text-blue-600 inline" /> <strong>Partager</strong> (en bas de Safari)
            </p>
            <p>2. Faites défiler et choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong></p>
            <p>3. Validez avec <strong>Ajouter</strong> — l&apos;app apparaît sur votre écran d&apos;accueil.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={install}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {isIos ? (showIosHelp ? 'Masquer les étapes' : "Comment installer ?") : "Installer l'app"}
          </button>
          <button onClick={dismiss} className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2 transition">
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
