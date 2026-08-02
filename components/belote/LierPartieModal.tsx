'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { lierPartieASerie, delierPartie } from '@/lib/belote/firebase'
import { nouvelleSerieId, nomSerieParDefaut } from '@/lib/belote/serie'
import type { BeloteGame } from '@/lib/belote/types'
import { Link2, Unlink } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  game: BeloteGame
  /** Toutes mes parties, pour choisir celle à lier. */
  toutes: BeloteGame[]
  onDone?: () => void
}

/**
 * Lier des parties entre elles (revanche, belle…).
 *
 * Une série = un `serieId` partagé. Lier à une partie DÉJÀ en série rejoint cette
 * série plutôt que d'en créer une deuxième — sinon une belle en trois manches se
 * couperait en deux séries de deux.
 */
export function LierPartieModal({ isOpen, onClose, game, toutes, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recherche, setRecherche] = useState('')

  const candidates = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return toutes
      .filter((g) => g.id !== game.id)
      .filter((g) => !game.serieId || g.serieId !== game.serieId)
      .filter((g) => !q || `${g.team1Name} ${g.team2Name} ${g.serieName ?? ''}`.toLowerCase().includes(q))
      .slice(0, 12)
  }, [toutes, game.id, game.serieId, recherche])

  const lier = async (autre: BeloteGame) => {
    setBusy(true); setError('')
    try {
      // La série existante l'emporte : celle de l'autre partie, sinon la mienne, sinon une nouvelle.
      const serieId = autre.serieId ?? game.serieId ?? nouvelleSerieId()
      const serieName = autre.serieName ?? game.serieName ?? nomSerieParDefaut(game)
      await lierPartieASerie(game.id, serieId, serieName)
      if (autre.serieId !== serieId) await lierPartieASerie(autre.id, serieId, serieName)
      onDone?.()
      onClose()
    } catch {
      setError('Impossible de lier ces parties.')
    } finally { setBusy(false) }
  }

  const delier = async () => {
    setBusy(true); setError('')
    try { await delierPartie(game.id); onDone?.(); onClose() }
    catch { setError('Impossible de détacher cette partie.') }
    finally { setBusy(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Lier à une autre partie">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Les parties liées forment une série : leurs points se cumulent et l&apos;écart entre les
          équipes se calcule sur l&apos;ensemble.
        </p>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>}

        {game.serieId && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
            <p className="text-sm text-blue-900 min-w-0 truncate">
              Déjà dans la série <span className="font-medium">{game.serieName || 'sans nom'}</span>
            </p>
            <button onClick={delier} disabled={busy}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-500 transition">
              <Unlink size={13} />Détacher
            </button>
          </div>
        )}

        <div className="space-y-2">
          <input type="text" placeholder="Filtrer par équipe ou série…"
            value={recherche} onChange={(e) => setRecherche(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />

          {candidates.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 italic">Aucune autre partie à lier.</p>
          ) : (
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-hidden max-h-72 overflow-y-auto">
              {candidates.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {g.team1Name} <span className="text-gray-300">vs</span> {g.team2Name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {g.totalScore?.team1 ?? 0} · {g.totalScore?.team2 ?? 0}
                      {g.serieName ? ` — série « ${g.serieName} »` : ''}
                    </p>
                  </div>
                  <button onClick={() => lier(g)} disabled={busy}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition">
                    <Link2 size={13} />Lier
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
