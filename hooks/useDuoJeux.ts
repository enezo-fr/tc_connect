'use client'

import { useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useDuoParties } from '@/hooks/useDuo'
import { useDuoCouple } from '@/hooks/useDuoCouple'
import { secondesPartie } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/**
 * Tout ce dont les écrans « Jeux » ont besoin, au même endroit : les parties
 * visibles, le couple (pour recopier `members` à la création) et les droits.
 *
 * Une partie est visible dès que l'UID est dans `members` : celles du couple, et
 * celles qu'un tiers a partagées avec son compte (ajout par l'Admin SDK, cf.
 * `/api/jeux-share`). Ces dernières donnent droit à l'app SANS abonnement — le
 * partage est inclus dans celui de la personne qui invite, comme en belote.
 */
export function useDuoJeux() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const parties = useDuoParties(uid)
  const couple = useDuoCouple(uid)

  const items = useMemo(
    () => (parties.items as DuoPartie[]).slice().sort((a, b) => secondesPartie(b) - secondesPartie(a)),
    [parties.items],
  )

  /** Parties reçues d'un tiers (hors couple) — celles qui ouvrent l'accès gratuit. */
  const partagees = useMemo(
    () => items.filter((p) => p.createdBy && !couple.members.includes(p.createdBy)),
    [items, couple.members],
  )

  // Compte INVITÉ (lié à un couple qu'il n'a pas créé) → accès gratuit lui aussi.
  // On laisse passer pendant le chargement, sinon l'invité voit brièvement
  // « Accès non activé » avant l'arrivée du couple.
  const invite = !!uid && !!couple.createdBy && couple.createdBy !== uid
  const bypass = invite || couple.loading || partagees.length > 0

  return {
    uid,
    items,
    loading: parties.loading,
    ajouter: parties.ajouter,
    modifier: parties.modifier,
    supprimer: parties.supprimer,
    /**
     * Champs de partage à recopier sur toute NOUVELLE partie.
     *
     * ⚠️ L'UID est forcé dans `members` : tant que le couple n'est pas chargé,
     * la liste est vide, et la règle Firestore (`uid in members`) refuserait la
     * création. `pret` évite en plus de créer une partie que le conjoint ne
     * verrait pas, faute d'avoir eu le second UID à temps.
     */
    base: uid
      ? { members: couple.members.includes(uid) ? couple.members : [...couple.members, uid], createdBy: uid }
      : null,
    /** `false` tant que le couple n'est pas connu : ne pas créer de partie avant. */
    pret: !!uid && !couple.loading,
    partagees,
    bypass,
    estAuteur: (p?: DuoPartie | null) => !!p && !!uid && p.createdBy === uid,
  }
}
