'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DuoActivite, DuoFilm, DuoPartie } from '@/types'

/**
 * Les trois listes de l'app « À deux ». Chacune est une collection à plat
 * filtrée sur `members` — pas de sous-collection, donc aucune requête de groupe
 * ni index à créer. Les tours d'une partie vivent dans son document.
 */
function useCollectionPartagee<T extends { id: string }>(nom: string, uid?: string) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setLoading(false); return }
    const q = query(collection(db, nom), where('members', 'array-contains', uid))
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as T)))
      setLoading(false)
    })
  }, [nom, uid])

  const ajouter = async (data: Record<string, unknown>) => {
    const ref = await addDoc(collection(db, nom), { ...data, createdAt: Timestamp.now() })
    return ref.id
  }
  const modifier = (id: string, data: Record<string, unknown>) =>
    updateDoc(doc(db, nom, id), { ...data, updatedAt: Timestamp.now() })
  const supprimer = (id: string) => deleteDoc(doc(db, nom, id))

  return { items, loading, ajouter, modifier, supprimer }
}

export function useDuoFilms(uid?: string) {
  return useCollectionPartagee<DuoFilm>('duo_films', uid)
}
export function useDuoActivites(uid?: string) {
  return useCollectionPartagee<DuoActivite>('duo_activites', uid)
}
export function useDuoParties(uid?: string) {
  return useCollectionPartagee<DuoPartie>('duo_parties', uid)
}
