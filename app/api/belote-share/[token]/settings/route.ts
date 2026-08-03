import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import {
  GAMES, partieDuJeton, potDePartie, publicGame, reglesValides, resyncPartie, roundsDePartie,
} from '@/lib/beloteShare'

/**
 * POST — modifie la fin de partie et les règles de table depuis le lien public.
 * Changer les règles relance le calcul de tous les tours déjà joués.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as
    { gameId?: string; endCondition?: string; endValue?: number; regles?: unknown }

  const partie = await partieDuJeton(token, body.gameId ?? '')
  if (!partie) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const endCondition = body.endCondition === 'rounds' ? 'rounds' : 'score'
  const endValue = Math.min(100000, Math.max(1, Math.floor(Number(body.endValue) || 1)))
  const regles = reglesValides(body.regles ?? partie.data().regles)

  await getAdminDb().collection(GAMES).doc(partie.id).update({ endCondition, endValue, regles })
  const fraiche = await resyncPartie(partie.id)
  const rounds = (await roundsDePartie(partie.id)).map((r) => r.view)

  return NextResponse.json({
    ok: true,
    partie: fraiche ? publicGame(partie.id, fraiche) : null,
    rounds,
    pot: potDePartie(rounds, regles),
  })
}
