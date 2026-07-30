'use client'

import { use, useState, useEffect, useMemo, useRef } from 'react'
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot,
  updateDoc, runTransaction, Timestamp, addDoc, getDocs, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { copyText } from '@/lib/clipboard'
import { randomUUID } from '@/lib/uuid'
import { addParcoursActivite, removeParcoursActivite, removeParcoursActivitesForSession } from '@/lib/parcoursPlanning'
import { useAuth } from '@/context/AuthContext'
import { useBrand } from '@/context/BrandContext'
import { publicLinkOrigin } from '@/lib/brand'
import { useUsers } from '@/hooks/useUsers'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeftIcon, TrashIcon, ClipboardDocumentIcon,
  ExclamationTriangleIcon, UsersIcon, CalendarIcon, MapPinIcon,
  CheckCircleIcon, XCircleIcon, BanknotesIcon, PlusIcon,
  MagnifyingGlassIcon, ChatBubbleLeftIcon, PencilIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { useParcoursNotes } from '@/hooks/useParcoursNotes'
import ParticipantNotesModal from '@/components/parcours/ParticipantNotesModal'
import { participantKey, noteRemaining, isAdvanceAvailable } from '@/lib/parcoursNotes'
import type { ParcoursNote, ParcoursNoteApplication } from '@/types'

interface Session {
  id: string
  title: string
  date: Timestamp
  dateEnd?: Timestamp
  durationMinutes?: number
  locationCoords?: string
  locationLabel?: string
  location?: string
  maxSpots: number
  registeredCount: number
  status: 'open' | 'full' | 'cancelled'
  price?: number
  contactPhone?: string
  hidden?: boolean
}

interface Registration {
  id: string
  sessionId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  suggestions: string
  paymentStatus: 'pending' | 'cash' | 'transfer' | 'free' | 'waived' | 'prepaid'
  prepaidNoteId?: string | null    // avance appliquée (Option C)
  prepaidAmount?: number | null    // montant prélevé sur l'avance
  prepaidMethod?: 'cash' | 'transfer' | null // moyen de paiement de l'avance (pour les stats)
  attendance: 'unknown' | 'present' | 'absent' | 'deregistered'
  registeredAt: Timestamp
  userId?: string
  isMinor?: boolean
  guardianName?: string
  guardianRelation?: string
  guardianPhone?: string
  birthDate?: string
  medicalCertUrl?: string | null
  groupId?: string | null
  isPrimaryBooking?: boolean
  bookingPhone?: string
  bookingEmail?: string
  bookingName?: string
  uniqueToken?: string
  reminderSentAt?: Timestamp
}

const PAYMENT_OPTIONS = [
  { value: 'pending',  label: 'En attente' },
  { value: 'cash',     label: 'Espèces' },
  { value: 'transfer', label: 'Virement' },
  { value: 'free',     label: 'Offert (sans gain)' },
  { value: 'waived',   label: 'Non dû (absent)' },
]

