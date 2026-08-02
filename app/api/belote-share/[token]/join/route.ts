import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { partiesDuJeton, uidFromIdToken } from '@/lib/beloteShare'

/**
 * POST — le porteur du lien a un compte et veut rattacher la partie au sien.
 *
 * Il rejoint TOUTE la série, pour ne pas devoir cliquer partie par partie sur une
 * revanche. Passe par l'Admin SDK : les règles interdisent à un non-membre de
 * s'ajouter lui-même dans `members`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { idToken } = await req.json() as { idToken?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  const lot = await partiesDuJeton(token)
  if (!lot) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const dejaMembre = (lot.porteuse.data().members ?? []).includes(uid)

  await Promise.all(lot.docs.map(async (d) => {
    const membres: string[] = d.data().members ?? []
    const auteur: string = d.data().createdBy ?? ''
    if (membres.includes(uid)) return
    // Une partie ancienne n'a pas de `members` : on y remet aussi son auteur,
    // sinon il perdrait l'accès à sa propre partie.
    await d.ref.update({
      members: membres.length || !auteur
        ? FieldValue.arrayUnion(uid)
        : FieldValue.arrayUnion(auteur, uid),
    })
  }))

  return NextResponse.json({ ok: true, gameId: lot.porteuse.id, parties: lot.docs.length, dejaMembre })
}
