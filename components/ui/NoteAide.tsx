'use client'

import { useState } from 'react'
import { Info, ChevronDown, Lightbulb } from 'lucide-react'

/**
 * Encart d'aide REPLIABLE : explique le fonctionnement d'un outil sans encombrer
 * l'écran une fois qu'on le connaît. Fermé par défaut — l'aide se demande, elle
 * ne s'impose pas à chaque ouverture de la page.
 */
export function NoteAide({
  titre = 'Comment ça marche ?',
  children,
  ouvert: ouvertParDefaut = false,
}: {
  titre?: string
  children: React.ReactNode
  ouvert?: boolean
}) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut)

  return (
    <div className="bg-sky-50/70 border border-sky-100 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Info size={15} className="text-sky-600 shrink-0" />
        <span className="flex-1 text-sm font-medium text-sky-900">{titre}</span>
        <ChevronDown size={16} className={`text-sky-500 shrink-0 transition-transform ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && (
        <div className="px-4 pb-4 pt-0 text-sm text-sky-900/80 space-y-2 [&_strong]:text-sky-900">
          {children}
        </div>
      )}
    </div>
  )
}

/** Une seule phrase d'explication, posée sous un titre de section. */
export function LigneAide({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-gray-500 leading-relaxed">
      <Lightbulb size={13} className="text-amber-400 shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  )
}
