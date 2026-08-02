'use client'

import { useState } from 'react'
import TeamSelector from './TeamSelector'
import { createBeloteGame } from '@/lib/belote/firebase'
import { useAuth } from '@/context/AuthContext'
import type { BeloteTeam, BeloteEndCondition } from '@/lib/belote/types'

interface Props {
  onCreated: (gameId: string) => void
  onError?: (msg: string) => void
}

export default function GameSetup({ onCreated, onError }: Props) {
  const { currentUser } = useAuth()
  const [team1, setTeam1] = useState<BeloteTeam | null>(null)
  const [team2, setTeam2] = useState<BeloteTeam | null>(null)
  const [endCondition, setEndCondition] = useState<BeloteEndCondition>('score')
  const [endValue, setEndValue] = useState('1000')
  const [saving, setSaving] = useState(false)

  const canStart = team1 && team2 && team1.id !== team2.id && Number(endValue) > 0

  const handleStart = async () => {
    if (!team1 || !team2) return
    setSaving(true)
    try {
      const ref = await createBeloteGame({
        team1Id: team1.id,
        team2Id: team2.id,
        team1Name: team1.name,
        team2Name: team2.name,
        // Recopiés pour le partage : les équipes restent privées à leur auteur.
        team1Players: team1.players ?? [],
        team2Players: team2.players ?? [],
        members: currentUser ? [currentUser.uid] : [],
        endCondition,
        endValue: Number(endValue) || (endCondition === 'rounds' ? 10 : 1000),
        status: 'in_progress',
        winnerId: null,
        totalScore: { team1: 0, team2: 0 },
        createdBy: currentUser?.uid ?? '',
        finishedAt: null,
      })
      onCreated((ref as { id: string }).id)
    } catch {
      onError?.('Erreur lors de la création de la partie.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TeamSelector label="Équipe 1 (Nous)" selected={team1} onSelect={setTeam1} excludeId={team2?.id} />
        <TeamSelector label="Équipe 2 (Eux)" selected={team2} onSelect={setTeam2} excludeId={team1?.id} />
      </div>

      {/* Condition de fin */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Fin de partie</label>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([['score', 'Par score'], ['rounds', 'Par tours']] as [BeloteEndCondition, string][]).map(([k, lbl]) => (
            <button key={k} type="button"
              onClick={() => { setEndCondition(k); setEndValue(k === 'score' ? '1000' : '10') }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${endCondition === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {endCondition === 'score' ? 'Score cible' : 'Nombre de tours'}
        </label>
        <input type="number" inputMode="numeric" min={1} value={endValue}
          onChange={e => setEndValue(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
        {endCondition === 'score' && (
          <div className="flex gap-1.5 mt-2">
            {[500, 1000, 2000].map(v => (
              <button key={v} type="button" onClick={() => setEndValue(String(v))}
                className={`flex-1 text-xs py-1.5 rounded-lg border transition ${endValue === String(v) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300'}`}>
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={handleStart} disabled={!canStart || saving}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition">
        {saving ? 'Création…' : 'Commencer la partie'}
      </button>
      {team1 && team2 && team1.id === team2.id && (
        <p className="text-xs text-red-500 text-center">Les deux équipes doivent être différentes.</p>
      )}
    </div>
  )
}
