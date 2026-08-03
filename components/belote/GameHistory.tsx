'use client'

import { useRouter } from 'next/navigation'
import type { BeloteGame } from '@/lib/belote/types'
import { ChevronRightIcon } from '@heroicons/react/24/outline'

export default function GameHistory({ games }: { games: BeloteGame[] }) {
  const router = useRouter()

  if (games.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <p className="text-sm text-gray-400">Aucune partie terminée.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {games.map((g) => {
        const winnerName = g.winnerId === g.team1Id ? g.team1Name
          : g.winnerId === g.team2Id ? g.team2Name : null
        const date = g.finishedAt?.toDate?.() ?? g.createdAt?.toDate?.()
        return (
          <button key={g.id} onClick={() => router.push(`/belote/${g.id}`)}
            className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 break-words">
                {g.team1Name} <span className="text-gray-300">vs</span> {g.team2Name}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {g.totalScore.team1} · {g.totalScore.team2}
                {winnerName ? ` — 🏆 ${winnerName}` : ' — Égalité'}
              </p>
              {date && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
            <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
