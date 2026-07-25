import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { BIERES_COUPLES, BIERES_INVITES, uidFromIdToken } from '@/lib/bieresInvite'

/** POST — annule un lien d'invitation (réservé aux membres du couple concerné). */
export async function POST(req: Request) {
  const { idToken, token } = await req.json() as { idToken?: string; token?: string }
  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!token) return NextResponse.json({ error: 'Lien manquant.' }, { status: 400 })

  const db = getAdminDb()
  const ref = db.collection(BIERES_INVITES).doc(token)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ ok: true })

  const inv = snap.data()!
  const coupleSnap = await db.collection(BIERES_COUPLES).doc(inv.coupleId).get()
  const members: string[] = coupleSnap.exists ? (coupleSnap.data()!.members ?? []) : []
  if (!members.includes(uid)) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  await ref.delete()
  return NextResponse.json({ ok: true })
}
