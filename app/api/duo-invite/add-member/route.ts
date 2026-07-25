import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webpush'
import { backfillMembers, displayName, ensureCouple, uidFromIdToken } from '@/lib/duoInvite'

/**
 * POST — rattache DIRECTEMENT un compte existant au couple « Sarah & Ted » du
 * demandeur, sans lien d'invitation.
 *
 * ⚠️ RÉSERVÉ À L'ADMINISTRATEUR (`users/{uid}.role_app === 'Admin'`), vérifié ICI,
 * côté serveur : le contrôle affiché dans l'interface n'est qu'un confort. Un
 * compte ordinaire n'a que le lien d'invitation (`/api/duo-invite/create`).
 */
export async function POST(req: Request) {
  const { idToken, uid: targetUid } = await req.json() as { idToken?: string; uid?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!targetUid) return NextResponse.json({ error: 'Compte manquant.' }, { status: 400 })

  const db = getAdminDb()

  // 1. Le demandeur est-il administrateur ?
  const meSnap = await db.collection('users').doc(uid).get()
  if (!meSnap.exists || meSnap.data()?.role_app !== 'Admin') {
    return NextResponse.json({ error: 'Action réservée à l\'administrateur.' }, { status: 403 })
  }

  // 2. Le compte visé existe-t-il vraiment ? (un UID inventé créerait un membre fantôme)
  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })

  // 3. Couple du demandeur (créé avec lui seul si besoin).
  const coupleRef = await ensureCouple(uid)
  const members: string[] = (await coupleRef.get()).data()?.members ?? [uid]

  if (members.includes(targetUid)) {
    return NextResponse.json({ ok: true, dejaMembre: true })
  }

  const both = Array.from(new Set([...members, targetUid]))
  await coupleRef.update({ members: FieldValue.arrayUnion(targetUid) })
  await backfillMembers(both)

  // 4. Prévenir la personne : elle n'a rien cliqué, sinon l'app apparaîtrait sans explication.
  //    Best-effort : une panne de notification ne doit jamais annuler le rattachement.
  try {
    const parQui = await displayName(uid)
    const title = 'Sarah & Ted'
    const body = `${parQui} vous a ajouté : vous partagez désormais films, activités et scores.`
    await sendPushToUser(targetUid, { title, body, url: '/sarah-et-ted' })
    await db.collection('Notifications').add({
      refUsers: db.collection('users').doc(targetUid),
      type_notification: 'DUO_PARTAGE',
      notification: `${title} — ${body}`,
      etat_notification: 'Non lu',
      url: '/sarah-et-ted',
      date_create: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('[duo-invite/add-member] notification non envoyée :', e)
  }

  return NextResponse.json({ ok: true })
}
