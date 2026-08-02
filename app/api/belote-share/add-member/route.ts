import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webpush'
import { GAMES, displayName, uidFromIdToken } from '@/lib/beloteShare'

/**
 * POST — rattache DIRECTEMENT un compte existant à une partie (l'ajoute à ses
 * `members`), sans passer par un lien.
 *
 * ⚠️ RÉSERVÉ À L'ADMINISTRATEUR (`role_app === 'Admin'`), vérifié ICI, côté
 * serveur : le bloc caché dans l'interface n'est qu'un confort. Un compte
 * ordinaire partage par lien / QR ou par email.
 */
export async function POST(req: Request) {
  const { idToken, gameId, uid: targetUid } = await req.json() as
    { idToken?: string; gameId?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!gameId || !targetUid) return NextResponse.json({ error: 'Paramètres manquants.' }, { status: 400 })

  const db = getAdminDb()

  const meSnap = await db.collection('users').doc(uid).get()
  if (!meSnap.exists || meSnap.data()?.role_app !== 'Admin') {
    return NextResponse.json({ error: "Action réservée à l'administrateur." }, { status: 403 })
  }

  const ref = db.collection(GAMES).doc(gameId)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Partie introuvable.' }, { status: 404 })

  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })

  const d = snap.data()!
  const membres: string[] = d.members ?? []
  if (membres.includes(targetUid)) return NextResponse.json({ ok: true, dejaMembre: true })

  const auteur: string = d.createdBy ?? ''
  await ref.update({
    members: membres.length || !auteur
      ? FieldValue.arrayUnion(targetUid)
      : FieldValue.arrayUnion(auteur, targetUid),
  })

  // Prévenir : la partie apparaîtrait sinon dans son app sans explication.
  // Best-effort — une panne de notification n'annule pas le rattachement.
  try {
    const parQui = await displayName(uid)
    const titre = 'Belote'
    const texte = `${parQui} vous a partagé la partie « ${d.team1Name ?? ''} vs ${d.team2Name ?? ''} ».`
    await sendPushToUser(targetUid, { title: titre, body: texte, url: `/belote/${gameId}` })
    await db.collection('Notifications').add({
      refUsers: db.collection('users').doc(targetUid),
      type_notification: 'BELOTE_PARTAGE',
      notification: `${titre} — ${texte}`,
      etat_notification: 'Non lu',
      url: `/belote/${gameId}`,
      date_create: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('[belote-share/add-member] notification non envoyée :', e)
  }

  return NextResponse.json({ ok: true })
}
