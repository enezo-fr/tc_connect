'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, orderBy, limit,
  onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { BebeEvent } from '@/types'

// Couvre ~3 semaines pour un bébé actif (~18 événements/jour)
const EVENTS_LIMIT = 400
/** Mode « tout l'historique » (planning complet, stats sur tout) : ~9 mois de suivi.
 *  Plafond haut mais FINI — un abonnement temps réel sans limite ferait grossir la
 *  mémoire de l'onglet indéfiniment sur un bébé suivi depuis longtemps. */
export const EVENTS_LIMIT_ALL = 5000

/** @param tout charge tout l'historique (dans la limite d'EVENTS_LIMIT_ALL) au lieu des ~3 dernières semaines */
export function useBebeEvents(babyId: string | null, tout = false) {
  const max = tout ? EVENTS_LIMIT_ALL : EVENTS_LIMIT
  const [events, setEvents] = useState<BebeEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!babyId) { setEvents([]); setLoading(false); return }
    const q = query(
      collection(db, 'babies', babyId, 'events'),
      orderBy('timestamp', 'desc'),
      limit(max),
    )
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as BebeEvent)))
      setLoading(false)
    })
    return unsub
  }, [babyId, max])

  const addEvent = (data: Omit<BebeEvent, 'id'>) => {
    if (!babyId) return Promise.reject(new Error('Aucun bébé sélectionné'))
    return addDoc(collection(db, 'babies', babyId, 'events'), data)
  }

  const updateEvent = (eventId: string, data: Partial<Omit<BebeEvent, 'id'>>) => {
    if (!babyId) return Promise.reject(new Error('Aucun bébé sélectionné'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return updateDoc(doc(db, 'babies', babyId, 'events', eventId), data as any)
  }

  const deleteEvent = (eventId: string) => {
    if (!babyId) return Promise.reject(new Error('Aucun bébé sélectionné'))
    return deleteDoc(doc(db, 'babies', babyId, 'events', eventId))
  }

  // Vrai quand le plafond est atteint : l'écran « tout l'historique » doit le DIRE
  // plutôt que de laisser croire qu'il montre vraiment tout.
  return { events, loading, plafondAtteint: events.length >= max, addEvent, updateEvent, deleteEvent }
}
