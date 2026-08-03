'use client'

import type { BeloteGame, BeloteRound } from '@/lib/belote/types'
import { TrashIcon, PencilIcon } from '@heroicons/react/24/outline'

interface Props {
  game: BeloteGame
  rounds: BeloteRound[]
  onDelete?: (roundId: string) => void
  onEdit?: (roundId: string) => void
}

export default function RoundHistory({ game, rounds, onDelete, onEdit }: Props) {
  if (rounds.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <p className="text-sm text-gray-400">Aucun tour joué pour l&apos;instant.</p>
      </div>
    )
  }

  // Plus récent en premier
  const ordered = [...rounds].sort((a, b) => b.roundNumber - a.roundNumber)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {ordered.map((r) => (
        <div key={r.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-gray-400">Tour {r.roundNumber}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-gray-800">
                {r.finalScore.team1} <span className="text-gray-300">·</span> {r.finalScore.team2}
              </span>
              {onEdit && (
                <button onClick={() => onEdit(r.id)} aria-label="Modifier le tour"
                  className="p-1 text-gray-300 hover:text-blue-500 transition">
                  <PencilIcon className="w-4 h-4" />
                </button>
              )}
              {onDelete && (
                <button onClick={() => onDelete(r.id)} aria-label="Supprimer le tour"
                  className="p-1 text-gray-300 hover:text-red-500 transition">
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {r.trumpTaker && (
              <span className="text-xs text-gray-500">
                Pris par {r.trumpTaker} ({r.teamTaker === 'team1' ? game.team1Name : game.team2Name})
              </span>
            )}
            {r.capot && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Capot</span>}
            {r.dedans && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Dedans</span>}
            {r.litige && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">Litige</span>}
            {!!r.potRecu && r.potRecu > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                {`+${r.potRecu} de litige`}
              </span>
            )}
            {r.beloteRebelote && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Belote</span>}
            {r.dedansForce !== undefined && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Corrigé</span>
            )}
          </div>
          {r.dealer && <p className="text-[11px] text-gray-400 mt-0.5">Distribution : {r.dealer}</p>}
        </div>
      ))}
    </div>
  )
}
