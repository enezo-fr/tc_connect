'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  collection, query, where, orderBy,
  getDocs, doc, Timestamp, addDoc, updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/hooks/useNotifications'
import { usePendingSubscriptions } from '@/hooks/usePendingSubscriptions'
import { useUnseenDocuments } from '@/hooks/useUnseenDocuments'
import {
  CalendarIcon, ChevronRightIcon,
  MapPinIcon, GlobeAltIcon, BoltIcon, FolderIcon,
} from '@heroicons/react/24/outline'
import Badge from '@/components/ui/Badge'
import { formatHeure, getEtatBadge } from '@/lib/planningUtils'
import { navItems } from '@/components/layout/Navbar'
import { useBrand } from '@/context/BrandContext'
import { BrandSwitcher } from '@/components/layout/BrandSwitcher'
import { useStoreApps } from '@/hooks/useStoreApps'
import { useTrips } from '@/hooks/useTrips'
import { tripProgress } from '@/lib/tripsService'
import { listenStoreSubscriptions, updateStoreSubscription, updateSubWithEvent, appendSubEvent, computeDateFin, suspendExpiredSubscriptions } from '@/lib/storeService'
import { cleanupArchivedSubscriptions } from '@/lib/storeCleanup'
import { rdvVisiblePourClient } from '@/lib/planningAccess'

// Libellés de statut des contrats affichés dans « Mes contrats » (espace client Enezo)
const CONTRAT_STATUT: Record<string, { label: string; cls: string }> = {
  prospect: { label: 'Proposition', cls: 'bg-amber-100 text-amber-700' },
  actif: { label: 'En cours', cls: 'bg-green-100 text-green-700' },
  pause: { label: 'En pause', cls: 'bg-gray-100 text-gray-600' },
  termine: { label: 'Terminé', cls: 'bg-gray-100 text-gray-500' },
}

