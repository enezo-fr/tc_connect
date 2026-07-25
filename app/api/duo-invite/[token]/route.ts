import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { DUO_INVITES } from '@/lib/duoInvite'

/**
 * GET — aperçu ANONYME d'une invitation (page /duo-invitation/[token]).
 * N'expose que le nom de l'inviteur : aucune donnée du couple n'est accessible
 * sans compte lié.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const snap = await getAdminDb().collection(DUO_INVITES).doc(token).get()
  if (!snap.exists) return NextResponse.json({ status: 'invalid' }, { status: 404 })

  const inv = snap.data()!
  const status = inv.usedAt ? 'used'
    : (inv.expiresAt?.toMillis?.() ?? 0) < Date.now() ? 'expired'
    : 'ok'

  return NextResponse.json({ status, inviterName: inv.createdByName ?? '' })
}
