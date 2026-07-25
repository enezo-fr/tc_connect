import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { BIERES_INVITES, BIERES_TTL_DAYS, displayName, ensureCouple, genInviteToken, uidFromIdToken } from '@/lib/bieresInvite'

/** POST — génère un lien d'invitation pour partager le catalogue de bières. */
export async function POST(req: Request) {
  const { idToken } = await req.json() as { idToken?: string }
  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  const coupleRef = await ensureCouple(uid)

  const token = genInviteToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + BIERES_TTL_DAYS * 24 * 60 * 60 * 1000)

  await getAdminDb().collection(BIERES_INVITES).doc(token).set({
    coupleId: coupleRef.id,
    createdBy: uid,
    createdByName: await displayName(uid),
    createdAt: now,
    expiresAt,
  })

  return NextResponse.json({ token, expiresAt: expiresAt.getTime() })
}
