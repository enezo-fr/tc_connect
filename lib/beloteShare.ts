import { getAdminDb } from '@/lib/firebaseAdmin'
import { calculateRoundScore, sumRounds, checkGameEnd } from '@/lib/belote/rules'
import type { BeloteEndCondition, RoundInput, TeamSlot } from '@/lib/belote/types'

// Helpers d'auth communs — identiques aux autres apps.
export { genInviteToken, uidFromIdToken, displayName } from '@/lib/bebeInvite'

/**
 * Partage d'une partie de belote.
 *
 * Deux portes, volontairement distinctes :
 *  - PAR COMPTE : l'UID entre dans `belote_games/{id}.members`, l'app affiche la
 *    partie comme les siennes (règles Firestore, temps réel).
 *  - PAR LIEN / QR : `shareToken` sur la partie. La page publique n'a AUCUN accès
 *    Firestore — elle passe par ces routes (Admin SDK). Le porteur du lien peut
 *    voir et modifier les parties du jeton, mais jamais en créer d'autres, ni
 *    supprimer la partie, ni toucher au partage.
 *
 * Un jeton ouvre TOUTE LA SÉRIE (revanche, belle…) : c'est ce qui permet à un
 * appareil sans compte de suivre l'écart de points d'une partie à l'autre.
 */

export const GAMES = 'belote_games'
export const ROUNDS = 'belote_rounds'

type Data = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Retrouve la partie porteuse du jeton, ou null. */
export async function findByToken(token: string) {
  if (!token) return null
  const snap = await getAdminDb().collection(GAMES).where('shareToken', '==', token).limit(1).get()
  return snap.empty ? null : snap.docs[0]
}

/**
 * Parties ouvertes par un jeton : la partie elle-même, et toutes celles de sa
 * série. Triées dans l'ordre de jeu (la plus ancienne d'abord).
 */
export async function partiesDuJeton(token: string) {
  const porteuse = await findByToken(token)
  if (!porteuse) return null

  const serieId: string | null = porteuse.data()?.serieId ?? null
  if (!serieId) return { porteuse, docs: [porteuse] }

  const snap = await getAdminDb().collection(GAMES).where('serieId', '==', serieId).get()
  const docs = snap.docs.length ? snap.docs : [porteuse]
  docs.sort((a, b) => (a.data().createdAt?.toMillis?.() ?? 0) - (b.data().createdAt?.toMillis?.() ?? 0))
  return { porteuse, docs }
}

/** Projection publique d'une partie (ce que voit un porteur du lien). */
export function publicGame(id: string, d: Data) {
  return {
    id,
    team1Id: d.team1Id ?? '',
    team2Id: d.team2Id ?? '',
    team1Name: d.team1Name ?? 'Équipe 1',
    team2Name: d.team2Name ?? 'Équipe 2',
    team1Players: Array.isArray(d.team1Players) ? d.team1Players : [],
    team2Players: Array.isArray(d.team2Players) ? d.team2Players : [],
    endCondition: (d.endCondition ?? 'score') as BeloteEndCondition,
    endValue: Number(d.endValue) || 1000,
    status: d.status === 'finished' ? 'finished' as const : 'in_progress' as const,
    winnerId: d.winnerId ?? null,
    totalScore: { team1: d.totalScore?.team1 ?? 0, team2: d.totalScore?.team2 ?? 0 },
    serieId: d.serieId ?? null,
    serieName: d.serieName ?? null,
    createdAt: d.createdAt?.toMillis?.() ?? null,
    finishedAt: d.finishedAt?.toMillis?.() ?? null,
  }
}

