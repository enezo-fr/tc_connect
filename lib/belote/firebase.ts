import { db } from '@/lib/firebase'
import {
  collection, addDoc, doc, updateDoc, deleteDoc, deleteField,
  onSnapshot, query, where, getDocs, writeBatch, arrayUnion, arrayRemove, Timestamp,
  type DocumentData, type Query,
} from 'firebase/firestore'
import type { BeloteTeam, BeloteGame, BeloteRound, BelotePlayer } from './types'

const teamsCol = collection(db, 'belote_teams')
const gamesCol = collection(db, 'belote_games')
const roundsCol = collection(db, 'belote_rounds')

/** Nom d'équipe auto-généré depuis les prénoms : "Marie & Pierre" */
export function teamNameFromPlayers(players: BelotePlayer[]): string {
  return players.map(p => p.firstName.trim()).filter(Boolean).join(' & ') || 'Équipe'
}

// ─── Équipes ────────────────────────────────────────────────────────────────────

// Données privées à chaque utilisateur : on filtre par createdBy (tri côté client → pas d'index composite).
export const listenBeloteTeams = (userUid: string, cb: (teams: BeloteTeam[]) => void) =>
  onSnapshot(query(teamsCol, where('createdBy', '==', userUid)), (snap) => {
    cb(snap.docs
      .map(d => ({ id: d.id, ...d.data() } as BeloteTeam))
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)))
  })

export const createBeloteTeam = (players: BelotePlayer[], userUid: string) =>
  addDoc(teamsCol, {
    name: teamNameFromPlayers(players),
    players,
    createdBy: userUid,
    createdAt: Timestamp.now(),
  })

// ─── Parties ────────────────────────────────────────────────────────────────────

/**
 * Parties visibles par un utilisateur : les siennes ET celles qu'on lui a partagées.
 *
 * Deux écoutes fusionnées plutôt qu'un seul `array-contains` sur `members` : les
 * parties créées AVANT le partage n'ont pas de champ `members`, elles
 * disparaîtraient de la liste de leur propre auteur. Aucune migration nécessaire,
 * et une partie ancienne se répare toute seule à sa première ouverture
 * (`ensureGameShareFields`). Tri côté client → pas d'index composite.
 */
export const listenBeloteGames = (userUid: string, cb: (games: BeloteGame[]) => void) => {
  const parSource = new Map<string, Map<string, BeloteGame>>()

  const emettre = () => {
    const fusion = new Map<string, BeloteGame>()
    parSource.forEach((games) => games.forEach((g, id) => fusion.set(id, g)))
    cb([...fusion.values()].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)))
  }

  const ecouter = (source: string, q: Query<DocumentData>) =>
    onSnapshot(q, (snap) => {
      parSource.set(source, new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() } as BeloteGame])))
      emettre()
    })

  const u1 = ecouter('mine', query(gamesCol, where('createdBy', '==', userUid)))
  const u2 = ecouter('shared', query(gamesCol, where('members', 'array-contains', userUid)))
  return () => { u1(); u2() }
}

export const listenBeloteGame = (gameId: string, cb: (game: BeloteGame | null) => void) =>
  onSnapshot(doc(db, 'belote_games', gameId), (s) => {
    cb(s.exists() ? ({ id: s.id, ...s.data() } as BeloteGame) : null)
  })

export const createBeloteGame = (data: Omit<BeloteGame, 'id' | 'createdAt'>) =>
  addDoc(gamesCol, { ...data, createdAt: Timestamp.now() })

export const updateBeloteGame = (gameId: string, data: Partial<BeloteGame>) =>
  updateDoc(doc(db, 'belote_games', gameId), data)

