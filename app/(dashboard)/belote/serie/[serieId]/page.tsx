'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useBeloteGames } from '@/hooks/useBeloteGames'
import { useBeloteStats } from '@/hooks/useBeloteStats'
import StatsJoueurs from '@/components/belote/StatsJoueurs'
import { cumulSerie, ecartPartie, ecartSerie, partiesDeSerie } from '@/lib/belote/serie'
import { lierPartieASerie } from '@/lib/belote/firebase'
import { ArrowLeftIcon, ChevronRightIcon, PencilIcon } from '@heroicons/react/24/outline'

/**
 * Une série de parties liées : cumul des points par équipe, écart entre les deux
 * premières, et détail partie par partie.
 *
 * Le cumul se fait PAR ÉQUIPE, pas par côté : sur une revanche, l'équipe qui était
 * « Nous » peut devenir « Eux », ses points doivent la suivre.
 */
export default function SeriePage() {
  const { serieId } = useParams<{ serieId: string }>()
  const router = useRouter()
  const { games, loading } = useBeloteGames()

  const parties = useMemo(() => partiesDeSerie(games, serieId), [games, serieId])
  const lignes = useMemo(() => cumulSerie(parties), [parties])
  const ecart = useMemo(() => ecartSerie(lignes), [lignes])
  const nom = parties.find((g) => g.serieName)?.serieName ?? 'Série'

  const { parties: partiesAvecTours } = useBeloteStats(parties)

  const [renommage, setRenommage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const renommer = async () => {
    const nouveau = (renommage ?? '').trim()
    if (!nouveau) { setRenommage(null); return }
    setBusy(true)
    try {
      await Promise.all(parties.map((g) => lierPartieASerie(g.id, serieId, nouveau)))
      setRenommage(null)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => router.push('/belote')} aria-label="Retour"
          className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-bold text-gray-800 break-words">{nom}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {parties.length} partie{parties.length > 1 ? 's' : ''} liée{parties.length > 1 ? 's' : ''}
          </p>
        </div>
        {parties.length > 0 && (
          <button onClick={() => setRenommage(nom)} aria-label="Renommer la série"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition shrink-0">
            <PencilIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {renommage !== null && (
        <div className="flex gap-2">
          <input type="text" autoFocus value={renommage} onChange={(e) => setRenommage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') renommer(); if (e.key === 'Escape') setRenommage(null) }}
            placeholder="Nom de la série"
            className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
          <button onClick={renommer} disabled={busy}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
            Enregistrer
          </button>
          <button onClick={() => setRenommage(null)}
            className="shrink-0 border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-xl hover:bg-gray-50 transition">
            Annuler
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : parties.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">Cette série ne contient aucune partie.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Écart + cumul */}
          <div className="space-y-4">
            {ecart && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Écart de points sur la série
                </p>
                <p className="text-4xl font-bold text-blue-600 tabular-nums">
                  {ecart.ecart === 0 ? '—' : `+${ecart.ecart}`}
                </p>
                <p className="text-sm text-gray-600 mt-1.5">
                  {ecart.ecart === 0
                    ? `${ecart.enTete.name} et ${ecart.second.name} sont à égalité`
                    : <>en faveur de <span className="font-semibold text-gray-800">{ecart.enTete.name}</span></>}
                </p>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">
                Cumul par équipe
              </p>
              {lignes.map((l, i) => (
                <div key={l.teamId} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-50 text-gray-400'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 break-words">{l.name}</p>
                    <p className="text-xs text-gray-400">
                      {l.parties} partie{l.parties > 1 ? 's' : ''} · {l.victoires} victoire{l.victoires > 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-blue-600 tabular-nums shrink-0">{l.points}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Détail partie par partie */}
          <div className="space-y-5">
            <StatsJoueurs parties={partiesAvecTours} titre="Statistiques de la série" />
            <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Parties, dans l&apos;ordre</h2>
            <div className="space-y-2">
              {parties.map((g, i) => {
                const diff = ecartPartie(g)
                const gagnant = diff > 0 ? g.team1Name : diff < 0 ? g.team2Name : null
                return (
                  <button key={g.id} onClick={() => router.push(`/belote/${g.id}`)}
                    className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-400 mb-0.5">Partie {i + 1}</p>
                      <p className="text-sm font-semibold text-gray-800 break-words">
                        {g.team1Name} <span className="text-gray-300">vs</span> {g.team2Name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {g.totalScore?.team1 ?? 0} · {g.totalScore?.team2 ?? 0}
                        {g.status === 'in_progress'
                          ? ' — en cours'
                          : gagnant ? ` — ${gagnant} de ${Math.abs(diff)} pts` : ' — égalité'}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0" />
                  </button>
                )
              })}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
