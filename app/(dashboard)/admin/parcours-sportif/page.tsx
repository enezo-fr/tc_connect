'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useUsers } from '@/hooks/useUsers'
import { useParcoursIndications } from '@/hooks/useParcoursIndications'
import { statutIndication, fmtPlage } from '@/lib/parcoursIndications'
import { IndicationBanner } from '@/components/parcours/IndicationBanner'
import { collection, query, orderBy, onSnapshot, getDocs, where, Timestamp, doc, deleteDoc, updateDoc, runTransaction } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { copyText } from '@/lib/clipboard'
import { randomUUID } from '@/lib/uuid'
import { addParcoursActivite } from '@/lib/parcoursPlanning'
import { participantKey } from '@/lib/parcoursNotes'
import { useAuth } from '@/context/AuthContext'
import { useBrand } from '@/context/BrandContext'
import { publicLinkOrigin } from '@/lib/brand'
import { useRouter, useSearchParams } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import {
  PlusIcon, CalendarIcon, MapPinIcon, UsersIcon, UserPlusIcon,
  ChevronRightIcon, BanknotesIcon, ClipboardDocumentIcon,
  CheckIcon, ShareIcon, ChatBubbleLeftIcon, FireIcon, TrashIcon,
  EyeIcon, EyeSlashIcon, Cog6ToothIcon, ExclamationTriangleIcon, ClipboardDocumentListIcon, MegaphoneIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarSolid } from '@heroicons/react/24/solid'

interface Review {
  id: string
  name: string
  email?: string
  rating: number
  comment: string
  photoUrl?: string | null
  createdAt?: Timestamp
}

interface Session {
  id: string
  title: string
  date: Timestamp
  location: string
  maxSpots: number
  registeredCount: number
  status: 'open' | 'full' | 'cancelled'
  price?: number
  hidden?: boolean
}

function fmtDate(ts: Timestamp) {
  return ts.toDate().toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}