// Formatage des noms : NOM en majuscules, Prénom en nom propre
const toUpperName = (s: string) => s.toUpperCase()
const toProperName = (s: string) =>
  s.split(/([\s-])/).map(p => /[\s-]/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('')

type Candidate = { firstName: string; lastName: string; email: string; phone: string }

// Message d'impayé — le numéro et le RIB proviennent des paramètres (settings/parcours_sportif)
const buildImpayeTemplate = (phone: string, iban: string, bic: string) => `Bonjour,\n\nSi je ne me trompe pas, tu ne m'as pas réglé le dernier Parcours Sportif.\n
Tu peux réaliser un virement Wero à ce numéro (${phone}) ou sinon, voici le rib pour effectuer le virement :\n
IBAN : ${iban}
BIC : ${bic}\n\n
Bonne journée\n\n
Teddy`

// Message d'annulation par défaut (modèle). {reason} optionnel ; lien d'inscription public inclus.
// `origin` = origine publique de l'ESPACE ACTIF (cf. publicLinkOrigin), pas le domaine de navigation.
function defaultCancelMessage(reason: string, origin: string) {
  const publicUrl = origin ? `${origin}/parcours-sportif` : ''
  const reasonLine = reason ? `\n\nRaison : ${reason}.` : ''
  return `Bonjour,

Je suis au regret de vous annoncer que le Parcours Sportif de ce soir est annulé.${reasonLine}
Désolé pour ce contretemps — je vous donne rendez-vous lors du prochain Parcours.

Voici les prochaines dates programmées : ${publicUrl}

À très vite,
Teddy`
}

function fmtDate(ts: Timestamp) {
  return ts.toDate().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtHeure(ts: Timestamp) {
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
// Âge (en années) à partir d'une date de naissance ISO (YYYY-MM-DD)
function ageFromBirthDate(dateStr: string): number | null {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}
function mapsLink(coords: string): string {
  return `https://maps.google.com/maps?q=${coords.replace(/\s/g, '')}`
}
function autoTitle(datetime: string): string {
  const [datePart] = datetime.split('T')
  const [y, m, d] = datePart.split('-')
  return `Parcours Sportif du ${d}/${m}/${y}`
}
function parseCoordsLink(coords?: string): string | null {
  if (!coords) return null
  const parts = coords.replace(/\s/g, '').split(',')
  if (parts.length !== 2 || isNaN(parseFloat(parts[0])) || isNaN(parseFloat(parts[1]))) return null
  return `https://maps.google.com/maps?q=${coords.replace(/\s/g, '')}`
}

export default function AdminSessionDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const { users } = useUsers()
  const [highlightedId, setHighlightedId] = useState<string | null>(highlightId)

  // Les liens qui partent chez un participant (rappel SMS, annulation) portent le domaine de
  // l'ESPACE ACTIF, pas celui d'où l'on navigue : depuis la PWA installée sur app.enezo.fr,
  // basculer en espace coaching doit produire un lien coaching. Cf. publicLinkOrigin.
  const { brand } = useBrand()
  const publicOrigin = useMemo(
    () => publicLinkOrigin(brand, typeof window !== 'undefined' ? window.location.origin : ''),
    [brand]
  )

  // Notes participant (paiements anticipés, etc.)
  const { notes: parcoursNotes, addNote: addParcoursNote, updateNote: updateParcoursNote, deleteNote: deleteParcoursNote } = useParcoursNotes()
  const [notesTarget, setNotesTarget] = useState<{ key: string; name: string } | null>(null)

  const [session, setSession] = useState<Session | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loadingSession, setLoadingSession] = useState(true)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editReg, setEditReg] = useState<Registration | null>(null)
  const [editRegForm, setEditRegForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [savingEditReg, setSavingEditReg] = useState(false)
  const [showDeleteSession, setShowDeleteSession] = useState(false)
  const [deletingSession, setDeletingSession] = useState(false)
  const [togglingHidden, setTogglingHidden] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ datetime: '', locationCoords: '', locationLabel: '', maxSpots: '', price: '5', durationMinutes: '60', contactPhone: '+33679408254' })
  const [saving, setSaving] = useState(false)
  // SMS Annulation
  const [showCancelSmsModal, setShowCancelSmsModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelMessage, setCancelMessage] = useState('')   // message d'annulation éditable (modèle)
  const [cancelMsgSaved, setCancelMsgSaved] = useState(false)
  const [cancelSentIds, setCancelSentIds] = useState<Set<string>>(new Set())
  const CANCEL_REASON_PRESETS = ['Météo', 'Nombre d\'inscrits insuffisant', 'Météo + nombre d\'inscrits']

  // RIB + numéro de contact depuis les paramètres (settings/parcours_sportif)
  const [parcoursSettings, setParcoursSettings] = useState({ iban: '', bic: '', contactPhone: '' })
  useEffect(() => {
    getDoc(doc(db, 'settings', 'parcours_sportif')).then((snap) => {
      const d = snap.exists() ? snap.data() : {}
      setParcoursSettings({ iban: d.iban ?? '', bic: d.bic ?? '', contactPhone: d.contactPhone ?? '' })
      setCancelMessage(d.cancelMessage || defaultCancelMessage('', publicOrigin))
    }).catch(() => setCancelMessage(defaultCancelMessage('', publicOrigin)))
  }, [publicOrigin])
  // Valeurs prêtes à l'emploi pour les SMS (avec repli si non configuré)
  const ribPhone = parcoursSettings.contactPhone || '+33 6 79 40 82 54'
  const ribIban = parcoursSettings.iban
    ? (parcoursSettings.iban.match(/.{1,4}/g)?.join(' ') ?? parcoursSettings.iban)
    : 'FR76 1600 6200 1100 8401 5620 604'
  const ribBic = parcoursSettings.bic || 'AGRIFRPP860'

  // Highlight d'une inscription depuis une notification (scroll + surlignage)
  useEffect(() => {
    if (!highlightedId || loadingSession || !registrations.length) return
    // Laisser le temps au DOM de se peindre (important sur mobile)
    const scrollT = setTimeout(() => {
      const el = document.getElementById(`reg-${highlightedId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
    const clearT = setTimeout(() => setHighlightedId(null), 5000)
    return () => { clearTimeout(scrollT); clearTimeout(clearT) }
  }, [highlightedId, loadingSession, registrations])

  // Recherche + filtres sur les inscrits
  const [search, setSearch] = useState('')
  const [filterPayment, setFilterPayment] = useState<'all' | 'pending' | 'paid'>('all')
  const [filterAttendance, setFilterAttendance] = useState<'all' | 'present' | 'absent' | 'unknown'>('all')

  // Quick add participant
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [searchUser, setSearchUser] = useState('')
  const [quickForm, setQuickForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [addingParticipant, setAddingParticipant] = useState(false)
  const [addError, setAddError] = useState('')
  const [registrantDirectory, setRegistrantDirectory] = useState<Candidate[]>([])
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)
  const [otherSessions, setOtherSessions] = useState<Session[]>([])
  const [quickExtraSessionIds, setQuickExtraSessionIds] = useState<Set<string>>(new Set())

  // Rappel SMS : confirmation + suivi des envois
  const [reminderConfirmId, setReminderConfirmId] = useState<string | null>(null)
  const [reminderSentIds, setReminderSentIds] = useState<Set<string>>(new Set())

  // Pré-calcul des impayés passés par email (pour enrichir le SMS de rappel sans bloquer le clic).
  // Map: email -> date (JJ/MM/AAAA) du parcours passé non réglé le plus récent.
  const [pastUnpaidByEmail, setPastUnpaidByEmail] = useState<Record<string, string>>({})
  const emailsKey = useMemo(
    () => Array.from(new Set(registrations.map((r) => r.email?.toLowerCase()).filter(Boolean))).sort().join(','),
    [registrations]
  )
  useEffect(() => {
    const emails = emailsKey ? emailsKey.split(',') : []
    if (!emails.length) { setPastUnpaidByEmail({}); return }
    let cancelled = false
    ;(async () => {
      try {
        // Récupérer les inscriptions de ces emails (par paquets de 30 pour l'opérateur "in")
        const others: Registration[] = []
        for (let i = 0; i < emails.length; i += 30) {
          const chunk = emails.slice(i, i + 30)
          const snap = await getDocs(query(collection(db, 'registrations'), where('email', 'in', chunk)))
          snap.docs.forEach((d) => {
            const r = { id: d.id, ...d.data() } as Registration
            // On ignore les désinscrits et les absents de la séance passée :
            // pas de rappel d'impayé si la personne n'a finalement pas participé.
            if (
              r.paymentStatus === 'pending' &&
              r.sessionId !== sessionId &&
              r.attendance !== 'deregistered' &&
              r.attendance !== 'absent'
            ) others.push(r)
          })
        }
        if (!others.length) { if (!cancelled) setPastUnpaidByEmail({}); return }
        // Dates des séances concernées
        const sessIds = Array.from(new Set(others.map((r) => r.sessionId)))
        const sessSnaps = await Promise.all(sessIds.map((id) => getDoc(doc(db, 'sessions', id))))
        const sessMs: Record<string, number> = {}
        sessSnaps.forEach((s) => { if (s.exists()) sessMs[s.id] = s.data().date?.toMillis?.() ?? 0 })
        // Pour chaque email, garder la séance PASSÉE non réglée la plus récente
        const maxMs: Record<string, number> = {}
        for (const r of others) {
          const ms = sessMs[r.sessionId] ?? 0
          const email = r.email?.toLowerCase()
          if (!email || !ms || ms >= Date.now()) continue
          if (!maxMs[email] || ms > maxMs[email]) maxMs[email] = ms
        }
        const result: Record<string, string> = {}
        for (const [email, ms] of Object.entries(maxMs)) {
          result[email] = new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        }
        if (!cancelled) setPastUnpaidByEmail(result)
      } catch (err) {
        console.error('Pré-calcul impayés:', err)
      }
    })()
    return () => { cancelled = true }
  }, [emailsKey, sessionId])

  const filteredUsers = useMemo(() => {
    if (!searchUser.trim()) return []
    const s = searchUser.toLowerCase()
    return users.filter((u) =>
      [u.nom, u.prenom].filter(Boolean).join(' ').toLowerCase().includes(s) ||
      (u.email?.toLowerCase().includes(s) ?? false)
    ).slice(0, 8)
  }, [users, searchUser])

  // Répertoire des personnes déjà inscrites (toutes séances), pour l'autocomplétion.
  // Chargé UNE fois, seulement quand on ouvre l'ajout rapide (évite une lecture lourde à chaque page).
  const dirLoadedRef = useRef(false)
  const otherSessLoadedRef = useRef(false)
  useEffect(() => {
    if (!isAdmin || !showQuickAdd || dirLoadedRef.current) return
    dirLoadedRef.current = true
    getDocs(collection(db, 'registrations')).then((snap) => {
      const map = new Map<string, Candidate>()
      snap.docs.forEach((d) => {
        const r = d.data() as any
        const c: Candidate = {
          firstName: r.firstName ?? '', lastName: r.lastName ?? '',
          email: r.email ?? '', phone: r.phone ?? '',
        }
        if (!c.firstName && !c.lastName && !c.email) return
        const key = (c.email || `${c.firstName}|${c.lastName}`).toLowerCase()
        // On garde la fiche la plus complète (avec email + téléphone)
        const prev = map.get(key)
        if (!prev || ((!prev.phone && c.phone) || (!prev.email && c.email))) map.set(key, c)
      })
      setRegistrantDirectory(Array.from(map.values()))
    }).catch(() => {})
  }, [isAdmin, showQuickAdd])

  // Autres séances à venir (pour inscrire un participant à plusieurs dates d'un coup) — paresseux aussi
  useEffect(() => {
    if (!isAdmin || !showQuickAdd || otherSessLoadedRef.current) return
    otherSessLoadedRef.current = true
    const nowMs = Date.now()
    getDocs(collection(db, 'sessions')).then((snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Session))
        .filter((s) => s.id !== sessionId && s.status !== 'cancelled'
          && (s.date?.toMillis?.() ?? 0) >= nowMs && (s.maxSpots - s.registeredCount) > 0)
        .sort((a, b) => (a.date?.toMillis?.() ?? 0) - (b.date?.toMillis?.() ?? 0))
      setOtherSessions(list)
    }).catch(() => {})
  }, [isAdmin, showQuickAdd, sessionId])

  // Candidats = utilisateurs + anciens inscrits (dédoublonnés par email/nom)
  const candidates = useMemo<Candidate[]>(() => {
    const map = new Map<string, Candidate>()
    users.forEach((u) => {
      const c: Candidate = { firstName: u.prenom ?? '', lastName: u.nom ?? '', email: u.email ?? '', phone: (u as any).phone_number ?? '' }
      if (!c.firstName && !c.lastName && !c.email) return
      map.set((c.email || `${c.firstName}|${c.lastName}`).toLowerCase(), c)
    })
    registrantDirectory.forEach((c) => {
      const key = (c.email || `${c.firstName}|${c.lastName}`).toLowerCase()
      if (!map.has(key)) map.set(key, c)
    })
    return Array.from(map.values())
  }, [users, registrantDirectory])

  // Détection de doublon : la personne est-elle déjà inscrite à CETTE séance ?
  const quickAddDuplicate = useMemo(() => {
    if (!quickForm.firstName.trim()) return null
    const active = registrations.filter((r) => r.attendance !== 'deregistered')
    const email = quickForm.email.trim().toLowerCase()
    const fname = quickForm.firstName.trim().toLowerCase()
    const lname = quickForm.lastName.trim().toLowerCase()
    return active.find((r) => {
      if (email && r.email?.toLowerCase() === email) return true
      return r.firstName?.toLowerCase() === fname && r.lastName?.toLowerCase() === lname
    }) ?? null
  }, [registrations, quickForm])

  // Suggestions basées sur ce qui est tapé dans Prénom / Nom
  const nameQuery = `${quickForm.firstName} ${quickForm.lastName}`.trim().toLowerCase()
  const nameSuggestions = useMemo<Candidate[]>(() => {
    if (nameQuery.length < 2) return []
    return candidates.filter((c) => {
      const f = c.firstName.toLowerCase(), l = c.lastName.toLowerCase()
      return `${f} ${l}`.includes(nameQuery) || `${l} ${f}`.includes(nameQuery)
        || f.startsWith(nameQuery) || l.startsWith(nameQuery)
    }).slice(0, 6)
  }, [candidates, nameQuery])

  useEffect(() => {
    if (!isAdmin) return
    getDoc(doc(db, 'sessions', sessionId)).then((snap) => {
      if (snap.exists()) {
        const s = { id: snap.id, ...snap.data() } as Session
        setSession(s)
        const d = s.date.toDate()
        const pad = (n: number) => String(n).padStart(2, '0')
        setEditForm({
          datetime: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
          locationCoords: s.locationCoords ?? '',
          locationLabel: s.locationLabel ?? s.location ?? '',
          maxSpots: String(s.maxSpots),
          price: String(s.price ?? 5),
          durationMinutes: String(s.durationMinutes ?? 60),
          contactPhone: s.contactPhone ?? '+33679408254',
        })
      }
      setLoadingSession(false)
    })
    const q = query(collection(db, 'registrations'), where('sessionId', '==', sessionId))
    return onSnapshot(q, (snap) => {
      setRegistrations(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Registration))
          .sort((a, b) => (a.registeredAt?.seconds ?? 0) - (b.registeredAt?.seconds ?? 0))
      )
    })
  }, [isAdmin, sessionId])

  const financials = useMemo(() => {
    const price = session?.price ?? 5
    // Les désinscrits ne comptent ni dans les paiements attendus ni dans la présence
    const active = registrations.filter((r) => r.attendance !== 'deregistered')
    const byCash = active.filter((r) => r.paymentStatus === 'cash').length
    const byTransfer = active.filter((r) => r.paymentStatus === 'transfer').length
    const byFree = active.filter((r) => r.paymentStatus === 'free').length
    const byWaived = active.filter((r) => r.paymentStatus === 'waived').length
    const prepaid = active.filter((r) => r.paymentStatus === 'prepaid')
    const byPrepaid = prepaid.length
    const byPrepaidCash = prepaid.filter((r) => (r.prepaidMethod ?? 'cash') === 'cash').length
    const byPrepaidTransfer = prepaid.filter((r) => r.prepaidMethod === 'transfer').length
    const total = (byCash + byTransfer + byPrepaid) * price // encaissé (offert/non dû ne rapportent rien)
    // En attente (impayé) : uniquement les 'pending' → un absent passé en « Non dû » n'y compte plus
    const pending = active.filter((r) => r.paymentStatus === 'pending').length * price
    const present = active.filter((r) => r.attendance === 'present').length
    const absent = active.filter((r) => r.attendance === 'absent').length
    const deregistered = registrations.filter((r) => r.attendance === 'deregistered').length
    return { total, pending, byCash, byTransfer, byFree, byWaived, byPrepaid, byPrepaidCash, byPrepaidTransfer, present, absent, deregistered }
  }, [registrations, session])

  const sessionPrice = session?.price ?? 5

  // Avances disponibles (solde restant > 0) par participant, des plus anciennes aux plus récentes
  const advancesByKey = useMemo(() => {
    const m = new Map<string, ParcoursNote[]>()
    for (const n of parcoursNotes) {
      if (!isAdvanceAvailable(n)) continue
      if (!m.has(n.participantKey)) m.set(n.participantKey, [])
      m.get(n.participantKey)!.push(n)
    }
    m.forEach((arr) => arr.sort((a, b) => (a.date_create?.toMillis?.() ?? 0) - (b.date_create?.toMillis?.() ?? 0)))
    return m
  }, [parcoursNotes])

  const advanceByKey = useMemo(() => {
    const m = new Map<string, number>()
    advancesByKey.forEach((arr, k) => m.set(k, arr.reduce((s, n) => s + noteRemaining(n), 0)))
    return m
  }, [advancesByKey])

  // Avance dont le solde couvre le prix de cette séance (la plus ancienne d'abord)
  const advanceToApply = (reg: Registration): ParcoursNote | null =>
    (advancesByKey.get(participantKey(reg)) ?? []).find((n) => noteRemaining(n) >= sessionPrice) ?? null

  const noteCountByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of parcoursNotes) m.set(n.participantKey, (m.get(n.participantKey) ?? 0) + 1)
    return m
  }, [parcoursNotes])

  const handlePaymentChange = (regId: string, value: string) =>
    updateDoc(doc(db, 'registrations', regId), { paymentStatus: value })

  const handleAttendance = (regId: string, value: 'present' | 'absent' | 'unknown' | 'deregistered') =>
    updateDoc(doc(db, 'registrations', regId), { attendance: value })

  // ── Avances (Option C) : application / retrait sur une inscription ──────────
  // Recrédite la note d'avance en retirant l'application liée à cette inscription.
  const refundAdvanceToNote = async (reg: Registration) => {
    if (reg.paymentStatus !== 'prepaid' || !reg.prepaidNoteId) return
    const noteRef = doc(db, 'parcours_notes', reg.prepaidNoteId)
    const snap = await getDoc(noteRef)
    if (!snap.exists()) return
    const apps = ((snap.data().applications ?? []) as ParcoursNoteApplication[])
      .filter((a) => a.registrationId !== reg.id)
    const consumed = apps.reduce((s, a) => s + (a.amount ?? 0), 0)
    await updateDoc(noteRef, { applications: apps, montantConsomme: consumed })
  }

  const applyAdvance = async (reg: Registration) => {
    const note = advanceToApply(reg)
    if (!note || !session) return
    const amount = sessionPrice
    const app: ParcoursNoteApplication = {
      sessionId, sessionTitle: session.title, sessionDate: session.date,
      registrationId: reg.id, amount, appliedAt: Timestamp.now(),
    }
    const apps = [...(note.applications ?? []), app]
    const consumed = apps.reduce((s, a) => s + (a.amount ?? 0), 0)
    const method = note.montantMethode === 'transfer' ? 'transfer' : 'cash'
    const batch = writeBatch(db)
    batch.update(doc(db, 'parcours_notes', note.id), { applications: apps, montantConsomme: consumed })
    batch.update(doc(db, 'registrations', reg.id), { paymentStatus: 'prepaid', prepaidNoteId: note.id, prepaidAmount: amount, prepaidMethod: method })
    await batch.commit()
  }

  const unapplyAdvance = async (reg: Registration) => {
    await refundAdvanceToNote(reg)
    await updateDoc(doc(db, 'registrations', reg.id), { paymentStatus: 'pending', prepaidNoteId: null, prepaidAmount: null, prepaidMethod: null })
  }

  // Bascule "Désinscrit" : libère la place (décrémente le compteur) mais garde la fiche
  const handleToggleDeregister = async (reg: Registration) => {
    const becomingDereg = reg.attendance !== 'deregistered'
    // Si la personne avait réglé via une avance, on la recrédite avant de la désinscrire
    if (becomingDereg) await refundAdvanceToNote(reg).catch(() => {})
    await runTransaction(db, async (tx) => {
      const sessionRef = doc(db, 'sessions', sessionId)
      const snap = await tx.get(sessionRef)
      if (snap.exists()) {
        const data = snap.data()
        const delta = becomingDereg ? -1 : 1
        const newCount = Math.max(0, (data.registeredCount ?? 0) + delta)
        tx.update(sessionRef, { registeredCount: newCount, status: newCount >= data.maxSpots ? 'full' : 'open' })
      }
      tx.update(doc(db, 'registrations', reg.id), {
        attendance: becomingDereg ? 'deregistered' : 'unknown',
        ...(becomingDereg ? { paymentStatus: 'pending', prepaidNoteId: null, prepaidAmount: null, prepaidMethod: null } : {}),
      })
    })
    // Retire l'activité du planning si désinscrit
    if (becomingDereg) await removeParcoursActivite(reg.id).catch(() => {})
  }

  const handleDeleteReg = async (reg: Registration) => {
    // Recrédite l'avance éventuelle avant de supprimer l'inscription
    await refundAdvanceToNote(reg).catch(() => {})
    await runTransaction(db, async (tx) => {
      const sessionRef = doc(db, 'sessions', sessionId)
      const snap = await tx.get(sessionRef)
      if (snap.exists()) {
        const data = snap.data()
        tx.update(sessionRef, {
          registeredCount: Math.max(0, data.registeredCount - 1),
          status: data.status === 'full' ? 'open' : data.status,
        })
      }
      tx.delete(doc(db, 'registrations', reg.id))
    })
    // Retirer l'activité de planning liée
    await removeParcoursActivite(reg.id)
    setDeleteConfirm(null)
  }

  const openEditReg = (reg: Registration) => {
    setAddError('')
    setEditReg(reg)
    setEditRegForm({
      firstName: reg.firstName ?? '', lastName: reg.lastName ?? '',
      email: reg.email ?? '', phone: reg.phone ?? '',
    })
  }

  const saveEditReg = async () => {
    if (!editReg) return
    if (!editRegForm.firstName.trim()) { setAddError('Le prénom est obligatoire.'); return }
    setSavingEditReg(true)
    try {
      await updateDoc(doc(db, 'registrations', editReg.id), {
        firstName: editRegForm.firstName.trim(),
        lastName: editRegForm.lastName.trim(),
        email: editRegForm.email.trim().toLowerCase(),
        phone: editRegForm.phone.trim(),
      })
      setEditReg(null)
    } catch (e: any) {
      setAddError(e.message ?? 'Erreur lors de la modification')
    } finally {
      setSavingEditReg(false)
    }
  }

  const handleRestoreSession = async () => {
    if (!session) return
    setRestoring(true)
    try {
      const newStatus = session.registeredCount >= session.maxSpots ? 'full' : 'open'
      await updateDoc(doc(db, 'sessions', sessionId), { status: newStatus })
      // Restaurer les inscriptions annulées par l'admin → pending
      const regsSnap = await getDocs(
        query(collection(db, 'registrations'), where('sessionId', '==', sessionId))
      )
      const toRestore = regsSnap.docs.filter((d) => {
        const data = d.data()
        return data.paymentStatus === 'cancelled_admin' && data.attendance !== 'deregistered'
      })
      await Promise.all(toRestore.map((d) => updateDoc(d.ref, { paymentStatus: 'pending' })))
      // Re-créer les activités de planning pour les comptes liés
      await Promise.all(toRestore.map(async (d) => {
        const data = d.data() as Registration
        let userId: string | null = data.userId ?? null
        if (!userId && data.email) {
          try {
            const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', data.email.toLowerCase())))
            if (!uSnap.empty) userId = uSnap.docs[0].id
          } catch {}
        }
        if (userId) {
          await addParcoursActivite({ userId, registrationId: d.id, sessionId, session: session as any }).catch(() => {})
        }
      }))
      setSession((s) => s ? { ...s, status: newStatus } : s)
      setShowRestoreConfirm(false)
    } catch (e) {
      console.error('[handleRestoreSession]', e)
    }
    setRestoring(false)
  }

  const handleCancelSession = async () => {
    setCancelling(true)
    // Recrédite les avances appliquées sur cette séance avant de tout annuler
    await Promise.all(
      registrations.filter((r) => r.paymentStatus === 'prepaid').map((r) => refundAdvanceToNote(r).catch(() => {}))
    )
    await updateDoc(doc(db, 'sessions', sessionId), { status: 'cancelled' })
    // Retirer du planning des participants toutes les activités de cette séance
    await removeParcoursActivitesForSession(sessionId)
    // Marquer toutes les inscriptions non-désinscrites comme annulées par l'admin
    // → les inscrits ne verront plus de "règlement en attente" côté client
    const regsSnap = await getDocs(
      query(collection(db, 'registrations'), where('sessionId', '==', sessionId))
    )
    await Promise.all(
      regsSnap.docs
        .filter((d) => d.data().attendance !== 'deregistered')
        .map((d) => updateDoc(d.ref, { paymentStatus: 'cancelled_admin' }))
    )
    setSession((s) => s ? { ...s, status: 'cancelled' } : s)
    setShowCancelConfirm(false)
    setCancelling(false)
  }

  const handleToggleHidden = async () => {
    if (!session) return
    setTogglingHidden(true)
    const newHidden = !session.hidden
    await updateDoc(doc(db, 'sessions', sessionId), { hidden: newHidden })
    setSession((s) => s ? { ...s, hidden: newHidden } : s)
    setTogglingHidden(false)
  }

  const handleDeleteSession = async () => {
    if (!session) return
    setDeletingSession(true)
    try {
      // Supprimer toutes les inscriptions liées
      if (registrations.length > 0) {
        await Promise.all(registrations.map((r) => deleteDoc(doc(db, 'registrations', r.id))))
      }
      // Supprimer le contenu de séance s'il existe
      await deleteDoc(doc(db, 'session_content', sessionId)).catch(() => {})
      // Retirer du planning toutes les activités liées
      await removeParcoursActivitesForSession(sessionId)
      // Supprimer la séance
      await deleteDoc(doc(db, 'sessions', sessionId))
      router.push('/admin/parcours-sportif')
    } catch {
      setDeletingSession(false)
    }
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    const max = parseInt(editForm.maxSpots)
    const price = parseFloat(editForm.price)
    const duration = parseInt(editForm.durationMinutes) || 60
    if (!editForm.datetime || !editForm.locationCoords || isNaN(max) || max <= 0) return
    setSaving(true)
    const startDate = new Date(editForm.datetime)
    const newDate = Timestamp.fromDate(startDate)
    const newDateEnd = Timestamp.fromDate(new Date(startDate.getTime() + duration * 60 * 1000))
    await updateDoc(doc(db, 'sessions', sessionId), {
      title: autoTitle(editForm.datetime),
      date: newDate,
      dateEnd: newDateEnd,
      durationMinutes: duration,
      locationCoords: editForm.locationCoords.replace(/\s/g, ''),
      locationLabel: editForm.locationLabel.trim(),
      location: editForm.locationLabel.trim() || editForm.locationCoords,
      maxSpots: max,
      price: isNaN(price) ? 5 : price,
      contactPhone: editForm.contactPhone.trim(),
      status: session?.registeredCount && session.registeredCount >= max ? 'full' : 'open',
    })
    setSession((s) => s ? {
      ...s,
      title: autoTitle(editForm.datetime),
      date: newDate,
      dateEnd: newDateEnd,
      durationMinutes: duration,
      locationCoords: editForm.locationCoords,
      locationLabel: editForm.locationLabel,
      maxSpots: max,
      price: isNaN(price) ? 5 : price,
      contactPhone: editForm.contactPhone.trim(),
    } : s)
    setShowEdit(false)
    setSaving(false)
  }

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickForm.firstName.trim()) { setAddError('Le prénom est obligatoire.'); return }
    if (!session) return
    setShowNameSuggestions(false)
    setAddError('')
    setAddingParticipant(true)

    // Une seule personne, inscrite à une ou plusieurs dates (la courante + les cochées)
    const registerOne = async (sessId: string, sessObj: Session) => {
      const { notify, regId } = await runTransaction(db, async (tx) => {
        const sessionRef = doc(db, 'sessions', sessId)
        const snap = await tx.get(sessionRef)
        if (!snap.exists()) throw new Error('introuvable')
        const data = snap.data()
        if (data.registeredCount >= data.maxSpots) throw new Error('complète')
        const newCount = data.registeredCount + 1
        const regRef = doc(collection(db, 'registrations'))
        tx.set(regRef, {
          sessionId: sessId,
          firstName: quickForm.firstName.trim(),
          lastName: quickForm.lastName.trim(),
          email: quickForm.email.trim().toLowerCase(),
          phone: quickForm.phone.trim(),
          suggestions: '',
          paymentStatus: 'pending',
          attendance: 'unknown',
          registeredAt: Timestamp.now(),
          uniqueToken: randomUUID(),
        })
        tx.update(sessionRef, { registeredCount: newCount, status: newCount >= data.maxSpots ? 'full' : 'open' })
        const notify = data.maxSpots > 10 && newCount === data.maxSpots - 10
        return { notify, regId: regRef.id }
      })
      if (regId && quickForm.email.trim()) {
        try {
          const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', quickForm.email.trim().toLowerCase())))
          if (!uSnap.empty) await addParcoursActivite({ userId: uSnap.docs[0].id, registrationId: regId, sessionId: sessId, session: sessObj as any })
        } catch {}
      }
      if (notify) {
        fetch('/api/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toAdmins: true, title: '⚠️ Parcours Sportif presque complet', body: `Il ne reste que 10 places pour "${sessObj.title}"`, url: `/admin/parcours-sportif/${sessId}` }),
        }).catch(() => {})
      }
    }

    const targets: { id: string; obj: Session }[] = [
      { id: sessionId, obj: session },
      ...otherSessions.filter((s) => quickExtraSessionIds.has(s.id)).map((s) => ({ id: s.id, obj: s })),
    ]
    let ok = 0
    const failed: string[] = []
    for (const t of targets) {
      try { await registerOne(t.id, t.obj); ok++ }
      catch (err: any) {
        const d = t.obj.date?.toDate?.().toLocaleDateString('fr-FR') ?? ''
        failed.push(`${d} (${err?.message === 'complète' ? 'complète' : 'erreur'})`)
      }
    }

    if (ok === 0) {
      setAddError(failed.length ? `Aucun ajout — ${failed.join(', ')}` : 'Erreur lors de l\'ajout')
    } else {
      if (failed.length) {
        setAddError(`Ajouté, mais certaines dates ont échoué : ${failed.join(', ')}`)
      } else {
        setShowQuickAdd(false)
      }
      setQuickForm({ firstName: '', lastName: '', email: '', phone: '' })
      setSearchUser('')
      setQuickExtraSessionIds(new Set())
    }
    setAddingParticipant(false)
  }

  const copyPhones = async () => {
    const phones = registrations.map((r) => r.phone).filter(Boolean).join(', ')
    const ok = await copyText(phones)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      window.prompt('Copiez les numéros ci-dessous :', phones)
    }
  }

  const openDirectSMS = (phone: string) => {
    if (!phone) return
    window.open(`sms:${phone.replace(/\s/g, '')}`, '_blank')
  }

  // Ouvre un SMS INDIVIDUEL pré-rempli (depuis le téléphone) — pas de SMS de groupe, pas de fuite de numéros.
  const openCancelSMS = (reg: Registration) => {
    const phone = reg.phone?.replace(/\s/g, '')
    if (!phone) return
    window.open(`sms:${phone}?body=${encodeURIComponent(cancelMessage)}`, '_blank')
    setCancelSentIds((s) => new Set(s).add(reg.id))
  }
  // Enregistre le message d'annulation comme modèle réutilisable (settings/parcours_sportif).
  const saveCancelMessage = () => {
    setDoc(doc(db, 'settings', 'parcours_sportif'), { cancelMessage }, { merge: true })
      .then(() => { setCancelMsgSaved(true); setTimeout(() => setCancelMsgSaved(false), 2000) })
      .catch((e) => console.error('[cancel message save]', e))
  }

  // Numéro à utiliser pour joindre la personne sur un impayé :
  // son propre numéro, sinon le numéro de l'inscription groupée (réservation)
  const effectiveContactPhone = (r: Registration): string => r.phone?.trim() || r.bookingPhone?.trim() || ''
  const usesBookingPhone = (r: Registration): boolean => !r.phone?.trim() && !!r.bookingPhone?.trim()

  const openSMS = (reg: Registration) => {
    const phone = effectiveContactPhone(reg)
    if (!phone) return
    const template = buildImpayeTemplate(ribPhone, ribIban, ribBic)
    // Si on passe par le numéro de réservation, on personnalise le rappel
    const body = usesBookingPhone(reg)
      ? `Bonjour,\n\nConcernant l'inscription de ${reg.firstName} ${reg.lastName} au Parcours Sportif : il semble que le règlement n'ait pas été effectué.\n${template}`
      : template
    window.open(`sms:${phone}?body=${encodeURIComponent(body)}`, '_blank')
  }

  // Marque le rappel comme envoyé (Firestore + état local), sans déclencher SMS/notification.
  const markReminderSent = (reg: Registration) => {
    const sentAt = Timestamp.now()
    setReminderConfirmId(null)
    setReminderSentIds((prev) => new Set(prev).add(reg.id))
    updateDoc(doc(db, 'registrations', reg.id), { reminderSentAt: sentAt }).catch(() => {})
    setRegistrations((prev) => prev.map((r) => r.id === reg.id ? { ...r, reminderSentAt: sentAt } : r))
  }

  // Rappel "silencieux" : on note qu'il a été envoyé sans SMS ni notification
  // (pour les clients qui viennent avec moi → pas besoin de les solliciter).
  const handleReminderSilent = (reg: Registration) => {
    if (!session) return
    markReminderSent(reg)
  }

  const handleReminderSMS = (reg: Registration) => {
    if (!session || !reg.phone) return
    markReminderSent(reg)
    const heure = fmtHeure(session.date)
    const locationDisplay = session.locationLabel || session.location || session.locationCoords || ''
    const link = `${publicOrigin}/parcours-sportif`

    // Rappel d'impayé d'un parcours précédent (pré-calculé au chargement → disponible instantanément)
    const unpaidDate = reg.email ? pastUnpaidByEmail[reg.email.toLowerCase()] : undefined
    const unpaidSection = unpaidDate
      ? `\n\n⚠️ Rappel d'impayé lors du dernier parcours : ${unpaidDate}. L'impayé peut être réglé par virement sur le compte suivant :\nIBAN : ${ribIban}\nBIC : ${ribBic}`
      : ''

    const sms = `Bonjour,

Rappel de votre inscription pour le Parcours Sportif d'aujourd'hui à ${heure} (merci d'arriver 10 minutes avant si possible).
Lieu du rendez-vous : ${locationDisplay}.

Si vous avez un imprévu, merci de revenir vers moi au plus vite.${unpaidSection}

Je vous joins également le formulaire d'inscription aux Parcours pour que vous l'ayez à porté de main pour les prochaines dates si vous souhaitez y participer : ${link}.

Bonne journée et à toute à l'heure.

Teddy`

    // Ouvrir l'app SMS IMMÉDIATEMENT, dans le geste de clic (sinon bloqué sur mobile)
    window.location.href = `sms:${reg.phone}?body=${encodeURIComponent(sms)}`

    // Notification push + in-app au participant s'il a un compte (async, sans bloquer l'ouverture du SMS)
    void (async () => {
      try {
        let targetUid = reg.userId || null
        if (!targetUid && reg.email) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', reg.email.toLowerCase())))
          if (!uSnap.empty) targetUid = uSnap.docs[0].id
        }
        if (targetUid) {
          fetch('/api/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: targetUid,
              persist: true,
              type: 'PARCOURS_RAPPEL',
              title: 'Rappel Parcours Sportif',
              body: `Rappel de votre séance "${session.title}"${heure ? ` aujourd'hui à ${heure}` : ''}. Lieu : ${locationDisplay}.`,
              url: '/mes-parcours',
            }),
          }).catch(() => {})
        }
      } catch {}
    })()
  }

  if (!isAdmin) return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Accès réservé aux administrateurs.</p></div>
  if (loadingSession) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  if (!session) return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Séance introuvable.</p></div>

  const isCancelled = session.status === 'cancelled'
  const coordsLink = parseCoordsLink(session.locationCoords)
  const locationDisplay = session.locationLabel || session.location || session.locationCoords || '—'
  // La séance est "passée" si elle a eu lieu un jour antérieur (une séance du jour même n'est pas encore passée)
  const startOfTodayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const isPast = session.date.toMillis() < startOfTodayMs
  const unpaidWithPhone = registrations.filter((r) => r.paymentStatus === 'pending' && r.attendance !== 'deregistered' && effectiveContactPhone(r))

  const filteredRegistrations = registrations.filter((r) => {
    const isDeregistered = r.attendance === 'deregistered'
    if (filterPayment === 'pending' && (r.paymentStatus !== 'pending' || isDeregistered)) return false
    if (filterPayment === 'paid' && r.paymentStatus === 'pending' && !isDeregistered) return false
    if (filterAttendance !== 'all' && (r.attendance ?? 'unknown') !== filterAttendance) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = `${r.firstName} ${r.lastName} ${r.email} ${r.phone}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.push('/admin/parcours-sportif')} className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-800 truncate">{session.title}</h1>
            {session.hidden && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">Masquée</span>
            )}
          </div>
          <p className="text-sm text-gray-500 capitalize">{fmtDate(session.date)} à {fmtHeure(session.date)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Vue séance (mobile) */}
          <button onClick={() => router.push(`/admin/parcours-sportif/${sessionId}/vue`)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 bg-purple-50 hover:bg-purple-100 transition">
            Vue séance
          </button>
          {/* Contenu de séance */}
          <button onClick={() => router.push(`/admin/parcours-sportif/${sessionId}/contenu`)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50 transition">
            Contenu
          </button>
          {/* Masquer/Afficher */}
          <button onClick={handleToggleHidden} disabled={togglingHidden}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            {togglingHidden ? '...' : session.hidden ? 'Afficher' : 'Masquer'}
          </button>
          {/* Message d'annulation (raison + texte type, réutilisé par les boutons « SMS annulation » de la liste) */}
          {registrations.some((r) => r.phone) && (
            <button onClick={() => setShowCancelSmsModal(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition">
              Message d'annulation
            </button>
          )}
          {/* Modifier */}
          {!isCancelled && (
            <button onClick={() => setShowEdit((v) => !v)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition">
              {showEdit ? 'Fermer' : 'Modifier'}
            </button>
          )}
          {/* Supprimer (seulement si 0 inscrits) */}
          {(session.registeredCount === 0 || session.status === 'cancelled') && (
            !showDeleteSession ? (
              <button onClick={() => setShowDeleteSession(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition">
                Supprimer
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-red-600">Supprimer définitivement ?</span>
                <button onClick={() => setShowDeleteSession(false)} className="text-xs text-gray-500 hover:text-gray-700">Non</button>
                <button onClick={handleDeleteSession} disabled={deletingSession}
                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md disabled:opacity-50">
                  {deletingSession ? '...' : 'Oui'}
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Formulaire édition */}
      {showEdit && (
        <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Modifier la séance</h2>
          <form onSubmit={handleSaveEdit} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date et heure de début</label>
              <input type="datetime-local" required value={editForm.datetime}
                onChange={(e) => setEditForm((f) => ({ ...f, datetime: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {editForm.datetime && (
                <p className="text-xs text-gray-400 mt-1">→ {autoTitle(editForm.datetime)}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Durée (minutes)</label>
              <input type="number" required min={1} value={editForm.durationMinutes}
                onChange={(e) => setEditForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {editForm.datetime && editForm.durationMinutes && (
                <p className="text-xs text-gray-400 mt-1">
                  Fin : {new Date(new Date(editForm.datetime).getTime() + (parseInt(editForm.durationMinutes) || 0) * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Coordonnées GPS</label>
              <input type="text" required value={editForm.locationCoords}
                onChange={(e) => setEditForm((f) => ({ ...f, locationCoords: e.target.value }))}
                placeholder="47.473783, -2.487777"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nom du lieu (affiché aux participants)</label>
              <input type="text" value={editForm.locationLabel}
                onChange={(e) => setEditForm((f) => ({ ...f, locationLabel: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Places max</label>
              <input type="number" required min={session.registeredCount || 1} value={editForm.maxSpots}
                onChange={(e) => setEditForm((f) => ({ ...f, maxSpots: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prix (€)</label>
              <input type="number" min={0} step={0.5} value={editForm.price}
                onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone de contact (annulations participants)</label>
              <input type="tel" value={editForm.contactPhone}
                onChange={(e) => setEditForm((f) => ({ ...f, contactPhone: e.target.value }))}
                placeholder="+33679408254"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="button" onClick={() => setShowEdit(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
              <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-xl text-sm font-semibold transition">{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Infos + bilan */}
        <div className="lg:col-span-1 space-y-4">
          {/* Infos séance */}
          <div className={`bg-white rounded-2xl border shadow-sm p-5 space-y-3 ${isCancelled ? 'border-red-100' : 'border-gray-100'}`}>
            {isCancelled && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <ExclamationTriangleIcon className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm font-medium text-red-600">Séance annulée</p>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <CalendarIcon className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="capitalize">{fmtDate(session.date)} à {fmtHeure(session.date)}</span>
            </div>
            <div className="flex items-start gap-1.5 text-sm text-gray-600">
              <MapPinIcon className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <span>{locationDisplay}</span>
                {coordsLink && (
                  <a href={coordsLink} target="_blank" rel="noopener noreferrer"
                    className="block text-xs text-blue-600 hover:underline mt-0.5">
                    Ouvrir dans Maps
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <UsersIcon className="w-4 h-4 text-gray-400 shrink-0" />
              <span>{session.registeredCount}/{session.maxSpots} inscrits</span>
              {session.maxSpots - session.registeredCount <= 10 && !isCancelled && (
                <span className="text-xs font-semibold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                  {session.maxSpots - session.registeredCount} restantes
                </span>
              )}
            </div>
            {session.price != null && (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600">
                <BanknotesIcon className="w-4 h-4 shrink-0" />
                <span>{session.price}€ / personne</span>
              </div>
            )}
            <div className="pt-1 border-t border-gray-100">
              {isCancelled ? (
                !showRestoreConfirm ? (
                  <button onClick={() => setShowRestoreConfirm(true)}
                    className="text-xs font-medium text-green-700 border border-green-300 px-3 py-1.5 rounded-lg hover:bg-green-50 transition">
                    Restaurer la séance
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-600 flex-1">Remettre en ligne et restaurer les inscriptions ?</p>
                    <button onClick={() => setShowRestoreConfirm(false)} className="text-xs border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50">Non</button>
                    <button onClick={handleRestoreSession} disabled={restoring} className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50">{restoring ? '...' : 'Oui'}</button>
                  </div>
                )
              ) : (
                !showCancelConfirm ? (
                  <button onClick={() => setShowCancelConfirm(true)}
                    className="text-xs font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
                    Annuler la séance
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-600 flex-1">Confirmer l'annulation ?</p>
                    <button onClick={() => setShowCancelConfirm(false)} className="text-xs border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50">Non</button>
                    <button onClick={handleCancelSession} disabled={cancelling} className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 disabled:opacity-50">{cancelling ? '...' : 'Oui'}</button>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Bilan financier */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BanknotesIcon className="w-4 h-4 text-green-600" />
              Bilan financier
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Encaissé</span>
              <span className="text-lg font-bold text-green-700">{financials.total.toFixed(2)}€</span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Espèces ({financials.byCash})</span>
              <span>{(financials.byCash * (session.price ?? 5)).toFixed(2)}€</span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Virement ({financials.byTransfer})</span>
              <span>{(financials.byTransfer * (session.price ?? 5)).toFixed(2)}€</span>
            </div>
            {financials.byPrepaidCash > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center gap-1"><BanknotesIcon className="w-3 h-3 text-emerald-500" />Payé d'avance · Espèces ({financials.byPrepaidCash})</span>
                <span>{(financials.byPrepaidCash * (session.price ?? 5)).toFixed(2)}€</span>
              </div>
            )}
            {financials.byPrepaidTransfer > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center gap-1"><BanknotesIcon className="w-3 h-3 text-emerald-500" />Payé d'avance · Virement ({financials.byPrepaidTransfer})</span>
                <span>{(financials.byPrepaidTransfer * (session.price ?? 5)).toFixed(2)}€</span>
              </div>
            )}
            {financials.byFree > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Offert ({financials.byFree})</span>
                <span className="text-gray-400">0,00€</span>
              </div>
            )}
            {financials.byWaived > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Non dû ({financials.byWaived})</span>
                <span className="text-gray-400">0,00€</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-sm text-gray-500">En attente</span>
              <span className="text-sm font-medium text-orange-600">{financials.pending.toFixed(2)}€</span>
            </div>
            <div className="border-t border-gray-100 pt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1 text-green-600"><CheckCircleIcon className="w-3.5 h-3.5" />Présents</span>
                <span className="font-semibold">{financials.present}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1 text-red-500"><XCircleIcon className="w-3.5 h-3.5" />Absents</span>
                <span className="font-semibold">{financials.absent}</span>
              </div>
              {financials.deregistered > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1 text-gray-500"><XCircleIcon className="w-3.5 h-3.5" />Désinscrits</span>
                  <span className="font-semibold">{financials.deregistered}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Liste inscrits */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Inscrits ({registrations.length})
            </h2>
            <div className="flex items-center gap-2">
              {registrations.length > 0 && (
                <button onClick={copyPhones}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
                  <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  {copied ? 'Copié !' : 'Copier les numéros'}
                </button>
              )}
              {!isCancelled && (
                <button onClick={() => setShowQuickAdd((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                  <PlusIcon className="w-3.5 h-3.5" />
                  Ajouter
                </button>
              )}
            </div>
          </div>

          {/* Panneau ajout rapide */}
          {showQuickAdd && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-blue-800">Ajout rapide de participant</p>

              {/* Recherche utilisateur existant */}
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">Rechercher un utilisateur existant</label>
                <div className="relative">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={searchUser} onChange={(e) => setSearchUser(e.target.value)}
                    placeholder="Prénom, nom ou email..."
                    className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                {filteredUsers.length > 0 && (
                  <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {filteredUsers.map((u) => (
                      <button key={u.id} type="button"
                        onClick={() => {
                          setQuickForm({
                            firstName: u.prenom ?? '',
                            lastName: u.nom ?? '',
                            email: u.email ?? '',
                            phone: u.phone_number ?? '',
                          })
                          setSearchUser('')
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 transition">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {u.prenom?.[0]}{u.nom?.[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{u.prenom} {u.nom}</p>
                          {u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleQuickAdd} className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Prénom *</label>
                  <input type="text" required value={quickForm.firstName}
                    onChange={(e) => { setQuickForm((f) => ({ ...f, firstName: toProperName(e.target.value) })); setShowNameSuggestions(true) }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Nom</label>
                  <input type="text" value={quickForm.lastName}
                    onChange={(e) => { setQuickForm((f) => ({ ...f, lastName: toUpperName(e.target.value) })); setShowNameSuggestions(true) }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>

                {/* Suggestions automatiques (utilisateurs + personnes déjà inscrites) */}
                {showNameSuggestions && nameSuggestions.length > 0 && (
                  <div className="col-span-2 -mt-1 bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
                    <p className="text-[11px] text-gray-400 px-3 pt-2">Suggestions — cliquez pour remplir automatiquement</p>
                    {nameSuggestions.map((c, idx) => (
                      <button key={idx} type="button"
                        onClick={() => {
                          setQuickForm({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone })
                          setShowNameSuggestions(false)
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 transition">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {c.firstName?.[0]}{c.lastName?.[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.firstName} {c.lastName}</p>
                          {(c.email || c.phone) && <p className="text-xs text-gray-400 truncate">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Email</label>
                  <input type="email" value={quickForm.email}
                    onChange={(e) => setQuickForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Téléphone</label>
                  <input type="tel" value={quickForm.phone}
                    onChange={(e) => setQuickForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                {/* Inscrire cette personne à d'autres dates en même temps */}
                {otherSessions.length > 0 && (
                  <div className="col-span-2 border border-gray-200 rounded-xl p-3 bg-white">
                    <p className="text-xs font-semibold text-gray-700">Inscrire aussi à d'autres dates ? (optionnel)</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {otherSessions.map((s) => {
                        const left = s.maxSpots - s.registeredCount
                        const checked = quickExtraSessionIds.has(s.id)
                        return (
                          <label key={s.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" checked={checked}
                              onChange={() => setQuickExtraSessionIds((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })}
                              className="w-4 h-4 accent-blue-600 shrink-0" />
                            <span className="flex-1 min-w-0 text-sm text-gray-800 capitalize truncate">
                              {s.date?.toDate?.().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} <span className="text-gray-400">— {left} place{left > 1 ? 's' : ''}</span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {quickExtraSessionIds.size > 0 && (
                      <p className="text-xs font-medium text-blue-600 mt-2">{quickExtraSessionIds.size + 1} dates au total</p>
                    )}
                  </div>
                )}
                {quickAddDuplicate && (
                  <div className="col-span-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      <span className="font-semibold">{quickAddDuplicate.firstName} {quickAddDuplicate.lastName}</span> semble déjà inscrit à cette séance. L'ajout reste possible si c'est voulu.
                    </p>
                  </div>
                )}
                {addError && <p className="col-span-2 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{addError}</p>}
                <div className="col-span-2 flex gap-2">
                  <button type="button" onClick={() => { setShowQuickAdd(false); setQuickForm({ firstName: '', lastName: '', email: '', phone: '' }); setSearchUser(''); setShowNameSuggestions(false); setQuickExtraSessionIds(new Set()) }}
                    className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                    Annuler
                  </button>
                  <button type="submit" disabled={addingParticipant}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-xl text-sm font-semibold transition">
                    {addingParticipant ? 'Ajout...' : 'Ajouter'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SMS groupés — uniquement une fois la séance passée (jour antérieur) */}
          {isPast && unpaidWithPhone.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-orange-700 mb-1">
                <ChatBubbleLeftIcon className="w-3.5 h-3.5 inline mr-1" />
                SMS impayé — {unpaidWithPhone.length} non-réglé{unpaidWithPhone.length > 1 ? 's' : ''} avec numéro
              </p>
              {unpaidWithPhone.some(usesBookingPhone) && (
                <p className="text-[11px] text-orange-500 mb-2">
                  « (via réservation) » = envoyé au numéro de la personne qui a inscrit le groupe — pas forcément celui du participant concerné.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {unpaidWithPhone.map((reg) => (
                  <button key={reg.id} onClick={() => openSMS(reg)}
                    className="flex items-center gap-1.5 text-xs font-medium text-orange-700 border border-orange-300 bg-white hover:bg-orange-50 px-2.5 py-1.5 rounded-lg transition">
                    <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                    Impayé → {reg.firstName} {reg.lastName}
                    {usesBookingPhone(reg) && <span className="text-orange-400">(via réservation)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recherche + filtres */}
          {registrations.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-2">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un inscrit (nom, email, téléphone)..."
                  className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Filtre règlement */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400 mr-1">Règlement :</span>
                  {([['all', 'Tous'], ['pending', 'En attente'], ['paid', 'Réglé']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setFilterPayment(val)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition ${
                        filterPayment === val ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Filtre présence */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400 mr-1">Présence :</span>
                  {([['all', 'Tous'], ['present', 'Présents'], ['absent', 'Absents'], ['unknown', 'Non pointés']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setFilterAttendance(val)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition ${
                        filterAttendance === val ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
                {(search || filterPayment !== 'all' || filterAttendance !== 'all') && (
                  <button onClick={() => { setSearch(''); setFilterPayment('all'); setFilterAttendance('all') }}
                    className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto">
                    Réinitialiser
                  </button>
                )}
              </div>
              {(search || filterPayment !== 'all' || filterAttendance !== 'all') && (
                <p className="text-xs text-gray-400">{filteredRegistrations.length} résultat{filteredRegistrations.length > 1 ? 's' : ''} sur {registrations.length}</p>
              )}
            </div>
          )}

          {registrations.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <UsersIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Aucun inscrit pour l'instant</p>
            </div>
          ) : filteredRegistrations.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <MagnifyingGlassIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Aucun inscrit ne correspond à ces critères</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                {filteredRegistrations.map((reg) => (
                  <div
                    key={reg.id}
                    id={`reg-${reg.id}`}
                    style={highlightedId === reg.id ? { boxShadow: 'inset 4px 0 0 0 #f59e0b' } : undefined}
                    className={`p-4 transition-all duration-700 ${highlightedId === reg.id ? 'bg-amber-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{reg.firstName} {reg.lastName}</p>
                          {reg.isMinor && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Mineur</span>
                          )}
                          {(advanceByKey.get(participantKey(reg)) ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              <BanknotesIcon className="w-3 h-3" />{advanceByKey.get(participantKey(reg))}€
                            </span>
                          )}
                        </div>
                        {reg.email && <p className="text-xs text-gray-500">{reg.email}</p>}
                        {reg.phone && <p className="text-xs text-gray-500">{reg.phone}</p>}
                        {reg.isMinor && (
                          <div className="mt-1 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 space-y-0.5">
                            {reg.guardianName && (
                              <p className="text-xs text-amber-800">
                                Responsable : <strong>{reg.guardianName}</strong>
                                {reg.guardianRelation ? ` (${reg.guardianRelation})` : ''}
                                {reg.guardianPhone ? ` · ${reg.guardianPhone}` : ''}
                              </p>
                            )}
                            {reg.birthDate && (() => {
                              const age = ageFromBirthDate(reg.birthDate)
                              return (
                                <p className="text-xs text-amber-700">
                                  Né(e) le {new Date(reg.birthDate).toLocaleDateString('fr-FR')}
                                  {age !== null && <strong> · {age} ans</strong>}
                                </p>
                              )
                            })()}
                            {reg.medicalCertUrl ? (
                              <a href={reg.medicalCertUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-medium text-blue-600 hover:underline">
                                Voir le certificat médical →
                              </a>
                            ) : (
                              <p className="text-xs text-amber-600 italic">Aucun certificat médical fourni</p>
                            )}
                          </div>
                        )}
                        {reg.suggestions && (
                          <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                            <svg className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z" /></svg>
                            <p className="text-xs font-medium text-amber-800">« {reg.suggestions} »</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <p className="text-xs text-gray-400">{reg.registeredAt?.toDate().toLocaleDateString('fr-FR')}</p>
                        {deleteConfirm === reg.id ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setDeleteConfirm(null)} className="text-xs border border-gray-200 px-2 py-0.5 rounded-md hover:bg-gray-50">Non</button>
                            <button onClick={() => handleDeleteReg(reg)} className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md">Oui</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button onClick={() => setNotesTarget({ key: participantKey(reg), name: `${reg.firstName} ${reg.lastName}`.trim() })}
                              title="Notes (paiement anticipé, etc.)"
                              className="relative p-1 text-gray-400 hover:text-emerald-600 transition">
                              <DocumentTextIcon className="w-4 h-4" />
                              {(noteCountByKey.get(participantKey(reg)) ?? 0) > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">
                                  {noteCountByKey.get(participantKey(reg))}
                                </span>
                              )}
                            </button>
                            <button onClick={() => openEditReg(reg)} title="Modifier les infos" className="p-1 text-gray-400 hover:text-blue-500 transition">
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button onClick={() => setDeleteConfirm(reg.id)} title="Supprimer" className="p-1 text-gray-400 hover:text-red-500 transition">
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {reg.attendance === 'deregistered' ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-200 text-gray-600">
                            <XCircleIcon className="w-3.5 h-3.5" /> Désinscrit
                          </span>
                          <button onClick={() => handleToggleDeregister(reg)}
                            className="text-xs font-medium px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
                            Réinscrire
                          </button>
                        </>
                      ) : (
                        <>
                          {reg.paymentStatus === 'prepaid' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2 py-1 border bg-emerald-50 border-emerald-200 text-emerald-700">
                              <BanknotesIcon className="w-3.5 h-3.5" />
                              Payé d'avance{reg.prepaidMethod === 'transfer' ? ' · Virement' : ' · Espèces'}
                              <button onClick={() => unapplyAdvance(reg)} title="Retirer l'avance (recrédite le solde)"
                                className="ml-0.5 text-emerald-500 hover:text-emerald-800">
                                <XCircleIcon className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          ) : (
                            <>
                              <select value={reg.paymentStatus} onChange={(e) => handlePaymentChange(reg.id, e.target.value)}
                                className={`text-xs font-medium rounded-lg px-2 py-1 border focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                                  reg.paymentStatus === 'pending' ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                    : reg.paymentStatus === 'free' ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                    : reg.paymentStatus === 'waived' ? 'bg-slate-100 border-slate-200 text-slate-600'
                                    : 'bg-green-50 border-green-200 text-green-700'
                                }`}>
                                {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                              {reg.paymentStatus === 'pending' && advanceToApply(reg) && (
                                <button onClick={() => applyAdvance(reg)}
                                  title={`Régler avec l'avance disponible (${advanceByKey.get(participantKey(reg))}€ restants)`}
                                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition">
                                  <BanknotesIcon className="w-3.5 h-3.5" />
                                  Appliquer l'avance ({sessionPrice}€)
                                </button>
                              )}
                            </>
                          )}
                          <button onClick={() => handleAttendance(reg.id, reg.attendance === 'present' ? 'unknown' : 'present')}
                            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition ${reg.attendance === 'present' ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-600'}`}>
                            <CheckCircleIcon className="w-3.5 h-3.5" />Présent
                          </button>
                          <button onClick={() => handleAttendance(reg.id, reg.attendance === 'absent' ? 'unknown' : 'absent')}
                            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition ${reg.attendance === 'absent' ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500'}`}>
                            <XCircleIcon className="w-3.5 h-3.5" />Absent
                          </button>
                          <button onClick={() => handleToggleDeregister(reg)} title="Marquer comme désinscrit (la personne a prévenu par message)"
                            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition">
                            <XCircleIcon className="w-3.5 h-3.5" />Désinscrit
                          </button>
                        </>
                      )}
                      {reg.phone && (
                        <button onClick={() => openDirectSMS(reg.phone)}
                          title="Ouvrir un SMS vide vers ce contact"
                          className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                          <ChatBubbleLeftIcon className="w-3.5 h-3.5" />SMS
                        </button>
                      )}
                      {reg.phone && (
                        <button onClick={() => openCancelSMS(reg)}
                          title="Ouvrir un SMS d'annulation pré-rempli (règle le texte/la raison via « Message d'annulation » en haut)"
                          className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition ${cancelSentIds.has(reg.id) ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                          <ChatBubbleLeftIcon className="w-3.5 h-3.5" />{cancelSentIds.has(reg.id) ? 'Annul. envoyée' : 'SMS annulation'}
                        </button>
                      )}
                      {reg.attendance !== 'deregistered' && reg.phone && (
                        reminderConfirmId === reg.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500">{reg.reminderSentAt ? 'Renvoyer ?' : 'Envoyer ?'}</span>
                            <button onClick={() => setReminderConfirmId(null)}
                              className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded-lg hover:bg-gray-50 transition">Non</button>
                            <button onClick={() => handleReminderSilent(reg)}
                              title="Marquer comme envoyé sans SMS ni notification"
                              className="text-xs text-gray-600 border border-gray-300 px-2 py-0.5 rounded-lg hover:bg-gray-50 transition">Sans SMS</button>
                            <button onClick={() => handleReminderSMS(reg)}
                              className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded-lg transition">Oui</button>
                          </div>
                        ) : reg.reminderSentAt ? (
                          <button onClick={() => setReminderConfirmId(reg.id)}
                            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-green-200 text-green-600 bg-green-50 hover:bg-green-100 transition"
                            title={`Envoyé le ${reg.reminderSentAt.toDate().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — cliquer pour renvoyer`}>
                            <CheckCircleIcon className="w-3.5 h-3.5" />Rappel envoyé
                          </button>
                        ) : (
                          <button onClick={() => setReminderConfirmId(reg.id)}
                            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition">
                            <ChatBubbleLeftIcon className="w-3.5 h-3.5" />Rappel
                          </button>
                        )
                      )}
                      {reg.attendance !== 'deregistered' && reg.paymentStatus === 'pending' && effectiveContactPhone(reg) && (
                        <button onClick={() => openSMS(reg)}
                          title={usesBookingPhone(reg) ? 'Envoyé au numéro de la réservation (pas forcément celui de la personne)' : undefined}
                          className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-orange-200 text-orange-600 hover:bg-orange-50 transition">
                          <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                          Impayé{usesBookingPhone(reg) && ' (réserv.)'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal SMS Annulation ── */}
      {showCancelSmsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowCancelSmsModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800">Message d'annulation</h3>
            <p className="text-sm text-gray-500">Règle ton message type ici (raison + texte), puis envoie-le à chaque participant ci-dessous.</p>

            {/* Raison rapide (pré-remplit le message) */}
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Pré-remplir avec une raison</p>
              <div className="flex flex-wrap gap-2">
                {CANCEL_REASON_PRESETS.map((preset) => (
                  <button key={preset} type="button"
                    onClick={() => { const r = cancelReason === preset ? '' : preset; setCancelReason(r); setCancelMessage(defaultCancelMessage(r, publicOrigin)) }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${cancelReason === preset ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {preset}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Réécrit le message type avec cette raison — tu peux ensuite l'ajuster librement.</p>
            </div>

            {/* Message éditable + enregistrement du modèle */}
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Message (modifiable)</p>
              <textarea value={cancelMessage} onChange={(e) => setCancelMessage(e.target.value)} rows={9}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-400 resize-y" />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={saveCancelMessage}
                  className="text-xs font-medium text-white bg-gray-700 hover:bg-gray-800 px-3 py-1.5 rounded-lg transition">Enregistrer le modèle</button>
                {cancelMsgSaved && <span className="text-[11px] text-emerald-600">✓ Modèle enregistré</span>}
              </div>
            </div>

            {/* Liste : 1 SMS individuel par participant (fiable + pas de fuite de numéros) */}
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Envoyer (1 par 1, depuis ton téléphone)</p>
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {registrations.filter((r) => r.phone?.trim()).length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Aucun participant avec numéro de téléphone.</p>
                ) : (
                  registrations.filter((r) => r.phone?.trim()).map((reg) => (
                    <div key={reg.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{reg.firstName} {reg.lastName}</p>
                        <p className="text-[11px] text-gray-400">{reg.phone}</p>
                      </div>
                      <button type="button" onClick={() => openCancelSMS(reg)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition shrink-0 ${cancelSentIds.has(reg.id) ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                        {cancelSentIds.has(reg.id) ? '✓ Envoyé' : 'SMS'}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">Chaque bouton ouvre un SMS individuel pré-rempli ; tape « Envoyer » dans l'app Messages pour chacun. (Les liens SMS ne fonctionnent que depuis un téléphone.)</p>
            </div>

            <button type="button" onClick={() => setShowCancelSmsModal(false)}
              className="w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modal édition d'un participant */}
      {editReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !savingEditReg && setEditReg(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-4">Modifier le participant</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prénom *</label>
                <input type="text" value={editRegForm.firstName}
                  onChange={(e) => setEditRegForm((f) => ({ ...f, firstName: toProperName(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                <input type="text" value={editRegForm.lastName}
                  onChange={(e) => setEditRegForm((f) => ({ ...f, lastName: toUpperName(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={editRegForm.email}
                  onChange={(e) => setEditRegForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone</label>
                <input type="tel" value={editRegForm.phone}
                  onChange={(e) => setEditRegForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
            </div>
            {addError && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{addError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditReg(null)} disabled={savingEditReg}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition disabled:opacity-50">
                Annuler
              </button>
              <button onClick={saveEditReg} disabled={savingEditReg}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50">
                {savingEditReg ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Notes d'un participant (paiement anticipé, etc.) ── */}
      {notesTarget && (
        <ParticipantNotesModal
          isOpen={!!notesTarget}
          onClose={() => setNotesTarget(null)}
          participantKey={notesTarget.key}
          participantName={notesTarget.name}
          notes={parcoursNotes}
          addNote={addParcoursNote}
          updateNote={updateParcoursNote}
          deleteNote={deleteParcoursNote}
        />
      )}
    </div>
  )
}
