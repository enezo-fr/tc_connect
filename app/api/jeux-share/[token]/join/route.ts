import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { partiesDuJeton, uidFromIdToken } from '@/lib/jeuxShare'

/**
 * POST — le porteur du lien a un compte et veut rattacher la partie au sien.
 *
 * Il rejoint TOUTE la soirée, pour ne pas devoir cliquer partie par partie quand
 * on en a enchaîné cinq. Passe par l'Admin SDK : les règles de `duo_parties`
 * figent `members`, personne ne peut s'y ajouter depuis le navigateur.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { idToken } = await req.json() as { idToken?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })

  const lot = await partiesDuJeton(token)
  if (!lot) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const dejaMembre = ((lot.porteuse.data().members ?? []) as string[]).includes(uid)

  await Promise.all(lot.docs.map(async (d) => {
    const membres = (d.data().members ?? []) as string[]
    if (membres.includes(uid)) return
    await d.ref.update({ members: FieldValue.arrayUnion(uid) })
  }))

  return NextResponse.json({ ok: true, partieId: lot.porteuse.id, parties: lot.docs.length, dejaMembre })
}
