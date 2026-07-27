'use client'

import { use, useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Timestamp, doc, collection, query, where, getDocs, updateDoc, addDoc, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { usePlanning } from '@/hooks/usePlanning'
import { useSeances } from '@/hooks/useSeances'
import { useUsers } from '@/hooks/useUsers'
import { useNotes } from '@/hooks/useNotes'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import AdresseAutocomplete from '@/components/ui/AdresseAutocomplete'
import MaterielSelect from '@/components/ui/MaterielSelect'
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  ClipboardDocumentListIcon, PlusIcon, ChevronRightIcon,
  PhoneIcon, EnvelopeIcon, MapPinIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClockIcon, XMarkIcon,
  ChevronUpIcon, ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { formatDate, formatHeure } from '@/lib/planningUtils'
import { useAuth } from '@/context/AuthContext'
import { useBrand } from '@/context/BrandContext'
import { publicLinkOrigin } from '@/lib/brand'
import { useClients } from '@/hooks/useClients'
import type { Client, PainPoint } from '@/types'
import ClientEditModal from '@/components/ui/ClientEditModal'
import PainZoneSelector from '@/components/ui/PainZoneSelector'
import { zoneDouleurLabel } from '@/lib/painZones'

const ETATS = ['Non calé', 'Calé', 'Annulé', 'Effectué']

// Bornes de journée — comparer par jour (et non à la milliseconde près)
const startOfDayMs = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
const endOfDayMs = (ms: number) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime() }

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`)
    const data = await res.json()
    const coords = data.features?.[0]?.geometry?.coordinates
    if (!coords) return null
    return { lat: coords[1], lng: coords[0] }
  } catch { return null }
}

async function calculateRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<{ distanceKm: number; duration: string }> {
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`)
  const data = await res.json()
  const route = data.routes?.[0]
  if (!route) throw new Error('Pas de route trouvée')
  const km = Math.round(route.distance / 100) / 10
  const mins = Math.round(route.duration / 60)
  const duration = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins} min`
  return { distanceKm: km, duration }
}
const NOTE_TYPES_BASE = ['Observation', 'Alerte', 'Bilan', 'Objectif', 'Autre']
const NOTE_TYPES_KEY = 'tc_note_types_custom'
const TYPES_RDV = [
  { groupe: 'TC', options: ['Séance', 'Programme', 'Rendez-vous informations', 'Rendez-vous bilan', 'Règlement TC', 'Séance en autonomie', 'Autre activité', 'Parcours sportif'] },
  { groupe: 'Enezo', options: ['Rendez-vous infos Enezo', 'Rendez-vous bilan Enezo', 'Règlement Enezo'] },
  { groupe: 'FFD', options: ['Détection', 'Règlement FFD'] },
  { groupe: 'EMF', options: ['Séminaire', 'Règlement EMF'] },
]
const PARTIES_SEANCE = ['Échauffement', 'Corps de séance', 'Retour au calme', 'Séance complète']
const TYPES_SEANCE_CIRCUIT = ['Circuit classique','Tabata','Circuit en 30-10','Circuit varié (rep)','Circuit varié (temps)','Circuit varié']
const TYPES_EFFORT_SEANCE = ['Répétitions', 'Durée (sec)']
const toFirestoreEffort = (v: string) => v === 'Durée (sec)' ? 'Secondes' : v
const fromFirestoreEffort = (v: string) => v === 'Secondes' ? 'Durée (sec)' : v

function getSeanceCircuitDefaults(type: string) {
  switch (type) {
    case 'Tabata':                return { nb_tours: 4, recup_tours: 0,  tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 20 }
    case 'Circuit en 30-10':      return { nb_tours: 3, recup_tours: 10, tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 30 }
    case 'Circuit varié (rep)':   return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 10 }
    case 'Circuit varié (temps)': return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
    case 'Circuit varié':         return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 30 }
    default:                      return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
  }
}

const RPE_LABELS = [
  '1 — Très très facile',
  '2 — Très facile',
  '3 — Facile',
  '4 — Je sens un effort',
  '5 — Ça commence à être dur',
  '6 — Ça devient bien dur',
  '7 — Dur',
  '8 — Très dur',
  '9 — Très très dur',
  '10 — Tellement dur que je vais arrêter',
]

const QUESTIONS_FORME = [
  {
    key: 'qualite_sommeil', label: 'Sommeil',
    question: 'Qualité de sommeil de la nuit dernière ?',
    labels: ['1 — Très très bonne', '2 — Très bonne', '3 — Bonne', '4 — Moyenne', '5 — Mauvaise', '6 — Très mauvaise', '7 — Très très mauvaise'],
  },
  {
    key: 'niveau_fatigue', label: 'Fatigue',
    question: 'Niveau de fatigue actuel ?',
    labels: ['1 — Très très faible', '2 — Très faible', '3 — Faible', '4 — Moyen', '5 — Élevé', '6 — Très élevé', '7 — Très très élevé'],
  },
  {
    key: 'niveau_courbatures', label: 'Courbatures',
    question: 'Niveau de courbatures / douleurs ?',
    labels: ['1 — Très très faible', '2 — Très faible', '3 — Faible', '4 — Moyen', '5 — Élevé', '6 — Très élevé', '7 — Très très élevé'],
  },
  {
    key: 'quantite_stress', label: 'Stress',
    question: 'Quantité de stress actuelle ?',
    labels: ['1 — Très très faible', '2 — Très faible', '3 — Faible', '4 — Moyen', '5 — Élevée', '6 — Très élevée', '7 — Très très élevée'],
  },
  {
    key: 'motivation_avant_seance', label: 'Motivation',
    question: "Motivation à l'idée de faire la séance ?",
    labels: ['1 — Pas motivé', '2 — Peu motivé', '3 — Moyennement motivé', '4 — Motivé', '5 — Très motivé'],
  },
  {
    key: 'activite_derniers_jours', label: 'Activité',
    question: 'Activité physique ces derniers jours ?',
    labels: ['1 — Passif / Rien fait', '2 — Peu actif', '3 — Moyennement actif', '4 — Actif', '5 — Très actif'],
  },
  {
    key: 'alimentation_derniers_jours', label: 'Alimentation',
    question: 'Alimentation ces derniers jours ?',
    labels: ["1 — Que des excès", "2 — Beaucoup d'excès", "3 — Quelques excès", "4 — Très très peu d'excès", '5 — Aucun excès / Nutrition hyper saine'],
  },
]

function getEtatBadgeLocal(etat: string) {
  switch (etat) {
    case 'Calé': return { label: 'Calé', variant: 'success' as const }
    case 'Non calé': return { label: 'Non calé', variant: 'warning' as const }
    case 'Annulé': return { label: 'Annulé', variant: 'danger' as const }
    case 'Effectué': return { label: 'Effectué', variant: 'info' as const }
    default: return { label: etat || '—', variant: 'gray' as const }
  }
}

function scale5Color(val: number) {
  if (val <= 2) return 'text-red-500'
  if (val === 3) return 'text-orange-500'
  return 'text-green-600'
}
function rpeColor(rpe: number) {
  if (rpe <= 3) return 'text-green-600'
  if (rpe <= 7) return 'text-orange-500'
  return 'text-red-500'
}

const MOTIV_LABELS = ['Pas motivé', 'Peu motivé', 'Moyennement motivé', 'Motivé', 'Très motivé']
const INTENSITE_MISE_LABELS = ["Aucune intensité", "Minimum d'intensité", '50% de l\'intensité', 'Beaucoup d\'intensité', 'Toute l\'intensité']

function getNoteTypeStyle(type: string) {
  switch (type) {
    case 'Alerte':     return { card: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-700',    dot: 'text-red-500',    meta: 'text-red-400' }
    case 'Bilan':      return { card: 'bg-sky-50 border-sky-200',    badge: 'bg-sky-100 text-sky-700',    dot: 'text-sky-500',    meta: 'text-sky-400' }
    case 'Objectif':   return { card: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700', dot: 'text-green-500', meta: 'text-green-400' }
    case 'Observation':return { card: 'bg-orange-50 border-orange-200',badge: 'bg-orange-100 text-orange-700',dot: 'text-orange-500',meta: 'text-orange-400' }
    case 'Autre':      return { card: 'bg-gray-50 border-gray-200',  badge: 'bg-gray-100 text-gray-500',  dot: 'text-gray-400',   meta: 'text-gray-400' }
    default:           return { card: 'bg-violet-50 border-violet-200',badge: 'bg-violet-100 text-violet-700',dot: 'text-violet-500',meta: 'text-violet-400' }
  }
}

function SectionSep({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

export default function DetailPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const backDate = searchParams.get('date')
  const { currentUser, userProfile } = useAuth()
  const { brand } = useBrand() // espace actif (sélecteur) → domaine des liens envoyés au client
  const isAdmin = userProfile?.role_app === 'Admin'
  const droits = userProfile?.droits
  const { plannings, updatePlanning, deletePlanning } = usePlanning()
  const { seances, addSeance, updateSeance, deleteSeance } = useSeances(id)
  const { users } = useUsers()
  const { notes, addNote, updateNote, deleteNote } = useNotes()
  const { clients: allClients } = useClients()

  const planning = plannings.find((p) => p.id === id)
  const _rU = (planning as any)?.ref_users
  const _rC = (planning as any)?.ref_client
  // ref_client est toujours le client ; ref_users peut être le coach (anciens plannings Flutter)
  const clientId: string | undefined =
    _rC?.id ||
    _rC?.path?.split('/').pop() ||
    (typeof _rC === 'string' && _rC ? _rC.split('/').pop() : undefined) ||
    _rU?.id ||
    _rU?.path?.split('/').pop() ||
    (typeof _rU === 'string' && _rU ? _rU.split('/').pop() : undefined)
  const client = users.find((u) => u.id === clientId)

  // Normalise un linkedUserId : "uid", "users/uid" ou référence { id }
  const normUid = (v: any): string | null => {
    if (!v) return null
    if (typeof v === 'string') return v.includes('/') ? v.split('/').pop() ?? null : v
    return v.id ?? v.path?.split('/').pop() ?? null
  }

  // Charger tous les abonnements du coach et les indexer par UID app + id client
  const [allAbos, setAllAbos] = useState<any[]>([])
  useEffect(() => {
    if (!currentUser) return
    getDocs(query(collection(db, 'abonnements'), where('userId', '==', currentUser.uid)))
      .then((snap) => setAllAbos(snap.docs.map((d) => ({ id: d.id, ...d.data() as any }))))
      .catch(() => setAllAbos([]))
  }, [currentUser])

  const clientAbonnements = useMemo(() => {
    if (!clientId) return []
    const emailToUid: Record<string, string> = {}
    users.forEach((u) => { const e = (u as any).email?.toLowerCase?.(); if (e) emailToUid[e] = u.id })
    // clientId → UID app (linkedUserId OU email)
    const clientToUids: Record<string, Set<string>> = {}
    allClients.forEach((c) => {
      const set = new Set<string>()
      const lu = normUid((c as any).linkedUserId); if (lu) set.add(lu)
      const ce = (c as any).email?.toLowerCase?.(); if (ce && emailToUid[ce]) set.add(emailToUid[ce])
      clientToUids[c.id] = set
    })
    let list = allAbos.filter((a) => a.clientId === clientId || clientToUids[a.clientId]?.has(clientId))
    // Fallback 1 : RDV déjà lié à un abonnement
    if (list.length === 0 && (planning as any)?.abonnementId) {
      const abo = allAbos.find((a) => a.id === (planning as any).abonnementId)
      if (abo) list = allAbos.filter((a) => a.clientId === abo.clientId)
    }
    // Fallback 2 : matcher par nom complet du compte
    if (list.length === 0 && client) {
      const fullName = [client.nom, client.prenom].filter(Boolean).join(' ').toLowerCase().trim()
      if (fullName) {
        const ids = new Set(allClients.filter((c) => [c.nom, c.prenom].filter(Boolean).join(' ').toLowerCase().trim() === fullName).map((c) => c.id))
        list = allAbos.filter((a) => ids.has(a.clientId))
      }
    }
    return list.sort((x, y) => (x.dateDebut?.toMillis?.() ?? 0) - (y.dateDebut?.toMillis?.() ?? 0))
  }, [allAbos, allClients, clientId, users, planning, client])

  const notesClient = notes.filter((n) => {
    const refId = typeof n.ref_users === 'string' ? n.ref_users : (n.ref_users as any)?.id
    return refId === clientId
  })
  const notesActives = notesClient.filter((n) => {
    if (!n.date_max_note_active) return true
    return (n.date_max_note_active as any).toDate() >= new Date()
  })
  const notesExpirees = notesClient.filter(
    (n) => n.date_max_note_active && (n.date_max_note_active as any).toDate() < new Date()
  )

  const [derniersRdv, setDerniersRdv] = useState<any[]>([])
  const [prochainsRdvClient, setProchainsRdvClient] = useState<any[]>([])
  const [moyenneHooper, setMoyenneHooper] = useState<number | null>(null)
  const [rdvSequence, setRdvSequence] = useState<{ index: number; total: number } | null>(null)
  const [activitesSinceLastRdv, setActivitesSinceLastRdv] = useState<any[]>([])

  useEffect(() => {
    if (!clientId) return
    const fetchHistory = async () => {
      try {
        const userRef = doc(db, 'users', clientId)
        // Query both field names — no orderBy to avoid composite-index requirement
        const [s1, s2] = await Promise.all([
          getDocs(query(collection(db, 'planning_pro'), where('ref_client', '==', userRef))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, 'planning_pro'), where('ref_users', '==', userRef))).catch(() => ({ docs: [] as any[] })),
        ])
        const seen = new Set<string>()
        const all = [...s1.docs, ...s2.docs]
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r: any) => { if (r.id === id || seen.has(r.id)) return false; seen.add(r.id); return true }) as any[]

        const now = new Date()
        const past = all
          .filter((r) => r.date_planning?.toDate?.() < now)
          .sort((a, b) => (b.date_planning?.seconds ?? 0) - (a.date_planning?.seconds ?? 0))
        setDerniersRdv(past.slice(0, 5))

        const prochains = all
          .filter((r) => r.date_planning?.toDate?.() >= now)
          .sort((a, b) => (a.date_planning?.seconds ?? 0) - (b.date_planning?.seconds ?? 0))
        setProchainsRdvClient(prochains.slice(0, 3))

        const withHooper = past.filter((r) => r.indice_hooper)
        setMoyenneHooper(
          withHooper.length > 0
            ? Math.round(withHooper.reduce((s: number, r: any) => s + r.indice_hooper, 0) / withHooper.length * 10) / 10
            : null
        )

        // Activities since last RDV
        const lastRdvDate: Date | null = past[0]?.date_planning?.toDate?.() ?? null
        const actsSnap = await getDocs(
          query(collection(db, 'activites_clients'), where('clientId', '==', clientId))
        ).catch(() => ({ docs: [] as any[] }))
        const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[]
        const filteredActs = acts
          .filter((a) => {
            const d: Date | null = a.date_activite?.toDate?.() ?? null
            if (!d) return false
            return lastRdvDate ? d >= lastRdvDate : true
          })
          .sort((a, b) => (b.date_activite?.seconds ?? 0) - (a.date_activite?.seconds ?? 0))
        setActivitesSinceLastRdv(filteredActs)
      } catch (err) {
        console.error('fetchHistory error', err)
      }
    }
    fetchHistory()

  }, [clientId, id])

  useEffect(() => {
    if (!planning || !clientId) { setRdvSequence(null); return }
    const type = (planning as any).type_planning || 'Séance'
    const aboStart = (a: any) => a.dateDebut?.toMillis ? startOfDayMs(a.dateDebut.toMillis()) : 0
    const aboEnd = (a: any) => a.dateFin?.toMillis ? endOfDayMs(a.dateFin.toMillis()) : Infinity
    const periods = clientAbonnements.map((a) => ({ id: a.id, start: aboStart(a), end: aboEnd(a) }))
    if (periods.length === 0) { setRdvSequence(null); return }
    const getUid = (p: any) =>
      p.ref_client?.id || p.ref_client?.path?.split('/').pop() ||
      (typeof p.ref_client === 'string' && p.ref_client ? p.ref_client.split('/').pop() : undefined) ||
      p.ref_users?.id || p.ref_users?.path?.split('/').pop() ||
      (typeof p.ref_users === 'string' && p.ref_users ? p.ref_users.split('/').pop() : undefined)
    // Abonnement d'un RDV : rattachement explicite (abonnementId) sinon l'abonnement le plus
    // proche dans le temps. La date sert de repère, jamais de filtre bloquant : un RDV hors des
    // bornes [dateDebut, dateFin] (rattrapage après la fin, séance avancée…) reste rattaché.
    const assignAbo = (p: any): string | null => {
      const pAboId = (p as any).abonnementId
      if (pAboId && periods.some((per) => per.id === pAboId)) return pAboId
      const pSec = (p as any).heure_planning_debut?.seconds ?? (p as any).date_planning?.seconds ?? 0
      const pms = startOfDayMs(pSec * 1000)
      if (pms <= 0) return null
      let best: string | null = null, bestDist = Infinity
      for (const per of periods) {
        const dist = pms >= per.start && pms <= per.end ? 0 : pms < per.start ? per.start - pms : pms - per.end
        if (dist < bestDist) { bestDist = dist; best = per.id }
      }
      return best
    }
    const aboId = assignAbo(planning)
    if (!aboId) { setRdvSequence(null); return }
    const grouped = plannings
      .filter((p) =>
        getUid(p) === clientId &&
        ((p as any).type_planning || 'Séance') === type &&
        assignAbo(p) === aboId
      )
      .sort((a, b) => {
        const sa = (a as any).heure_planning_debut?.seconds ?? (a as any).date_planning?.seconds ?? 0
        const sb = (b as any).heure_planning_debut?.seconds ?? (b as any).date_planning?.seconds ?? 0
        return sa - sb
      })
    const idx = grouped.findIndex((p) => p.id === id)
    setRdvSequence(idx !== -1 ? { index: idx + 1, total: grouped.length } : null)
  }, [planning, plannings, id, clientId, clientAbonnements])

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSeanceModal, setShowSeanceModal] = useState(false)
  const [showEditSeanceModal, setShowEditSeanceModal] = useState(false)
  const [editSeanceItem, setEditSeanceItem] = useState<any>(null)
  const [editSeanceForm, setEditSeanceForm] = useState({
    type_seance: 'Circuit classique', partie_seance: 'Corps de séance',
    observations_seance: '', nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,
    type_effort_exo_default: 'Durée (sec)' as string, tps_effort_exo_default: 30, intensite_circuit_planifie: 0,
    num_circuit: 1,
  })
  const [deleteSeanceConfirm, setDeleteSeanceConfirm] = useState<string | null>(null)
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false)
  const [showQuestionnaireDirectModal, setShowQuestionnaireDirectModal] = useState(false)
  const [showResetQuestionnaireConfirm, setShowResetQuestionnaireConfirm] = useState(false)
  const [resettingQuestionnaire, setResettingQuestionnaire] = useState(false)
  const [showPlanifModal, setShowPlanifModal] = useState(false)
  const [showCrModal, setShowCrModal] = useState(false)
  const [crValue, setCrValue] = useState('')
  const [crDupliquer, setCrDupliquer] = useState(false)
  const [showCrCoachModal, setShowCrCoachModal] = useState(false)
  const [crCoachValue, setCrCoachValue] = useState('')
  const [crCoachDupliquer, setCrCoachDupliquer] = useState(false)
  const [showCrClientModal, setShowCrClientModal] = useState(false)
  const [crClientValue, setCrClientValue] = useState('')
  const [showBilanClientModal, setShowBilanClientModal] = useState(false)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [editNoteItem, setEditNoteItem] = useState<any>(null)
  const [addNoteForm, setAddNoteForm] = useState({ type_note: 'Observation', notes: '', date_max_note_active: '' })
  const [deleteNoteConfirm, setDeleteNoteConfirm] = useState<string | null>(null)
  const [customNoteTypes, setCustomNoteTypes] = useState<string[]>([])
  const [newNoteType, setNewNoteType] = useState('')

  useEffect(() => {
    try {
      const v = localStorage.getItem(NOTE_TYPES_KEY)
      if (v) setCustomNoteTypes(JSON.parse(v))
    } catch {}
  }, [])
  const clientRecord = useMemo<Client | null>(() => {
    if (!clientId) return null
    return allClients.find((c) => c.linkedUserId === clientId || c.id === clientId) ?? null
  }, [allClients, clientId])
  const [showFicheClient, setShowFicheClient] = useState(true)
  const [showEditFiche, setShowEditFiche] = useState(false)
  const [showUrgence, setShowUrgence] = useState(false)

  const [showExpiredNotes, setShowExpiredNotes] = useState(false)
  const [questionnaireEditUntil, setQuestionnaireEditUntil] = useState('')
  const [bilanClientIntensity, setBilanClientIntensity] = useState(1)
  const [bilanMotivationClient, setBilanMotivationClient] = useState(1)
  const [bilanIntensiteMiseClient, setBilanIntensiteMiseClient] = useState(1)
  const [intensitePlanifiee, setIntensitePlanifiee] = useState(1)
  const [planifMateriel, setPlanifMateriel] = useState<string[]>([])
  const [planifMarkRdvPret, setPlanifMarkRdvPret] = useState(false)
  const [planifFromRdvPret, setPlanifFromRdvPret] = useState(false)
  const [pendingEtat, setPendingEtat] = useState<string | null>(null)
  const [searchClientEdit, setSearchClientEdit] = useState('')

  const filteredUsersEdit = useMemo(() => {
    if (!searchClientEdit) return users
    const s = searchClientEdit.toLowerCase()
    return users.filter((u) =>
      [u.nom, u.prenom].filter(Boolean).join(" ").toLowerCase().includes(s) ||
      (u.email?.toLowerCase().includes(s) ?? false)
    )
  }, [users, searchClientEdit])

  const [newParticipant, setNewParticipant] = useState({ ref_planning_id: '' })

  const [searchNewParticipant, setSearchNewParticipant] = useState('')

  const [form, setForm] = useState({
    ref_client: '',
    date: '',
    heure_debut: '',
    heure_fin: '',
    adresse_rdv: '',
    etat_planning_rdv: 'Non calé',
    observations_rdv: '',
    type_planning: 'Séance',
    mode_rdv: 'Présentiel',
    materiel: [] as string[],
    abonnement_id: '',
    participants_supplementaires: [] as { ref_planning_id: string }[],
    distance_km: null as number | null,
    temps_route: '',
  })

  const filteredPlanningsForParticipant = useMemo(() => {
    const usedIds = new Set([id, ...form.participants_supplementaires.map((p) => p.ref_planning_id).filter(Boolean)])
    const candidates = plannings.filter((p) => !usedIds.has(p.id))
    if (!searchNewParticipant) return candidates.slice(0, 60)
    const s = searchNewParticipant.toLowerCase()
    return candidates.filter((p) => {
      const ru = (p as any).ref_users
      const rc = (p as any).ref_client
      const uid = ru?.id || ru?.path?.split('/').pop() || rc?.id || rc?.path?.split('/').pop() || ''
      const pu = users.find((u) => u.id === uid)
      const name = pu ? `${pu.prenom ?? ''} ${pu.nom ?? ''}`.toLowerCase() : ''
      const date = formatDate((p as any).date_planning).toLowerCase()
      const type = ((p as any).type_planning ?? '').toLowerCase()
      return name.includes(s) || date.includes(s) || type.includes(s)
    }).slice(0, 60)
  }, [plannings, form.participants_supplementaires, id, searchNewParticipant, users])
  const [calcDistance, setCalcDistance] = useState(false)

  const handleCalculateDistance = async (toAddr?: string) => {
    const from = (userProfile as any)?.adresse_postale || (userProfile as any)?.rue_adresse || ''
    const to = toAddr ?? form.adresse_rdv
    if (!from || !to) return
    setCalcDistance(true)
    try {
      const [fromCoords, toCoords] = await Promise.all([geocodeAddress(from), geocodeAddress(to)])
      if (!fromCoords || !toCoords) { setCalcDistance(false); return }
      const { distanceKm, duration } = await calculateRoute(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng)
      setForm((f) => ({ ...f, distance_km: distanceKm, temps_route: duration }))
    } catch { /* ignore */ }
    setCalcDistance(false)
  }

  const [seanceForm, setSeanceForm] = useState({
    type_seance: 'Circuit classique',
    partie_seance: 'Corps de séance',
    observations_seance: '',
    nb_tours: 3,
    recup_tours: 30,
    tps_recup_exo_default: 5,
    type_effort_exo_default: 'Durée (sec)' as string,
    tps_effort_exo_default: 30,
    intensite_circuit_planifie: 0,
    num_circuit: 1,
  })

  const [questionnaireForm, setQuestionnaireForm] = useState({
    qualite_sommeil: 1,
    niveau_fatigue: 1,
    niveau_courbatures: 1,
    quantite_stress: 1,
    motivation_avant_seance: 1,
    activite_derniers_jours: 1,
    alimentation_derniers_jours: 1,
    infos_complementaire_avant_seance_client: '',
    douleurs: [] as PainPoint[],
  })

  // Sync questionnaire_editable_until avec le planning
  useEffect(() => {
    const eu = (planning as any)?.questionnaire_editable_until
    setQuestionnaireEditUntil(eu ? new Date(eu.seconds * 1000).toISOString().split('T')[0] : '')
  }, [(planning as any)?.questionnaire_editable_until?.seconds])

  const handleQuestionnaireEditUntil = async (dateStr: string) => {
    setQuestionnaireEditUntil(dateStr)
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number)
      const picked = new Date(y, m - 1, d, 23, 59, 59, 999)
      // Ne jamais autoriser la modification au-delà de l'heure de fin de la séance
      const sessionEnd = (planning as any)?.heure_planning_fin?.toDate?.()
      const finalDate = sessionEnd && sessionEnd < picked ? sessionEnd : picked
      await updatePlanning(id, { questionnaire_editable_until: Timestamp.fromDate(finalDate) } as any)
    } else {
      await updatePlanning(id, { questionnaire_editable_until: null } as any)
    }
  }

  const openEdit = () => {
    if (!planning) return
    const date = (planning.date_planning as any)?.toDate()
    const debut = (planning.heure_planning_debut as any)?.toDate()
    const fin = (planning.heure_planning_fin as any)?.toDate()
    setForm({
      ref_client: clientId || '',
      date: date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '',
      heure_debut: debut ? `${String(debut.getHours()).padStart(2,'0')}:${String(debut.getMinutes()).padStart(2,'0')}` : '',
      heure_fin: fin ? `${String(fin.getHours()).padStart(2,'0')}:${String(fin.getMinutes()).padStart(2,'0')}` : '',
      adresse_rdv: planning.adresse_rdv || '',
      etat_planning_rdv: planning.etat_planning_rdv || 'Non calé',
      observations_rdv: planning.observations_rdv || '',
      type_planning: (planning as any).type_planning || 'Séance',
      mode_rdv: (planning as any).mode_rdv || 'Présentiel',
      materiel: Array.isArray((planning as any).materiel) ? (planning as any).materiel : (planning as any).materiel ? [(planning as any).materiel] : [],
      abonnement_id: (planning as any).abonnementId || '',
      participants_supplementaires: [] as { ref_planning_id: string }[],
      distance_km: (planning as any).distance_km ?? null,
      temps_route: (planning as any).temps_route || '',
    })
    setSearchClientEdit('')
    setNewParticipant({ ref_planning_id: '' })
    setSearchNewParticipant('')
    const existingParts = (((planning as any).participants_supplementaires as any[]) || [])
      .map((p: any) => ({
        ref_planning_id: (typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '') || p.ref_planning?.id || p.ref_planning?.path?.split('/').pop() || '',
      }))
      .filter((p) => p.ref_planning_id)
    setForm((prev) => ({ ...prev, participants_supplementaires: existingParts }))
    setShowEditModal(true)
  }

  const openQuestionnaireDirect = () => {
    if (!planning) return
    if (!isAdmin && isSessionPastForLock) return
    setQuestionnaireForm({
      qualite_sommeil: (planning as any).qualite_sommeil || 1,
      niveau_fatigue: (planning as any).niveau_fatigue || 1,
      niveau_courbatures: (planning as any).niveau_courbatures || 1,
      quantite_stress: (planning as any).quantite_stress || 1,
      motivation_avant_seance: (planning as any).motivation_avant_seance || 1,
      activite_derniers_jours: (planning as any).activite_derniers_jours || 1,
      alimentation_derniers_jours: (planning as any).alimentation_derniers_jours || 1,
      infos_complementaire_avant_seance_client: (planning as any).infos_complementaire_avant_seance_client || '',
      douleurs: Array.isArray((planning as any).douleurs) ? (planning as any).douleurs : [],
    })
    setShowQuestionnaireDirectModal(true)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    const [year, month, day] = form.date.split('-').map(Number)
    const dateObj = new Date(year, month - 1, day)
    // Détecter un décalage de jour avec un questionnaire déjà rempli → proposer une réinitialisation
    const oldDate = (planning as any)?.date_planning?.toDate?.()
    const dayChanged = oldDate ? startOfDayMs(oldDate.getTime()) !== startOfDayMs(dateObj.getTime()) : false
    const questionnaireDejaRempli = !!((planning as any)?.questionnaire_rempli || (planning as any)?.indice_hooper != null)
    const [hDebut, mDebut] = form.heure_debut.split(':').map(Number)
    const [hFin, mFin] = form.heure_fin.split(':').map(Number)
    const dateDebut = new Date(dateObj); dateDebut.setHours(hDebut, mDebut, 0)
    const dateFin = new Date(dateObj); dateFin.setHours(hFin, mFin, 0)
    const payload: any = {
      date_planning: Timestamp.fromDate(dateObj),
      heure_planning_debut: Timestamp.fromDate(dateDebut),
      heure_planning_fin: Timestamp.fromDate(dateFin),
      adresse_rdv: form.adresse_rdv,
      etat_planning_rdv: form.etat_planning_rdv,
      observations_rdv: form.observations_rdv,
      type_planning: form.type_planning,
      mode_rdv: form.mode_rdv,
      materiel: form.materiel,
    }
    if (form.ref_client) {
      const userRef = doc(db, 'users', form.ref_client)
      payload.ref_client = userRef
      payload.ref_users = userRef
    }
    if (form.distance_km != null) payload.distance_km = form.distance_km
    if (form.temps_route) payload.temps_route = form.temps_route
    if (form.abonnement_id) payload.abonnementId = form.abonnement_id
    payload.participants_supplementaires = form.participants_supplementaires
      .filter((p) => p.ref_planning_id)
      .map((p) => ({ ref_planning_id: p.ref_planning_id }))
    await updatePlanning(id, payload)
    setShowEditModal(false)
    // RDV décalé à un autre jour alors que le client avait déjà rempli son questionnaire :
    // proposer de le réinitialiser pour qu'il le remplisse à neuf pour la nouvelle date.
    if (dayChanged && questionnaireDejaRempli) setShowResetQuestionnaireConfirm(true)
  }

  const handleDelete = async () => {
    await deletePlanning(id)
    router.push('/planning')
  }

  const handleRemoveParticipant = async (index: number) => {
    const parts = (((planning as any).participants_supplementaires as any[]) || [])
    const updated = parts.filter((_: any, i: number) => i !== index)
    await updatePlanning(id, { participants_supplementaires: updated } as any)
  }

  const handleEtatChange = async (etat: string) => {
    await updatePlanning(id, { etat_planning_rdv: etat } as any)
    setPendingEtat(null)
  }

  const handleToggleRdvPret = () => {
    const isSeance = ((planning as any)?.type_planning ?? '') === 'Séance'
    const isSetting = (planning as any)?.rdv_pret !== 'Oui'
    if (isSeance && isSetting) {
      // Ouvrir le modal planif pour vérifier matériel + RPE avant de marquer prêt
      setIntensitePlanifiee((planning as any)?.intensite_seance_planifiee || 1)
      setPlanifMateriel(Array.isArray((planning as any)?.materiel) ? [...(planning as any).materiel] : [])
      setPlanifMarkRdvPret(true)
      setPlanifFromRdvPret(true)
      setShowPlanifModal(true)
    } else {
      updatePlanning(id, { rdv_pret: (planning as any)?.rdv_pret === 'Oui' ? '' : 'Oui' } as any)
    }
  }

  const handleToggleRdvEffectue = async () => {
    await updatePlanning(id, { rdv_effectue: (planning as any)?.rdv_effectue === 'Effectué' ? '' : 'Effectué' } as any)
  }

  const handleAddSeance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    const seanceBase = {
      ...seanceForm,
      nb_tours: Number(seanceForm.nb_tours),
      recup_tours: Number(seanceForm.recup_tours),
      tps_recup_exo_default: Number(seanceForm.tps_recup_exo_default),
      type_effort_exo_default: toFirestoreEffort(seanceForm.type_effort_exo_default),
      tps_effort_exo_default: Number(seanceForm.tps_effort_exo_default),
      intensite_circuit_planifie: Number(seanceForm.intensite_circuit_planifie),
      ref_users: doc(db, 'users', currentUser.uid) as any,
      num_circuit: Number(seanceForm.num_circuit),
      avancement_circuit: 0,
      nb_exercice: 0,
      date_create: Timestamp.now(),
    }
    await addSeance({ ...seanceBase, ref_planning: doc(db, 'planning_pro', id) as any } as any)
    // Créer la même séance pour chaque participant ayant un RDV lié
    const suppParts = ((planning as any).participants_supplementaires as any[]) || []
    for (const p of suppParts) {
      const partPlanningId = (typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '') || p.ref_planning?.id || p.ref_planning?.path?.split('/').pop() || ''
      if (partPlanningId) {
        await addSeance({ ...seanceBase, ref_planning: doc(db, 'planning_pro', partPlanningId) as any } as any)
      }
    }
    setShowSeanceModal(false)
    setSeanceForm({
      type_seance: 'Circuit classique', partie_seance: 'Corps de séance',
      observations_seance: '', nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,
      type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30, intensite_circuit_planifie: 0,
      num_circuit: 1,
    })
  }

  const openEditSeance = (s: any) => {
    setEditSeanceItem(s)
    setEditSeanceForm({
      type_seance: s.type_seance || 'Circuit classique',
      partie_seance: s.partie_seance || 'Corps de séance',
      observations_seance: s.observations_seance || '',
      nb_tours: s.nb_tours ?? 3,
      recup_tours: s.recup_tours ?? 30,
      tps_recup_exo_default: s.tps_recup_exo_default ?? 5,
      type_effort_exo_default: fromFirestoreEffort(s.type_effort_exo_default || 'Durée (sec)'),
      tps_effort_exo_default: s.tps_effort_exo_default ?? 30,
      intensite_circuit_planifie: s.intensite_circuit_planifie ?? 0,
      num_circuit: s.num_circuit ?? 1,
    })
    setShowEditSeanceModal(true)
  }

  const handleEditSeance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editSeanceItem) return
    await updateSeance(editSeanceItem.id, {
      ...editSeanceForm,
      nb_tours: Number(editSeanceForm.nb_tours),
      recup_tours: Number(editSeanceForm.recup_tours),
      tps_recup_exo_default: Number(editSeanceForm.tps_recup_exo_default),
      type_effort_exo_default: toFirestoreEffort(editSeanceForm.type_effort_exo_default),
      tps_effort_exo_default: Number(editSeanceForm.tps_effort_exo_default),
      intensite_circuit_planifie: Number(editSeanceForm.intensite_circuit_planifie),
      num_circuit: Number(editSeanceForm.num_circuit),
    } as any)
    setShowEditSeanceModal(false)
    setEditSeanceItem(null)
  }

  const handleMoveSeance = async (seanceId: string, direction: 'up' | 'down') => {
    const sorted = [...seances].sort((a, b) => ((a as any).num_circuit || 0) - ((b as any).num_circuit || 0))
    const idx = sorted.findIndex(s => s.id === seanceId)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === sorted.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const a = sorted[idx]
    const b = sorted[swapIdx]
    const numA = (a as any).num_circuit ?? idx + 1
    const numB = (b as any).num_circuit ?? swapIdx + 1
    await Promise.all([
      updateSeance(a.id, { num_circuit: numB } as any),
      updateSeance(b.id, { num_circuit: numA } as any),
    ])
  }

  const handleDeleteSeance = async (seanceId: string) => {
    await deleteSeance(seanceId)
    setDeleteSeanceConfirm(null)
  }

  const handleSubmitQuestionnaire = async (e: React.FormEvent) => {
    e.preventDefault()
    // Les non-admin ne peuvent plus modifier après la fin du RDV
    if (!isAdmin && isSessionPastForLock) return
    const indice_hooper =
      questionnaireForm.qualite_sommeil +
      questionnaireForm.niveau_fatigue +
      questionnaireForm.niveau_courbatures +
      questionnaireForm.quantite_stress
    try {
      await updatePlanning(id, {
        qualite_sommeil: questionnaireForm.qualite_sommeil,
        niveau_fatigue: questionnaireForm.niveau_fatigue,
        niveau_courbatures: questionnaireForm.niveau_courbatures,
        quantite_stress: questionnaireForm.quantite_stress,
        motivation_avant_seance: questionnaireForm.motivation_avant_seance,
        activite_derniers_jours: questionnaireForm.activite_derniers_jours,
        alimentation_derniers_jours: questionnaireForm.alimentation_derniers_jours,
        infos_complementaire_avant_seance_client: questionnaireForm.infos_complementaire_avant_seance_client,
        douleurs: questionnaireForm.douleurs,
        questionnaire_rempli: true,
        indice_hooper,
      } as any)
      setShowQuestionnaireDirectModal(false)
    } catch (err: any) {
      alert(`Erreur lors de l'enregistrement : ${err?.message ?? 'inconnue'}`)
    }
  }

  // Réinitialise le questionnaire de forme du RDV (ex. après décalage de la date) :
  // efface les réponses du client et supprime les anciennes notifications de rappel,
  // pour qu'il reparte de zéro lors du prochain "Rappel rdv".
  const handleResetQuestionnaire = async () => {
    setResettingQuestionnaire(true)
    try {
      await updatePlanning(id, {
        qualite_sommeil: null,
        niveau_fatigue: null,
        niveau_courbatures: null,
        quantite_stress: null,
        motivation_avant_seance: null,
        activite_derniers_jours: null,
        alimentation_derniers_jours: null,
        infos_complementaire_avant_seance_client: '',
        douleurs: [],
        questionnaire_rempli: false,
        indice_hooper: null,
        questionnaire_editable_until: null,
      } as any)
      // Purge les notifications QUESTIONNAIRE_FORME liées à ce RDV (rappel devient renvoyable proprement)
      try {
        const planningRef = doc(db, 'planning_pro', id)
        const snap = await getDocs(query(
          collection(db, 'Notifications'),
          where('type_notification', '==', 'QUESTIONNAIRE_FORME'),
          where('ref_planning', '==', planningRef),
        ))
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
      } catch { /* silencieux */ }
      setShowResetQuestionnaireConfirm(false)
    } catch (err: any) {
      alert(`Erreur lors de la réinitialisation : ${err?.message ?? 'inconnue'}`)
    } finally {
      setResettingQuestionnaire(false)
    }
  }

  const openBilanClient = () => {
    // Même garde que `openQuestionnaireDirect` : le bouton est déjà masqué,
    // mais la fonction reste appelable — on referme la porte des deux côtés.
    if (!isAdmin && isSessionPastForLock) return
    setBilanMotivationClient((planning as any)?.motivation_pdt_seance ?? 0)
    setBilanIntensiteMiseClient((planning as any)?.intensite_mise_pdt_seance ?? 0)
    setBilanClientIntensity((planning as any)?.intensite_seance ?? 0)
    setShowBilanClientModal(true)
  }

  const handleSendSMS = async () => {
    const phone = client?.phone_number || ''
    const debut = (planning as any)?.heure_planning_debut?.toDate?.()
    const heure = debut
      ? `${String(debut.getHours()).padStart(2, '0')}h${String(debut.getMinutes()).padStart(2, '0')}`
      : ''
    const adresse = planning?.adresse_rdv || ''
    const typePlanning = ((planning as any)?.type_planning || 'Séance') as string
    const isSeance = typePlanning.toLowerCase().includes('séance')

    let message = `Bonjour,\n\nRappel de ton rendez-vous aujourd'hui${heure ? ` à ${heure}` : ''}.`
    if (adresse) message += `\nLieu de séance : ${adresse}.`
    if (isSeance) {
      // Le lien part chez le client : il doit porter le domaine de l'ESPACE ACTIF
      // (sélecteur de marque), pas celui depuis lequel on navigue. Enezo → app.enezo.fr,
      // coaching → l'origine courante (pas de domaine coaching dédié pour l'instant).
      const origin = publicLinkOrigin(brand, window.location.origin)
      const lien = `${origin}/questionnaire/${id}`
      message += `\n\nMerci de remplir ton questionnaire de forme avant la séance :\n${lien}`
    }
    message += `\n\nBonne journée\n\nTeddy`

    const smsUrl = phone
      ? `sms:${phone}?body=${encodeURIComponent(message)}`
      : `sms:?body=${encodeURIComponent(message)}`
    window.open(smsUrl, '_blank')

    // Créer une notification in-app pour le client si c'est une séance
    if (isSeance && clientId) {
      try {
        const planningRef = doc(db, 'planning_pro', id)
        const clientRef = doc(db, 'users', clientId)
        const existing = await getDocs(query(
          collection(db, 'Notifications'),
          where('refUsers', '==', clientRef),
          where('type_notification', '==', 'QUESTIONNAIRE_FORME'),
          where('ref_planning', '==', planningRef),
        ))
        if (existing.empty) {
          await addDoc(collection(db, 'Notifications'), {
            refUsers: clientRef,
            type_notification: 'QUESTIONNAIRE_FORME',
            notification: 'Pensez à remplir votre questionnaire de forme avant la séance.',
            etat_notification: 'Non lu',
            ref_planning: planningRef,
            date_create: Timestamp.now(),
          })
        }
      } catch {}
    }
  }

  const handleAddToCalendar = () => {
    if (!planning) return
    const debut = (planning.heure_planning_debut as any)?.toDate?.()
    const fin = (planning.heure_planning_fin as any)?.toDate?.()
    if (!debut || !fin) return

    const toGcal = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

    const type = (planning as any).type_planning || 'Séance'

    // X = tous les rdvs de ce type pour ce client (depuis plannings déjà en mémoire)
    const getUid = (p: any) =>
      (p as any).ref_client?.id || (p as any).ref_client?.path?.split('/').pop() ||
      (typeof (p as any).ref_client === 'string' && (p as any).ref_client ? (p as any).ref_client.split('/').pop() : undefined) ||
      (p as any).ref_users?.id || (p as any).ref_users?.path?.split('/').pop() ||
      (typeof (p as any).ref_users === 'string' && (p as any).ref_users ? (p as any).ref_users.split('/').pop() : undefined)
    const timeSec = (p: any) => (p as any).heure_planning_debut?.seconds ?? (p as any).date_planning?.seconds ?? 0
    const clientRdvs = clientId
      ? plannings
          .filter((p) => getUid(p) === clientId && (((p as any).type_planning as string) || 'Séance') === type)
          .sort((a, b) => timeSec(a) - timeSec(b))
      : []
    const totalAll = clientRdvs.length
    const clientName = client
      ? `${(client.nom ?? '').toUpperCase()} ${client.prenom ?? ''}`.trim()
      : ''

    const countStr = totalAll > 0 ? ` ${totalAll}` : ''
    const seqStr = rdvSequence ? ` (${rdvSequence.index}/${rdvSequence.total})` : ''
    const nameStr = clientName ? ` ${clientName}` : ''
    const title = `${type}${countStr}${seqStr}${nameStr}`.trim()

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${toGcal(debut)}/${toGcal(fin)}`,
    })
    if (planning.adresse_rdv) params.set('location', planning.adresse_rdv)

    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank')
  }

  if (!planning) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const etat = getEtatBadgeLocal(planning.etat_planning_rdv)
  const indiceHooper = (planning as any).indice_hooper
  const adresse = planning.adresse_rdv

  const displayName = client
    ? [client.nom, client.prenom].filter(Boolean).join(" ")
    : clientRecord
      ? [clientRecord.nom, clientRecord.prenom].filter(Boolean).join(" ")
      : null

  const debutDate = (planning.heure_planning_debut as any)?.toDate?.()
  const finDate = (planning.heure_planning_fin as any)?.toDate?.()
  const durationMin = debutDate && finDate ? Math.round((finDate.getTime() - debutDate.getTime()) / 60000) : null
  const chargePlanifiee = durationMin && (planning as any).intensite_seance_planifiee
    ? durationMin * (planning as any).intensite_seance_planifiee : null
  const chargeRessenti = durationMin && (planning as any).intensite_seance > 0
    ? durationMin * (planning as any).intensite_seance : null

  const phoneNumber = client?.phone_number || clientRecord?.telephone || null
  const urgenceNom = client?.contactUrgenceNom || clientRecord?.contactUrgenceNom || null
  const urgenceTel = client?.contactUrgenceTel || clientRecord?.contactUrgenceTel || null
  const urgenceRelation = client?.contactUrgenceRelation || clientRecord?.contactUrgenceRelation || null
  const wazeLink = adresse ? `https://waze.com/ul?q=${encodeURIComponent(adresse)}&navigate=yes` : null
  const mapsLink = adresse ? `https://maps.google.com/?q=${encodeURIComponent(adresse)}` : null
  const lastWithCr = derniersRdv.find((r) => r.observations_rdv || r.cr_rdv_moi || r.cr_rdv_client)

  // Enezo (ex S&C) : type_planning migré contient « Enezo » ; on garde « S&C » pour les non-migrés.
  const isSC = /S&C|Enezo/.test((planning as any).type_planning ?? '')

  // Verrou questionnaire : RDV passé (heure_planning_fin, sinon fin de journée de date_planning)
  const sessionEndForLock: Date | null = (() => {
    const fin = (planning as any)?.heure_planning_fin?.toDate?.()
    if (fin) return fin
    const dp = (planning as any)?.date_planning?.toDate?.()
    if (!dp) return null
    const end = new Date(dp)
    end.setHours(23, 59, 59, 999)
    return end
  })()
  const isSessionPastForLock = sessionEndForLock ? sessionEndForLock < new Date() : false

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(backDate ? `/planning?date=${backDate}` : '/planning')} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-800 truncate">
            {displayName ?? 'Détail du RDV'}
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-sm text-gray-500 capitalize">{formatDate(planning.date_planning as any)}</p>
            {rdvSequence && (
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                RDV {rdvSequence.index}/{rdvSequence.total}
              </span>
            )}
          </div>
        </div>
        {isAdmin && (
          <>
            <button onClick={openEdit} className="p-2 rounded-lg hover:bg-gray-100 transition text-blue-600">
              <PencilIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-lg hover:bg-red-50 transition text-red-500">
              <TrashIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* ─── INFORMATIONS ─── */}
      <SectionSep label="Informations" />

      {/* Infos RDV */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        {client && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Client</span>
            <span className="text-sm font-semibold text-blue-600">{client.prenom} {client.nom}</span>
          </div>
        )}
        {((planning as any).participants_supplementaires as any[])?.filter((p: any) => p.ref_users).map((p: any, i: number) => {
          const pu = users.find((u) => u.id === (p.ref_users?.id || p.ref_users?.path?.split('/').pop()))
          return pu ? (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-500 shrink-0">Participant {i + 2}</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-blue-600 truncate">{pu.prenom} {pu.nom}</span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(i)}
                    className="shrink-0 p-0.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition"
                    title="Retirer ce participant"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ) : null
        })}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Horaire</span>
          <span className="text-sm font-semibold text-gray-800">
            {formatHeure(planning.heure_planning_debut as any)} → {formatHeure(planning.heure_planning_fin as any)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">État</span>
          <Badge label={etat.label} variant={etat.variant} />
        </div>
        {(planning as any).type_planning && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Type</span>
            <span className="text-sm text-gray-800">{(planning as any).type_planning}</span>
          </div>
        )}
        {(planning as any).mode_rdv && (planning as any).mode_rdv !== 'Présentiel' && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Mode</span>
            <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{(planning as any).mode_rdv}</span>
          </div>
        )}
        {adresse && (
          <div>
            <span className="text-sm text-gray-500 block mb-1">Adresse</span>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{adresse}</p>
                {isAdmin && ((planning as any).distance_km != null || (planning as any).temps_route) && (
                  <p className="text-xs text-blue-600 font-medium mt-0.5">
                    {(planning as any).distance_km != null ? `${(planning as any).distance_km} km` : ''}
                    {(planning as any).distance_km != null && (planning as any).temps_route ? ' · ' : ''}
                    {(planning as any).temps_route || ''}
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {wazeLink && (
                  <a href={wazeLink} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs bg-sky-500 text-white px-2.5 py-1 rounded-lg hover:bg-sky-600 transition">
                    <MapPinIcon className="w-3.5 h-3.5" />
                    Waze
                  </a>
                )}
                {mapsLink && (
                  <a href={mapsLink} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs bg-red-500 text-white px-2.5 py-1 rounded-lg hover:bg-red-600 transition">
                    <GlobeAltIcon className="w-3.5 h-3.5" />
                    Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
        {isAdmin && Array.isArray((planning as any).materiel) && (planning as any).materiel.length > 0 && (
          <div>
            <span className="text-sm text-gray-500 block mb-1">Matériel</span>
            <div className="flex flex-wrap gap-1">
              {(planning as any).materiel.map((m: string) => (
                <span key={m} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Coordonnées client */}
      {(client || clientRecord) && (phoneNumber || client?.email || clientRecord?.email || urgenceNom) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">Coordonnées</p>
          {phoneNumber && (
            <div className="flex items-center gap-2">
              <PhoneIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 flex-1">{phoneNumber}</span>
              <div className="flex gap-1.5">
                <a href={`tel:${phoneNumber}`}
                  className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition">
                  Appel
                </a>
                <a href={`sms:${phoneNumber}`}
                  className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                  SMS
                </a>
              </div>
            </div>
          )}
          {(client?.email || clientRecord?.email) && (
            <div className="flex items-center gap-2">
              <EnvelopeIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 flex-1 break-all">{client?.email || clientRecord?.email}</span>
              <a href={`mailto:${client?.email || clientRecord?.email}`}
                className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-gray-700 text-white hover:bg-gray-800 transition flex-shrink-0">
                Mail
              </a>
            </div>
          )}
          {!phoneNumber && !client?.email && !clientRecord?.email && !urgenceNom && (
            <p className="text-sm text-gray-400 italic">Aucune coordonnée renseignée</p>
          )}
          {urgenceNom && !isSC && (
            <div className="border-t border-dashed border-gray-100 pt-3">
              <button
                onClick={() => setShowUrgence(v => !v)}
                className="flex items-center justify-between w-full text-left gap-2"
              >
                <p className="text-xs font-medium text-gray-500">
                  Contact d'urgence — {urgenceNom}{urgenceRelation ? ` (${urgenceRelation})` : ''}
                </p>
                <ChevronDownIcon className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${showUrgence ? 'rotate-180' : ''}`} />
              </button>
              {showUrgence && urgenceTel && (
                <div className="flex items-center gap-2 mt-2">
                  <PhoneIcon className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 flex-1">{urgenceTel}</span>
                  <div className="flex gap-1.5">
                    <a href={`tel:${urgenceTel}`}
                      className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition">
                      Appel
                    </a>
                    <a href={`sms:${urgenceTel}`}
                      className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                      SMS
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── FICHE CLIENT ─── */}
      {clientRecord && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div
            onClick={() => setShowFicheClient((v) => !v)}
            className="flex items-start gap-2 px-4 py-3 hover:bg-gray-50 transition cursor-pointer"
          >
            {/* Partie gauche : titre + badges (wrappable) */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-700 mb-1">Fiche client</p>
              <div className="flex flex-wrap gap-1.5">
                {clientRecord.objectifs && clientRecord.objectifs.length > 0 && (
                  <span className="inline-flex items-center text-[10px] leading-none bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                    {clientRecord.objectifs.length} objectif{clientRecord.objectifs.length > 1 ? 's' : ''}
                  </span>
                )}
                {clientRecord.antecedentsMedicaux && clientRecord.antecedentsMedicaux.length > 0 && (
                  <span className="inline-flex items-center text-[10px] leading-none bg-red-100 text-red-600 px-2 py-1 rounded-full font-medium">
                    {clientRecord.antecedentsMedicaux.length} antécédent{clientRecord.antecedentsMedicaux.length > 1 ? 's' : ''}
                  </span>
                )}
                {clientRecord.antecedentsSportifs && clientRecord.antecedentsSportifs.length > 0 && (
                  <span className="inline-flex items-center text-[10px] leading-none bg-orange-100 text-orange-600 px-2 py-1 rounded-full font-medium">
                    {clientRecord.antecedentsSportifs.length} ant. sportif{clientRecord.antecedentsSportifs.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            {/* Partie droite : actions */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              {isAdmin && clientId && (
                <button
                  onClick={() => router.push(`/clients/${clientId}/stats`)}
                  className="p-1.5 text-purple-500 hover:bg-purple-50 rounded-lg transition"
                  title="Évolution du client"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => setShowEditFiche(true)}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                  title="Modifier la fiche client"
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              )}
              {showFicheClient ? <ChevronUpIcon className="w-4 h-4 text-gray-400" /> : <ChevronDownIcon className="w-4 h-4 text-gray-400" />}
            </div>
          </div>
          {showFicheClient && (
            <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
              {/* Objectifs */}
              {clientRecord.objectifs && clientRecord.objectifs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Objectifs</p>
                  <div className="space-y-1.5">
                    {clientRecord.objectifs.map((o, i) => (
                      <div key={i} className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${o.priorite === 'Primaire' ? 'bg-blue-500' : 'bg-gray-300'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{o.texte}</p>
                          {o.donneeChiffree && <p className="text-xs text-gray-500">{o.donneeChiffree}</p>}
                          {o.commentaire && <p className="text-xs text-gray-400 italic mt-0.5">{o.commentaire}</p>}
                        </div>
                        {o.dateObjectif && <span className="text-xs text-gray-400 shrink-0">avant le {new Date(o.dateObjectif).toLocaleDateString('fr-FR')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Antécédents médicaux */}
              {clientRecord.antecedentsMedicaux && clientRecord.antecedentsMedicaux.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Antécédents médicaux</p>
                  <div className="space-y-1.5">
                    {clientRecord.antecedentsMedicaux.map((a, i) => (
                      <div key={i} className={`rounded-xl border px-3 py-2 ${a.estContreIndication ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800">{a.description}</span>
                            {a.estContreIndication && <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Contre-indication</span>}
                            {a.estChronique && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">Chronique</span>}
                          </div>
                          {(a.anneeDebut || a.anneeFin) && (
                            <span className="text-xs text-gray-400 shrink-0">{a.anneeDebut || '?'}{a.anneeFin ? ` → ${a.anneeFin}` : ''}</span>
                          )}
                        </div>
                        {a.zonesCorps && a.zonesCorps.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {a.zonesCorps.map((z, i) => <span key={i} className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{[z.cote, z.partie, z.structure].filter(Boolean).join(' · ')}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Profil sport */}
              {!isSC && (clientRecord.sportPratique || clientRecord.niveauSportif) && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Profil sportif</p>
                  <p className="text-sm text-gray-700">
                    {clientRecord.sportPratique}{clientRecord.niveauSportif ? ` · ${clientRecord.niveauSportif}` : ''}
                  </p>
                </div>
              )}
              {/* Antécédents sportifs */}
              {!isSC && clientRecord.antecedentsSportifs && clientRecord.antecedentsSportifs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Historique sportif</p>
                  <div className="space-y-1">
                    {clientRecord.antecedentsSportifs.map((s, i) => (
                      <div key={i} className="text-sm text-gray-700">
                        <span className="font-medium">{s.sport}</span>
                        {(s.anneeDebut || s.anneeFin) && <span className="text-gray-400 ml-2 text-xs">{s.anneeDebut || '?'}{s.anneeFin ? ` → ${s.anneeFin}` : ' → en cours'}</span>}
                        {s.niveau && <span className="text-gray-400 ml-1 text-xs">· {s.niveau}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!clientRecord.objectifs?.length && !clientRecord.antecedentsMedicaux?.length && !clientRecord.sportPratique && !clientRecord.antecedentsSportifs?.length && (
                <p className="text-sm text-gray-400 italic">Aucune information complémentaire renseignée.</p>
              )}
            </div>
          )}
        </div>
      )}

      <ClientEditModal
        client={clientRecord}
        isOpen={showEditFiche}
        onClose={() => setShowEditFiche(false)}
      />

      {/* ─── ÉTAT & STATUT (admin) ─── */}
      {isAdmin && (
        <>
          <SectionSep label="État & statut" />

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">État du RDV</p>
              <div className="flex flex-wrap gap-2">
                {ETATS.map((e) => (
                  <button key={e} onClick={() => setPendingEtat(e)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                      planning.etat_planning_rdv === e
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleToggleRdvPret}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition border ${
                  (planning as any).rdv_pret === 'Oui'
                    ? 'bg-green-500 text-white border-green-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {(planning as any).rdv_pret === 'Oui' ? '✓ RDV prêt' : 'RDV prêt ?'}
              </button>
              <button onClick={handleToggleRdvEffectue}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition border ${
                  (planning as any).rdv_effectue === 'Effectué'
                    ? 'bg-sky-500 text-white border-sky-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {(planning as any).rdv_effectue === 'Effectué'
                  ? `✓ ${(planning as any).type_planning === 'Séance' ? 'Séance effectuée' : 'Rendez-vous effectué'}`
                  : `${(planning as any).type_planning === 'Séance' ? 'Séance effectuée ?' : 'Rendez-vous effectué ?'}`}
              </button>
            </div>
          </div>

          <button onClick={handleAddToCalendar}
            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition">
            <GlobeAltIcon className="w-4 h-4 text-blue-500" />
            Ajouter à Google Agenda
          </button>
        </>
      )}

      {/* ─── AVANT SÉANCE ─── */}
      {!isSC && <SectionSep label="Avant séance" />}

      {/* Questionnaire de forme */}
      {!isSC && (() => {
        const questionnaireRempli = !!(
          (planning as any).questionnaire_rempli ||
          (planning as any).indice_hooper != null
        )
        return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Questionnaire de forme</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {questionnaireRempli ? (
                <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  ✓ Rempli
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  <ClockIcon className="w-3 h-3" />
                  Non rempli
                </span>
              )}
              {indiceHooper != null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  indiceHooper <= 12 ? 'bg-green-100 text-green-700' :
                  indiceHooper <= 18 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  Hooper {indiceHooper}
                </span>
              )}
              {moyenneHooper != null && (
                <span className="text-xs text-gray-400">moy. {moyenneHooper}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {questionnaireRempli && (
              <button onClick={() => setShowQuestionnaireModal(true)}
                className="text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">
                Voir
              </button>
            )}
            {isAdmin ? (
              <>
                <button onClick={openQuestionnaireDirect}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition">
                  {questionnaireRempli ? 'Modifier' : 'Remplir'}
                </button>
                {questionnaireRempli && (
                  <button onClick={() => setShowResetQuestionnaireConfirm(true)}
                    className="text-xs text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
                    Réinitialiser
                  </button>
                )}
                <button onClick={handleSendSMS}
                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition">
                  Rappel rdv
                </button>
              </>
            ) : (
              isSessionPastForLock
                ? null
                : (
                  <button onClick={openQuestionnaireDirect}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition">
                    {questionnaireRempli ? 'Modifier' : 'Remplir'}
                  </button>
                )
            )}
          </div>
        </div>
        {(planning as any).infos_complementaire_avant_seance_client && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1">Informations complémentaires</p>
            <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{(planning as any).infos_complementaire_avant_seance_client}</p>
          </div>
        )}
        {Array.isArray((planning as any).douleurs) && (planning as any).douleurs.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1.5">Douleurs signalées</p>
            <div className="flex flex-wrap gap-1.5">
              {((planning as any).douleurs as PainPoint[]).map((d, i) => (
                <span key={i} className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border ${
                  d.intensite >= 7 ? 'bg-red-50 border-red-200 text-red-700' :
                  d.intensite >= 4 ? 'bg-orange-50 border-orange-200 text-orange-700' :
                  'bg-yellow-50 border-yellow-200 text-yellow-700'
                }`}>
                  {zoneDouleurLabel(d.zone)}{d.type ? ` · ${d.type}` : ''}
                  <span className="font-bold">{d.intensite}/10</span>
                </span>
              ))}
            </div>
          </div>
        )}
          {/* Admin : autoriser la modification du questionnaire par le client */}
          {isAdmin && questionnaireRempli && (
            <div className="mt-3 pt-3 border-t border-dashed border-gray-100">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs text-gray-500 flex-1">Autoriser la modification jusqu'au</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={questionnaireEditUntil}
                    min={new Date().toISOString().split('T')[0]}
                    max={(() => {
                      const sd = (planning as any)?.date_planning?.toDate?.()
                      if (!sd) return undefined
                      return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`
                    })()}
                    onChange={e => handleQuestionnaireEditUntil(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400 transition"
                  />
                  {questionnaireEditUntil && (
                    <button
                      onClick={() => handleQuestionnaireEditUntil('')}
                      className="text-xs text-gray-400 hover:text-red-500 transition"
                      title="Retirer la permission"
                    >
                      Retirer
                    </button>
                  )}
                </div>
              </div>
              {questionnaireEditUntil && (
                <p className="text-xs text-blue-600 mt-1">
                  Éditable jusqu'au {new Date(questionnaireEditUntil).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          )}
      </div>
        )
      })()}

      {/* ─── COMPTE RENDU & BILANS (admin) ─── */}
      {isAdmin && (
        <>
          <SectionSep label="Compte rendu & bilans" />

          {/* CR de RDV + Commentaires */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">

            {/* Compte rendu */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Compte rendu</p>
                  {(planning as any).observations_rdv
                    ? <p className="text-xs text-green-600">✓ Renseigné</p>
                    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">✗ Non renseigné</span>
                  }
                </div>
                <button onClick={() => { setCrValue((planning as any)?.observations_rdv || ''); setShowCrModal(true) }}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">
                  {(planning as any).observations_rdv ? 'Modifier' : 'Rédiger'}
                </button>
              </div>
              {(planning as any).observations_rdv && (
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 mt-2 whitespace-pre-wrap">{(planning as any).observations_rdv}</p>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200" />

            {/* Commentaire coach — visible uniquement par l'admin */}
            {isAdmin && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Commentaire coach</p>
                    {(planning as any).cr_rdv_moi
                      ? <p className="text-xs text-green-600">✓ Renseigné</p>
                      : <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">✗ Non renseigné</span>
                    }
                  </div>
                  <button onClick={() => { setCrCoachValue((planning as any)?.cr_rdv_moi || ''); setShowCrCoachModal(true) }}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">
                    {(planning as any).cr_rdv_moi ? 'Modifier' : 'Rédiger'}
                  </button>
                </div>
                {(planning as any).cr_rdv_moi && (
                  <p className="text-sm text-gray-800 bg-blue-50 rounded-lg p-3 mt-2 whitespace-pre-wrap">{(planning as any).cr_rdv_moi}</p>
                )}
              </div>
            )}

            <div className="border-t border-dashed border-gray-200" />

            {/* Commentaire client */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Commentaire client</p>
                  {(planning as any).cr_rdv_client
                    ? <p className="text-xs text-green-600">✓ Renseigné</p>
                    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">✗ Non renseigné</span>
                  }
                </div>
                <button onClick={() => { setCrClientValue((planning as any)?.cr_rdv_client || ''); setShowCrClientModal(true) }}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">
                  {(planning as any).cr_rdv_client ? 'Modifier' : 'Rédiger'}
                </button>
              </div>
              {(planning as any).cr_rdv_client && (
                <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 mt-2 whitespace-pre-wrap">{(planning as any).cr_rdv_client}</p>
              )}
            </div>

          </div>

          {/* Planification & Bilan séance */}
          {!isSC && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Planification</p>
                {(planning as any).intensite_seance_planifiee
                  ? <p className="text-sm font-medium text-blue-600">RPE planifié : {(planning as any).intensite_seance_planifiee}/10</p>
                  : <p className="text-xs text-gray-400">Non planifiée</p>
                }
              </div>
              <button onClick={() => { setIntensitePlanifiee((planning as any)?.intensite_seance_planifiee || 1); setPlanifMateriel(Array.isArray((planning as any)?.materiel) ? [...(planning as any).materiel] : []); setPlanifMarkRdvPret(false); setPlanifFromRdvPret(false); setShowPlanifModal(true) }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition">
                {(planning as any).intensite_seance_planifiee ? 'Modifier' : 'Planifier'}
              </button>
            </div>
            {(planning as any).intensite_seance_planifiee && (planning as any).intensite_seance > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-4 bg-gray-50 rounded-xl px-4 py-3">
                  <div className="text-center">
                    <p className="text-xs text-gray-400 mb-0.5">RPE planifié</p>
                    <p className={`text-xl font-bold ${rpeColor((planning as any).intensite_seance_planifiee)}`}>
                      {(planning as any).intensite_seance_planifiee}<span className="text-sm font-medium text-gray-400">/10</span>
                    </p>
                    {chargePlanifiee != null && (
                      <p className="text-xs font-semibold text-blue-600 mt-0.5">{chargePlanifiee} UA</p>
                    )}
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 mb-0.5">RPE ressenti</p>
                    <p className={`text-xl font-bold ${rpeColor((planning as any).intensite_seance)}`}>
                      {(planning as any).intensite_seance}<span className="text-sm font-medium text-gray-400">/10</span>
                    </p>
                    {chargeRessenti != null && (
                      <p className="text-xs font-semibold text-green-600 mt-0.5">{chargeRessenti} UA</p>
                    )}
                  </div>
                </div>
                {chargePlanifiee != null && chargeRessenti != null && (() => {
                  const delta = chargeRessenti - chargePlanifiee
                  return (
                    <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
                      <span>Δ charge</span>
                      <span className={`font-semibold ${Math.abs(delta) > 50 ? 'text-red-500' : delta === 0 ? 'text-gray-500' : 'text-gray-700'}`}>
                        {delta > 0 ? '+' : ''}{delta} UA
                      </span>
                    </div>
                  )
                })()}
              </div>
            )}
            <div className="border-t border-dashed border-gray-200" />
            <div>
              <div className="flex items-center justify-between mb-3 gap-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bilan client</p>
                <button onClick={openBilanClient}
                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition">
                  {(planning as any).motivation_pdt_seance ? 'Modifier' : 'Remplir'}
                </button>
              </div>
              <div className="space-y-2">
                {(planning as any).motivation_pdt_seance ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Motivation pendant séance</span>
                    <span className={`text-xs font-bold ${scale5Color((planning as any).motivation_pdt_seance)}`}>
                      {(planning as any).motivation_pdt_seance}/5 — {MOTIV_LABELS[((planning as any).motivation_pdt_seance) - 1]}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Motivation pendant séance</span>
                    <span className="text-xs text-gray-300">—</span>
                  </div>
                )}
                {(planning as any).intensite_mise_pdt_seance ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Intensité mise</span>
                    <span className={`text-xs font-bold ${scale5Color((planning as any).intensite_mise_pdt_seance)}`}>
                      {(planning as any).intensite_mise_pdt_seance}/5 — {INTENSITE_MISE_LABELS[((planning as any).intensite_mise_pdt_seance) - 1]}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Intensité mise</span>
                    <span className="text-xs text-gray-300">—</span>
                  </div>
                )}
                {(planning as any).intensite_seance != null && (planning as any).intensite_seance > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">RPE client</span>
                    <span className={`text-xs font-bold ${rpeColor((planning as any).intensite_seance)}`}>
                      {(planning as any).intensite_seance}/10 — {RPE_LABELS[((planning as any).intensite_seance) - 1]?.split(' — ').slice(1).join(' — ')}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">RPE client</span>
                    <span className="text-xs text-gray-300">—</span>
                  </div>
                )}
              </div>
            </div>
          </div>}
        </>
      )}

      {/* Mon bilan de séance (client non-admin) */}
      {!isAdmin && !isSC && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Mon bilan de séance</p>
              {(planning as any).motivation_pdt_seance
                ? <p className="text-xs text-green-600 mt-0.5">✓ Rempli</p>
                : <p className="text-xs text-gray-400 mt-0.5">Non renseigné</p>
              }
            </div>
            {/* Même verrou que le questionnaire d'avant-séance : une fois le RDV
                terminé, le ressenti se fige. Retouché plus tard, il ne décrit
                plus la séance et fausse le suivi. */}
            {isSessionPastForLock ? (
              <span className="text-xs text-gray-400">Séance passée</span>
            ) : (
              <button onClick={openBilanClient}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition">
                {(planning as any).motivation_pdt_seance ? 'Modifier' : 'Remplir'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── COMMENTAIRES (client non-admin) ─── */}
      {!isAdmin && !isSC && (
        <div className="space-y-3">
          {/* Commentaire du coach — lecture seule, respecte le droit compteRendu */}
          {(droits as any)?.compteRendu !== false && (planning as any).cr_rdv_moi && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Commentaire de votre coach
              </p>
              <p className="text-sm text-gray-800 bg-blue-50 rounded-lg p-3 whitespace-pre-wrap">
                {(planning as any).cr_rdv_moi}
              </p>
            </div>
          )}
          {/* Mon commentaire — visible et éditable */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Mon commentaire</p>
                {(planning as any).cr_rdv_client
                  ? <p className="text-xs text-green-600">✓ Renseigné</p>
                  : <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-400 text-xs font-medium px-2 py-0.5 rounded-full">Non renseigné</span>
                }
              </div>
              <button
                onClick={() => { setCrClientValue((planning as any)?.cr_rdv_client || ''); setShowCrClientModal(true) }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition shrink-0"
              >
                {(planning as any).cr_rdv_client ? 'Modifier' : 'Ajouter'}
              </button>
            </div>
            {(planning as any).cr_rdv_client && (
              <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 mt-2 whitespace-pre-wrap">
                {(planning as any).cr_rdv_client}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Notes client */}
      {isAdmin && clientId && (
        <section>
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
              Notes client
              {notesActives.length > 0 && (
                <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full">{notesActives.length} active(s)</span>
              )}
            </h2>
            <button
              onClick={() => {
                const j7 = new Date(); j7.setDate(j7.getDate() + 7)
                setEditNoteItem(null)
                setAddNoteForm({ type_note: 'Observation', notes: '', date_max_note_active: `${j7.getFullYear()}-${String(j7.getMonth()+1).padStart(2,'0')}-${String(j7.getDate()).padStart(2,'0')}` })
                setShowNoteModal(true)
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition">
              <PlusIcon className="w-3.5 h-3.5" />
              Ajouter
            </button>
          </div>
          <div className="space-y-2">
            {notesActives.length === 0 && notesExpirees.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
                <p className="text-gray-400 text-sm">Aucune note pour ce client</p>
              </div>
            )}
            {notesActives.map((note) => {
              const s = getNoteTypeStyle(note.type_note)
              return (
                <div key={note.id} className={`rounded-xl border p-3 ${s.card}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.badge}`}>{note.type_note}</span>
                      <span className={`text-xs font-medium ${s.dot}`}>● Active</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => {
                        const dateMax = note.date_max_note_active?.toDate?.()
                        setEditNoteItem(note)
                        setAddNoteForm({ type_note: note.type_note || 'Observation', notes: note.notes || '', date_max_note_active: dateMax ? `${dateMax.getFullYear()}-${String(dateMax.getMonth()+1).padStart(2,'0')}-${String(dateMax.getDate()).padStart(2,'0')}` : '' })
                        setShowNoteModal(true)
                      }} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-white/60 transition">
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteNoteConfirm(note.id)} className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-800 mt-1.5">{note.notes}</p>
                  {note.date_max_note_active && (
                    <p className={`text-xs mt-1.5 ${s.meta}`}>
                      Active jusqu'au {(note.date_max_note_active as any).toDate().toLocaleDateString('fr-FR')}
                    </p>
                  )}
                </div>
              )
            })}
            {notesExpirees.length > 0 && (
              <>
                <button
                  onClick={() => setShowExpiredNotes((v) => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition flex items-center gap-1 py-1">
                  <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform ${showExpiredNotes ? 'rotate-90' : ''}`} />
                  {showExpiredNotes ? 'Masquer' : 'Voir'} les notes expirées ({notesExpirees.length})
                </button>
                {showExpiredNotes && notesExpirees.map((note) => (
                  <div key={note.id} className="rounded-xl border bg-white border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{note.type_note}</span>
                        <span className="text-xs text-gray-400">Expirée</span>
                        {note.date_max_note_active && (
                          <span className="text-xs text-gray-400">
                            · {(note.date_max_note_active as any).toDate().toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => {
                          const dateMax = note.date_max_note_active?.toDate?.()
                          setEditNoteItem(note)
                          setAddNoteForm({ type_note: note.type_note || 'Observation', notes: note.notes || '', date_max_note_active: dateMax ? `${dateMax.getFullYear()}-${String(dateMax.getMonth()+1).padStart(2,'0')}-${String(dateMax.getDate()).padStart(2,'0')}` : '' })
                          setShowNoteModal(true)
                        }} className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition">
                          <PencilIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteNoteConfirm(note.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-1.5">{note.notes}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      )}

      {/* Séances associées */}
      {!isSC && <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-gray-700 shrink-0">Séances ({seances.length})</h2>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => router.push(`/seances/apercu/${id}`)}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
              Lancer la séance
            </button>
            {isAdmin && (
              <button onClick={() => {
                const nextNum = seances.length > 0 ? Math.max(...seances.map(s => (s as any).num_circuit || 0)) + 1 : 1
                setSeanceForm(f => ({ ...f, num_circuit: nextNum }))
                setShowSeanceModal(true)
              }}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                <PlusIcon className="w-3.5 h-3.5" />
                Créer
              </button>
            )}
          </div>
        </div>
        {seances.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <ClipboardDocumentListIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Aucune séance liée à ce RDV</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...seances].sort((a, b) => ((a as any).num_circuit || 0) - ((b as any).num_circuit || 0)).map((seance, idx, arr) => {
              const isDone = ((seance as any).avancement_circuit ?? 0) >= 1
              return (
              <div key={seance.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between gap-2">
                  {isAdmin && (
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => handleMoveSeance(seance.id, 'up')} disabled={idx === 0}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-20 transition">
                        <ChevronUpIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleMoveSeance(seance.id, 'down')} disabled={idx === arr.length - 1}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-20 transition">
                        <ChevronDownIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/seances/${seance.id}?planningId=${id}`)}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">
                        <span className="text-gray-400 font-normal mr-1">n°{(seance as any).num_circuit ?? idx + 1}</span>
                        {seance.type_seance}
                      </p>
                      {isDone && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">✓ Terminé</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {seance.partie_seance} · {seance.nb_tours} tour(s)
                      {(seance as any).tps_effort_exo_default ? ` · ${(seance as any).tps_effort_exo_default}${(seance as any).type_effort_exo_default === 'Répétitions' ? ' rép' : 's'}` : ''}
                      {seance.recup_tours != null ? ` · récup tours ${seance.recup_tours}s` : ''}
                      {(seance as any).tps_recup_exo_default != null && (seance as any).tps_recup_exo_default !== seance.recup_tours ? ` · récup exo ${(seance as any).tps_recup_exo_default}s` : ''}
                    </p>
                    {(seance as any).intensite_circuit_planifie > 0 && (
                      <p className="text-xs text-blue-600 font-medium mt-0.5">RPE cible : {(seance as any).intensite_circuit_planifie}/10</p>
                    )}
                    {(seance as any).observations_seance && (
                      <p className="text-xs text-gray-400 italic mt-0.5 truncate">{(seance as any).observations_seance}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => openEditSeance(seance)}
                          className="p-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition"
                          title="Modifier"
                        >
                          <PencilIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteSeanceConfirm(seance.id)}
                          className="p-1.5 rounded-lg border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition"
                          title="Supprimer"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <ChevronRightIcon
                      className="w-4 h-4 text-gray-400 cursor-pointer"
                      onClick={() => router.push(`/seances/${seance.id}?planningId=${id}`)}
                    />
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </section>}

      {/* Dernier compte rendu */}
      {lastWithCr && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Dernier compte rendu</h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  {lastWithCr.date_planning?.toDate().toLocaleDateString('fr-FR', {
                    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                  })}
                </p>
                <p className="text-xs text-gray-500">
                  {formatHeure(lastWithCr.heure_planning_debut)} → {formatHeure(lastWithCr.heure_planning_fin)}
                  {lastWithCr.type_planning ? ` · ${lastWithCr.type_planning}` : ''}
                </p>
              </div>
              <button
                onClick={() => router.push(`/planning/${lastWithCr.id}`)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition cursor-pointer flex-shrink-0"
              >
                <ChevronRightIcon className="w-3.5 h-3.5" />
                Voir ce RDV
              </button>
            </div>
            {isAdmin && lastWithCr.observations_rdv && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Compte rendu</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                  {lastWithCr.observations_rdv}
                </p>
              </div>
            )}
            {lastWithCr.cr_rdv_moi && (
              <div className={lastWithCr.observations_rdv ? 'mt-2' : ''}>
                <p className="text-xs text-gray-500 mb-1">Coach</p>
                <p className="text-sm text-gray-700 bg-blue-50 rounded-lg p-3 whitespace-pre-wrap">
                  {lastWithCr.cr_rdv_moi}
                </p>
              </div>
            )}
            {lastWithCr.cr_rdv_client && (
              <div className={(lastWithCr.observations_rdv || lastWithCr.cr_rdv_moi) ? 'mt-2' : ''}>
                <p className="text-xs text-gray-500 mb-1">Client</p>
                <p className="text-sm text-gray-700 bg-green-50 rounded-lg p-3 whitespace-pre-wrap">
                  {lastWithCr.cr_rdv_client}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Activités depuis le dernier RDV */}
      {activitesSinceLastRdv.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            Activités depuis le dernier RDV
            <span className="ml-2 text-xs font-normal text-gray-400">({activitesSinceLastRdv.length})</span>
          </h2>
          <div className="space-y-2">
            {activitesSinceLastRdv.map((act) => (
              <div key={act.id} className="bg-green-50 rounded-xl border border-green-200 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-green-800">{act.type_activite}</span>
                    {act.heure_debut && (
                      <span className="text-xs text-green-600">{act.heure_debut}{act.heure_fin ? ` → ${act.heure_fin}` : ''}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {act.date_activite?.toDate?.()?.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {act.distance_km ? ` · 📍 ${act.distance_km} km` : ''}
                    {(act as any).calories ? ` · 🔥 ${(act as any).calories} kcal` : ''}
                  </p>
                  {act.notes && <p className="text-xs text-gray-400 italic mt-0.5">{act.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Historique RDV */}
      {(prochainsRdvClient.length > 0 || derniersRdv.length > 0) && (
        <section className="space-y-4">
          {isAdmin && prochainsRdvClient.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                Prochains RDV — {client?.prenom}
              </h2>
              <div className="space-y-2">
                {prochainsRdvClient.map((rdv) => (
                  <div key={rdv.id} onClick={() => router.push(`/planning/${rdv.id}`)}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {rdv.date_planning?.toDate().toLocaleDateString('fr-FR', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatHeure(rdv.heure_planning_debut)} → {formatHeure(rdv.heure_planning_fin)}
                        {rdv.type_planning ? ` · ${rdv.type_planning}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge label={getEtatBadgeLocal(rdv.etat_planning_rdv).label} variant={getEtatBadgeLocal(rdv.etat_planning_rdv).variant} />
                      <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {derniersRdv.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                Historique — {client?.prenom}
              </h2>
              <div className="space-y-2">
                {derniersRdv.map((rdv) => (
                  <div key={rdv.id} onClick={() => router.push(`/planning/${rdv.id}`)}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {rdv.date_planning?.toDate().toLocaleDateString('fr-FR', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatHeure(rdv.heure_planning_debut)} → {formatHeure(rdv.heure_planning_fin)}
                        {rdv.type_planning ? ` · ${rdv.type_planning}` : ''}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── MODALS ─── */}

      {/* Modal modification RDV */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Modifier le RDV" size="lg">
        <form onSubmit={handleEdit} className="space-y-4">
          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Rechercher un client..." value={searchClientEdit}
                onChange={(e) => setSearchClientEdit(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <select value={form.ref_client}
              onChange={(e) => setForm({ ...form, ref_client: e.target.value, abonnement_id: '' })}
              size={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Aucun client —</option>
              {filteredUsersEdit.map((u) => (
                <option key={u.id} value={u.id}>{u.prenom} {u.nom}{u.email ? ` — ${u.email}` : ''}</option>
              ))}
            </select>
          </div>

          {/* Abonnement */}
          {clientAbonnements.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Abonnement</label>
              <select value={form.abonnement_id} onChange={(e) => setForm({ ...form, abonnement_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sélectionner —</option>
                {(() => {
                  const actifs = clientAbonnements.filter((a) => a.etat === 'Actif')
                  const autres = clientAbonnements.filter((a) => a.etat !== 'Actif')
                  const opt = (a: typeof clientAbonnements[number]) => (
                    <option key={a.id} value={a.id}>
                      N°{clientAbonnements.indexOf(a) + 1} — {a.categorie}{a.typeSuivi ? ` · ${a.typeSuivi}` : ''} ({a.etat})
                    </option>
                  )
                  return <>
                    {actifs.length > 0 && <optgroup label="Actifs">{actifs.map(opt)}</optgroup>}
                    {autres.length > 0 && <optgroup label="Inactifs / Terminés">{autres.map(opt)}</optgroup>}
                  </>
                })()}
              </select>
            </div>
          )}

          {/* RDVs liés */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">RDVs liés</label>
            {form.participants_supplementaires.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {form.participants_supplementaires.map((p, i) => {
                  const linkedPl = plannings.find((pl) => pl.id === p.ref_planning_id)
                  const ru = (linkedPl as any)?.ref_users
                  const rc = (linkedPl as any)?.ref_client
                  const uid = ru?.id || ru?.path?.split('/').pop() || (typeof ru === 'string' ? ru.split('/').pop() : '') ||
                              rc?.id || rc?.path?.split('/').pop() || (typeof rc === 'string' ? rc.split('/').pop() : '') || ''
                  const pu = users.find((u) => u.id === uid)
                  const name = pu ? [pu.prenom, pu.nom].filter(Boolean).join(' ') : '—'
                  return (
                    <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{name}</p>
                        {linkedPl && (
                          <p className="text-xs text-gray-400">{formatDate((linkedPl as any).date_planning)} · {(linkedPl as any).type_planning ?? 'Séance'}</p>
                        )}
                      </div>
                      <button type="button"
                        onClick={() => setForm({ ...form, participants_supplementaires: form.participants_supplementaires.filter((_, j) => j !== i) })}
                        className="p-1 text-gray-400 hover:text-red-500 transition">
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="border border-dashed border-gray-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-medium text-gray-500">Lier un RDV existant</p>
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Rechercher par client, date, type…" value={searchNewParticipant}
                  onChange={(e) => setSearchNewParticipant(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <select value={newParticipant.ref_planning_id} size={4}
                onChange={(e) => setNewParticipant({ ref_planning_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sélectionner un RDV —</option>
                {filteredPlanningsForParticipant.map((pl) => {
                  const ru = (pl as any).ref_users
                  const rc = (pl as any).ref_client
                  const uid = ru?.id || ru?.path?.split('/').pop() || (typeof ru === 'string' ? ru.split('/').pop() : '') ||
                              rc?.id || rc?.path?.split('/').pop() || (typeof rc === 'string' ? rc.split('/').pop() : '') || ''
                  const pu = users.find((u) => u.id === uid)
                  const name = pu ? `${pu.prenom ?? ''} ${pu.nom ?? ''}`.trim() : '—'
                  const date = formatDate((pl as any).date_planning)
                  const type = (pl as any).type_planning ?? 'Séance'
                  return <option key={pl.id} value={pl.id}>{name} — {date} ({type})</option>
                })}
              </select>
              <button type="button" disabled={!newParticipant.ref_planning_id}
                onClick={() => {
                  if (!newParticipant.ref_planning_id) return
                  setForm({ ...form, participants_supplementaires: [...form.participants_supplementaires, { ref_planning_id: newParticipant.ref_planning_id }] })
                  setNewParticipant({ ref_planning_id: '' })
                  setSearchNewParticipant('')
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition">
                <PlusIcon className="w-3.5 h-3.5" />
                Lier ce RDV
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de RDV</label>
            <select value={form.type_planning} onChange={(e) => setForm({ ...form, type_planning: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_RDV.map((groupe) => (
                <optgroup key={groupe.groupe} label={groupe.groupe}>
                  {groupe.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required
              className="w-full min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
              <input type="time" value={form.heure_debut} onChange={(e) => setForm({ ...form, heure_debut: e.target.value })} required
                className="w-full min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
              <input type="time" value={form.heure_fin} onChange={(e) => setForm({ ...form, heure_fin: e.target.value })} required
                className="w-full min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {form.heure_debut && (
                <div className="flex gap-1 mt-1">
                  {([15, 30, 60] as const).map((min) => {
                    const [h, m] = form.heure_debut.split(':').map(Number)
                    const total = h * 60 + m + min
                    const fin = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
                    return (
                      <button key={min} type="button" onClick={() => setForm({ ...form, heure_fin: fin })}
                        className="flex-1 text-xs py-0.5 rounded bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-500 transition">
                        +{min < 60 ? `${min}min` : '1h'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mode de RDV</label>
            <select value={form.mode_rdv} onChange={(e) => setForm({ ...form, mode_rdv: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {['Présentiel', 'Visioconférence', 'Appel téléphonique'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
            <AdresseAutocomplete value={form.adresse_rdv} onChange={(val) => { setForm({ ...form, adresse_rdv: val }); if (val) handleCalculateDistance(val) }} />
            {form.adresse_rdv && (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => handleCalculateDistance()} disabled={calcDistance}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition font-medium">
                  {calcDistance ? 'Calcul…' : 'Calculer temps de route'}
                </button>
                {(form.distance_km != null || form.temps_route) && (
                  <span className="text-xs text-blue-600 font-medium">
                    {form.distance_km != null ? `${form.distance_km} km` : ''}
                    {form.distance_km != null && form.temps_route ? ' · ' : ''}
                    {form.temps_route}
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Matériel</label>
            <MaterielSelect value={form.materiel} onChange={(val) => setForm({ ...form, materiel: val })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">État</label>
            <select value={form.etat_planning_rdv} onChange={(e) => setForm({ ...form, etat_planning_rdv: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ETATS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowEditModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal CR de RDV */}
      <Modal isOpen={showCrModal} onClose={() => setShowCrModal(false)} title="Compte rendu de RDV" size="lg">
        {(() => {
          const linkedIds = ((planning as any)?.participants_supplementaires as any[] || [])
            .map((p: any) => typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '').filter(Boolean)
          return (
            <div className="space-y-4">
              <textarea value={crValue} onChange={(e) => setCrValue(e.target.value)}
                rows={6} placeholder="Rédigez votre compte rendu..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              {isAdmin && linkedIds.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                  <input type="checkbox" checked={crDupliquer} onChange={(e) => setCrDupliquer(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  Dupliquer sur les {linkedIds.length} RDV{linkedIds.length > 1 ? 's' : ''} lié{linkedIds.length > 1 ? 's' : ''}
                </label>
              )}
              <div className="flex gap-3">
                <button onClick={() => setShowCrModal(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
                  Annuler
                </button>
                <button onClick={async () => {
                  await updatePlanning(id, { observations_rdv: crValue } as any)
                  if (crDupliquer) await Promise.all(linkedIds.map((lpId: string) => updatePlanning(lpId, { observations_rdv: crValue } as any)))
                  setShowCrModal(false)
                }} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
                  Enregistrer
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Modal commentaire coach */}
      <Modal isOpen={showCrCoachModal} onClose={() => setShowCrCoachModal(false)} title="Commentaire coach" size="lg">
        {(() => {
          const linkedIds = ((planning as any)?.participants_supplementaires as any[] || [])
            .map((p: any) => typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '').filter(Boolean)
          return (
            <div className="space-y-4">
              <textarea value={crCoachValue} onChange={(e) => setCrCoachValue(e.target.value)}
                rows={6} placeholder="Votre commentaire..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              {linkedIds.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                  <input type="checkbox" checked={crCoachDupliquer} onChange={(e) => setCrCoachDupliquer(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  Dupliquer sur les {linkedIds.length} RDV{linkedIds.length > 1 ? 's' : ''} lié{linkedIds.length > 1 ? 's' : ''}
                </label>
              )}
              <div className="flex gap-3">
                <button onClick={() => setShowCrCoachModal(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
                  Annuler
                </button>
                <button onClick={async () => {
                  await updatePlanning(id, { cr_rdv_moi: crCoachValue } as any)
                  if (crCoachDupliquer) await Promise.all(linkedIds.map((lpId: string) => updatePlanning(lpId, { cr_rdv_moi: crCoachValue } as any)))
                  setShowCrCoachModal(false)
                }} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
                  Enregistrer
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Modal commentaire client */}
      <Modal isOpen={showCrClientModal} onClose={() => setShowCrClientModal(false)} title="Commentaire client" size="lg">
        <div className="space-y-4">
          <textarea value={crClientValue} onChange={(e) => setCrClientValue(e.target.value)}
            rows={6} placeholder="Retour du client..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex gap-3">
            <button onClick={() => setShowCrClientModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => { await updatePlanning(id, { cr_rdv_client: crClientValue } as any); setShowCrClientModal(false) }}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Enregistrer
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal planification */}
      <Modal isOpen={showPlanifModal} onClose={() => setShowPlanifModal(false)} title={planifFromRdvPret ? 'Confirmer RDV prêt' : 'Planification séance'} size="lg">
        <div className="space-y-5">
          {/* RPE planifié */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">
              RPE planifié : <span className="text-blue-600">{intensitePlanifiee}/10</span>
            </p>
            <div className="space-y-2">
              {RPE_LABELS.map((label, i) => {
                const val = i + 1
                return (
                  <button key={val} type="button" onClick={() => setIntensitePlanifiee(val)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                      intensitePlanifiee === val
                        ? 'bg-blue-600 text-white border-blue-600 font-medium'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          {/* Matériel */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Matériel</p>
            <MaterielSelect value={planifMateriel} onChange={setPlanifMateriel} />
          </div>
          {/* Option RDV prêt (si ouvert depuis Planifier) */}
          {!planifFromRdvPret && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={planifMarkRdvPret} onChange={(e) => setPlanifMarkRdvPret(e.target.checked)}
                className="w-4 h-4 accent-green-600" />
              <span className="text-sm text-gray-700">Marquer le RDV comme prêt</span>
            </label>
          )}
          <div className="flex gap-3">
            <button onClick={() => setShowPlanifModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => {
              const payload: any = { intensite_seance_planifiee: intensitePlanifiee, materiel: planifMateriel }
              if (planifFromRdvPret || planifMarkRdvPret) payload.rdv_pret = 'Oui'
              await updatePlanning(id, payload)
              setShowPlanifModal(false)
            }}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              {planifFromRdvPret ? '✓ Marquer RDV prêt' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal bilan client */}
      <Modal isOpen={showBilanClientModal} onClose={() => setShowBilanClientModal(false)} title="Bilan de fin de séance" size="lg">
        <div className="space-y-5">

          {/* Motivation pendant la séance */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Motivation</p>
            <p className="text-xs text-gray-500 mb-2">Comment évaluez-vous votre motivation pendant la séance ?</p>
            <div className="space-y-2">
              {MOTIV_LABELS.map((label, i) => {
                const val = i + 1
                return (
                  <button key={val} type="button" onClick={() => setBilanMotivationClient(val)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                      bilanMotivationClient === val
                        ? 'bg-blue-600 text-white border-blue-600 font-medium'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                    }`}
                  >
                    {val} — {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Intensité mise */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Intensité mise</p>
            <p className="text-xs text-gray-500 mb-2">Quelle intensité avez-vous mise dans la séance ?</p>
            <div className="space-y-2">
              {INTENSITE_MISE_LABELS.map((label, i) => {
                const val = i + 1
                return (
                  <button key={val} type="button" onClick={() => setBilanIntensiteMiseClient(val)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                      bilanIntensiteMiseClient === val
                        ? 'bg-blue-600 text-white border-blue-600 font-medium'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                    }`}
                  >
                    {val} — {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* RPE */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Intensité ressentie (RPE)</p>
            <p className="text-xs text-gray-500 mb-2">Comment évaluez-vous l'intensité globale de la séance ?</p>
            <div className="space-y-2">
              {RPE_LABELS.map((label, i) => {
                const val = i + 1
                return (
                  <button key={val} type="button" onClick={() => setBilanClientIntensity(val)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                      bilanClientIntensity === val
                        ? 'bg-blue-600 text-white border-blue-600 font-medium'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowBilanClientModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => {
              if (!isAdmin && isSessionPastForLock) { setShowBilanClientModal(false); return }
              await updatePlanning(id, {
                motivation_pdt_seance: bilanMotivationClient,
                intensite_mise_pdt_seance: bilanIntensiteMiseClient,
                intensite_seance: bilanClientIntensity,
              } as any)
              setShowBilanClientModal(false)
            }}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Enregistrer
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal note (ajout / modification) */}
      <Modal isOpen={showNoteModal} onClose={() => setShowNoteModal(false)} title={editNoteItem ? 'Modifier la note' : 'Nouvelle note client'}>
        <form onSubmit={async (e) => {
          e.preventDefault()
          if (!clientId) return
          const payload: any = {
            ref_users: doc(db, 'users', clientId),
            notes: addNoteForm.notes,
            type_note: addNoteForm.type_note,
            date_max_note_active: addNoteForm.date_max_note_active
              ? Timestamp.fromDate(new Date(addNoteForm.date_max_note_active))
              : null,
          }
          if (editNoteItem) {
            await updateNote(editNoteItem.id, payload)
          } else {
            await addNote({ ...payload, date_create: Timestamp.now() })
          }
          setShowNoteModal(false)
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={addNoteForm.type_note} onChange={(e) => setAddNoteForm({ ...addNoteForm, type_note: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[...NOTE_TYPES_BASE, ...customNoteTypes.filter((t) => !NOTE_TYPES_BASE.includes(t))]
                .concat(addNoteForm.type_note && !NOTE_TYPES_BASE.includes(addNoteForm.type_note) && !customNoteTypes.includes(addNoteForm.type_note) ? [addNoteForm.type_note] : [])
                .map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newNoteType}
                onChange={(e) => setNewNoteType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const t = newNoteType.trim()
                  if (!t) return
                  const updated = customNoteTypes.includes(t) ? customNoteTypes : [...customNoteTypes, t]
                  setCustomNoteTypes(updated)
                  try { localStorage.setItem(NOTE_TYPES_KEY, JSON.stringify(updated)) } catch {}
                  setAddNoteForm({ ...addNoteForm, type_note: t })
                  setNewNoteType('')
                }}
                placeholder="Nouveau type..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="button" onClick={() => {
                const t = newNoteType.trim()
                if (!t) return
                const updated = customNoteTypes.includes(t) ? customNoteTypes : [...customNoteTypes, t]
                setCustomNoteTypes(updated)
                try { localStorage.setItem(NOTE_TYPES_KEY, JSON.stringify(updated)) } catch {}
                setAddNoteForm({ ...addNoteForm, type_note: t })
                setNewNoteType('')
              }} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea value={addNoteForm.notes} onChange={(e) => setAddNoteForm({ ...addNoteForm, notes: e.target.value })}
              required rows={4} placeholder="Contenu de la note..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date d'expiration (optionnel)</label>
            <input type="date" value={addNoteForm.date_max_note_active}
              onChange={(e) => setAddNoteForm({ ...addNoteForm, date_max_note_active: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowNoteModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              {editNoteItem ? 'Enregistrer' : 'Créer la note'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal suppression note */}
      <Modal isOpen={!!deleteNoteConfirm} onClose={() => setDeleteNoteConfirm(null)} title="Supprimer cette note ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteNoteConfirm(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={() => deleteNoteConfirm && deleteNote(deleteNoteConfirm).then(() => setDeleteNoteConfirm(null))}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">
            Supprimer
          </button>
        </div>
      </Modal>

      {/* Modal voir questionnaire */}
      <Modal isOpen={showQuestionnaireModal} onClose={() => setShowQuestionnaireModal(false)} title="Questionnaire de forme" size="lg">
        <div className="space-y-3">
          {QUESTIONS_FORME.map((item) => {
            const val = (planning as any)[item.key]
            const hooperKeys = ['qualite_sommeil', 'niveau_fatigue', 'niveau_courbatures', 'quantite_stress']
            const isHooper = hooperKeys.includes(item.key)
            const colorGood = isHooper ? val <= 2 : val >= 4
            const colorBad = isHooper ? val >= 5 : val <= 2
            const color = colorGood ? 'text-green-600' : colorBad ? 'text-red-500' : 'text-orange-500'
            return (
              <div key={item.key} className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-600">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${color}`}>{val || '—'}</span>
                  {val && <span className="text-xs text-gray-400">{item.labels[val - 1]?.replace(/^\d+ — /, '')}</span>}
                </div>
              </div>
            )
          })}
          {indiceHooper != null && (
            <div className="pt-2 flex items-center justify-between border-t border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Indice Hooper</span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                indiceHooper <= 12 ? 'bg-green-100 text-green-700' :
                indiceHooper <= 18 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>{indiceHooper}/28</span>
            </div>
          )}
          {Array.isArray((planning as any).douleurs) && (planning as any).douleurs.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-2">Douleurs signalées</p>
              <div className="space-y-1.5">
                {((planning as any).douleurs as PainPoint[]).map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-gray-800">
                      {zoneDouleurLabel(d.zone)}
                      {d.type ? <span className="text-xs font-normal text-gray-500"> · {d.type}</span> : null}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      d.intensite >= 7 ? 'bg-red-200 text-red-800' :
                      d.intensite >= 4 ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {d.intensite}/10
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(planning as any).infos_complementaire_avant_seance_client && (
            <div className="pt-2">
              <p className="text-sm text-gray-500 mb-1">Commentaire</p>
              <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{(planning as any).infos_complementaire_avant_seance_client}</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal remplir questionnaire */}
      <Modal isOpen={showQuestionnaireDirectModal} onClose={() => setShowQuestionnaireDirectModal(false)} title="Questionnaire de forme" size="lg">
        <form onSubmit={handleSubmitQuestionnaire} className="space-y-5">
          {QUESTIONS_FORME.map((q) => (
            <div key={q.key}>
              <p className="text-sm font-semibold text-gray-700 mb-1">{q.label}</p>
              <p className="text-xs text-gray-500 mb-2">{q.question}</p>
              <div className="flex flex-wrap gap-2">
                {q.labels.map((label, i) => {
                  const val = i + 1
                  const isSelected = (questionnaireForm as any)[q.key] === val
                  return (
                    <button key={val} type="button"
                      onClick={() => setQuestionnaireForm((prev) => ({ ...prev, [q.key]: val }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                        isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Douleurs</label>
            <p className="text-xs text-gray-500 mb-2">Touchez les zones concernées puis ajustez l'intensité.</p>
            <PainZoneSelector
              value={questionnaireForm.douleurs}
              onChange={(v) => setQuestionnaireForm((prev) => ({ ...prev, douleurs: v }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
            <textarea
              value={questionnaireForm.infos_complementaire_avant_seance_client}
              onChange={(e) => { const v = e.target.value; setQuestionnaireForm((prev) => ({ ...prev, infos_complementaire_avant_seance_client: v })) }}
              rows={3} placeholder="Maladie, douleurs ciblées..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowQuestionnaireDirectModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal création circuit */}
      <Modal isOpen={showSeanceModal} onClose={() => setShowSeanceModal(false)} title="Ajouter un circuit">
        <form onSubmit={handleAddSeance} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Numéro du circuit</label>
            <input type="number" min={1} value={seanceForm.num_circuit}
              onChange={(e) => setSeanceForm({ ...seanceForm, num_circuit: Number(e.target.value) })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie de séance</label>
            <select value={seanceForm.partie_seance}
              onChange={(e) => setSeanceForm({ ...seanceForm, partie_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PARTIES_SEANCE.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de circuit</label>
            <select
              value={seanceForm.type_seance}
              onChange={(e) => {
                const defaults = getSeanceCircuitDefaults(e.target.value)
                setSeanceForm({ ...seanceForm, type_seance: e.target.value, ...defaults })
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_SEANCE_CIRCUIT.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb tours</label>
              <input type="number" min={1} value={seanceForm.nb_tours}
                onChange={(e) => setSeanceForm({ ...seanceForm, nb_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup entre tours (s)</label>
              <input type="number" min={0} value={seanceForm.recup_tours}
                onChange={(e) => setSeanceForm({ ...seanceForm, recup_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort par défaut</label>
            <select value={seanceForm.type_effort_exo_default}
              onChange={(e) => setSeanceForm({ ...seanceForm, type_effort_exo_default: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_EFFORT_SEANCE.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort par défaut {seanceForm.type_effort_exo_default === 'Durée (sec)' ? '(sec)' : '(rép)'}
              </label>
              <input type="number" min={0} value={seanceForm.tps_effort_exo_default}
                onChange={(e) => setSeanceForm({ ...seanceForm, tps_effort_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup par défaut (s)</label>
              <input type="number" min={0} value={seanceForm.tps_recup_exo_default}
                onChange={(e) => setSeanceForm({ ...seanceForm, tps_recup_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RPE cible{seanceForm.intensite_circuit_planifie > 0 && <span className="ml-1.5 text-blue-600 font-bold">{seanceForm.intensite_circuit_planifie}/10</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[0,1,2,3,4,5,6,7,8,9,10].map((v) => (
                <button key={v} type="button"
                  onClick={() => setSeanceForm({ ...seanceForm, intensite_circuit_planifie: v })}
                  className={`w-8 h-8 rounded-lg text-xs font-bold border transition ${
                    seanceForm.intensite_circuit_planifie === v
                      ? v === 0 ? 'bg-gray-400 text-white border-gray-400'
                        : v >= 8 ? 'bg-red-500 text-white border-red-500'
                        : v >= 4 ? 'bg-orange-400 text-white border-orange-400'
                        : 'bg-green-500 text-white border-green-500'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {v === 0 ? '—' : v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea value={seanceForm.observations_seance}
              onChange={(e) => setSeanceForm({ ...seanceForm, observations_seance: e.target.value })}
              rows={3} placeholder="Notes sur ce circuit..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowSeanceModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Créer
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal modifier circuit */}
      <Modal isOpen={showEditSeanceModal} onClose={() => setShowEditSeanceModal(false)} title="Modifier le circuit">
        <form onSubmit={handleEditSeance} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Numéro du circuit</label>
            <input type="number" min={1} value={editSeanceForm.num_circuit}
              onChange={(e) => setEditSeanceForm({ ...editSeanceForm, num_circuit: Number(e.target.value) })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie de séance</label>
            <select value={editSeanceForm.partie_seance}
              onChange={(e) => setEditSeanceForm({ ...editSeanceForm, partie_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PARTIES_SEANCE.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de circuit</label>
            <select value={editSeanceForm.type_seance}
              onChange={(e) => {
                const defaults = getSeanceCircuitDefaults(e.target.value)
                setEditSeanceForm({ ...editSeanceForm, type_seance: e.target.value, ...defaults })
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_SEANCE_CIRCUIT.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb tours</label>
              <input type="number" min={1} value={editSeanceForm.nb_tours}
                onChange={(e) => setEditSeanceForm({ ...editSeanceForm, nb_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup entre tours (s)</label>
              <input type="number" min={0} value={editSeanceForm.recup_tours}
                onChange={(e) => setEditSeanceForm({ ...editSeanceForm, recup_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort par défaut</label>
            <select value={editSeanceForm.type_effort_exo_default}
              onChange={(e) => setEditSeanceForm({ ...editSeanceForm, type_effort_exo_default: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_EFFORT_SEANCE.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort par défaut {editSeanceForm.type_effort_exo_default === 'Durée (sec)' ? '(sec)' : '(rép)'}
              </label>
              <input type="number" min={0} value={editSeanceForm.tps_effort_exo_default}
                onChange={(e) => setEditSeanceForm({ ...editSeanceForm, tps_effort_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup par défaut (s)</label>
              <input type="number" min={0} value={editSeanceForm.tps_recup_exo_default}
                onChange={(e) => setEditSeanceForm({ ...editSeanceForm, tps_recup_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RPE cible{editSeanceForm.intensite_circuit_planifie > 0 && <span className="ml-1.5 text-blue-600 font-bold">{editSeanceForm.intensite_circuit_planifie}/10</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[0,1,2,3,4,5,6,7,8,9,10].map((v) => (
                <button key={v} type="button"
                  onClick={() => setEditSeanceForm({ ...editSeanceForm, intensite_circuit_planifie: v })}
                  className={`w-8 h-8 rounded-lg text-xs font-bold border transition ${
                    editSeanceForm.intensite_circuit_planifie === v
                      ? v === 0 ? 'bg-gray-400 text-white border-gray-400'
                        : v >= 8 ? 'bg-red-500 text-white border-red-500'
                        : v >= 4 ? 'bg-orange-400 text-white border-orange-400'
                        : 'bg-green-500 text-white border-green-500'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {v === 0 ? '—' : v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea value={editSeanceForm.observations_seance}
              onChange={(e) => setEditSeanceForm({ ...editSeanceForm, observations_seance: e.target.value })}
              rows={3} placeholder="Notes sur ce circuit..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowEditSeanceModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirmation suppression circuit */}
      <Modal isOpen={!!deleteSeanceConfirm} onClose={() => setDeleteSeanceConfirm(null)} title="Supprimer ce circuit ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Cette action est irréversible. Les exercices du circuit seront également supprimés.</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteSeanceConfirm(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={() => deleteSeanceConfirm && handleDeleteSeance(deleteSeanceConfirm)}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">
            Supprimer
          </button>
        </div>
      </Modal>

      {/* Confirmation réinitialisation questionnaire */}
      <Modal isOpen={showResetQuestionnaireConfirm} onClose={() => setShowResetQuestionnaireConfirm(false)} title="Réinitialiser le questionnaire ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          Les réponses du client (sommeil, fatigue, douleurs, commentaire, indice Hooper…) seront effacées pour ce RDV.
          Utile après un décalage de date : le client pourra le remplir à nouveau lors du prochain rappel. Cette action est irréversible.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setShowResetQuestionnaireConfirm(false)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={handleResetQuestionnaire} disabled={resettingQuestionnaire}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition disabled:opacity-50">
            {resettingQuestionnaire ? 'Réinitialisation…' : 'Réinitialiser'}
          </button>
        </div>
      </Modal>

      {/* Confirmation changement d'état */}
      <Modal isOpen={!!pendingEtat} onClose={() => setPendingEtat(null)} title="Changer l'état ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          Passer ce RDV en <strong className="text-gray-800">{pendingEtat}</strong> ?
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPendingEtat(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={() => pendingEtat && handleEtatChange(pendingEtat)}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            Confirmer
          </button>
        </div>
      </Modal>

      {/* Confirmation suppression */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Supprimer ce RDV ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button onClick={() => setShowDeleteConfirm(false)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={handleDelete}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">
            Supprimer
          </button>
        </div>
      </Modal>

    </div>
  )
}
