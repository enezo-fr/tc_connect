'use client'

import { useEffect, useMemo, useState } from 'react'
import { listenBeloteRoundsForGames } from '@/lib/belote/firebase'
import type { PartieAvecTours } from '@/lib/belote/stats'
import type { BeloteGame, BeloteRound } from '@/lib/belote/types'

/**
 * Tours de plusieurs parties, prêts pour les statistiques.
 *
 * Renvoie directement les couples partie + tours attendus par `statsJoueurs` :
 * l'appelant n'a pas à refaire le rapprochement.
 */
export function useBeloteStats(games: BeloteGame[]) {
  const [rounds, setRounds] = useState<BeloteRound[]>([])
  const [loading, setLoading] = useState(true)

  // Clé stable : sans ça, un nouveau tableau à chaque rendu relancerait l'écoute.
  const ids = useMemo(() => games.map(g => g.id).sort().join(','), [games])

  useEffect(() => {
    const liste = ids ? ids.split(',') : []
    if (liste.length === 0) { setRounds([]); setLoading(false); return }
    setLoading(true)
    return listenBeloteRoundsForGames(liste, (r) => { setRounds(r); setLoading(false) })
  }, [ids])

  const parties: PartieAvecTours[] = useMemo(
    () => games.map((game) => ({ game, rounds: rounds.filter(r => r.gameId === game.id) })),
    [games, rounds],
  )

  return { parties, rounds, loading }
}
