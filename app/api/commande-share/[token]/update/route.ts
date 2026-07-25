import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { findByToken, publicView } from '@/lib/commandeShare'

/**
 * POST — modifie la commande depuis le lien public (sans compte).
 * On n'accepte QUE `lignes` et `participants`, nettoyés : le porteur du lien ne
 * peut ni s'attribuer le doc, ni toucher aux membres, ni le supprimer.
 */
const MAX_LIGNES = 300
const MAX_PART = 40
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanLignes(input: any): any[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, MAX_LIGNES).map((l) => {
    const out: Record<string, unknown> = {
      id: str(l?.id, 60) || `${Date.now().toString(36)}-${Math.round((l?.quantite ?? 0))}`,
      boisson: str(l?.boisson),
      quantite: Math.min(999, Math.max(1, Math.floor(Number(l?.quantite) || 1))),
    }
    if (l?.prix != null && Number.isFinite(Number(l.prix))) out.prix = Math.max(0, Number(l.prix))
    if (typeof l?.pour === 'string' && l.pour.trim()) out.pour = str(l.pour, 60)
    if (l?.servie === true) out.servie = true
    return out
  }).filter((l) => (l.boisson as string).trim().length > 0)
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const doc = await findByToken(token)
  if (!doc) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const body = await req.json() as { lignes?: unknown; participants?: unknown }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.lignes !== undefined) patch.lignes = cleanLignes(body.lignes)
  if (body.participants !== undefined) {
    patch.participants = Array.isArray(body.participants)
      ? Array.from(new Set(body.participants.map((p) => str(p, 40).trim()).filter(Boolean))).slice(0, MAX_PART)
      : []
  }

  await getAdminDb().collection('bar_commandes').doc(doc.id).update(patch)
  const fresh = await getAdminDb().collection('bar_commandes').doc(doc.id).get()
  return NextResponse.json({ ok: true, commande: publicView(fresh.id, fresh.data()!) })
}
