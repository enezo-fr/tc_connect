import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { GAMES, partieDuJeton, publicGame, resyncPartie } from '@/lib/beloteShare'

/** POST — modifie la fin de partie (score cible / nombre de tours) depuis le lien public. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as { gameId?: string; endCondition?: string; endValue?: number }

  const partie = await partieDuJeton(token, body.gameId ?? '')
  if (!partie) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const endCondition = body.endCondition === 'rounds' ? 'rounds' : 'score'
  const endValue = Math.min(100000, Math.max(1, Math.floor(Number(body.endValue) || 1)))

  await getAdminDb().collection(GAMES).doc(partie.id).update({ endCondition, endValue })
  const fraiche = await resyncPartie(partie.id)

  return NextResponse.json({ ok: true, partie: fraiche ? publicGame(partie.id, fraiche) : null })
}