/** Projection publique d'un tour. */
export function publicRound(id: string, d: Data) {
  return {
    id,
    gameId: d.gameId ?? '',
    roundNumber: Number(d.roundNumber) || 0,
    dealer: d.dealer ?? '',
    trumpTaker: d.trumpTaker ?? '',
    teamTaker: (d.teamTaker === 'team2' ? 'team2' : 'team1') as TeamSlot,
    rawScoreNous: Number(d.rawScoreNous) || 0,
    rawScoreEux: Number(d.rawScoreEux) || 0,
    capot: !!d.capot,
    capotTeam: d.capotTeam ?? null,
    dedans: !!d.dedans,
    beloteRebelote: !!d.beloteRebelote,
    beloteRebeloteTeam: d.beloteRebeloteTeam ?? null,
    finalScore: { team1: d.finalScore?.team1 ?? 0, team2: d.finalScore?.team2 ?? 0 },
  }
}

/** Tours d'une partie, dans l'ordre (tri en mémoire → pas d'index composite). */
export async function roundsDePartie(gameId: string) {
  const snap = await getAdminDb().collection(ROUNDS).where('gameId', '==', gameId).get()
  return snap.docs
    .map((d) => ({ ref: d.ref, view: publicRound(d.id, d.data()) }))
    .sort((a, b) => a.view.roundNumber - b.view.roundNumber)
}

/**
 * Vérifie que `gameId` fait bien partie des parties ouvertes par le jeton.
 * Sans ça, le porteur d'un lien pourrait modifier n'importe quelle partie en
 * changeant l'identifiant envoyé.
 */
export async function partieDuJeton(token: string, gameId: string) {
  const lot = await partiesDuJeton(token)
  if (!lot) return null
  return lot.docs.find((d) => d.id === gameId) ?? null
}

/** Nettoie une saisie de tour venue du réseau (page publique = entrée non fiable). */
export function cleanRoundInput(body: Data): { input: RoundInput; dealer: string; trumpTaker: string } {
  const slot = (v: unknown): TeamSlot | null => (v === 'team1' || v === 'team2' ? v : null)
  const nb = (v: unknown) => Math.min(999, Math.max(0, Math.floor(Number(v) || 0)))
  const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max).trim() : '')

  const capotTeam = slot(body.capotTeam)
  const beloteTeam = slot(body.beloteRebeloteTeam)
  return {
    dealer: str(body.dealer),
    trumpTaker: str(body.trumpTaker),
    input: {
      teamTaker: slot(body.teamTaker) ?? 'team1',
      rawScoreNous: nb(body.rawScoreNous),
      rawScoreEux: nb(body.rawScoreEux),
      capot: !!body.capot && !!capotTeam,
      capotTeam: body.capot ? capotTeam : null,
      dedans: !!body.dedans,
      beloteRebelote: !!body.beloteRebelote && !!beloteTeam,
      beloteRebeloteTeam: body.beloteRebelote ? beloteTeam : null,
    },
  }
}

/**
 * Recalcule le cumul et l'état de fin d'une partie à partir de ses tours, puis
 * les persiste. Même règle que le hook côté navigateur (`useBeloteGame`) : les
 * deux portes doivent aboutir au même score.
 */
export async function resyncPartie(gameId: string) {
  const db = getAdminDb()
  const ref = db.collection(GAMES).doc(gameId)
  const snap = await ref.get()
  if (!snap.exists) return null

  const d = snap.data()!
  const rounds = (await roundsDePartie(gameId)).map((r) => ({ finalScore: r.view.finalScore }))
  const totals = sumRounds(rounds)
  const end = checkGameEnd(
    {
      endCondition: (d.endCondition ?? 'score') as BeloteEndCondition,
      endValue: Number(d.endValue) || 1000,
      team1Id: d.team1Id ?? '',
      team2Id: d.team2Id ?? '',
    },
    rounds,
  )

  await ref.update({
    totalScore: totals,
    status: end.finished ? 'finished' : 'in_progress',
    winnerId: end.winnerId,
    finishedAt: end.finished ? (d.finishedAt ?? new Date()) : null,
  })
  return (await ref.get()).data()!
}

/** Score final d'un tour — exposé pour les routes d'écriture. */
export { calculateRoundScore }
