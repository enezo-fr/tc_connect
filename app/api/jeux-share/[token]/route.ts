import { NextResponse } from 'next/server'
import { partiesDuJeton, publicPartie } from '@/lib/jeuxShare'

/**
 * GET — les parties ouvertes par un lien de partage (page publique
 * /jeu-partie/[token]). Aucun compte requis.
 *
 * Tout est renvoyé d'un coup : la partie porteuse du jeton ET les autres parties
 * de la soirée, dans l'ordre de jeu. Le classement se calcule côté navigateur
 * avec les mêmes fonctions que l'app (`lib/duoJeux.ts`), il n'y a donc jamais
 * deux résultats possibles pour un même score.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const lot = await partiesDuJeton(token)
  if (!lot) return NextResponse.json({ status: 'invalid' }, { status: 404 })

  const parties = lot.docs.map((d) => publicPartie(d.id, d.data()))
  const porteuse = publicPartie(lot.porteuse.id, lot.porteuse.data())

  return NextResponse.json({
    status: 'ok',
    parties,
    partieId: porteuse.id,
    soireeId: porteuse.soireeId,
    soireeName: porteuse.soireeName,
  })
}
