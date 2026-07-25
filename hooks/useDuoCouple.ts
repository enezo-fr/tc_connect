'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * Membres du couple « Sarah & Ted » de l'utilisateur courant.
 *
 * Tant qu'aucun compte n'est lié, l'utilisateur est seul → `[uid]`. Une fois le
 * second compte accepté (routes /api/duo-invite), le document `duo_couples`
 * contient les deux UID, qu'on recopie dans `members[]` à chaque nouvelle écriture
 * pour que les deux voient tout. Renvoie toujours au moins `[uid]`.
 */
export function useDuoCouple(uid?: string): string[] {
  const [members, setMembers] = useState<string[]>([])

  useEffect(() => {
    if (!uid) { setMembers([]); return }
    const q = query(collection(db, 'duo_couples'), where('members', 'array-contains', uid), limit(1))
    return onSnapshot(
      q,
      (snap) => {
        const m = snap.empty ? [uid] : ((snap.docs[0].data().members as string[]) ?? [uid])
        setMembers(m.includes(uid) ? m : [...m, uid])
      },
      () => setMembers([uid]),
    )
  }, [uid])

  if (!uid) return []
  return members.length ? members : [uid]
}
