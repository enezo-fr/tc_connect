import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { DUO_INVITES, displayName, findCouple, uidFromIdToken } from '@/lib/duoInvite'

/** POST — membres du couple + liens d'invitation en attente (modale de partage). */
export async function POST(req: Request) {
  const { idToken } = await req.json() as { idToken?: string }
  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  const db = getAdminDb()
  const couple = await findCouple(uid)
  const memberUids: string[] = couple ? (couple.data().members ?? [uid]) : [uid]
  const createdBy: string = couple ? couple.data().createdBy : uid

  const members = await Promise.all(memberUids.map(async (m) => ({
    uid: m,
    name: await displayName(m),
    isCreator: m === createdBy,
  })))

  // Liens en attente du couple — filtrés en mémoire pour éviter un index composite.
  let invites: { token: string; expiresAt: number }[] = []
  if (couple) {
    const invSnap = await db.collection(DUO_INVITES).where('coupleId', '==', couple.id).get()
    invites = invSnap.docs
      .map((d) => ({ token: d.id, data: d.data() as Record<string, any> }))
      .filter(({ data }) => !data.usedAt && (data.expiresAt?.toMillis?.() ?? 0) > Date.now())
      .map(({ token, data }) => ({ token, expiresAt: data.expiresAt?.toMillis?.() ?? 0 }))
  }

  return NextResponse.json({ members, invites, isCreator: createdBy === uid })
}
