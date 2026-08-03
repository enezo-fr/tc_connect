'use client'

import { useEffect, useMemo, useState } from 'react'
import { Timestamp, writeBatch, doc, deleteField } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  listenBeloteGame, listenBeloteRounds, createBeloteRound, updateBeloteRound,
  updateBeloteGame, deleteBeloteRound, deleteBeloteGame, ensureGameShareFields,
} from '@/lib/belote/firebase'
import { calculerPartie, checkGameEnd, inputDeTour, reglesDe } from '@/lib/belote/rules'
import { useAuth } from '@/context/AuthContext'
import { useBeloteTeams } from '@/hooks/useBeloteTeams'
import type {
  BeloteEndCondition, BeloteGame, BeloteRound, BeloteRegles, RoundInput, Score,
} from '@/lib/belote/types'

/** Champs d'un tour recalculés par le moteur de règles. */
const champsCalcules = (t: { finalScore: Score; dedans: boolean; litige: boolean; potRecu: number }) => ({
  finalScore: t.finalScore,
  dedans: t.dedans,
  litige: t.litige,
  potRecu: t.potRecu,
})

const memeCalcul = (r: BeloteRound, t: { finalScore: Score; dedans: boolean; litige: boolean; potRecu: number }) =>
  r.finalScore?.team1 === t.finalScore.team1
  && r.finalScore?.team2 === t.finalScore.team2
  && !!r.dedans === t.dedans
  && !!r.litige === t.litige
  && (r.potRecu ?? 0) === t.potRecu

/** Champs de saisie d'un tour, prêts pour Firestore (jamais d'`undefined`). */
const champsSaisie = (input: RoundInput, meta: { dealer: string; trumpTaker: string }) => ({
  dealer: meta.dealer,
  trumpTaker: meta.trumpTaker,
  teamTaker: input.teamTaker,
  rawScoreNous: input.rawScoreNous,
  rawScoreEux: input.rawScoreEux,
  capot: input.capot,
  capotTeam: input.capotTeam,
  beloteRebelote: input.beloteRebelote,
  beloteRebeloteTeam: input.beloteRebeloteTeam,
  beloteRebelotePlayer: input.beloteRebelotePlayer ?? '',
})

/** À la CRÉATION : la clé est simplement absente si le verdict est automatique. */
const forceCreation = (input: RoundInput) =>
  (typeof input.dedansForce === 'boolean' ? { dedansForce: input.dedansForce } : {})

/** À la MODIFICATION : repasser en automatique doit EFFACER le champ. */
const forceMaj = (input: RoundInput) =>
  ({ dedansForce: input.dedansForce ?? deleteField() })

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

  const regles = reglesDe(game)

  /** Points encore en attente d'attribution (règle du litige). */
  const pot = useMemo(
    () => calculerPartie(rounds.map(inputDeTour), regles).pot,
    [rounds, regles],
  )

  /** Joueurs à afficher : la copie portée par la partie, sinon les équipes (auteur seul). */
  const team1Players = game?.team1Players?.length
    ? game.team1Players
    : (teams.find(t => t.id === game?.team1Id)?.players ?? [])
  const team2Players = game?.team2Players?.length
    ? game.team2Players
    : (teams.find(t => t.id === game?.team2Id)?.players ?? [])

  /**
   * Recalcule TOUTE la partie et n'écrit que ce qui a bougé.
   *
   * Le recalcul complet est indispensable avec la règle du litige : les points
   * mis en attente sur un tour se règlent sur le suivant, donc modifier ou
   * supprimer un tour change le score de ceux d'après.
   */
  const persister = async (
    g: BeloteGame,
    tours: BeloteRound[],
    reglesJeu: BeloteRegles,
  ) => {
    const res = calculerPartie(tours.map(inputDeTour), reglesJeu)

    const aCorriger = tours
      .map((t, i) => ({ t, calc: res.tours[i], numero: i + 1 }))
      .filter(({ t, calc, numero }) => !memeCalcul(t, calc) || t.roundNumber !== numero)

    if (aCorriger.length > 0) {
      const batch = writeBatch(db)
      aCorriger.forEach(({ t, calc, numero }) =>
        batch.update(doc(db, 'belote_rounds', t.id), { ...champsCalcules(calc), roundNumber: numero }))
      await batch.commit()
    }

    const end = checkGameEnd(g, res.tours.map((t) => ({ finalScore: t.finalScore })))
    await updateBeloteGame(g.id, {
      totalScore: res.totaux,
      status: end.finished ? 'finished' : 'in_progress',
      winnerId: end.winnerId,
      finishedAt: end.finished ? (g.finishedAt ?? Timestamp.now()) : null,
    })
  }

  /** Ajoute un tour : le moteur tranche le contrat, puis la partie est resynchronisée */
  const addRound = async (input: RoundInput, meta: { dealer: string; trumpTaker: string }) => {
    if (!game || !gameId) throw new Error('Partie introuvable')
    const res = calculerPartie([...rounds.map(inputDeTour), input], regles)
    const dernier = res.tours[res.tours.length - 1]

    const contenu = {
      roundNumber: rounds.length + 1,
      ...champsSaisie(input, meta),
      ...forceCreation(input),
      ...champsCalcules(dernier),
    }
    const ref = await createBeloteRound({ gameId, ...contenu })
    const ajoute = { id: (ref as { id: string }).id, ...contenu } as BeloteRound
    await persister(game, [...rounds, ajoute], regles)
  }

  /** Modifie un tour existant puis resynchronise toute la partie */
  const updateRound = async (roundId: string, input: RoundInput, meta: { dealer: string; trumpTaker: string }) => {
    if (!game) throw new Error('Partie introuvable')
    await updateBeloteRound(roundId, { ...champsSaisie(input, meta), ...forceMaj(input) })
    const majs = rounds.map((r) =>
      r.id === roundId
        ? ({ ...r, ...champsSaisie(input, meta), dedansForce: input.dedansForce } as BeloteRound)
        : r)
    await persister(game, majs, regles)
  }

  /** Supprime un tour, renumérote les suivants et resynchronise la partie */
  const removeRound = async (roundId: string) => {
    if (!game) throw new Error('Partie introuvable')
    await deleteBeloteRound(roundId)
    await persister(game, rounds.filter(r => r.id !== roundId), regles)
  }

  /** Modifie les paramètres de fin de partie ou les règles, puis resynchronise */
  const updateGameSettings = async (settings: {
    endCondition: BeloteEndCondition
    endValue: number
    regles?: BeloteRegles
  }) => {
    if (!game || !gameId) throw new Error('Partie introuvable')
    await updateBeloteGame(gameId, settings)
    await persister({ ...game, ...settings }, rounds, settings.regles ?? regles)
  }

  /** Supprime la partie et tous ses tours */
  const deleteGame = async () => {
    if (!gameId) throw new Error('Partie introuvable')
    await deleteBeloteGame(gameId)
  }

  return {
    game,
    rounds,
    regles,
    pot,
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
