'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useBeloteGame } from '@/hooks/useBeloteGame'
import RoundForm from '@/components/belote/RoundForm'
import ScoreBoard from '@/components/belote/ScoreBoard'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

export default function NouveauTourPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const router = useRouter()
  const sp = useSearchParams()
  const roundId = sp.get('roundId')
  const { game, rounds, pot, regles, loading, addRound, updateRound, team1Players, team2Players } = useBeloteGame(gameId)

  const back = () => router.push(`/belote/${gameId}`)

  const editing = roundId ? rounds.find(r => r.id === roundId) : undefined
  const initial = editing ? {
    dealer: editing.dealer,
    trumpTaker: editing.trumpTaker,
    input: {
      teamTaker: editing.teamTaker,
      rawScoreNous: editing.rawScoreNous,
      rawScoreEux: editing.rawScoreEux,
      capot: editing.capot,
      capotTeam: editing.capotTeam,
      beloteRebelote: editing.beloteRebelote,
      beloteRebeloteTeam: editing.beloteRebeloteTeam,
      ...(editing.dedansForce !== undefined ? { dedansForce: editing.dedansForce } : {}),
    },
  } : undefined

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={back} aria-label="Retour" className="p-2 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-bold text-gray-800">{editing ? `Modifier le tour ${editing.roundNumber}` : 'Nouveau tour'}</h1>
      </div>

      {loading ? (
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      ) : !game ? (
        <div className="text-center py-20 text-gray-400 text-sm">Partie introuvable.</div>
      ) : (game.status === 'finished' && !editing) ? (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 text-center space-y-3">
          <p className="text-sm font-medium text-green-700">Cette partie est terminée.</p>
          <button onClick={back} className="text-sm text-blue-600 hover:underline">Retour à la partie</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ScoreBoard game={game} rounds={rounds} pot={pot} />
          <RoundForm
            key={roundId ?? 'new'}
            game={game}
            regles={regles}
            team1Players={team1Players}
            team2Players={team2Players}
            initial={initial}
            submitLabel={editing ? 'Enregistrer les modifications' : 'Valider le tour'}
            onSubmit={async (input, meta) => {
              if (editing) await updateRound(editing.id, input, meta)
              else await addRound(input, meta)
              back()
            }}
          />
        </div>
      )}
    </div>
  )
}