/** Supprime une partie ET tous ses tours (cascade) */
export const deleteBeloteGame = async (gameId: string) => {
  const snap = await getDocs(query(roundsCol, where('gameId', '==', gameId)))
  if (snap.docs.length > 0) {
    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
  await deleteDoc(doc(db, 'belote_games', gameId))
}

// ─── Partage ────────────────────────────────────────────────────────────────────

/** Jeton de lien public (32 caractères, imprévisible). */
export const genShareToken = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/**
 * Complète une partie ancienne avec ce que le partage exige : `members` (sinon
 * elle serait invisible aux invités) et les joueurs dénormalisés (sinon un invité
 * ne pourrait pas saisir de tour). Silencieux : seul le propriétaire peut lire les
 * équipes, donc seul lui déclenche le rattrapage.
 */
export const ensureGameShareFields = async (
  game: BeloteGame,
  teams: BeloteTeam[],
  userUid: string,
): Promise<void> => {
  if (game.createdBy !== userUid) return
  const patch: Record<string, unknown> = {}

  if (!game.members?.includes(userUid)) patch.members = arrayUnion(userUid)
  if (!game.team1Players?.length) {
    const t1 = teams.find(t => t.id === game.team1Id)
    if (t1?.players?.length) patch.team1Players = t1.players
  }
  if (!game.team2Players?.length) {
    const t2 = teams.find(t => t.id === game.team2Id)
    if (t2?.players?.length) patch.team2Players = t2.players
  }

  if (Object.keys(patch).length === 0) return
  try { await updateBeloteGame(game.id, patch as Partial<BeloteGame>) }
  catch { /* sans droits d'écriture, on n'insiste pas */ }
}

/** Active le lien public + QR (aucun compte requis pour l'ouvrir). */
export const activerPartageLien = async (gameId: string): Promise<string> => {
  const token = genShareToken()
  await updateBeloteGame(gameId, { shareToken: token })
  return token
}

/** Coupe le lien public : les appareils sans compte perdent l'accès. */
export const couperPartageLien = (gameId: string) =>
  updateDoc(doc(db, 'belote_games', gameId), { shareToken: deleteField() })

/** Mémorise une adresse à qui le lien a été envoyé (affichage seul, aucun droit). */
export const noterEmailPartage = (gameId: string, email: string) =>
  updateDoc(doc(db, 'belote_games', gameId), { sharedEmails: arrayUnion(email.trim().toLowerCase()) })

export const retirerEmailPartage = (gameId: string, email: string) =>
  updateDoc(doc(db, 'belote_games', gameId), { sharedEmails: arrayRemove(email) })

// ─── Séries (parties liées) ─────────────────────────────────────────────────────

/** Rattache une partie à une série (revanche, belle…). */
export const lierPartieASerie = (gameId: string, serieId: string, serieName: string) =>
  updateBeloteGame(gameId, { serieId, serieName })

/** Détache une partie de sa série. */
export const delierPartie = (gameId: string) =>
  updateDoc(doc(db, 'belote_games', gameId), { serieId: null, serieName: null })

// ─── Tours (temps réel) ──────────────────────────────────────────────────────────

/** Listener temps réel des tours d'une partie (tri côté client → pas d'index composite) */
export const listenBeloteRounds = (gameId: string, cb: (rounds: BeloteRound[]) => void) =>
  onSnapshot(query(roundsCol, where('gameId', '==', gameId)), (snap) => {
    const rounds = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as BeloteRound))
      .sort((a, b) => a.roundNumber - b.roundNumber)
    cb(rounds)
  })

/**
 * Tours de PLUSIEURS parties à la fois (statistiques d'une série, de l'historique).
 * Firestore plafonne `in` à 10 valeurs → on découpe et on fusionne les lots.
 */
export const listenBeloteRoundsForGames = (
  gameIds: string[],
  cb: (rounds: BeloteRound[]) => void,
) => {
  if (gameIds.length === 0) { cb([]); return () => {} }

  const lots: string[][] = []
  for (let i = 0; i < gameIds.length; i += 10) lots.push(gameIds.slice(i, i + 10))

  const parLot = new Map<number, BeloteRound[]>()
  const unsubs = lots.map((lot, i) =>
    onSnapshot(query(roundsCol, where('gameId', 'in', lot)), (snap) => {
      parLot.set(i, snap.docs.map(d => ({ id: d.id, ...d.data() } as BeloteRound)))
      cb([...parLot.values()].flat().sort((a, b) => a.roundNumber - b.roundNumber))
    }),
  )
  return () => unsubs.forEach(u => u())
}

export const createBeloteRound = (data: Omit<BeloteRound, 'id' | 'createdAt'>) =>
  addDoc(roundsCol, { ...data, createdAt: Timestamp.now() })

// `Record` et non `Partial<BeloteRound>` : une mise à jour peut porter un
// `deleteField()` (repasser un verdict forcé en automatique).
export const updateBeloteRound = (roundId: string, data: Record<string, unknown>) =>
  updateDoc(doc(db, 'belote_rounds', roundId), data)

export const deleteBeloteRound = (roundId: string) =>
  deleteDoc(doc(db, 'belote_rounds', roundId))
