'use client'

import { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import {
  listenBeloteGame, listenBeloteRounds, createBeloteRound, updateBeloteRound,
  updateBeloteGame, deleteBeloteRound, deleteBeloteGame, ensureGameShareFields,
} from '@/lib/belote/firebase'
import { calculateRoundScore, sumRounds, checkGameEnd } from '@/lib/belote/rules'
import { useAuth } from '@/context/AuthContext'
import { useBeloteTeams } from '@/hooks/useBeloteTeams'
import type { BeloteGame, BeloteRound, RoundInput, BeloteEndCondition } from '@/lib/belote/types'

/** État d'une partie (partie + tours en temps réel) + ajout/suppression de tours */
export function useBeloteGame(gameId: string | null) {
  const { currentUser } = useAuth()
  const { teams } = useBeloteTeams()
  const [game, setGame] = useState<BeloteGame | null>(null)
  const [rounds, setRounds] = useState<BeloteRound[]>([])
  const [loadingGame, setLoadingGame] = useState(true)
  const [loadingRounds, setLoadingRounds] = useState(true)

  useEffect(() => {
    if (!gameId) { setGame(null); setLoadingGame(false); setLoadingRounds(false); return }
    setLoadingGame(true); setLoadingRounds(true)
    const u1 = listenBeloteGame(gameId, (g) => { setGame(g); setLoadingGame(false) })
    const u2 = listenBeloteRounds(gameId, (r) => { setRounds(r); setLoadingRounds(false) })
    return () => { u1(); u2() }
  }, [gameId])

  // Rattrapage des parties créées avant le partage (membres + joueurs dénormalisés).
  useEffect(() => {
    if (!game || !currentUser || !teams.length) return
    ensureGameShareFields(game, teams, currentUser.uid)
  }, [game, teams, currentUser])

  /** Joueurs à afficher : la copie portée par la partie, sinon les équipes (auteur seul). */
  const team1Players = game?.team1Players?.length
    ? game.team1Players
    : (teams.find(t => t.id === game?.team1Id)?.players ?? [])
  const team2Players = game?.team2Players?.length
    ? game.team2Players
    : (teams.find(t => t.id === game?.team2Id)?.players ?? [])

  /** Recalcule et persiste le score cumulé + l'état de fin à partir d'une liste de tours */
  const syncGameState = async (g: BeloteGame, allRounds: Pick<BeloteRound, 'finalScore'>[]) => {
    const totals = sumRounds(allRounds)
    const end = checkGameEnd(g, allRounds)
    await updateBeloteGame(g.id, {
      totalScore: totals,
      status: end.finished ? 'finished' : 'in_progress',
      winnerId: end.winnerId,
      finishedAt: end.finished ? Timestamp.now() : null,
    })
  }

  /** Ajoute un tour : calcule le score final, persiste, puis met à jour la partie */
  const addRound = async (input: RoundInput, meta: { dealer: string; trumpTaker: string }) => {
    if (!game || !gameId) throw new Error('Partie introuvable')
    const finalScore = calculateRoundScore(input)
    await createBeloteRound({
      gameId,
      roundNumber: rounds.length + 1,
      dealer: meta.dealer,
      trumpTaker: meta.trumpTaker,
      teamTaker: input.teamTaker,
      rawScoreNous: input.rawScoreNous,
      rawScoreEux: input.rawScoreEux,
      capot: input.capot,
      capotTeam: input.capotTeam,
      dedans: input.dedans,
      beloteRebelote: input.beloteRebelote,
      beloteRebeloteTeam: input.beloteRebeloteTeam,
      finalScore,
    })
    await syncGameState(game, [...rounds, { finalScore } as BeloteRound])
  }

  /** Modifie un tour existant puis resynchronise le score de la partie */
  const updateRound = async (roundId: string, input: RoundInput, meta: { dealer: string; trumpTaker: string }) => {
    if (!game) throw new Error('Partie introuvable')
    const finalScore = calculateRoundScore(input)
    await updateBeloteRound(roundId, {
      dealer: meta.dealer,
      trumpTaker: meta.trumpTaker,
      teamTaker: input.teamTaker,
      rawScoreNous: input.rawScoreNous,
      rawScoreEux: input.rawScoreEux,
      capot: input.capot,
      capotTeam: input.capotTeam,
      dedans: input.dedans,
      beloteRebelote: input.beloteRebelote,
      beloteRebeloteTeam: input.beloteRebeloteTeam,
      finalScore,
    })
    await syncGameState(game, rounds.map(r => r.id === roundId ? { finalScore } as BeloteRound : r))
  }

  /** Supprime un tour et resynchronise le score de la partie */
  const removeRound = async (roundId: string) => {
    if (!game) throw new Error('Partie introuvable')
    await deleteBeloteRound(roundId)
    await syncGameState(game, rounds.filter(r => r.id !== roundId))
  }

  /** Modifie les paramètres de fin de partie puis resynchronise l'état */
  const updateGameSettings = async (settings: { endCondition: BeloteEndCondition; endValue: number }) => {
    if (!game || !gameId) throw new Error('Partie introuvable')
    await updateBeloteGame(gameId, settings)
    await syncGameState({ ...game, ...settings }, rounds)
  }

  /** Supprime la partie et tous ses tours */
  const deleteGame = async () => {
    if (!gameId) throw new Error('Partie introuvable')
    await deleteBeloteGame(gameId)
  }

  return {
    game,
    rounds,
    team1Players,
    team2Players,
    /** L'utilisateur est-il l'auteur ? (supprimer / couper le partage lui sont réservés) */
    estAuteur: !!game && !!currentUser && game.createdBy === currentUser.uid,
    loading: loadingGame || loadingRounds,
    addRound,
    updateRound,
    removeRound,
    updateGameSettings,
    deleteGame,
  }
}
