import { getAdminDb } from '@/lib/firebaseAdmin'

// Helpers d'auth communs — identiques aux autres apps.
export { genInviteToken, uidFromIdToken, displayName } from '@/lib/bebeInvite'

/**
 * Partage PAR COMMANDE de l'app « Commandes ».
 *
 * Contrairement aux autres apps (partage du couple/de toute l'app), ici on
 * partage UNE commande précise par un lien public + QR. Le jeton `shareToken`
 * est posé sur le doc `bar_commandes/{id}` par le propriétaire ; la page publique
 * `/commande/{token}` lit et écrit via l'Admin SDK (aucun compte requis).
 */

export const COMMANDES = 'bar_commandes'

/** Retrouve la commande partagée par son jeton, ou null. */
export async function findByToken(token: string) {
  const snap = await getAdminDb()
    .collection(COMMANDES)
    .where('shareToken', '==', token)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

/** Projection publique d'une commande (ce que voit un porteur du lien). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function publicView(id: string, data: Record<string, any>) {
  return {
    id,
    lieu: data.lieu ?? '',
    date: data.date?.toMillis?.() ?? null,
    participants: Array.isArray(data.participants) ? data.participants : [],
    lignes: Array.isArray(data.lignes) ? data.lignes : [],
    terminee: !!data.terminee,
    tourneeCourante: data.tourneeCourante ?? null,
  }
}
