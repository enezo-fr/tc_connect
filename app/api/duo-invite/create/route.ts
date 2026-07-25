import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { DUO_INVITES, DUO_TTL_DAYS, displayName, ensureCouple, genInviteToken, uidFromIdToken } from '@/lib/duoInvite'

/** POST — génère un lien d'invitation pour lier l'autre membre au couple. */
export async function POST(req: Request) {
  const { idToken } = await req.json() as { idToken?: string }
  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  // On s'assure que l'utilisateur a bien un couple (créé avec lui seul si besoin).
  const coupleRef = await ensureCouple(uid)

  const token = genInviteToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DUO_TTL_DAYS * 24 * 60 * 60 * 1000)

  await getAdminDb().collection(DUO_INVITES).doc(token).set({
    coupleId: coupleRef.id,
    createdBy: uid,
    createdByName: await displayName(uid),
    createdAt: now,
    expiresAt,
  })

  return NextResponse.json({ token, expiresAt: expiresAt.getTime() })
}
