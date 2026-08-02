'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { listenBeloteGames } from '@/lib/belote/firebase'
import type { BeloteGame } from '@/lib/belote/types'

/** Liste des parties visibles (les miennes + celles partagées avec moi), en temps réel */
export function useBeloteGames() {
  const { currentUser } = useAuth()
  const [games, setGames] = useState<BeloteGame[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    const unsub = listenBeloteGames(currentUser.uid, (g) => {
      setGames(g)
      setLoading(false)
    })
    return unsub
  }, [currentUser])

  const uid = currentUser?.uid
  /** Parties dont je ne suis pas l'auteur : quelqu'un me les a partagées. */
  const partagees = useMemo(
    () => games.filter(g => !!uid && g.createdBy !== uid),
    [games, uid],
  )

  return {
    games,
    inProgress: games.filter(g => g.status === 'in_progress'),
    finished: games.filter(g => g.status === 'finished'),
    partagees,
    /** Au moins une partie partagée → l'app reste ouverte même sans abonnement. */
    aDesPartagees: partagees.length > 0,
    loading,
  }
}
