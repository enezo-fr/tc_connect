import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { PARTIES, displayName, uidFromIdToken } from '@/lib/jeuxShare'

/**
 * POST — personnes ayant accès à la partie, avec leur nom lisible.
 * Réservé à qui a déjà accès : la liste des membres n'est pas publique.
 */
export async function POST(req: Request) {
  const { idToken, partieId } = await req.json() as { idToken?: string; partieId?: string }

  const uid = await uidFromIdToken(idToken)
  if (!uid) return NextResponse.json({ error: 'Session invalide.' }, { status: 401 })
  if (!partieId) return NextResponse.json({ error: 'Partie manquante.' }, { status: 400 })

  const db = getAdminDb()
  const snap = await db.collection(PARTIES).doc(partieId).get()
  if (!snap.exists) return NextResponse.json({ error: 'Partie introuvable.' }, { status: 404 })

  const d = snap.data()!
  const auteur = (d.createdBy ?? '') as string
  const membres = (d.members ?? []) as string[]

  const moiAdmin = (await db.collection('users').doc(uid).get()).data()?.role_app === 'Admin'
  if (uid !== auteur && !membres.includes(uid) && !moiAdmin) {
    return NextResponse.json({ error: "Vous n'avez pas accès à cette partie." }, { status: 403 })
  }

  // L'auteur figure toujours en tête, même s'il a disparu de `members`.
  const uids = Array.from(new Set([auteur, ...membres].filter(Boolean)))
  const members = await Promise.all(uids.map(async (m) => ({
    uid: m,
    name: await displayName(m),
    isCreator: m === auteur,
  })))

  return NextResponse.json({ members, estAuteur: uid === auteur, estAdmin: moiAdmin })
}
