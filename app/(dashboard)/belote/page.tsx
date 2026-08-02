'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import { useStoreAccess } from '@/hooks/useStoreAccess'
import { useBeloteGames } from '@/hooks/useBeloteGames'
import CardsLogo from '@/components/belote/CardsLogo'
import { cumulSerie, ecartSerie } from '@/lib/belote/serie'
import type { BeloteGame } from '@/lib/belote/types'
import { PlusIcon, ClockIcon, ChevronRightIcon, UsersIcon, LinkIcon } from '@heroicons/react/24/outline'

/** Séries visibles, de la plus récemment jouée à la plus ancienne. */
function seriesDe(games: BeloteGame[]) {
  const map = new Map<string, BeloteGame[]>()
  games.forEach((g) => {
    if (!g.serieId) return
    map.set(g.serieId, [...(map.get(g.serieId) ?? []), g])
  })
  return [...map.entries()]
    .filter(([, parties]) => parties.length > 1)
    .map(([serieId, parties]) => ({
      serieId,
      nom: parties.find((p) => p.serieName)?.serieName ?? 'Série',
      parties,
      ecart: ecartSerie(cumulSerie(parties)),
      dernier: Math.max(...parties.map((p) => p.createdAt?.seconds ?? 0)),
    }))
    .sort((a, b) => b.dernier - a.dernier)
}

export default function BelotePage() {
  const router = useRouter()
  const { inProgress, finished, games, partagees, aDesPartagees, loading } = useBeloteGames()
  const { hasAccess } = useStoreAccess('/belote')

  const partageeIds = useMemo(() => new Set(partagees.map((g) => g.id)), [partagees])
  const series = useMemo(() => seriesDe(games), [games])

  return (
    // Une partie partagée avec moi reste accessible même sans abonnement :
    // le partage est inclus dans celui de la personne qui invite.
    <StoreGate appRoute="/belote" bypass={aDesPartagees}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardsLogo className="w-11 h-11 shrink-0" />
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Belote</h1>
              <p className="text-sm text-gray-500 mt-0.5">Comptez vos points partie après partie</p>
            </div>
          </div>
          <button onClick={() => router.push('/belote/historique')}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition shrink-0">
            <ClockIcon className="w-4 h-4" /> Historique
          </button>
        </div>

        {/* Nouvelle partie — réservée aux comptes ayant l'app (le partage n'ouvre pas la création) */}
        {hasAccess ? (
          <button onClick={() => router.push('/belote/nouvelle-partie')}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition">
            <PlusIcon className="w-5 h-5" /> Nouvelle partie
          </button>
        ) : (
          <p className="text-xs text-gray-400 text-center bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            Vous suivez des parties partagées. Pour créer les vôtres, activez la Belote depuis la boutique.
          </p>
        )}

        {/* Séries (parties liées) */}
        {series.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Séries</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {series.map((s) => (
                <button key={s.serieId} onClick={() => router.push(`/belote/serie/${s.serieId}`)}
                  className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5 text-gray-300 shrink-0" />{s.nom}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.parties.length} parties
                      {s.ecart && s.ecart.ecart !== 0 && ` · ${s.ecart.enTete.name} +${s.ecart.ecart}`}
                      {s.ecart && s.ecart.ecart === 0 && ' · à égalité'}
                    </p>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Parties en cours */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Parties en cours</h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
            </div>
          ) : inProgress.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <p className="text-3xl mb-2">🎴</p>
              <p className="text-sm text-gray-400">Aucune partie en cours.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {inProgress.map(g => (
                <button key={g.id} onClick={() => router.push(`/belote/${g.id}`)}
                  className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {g.team1Name} <span className="text-gray-300">vs</span> {g.team2Name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {g.totalScore.team1} · {g.totalScore.team2}
                      {' — '}{g.endCondition === 'score' ? `objectif ${g.endValue}` : `${g.endValue} tours`}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {partageeIds.has(g.id) && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-1.5 py-0.5">
                          <UsersIcon className="w-3 h-3" />Partagée avec moi
                        </span>
                      )}
                      {g.shareToken && !partageeIds.has(g.id) && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-1.5 py-0.5">
                          <LinkIcon className="w-3 h-3" />Lien actif
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Aperçu terminées */}
        {finished.length > 0 && (
          <button onClick={() => router.push('/belote/historique')}
            className="w-full text-sm text-blue-600 hover:underline">
            Voir les {finished.length} partie{finished.length > 1 ? 's' : ''} terminée{finished.length > 1 ? 's' : ''} →
          </button>
        )}
      </div>
    </StoreGate>
  )
}
