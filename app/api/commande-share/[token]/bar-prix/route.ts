import { NextResponse } from 'next/server'
import { findByToken } from '@/lib/commandeShare'
import { cellKey } from '@/lib/barPrixCore'
import { chargerBarProcheAdmin, enregistrerPrixAdmin } from '@/lib/barPrixAdmin'

/** GET — prix connus du bar de cette commande (pour pré-remplir la page publique). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const doc = await findByToken(token)
  if (!doc) return NextResponse.json({ prix: {} }, { status: 404 })
  const d = doc.data()!
  if (d.barEphemere || typeof d.lat !== 'number' || typeof d.lng !== 'number') {
    return NextResponse.json({ prix: {} })
  }
  const bar = await chargerBarProcheAdmin({ lat: d.lat, lng: d.lng })
  return NextResponse.json({ prix: bar?.prix ?? {} })
}

/** POST — enregistre un prix pour le bar de cette commande (catalogue partagé + histo). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const doc = await findByToken(token)
  if (!doc) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })
  const d = doc.data()!

  const { boisson, prix } = await req.json() as { boisson?: string; prix?: number }
  if (!boisson || typeof prix !== 'number' || !Number.isFinite(prix)) {
    return NextResponse.json({ ok: false })
  }
  // Bar éphémère ou sans position → on ne mémorise rien.
  if (d.barEphemere || typeof d.lat !== 'number' || typeof d.lng !== 'number') {
    return NextResponse.json({ ok: true, skipped: true })
  }
  const cell = d.barCell || cellKey(d.lat, d.lng)
  await enregistrerPrixAdmin({ cell, pos: { lat: d.lat, lng: d.lng }, nom: d.lieu, boisson, prix: Math.max(0, prix) })
  return NextResponse.json({ ok: true })
}
