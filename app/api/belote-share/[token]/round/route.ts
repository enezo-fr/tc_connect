import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import {
  ROUNDS, cleanRoundInput, partieDuJeton, potDePartie,
  publicGame, reglesValides, resyncPartie, roundsDePartie,
} from '@/lib/beloteShare'

/**
 * POST — ajoute / modifie / supprime un tour depuis le lien public (sans compte).
 *
 * C'est TOUT ce que le porteur du lien peut faire, avec les paramètres de fin de
 * partie : il ne crée aucune partie, n'en supprime aucune, et ne touche jamais à
 * `members`, `createdBy` ni `shareToken`.
 *
 * Le verdict du tour (contrat tenu, dedans, litige) n'est jamais pris tel quel :
 * `resyncPartie` recalcule toute la partie d'après les règles enregistrées.
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
      beloteRebelote: input.beloteRebelote,
      beloteRebeloteTeam: input.beloteRebeloteTeam,
    }

    if (action === 'update') {
      if (!roundId) return NextResponse.json({ error: 'Tour manquant.' }, { status: 400 })
      const ref = db.collection(ROUNDS).doc(roundId)
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.gameId !== gameId) {
        return NextResponse.json({ error: 'Tour introuvable.' }, { status: 404 })
      }
      // Repasser en automatique doit EFFACER le champ, pas le laisser en place.
      await ref.update({
        ...champs,
        dedansForce: input.dedansForce ?? FieldValue.delete(),
      })
    } else {
      const dejaJoues = await roundsDePartie(gameId)
      await db.collection(ROUNDS).add({
        ...champs,
        ...(typeof input.dedansForce === 'boolean' ? { dedansForce: input.dedansForce } : {}),
        roundNumber: dejaJoues.length + 1,
        // Valeurs provisoires : `resyncPartie` tranche juste après, séquence complète.
        finalScore: { team1: 0, team2: 0 },
        dedans: false,
        litige: false,
        potRecu: 0,
        createdAt: new Date(),
      })
    }
  }

  // Recalcule verdicts, reports de litige, renumérotation et cumul.
  const fraiche = await resyncPartie(gameId)
  const rounds = (await roundsDePartie(gameId)).map((r) => r.view)

  return NextResponse.json({
    ok: true,
    partie: fraiche ? publicGame(gameId, fraiche) : null,
    rounds,
    pot: potDePartie(rounds, reglesValides(fraiche?.regles)),
  })
}
