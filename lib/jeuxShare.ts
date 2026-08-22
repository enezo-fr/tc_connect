import { getAdminDb } from '@/lib/firebaseAdmin'
import type { DuoTour } from '@/types'

// Helpers d'auth communs — identiques aux autres apps.
export { genInviteToken, uidFromIdToken, displayName } from '@/lib/bebeInvite'

/**
 * Partage d'une partie de jeu (« Sarah & Ted » → Jeux).
 *
 * Deux portes, volontairement distinctes — même modèle que la belote :
 *  - PAR COMPTE : l'UID entre dans `duo_parties/{id}.members`, la partie apparaît
 *    dans son app comme les siennes (règles Firestore, temps réel). L'ajout passe
 *    par l'Admin SDK : les règles figent `members` côté client.
 *  - PAR LIEN / QR : `shareToken` sur la partie. La page publique n'a AUCUN accès
 *    Firestore — elle passe par ces routes. Le porteur du lien peut voir et
 *    compléter les parties du jeton, mais jamais en créer d'autres, ni supprimer
 *    la partie, ni toucher au partage.
 *
 * Un jeton ouvre TOUTE LA SOIRÉE : c'est ce qui permet à un appareil sans compte
 * de suivre le classement général quand on enchaîne plusieurs jeux.
 */

export const PARTIES = 'duo_parties'

type Data = Record<string, unknown>

const asRecord = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v as Record<string, unknown> : {})

const millis = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | undefined
  return typeof t?.toMillis === 'function' ? t.toMillis() : null
}

/** Retrouve la partie porteuse du jeton, ou null. */
export async function findByToken(token: string) {
  if (!token) return null
  const snap = await getAdminDb().collection(PARTIES).where('shareToken', '==', token).limit(1).get()
  return snap.empty ? null : snap.docs[0]
}

/**
 * Parties ouvertes par un jeton : la partie elle-même, et toutes celles de sa
 * soirée. Triées dans l'ordre de jeu (la plus ancienne d'abord) — la page
 * publique s'appuie sur cet ordre, elle n'a pas les dates Firestore pour trier.
 */
export async function partiesDuJeton(token: string) {
  const porteuse = await findByToken(token)
  if (!porteuse) return null

  const soireeId = (porteuse.data()?.soireeId ?? null) as string | null
  if (!soireeId) return { porteuse, docs: [porteuse] }

  const snap = await getAdminDb().collection(PARTIES).where('soireeId', '==', soireeId).get()
  const docs = snap.docs.length ? snap.docs : [porteuse]
  docs.sort((a, b) => dateDe(a.data()) - dateDe(b.data()))
  return { porteuse, docs }
}

const dateDe = (d: Data) => millis(d.date) ?? millis(d.createdAt) ?? 0

/** Un tour nettoyé : seuls les joueurs de la partie, points entiers et bornés. */
function toursValides(v: unknown, joueurs: string[]): DuoTour[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 300).map((t) => {
    const brut = asRecord(t)
    const scores = Array.isArray(brut.scores) ? brut.scores : []
    return {
      ...(typeof brut.nom === 'string' && brut.nom ? { nom: brut.nom.slice(0, 60) } : {}),
      scores: joueurs.map((j) => {
        const s = asRecord(scores.find((x) => asRecord(x).joueur === j))
        return { joueur: j, points: nombre(s.points) }
      }),
    }
  })
}

/** Points d'un tour : entier borné (certains jeux comptent en négatif). */
export const nombre = (v: unknown) => {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return 0
  return Math.min(99999, Math.max(-99999, n))
}

/** Projection publique d'une partie (ce que voit un porteur du lien). */
export function publicPartie(id: string, d: Data) {
  const joueurs = (Array.isArray(d.joueurs) ? d.joueurs : [])
    .filter((j): j is string => typeof j === 'string')
  return {
    id,
    jeu: typeof d.jeu === 'string' ? d.jeu : 'Partie',
    joueurs,
    tours: toursValides(d.tours, joueurs),
    scoreBasGagne: !!d.scoreBasGagne,
    sansPoints: !!d.sansPoints,
    ordre: (Array.isArray(d.ordre) ? d.ordre : []).filter((j): j is string => typeof j === 'string'),
    objectif: typeof d.objectif === 'number' ? d.objectif : null,
    termine: !!d.termine,
    infos: typeof d.infos === 'string' ? d.infos : '',
    soireeId: (d.soireeId ?? null) as string | null,
    soireeName: (d.soireeName ?? null) as string | null,
    soireeBareme: typeof d.soireeBareme === 'string' ? d.soireeBareme : undefined,
    /** Millisecondes — la page publique n'a pas de `Timestamp` Firestore. */
    dateMs: dateDe(d),
  }
}

export type PartiePublique = ReturnType<typeof publicPartie>

/**
 * Vérifie que `partieId` fait bien partie des parties ouvertes par le jeton.
 * Sans ça, le porteur d'un lien pourrait modifier n'importe quelle partie en
 * changeant l'identifiant envoyé.
 */
export async function partieDuJeton(token: string, partieId: string) {
  const lot = await partiesDuJeton(token)
  if (!lot) return null
  return lot.docs.find((d) => d.id === partieId) ?? null
}

/** Scores d'un tour venus du réseau (entrée non fiable) → un tour propre. */
export function tourValide(body: Data, joueurs: string[]): DuoTour {
  const scores = Array.isArray(body.scores) ? body.scores : []
  const nom = typeof body.nom === 'string' ? body.nom.trim().slice(0, 60) : ''
  return {
    ...(nom ? { nom } : {}),
    scores: joueurs.map((j) => {
      const s = asRecord(scores.find((x) => asRecord(x).joueur === j))
      return { joueur: j, points: nombre(s.points) }
    }),
  }
}

/** Ordre d'arrivée venu du réseau : uniquement des joueurs de la partie, sans doublon. */
export function ordreValide(v: unknown, joueurs: string[]): string[] {
  if (!Array.isArray(v)) return []
  const vus = new Set<string>()
  return v
    .filter((j): j is string => typeof j === 'string' && joueurs.includes(j))
    .filter((j) => (vus.has(j) ? false : (vus.add(j), true)))
}
