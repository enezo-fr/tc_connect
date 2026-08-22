'use client'

import { doc, updateDoc, deleteField, arrayUnion, arrayRemove, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { BaremeSoiree } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/**
 * Écritures Firestore du module Jeux (« Sarah & Ted »).
 *
 * ⚠️ Ne JAMAIS envoyer `members` ni `createdBy` dans une mise à jour : les règles
 * de `duo_parties` exigent qu'ils soient inchangés, et le partage à un compte
 * passe par l'Admin SDK (routes `/api/jeux-share`). Un `updateDoc` partiel
 * laisse ces champs tels quels — c'est exactement ce qu'on veut.
 */

const PARTIES = 'duo_parties'
const refPartie = (id: string) => doc(db, PARTIES, id)

// ─── Dates de formulaire ────────────────────────────────────────────────────────

/** `Date` → valeur d'un `<input type="date">`. */
export const versChampDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Valeur d'un `<input type="date">` → `Timestamp`, calé à midi : à minuit, un
 * décalage de fuseau fait basculer la date d'un jour.
 */
export const depuisChampDate = (s: string): Timestamp | undefined => {
  if (!s) return undefined
  const [y, m, j] = s.split('-').map(Number)
  return Timestamp.fromDate(new Date(y, m - 1, j, 12))
}

const majPartie = (id: string, data: Record<string, unknown>) =>
  updateDoc(refPartie(id), { ...data, updatedAt: Timestamp.now() })

// ─── Partage par lien / QR ──────────────────────────────────────────────────────

/** Jeton de lien public (32 caractères, imprévisible). */
export const genShareToken = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** Active le lien public + QR (aucun compte requis pour l'ouvrir). */
export const activerPartageLien = async (partieId: string): Promise<string> => {
  const token = genShareToken()
  await majPartie(partieId, { shareToken: token })
  return token
}

/** Coupe le lien public : les appareils sans compte perdent l'accès. */
export const couperPartageLien = (partieId: string) =>
  updateDoc(refPartie(partieId), { shareToken: deleteField(), updatedAt: Timestamp.now() })

/** Mémorise une adresse à qui le lien a été envoyé (affichage seul, aucun droit). */
export const noterEmailPartage = (partieId: string, email: string) =>
  majPartie(partieId, { sharedEmails: arrayUnion(email.trim().toLowerCase()) })

export const retirerEmailPartage = (partieId: string, email: string) =>
  majPartie(partieId, { sharedEmails: arrayRemove(email) })

// ─── Soirées (parties liées) ────────────────────────────────────────────────────

/** Rattache une partie à une soirée. */
export const lierPartieASoiree = (
  partieId: string,
  soireeId: string,
  soireeName: string,
  soireeBareme?: BaremeSoiree,
) => majPartie(partieId, {
  soireeId,
  soireeName,
  ...(soireeBareme ? { soireeBareme } : {}),
})

/** Détache une partie de sa soirée (elle garde ses propres scores). */
export const delierPartie = (partieId: string) =>
  majPartie(partieId, { soireeId: null, soireeName: null })

/**
 * Renomme une soirée : le nom vit sur CHAQUE partie liée, il faut donc les
 * réécrire toutes. On saute celles qui portent déjà le bon nom.
 */
export const renommerSoiree = (parties: DuoPartie[], nom: string) =>
  Promise.all(parties
    .filter((p) => p.soireeName !== nom)
    .map((p) => majPartie(p.id, { soireeName: nom })))

/** Change le barème de classement d'une soirée (même mécanique que le nom). */
export const changerBaremeSoiree = (parties: DuoPartie[], bareme: BaremeSoiree) =>
  Promise.all(parties
    .filter((p) => p.soireeBareme !== bareme)
    .map((p) => majPartie(p.id, { soireeBareme: bareme })))
