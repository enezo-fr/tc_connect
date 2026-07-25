import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webpush'
import { backfillMembers, displayName, ensureCouple, uidFromIdToken } from '@/lib/bieresInvite'

/**
 * POST — rattache DIRECTEMENT un compte au catalogue du demandeur, sans lien.
 * ⚠️ RÉSERVÉ À L'ADMINISTRATEUR (`role_app === 'Admin'`), vérifié côté serveur.
 */
export async function POST(req: Request) {
  const { idToken, uid: targetUid } = await req.json() as { idToken?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!targetUid) return NextResponse.json({ error: 'Compte manquant.' }, { status: 400 })

  const db = getAdminDb()

  const meSnap = await db.collection('users').doc(uid).get()
  if (!meSnap.exists || meSnap.data()?.role_app !== 'Admin') {
    return NextResponse.json({ error: 'Action réservée à l\'administrateur.' }, { status: 403 })
  }

  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })

  const coupleRef = await ensureCouple(uid)
  const members: string[] = (await coupleRef.get()).data()?.members ?? [uid]

  if (members.includes(targetUid)) {
    return NextResponse.json({ ok: true, dejaMembre: true })
  }

  const both = Array.from(new Set([...members, targetUid]))
  await coupleRef.update({ members: FieldValue.arrayUnion(targetUid) })
  await backfillMembers(both)

  try {
    const parQui = await displayName(uid)
    const title = 'Bible de la bière'
    const body = `${parQui} vous a ajouté : vous partagez désormais le catalogue de bières.`
    await sendPushToUser(targetUid, { title, body, url: '/bieres' })
    await db.collection('Notifications').add({
      refUsers: db.collection('users').doc(targetUid),
      type_notification: 'BIERES_PARTAGE',
      notification: `${title} — ${body}`,
      etat_notification: 'Non lu',
      url: '/bieres',
      date_create: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('[bieres-invite/add-member] notification non envoyée :', e)
  }

  return NextResponse.json({ ok: true })
}
