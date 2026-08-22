'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Commande, DuoActivite, DuoFilm, DuoPartie, DuoRachat } from '@/types'

/**
 * Les listes de l'app « Sarah & Ted » (films, activités, parties, à racheter).
 * Chacune est une collection à plat filtrée sur `members` — pas de
 * sous-collection, donc aucune requête de groupe ni index à créer. Les tours
 * d'une partie vivent dans son document.
 *
 * ⚠️ Toute NOUVELLE collection doit être ajoutée à `estListeDuo()` dans les
 * règles Firestore, sinon elle est refusée en silence.
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
/** « À racheter » — ce qu'on a aimé et qu'on veut retrouver (un vin, un fromage…). */
export function useDuoRachats(uid?: string) {
  return useCollectionPartagee<DuoRachat>('duo_rachats', uid)
}

/** Commandes au bar — app de la boutique à part entière, même mécanique de partage */
export function useCommandes(uid?: string) {
  return useCollectionPartagee<Commande>('bar_commandes', uid)
}
