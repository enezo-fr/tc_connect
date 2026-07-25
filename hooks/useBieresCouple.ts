'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface BieresCoupleState {
  /** Membres du couple (les 2 UID une fois liés) — toujours au moins `[uid]`. */
  members: string[]
  /** Créateur du couple = le compte abonné. `null` tant qu'aucun couple. */
  createdBy: string | null
  loading: boolean
}

/**
 * Couple « Bible de la bière » de l'utilisateur courant (cf. /api/bieres-invite).
 * `members` est recopié dans `bieres.members[]` à l'écriture ; le CRÉATEUR porte
 * l'abonnement, l'autre membre accède gratuitement (bypass StoreGate).
 */
export function useBieresCouple(uid?: string): BieresCoupleState {
  const [state, setState] = useState<BieresCoupleState>({ members: [], createdBy: null, loading: true })

  useEffect(() => {
    if (!uid) { setState({ members: [], createdBy: null, loading: false }); return }
    const q = query(collection(db, 'bieres_couples'), where('members', 'array-contains', uid), limit(1))
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
