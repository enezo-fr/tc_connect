import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import {
  PARTIES, ordreValide, partieDuJeton, partiesDuJeton, publicPartie, tourValide,
} from '@/lib/jeuxShare'
import type { DuoTour } from '@/types'

/**
 * POST — saisie depuis le lien public (sans compte) : ajouter, corriger ou
 * supprimer un tour, ou fixer l'ordre d'arrivée d'une partie sans points.
 *
 * C'est TOUT ce que le porteur du lien peut faire, avec l'état de la partie
 * (`etat/route.ts`) : il ne crée aucune partie, n'en supprime aucune, ne touche
 * ni à `members`, ni à `createdBy`, ni à `shareToken`.
 *
 * Les tours vivent dans le document de la partie : on relit, on modifie le
 * tableau, on réécrit. Deux appareils qui saisissent exactement en même temps
 * peuvent donc se croiser — le rafraîchissement de la page publique rattrape,
 * et c'est déjà le fonctionnement de l'app elle-même.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as Record<string, unknown>
  const partieId = typeof body.partieId === 'string' ? body.partieId : ''

  const doc = await partieDuJeton(token, partieId)
  if (!doc) return NextResponse.json({ error: 'Lien invalide.' }, { status: 404 })

  const d = doc.data()
  const joueurs = (Array.isArray(d.joueurs) ? d.joueurs : [])
    .filter((j: unknown): j is string => typeof j === 'string')
  const tours: DuoTour[] = Array.isArray(d.tours) ? d.tours : []

  const action = body.action
  const index = Number.isInteger(body.index) ? Number(body.index) : -1

  let patch: Record<string, unknown>

  if (action === 'ordre') {
    patch = { ordre: ordreValide(body.ordre, joueurs) }
  } else if (action === 'delete') {
    if (index < 0 || index >= tours.length) {
      return NextResponse.json({ error: 'Tour introuvable.' }, { status: 404 })
    }
    patch = { tours: tours.filter((_, i) => i !== index) }
  } else if (action === 'update') {
    if (index < 0 || index >= tours.length) {
      return NextResponse.json({ error: 'Tour introuvable.' }, { status: 404 })
    }
    const tour = tourValide(body, joueurs)
    patch = { tours: tours.map((t, i) => (i === index ? tour : t)) }
  } else {
    if (joueurs.length === 0) {
      return NextResponse.json({ error: 'Cette partie n’a aucun joueur.' }, { status: 400 })
    }
    patch = { tours: [...tours, tourValide(body, joueurs)] }
  }

  await getAdminDb().collection(PARTIES).doc(partieId).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  })

  // On renvoie TOUTES les parties du jeton : le classement de la soirée bouge
  // dès qu'un score change, l'appareil doit le voir sans second appel.
  const lot = await partiesDuJeton(token)
  return NextResponse.json({
    ok: true,
    parties: (lot?.docs ?? []).map((p) => publicPartie(p.id, p.data())),
  })
}
