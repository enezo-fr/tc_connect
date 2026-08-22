import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webpush'
import { PARTIES, displayName, uidFromIdToken } from '@/lib/jeuxShare'

/**
 * POST — rattache DIRECTEMENT un compte existant à une partie (l'ajoute à ses
 * `members`), sans passer par un lien.
 *
 * ⚠️ RÉSERVÉ À L'ADMINISTRATEUR (`role_app === 'Admin'`), vérifié ICI, côté
 * serveur : le bloc caché dans l'interface n'est qu'un confort. Un compte
 * ordinaire partage par lien / QR ou par email.
 */
export async function POST(req: Request) {
  const { idToken, partieId, uid: targetUid } = await req.json() as
    { idToken?: string; partieId?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!partieId || !targetUid) return NextResponse.json({ error: 'Paramètres manquants.' }, { status: 400 })

  const db = getAdminDb()

  const meSnap = await db.collection('users').doc(uid).get()
  if (!meSnap.exists || meSnap.data()?.role_app !== 'Admin') {
    return NextResponse.json({ error: "Action réservée à l'administrateur." }, { status: 403 })
  }

  const ref = db.collection(PARTIES).doc(partieId)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Partie introuvable.' }, { status: 404 })

  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })

  const d = snap.data()!
  const membres = (d.members ?? []) as string[]
  if (membres.includes(targetUid)) return NextResponse.json({ ok: true, dejaMembre: true })

  await ref.update({ members: FieldValue.arrayUnion(targetUid) })

  // Prévenir : la partie apparaîtrait sinon dans son app sans explication.
  // Best-effort — une panne de notification n'annule pas le rattachement.
  try {
    const parQui = await displayName(uid)
    const url = `/sarah-et-ted/jeux/${partieId}`
    const texte = `${parQui} vous a partagé la partie « ${d.jeu ?? 'Jeu'} ».`
    await sendPushToUser(targetUid, { title: 'Jeux', body: texte, url })
    await db.collection('Notifications').add({
      refUsers: db.collection('users').doc(targetUid),
      type_notification: 'JEUX_PARTAGE',
      notification: `Jeux — ${texte}`,
      etat_notification: 'Non lu',
      url,
      date_create: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('[jeux-share/add-member] notification non envoyée :', e)
  }

  return NextResponse.json({ ok: true })
}
