import { NextResponse } from 'next/server'
import { partiesDuJeton, publicGame, roundsDePartie } from '@/lib/beloteShare'

/**
 * GET — les parties ouvertes par un lien de partage (page publique
 * /belote-partie/[token]). Aucun compte requis.
 *
 * `?game=` choisit la partie dont on veut le détail des tours ; par défaut, celle
 * qui porte le jeton.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const lot = await partiesDuJeton(token)
  if (!lot) return NextResponse.json({ status: 'invalid' }, { status: 404 })

  const parties = lot.docs.map((d) => publicGame(d.id, d.data()))
  const demande = new URL(req.url).searchParams.get('game')
  const courante = parties.find((p) => p.id === demande) ?? publicGame(lot.porteuse.id, lot.porteuse.data())

  return NextResponse.json({
    status: 'ok',
    parties,
    gameId: courante.id,
    serieName: courante.serieName,
    rounds: (await roundsDePartie(courante.id)).map((r) => r.view),
  })
}
