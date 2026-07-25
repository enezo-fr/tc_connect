import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'

// Les helpers d'auth/affichage sont identiques à l'app Bébé : on les réutilise tels quels.
export { genInviteToken, uidFromIdToken, displayName } from '@/lib/bebeInvite'

/**
 * Partage de l'app « Sarah & Ted » (À deux) entre les deux membres du couple.
 *
 * Contrairement à l'app Bébé, il n'y a PAS de document parent unique : les listes
 * (`duo_films`, `duo_activites`, `duo_parties`, `bar_commandes`) sont à plat et
 * chaque document porte son propre `members[]`. On introduit donc un document de
 * couplage `duo_couples` qui est la source de vérité des deux UID ; à l'écriture,
 * l'app y lit les membres pour les recopier dans `members[]`.
 *
 * Lier un second compte passe OBLIGATOIREMENT par l'Admin SDK (ces routes) :
 *  - les règles figent `members` en update côté client (jamais d'auto-ajout) ;
 *  - à l'acceptation, on recopie les deux UID dans TOUS les documents déjà créés
 *    (backfill), sinon l'invité ne verrait rien de l'historique.
 */

export const DUO_INVITES = 'duo_invites'
export const DUO_COUPLES = 'duo_couples'
/** Durée de validité d'un lien d'invitation. */
export const DUO_TTL_DAYS = 7
/** Listes partagées entre les deux membres — celles portant un `members[]`. */
export const DUO_COLLECTIONS = ['duo_films', 'duo_activites', 'duo_parties', 'bar_commandes']

/** Document de couplage auquel appartient `uid`, ou null s'il est encore seul. */
export async function findCouple(uid: string) {
  const snap = await getAdminDb()
    .collection(DUO_COUPLES)
    .where('members', 'array-contains', uid)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

/** Couple de `uid`, créé (avec le seul `uid`) s'il n'existe pas encore. */
export async function ensureCouple(uid: string) {
  const existing = await findCouple(uid)
  if (existing) return existing.ref
  const ref = getAdminDb().collection(DUO_COUPLES).doc()
  await ref.set({ members: [uid], createdBy: uid, createdAt: new Date() })
  return ref
}

/**
 * Recopie l'ensemble des membres dans `members[]` de tous les documents où
 * l'un OU l'autre figure déjà. `arrayUnion` est idempotent : on n'écrase rien.
 */
export async function backfillMembers(members: string[]): Promise<void> {
  const db = getAdminDb()
  for (const coll of DUO_COLLECTIONS) {
    const snap = await db.collection(coll).where('members', 'array-contains-any', members).get()
    if (snap.empty) continue
    let batch = db.batch()
    let n = 0
    for (const d of snap.docs) {
      batch.update(d.ref, { members: FieldValue.arrayUnion(...members) })
      if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0 }
    }
    if (n > 0) await batch.commit()
  }
}
