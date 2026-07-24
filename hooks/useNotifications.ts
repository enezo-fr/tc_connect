import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy,
  onSnapshot, updateDoc, deleteDoc, deleteField, doc
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { Notification } from '@/types'

export function useNotifications() {
  const { currentUser } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) return
    const q = query(
      collection(db, 'Notifications'),
      where('refUsers', '==', doc(db, 'users', currentUser.uid)),
      orderBy('date_create', 'desc')
    )
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Notification[])
      setLoading(false)
    })
    return unsubscribe
  }, [currentUser])

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'Notifications', id), {
      etat_notification: 'Lu',
      date_lecture: new Date(),
    })
  }

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => n.etat_notification !== 'Lu')
    await Promise.all(unread.map((n) => markAsRead(n.id)))
  }

  /**
   * Repasse une notification en « Non lu ».
   * `date_lecture` est effacée : la garder donnerait une date de lecture sur une
   * notification affichée comme non lue.
   */
  const markAsUnread = async (id: string) => {
    await updateDoc(doc(db, 'Notifications', id), {
      etat_notification: 'Non lu',
      date_lecture: deleteField(),
    })
  }

  const deleteNotification = async (id: string) => {
    await deleteDoc(doc(db, 'Notifications', id))
  }

  const unreadCount = notifications.filter((n) => n.etat_notification !== 'Lu').length

  return { notifications, loading, markAsRead, markAsUnread, markAllAsRead, deleteNotification, unreadCount }
}