function fmtHeure(ts: Timestamp) {
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Formatage des noms : NOM en majuscules, Prénom en nom propre
const toUpperName = (s: string) => s.toUpperCase()
const toProperName = (s: string) =>
  s.split(/([\s-])/).map((p) => /[\s-]/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('')

function sessionBadge(s: Session) {
  const isPast = s.date.toMillis() < Date.now()
  if (s.status === 'cancelled') return { label: 'Annulée', variant: 'danger' as const }
  if (isPast) return { label: 'Passée', variant: 'gray' as const }
  if (s.status === 'full') return { label: 'Complet', variant: 'warning' as const }
  return { label: 'Ouverte', variant: 'success' as const }
}

export default function AdminParcoursPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const { brand } = useBrand()
  const { indications } = useParcoursIndications()

  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [paidBySession, setPaidBySession] = useState<Record<string, number>>({})
  const [pendingBySession, setPendingBySession] = useState<Record<string, number>>({})
  const [evoYear, setEvoYear] = useState<'all' | number>('all')
  const [evoMonth, setEvoMonth] = useState<'all' | number>('all')
  // Filtres séances — restaurés depuis sessionStorage pour survivre à un aller-retour
  // vers une fiche séance (on revient sur le même filtre, ex. « Passés »).
  const [sessionView, setSessionView] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [sessionYear, setSessionYear] = useState<'all' | number>('all')
  const [sessionMonth, setSessionMonth] = useState<'all' | number>('all')
  const [filtersReady, setFiltersReady] = useState(false)
  const [confirmHide, setConfirmHide] = useState<string | null>(null)

  // Ajout manuel d'un participant (depuis la page principale)
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [addSessionIds, setAddSessionIds] = useState<Set<string>>(new Set())
  const [addIncludePast, setAddIncludePast] = useState(false)
  const [addingParticipant, setAddingParticipant] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')
  const [showAddSuggestions, setShowAddSuggestions] = useState(false)

  // Annuaire des candidats : utilisateurs de l'app + anciens inscrits (chargé à l'ouverture du modal)
  const { users } = useUsers()
  const [registrantDirectory, setRegistrantDirectory] = useState<{ firstName: string; lastName: string; email: string; phone: string }[]>([])
  // Map sessionId → Set de clés normalisées des inscrits (pour détecter les doublons dans le modal)
  const [sessionKeyMap, setSessionKeyMap] = useState<Map<string, Set<string>>>(new Map())
  const dirLoadedRef = useRef(false)
  useEffect(() => {
    if (!showAddParticipant || dirLoadedRef.current) return
    dirLoadedRef.current = true
    getDocs(collection(db, 'registrations')).then((snap) => {
      const dirMap = new Map<string, { firstName: string; lastName: string; email: string; phone: string }>()
      const skMap = new Map<string, Set<string>>()
      snap.docs.forEach((d) => {
        const r = d.data() as any
        const c = { firstName: r.firstName ?? '', lastName: r.lastName ?? '', email: r.email ?? '', phone: r.phone ?? '' }
        if (!c.firstName && !c.lastName && !c.email) return
        const key = (c.email || `${c.firstName}|${c.lastName}`).toLowerCase()
        const prev = dirMap.get(key)
        if (!prev || ((!prev.phone && c.phone) || (!prev.email && c.email))) dirMap.set(key, c)
        // Tracking par séance (hors désinscrits)
        if (r.sessionId && r.attendance !== 'deregistered') {
          if (!skMap.has(r.sessionId)) skMap.set(r.sessionId, new Set())
          skMap.get(r.sessionId)!.add(key)
        }
      })
      setRegistrantDirectory(Array.from(dirMap.values()))
      setSessionKeyMap(skMap)
    }).catch(() => {})
  }, [showAddParticipant])

  const addCandidates = useMemo(() => {
    const map = new Map<string, { firstName: string; lastName: string; email: string; phone: string }>()
    users.forEach((u: any) => {
      const c = { firstName: u.prenom ?? '', lastName: u.nom ?? '', email: u.email ?? '', phone: u.phone_number ?? '' }
      if (!c.firstName && !c.lastName && !c.email) return
      map.set((c.email || `${c.firstName}|${c.lastName}`).toLowerCase(), c)
    })
    registrantDirectory.forEach((c) => {
      const key = (c.email || `${c.firstName}|${c.lastName}`).toLowerCase()
      if (!map.has(key)) map.set(key, c)
    })
    return Array.from(map.values())
  }, [users, registrantDirectory])

  // Clé normalisée de la personne en cours de saisie (pour détecter si déjà inscrite)
  const addFormKey = (addForm.email.trim() || `${addForm.firstName}|${addForm.lastName}`).toLowerCase()

  // Sessions sélectionnées où cette personne est déjà inscrite
  const duplicateSessionIds = useMemo(() => {
    if (!addForm.firstName.trim() && !addForm.email.trim()) return new Set<string>()
    const result = new Set<string>()
    addSessionIds.forEach((sid) => { if (sessionKeyMap.get(sid)?.has(addFormKey)) result.add(sid) })
    return result
  }, [addSessionIds, addFormKey, sessionKeyMap])

  const addNameQuery = `${addForm.firstName} ${addForm.lastName} ${addForm.email}`.trim().toLowerCase()
  const addNameSuggestions = useMemo(() => {
    if (addNameQuery.length < 2) return []
    return addCandidates.filter((c) => {
      const f = c.firstName.toLowerCase(), l = c.lastName.toLowerCase(), em = c.email.toLowerCase()
      return `${f} ${l}`.includes(addNameQuery) || `${l} ${f}`.includes(addNameQuery)
        || f.startsWith(addNameQuery) || l.startsWith(addNameQuery) || em.includes(addNameQuery)
    }).slice(0, 6)
  }, [addCandidates, addNameQuery])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ps_admin_filters')
      if (raw) {
        const f = JSON.parse(raw)
        if (f.view) setSessionView(f.view)
        if (f.year !== undefined) setSessionYear(f.year)
        if (f.month !== undefined) setSessionMonth(f.month)
      }
    } catch {}
    setFiltersReady(true)
  }, [])

  useEffect(() => {
    if (!filtersReady) return
    try {
      sessionStorage.setItem('ps_admin_filters', JSON.stringify({ view: sessionView, year: sessionYear, month: sessionMonth }))
    } catch {}
  }, [filtersReady, sessionView, sessionYear, sessionMonth])
  const [copied, setCopied] = useState(false)
  const [homonymCount, setHomonymCount] = useState(0)
  const [reviews, setReviews] = useState<Review[]>([])
  const [deleteReviewConfirm, setDeleteReviewConfirm] = useState<string | null>(null)
  const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(highlightId)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [filterReviewStars, setFilterReviewStars] = useState(0)
  const [filterReviewYear, setFilterReviewYear] = useState<number | null>(null)

  const reviewYears = Array.from(
    new Set(reviews.map((r) => r.createdAt?.toDate().getFullYear()).filter((y): y is number => !!y))
  ).sort((a, b) => b - a)
  const filteredReviews = reviews.filter((r) => {
    if (filterReviewStars > 0 && r.rating !== filterReviewStars) return false
    if (filterReviewYear && r.createdAt?.toDate().getFullYear() !== filterReviewYear) return false
    return true
  })

  const downloadPhoto = async (url: string, name: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { window.open(url, '_blank') }
  }

  // Scroll vers + surligner l'avis depuis une notification
  useEffect(() => {
    if (!highlightedReviewId || !reviews.length) return
    const scrollT = setTimeout(() => {
      const el = document.getElementById(`review-${highlightedReviewId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
    const clearT = setTimeout(() => setHighlightedReviewId(null), 5000)
    return () => { clearTimeout(scrollT); clearTimeout(clearT) }
  }, [highlightedReviewId, reviews])

  useEffect(() => {
    if (!isAdmin) return
    const q = query(collection(db, 'parcours_reviews'), orderBy('createdAt', 'desc'))
    return onSnapshot(q,
      (snap) => setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Review))),
      () => setReviews([])
    )
  }, [isAdmin])

  const handleDeleteReview = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'parcours_reviews', id))
    } catch (e) {
      console.error('[deleteReview]', e)
    }
    setDeleteReviewConfirm(null)
  }

  // Lien partagé à l'extérieur → domaine de l'ESPACE ACTIF (cf. publicLinkOrigin), pas celui
  // depuis lequel on navigue (une PWA installée sur app.enezo.fr donnerait un lien Enezo).
  const publicUrl = `${publicLinkOrigin(brand, typeof window !== 'undefined' ? window.location.origin : '')}/parcours-sportif`
  const shareMessage = `Inscris-toi aux Parcours Sportifs de Teddy Coaching ! 🏃\n${publicUrl}`

  const copyLink = async () => {
    const ok = await copyText(publicUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      // Dernier recours : on propose à l'utilisateur de copier manuellement
      window.prompt('Copiez le lien ci-dessous :', publicUrl)
    }
  }

  const shareNative = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Parcours Sportifs — Teddy Coaching', text: shareMessage, url: publicUrl })
      } catch { /* annulé */ }
    } else {
      copyLink()
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    const q = query(collection(db, 'sessions'), orderBy('date', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Session)))
      setLoading(false)
    })
    return unsub
  }, [isAdmin])

  // Détection d'homonymes (mêmes prénom+nom, clés différentes) pour alerter sur le bouton Participants
  useEffect(() => {
    if (!isAdmin) return
    getDocs(collection(db, 'registrations')).then((snap) => {
      const keyToName = new Map<string, { f: string; l: string }>()
      snap.docs.forEach((d) => {
        const r = d.data() as any
        if (r.attendance === 'deregistered') return
        const f = (r.firstName ?? '').trim(), l = (r.lastName ?? '').trim()
        if (!f && !l && !r.email) return
        const key = participantKey({ email: r.email, firstName: f, lastName: l })
        if (!keyToName.has(key)) keyToName.set(key, { f, l })
      })
      const nameGroups = new Map<string, Set<string>>()
      keyToName.forEach((name, key) => {
        const nameKey = `${name.f.toLowerCase()}|${name.l.toLowerCase()}`
        if (!nameKey.replace('|', '').trim()) return
        if (!nameGroups.has(nameKey)) nameGroups.set(nameKey, new Set())
        nameGroups.get(nameKey)!.add(key)
      })
      let count = 0
      nameGroups.forEach((keys) => { if (keys.size > 1) count += keys.size })
      setHomonymCount(count)
    }).catch(() => {})
  }, [isAdmin])

  // Load paid registration counts for financial stats
  useEffect(() => {
    if (!isAdmin || sessions.length === 0) return
    const load = async () => {
      const snap = await getDocs(
        query(collection(db, 'registrations'), where('paymentStatus', 'in', ['cash', 'transfer', 'prepaid']))
      )
      const counts: Record<string, number> = {}
      snap.docs.forEach((d) => {
        const data = d.data()
        if (data.attendance === 'deregistered') return // désinscrit → ne compte pas
        const sid = data.sessionId
        counts[sid] = (counts[sid] ?? 0) + 1
      })
      setPaidBySession(counts)
    }
    load()
  }, [isAdmin, sessions.length])

  // Load impayés (inscriptions « en attente », hors désinscrits) par séance
  useEffect(() => {
    if (!isAdmin || sessions.length === 0) return
    const load = async () => {
      const snap = await getDocs(
        query(collection(db, 'registrations'), where('paymentStatus', '==', 'pending'))
      )
      const counts: Record<string, number> = {}
      snap.docs.forEach((d) => {
        const data = d.data()
        // Un absent ou un désinscrit ne doit pas compter comme impayé
        if (data.attendance === 'deregistered' || data.attendance === 'absent') return
        const sid = data.sessionId
        counts[sid] = (counts[sid] ?? 0) + 1
      })
      setPendingBySession(counts)
    }
    load()
  }, [isAdmin, sessions.length])

  const now = Date.now()
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()

  const financials = useMemo(() => {
    let yearTotal = 0, monthTotal = 0          // encaissé (inscriptions réglées)
    let yearProjected = 0, monthProjected = 0  // projeté (si tous les inscrits restent)
    for (const s of sessions) {
      if (s.status === 'cancelled') continue
      const price = s.price ?? 5
      const paid = paidBySession[s.id] ?? 0
      const earned = paid * price
      const projected = s.registeredCount * price
      const d = s.date?.toDate?.()
      if (!d) continue
      if (d.getFullYear() === currentYear) { yearTotal += earned; yearProjected += projected }
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) { monthTotal += earned; monthProjected += projected }
    }
    return { yearTotal, monthTotal, yearProjected, monthProjected }
  }, [sessions, paidBySession, currentYear, currentMonth])

  // Historique mensuel (gains projetés + encaissés) pour visualiser l'évolution
  const monthlyStats = useMemo(() => {
    const map = new Map<string, { year: number; month: number; projete: number; encaisse: number; inscrits: number; seances: number }>()
    for (const s of sessions) {
      if (s.status === 'cancelled') continue
      const d = s.date?.toDate?.()
      if (!d) continue
      const price = s.price ?? 5
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const cur = map.get(key) ?? { year: d.getFullYear(), month: d.getMonth(), projete: 0, encaisse: 0, inscrits: 0, seances: 0 }
      cur.projete += s.registeredCount * price
      cur.encaisse += (paidBySession[s.id] ?? 0) * price
      cur.inscrits += s.registeredCount
      cur.seances += 1
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
  }, [sessions, paidBySession])

  const upcoming = sessions.filter((s) => s.status !== 'cancelled' && s.date.toMillis() >= now)
  const past = sessions.filter((s) => s.status === 'cancelled' || s.date.toMillis() < now)

  // À venir : du plus proche d'aujourd'hui au plus lointain. Passés : du plus récent au plus ancien.
  const upcomingSorted = [...upcoming].sort((a, b) => a.date.toMillis() - b.date.toMillis())
  const pastSorted = [...past].sort((a, b) => b.date.toMillis() - a.date.toMillis())
  const sessionYearsAvailable = Array.from(
    new Set(sessions.map((s) => s.date?.toDate?.().getFullYear()).filter((y): y is number => !!y))
  ).sort((a, b) => b - a)
  const displayedSessions = (() => {
    const base = sessionView === 'upcoming' ? upcomingSorted
      : sessionView === 'past' ? pastSorted
      : [...sessions].sort((a, b) => a.date.toMillis() - b.date.toMillis())
    return base.filter((s) => {
      const d = s.date?.toDate?.()
      if (!d) return false
      return (sessionYear === 'all' || d.getFullYear() === sessionYear)
        && (sessionMonth === 'all' || d.getMonth() === sessionMonth)
    })
  })()

  // Séances sélectionnables pour l'ajout manuel (passées incluses si demandé)
  const addSelectableSessions = sessions
    .filter((s) => s.status !== 'cancelled')
    .filter((s) => addIncludePast || s.date.toMillis() >= now)
    .sort((a, b) => b.date.toMillis() - a.date.toMillis())

  const openAddParticipant = () => {
    setAddForm({ firstName: '', lastName: '', email: '', phone: '' })
    setAddSessionIds(new Set())
    setAddIncludePast(false)
    setAddError('')
    setAddSuccess('')
    setShowAddSuggestions(false)
    setShowAddParticipant(true)
  }

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.firstName.trim()) { setAddError('Le prénom est obligatoire.'); return }
    if (addSessionIds.size === 0) { setAddError('Sélectionnez au moins une date.'); return }
    setAddError(''); setAddSuccess(''); setAddingParticipant(true)

    const registerOne = async (sess: Session) => {
      const regId = await runTransaction(db, async (tx) => {
        const sessionRef = doc(db, 'sessions', sess.id)
        const snap = await tx.get(sessionRef)
        if (!snap.exists()) throw new Error('introuvable')
        const data = snap.data()
        if ((data.registeredCount ?? 0) >= data.maxSpots) throw new Error('complète')
        const newCount = (data.registeredCount ?? 0) + 1
        const regRef = doc(collection(db, 'registrations'))
        tx.set(regRef, {
          sessionId: sess.id,
          firstName: addForm.firstName.trim(),
          lastName: addForm.lastName.trim(),
          email: addForm.email.trim().toLowerCase(),
          phone: addForm.phone.trim(),
          suggestions: '',
          paymentStatus: 'pending',
          attendance: 'unknown',
          registeredAt: Timestamp.now(),
          uniqueToken: randomUUID(),
        })
        tx.update(sessionRef, { registeredCount: newCount, status: newCount >= data.maxSpots ? 'full' : 'open' })
        return regRef.id
      })
      // Rattache au planning si l'email correspond à un compte
      if (regId && addForm.email.trim()) {
        try {
          const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', addForm.email.trim().toLowerCase())))
          if (!uSnap.empty) await addParcoursActivite({ userId: uSnap.docs[0].id, registrationId: regId, sessionId: sess.id, session: sess as any })
        } catch {}
      }
    }

    const targets = sessions.filter((s) => addSessionIds.has(s.id))
    let ok = 0
    const failed: string[] = []
    for (const t of targets) {
      try { await registerOne(t); ok++ }
      catch (err: any) {
        const d = t.date?.toDate?.().toLocaleDateString('fr-FR') ?? ''
        failed.push(`${d} (${err?.message === 'complète' ? 'complète' : 'erreur'})`)
      }
    }

    if (ok === 0) {
      setAddError(failed.length ? `Aucun ajout — ${failed.join(', ')}` : "Erreur lors de l'ajout")
    } else {
      setAddSuccess(`${ok} inscription${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}${failed.length ? ` (échecs : ${failed.join(', ')})` : ''}`)
      setAddForm({ firstName: '', lastName: '', email: '', phone: '' })
      setAddSessionIds(new Set())
    }
    setAddingParticipant(false)
  }

  if (!isAdmin) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Accès réservé aux administrateurs.</p></div>
  }

  const SessionCard = ({ s }: { s: Session }) => {
    const badge = sessionBadge(s)
    const price = s.price ?? 5
    const earned = (paidBySession[s.id] ?? 0) * price
    // Impayés : inscriptions « en attente » sur une séance déjà passée
    const isPast = s.date.toMillis() < now
    const nbImpayes = isPast ? (pendingBySession[s.id] ?? 0) : 0
    return (
      <div className={`w-full flex items-center gap-3 bg-white border rounded-2xl p-4 hover:border-blue-200 hover:shadow-sm transition ${
        nbImpayes > 0 ? 'border-red-200 ring-1 ring-red-100' : s.hidden ? 'border-gray-300 opacity-70' : 'border-gray-100'
      }`}>
        <button
          onClick={() => router.push(`/admin/parcours-sportif/${s.id}`)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900">{s.title}</span>
            <Badge label={badge.label} variant={badge.variant} />
            {nbImpayes > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">
                ⚠ {nbImpayes} impayé{nbImpayes > 1 ? 's' : ''}
              </span>
            )}
            {s.hidden && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                <EyeSlashIcon className="w-3 h-3" /> Masquée
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <CalendarIcon className="w-3.5 h-3.5 text-gray-400" />
              <span className="capitalize">{fmtDate(s.date)} à {fmtHeure(s.date)}</span>
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <UsersIcon className="w-3.5 h-3.5 text-gray-400" />{s.registeredCount}/{s.maxSpots}
            </span>
            {earned > 0 && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-700">
                <BanknotesIcon className="w-3.5 h-3.5" />{earned.toFixed(2)}€ encaissés
              </span>
            )}
          </div>
        </button>
        {confirmHide === s.id ? (
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500 hidden sm:inline">{s.hidden ? 'Rendre visible ?' : 'Masquer ?'}</span>
            <button
              onClick={(e) => { e.stopPropagation(); updateDoc(doc(db, 'sessions', s.id), { hidden: !s.hidden }); setConfirmHide(null) }}
              className={`text-[11px] font-semibold px-2 py-1 rounded-lg text-white transition ${s.hidden ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-800'}`}>
              Oui
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmHide(null) }}
              className="text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Non
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmHide(s.id) }}
            title={s.hidden ? 'Rendre visible' : 'Masquer'}
            className={`shrink-0 p-2 rounded-lg border transition ${s.hidden ? 'border-green-200 text-green-600 hover:bg-green-50' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}
          >
            {s.hidden ? <EyeIcon className="w-4 h-4" /> : <EyeSlashIcon className="w-4 h-4" />}
          </button>
        )}
        <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
            <FireIcon className="w-5 h-5 text-orange-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-800">Parcours Sportif</h1>
            <p className="text-sm text-gray-500">Séances de sport en groupe</p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 -my-1.5 px-1 py-1.5 sm:mx-0 sm:my-0 sm:px-0 sm:py-0 sm:overflow-visible sm:flex-wrap sm:justify-end">
          <button
            onClick={() => router.push(`/admin/parcours-sportif/participants${homonymCount > 0 ? '?filter=homonyms' : ''}`)}
            className="relative flex items-center gap-2 shrink-0 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title={homonymCount > 0 ? `${homonymCount} homonyme${homonymCount > 1 ? 's' : ''} à vérifier` : 'Listing des participants'}
          >
            <UsersIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Participants</span>
            {homonymCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {homonymCount}
              </span>
            )}
          </button>
          <button
            onClick={() => router.push('/admin/parcours-sportif/template')}
            className="flex items-center gap-2 shrink-0 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title="Template de séance"
          >
            <ClipboardDocumentListIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Template</span>
          </button>
          <button
            onClick={() => router.push('/admin/parcours-sportif/indications')}
            className="flex items-center gap-2 shrink-0 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title="Indications / informations affichées aux visiteurs"
          >
            <MegaphoneIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Indications</span>
          </button>
          <button
            onClick={() => router.push('/admin/parcours-sportif/parametres')}
            className="flex items-center gap-2 shrink-0 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title="Paramètres"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Paramètres</span>
          </button>
          <button
            onClick={openAddParticipant}
            className="flex items-center gap-2 shrink-0 border border-blue-200 text-blue-700 hover:bg-blue-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title="Ajouter un participant manuellement"
          >
            <UserPlusIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Ajouter un participant</span>
          </button>
          <button
            onClick={() => router.push('/admin/parcours-sportif/nouvelle-seance')}
            className="flex items-center gap-2 shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <PlusIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Nouvelle séance</span>
          </button>
        </div>
      </div>

      {/* Indications actives / à venir (résumé) */}
      {(() => {
        const visibles = indications.filter((i) => statutIndication(i) !== 'expirée')
        if (visibles.length === 0) return null
        return (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <MegaphoneIcon className="w-4 h-4 text-gray-400" />
                Indications affichées aux visiteurs ({visibles.length})
              </h2>
              <button onClick={() => router.push('/admin/parcours-sportif/indications')}
                className="text-xs font-medium text-blue-700 hover:underline shrink-0">Gérer</button>
            </div>
            <div className="space-y-2">
              {visibles.map((i) => {
                const statut = statutIndication(i)
                return (
                  <div key={i.id} className="flex items-start gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
                      statut === 'active' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {statut === 'active' ? 'Active' : 'À venir'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <IndicationBanner indication={i} compact />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {i.portee === 'global'
                          ? (i.surSeances === false ? 'En haut de la page seulement' : 'Tout le parcours')
                          : 'Séance précise'} · {fmtPlage(i.dateDebut, i.dateFin)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Bilan financier global */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Cette année ({currentYear})</p>
          <p className="text-2xl font-bold text-gray-900">{financials.yearTotal.toFixed(2)}€</p>
          <p className="text-[11px] text-blue-600 mt-0.5">Projeté : {financials.yearProjected.toFixed(2)}€</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Ce mois</p>
          <p className="text-2xl font-bold text-gray-900">{financials.monthTotal.toFixed(2)}€</p>
          <p className="text-[11px] text-blue-600 mt-0.5">Projeté : {financials.monthProjected.toFixed(2)}€ <span className="text-gray-400">(si tous restent)</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Séances à venir</p>
          <p className="text-2xl font-bold text-gray-900">{upcoming.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Total inscrits (à venir)</p>
          <p className="text-2xl font-bold text-gray-900">
            {upcoming.reduce((s, sess) => s + sess.registeredCount, 0)}
          </p>
        </div>
      </div>

      {/* Évolution mensuelle des gains */}
      {monthlyStats.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Évolution mensuelle des gains</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-200 inline-block" />Projeté (si tous restent)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500 inline-block" />Encaissé</span>
            </div>
          </div>

          {/* Filtres année / mois */}
          {(() => {
            const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
            const allYears = Array.from(new Set(monthlyStats.map((m) => m.year))).sort((a, b) => b - a)
            return (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <select value={String(evoYear)} onChange={(e) => setEvoYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="all">Toutes les années</option>
                  {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={String(evoMonth)} onChange={(e) => setEvoMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="all">Tous les mois</option>
                  {MONTHS_FULL.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
                {(evoYear !== 'all' || evoMonth !== 'all') && (
                  <button onClick={() => { setEvoYear('all'); setEvoMonth('all') }}
                    className="text-xs text-gray-400 hover:text-gray-600 underline">Réinitialiser</button>
                )}
              </div>
            )
          })()}

          {(() => {
            const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
            const filtered = monthlyStats.filter((m) =>
              (evoYear === 'all' || m.year === evoYear) && (evoMonth === 'all' || m.month === evoMonth)
            )
            if (filtered.length === 0) return <p className="text-sm text-gray-400 text-center py-4">Aucune donnée pour cette période.</p>
            const maxProj = Math.max(...filtered.map((m) => m.projete), 1)
            const years = Array.from(new Set(filtered.map((m) => m.year))).sort((a, b) => b - a)
            return years.map((year) => {
              const rows = filtered.filter((m) => m.year === year).sort((a, b) => b.month - a.month)
              const yearProj = rows.reduce((s, m) => s + m.projete, 0)
              const yearEnc = rows.reduce((s, m) => s + m.encaisse, 0)
              return (
                <div key={year} className="mb-4 last:mb-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-800">{year}</p>
                    <p className="text-xs text-gray-500">Projeté <span className="text-blue-600 font-medium">{yearProj.toFixed(0)}€</span> · Encaissé <span className="text-green-600 font-medium">{yearEnc.toFixed(0)}€</span></p>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((m) => (
                      <div key={m.key} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-12 shrink-0">{MONTHS[m.month]}</span>
                        <div className="flex-1 h-5 bg-gray-100 rounded-md overflow-hidden relative min-w-0">
                          <div className="h-full bg-blue-200" style={{ width: `${(m.projete / maxProj) * 100}%` }} />
                          <div className="h-full bg-green-500 absolute top-0 left-0" style={{ width: `${(m.encaisse / maxProj) * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-700 w-24 text-right shrink-0">
                          <span className="font-medium">{m.projete.toFixed(0)}€</span> <span className="text-green-600">({m.encaisse.toFixed(0)}€)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Lien public + partage */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-blue-800">Page publique d'inscription</p>
            <p className="text-xs text-blue-600 truncate">{publicUrl}</p>
          </div>
          <a href="/parcours-sportif" target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-blue-700 border border-blue-300 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition shrink-0">
            Voir
          </a>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={copyLink}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-300 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
            {copied ? 'Lien copié !' : 'Copier le lien'}
          </button>
          <a href={`sms:?body=${encodeURIComponent(shareMessage)}`}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-300 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">
            <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
            SMS
          </a>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-green-700 border border-green-300 bg-white hover:bg-green-50 px-3 py-1.5 rounded-lg transition">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.15-1.7-.85-2-.95-.25-.1-.45-.15-.65.15-.2.3-.75.95-.9 1.1-.2.15-.35.2-.65.05-.3-.15-1.25-.45-2.4-1.5-.9-.8-1.5-1.75-1.65-2.05-.15-.3 0-.45.15-.6.15-.15.3-.35.45-.55.15-.2.2-.3.3-.5.1-.2.05-.4-.05-.55-.1-.15-.65-1.55-.9-2.15-.2-.55-.45-.45-.65-.45h-.55c-.2 0-.5.05-.75.35-.25.3-.95.95-.95 2.3 0 1.35.95 2.65 1.1 2.85.15.2 1.9 2.9 4.6 4.05.65.3 1.15.45 1.55.55.65.2 1.25.2 1.7.1.5-.05 1.55-.65 1.75-1.25.2-.6.2-1.15.15-1.25-.05-.1-.25-.15-.55-.3M12 2C6.5 2 2 6.5 2 12c0 1.75.45 3.45 1.3 4.95L2 22l5.2-1.35C8.65 21.55 10.3 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2"/></svg>
            WhatsApp
          </a>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button onClick={shareNative}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition">
              <ShareIcon className="w-3.5 h-3.5" />
              Partager…
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Filtres séances */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {([['upcoming', 'À venir'], ['past', 'Passés'], ['all', 'Tous']] as const).map(([val, label]) => (
                <button key={val} onClick={() => setSessionView(val)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${sessionView === val ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
            <select value={String(sessionYear)} onChange={(e) => setSessionYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">Toutes les années</option>
              {sessionYearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={String(sessionMonth)} onChange={(e) => setSessionMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">Tous les mois</option>
              {['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'].map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            {(sessionYear !== 'all' || sessionMonth !== 'all') && (
              <button onClick={() => { setSessionYear('all'); setSessionMonth('all') }}
                className="text-xs text-gray-400 hover:text-gray-600 underline">Réinitialiser</button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{displayedSessions.length} séance{displayedSessions.length > 1 ? 's' : ''}</span>
          </div>

          {displayedSessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <CalendarIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Aucune séance pour cette sélection</p>
            </div>
          ) : displayedSessions.map((s) => <SessionCard key={s.id} s={s} />)}
        </div>
      )}

      {/* ── Avis ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <StarSolid className="w-4 h-4 text-yellow-400" />
            Avis des participants ({filteredReviews.length}{filteredReviews.length !== reviews.length ? ` / ${reviews.length}` : ''})
          </h2>
        </div>

        {/* Filtres avis */}
        {reviews.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              {[5, 4, 3, 2, 1].map((n) => (
                <button key={n} onClick={() => setFilterReviewStars(filterReviewStars === n ? 0 : n)}
                  className={`flex items-center gap-0.5 text-xs font-medium px-2 py-1 rounded-lg border transition ${filterReviewStars === n ? 'bg-yellow-400 text-white border-yellow-400' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {n}<StarSolid className="w-3 h-3" />
                </button>
              ))}
            </div>
            {reviewYears.length > 0 && (
              <select value={filterReviewYear ?? ''} onChange={(e) => setFilterReviewYear(e.target.value ? Number(e.target.value) : null)}
                className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                <option value="">Toutes les années</option>
                {reviewYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            {(filterReviewStars > 0 || filterReviewYear) && (
              <button onClick={() => { setFilterReviewStars(0); setFilterReviewYear(null) }}
                className="text-xs text-gray-400 hover:text-gray-600 underline">
                Réinitialiser
              </button>
            )}
          </div>
        )}

        {reviews.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <StarSolid className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Aucun avis pour l'instant</p>
          </div>
        ) : filteredReviews.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <StarSolid className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Aucun avis ne correspond à ces filtres</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredReviews.map((r) => (
              <div
                key={r.id}
                id={`review-${r.id}`}
                className={`bg-white border rounded-2xl shadow-sm p-4 transition-all duration-700 ${highlightedReviewId === r.id ? 'border-amber-300 bg-amber-50 ring-2 ring-amber-300' : 'border-gray-100'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {r.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{r.name}</p>
                      {r.email && <p className="text-[11px] text-gray-400 truncate">{r.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <StarSolid key={n} className={`w-3.5 h-3.5 ${n <= r.rating ? 'text-yellow-400' : 'text-gray-200'}`} />
                    ))}
                  </div>
                </div>
                {r.photoUrl && (
                  <div
                    className="mb-2 rounded-lg overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center cursor-zoom-in"
                    onClick={() => setLightboxUrl(r.photoUrl!)}
                  >
                    <img src={r.photoUrl} alt="" loading="lazy"
                      className="max-h-36 w-auto object-contain" />
                  </div>
                )}
                <p className="text-sm text-gray-600 leading-relaxed">{r.comment}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  {r.createdAt ? (
                    <p className="text-[11px] text-gray-400">
                      {r.createdAt.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  ) : <span />}
                  {deleteReviewConfirm === r.id ? (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setDeleteReviewConfirm(null)}
                        className="text-[11px] border border-gray-200 px-2 py-0.5 rounded-md hover:bg-gray-50">Non</button>
                      <button onClick={() => handleDeleteReview(r.id)}
                        className="text-[11px] text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md">Supprimer</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteReviewConfirm(r.id)}
                      className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-red-500 transition">
                      <TrashIcon className="w-3.5 h-3.5" />
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox photo ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Avis photo"
            className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex items-center gap-3 mt-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => downloadPhoto(lightboxUrl, `avis-parcours-${Date.now()}.jpg`)}
              className="flex items-center gap-2 bg-white text-gray-800 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" /></svg>
              Télécharger
            </button>
            <button
              onClick={() => setLightboxUrl(null)}
              className="flex items-center gap-2 bg-white/20 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-white/30 transition"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Ajout manuel d'un participant ── */}
      <Modal isOpen={showAddParticipant} onClose={() => setShowAddParticipant(false)} title="Ajouter un participant" size="lg">
        <form onSubmit={handleAddParticipant} className="space-y-4">
          {/* Recherche / suggestions (utilisateurs de l'app + anciens inscrits) */}
          <div className="relative">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prénom *</label>
                <input type="text" value={addForm.firstName}
                  onChange={(e) => { setAddForm((f) => ({ ...f, firstName: toProperName(e.target.value) })); setShowAddSuggestions(true) }}
                  onFocus={() => setShowAddSuggestions(true)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                <input type="text" value={addForm.lastName}
                  onChange={(e) => { setAddForm((f) => ({ ...f, lastName: toUpperName(e.target.value) })); setShowAddSuggestions(true) }}
                  onFocus={() => setShowAddSuggestions(true)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={addForm.email}
                  onChange={(e) => { setAddForm((f) => ({ ...f, email: e.target.value })); setShowAddSuggestions(true) }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone</label>
                <input type="tel" value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            {showAddSuggestions && addNameSuggestions.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-xl shadow-lg bg-white divide-y divide-gray-50 overflow-hidden">
                {addNameSuggestions.map((c, i) => (
                  <button key={i} type="button"
                    onClick={() => {
                      setAddForm({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone })
                      setShowAddSuggestions(false)
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50 transition">
                    <span className="text-sm text-gray-800 truncate">
                      {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}
                    </span>
                    {c.email && <span className="text-xs text-gray-400 truncate shrink-0">{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sélection des dates */}
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">Inscrire à ces dates</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={addIncludePast}
                  onChange={(e) => setAddIncludePast(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                Inclure les dates passées
              </label>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {addSelectableSessions.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Aucune date disponible.</p>
              ) : addSelectableSessions.map((s) => {
                const left = s.maxSpots - s.registeredCount
                const isPast = s.date.toMillis() < now
                const checked = addSessionIds.has(s.id)
                const isDuplicate = duplicateSessionIds.has(s.id)
                return (
                  <label key={s.id} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition ${isDuplicate ? 'border-amber-200 bg-amber-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setAddSessionIds((prev) => {
                        const next = new Set(prev)
                        next.has(s.id) ? next.delete(s.id) : next.add(s.id)
                        return next
                      })}
                      className="w-4 h-4 accent-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 capitalize truncate">
                        {fmtDate(s.date)} à {fmtHeure(s.date)}
                        {isPast && <span className="ml-1.5 text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">passée</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{s.title} — {left > 0 ? `${left} place${left > 1 ? 's' : ''}` : 'complète'}</p>
                    </div>
                    {isDuplicate && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 shrink-0">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                        Déjà inscrit
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
            {addSessionIds.size > 0 && (
              <p className="text-xs font-medium text-blue-600 mt-2">{addSessionIds.size} date{addSessionIds.size > 1 ? 's' : ''} sélectionnée{addSessionIds.size > 1 ? 's' : ''}</p>
            )}
          </div>

          {duplicateSessionIds.size > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Cette personne est peut-être déjà inscrite à {duplicateSessionIds.size === 1 ? 'une date sélectionnée' : `${duplicateSessionIds.size} dates sélectionnées`}. L'ajout reste possible si voulu.
              </p>
            </div>
          )}
          {addError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{addError}</p>}
          {addSuccess && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">{addSuccess}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setShowAddParticipant(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Fermer</button>
            <button type="submit" disabled={addingParticipant}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition">
              {addingParticipant ? 'Ajout…' : 'Ajouter le participant'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
