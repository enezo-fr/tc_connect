import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webpush'
import { displayName, uidFromIdToken } from '@/lib/commandeShare'

/**
 * POST — rattache DIRECTEMENT un compte à UNE commande (l'ajoute à ses `members`).
 * ⚠️ RÉSERVÉ À L'ADMINISTRATEUR (`role_app === 'Admin'`), vérifié côté serveur.
 */
export async function POST(req: Request) {
  const { idToken, commandeId, uid: targetUid } = await req.json() as
    { idToken?: string; commandeId?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!commandeId || !targetUid) return NextResponse.json({ error: 'Paramètres manquants.' }, { status: 400 })

  const db = getAdminDb()

  const meSnap = await db.collection('users').doc(uid).get()
  if (!meSnap.exists || meSnap.data()?.role_app !== 'Admin') {
    return NextResponse.json({ error: 'Action réservée à l\'administrateur.' }, { status: 403 })
  }

  const cmdRef = db.collection('bar_commandes').doc(commandeId)
  const cmdSnap = await cmdRef.get()
  if (!cmdSnap.exists) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 })

  const members: string[] = cmdSnap.data()!.members ?? []
  if (!members.includes(uid)) {
    return NextResponse.json({ error: 'Vous n\'avez pas accès à cette commande.' }, { status: 403 })
  }

  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })

  if (members.includes(targetUid)) return NextResponse.json({ ok: true, dejaMembre: true })

  await cmdRef.update({ members: FieldValue.arrayUnion(targetUid) })

  try {
    const parQui = await displayName(uid)
    const lieu = cmdSnap.data()!.lieu || 'une tournée'
    const title = 'Commandes'
    const body = `${parQui} vous a partagé la commande « ${lieu} ».`
    await sendPushToUser(targetUid, { title, body, url: '/commandes' })
    await db.collection('Notifications').add({
      refUsers: db.collection('users').doc(targetUid),
      type_notification: 'COMMANDE_PARTAGE',
      notification: `${title} — ${body}`,
      etat_notification: 'Non lu',
      url: '/commandes',
      date_create: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('[commande-share/add-member] notification non envoyée :', e)
  }

  return NextResponse.json({ ok: true })
}
