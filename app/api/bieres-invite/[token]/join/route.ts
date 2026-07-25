import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { BIERES_COUPLES, BIERES_INVITES, backfillMembers, uidFromIdToken } from '@/lib/bieresInvite'

/**
 * POST — accepte l'invitation : ajoute l'utilisateur au couple ET recopie les
 * deux UID dans les `members` des bières et les `membersDeg` des dégustations
 * (backfill). Admin SDK (le client ne peut pas modifier ces tableaux). Usage unique.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { idToken } = await req.json() as { idToken?: string }
  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  const db = getAdminDb()
  const inviteRef = db.collection(BIERES_INVITES).doc(token)
  const inviteSnap = await inviteRef.get()
  if (!inviteSnap.exists) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const inv = inviteSnap.data()!
  const coupleRef = db.collection(BIERES_COUPLES).doc(inv.coupleId)
  const coupleSnap = await coupleRef.get()
  if (!coupleSnap.exists) return NextResponse.json({ error: 'Couple introuvable.' }, { status: 404 })

  const members: string[] = coupleSnap.data()!.members ?? []

  if (members.includes(uid)) {
    return NextResponse.json({ ok: true, alreadyMember: true })
  }

  if (inv.usedAt) return NextResponse.json({ error: 'Ce lien a déjà été utilisé.' }, { status: 410 })
  if ((inv.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
    return NextResponse.json({ error: 'Ce lien a expiré. Demandez-en un nouveau.' }, { status: 410 })
  }

  const both = Array.from(new Set([...members, uid]))
  await coupleRef.update({ members: FieldValue.arrayUnion(uid) })
  await backfillMembers(both)
  await inviteRef.update({ usedAt: new Date(), usedBy: uid })

  return NextResponse.json({ ok: true, joined: true })
}
