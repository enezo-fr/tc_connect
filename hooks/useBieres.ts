'use client'

import { useEffect, useState } from 'react'
import {
  collection, collectionGroup, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, getDocs, writeBatch, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Biere, Degustation } from '@/types'

/**
 * Catalogue de bières partagé — même patron que `useBebe` : on lit les fiches
 * dont on est membre, l'ajout d'un membre passera par l'Admin SDK.
 *
 * Les dégustations sont lues d'un seul coup par `collectionGroup` : une écoute
 * par bière ferait 184 abonnements Firestore pour afficher une liste.
 */
export function useBieres(uid: string | undefined) {
  const [bieres, setBieres] = useState<Biere[]>([])
  const [degustations, setDegustations] = useState<Map<string, Degustation[]>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setLoading(false); return }
    const q = query(collection(db, 'bieres'), where('members', 'array-contains', uid))
    return onSnapshot(q, (snap) => {
      setBieres(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Biere)))
      setLoading(false)
    })
  }, [uid])

  useEffect(() => {
    if (!uid) return
    // `membersDeg` est recopié sur chaque dégustation : une sous-collection
    // n'hérite pas des champs du parent, et un collectionGroup a besoin du
    // filtre pour rester lisible par les règles.
    const q = query(collectionGroup(db, 'degustations'), where('membersDeg', 'array-contains', uid))
    return onSnapshot(q, (snap) => {
      const m = new Map<string, Degustation[]>()
      for (const d of snap.docs) {
        // chemin : bieres/{biereId}/degustations/{id}
        const biereId = d.ref.parent.parent?.id
        if (!biereId) continue
        const liste = m.get(biereId) ?? []
        liste.push({ id: d.id, ...d.data() } as Degustation)
        m.set(biereId, liste)
      }
      setDegustations(m)
    })
  }, [uid])

  const ajouterBiere = async (data: Omit<Biere, 'id' | 'createdAt'>) => {
    const ref = await addDoc(collection(db, 'bieres'), { ...data, createdAt: Timestamp.now() })
    return ref.id
  }

  const majBiere = (id: string, data: Partial<Omit<Biere, 'id'>>) =>
    updateDoc(doc(db, 'bieres', id), { ...data, updatedAt: Timestamp.now() })

  /** Supprime la bière ET ses dégustations (sinon elles restent orphelines) */
  const supprimerBiere = async (id: string) => {
    const snap = await getDocs(collection(db, 'bieres', id, 'degustations'))
    if (snap.docs.length) {
      const batch = writeBatch(db)
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
    await deleteDoc(doc(db, 'bieres', id))
  }

  const ajouterDegustation = (
    biereId: string,
    data: Omit<Degustation, 'id' | 'createdAt'>,
    members: string[],
  ) =>
    addDoc(collection(db, 'bieres', biereId, 'degustations'), {
      ...data,
      membersDeg: members,
      createdAt: Timestamp.now(),
    })

  const majDegustation = (biereId: string, id: string, data: Partial<Omit<Degustation, 'id'>>) =>
    updateDoc(doc(db, 'bieres', biereId, 'degustations', id), data)

  const supprimerDegustation = (biereId: string, id: string) =>
    deleteDoc(doc(db, 'bieres', biereId, 'degustations', id))

  return {
    bieres, degustations, loading,
    ajouterBiere, majBiere, supprimerBiere,
    ajouterDegustation, majDegustation, supprimerDegustation,
  }
}
