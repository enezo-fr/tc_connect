import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { PARTIES, uidFromIdToken } from '@/lib/jeuxShare'

/**
 * POST — retire un accès à la partie.
 *
 * Autorisé à l'auteur, à l'administrateur, et à chacun pour SE retirer lui-même.
 * L'auteur ne peut pas être retiré : il perdrait sa propre partie.
 */
export async function POST(req: Request) {
  const { idToken, partieId, uid: targetUid } = await req.json() as
    { idToken?: string; partieId?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!partieId || !targetUid) return NextResponse.json({ error: 'Paramètres manquants.' }, { status: 400 })

  const db = getAdminDb()
  const ref = db.collection(PARTIES).doc(partieId)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Partie introuvable.' }, { status: 404 })

  const auteur = (snap.data()!.createdBy ?? '') as string
  if (targetUid === auteur) {
    return NextResponse.json({ error: "L'auteur de la partie ne peut pas être retiré." }, { status: 400 })
  }

  const estAdmin = (await db.collection('users').doc(uid).get()).data()?.role_app === 'Admin'
  if (uid !== auteur && uid !== targetUid && !estAdmin) {
    return NextResponse.json({ error: "Action réservée à l'auteur de la partie." }, { status: 403 })
  }

  await ref.update({ members: FieldValue.arrayRemove(targetUid) })
  return NextResponse.json({ ok: true })
}
