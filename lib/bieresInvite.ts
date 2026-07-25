import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'

// Helpers d'auth/affichage communs — identiques à l'app Bébé.
export { genInviteToken, uidFromIdToken, displayName } from '@/lib/bebeInvite'

/**
 * Partage de la « Bible de la bière » (`/bieres`) entre deux comptes.
 *
 * Même modèle que Sarah & Ted : un doc de couplage `bieres_couples` tient les
 * deux UID, recopiés dans `bieres.members[]` à l'écriture. Particularité bières :
 * chaque bière a une sous-collection `degustations` dont chaque doc porte son
 * propre `membersDeg[]` (recopié depuis la bière à la création, donc FIGÉ). Le
 * backfill doit donc mettre à jour les DEUX niveaux — cf. `rattacher-sarah-bieres.mjs`.
 */

export const BIERES_INVITES = 'bieres_invites'
export const BIERES_COUPLES = 'bieres_couples'
export const BIERES_TTL_DAYS = 7

/** Doc de couplage auquel appartient `uid`, ou null. */
export async function findCouple(uid: string) {
  const snap = await getAdminDb()
    .collection(BIERES_COUPLES)
    .where('members', 'array-contains', uid)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

/** Couple de `uid`, créé (avec le seul `uid`) s'il n'existe pas encore. */
export async function ensureCouple(uid: string) {
  const existing = await findCouple(uid)
  if (existing) return existing.ref
  const ref = getAdminDb().collection(BIERES_COUPLES).doc()
  await ref.set({ members: [uid], createdBy: uid, createdAt: new Date() })
  return ref
}

/** Applique `arrayUnion(members)` par lots sur un ensemble de docs. */
async function unionMembers(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  field: 'members' | 'membersDeg',
  members: string[],
) {
  const db = getAdminDb()
  let batch = db.batch()
  let n = 0
  for (const d of docs) {
    batch.update(d.ref, { [field]: FieldValue.arrayUnion(...members) })
    if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0 }
  }
  if (n > 0) await batch.commit()
}

/**
 * Recopie tous les membres dans `bieres.members` ET dans `degustations.membersDeg`
 * de tous les docs où l'un des UID figure déjà. `arrayUnion` = idempotent.
 */
export async function backfillMembers(members: string[]): Promise<void> {
  const db = getAdminDb()

  // 1. Les bières (doc parent).
  const bieres = await db.collection('bieres').where('members', 'array-contains-any', members).get()
  await unionMembers(bieres.docs, 'members', members)

  // 2. Les dégustations (sous-collection) — via collectionGroup, `membersDeg` figé
  //    à la création est ce qui conditionne leur lecture par la requête de groupe.
  const degs = await db.collectionGroup('degustations').where('membersDeg', 'array-contains-any', members).get()
  await unionMembers(degs.docs, 'membersDeg', members)
}
