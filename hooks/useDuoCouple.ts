'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface DuoCoupleState {
  /** Membres du couple (les 2 UID une fois liés) — toujours au moins `[uid]`. */
  members: string[]
  /** Créateur du couple = le compte qui paie l'app. `null` tant qu'aucun couple. */
  createdBy: string | null
  /** `true` tant que le document de couplage n'a pas encore été lu. */
  loading: boolean
}

/**
 * Couple « Sarah & Ted » de l'utilisateur courant.
 *
 * Tant qu'aucun compte n'est lié, l'utilisateur est seul → `members = [uid]`.
 * Une fois le second compte accepté (routes /api/duo-invite), `duo_couples`
 * contient les deux UID, recopiés dans `members[]` à chaque écriture.
 *
 * `createdBy` = celui qui a créé le couple, c.-à-d. le compte abonné : l'AUTRE
 * membre accède gratuitement (bypass du StoreGate), comme le co-parent de l'app Bébé.
 */
export function useDuoCouple(uid?: string): DuoCoupleState {
  const [state, setState] = useState<DuoCoupleState>({ members: [], createdBy: null, loading: true })

  useEffect(() => {
    if (!uid) { setState({ members: [], createdBy: null, loading: false }); return }
    const q = query(collection(db, 'duo_couples'), where('members', 'array-contains', uid), limit(1))
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) { setState({ members: [uid], createdBy: null, loading: false }); return }
        const data = snap.docs[0].data()
        const raw = (data.members as string[]) ?? [uid]
        const members = raw.includes(uid) ? raw : [...raw, uid]
        setState({ members, createdBy: (data.createdBy as string) ?? null, loading: false })
      },
      () => setState({ members: uid ? [uid] : [], createdBy: null, loading: false }),
    )
  }, [uid])

  return state
}
