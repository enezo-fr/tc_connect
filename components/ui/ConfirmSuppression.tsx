'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Trash2, AlertTriangle } from 'lucide-react'

/**
 * Ce qu'on s'apprête à supprimer. `null` = la modale est fermée.
 *
 * Le patron est toujours le même dans l'app : un bouton poubelle pose une
 * `cible`, la modale la confirme. Aucune suppression ne part sur un simple clic.
 */
export interface CibleSuppression {
  /** Ce qu'on supprime, en toutes lettres : « la partie Uno du 12 août ». */
  quoi: string
  /** Conséquence à annoncer (ce qui part avec, ce qui est irréversible). */
  detail?: string
  libelleBouton?: string
  go: () => void | Promise<void>
}

/** Bouton poubelle standard — jamais une croix : une croix ferme, elle ne supprime pas. */
export function BoutonPoubelle({ onClick, label, taille = 16, className = '' }: {
  onClick: () => void
  label: string
  taille?: number
  className?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition shrink-0 ${className}`}>
      <Trash2 size={taille} />
    </button>
  )
}

export default function ConfirmSuppression({ cible, onClose }: {
  cible: CibleSuppression | null
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  const confirmer = async () => {
    if (!cible) return
    setBusy(true)
    try {
      await cible.go()
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal isOpen={!!cible} onClose={busy ? () => {} : onClose} title="Confirmer la suppression" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-red-50 text-red-500 flex items-center justify-center shrink-0">
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-gray-800">
              Supprimer <strong className="break-words">{cible?.quoi}</strong> ?
            </p>
            {cible?.detail && <p className="text-xs text-gray-500 mt-1">{cible.detail}</p>}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-60 transition">
            Annuler
          </button>
          <button onClick={confirmer} disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            <Trash2 size={15} />{busy ? 'Suppression…' : (cible?.libelleBouton ?? 'Supprimer')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
