import { NextResponse } from 'next/server'
import { findByToken, publicView } from '@/lib/commandeShare'

/** GET — la commande partagée (page publique /commande/[token]). Aucun compte requis. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const doc = await findByToken(token)
  if (!doc) return NextResponse.json({ status: 'invalid' }, { status: 404 })
  return NextResponse.json({ status: 'ok', commande: publicView(doc.id, doc.data()) })
}
