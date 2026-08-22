'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { totalJoueur } from '@/lib/duoJeux'
import type { DuoPartie, DuoTour } from '@/types'

/**
 * Saisie d'un tour. À monter SEULEMENT quand elle est ouverte (`{ouvert && …}`) :
 * l'état part des scores du tour concerné, un composant monté en permanence
 * garderait ceux du tour précédent.
 *
 * Chaque joueur voit son total avant et après le tour saisi — c'est ce qui évite
 * d'additionner de tête entre deux manches.
 */
export default function TourModal({ partie, index, onClose, onEnregistrer }: {
  partie: DuoPartie
  /** `null` = nouveau tour, sinon le tour corrigé. */
  index: number | null
  onClose: () => void
  onEnregistrer: (tour: DuoTour) => Promise<void> | void
}) {
  const joueurs = partie.joueurs ?? []
  const tour = index !== null ? partie.tours?.[index] : undefined

  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(joueurs.map((j) => [
      j, tour ? String(tour.scores?.find((s) => s.joueur === j)?.points ?? '') : '',
    ])))
  const [nom, setNom] = useState(tour?.nom ?? '')
  const [busy, setBusy] = useState(false)

  /** Total du joueur hors tour en cours d'édition. */
  const totalAvant = (j: string) => {
    const total = totalJoueur(partie, j)
    if (index === null) return total
    return total - (tour?.scores?.find((s) => s.joueur === j)?.points ?? 0)
  }

  const enregistrer = async () => {
    setBusy(true)
    try {
      await onEnregistrer({
        ...(nom.trim() ? { nom: nom.trim() } : {}),
        scores: joueurs.map((j) => ({ joueur: j, points: Math.round(Number(scores[j] ?? 0)) || 0 })),
      })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title={index === null
      ? `Tour ${(partie.tours?.length ?? 0) + 1} — ${partie.jeu}`
      : `Corriger le tour ${index + 1} — ${partie.jeu}`}>
      <div className="space-y-4">
        <div className="space-y-2">
          {joueurs.map((j) => {
            const avant = totalAvant(j)
            const saisi = Math.round(Number(scores[j] ?? 0)) || 0
            return (
              <div key={j} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 break-words">{j}</p>
                  <p className="text-[11px] text-gray-400 tabular-nums">
                    {avant} → <span className="text-gray-700 font-medium">{avant + saisi}</span>
                  </p>
                </div>
                <input type="number" inputMode="numeric" value={scores[j] ?? ''} placeholder="0"
                  onChange={(e) => setScores((s) => ({ ...s, [j]: e.target.value }))}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-base text-right focus:outline-none focus:ring-2 focus:ring-rose-500" />
              </div>
            )
          })}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom du tour <span className="text-gray-400 font-normal">(facultatif)</span>
          </label>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Manche 3, Reprise…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-60 transition">
            Annuler
          </button>
          <button onClick={enregistrer} disabled={busy}
            className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            {busy ? 'Enregistrement…' : index === null ? 'Ajouter le tour' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
