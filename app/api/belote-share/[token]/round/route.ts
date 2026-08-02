import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import {
  ROUNDS, calculateRoundScore, cleanRoundInput, partieDuJeton,
  publicGame, resyncPartie, roundsDePartie,
} from '@/lib/beloteShare'

/**
 * POST — ajoute / modifie / supprime un tour depuis le lien public (sans compte).
 *
 * C'est TOUT ce que le porteur du lien peut faire, avec les paramètres de fin de
 * partie : il ne crée aucune partie, n'en supprime aucune, et ne touche jamais à
 * `members`, `createdBy` ni `shareToken`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as Record<string, unknown>
  const gameId = typeof body.gameId === 'string' ? body.gameId : ''

  const partie = await partieDuJeton(token, gameId)
  if (!partie) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const db = getAdminDb()
  const action = body.action === 'update' || body.action === 'delete' ? body.action : 'add'
  const roundId = typeof body.roundId === 'string' ? body.roundId : ''

  if (action === 'delete') {
    if (!roundId) return NextResponse.json({ error: 'Tour manquant.' }, { status: 400 })
    const ref = db.collection(ROUNDS).doc(roundId)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.gameId !== gameId) {
      return NextResponse.json({ error: 'Tour introuvable.' }, { status: 404 })
    }
    await ref.delete()
    // Renumérotation : sans ça, « Tour 3 » resterait après suppression du tour 2.
    const restants = await roundsDePartie(gameId)
    await Promise.all(restants.map((r, i) =>
      r.view.roundNumber === i + 1 ? null : r.ref.update({ roundNumber: i + 1 }),
    ))
  } else {
    const { input, dealer, trumpTaker } = cleanRoundInput(body)
    if (!trumpTaker) return NextResponse.json({ error: "Sélectionnez le preneur d'atout." }, { status: 400 })

    const champs = {
      gameId,
      dealer,
      trumpTaker,
      teamTaker: input.teamTaker,
      rawScoreNous: input.rawScoreNous,
      rawScoreEux: input.rawScoreEux,
      capot: input.capot,
      capotTeam: input.capotTeam,
      dedans: input.dedans,
      beloteRebelote: input.beloteRebelote,
      beloteRebeloteTeam: input.beloteRebeloteTeam,
      finalScore: calculateRoundScore(input),
    }

    if (action === 'update') {
      if (!roundId) return NextResponse.json({ error: 'Tour manquant.' }, { status: 400 })
      const ref = db.collection(ROUNDS).doc(roundId)
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.gameId !== gameId) {
        return NextResponse.json({ error: 'Tour introuvable.' }, { status: 404 })
      }
      await ref.update(champs)
    } else {
      const dejaJoues = await roundsDePartie(gameId)
      await db.collection(ROUNDS).add({
        ...champs,
        roundNumber: dejaJoues.length + 1,
        createdAt: new Date(),
      })
    }
  }

  const fraiche = await resyncPartie(gameId)
  return NextResponse.json({
    ok: true,
    partie: fraiche ? publicGame(gameId, fraiche) : null,
    rounds: (await roundsDePartie(gameId)).map((r) => r.view),
  })
}
