'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useBeloteGames } from '@/hooks/useBeloteGames'
import { useBeloteStats } from '@/hooks/useBeloteStats'
import GameHistory from '@/components/belote/GameHistory'
import StatsJoueurs from '@/components/belote/StatsJoueurs'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import type { BeloteGame } from '@/lib/belote/types'

interface Standing { id: string; name: string; points: number; games: number; wins: number }

function buildStandings(games: BeloteGame[]): Standing[] {
  const map = new Map<string, Standing>()
  const add = (id: string, name: string, points: number, win: boolean) => {
    const cur = map.get(id) ?? { id, name, points: 0, games: 0, wins: 0 }
    cur.name = name
    cur.points += points
    cur.games += 1
    if (win) cur.wins += 1
    map.set(id, cur)
  }
  games.forEach(g => {
    add(g.team1Id, g.team1Name, g.totalScore?.team1 ?? 0, g.winnerId === g.team1Id)
    add(g.team2Id, g.team2Name, g.totalScore?.team2 ?? 0, g.winnerId === g.team2Id)
  })
  return [...map.values()].sort((a, b) => b.points - a.points)
}

export default function HistoriquePage() {
  const router = useRouter()
  const { games, finished, loading } = useBeloteGames()
  // Toutes les parties, pas seulement les terminées : les prises d'une partie en
  // cours comptent déjà dans le palmarès des preneurs.
  const { parties: partiesAvecTours } = useBeloteStats(games)

  // Tri par date de fin décroissante (la plus récente en haut)
  const sortedFinished = useMemo(() =>
    [...finished].sort((a, b) =>
      ((b.finishedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.finishedAt?.seconds ?? a.createdAt?.seconds ?? 0))
    ), [finished])

  const standings = useMemo(() => buildStandings(finished), [finished])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/belote')} aria-label="Retour"
          className="p-2 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-xl font-bold text-gray-800">Historique & classement</h1>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Classement général cumulé */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Classement général</h2>
            {standings.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
                <p className="text-sm text-gray-400">Aucune partie terminée pour cumuler les points.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {standings.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-400'
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.games} partie{s.games > 1 ? 's' : ''} · {s.wins} victoire{s.wins > 1 ? 's' : ''}</p>
                    </div>
                    <span className="text-lg font-bold text-blue-600 tabular-nums shrink-0">{s.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liste des parties terminées puis statistiques toutes parties confondues */}
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Parties terminées</h2>
              <GameHistory games={sortedFinished} />
            </div>
            <StatsJoueurs parties={partiesAvecTours} titre="Statistiques, toutes parties" />
          </div>
        </div>
      )}
    </div>
  )
}
