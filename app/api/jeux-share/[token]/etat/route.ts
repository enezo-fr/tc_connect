import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { PARTIES, nombre, partieDuJeton, partiesDuJeton, publicPartie } from '@/lib/jeuxShare'

/**
 * POST — depuis le lien public : terminer / rouvrir une partie, et régler son
 * score cible. Volontairement limité à ça : le jeu, les joueurs et le sens du
 * classement restent la main du propriétaire, sinon un lien qui traîne pourrait
 * dénaturer une partie déjà jouée.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as { partieId?: string; termine?: unknown; objectif?: unknown }

  const doc = await partieDuJeton(token, body.partieId ?? '')
  if (!doc) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (typeof body.termine === 'boolean') patch.termine = body.termine
  if (body.objectif !== undefined) {
    const cible = nombre(body.objectif)
    patch.objectif = cible > 0 ? cible : null
  }

  await getAdminDb().collection(PARTIES).doc(doc.id).update(patch)

  const lot = await partiesDuJeton(token)
  return NextResponse.json({
    ok: true,
    parties: (lot?.docs ?? []).map((p) => publicPartie(p.id, p.data())),
  })
}