// Ajoute une période (mensuel = +1 mois, annuel = +1 an) à un timestamp ms
function addPeriodMs(fromMs: number, periodicite: string): number {
  const d = new Date(fromMs)
  if (periodicite === 'annuel') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

export default function AccueilPage() {
  const { currentUser, userProfile } = useAuth()
  const { unreadCount } = useNotifications()
  const pendingSubscriptions = usePendingSubscriptions()
  const unseenDocuments = useUnseenDocuments()
  const router = useRouter()
  const isAdmin = userProfile?.role_app === 'Admin'
  const droits = userProfile?.droits as any
  const { brand, allowedBrands, canSwitch, setBrand } = useBrand()

  const [rdvAujourdhui, setRdvAujourdhui] = useState<any[]>([])
  const [activitesAujourdhui, setActivitesAujourdhui] = useState<any[]>([])
  const [prochainsRdv, setProchainsRdv] = useState<any[]>([])
  const [monEspaceContrats, setMonEspaceContrats] = useState<{ id: string; titre: string; sousTitre: string; clientNom: string; statut: string }[]>([])

  const { apps: storeApps } = useStoreApps()
  const { voyages: ccLists } = useTrips()
  const [showCCLists, setShowCCLists] = useState(false)
  const shortcutAppIds = userProfile?.accueilShortcuts ?? []
  const shortcutApps = storeApps.filter(app => shortcutAppIds.includes(app.id) && !!app.route)

  /** Client de l'espace Enezo : pas de planning/RDV (routes gardées coaching) → on masque
   *  les entrées qui le renverraient sur un écran « accès non autorisé ». */
  const isEnezoClient = !isAdmin && brand === 'enezo'
  /** Apps proposées en boutique — même filtrage de visibilité que la page /boutique. */
  const boutiqueApps = storeApps.filter(app => {
    if (!app.actif) return false
    const uid = currentUser?.uid
    if (uid && app.hiddenUserIds?.includes(uid)) return false
    if (app.visibleUserIds && app.visibleUserIds.length > 0) return app.visibleUserIds.includes(uid ?? '')
    return true
  })
  const [allStoreSubs, setAllStoreSubs] = useState<any[]>([])
  const [pendingEcheances, setPendingEcheances] = useState<{ devis: any; echeance: any; index: number; daysLeft: number | null }[]>([])
  const [seanceAccessAlerts, setSeanceAccessAlerts] = useState<{ client: any; type: 'to_configure' | 'expiring_soon' | 'to_restore' }[]>([])
  const [loading, setLoading] = useState(true)

  // Souscriptions boutique (admin uniquement → évite l'erreur de permission côté utilisateur)
  useEffect(() => {
    if (!currentUser || !isAdmin) return
    const unsub = listenStoreSubscriptions(setAllStoreSubs)
    return unsub
  }, [currentUser, isAdmin])

  // Bascule automatiquement en "suspended" les abonnements expirés (date de fin dépassée)
  useEffect(() => {
    if (!isAdmin || allStoreSubs.length === 0) return
    suspendExpiredSubscriptions(allStoreSubs as any)
  }, [isAdmin, allStoreSubs])

  // Purge les données des abonnements archivés depuis plus de 90 jours
  useEffect(() => {
    if (!isAdmin || allStoreSubs.length === 0 || storeApps.length === 0) return
    cleanupArchivedSubscriptions(allStoreSubs as any, storeApps as any)
  }, [isAdmin, allStoreSubs, storeApps])

  useEffect(() => {
    if (!currentUser) return
    fetchStats()
    checkAndCreateNotifications()
  }, [currentUser])

  // Contrats rattachés au compte (section « Mes contrats » — espace client Enezo uniquement)
  useEffect(() => {
    if (!currentUser || isAdmin || brand !== 'enezo') { setMonEspaceContrats([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const idToken = await currentUser.getIdToken()
        const res = await fetch('/api/mon-espace', { headers: { Authorization: `Bearer ${idToken}` } })
        const d = await res.json()
        if (!cancelled && res.ok) setMonEspaceContrats(d.contrats ?? [])
      } catch { /* silencieux : la section reste simplement masquée */ }
    })()
    return () => { cancelled = true }
  }, [currentUser, isAdmin, brand])

  useEffect(() => {
    if (!currentUser || !isAdmin) return
    getDocs(query(
      collection(db, 'factures'),
      where('userId', '==', currentUser.uid),
      where('type', '==', 'devis'),
      where('status', '==', 'accepted'),
    )).then((snap) => {
      const pending: { devis: any; echeance: any; index: number; daysLeft: number | null }[] = []
      snap.docs.forEach((d) => {
        const devis = { id: d.id, ...d.data() as any }
        if (!devis.echeances || devis.echeances.length === 0) return
        const already = (devis.convertedToFactureIds ?? (devis.convertedToFactureId ? [devis.convertedToFactureId] : [])).length
        devis.echeances.slice(already).forEach((ech: any, i: number) => {
          const daysLeft = ech.date ? Math.round((ech.date.toMillis() - Date.now()) / 86400000) : null
          if (daysLeft === null || daysLeft <= 7) {
            pending.push({ devis, echeance: ech, index: already + i, daysLeft })
          }
        })
      })
      pending.sort((a, b) => (a.echeance.date?.toMillis() ?? 0) - (b.echeance.date?.toMillis() ?? 0))

      // Notifications push + in-app pour les échéances à J-3, J-1 et J-0
      const today = new Date().toISOString().split('T')[0]
      for (const { devis, echeance, index, daysLeft } of pending) {
        if (daysLeft !== 0 && daysLeft !== 1 && daysLeft !== 3) continue
        const storageKey = `tc_ech_notif_${devis.id}_${index}_${today}`
        if (localStorage.getItem(storageKey)) continue
        const label = echeance.label || `Règlement ${index + 1}/${devis.echeances.length}`
        const when = daysLeft === 0 ? "aujourd'hui" : daysLeft === 1 ? 'demain' : 'dans 3 jours'
        const client = devis.clientName || 'un client'
        const montant = typeof echeance.montant === 'number' ? ` (${echeance.montant.toLocaleString('fr-FR')} €)` : ''
        fetch('/api/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.uid,
            title: '🧾 Facture à émettre',
            body: `${client} · ${label}${montant} — échéance ${when}.`,
            url: '/facturation?tab=devis',
            persist: true,
            type: 'FACTURE_ECHEANCE',
            // Déduplication serveur partagée entre appareils (localStorage = garde-fou local).
            dedupeKey: `ech_${devis.id}_${index}_${today}`,
          }),
        }).catch(() => {})
        localStorage.setItem(storageKey, '1')
      }

      setPendingEcheances(pending)
    }).catch(() => {})
  }, [currentUser, isAdmin])

  // Alertes accès séances pour les clients avec abonnements inactifs
  useEffect(() => {
    if (!currentUser || !isAdmin) return
    ;(async () => {
      try {
        const now = Date.now()
        const in7days = now + 7 * 86400000
        // Charger tous les clients avec un linkedUserId (compte app)
        const clientsSnap = await getDocs(query(
          collection(db, 'clients'),
          where('userId', '==', currentUser.uid),
        ))
        const linkedClients = clientsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() as any }))
          .filter((c) => c.linkedUserId)
        if (linkedClients.length === 0) return

        // Abonnements par clientId
        const abosSnap = await getDocs(query(collection(db, 'abonnements'), where('userId', '==', currentUser.uid)))
        const abosByClient: Record<string, any[]> = {}
        abosSnap.docs.forEach((d) => {
          const a = d.data() as any
          if (!abosByClient[a.clientId]) abosByClient[a.clientId] = []
          abosByClient[a.clientId].push(a)
        })

        // Clients ayant au moins une vraie séance (collection seance, pas les simples RDV)
        const seancesSnap = await getDocs(query(collection(db, 'seance')))
        const userIdsWithSeances = new Set<string>()
        seancesSnap.docs.forEach((d) => {
          const uid = (d.data() as any).ref_users?.id
          if (uid) userIdsWithSeances.add(uid)
        })

        const alerts: { client: any; type: 'to_configure' | 'expiring_soon' | 'to_restore' }[] = []
        for (const client of linkedClients) {
          const hasSeances = userIdsWithSeances.has(client.linkedUserId)
          if (!hasSeances) continue // pas de séances en ligne → pas concerné par l'accès séances

          const abos = abosByClient[client.id] ?? []
          const hasActif = abos.some((a) => a.etat === 'Actif')
          const hasInactif = abos.some((a) => a.etat === 'Inactif')
          const expiry = client.seanceAccessExpiry?.toMillis?.() ?? null

          if (hasActif && expiry !== null) {
            // Abonnement redevenu actif mais une date butoire est encore configurée
            alerts.push({ client, type: 'to_restore' })
          } else if (!hasActif && hasInactif) {
            if (expiry === null) {
              alerts.push({ client, type: 'to_configure' })
            } else if (expiry >= now && expiry <= in7days) {
              alerts.push({ client, type: 'expiring_soon' })
            }
            // expiry < now (déjà expiré) → aucune alerte : si rien n'a été changé avant
            // l'échéance, c'est un blocage volontaire, inutile de le rappeler.
          }
        }
        setSeanceAccessAlerts(alerts)
      } catch {}
    })()
  }, [currentUser, isAdmin])

  const checkAndCreateNotifications = async () => {
    if (!currentUser) return
    // Run at most once per hour per session to avoid expensive N+1 reads on every visit
    const KEY = 'tc_notif_check'
    const last = sessionStorage.getItem(KEY)
    if (last && Date.now() - parseInt(last) < 3_600_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
    const userRef = doc(db, 'users', currentUser.uid)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    try {
      const rdvQ = query(
        collection(db, 'planning_pro'),
        where('ref_users', '==', userRef),
        where('etat_planning_rdv', '==', 'Effectué'),
        where('date_planning', '<', Timestamp.fromDate(today)),
        orderBy('date_planning', 'desc')
      )
      const rdvSnap = await getDocs(rdvQ)
      const allPastRdvs = rdvSnap.docs.map(d => ({ id: d.id, ...d.data() as any }))

      // Existing admin notifications (CR_RDV_MANQUANT + SEANCE_INCOMPLETE)
      const adminNotifSnap = await getDocs(query(
        collection(db, 'Notifications'),
        where('refUsers', '==', userRef),
        where('type_notification', 'in', ['CR_RDV_MANQUANT', 'SEANCE_INCOMPLETE'])
      ))
      const existingAdminByType = new Map<string, Set<string>>()
      adminNotifSnap.docs.forEach(d => {
        const { type_notification, ref_planning } = d.data() as any
        if (!existingAdminByType.has(type_notification)) existingAdminByType.set(type_notification, new Set())
        if (ref_planning?.id) existingAdminByType.get(type_notification)!.add(ref_planning.id)
      })

      for (const rdv of allPastRdvs) {
        const planningRef = doc(db, 'planning_pro', rdv.id)
        const dateStr = rdv.date_planning?.toDate().toLocaleDateString('fr-FR', {
          day: 'numeric', month: 'long', year: 'numeric',
        })

        // 1. Admin: CR manquant
        if (!rdv.observations_rdv && !existingAdminByType.get('CR_RDV_MANQUANT')?.has(rdv.id)) {
          await addDoc(collection(db, 'Notifications'), {
            refUsers: userRef,
            type_notification: 'CR_RDV_MANQUANT',
            notification: `Le compte rendu du RDV du ${dateStr} n'a pas été rempli.`,
            etat_notification: 'Non lu',
            date_create: Timestamp.now(),
            ref_planning: planningRef,
          })
        }

        // 2. Admin: séance incomplète
        if (!existingAdminByType.get('SEANCE_INCOMPLETE')?.has(rdv.id)) {
          const seancesSnap = await getDocs(query(
            collection(db, 'seance'),
            where('ref_planning', '==', planningRef)
          ))
          const hasIncomplete = seancesSnap.docs.some(d => ((d.data() as any).avancement_circuit ?? 0) < 1)
          if (hasIncomplete) {
            await addDoc(collection(db, 'Notifications'), {
              refUsers: userRef,
              type_notification: 'SEANCE_INCOMPLETE',
              notification: `La séance du ${dateStr} n'a pas été complétée dans son intégralité.`,
              etat_notification: 'Non lu',
              date_create: Timestamp.now(),
              ref_planning: planningRef,
            })
          }
        }

        // 3. Client: commentaire retour manquant (le lendemain)
        const rdvDate = rdv.date_planning?.toDate?.()
        if (!rdv.cr_rdv_client && rdvDate && rdvDate < yesterday && rdv.ref_client) {
          const clientRef = rdv.ref_client
          const clientNotifSnap = await getDocs(query(
            collection(db, 'Notifications'),
            where('refUsers', '==', clientRef),
            where('type_notification', '==', 'CR_CLIENT_MANQUANT'),
            where('ref_planning', '==', planningRef)
          ))
          if (clientNotifSnap.empty) {
            await addDoc(collection(db, 'Notifications'), {
              refUsers: clientRef,
              type_notification: 'CR_CLIENT_MANQUANT',
              notification: `Merci de partager votre retour sur la séance du ${dateStr}.`,
              etat_notification: 'Non lu',
              date_create: Timestamp.now(),
              ref_planning: planningRef,
            })
          }
        }
      }
    } catch {}
  }

  const fetchStats = async () => {
    if (!currentUser) return

    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const in7days = new Date(today)
      in7days.setDate(in7days.getDate() + 7)

      const userRef = doc(db, 'users', currentUser.uid)

      // RDV d'aujourd'hui
      const rdvQuery = query(
        collection(db, 'planning_pro'),
        where('ref_users', '==', userRef),
        where('date_planning', '>=', Timestamp.fromDate(today)),
        where('date_planning', '<', Timestamp.fromDate(tomorrow)),
        orderBy('date_planning', 'asc')
      )
      const rdvSnap = await getDocs(rdvQuery)
      // Même règle que le hook `usePlanning` : un client ne voit pas les RDV
      // encore « Non calé ». Cet écran interroge Firestore directement, il faut
      // donc appliquer le filtre ici aussi (cf. lib/planningAccess.ts).
      setRdvAujourdhui(
        rdvSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => isAdmin || rdvVisiblePourClient(p)),
      )

      // Activités d'aujourd'hui (filtrage de la date côté client → pas d'index composite requis)
      const actSnap = await getDocs(query(
        collection(db, 'activites_clients'),
        where('userId', '==', currentUser.uid),
      ))
      const todayMs = today.getTime()
      const tomorrowMs = tomorrow.getTime()
      setActivitesAujourdhui(
        actSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((a: any) => {
            const t = a.date_activite?.toDate?.()?.getTime?.() ?? 0
            return t >= todayMs && t < tomorrowMs
          })
      )

      // Prochains RDV (7 jours)
      const prochainsQuery = query(
        collection(db, 'planning_pro'),
        where('ref_users', '==', userRef),
        where('date_planning', '>=', Timestamp.fromDate(tomorrow)),
        where('date_planning', '<', Timestamp.fromDate(in7days)),
        orderBy('date_planning', 'asc')
      )
      const prochainsSnap = await getDocs(prochainsQuery)
      setProchainsRdv(
        prochainsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => isAdmin || rdvVisiblePourClient(p)),
      )

    } catch {}

    setLoading(false)
  }

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bonjour'
    if (h < 18) return 'Bon après-midi'
    return 'Bonsoir'
  }

  // Abonnements boutique (apps payantes récurrentes) dont l'accès arrive à échéance ou est expiré
  const nowMs = Date.now()
  const paymentAlerts = isAdmin
    ? allStoreSubs
        // Abonnements actifs (échéance proche) OU suspendus suite à expiration
        .filter((s) => s.statut === 'active' || s.statut === 'suspended')
        .map((s) => {
          const app = storeApps.find((a) => a.id === s.appId)
          if (!app || app.prix <= 0 || app.periodicite === 'unique') return null
          // Échéance = date de fin d'accès (dateFin), sinon repli sur l'ancienne logique
          const baseMs = s.dateFin?.toMillis?.()
            ?? s.nextPaymentDate?.toMillis?.()
            ?? (s.dateDebut?.toMillis ? addPeriodMs(s.dateDebut.toMillis(), app.periodicite) : null)
          if (!baseMs) return null
          const daysLeft = Math.round((baseMs - nowMs) / 86400000)
          // Actif : alerte à partir de J-7. Suspendu : seulement s'il a réellement expiré.
          if (s.statut === 'active' && daysLeft > 7) return null
          if (s.statut === 'suspended' && daysLeft >= 0) return null
          return { sub: s, app, dueMs: baseMs, daysLeft }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.dueMs - b.dueMs) as { sub: any; app: any; dueMs: number; daysLeft: number }[]
    : []

  // Marque payé : prolonge l'accès d'une période ET réactive l'abonnement si suspendu
  const validatePayment = async (alert: { sub: any; app: any; dueMs: number }) => {
    const fromMs = Math.max(alert.dueMs, Date.now()) // repart de l'échéance, ou de maintenant si déjà expiré
    const finMs = computeDateFin(fromMs, alert.app.periodicite) ?? fromMs
    await updateSubWithEvent(alert.sub.id, {
      statut: 'active',
      dateFin: Timestamp.fromMillis(finMs),
      lastPaymentAt: Timestamp.now(),
    }, 'renewed')
    // Prévenir l'utilisateur que son accès est renouvelé
    if (alert.sub.userUid) {
      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: alert.sub.userUid,
          persist: true,
          type: 'BOUTIQUE_VALIDATION',
          title: 'Abonnement renouvelé',
          body: `Votre accès à "${alert.app.nom}" a été renouvelé. Bonne utilisation !`,
          url: alert.app.route ?? '/boutique',
        }),
      }).catch(() => {})
    }
  }

  // Archive un abonnement terminé (la personne a arrêté) → sort des alertes
  const archiveSub = async (alert: { sub: any }) => {
    await updateSubWithEvent(alert.sub.id, {
      statut: 'cancelled',
      archivedAt: Timestamp.now(),
    } as any, 'archived')
  }

  // Relance l'utilisateur (push + notification in-app) pour renouveler son abonnement
  const [relancedIds, setRelancedIds] = useState<Set<string>>(new Set())
  const relancePayment = (alert: { sub: any; app: any; daysLeft: number }) => {
    if (!alert.sub.userUid) return
    const expired = alert.daysLeft < 0
    fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: alert.sub.userUid,
        persist: true,
        type: 'BOUTIQUE_ECHEANCE',
        title: expired ? 'Abonnement expiré' : 'Abonnement à renouveler',
        body: expired
          ? `Votre accès à "${alert.app.nom}" a expiré. Renouvelez pour continuer à l'utiliser.`
          : `Votre accès à "${alert.app.nom}" arrive à échéance. Pensez à le renouveler pour ne pas perdre l'accès.`,
        url: '/boutique',
      }),
    }).catch(() => {})
    appendSubEvent(alert.sub.id, 'reminder', expired ? 'Abonnement expiré' : 'Échéance proche').catch(() => {})
    setRelancedIds((prev) => new Set(prev).add(alert.sub.id))
  }

  const facturerSub = (alert: { sub: any; app: any }) => {
    const params = new URLSearchParams()
    if (alert.sub.clientId) params.set('clientId', alert.sub.clientId)
    params.set('label', alert.app.nom)
    params.set('prix', String(alert.app.prix))
    router.push(`/facturation/create?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Sélecteur d'espace — mobile uniquement (desktop = dans la sidebar) */}
      {canSwitch && (
        <div className="lg:hidden">
          <span className="block mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Espace</span>
          <BrandSwitcher brands={allowedBrands} active={brand} onSelect={setBrand} />
        </div>
      )}

      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {greeting()} {userProfile?.prenom} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
          })}
        </p>
      </div>

      {/* Mes contrats — espace client Enezo (masqué si aucun contrat rattaché) */}
      {monEspaceContrats.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-700">Mes contrats</h2>
            {monEspaceContrats.length > 3 && (
              <button
                onClick={() => router.push('/mon-espace')}
                className="group flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                Tout voir
                <ChevronRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
          <div className="space-y-2">
            {monEspaceContrats.slice(0, 3).map((c) => {
              const st = CONTRAT_STATUT[c.statut] ?? { label: c.statut, cls: 'bg-gray-100 text-gray-600' }
              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/mon-espace/${c.id}`)}
                  className="w-full flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 hover:shadow-md transition text-left"
                >
                  <FolderIcon className="w-6 h-6 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{c.titre}</p>
                    {c.sousTitre && <p className="text-xs text-gray-500 truncate">{c.sousTitre}</p>}
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                  <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Statistiques */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="RDV aujourd'hui"
          value={rdvAujourdhui.length}
          icon={<CalendarIcon className="w-5 h-5" />}
          color="blue"
          // Côté Enezo la carte reste informative : /planning est gardé coaching.
          onClick={isEnezoClient ? undefined : () => router.push('/planning')}
        />
        <StatCard
          label="Mes CheckConnect"
          value={ccLists.length}
          icon={<span className="text-lg leading-none">✅</span>}
          color="green"
          onClick={() => setShowCCLists((v) => !v)}
        />
      </div>

      {/* Listes CheckConnect — dépliées au clic sur la card */}
      {showCCLists && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-700">✅ Mes CheckConnect</h2>
            <button onClick={() => router.push('/trips')}
              className="text-xs font-medium text-blue-600 hover:underline">Tout voir</button>
          </div>
          {ccLists.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <p className="text-sm text-gray-400">Aucune liste pour l'instant.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {ccLists.slice(0, 8).map(list => {
                const { pct, total } = tripProgress(list)
                return (
                  <button key={list.id}
                    onClick={() => router.push(`/trips?list=${list.id}`)}
                    className="w-full flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-3 hover:shadow-md transition text-left">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                      style={{ backgroundColor: list.color + '20' }}>
                      {list.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{list.name}</p>
                      <p className="text-xs text-gray-400">
                        {total > 0 ? `${pct}% fait` : 'Liste vide'}
                        {list.members.length > 1 && ` · ${list.members.length} participants`}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Raccourcis boutique — AVANT la boutique : ce sont les apps déjà
          activées, donc le geste quotidien. Le catalogue vient après. */}
      {shortcutApps.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Mes raccourcis</h2>
          <div className="grid grid-cols-3 gap-3">
            {shortcutApps.map(app => (
              <button
                key={app.id}
                onClick={() => router.push(app.route!)}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col items-center gap-2 hover:shadow-md transition"
              >
                <div
                  className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center text-xl"
                  style={{ backgroundColor: app.couleur + '20' }}
                >
                  {(app as any).iconUrl ? <img src={(app as any).iconUrl} alt="" className="w-full h-full object-cover" /> : app.icon}
                </div>
                <span className="text-xs font-medium text-gray-700 text-center leading-tight">{app.nom}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ABONNEMENTS BOUTIQUE À ÉCHÉANCE — admin uniquement */}
      {isAdmin && paymentAlerts.length > 0 && (() => {
        const expiredCount = paymentAlerts.filter((a) => a.daysLeft < 0).length
        return (
        <div className={`rounded-xl px-4 py-3 border ${expiredCount > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span>{expiredCount > 0 ? '⛔' : '⏳'}</span>
            <p className={`text-sm font-semibold ${expiredCount > 0 ? 'text-red-800' : 'text-amber-800'}`}>
              {paymentAlerts.length} abonnement{paymentAlerts.length > 1 ? 's' : ''} boutique à échéance
              {expiredCount > 0 ? ` · ${expiredCount} expiré${expiredCount > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            {paymentAlerts.map((a) => {
              const overdue = a.daysLeft < 0
              const tag = overdue ? `expiré depuis ${-a.daysLeft}j` : a.daysLeft === 0 ? "expire aujourd'hui" : `expire dans ${a.daysLeft}j`
              const relanced = relancedIds.has(a.sub.id)
              return (
                <div key={a.sub.id} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded-lg bg-white/70 border border-gray-100 flex-wrap">
                  <span className="text-gray-700 truncate min-w-0">
                    <span className="font-medium">{a.sub.clientNom || '—'}</span>
                    <span className="text-gray-400 mx-1">·</span>{a.app.nom}
                    <span className="text-gray-400 mx-1">·</span>{a.app.prix} €
                    <span className={`ml-1 font-medium ${overdue ? 'text-red-600' : 'text-amber-600'}`}>· {tag}</span>
                  </span>
                  <span className="flex items-center gap-2.5 shrink-0">
                    {a.sub.userUid && (
                      relanced
                        ? <span className="text-green-600">✓ Relancé</span>
                        : <button onClick={() => relancePayment(a)} className="font-medium text-orange-600 hover:underline">Relancer</button>
                    )}
                    <button onClick={() => facturerSub(a)} className="text-blue-600 hover:underline">Facturer</button>
                    <button onClick={() => validatePayment(a)} title="Marquer payé et prolonger l'accès" className="text-green-600 hover:underline">Payé ✓ (+1 période)</button>
                    <button onClick={() => archiveSub(a)} title="La personne a arrêté son abonnement — retirer des alertes" className="text-gray-500 hover:underline">Archiver</button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}

      {/* ALERTE ÉCHÉANCES À ÉMETTRE — admin uniquement */}
      {isAdmin && pendingEcheances.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-orange-500">⚠</span>
            <p className="text-sm font-semibold text-orange-800">
              {pendingEcheances.length} facture{pendingEcheances.length > 1 ? 's' : ''} à émettre (échéancier)
            </p>
          </div>
          <div className="space-y-1.5">
            {pendingEcheances.map(({ devis, echeance, index, daysLeft }) => {
              const label = echeance.label || `Règlement ${index + 1}/${devis.echeances.length}`
              const dateStr = echeance.date
                ? echeance.date.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                : '—'
              const tag = daysLeft === null ? '' : daysLeft < 0 ? ` · en retard de ${-daysLeft}j` : daysLeft === 0 ? ' · aujourd\'hui' : ` · dans ${daysLeft}j`
              return (
                <div key={`${devis.id}-${index}`}
                  onClick={() => router.push('/facturation?tab=devis')}
                  className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-lg bg-white/60 border border-orange-100 cursor-pointer hover:bg-white transition">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-800 truncate">{devis.clientName || '—'}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {label}
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="whitespace-nowrap">{dateStr}</span>
                      {tag && <span className={`whitespace-nowrap font-medium ${daysLeft !== null && daysLeft < 0 ? 'text-red-600' : 'text-orange-600'}`}>{tag}</span>}
                    </p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-blue-500 shrink-0" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ALERTES ACCÈS SÉANCES — admin uniquement */}
      {isAdmin && seanceAccessAlerts.length > 0 && (
        <div className="space-y-2">
          {seanceAccessAlerts.map(({ client, type }) => {
            const name = `${(client.nom ?? '').toUpperCase()} ${client.prenom ?? ''}`.trim()
            const expiry = client.seanceAccessExpiry?.toDate?.()?.toLocaleDateString('fr-FR') ?? null
            const set3months = async () => {
              const d = new Date(); d.setMonth(d.getMonth() + 3)
              await updateDoc(doc(db, 'clients', client.id), { seanceAccessExpiry: Timestamp.fromDate(d) })
              setSeanceAccessAlerts((prev) => prev.map((a) => a.client.id === client.id ? { ...a, client: { ...a.client, seanceAccessExpiry: Timestamp.fromDate(d) }, type: 'expiring_soon' as const } : a))
            }
            const clearExpiry = async () => {
              await updateDoc(doc(db, 'clients', client.id), { seanceAccessExpiry: null })
              setSeanceAccessAlerts((prev) => prev.filter((a) => a.client.id !== client.id))
            }

            if (type === 'to_configure') return (
              <div key={client.id} className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 text-sm shrink-0">⏱</span>
                  <div>
                    <p className="text-sm font-semibold text-blue-800">{name} — Accès séances à configurer</p>
                    <p className="text-xs text-blue-600">Abonnement inactif · aucune date butoire définie</p>
                  </div>
                </div>
                <button onClick={set3months} className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap">
                  Définir 3 mois
                </button>
              </div>
            )
            if (type === 'expiring_soon') return (
              <div key={client.id} className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-orange-500 text-sm shrink-0">⚠</span>
                  <div>
                    <p className="text-sm font-semibold text-orange-800">{name} — Accès séances expire bientôt</p>
                    <p className="text-xs text-orange-600">Date butoire : {expiry}</p>
                  </div>
                </div>
                <button onClick={clearExpiry} className="shrink-0 text-xs border border-orange-300 text-orange-700 hover:bg-orange-100 px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap">
                  Rétablir
                </button>
              </div>
            )
            if (type === 'to_restore') return (
              <div key={client.id} className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-green-500 text-sm shrink-0">✅</span>
                  <div>
                    <p className="text-sm font-semibold text-green-800">{name} — Abonnement redevenu actif</p>
                    <p className="text-xs text-green-600">Une date butoire est encore configurée ({expiry}) · pensez à la supprimer</p>
                  </div>
                </div>
                <button onClick={clearExpiry} className="shrink-0 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap">
                  Rétablir l'accès
                </button>
              </div>
            )
            return null
          })}
        </div>
      )}

      {/* RDV du jour */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-700">Aujourd'hui</h2>
          {!isEnezoClient && (
            <button
              onClick={() => router.push('/planning')}
              className="group flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Voir tout
              <ChevronRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>

        {rdvAujourdhui.length === 0 && activitesAujourdhui.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3">
            <p className="text-gray-400 text-sm">Aucun RDV aujourd'hui</p>
            {isAdmin ? (
              <button
                onClick={() => router.push('/planning')}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
              >
                <CalendarIcon className="w-4 h-4" />
                Ajouter un RDV
              </button>
            ) : !isEnezoClient ? (
              <button
                onClick={() => router.push('/planning')}
                className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
              >
                <CalendarIcon className="w-4 h-4" />
                Ajouter une activité
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {rdvAujourdhui.map((rdv) => {
              const etat = getEtatBadge(rdv.etat_planning_rdv)
              return (
                <div
                  key={rdv.id}
                  onClick={() => router.push(`/planning/${rdv.id}`)}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-800">
                        {formatHeure(rdv.heure_planning_debut)} → {formatHeure(rdv.heure_planning_fin)}
                      </span>
                      <Badge label={etat.label} variant={etat.variant} />
                    </div>
                    {rdv.adresse_rdv && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">📍 {rdv.adresse_rdv}</span>
                        <div className="flex items-center gap-2">
                          <a href={`https://waze.com/ul?q=${encodeURIComponent(rdv.adresse_rdv)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border border-sky-200 text-sky-700 hover:bg-sky-50 transition"><MapPinIcon className="w-3 h-3" />Waze</a>
                          <a href={`https://maps.google.com/maps?q=${encodeURIComponent(rdv.adresse_rdv)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 transition"><GlobeAltIcon className="w-3 h-3" />Maps</a>
                        </div>
                      </div>
                    )}
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                </div>
              )
            })}

            {/* Activités du jour */}
            {activitesAujourdhui.map((act) => (
              <div
                key={act.id}
                onClick={() => router.push('/planning')}
                className="bg-green-50 rounded-2xl border border-green-200 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <BoltIcon className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-sm font-semibold text-green-800 truncate">{act.type_activite}</span>
                    {act.heure_debut && (
                      <span className="text-xs text-green-600 shrink-0">{act.heure_debut}{act.heure_fin ? ` → ${act.heure_fin}` : ''}</span>
                    )}
                  </div>
                  {(act.distance_km || act.calories) && (
                    <p className="text-xs text-green-600">
                      {act.distance_km ? `📍 ${act.distance_km} km` : ''}
                      {act.distance_km && act.calories ? ' · ' : ''}
                      {act.calories ? `🔥 ${act.calories} kcal` : ''}
                    </p>
                  )}
                </div>
                <ChevronRightIcon className="w-4 h-4 text-green-400 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Boutique — espace client Enezo : accès direct aux apps depuis l'accueil.
          Placée APRÈS les raccourcis et « Aujourd'hui » : c'est un catalogue à
          découvrir, pas quelque chose qu'on ouvre tous les jours. */}
      {isEnezoClient && boutiqueApps.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-700">Boutique</h2>
            <button
              onClick={() => router.push('/boutique')}
              className="group flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Tout voir
              <ChevronRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {boutiqueApps.slice(0, 6).map(app => (
              <button
                key={app.id}
                onClick={() => router.push('/boutique')}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col items-center gap-2 hover:shadow-md transition"
              >
                <div
                  className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center text-xl"
                  style={{ backgroundColor: app.couleur + '20' }}
                >
                  {app.iconUrl ? <img src={app.iconUrl} alt="" className="w-full h-full object-cover" /> : app.icon}
                </div>
                <span className="text-xs font-medium text-gray-700 text-center leading-tight">{app.nom}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Prochains RDV */}
      {prochainsRdv.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-700">
              Les 7 prochains jours
            </h2>
          </div>
          <div className="space-y-2">
            {prochainsRdv.slice(0, 5).map((rdv) => {
              const etat = getEtatBadge(rdv.etat_planning_rdv)
              return (
                <div
                  key={rdv.id}
                  onClick={() => router.push(`/planning/${rdv.id}`)}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400 capitalize">
                        {rdv.date_planning?.toDate().toLocaleDateString('fr-FR', {
                          weekday: 'short', day: 'numeric', month: 'short'
                        })}
                      </span>
                      <Badge label={etat.label} variant={etat.variant} />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">
                      {formatHeure(rdv.heure_planning_debut)} → {formatHeure(rdv.heure_planning_fin)}
                    </p>
                    {rdv.adresse_rdv && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">📍 {rdv.adresse_rdv}</span>
                        <div className="flex items-center gap-2">
                          <a href={`https://waze.com/ul?q=${encodeURIComponent(rdv.adresse_rdv)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border border-sky-200 text-sky-700 hover:bg-sky-50 transition"><MapPinIcon className="w-3 h-3" />Waze</a>
                          <a href={`https://maps.google.com/maps?q=${encodeURIComponent(rdv.adresse_rdv)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 transition"><GlobeAltIcon className="w-3 h-3" />Maps</a>
                        </div>
                      </div>
                    )}
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Navigation rapide — visible sur mobile, pour les pages hors barre du bas */}
      {(() => {
        // Boutique excluded from grid for non-admin (it's in their bottom bar), but kept for admin (bottom bar hides it via nonAdminOnly)
        const mobileBarHrefs = isAdmin
          ? ['/accueil', '/planning', '/notifications', '/messagerie', '/clients', '/profil']
          : ['/accueil', '/planning', '/notifications', '/messagerie', '/boutique', '/clients', '/profil']
        const extraItems = (navItems as any[]).filter((item) => {
          if (mobileBarHrefs.includes(item.href)) return false
          if (item.adminOnly && !isAdmin) return false
          if (item.nonAdminOnly && isAdmin) return false
          if (!isAdmin && item.marques && !item.marques.includes(brand)) return false
          if (!isAdmin && item.droit) {
            if (item.droit === 'exercices') return droits?.exercices === true
            return droits?.[item.droit] !== false
          }
          return true
        })
        if (extraItems.length === 0) return null
        return (
          <section className="lg:hidden">
            <h2 className="text-base font-semibold text-gray-700 mb-3">Navigation</h2>
            <div className="grid grid-cols-3 gap-3">
              {extraItems.map((item) => {
                const Icon = item.icon
                const badge = item.href === '/boutique' ? pendingSubscriptions : item.href === '/documents' ? unseenDocuments : 0
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col items-center gap-2 hover:shadow-md transition"
                  >
                    <div className="relative w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                      {badge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                          {badge > 9 ? '9+' : badge}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-gray-700 text-center leading-tight">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })()}

    </div>
  )
}

function StatCard({
  label, value, icon, color, onClick,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'orange' | 'purple'
  /** Sans onClick, la carte reste informative (pas de clic) — ex. RDV côté Enezo,
   *  où /planning est réservé au coaching. */
  onClick?: () => void
}) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  const content = (
    <>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </>
  )
  if (!onClick) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left w-full">
        {content}
      </div>
    )
  }
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition w-full"
    >
      {content}
    </button>
  )
}