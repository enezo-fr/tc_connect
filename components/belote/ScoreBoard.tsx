'use client'

import { sumRounds } from '@/lib/belote/rules'
import type { BeloteGame, BeloteRound } from '@/lib/belote/types'

export default function ScoreBoard({ game, rounds, pot = 0 }: {
  game: BeloteGame
  rounds: BeloteRound[]
  /** Points en litige, en attente de la prochaine donne gagnée. */
  pot?: number
}) {
  const totals = sumRounds(rounds)
  const finished = game.status === 'finished'
  const winnerName = game.winnerId === game.team1Id ? game.team1Name
    : game.winnerId === game.team2Id ? game.team2Name : null

  const leader: 'team1' | 'team2' | null =
    totals.team1 > totals.team2 ? 'team1' : totals.team2 > totals.team1 ? 'team2' : null

  // Progression
  const pct = (v: number) => game.endCondition === 'score'
    ? Math.min(100, Math.round((v / game.endValue) * 100))
    : 0

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Bandeau de fin */}
      {finished && (
        <div className="bg-green-500 text-white text-center py-2 text-sm font-semibold">
          🏆 {winnerName ? `Victoire de ${winnerName}` : 'Égalité !'}
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-gray-100">
        {(['team1', 'team2'] as const).map((slot) => {
          const name = slot === 'team1' ? game.team1Name : game.team2Name
          const val = totals[slot]
          const isLeader = leader === slot
          return (
            <div key={slot} className={`p-4 text-center ${isLeader ? 'bg-blue-50/50' : ''}`}>
              <p className="text-xs font-medium text-gray-500 truncate mb-1">{name}</p>
              <p className={`text-3xl font-bold tabular-nums ${isLeader ? 'text-blue-600' : 'text-gray-800'}`}>
                {val}
              </p>
              {game.endCondition === 'score' && (
                <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden mt-2">
                  <div className={`h-full rounded-full transition-all ${isLeader ? 'bg-blue-500' : 'bg-gray-300'}`}
                    style={{ width: `${pct(val)}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Litige en cours */}
      {pot > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-center">
          <p className="text-xs font-medium text-amber-800">
            {pot} points en attente — ils reviendront à l&apos;équipe qui gagnera la prochaine donne.
          </p>
        </div>
      )}

      {/* Infos partie */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-500">
          {game.endCondition === 'rounds'
            ? `Tour ${Math.min(rounds.length, game.endValue)} / ${game.endValue}`
            : `Objectif : ${game.endValue} pts`}
          {' · '}{rounds.length} tour{rounds.length > 1 ? 's' : ''} joué{rounds.length > 1 ? 's' : ''}
        </p>
      </div>
    </div>
  )
}
