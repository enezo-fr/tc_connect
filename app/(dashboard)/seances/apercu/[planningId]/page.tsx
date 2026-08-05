'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  collection, doc, getDoc, getDocs, query, where, updateDoc, addDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import { useExercices } from '@/hooks/useExercices'
import { saveExerciceMemory } from '@/lib/exerciceMemory'
import { normalizePartieCorps } from '@/lib/exerciceOptions'
import Modal from '@/components/ui/Modal'
import QuestionnaireFormeModal, { reponsesDepuisPlanning } from '@/components/ui/QuestionnaireFormeModal'
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon, PlayIcon, CheckIcon } from '@heroicons/react/24/outline'

const TYPES_SEANCE_APERCU = ['Circuit classique','Tabata','Circuit en 30-10','Circuit varié (rep)','Circuit varié (temps)','Circuit varié']
const PARTIES_SEANCE_APERCU = ['Échauffement','Corps de séance','Retour au calme','Séance complète']
const TYPES_EFFORT_APERCU = ['Répétitions', 'Durée (sec)', 'Distance (m)']
const toFirestoreEffortApercu = (v: string) =>
  v === 'Durée (sec)' ? 'Secondes' : v === 'Distance (m)' ? 'Mètres' : v
const fromFirestoreEffortApercu = (v: string) =>
  v === 'Secondes' ? 'Durée (sec)' : v === 'Mètres' ? 'Distance (m)' : v
const TEMPO_PRESETS_APERCU = [
  { label: '0-0-0-0', values: [0, 0, 0, 0] },
  { label: '3-1-1-1', values: [3, 1, 1, 1] },
]

function getSeanceDefaultsApercu(type: string) {
  switch (type) {
    case 'Tabata':                return { nb_tours: 4, recup_tours: 0,  tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 20 }
    case 'Circuit en 30-10':      return { nb_tours: 3, recup_tours: 10, tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 30 }
    case 'Circuit varié (rep)':   return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 10 }
    case 'Circuit varié (temps)': return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
    case 'Circuit varié':         return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 30 }
    default:                      return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
  }
}

interface PlanningData {
  id: string
  date_planning?: any
  type_planning?: string
  cr_rdv_moi?: string
  cr_rdv_client?: string
  motivation_pdt_seance?: number
  intensite_mise_pdt_seance?: number
  intensite_seance?: number
  /** Questionnaire d'état de forme d'avant-séance (indice de Hooper). */
  questionnaire_rempli?: boolean
}

interface ExerciceData {
  id: string
  nom_exercice: string
  image_exercice?: string
}

interface ProgItem {
  id: string
  num_exercice: number
  effort: number
  type_effort: string
  recup_effort: number
  tempo_phase1?: number
  tempo_phase2?: number
  tempo_phase3?: number
  tempo_phase4?: number
  explication_exercice?: string
  charge?: number
  nb_serie_effectuee?: number
  materiel?: string
  alerte_exercice?: string
  raison_alerte_exercice?: string
  intensite_exercice?: string
  observations_exercice?: string
  exercice: any
}

interface SeanceData {
  id: string
  type_seance: string
  partie_seance: string
  nb_tours: number
  recup_tours: number
  num_circuit?: number
  avancement_circuit?: number
  intensite_circuit?: number
  satisfaction_circuit?: string
  intensite_gen?: string
  programme: { item: ProgItem; exo: ExerciceData | null }[]
}

// ── Labels ──────────────────────────────────────────────────────────────────────

const RPE_LABELS = [
  '0 — Repos',
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

const MOTIV_LABELS = [
  "1 — Pas motivé",
  "2 — Peu motivé",
  "3 — Moyennement motivé",
  "4 — Motivé",
  "5 — Très motivé",
]

const INTENSITE_MISE_LABELS = [
  "1 — J'ai mis aucune intensité",
  "2 — J'ai mis un minimum d'intensité",
  "3 — J'ai mis 50% de l'intensité que je pouvais",
  "4 — J'ai mis beaucoup d'intensité",
  "5 — J'ai mis toute l'intensité que j'avais",
]

// ── Color helpers ───────────────────────────────────────────────────────────────

// RPE 0-10 : low=green, mid=orange, high=red
function rpeBg(rpe: number) {
  if (rpe < 4) return 'bg-etat-bon border-etat-bon text-white'
  if (rpe < 8) return 'bg-etat-moy border-etat-moy text-white'
  return 'bg-etat-pas-bon border-etat-pas-bon text-white'
}
function rpeColor(rpe: number) {
  if (rpe < 4) return 'text-etat-bon'
  if (rpe < 8) return 'text-etat-moy'
  return 'text-etat-pas-bon'
}

// 1-5 scale: low=red, mid=orange, high=green
function scale5Bg(val: number) {
  if (val <= 2) return 'bg-etat-pas-bon border-etat-pas-bon text-white'
  if (val === 3) return 'bg-etat-moy border-etat-moy text-white'
  return 'bg-etat-bon border-etat-bon text-white'
}
function scale5Color(val: number) {
  if (val <= 2) return 'text-etat-pas-bon'
  if (val === 3) return 'text-etat-moy'
  return 'text-etat-bon'
}

export default function OverviewSeancePage() {
  const { planningId } = useParams<{ planningId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sourcePlanningId = searchParams.get('sourcePlanningId') || ''
  /** On vient de créer cette séance en refaisant une séance passée. */
  const estNouvelleSeance = searchParams.get('nouvelle') === '1'
  const { userProfile, currentUser } = useAuth()
  const { exercices } = useExercices()
  const isAdmin = userProfile?.role_app === 'Admin'
  const droits = userProfile?.droits

  useEffect(() => {
    if (userProfile && !isAdmin && userProfile.droits?.seances === false) {
      router.replace('/accueil')
    }
  }, [userProfile, isAdmin, router])

  const [loading, setLoading] = useState(true)
  const [accessBlocked, setAccessBlocked] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Vérifier si l'accès aux séances est expiré pour les non-admins
  useEffect(() => {
    if (!currentUser || isAdmin) return
    getDocs(query(collection(db, 'clients'), where('linkedUserId', '==', currentUser.uid))).then((snap) => {
      if (snap.empty) return
      const expiry = (snap.docs[0].data() as any).seanceAccessExpiry
      if (expiry && expiry.toMillis() < Date.now()) setAccessBlocked(true)
    }).catch(() => {})
  }, [currentUser, isAdmin])

  // Add circuit modal
  const [showAddCircuit, setShowAddCircuit] = useState(false)
  const [savingCircuit, setSavingCircuit] = useState(false)
  const [addCircuitForm, setAddCircuitForm] = useState({
    type_seance: 'Circuit classique',
    partie_seance: 'Corps de séance',
    observations_seance: '',
    nb_tours: 3,
    recup_tours: 30,
    tps_recup_exo_default: 5,
    type_effort_exo_default: 'Durée (sec)' as string,
    tps_effort_exo_default: 30,
  })
  // Édition des paramètres d'un circuit (admin uniquement)
  const [editCircuit, setEditCircuit] = useState<SeanceData | null>(null)
  const [savingEditCircuit, setSavingEditCircuit] = useState(false)
  const [editCircuitForm, setEditCircuitForm] = useState({
    type_seance: 'Circuit classique',
    partie_seance: 'Corps de séance',
    observations_seance: '',
    nb_tours: 3,
    recup_tours: 30,
    tps_recup_exo_default: 5,
    type_effort_exo_default: 'Durée (sec)' as string,
    tps_effort_exo_default: 30,
  })
  const [planning, setPlanning] = useState<PlanningData | null>(null)
  const [seances, setSeances] = useState<SeanceData[]>([])
  const [linkedPlanningInfos, setLinkedPlanningInfos] = useState<{ planningId: string; label: string; isRoot: boolean }[]>([])
  const [currentLabel, setCurrentLabel] = useState('')

  // Édition rapide d'un exercice (admin uniquement, en pleine séance)
  const [editExo, setEditExo] = useState<{ seanceId: string; item: ProgItem; exoName: string } | null>(null)
  const [savingExo, setSavingExo] = useState(false)
  const [exoSelId, setExoSelId] = useState('')
  const [exoSearch, setExoSearch] = useState('')
  const [exoForm, setExoForm] = useState({
    type_effort: 'Durée (sec)', effort: 0, recup_effort: 0,
    tempo_phase1: 0, tempo_phase2: 0, tempo_phase3: 0, tempo_phase4: 0,
    charge: 0, materiel: '', alerte_exercice: '', raison_alerte_exercice: '',
    intensite_exercice: '', explication_exercice: '', observations_exercice: '',
  })

  const openEditExo = (seanceId: string, item: ProgItem, exoName: string) => {
    setEditExo({ seanceId, item, exoName })
    setExoSelId(item.exercice?.id || '')
    setExoSearch('')
    setExoForm({
      type_effort: fromFirestoreEffortApercu(item.type_effort || 'Durée (sec)'),
      effort: item.effort ?? 0,
      recup_effort: item.recup_effort ?? 0,
      tempo_phase1: item.tempo_phase1 ?? 0,
      tempo_phase2: item.tempo_phase2 ?? 0,
      tempo_phase3: item.tempo_phase3 ?? 0,
      tempo_phase4: item.tempo_phase4 ?? 0,
      charge: item.charge ?? 0,
      materiel: item.materiel ?? '',
      alerte_exercice: item.alerte_exercice ?? '',
      raison_alerte_exercice: item.raison_alerte_exercice ?? '',
      intensite_exercice: item.intensite_exercice ?? '',
      explication_exercice: item.explication_exercice ?? '',
      observations_exercice: item.observations_exercice ?? '',
    })
  }

  const handleSaveExo = async () => {
    if (!editExo) return
    setSavingExo(true)
    try {
      const exoChanged = !!exoSelId && exoSelId !== (editExo.item.exercice?.id || '')
      const exoRef = exoSelId ? doc(db, 'exercices', exoSelId) : null
      const payload = {
        type_effort: toFirestoreEffortApercu(exoForm.type_effort),
        effort: Number(exoForm.effort),
        recup_effort: Number(exoForm.recup_effort),
        tempo_phase1: Number(exoForm.tempo_phase1),
        tempo_phase2: Number(exoForm.tempo_phase2),
        tempo_phase3: Number(exoForm.tempo_phase3),
        tempo_phase4: Number(exoForm.tempo_phase4),
        charge: Number(exoForm.charge),
        materiel: exoForm.materiel,
        alerte_exercice: exoForm.alerte_exercice,
        raison_alerte_exercice: exoForm.raison_alerte_exercice,
        intensite_exercice: exoForm.intensite_exercice,
        explication_exercice: exoForm.explication_exercice,
        observations_exercice: exoForm.observations_exercice,
        ...(exoChanged && exoRef ? { exercice: exoRef } : {}),
      }
      await updateDoc(doc(db, 'programme_seance', editExo.item.id), payload)
      // Données du nouvel exercice (pour l'affichage) si l'exercice a changé
      const newExo = exoChanged
        ? (() => {
            const e = exercices.find(x => x.id === exoSelId) as any
            return e ? { id: e.id, nom_exercice: e.nom_exercice, image_exercice: e.image_exercice } as ExerciceData : null
          })()
        : null
      // Mise à jour optimiste du state local
      setSeances(prev => prev.map(s => s.id === editExo.seanceId
        ? { ...s, programme: s.programme.map(p => p.item.id === editExo.item.id
            ? {
                item: { ...p.item, ...payload, ...(exoChanged && exoRef ? { exercice: exoRef } : {}) },
                exo: newExo ?? p.exo,
              }
            : p) }
        : s
      ))
      // Mémoriser l'intensité/alerte de cet exercice pour ce client
      const cid = (planning as any)?.ref_users?.id ?? (planning as any)?.ref_client?.id ?? null
      await saveExerciceMemory(cid, exoSelId || editExo.item.exercice?.id, {
        intensite_exercice: payload.intensite_exercice,
        alerte_exercice: payload.alerte_exercice,
        raison_alerte_exercice: payload.raison_alerte_exercice,
      })
      setEditExo(null)
    } finally {
      setSavingExo(false)
    }
  }

  // Per-circuit UI state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [bilanOpen, setBilanOpen] = useState<Record<string, boolean>>({})
  const [adminNotesOpen, setAdminNotesOpen] = useState<Record<string, boolean>>({})
  const [rpeValues, setRpeValues] = useState<Record<string, number>>({})
  const [satValues, setSatValues] = useState<Record<string, string>>({})
  const [intensiteGenValues, setIntensiteGenValues] = useState<Record<string, string>>({})
  const [savingRpe, setSavingRpe] = useState<Record<string, boolean>>({})
  const [savedRpe, setSavedRpe] = useState<Record<string, boolean>>({})
  const [savingAdmin, setSavingAdmin] = useState<Record<string, boolean>>({})
  const [savedAdmin, setSavedAdmin] = useState<Record<string, boolean>>({})

  // Bilan de fin de séance (saved to planning_pro)
  const [bilanFinOpen, setBilanFinOpen] = useState(false)
  const [motivSeance, setMotivSeance] = useState(1)
  const [intensiteMise, setIntensiteMise] = useState(1)
  const [intensiteSeance, setIntensiteSeance] = useState(0)
  const [savingBilanFin, setSavingBilanFin] = useState(false)
  const [savedBilanFin, setSavedBilanFin] = useState(false)

  // Commentaires de séance (saved to planning_pro, filled AFTER bilan)
  const [commentairesOpen, setCommentairesOpen] = useState(false)
  const [crCoach, setCrCoach] = useState('')
  const [crClient, setCrClient] = useState('')
  const [savingCommentaires, setSavingCommentaires] = useState(false)
  const [savedCommentaires, setSavedCommentaires] = useState(false)
  const [refaisant, setRefaisant] = useState(false)
  const [refaite, setRefaite] = useState(false)
  const [showForme, setShowForme] = useState(false)

  useEffect(() => {
    if (!planningId) return
    ;(async () => {
      setLoading(true)
      try {
        const pSnap = await getDoc(doc(db, 'planning_pro', planningId))
        if (pSnap.exists()) {
          const pData = pSnap.data() as any
          setPlanning({ id: pSnap.id, ...pData } as PlanningData)
          setMotivSeance(pData.motivation_pdt_seance || 1)
          setIntensiteMise(pData.intensite_mise_pdt_seance || 1)
          setIntensiteSeance(pData.intensite_seance ?? 0)
          setCrCoach(pData.cr_rdv_moi || '')
          setCrClient(pData.cr_rdv_client || '')

          // Helper : prénom + nom du client d'un planning
          const fetchName = async (d: any): Promise<string> => {
            const uid = d?.ref_users?.id ?? d?.ref_client?.id ?? null
            if (!uid) return ''
            try {
              const u = (await getDoc(doc(db, 'users', uid))).data() as any
              return [u?.prenom, u?.nom].filter(Boolean).join(' ')
            } catch { return '' }
          }
          const buildLabel = (d: any, name: string) => {
            const date = d?.date_planning?.toDate?.()
            const dateStr = date ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''
            return [name, dateStr].filter(Boolean).join(' · ')
          }

          // Label du RDV courant
          const curName = await fetchName(pData)
          setCurrentLabel(buildLabel(pData, curName))

          // Charger les RDVs liés (depuis le planning racine)
          const rootPlanningId = sourcePlanningId || planningId
          const rootData = sourcePlanningId
            ? (await getDoc(doc(db, 'planning_pro', sourcePlanningId))).data() as any
            : pData
          const parts: string[] = ((rootData?.participants_supplementaires as any[]) || [])
            .map((p: any) => typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '')
            .filter(Boolean)
          const allIds = [rootPlanningId, ...parts].filter((lpId) => lpId !== planningId)
          if (allIds.length > 0) {
            const infos = (await Promise.all(allIds.map(async (lpId) => {
              try {
                const lpSnap = await getDoc(doc(db, 'planning_pro', lpId))
                const d = lpSnap.data() as any
                const name = await fetchName(d)
                const label = buildLabel(d, name) || lpId
                return { planningId: lpId, label, isRoot: lpId === rootPlanningId }
              } catch { return null }
            }))).filter(Boolean) as { planningId: string; label: string; isRoot: boolean }[]
            setLinkedPlanningInfos(infos)
          } else {
            setLinkedPlanningInfos([])
          }
        }

        const sq = query(collection(db, 'seance'), where('ref_planning', '==', doc(db, 'planning_pro', planningId)))
        const sSnap = await getDocs(sq)
        const raw = sSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
        raw.sort((a, b) => (a.num_circuit ?? 0) - (b.num_circuit ?? 0))

        const initRpe: Record<string, number> = {}
        const initSat: Record<string, string> = {}
        const initChoix: Record<string, string> = {}

        const enriched: SeanceData[] = await Promise.all(raw.map(async (s) => {
          initRpe[s.id] = s.intensite_circuit ?? 0
          initSat[s.id] = s.satisfaction_circuit ?? ''
          initChoix[s.id] = s.intensite_gen || '🟡'

          const pq = query(collection(db, 'programme_seance'), where('ref_seance', '==', doc(db, 'seance', s.id)))
          const pSnap2 = await getDocs(pq)
          const items = pSnap2.docs.map(d => ({ id: d.id, ...d.data() } as ProgItem))
          items.sort((a, b) => (a.num_exercice ?? 0) - (b.num_exercice ?? 0))

          const programme = await Promise.all(items.map(async (item) => {
            let exo: ExerciceData | null = null
            if (item.exercice) {
              try {
                const eSnap = await getDoc(item.exercice)
                if (eSnap.exists()) exo = { id: eSnap.id, ...(eSnap.data() as object) } as ExerciceData
              } catch {}
            }
            return { item, exo }
          }))

          return { ...s, programme } as SeanceData
        }))

        setSeances(enriched)
        setRpeValues(initRpe)
        setSatValues(initSat)
        setIntensiteGenValues(initChoix)

        const first = enriched.find(s => (s.avancement_circuit ?? 0) < 1) ?? enriched[0]
        if (first) setExpanded({ [first.id]: true })
      } finally {
        setLoading(false)
      }
    })()
  }, [planningId, sourcePlanningId, refreshKey])

  const handleAddCircuit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    setSavingCircuit(true)
    try {
      await addDoc(collection(db, 'seance'), {
        ...addCircuitForm,
        nb_tours: Number(addCircuitForm.nb_tours),
        recup_tours: Number(addCircuitForm.recup_tours),
        tps_recup_exo_default: Number(addCircuitForm.tps_recup_exo_default),
        type_effort_exo_default: toFirestoreEffortApercu(addCircuitForm.type_effort_exo_default),
        tps_effort_exo_default: Number(addCircuitForm.tps_effort_exo_default),
        ref_planning: doc(db, 'planning_pro', planningId),
        ref_users: doc(db, 'users', currentUser.uid),
        num_circuit: seances.length + 1,
        avancement_circuit: 0,
        nb_exercice: 0,
        date_create: Timestamp.now(),
      })
      setShowAddCircuit(false)
      setAddCircuitForm({
        type_seance: 'Circuit classique', partie_seance: 'Corps de séance',
        observations_seance: '', nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,
        type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30,
      })
      setRefreshKey(k => k + 1)
    } finally {
      setSavingCircuit(false)
    }
  }

  const openEditCircuit = (seance: SeanceData) => {
    const s = seance as any
    setEditCircuit(seance)
    setEditCircuitForm({
      type_seance: s.type_seance ?? 'Circuit classique',
      partie_seance: s.partie_seance ?? 'Corps de séance',
      observations_seance: s.observations_seance ?? '',
      nb_tours: s.nb_tours ?? 3,
      recup_tours: s.recup_tours ?? 30,
      tps_recup_exo_default: s.tps_recup_exo_default ?? 5,
      type_effort_exo_default: fromFirestoreEffortApercu(s.type_effort_exo_default || 'Durée (sec)'),
      tps_effort_exo_default: s.tps_effort_exo_default ?? 30,
    })
  }

  const handleSaveEditCircuit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editCircuit) return
    setSavingEditCircuit(true)
    try {
      const payload = {
        type_seance: editCircuitForm.type_seance,
        partie_seance: editCircuitForm.partie_seance,
        observations_seance: editCircuitForm.observations_seance,
        nb_tours: Number(editCircuitForm.nb_tours),
        recup_tours: Number(editCircuitForm.recup_tours),
        tps_recup_exo_default: Number(editCircuitForm.tps_recup_exo_default),
        type_effort_exo_default: toFirestoreEffortApercu(editCircuitForm.type_effort_exo_default),
        tps_effort_exo_default: Number(editCircuitForm.tps_effort_exo_default),
      }
      await updateDoc(doc(db, 'seance', editCircuit.id), payload)
      // Mise à jour optimiste du state local
      setSeances(prev => prev.map(s => s.id === editCircuit.id ? ({ ...s, ...payload } as SeanceData) : s))
      setEditCircuit(null)
    } finally {
      setSavingEditCircuit(false)
    }
  }

  const saveRpe = async (seanceId: string) => {
    setSavingRpe(s => ({ ...s, [seanceId]: true }))
    try {
      const rpe = rpeValues[seanceId] ?? 0
      const seance = seances.find(s => s.id === seanceId)
      // Renseigner une intensité ressentie marque le circuit comme réalisé
      const markDone = rpe > 0
      await updateDoc(doc(db, 'seance', seanceId), {
        intensite_circuit: rpe,
        ...(markDone ? { avancement_circuit: 1.0 } : {}),
      })
      // Marquer tous les exercices comme réalisés (tous les tours effectués)
      if (markDone && seance) {
        const nbTours = seance.nb_tours ?? 1
        await Promise.all(
          seance.programme.map(({ item }) =>
            updateDoc(doc(db, 'programme_seance', item.id), { nb_serie_effectuee: nbTours })
          )
        )
        // Mise à jour optimiste du state local pour afficher "Terminé" sans recharger
        setSeances(prev => prev.map(s => s.id === seanceId
          ? { ...s, avancement_circuit: 1.0, intensite_circuit: rpe,
              programme: s.programme.map(p => ({ ...p, item: { ...p.item, nb_serie_effectuee: nbTours } })) }
          : s
        ))
      }
      setSavedRpe(s => ({ ...s, [seanceId]: true }))
      setTimeout(() => setSavedRpe(s => ({ ...s, [seanceId]: false })), 2000)
    } finally {
      setSavingRpe(s => ({ ...s, [seanceId]: false }))
    }
  }

  const saveAdminNotes = async (seanceId: string) => {
    setSavingAdmin(s => ({ ...s, [seanceId]: true }))
    try {
      await updateDoc(doc(db, 'seance', seanceId), {
        satisfaction_circuit: satValues[seanceId] ?? '',
        intensite_gen: intensiteGenValues[seanceId] ?? '',
      })
      setSavedAdmin(s => ({ ...s, [seanceId]: true }))
      setTimeout(() => setSavedAdmin(s => ({ ...s, [seanceId]: false })), 2000)
    } finally {
      setSavingAdmin(s => ({ ...s, [seanceId]: false }))
    }
  }

  const saveBilanFin = async () => {
    setSavingBilanFin(true)
    try {
      await updateDoc(doc(db, 'planning_pro', planningId), {
        motivation_pdt_seance: motivSeance,
        intensite_mise_pdt_seance: intensiteMise,
        intensite_seance: intensiteSeance,
        // Remplir le bilan de fin de séance marque le RDV comme effectué
        etat_planning_rdv: 'Effectué',
        rdv_effectue: 'Effectué',
      })
      // Mise à jour optimiste pour que "Bilan rempli" s'affiche immédiatement
      setPlanning(p => p ? { ...p, motivation_pdt_seance: motivSeance } as PlanningData : p)
      setSavedBilanFin(true)
      setTimeout(() => setSavedBilanFin(false), 2000)
    } finally {
      setSavingBilanFin(false)
    }
  }

  const saveCommentaires = async () => {
    setSavingCommentaires(true)
    try {
      // Le client n'écrit QUE son propre retour : renvoyer `cr_rdv_moi` depuis
      // son écran le ferait réécrire le mot du coach avec ce qu'il avait chargé
      // — et l'écraserait si le coach l'a modifié entre-temps.
      await updateDoc(doc(db, 'planning_pro', planningId), {
        ...(isAdmin ? { cr_rdv_moi: crCoach } : {}),
        cr_rdv_client: crClient,
      })
      setSavedCommentaires(true)
      setTimeout(() => setSavedCommentaires(false), 2000)
    } finally {
      setSavingCommentaires(false)
    }
  }

  const launchUrl = (s: SeanceData) => {
    const base = `/seances/lancement/${s.id}?exo=1&planningId=${planningId}&returnTo=planning`
    return (s.avancement_circuit ?? 0) >= 1 ? `${base}&replay=1` : base
  }

  const dateStr = (() => {
    const d = planning?.date_planning?.toDate?.()
    if (!d) return '—'
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  })()

  const bilanFinFilled = (planning?.motivation_pdt_seance ?? 0) > 0

  /**
   * La séance appartient-elle à un jour révolu ?
   *
   * Comparé au DÉBUT du jour courant, et non à l'instant présent : le client
   * doit pouvoir saisir son ressenti le soir même de sa séance. Ce n'est qu'à
   * partir du lendemain que ses réponses se figent — au-delà, un ressenti
   * modifié n'est plus un ressenti, et il fausserait le suivi du coach.
   */
  const seancePassee = (() => {
    const d = planning?.date_planning?.toDate?.()
    if (!d) return false
    const debutDuJour = new Date()
    debutDuJour.setHours(0, 0, 0, 0)
    return d < debutDuJour
  })()

  /** Le coach garde la main : lui doit pouvoir corriger après coup. */
  const saisieVerrouillee = !isAdmin && seancePassee

  /**
   * Séance menée seul par le client, créée depuis « Refaire cette séance ».
   * Elle n'a pas été précédée d'un échange avec le coach : l'état de forme est
   * donc le seul point de contrôle avant l'effort, et il doit être renseigné
   * AVANT — rempli après coup, il ne décrit plus l'état de départ.
   */
  const estSeanceAutonomie = planning?.type_planning === 'Séance en autonomie'
  const doitRemplirForme =
    !isAdmin && estSeanceAutonomie && !planning?.questionnaire_rempli

  /**
   * « Refaire cette séance » : DUPLIQUE le RDV, ses circuits et leurs exercices
   * à la date du jour, puis ouvre la copie.
   *
   * Pourquoi dupliquer plutôt que rejouer : le mode `replay` remet à zéro
   * `avancement_circuit` et les tours effectués DE LA SÉANCE D'ORIGINE. Refaire
   * en place effacerait donc le travail de la première fois. Ici, l'originale
   * n'est pas touchée — le client repart d'une séance vierge, qu'il peut
   * lancer et où il saisit ses propres ressentis.
   *
   * ⚠️ Rien de ce qui relève du VÉCU n'est copié : ni les ressentis (RPE,
   * motivation, intensités), ni les comptes rendus, ni l'avancement. Seul le
   * CONTENU de l'entraînement l'est.
   */
  const refaireSeance = async () => {
    if (!currentUser || !planning) return
    setRefaisant(true)
    try {
      const src = planning as any
      const now = new Date()
      const debut = new Date(now)
      const fin = new Date(now.getTime() + 60 * 60 * 1000)

      // 1. Le RDV. Le type « Séance en autonomie » le distingue, dans le
      //    planning du coach, d'un rendez-vous qu'il a lui-même programmé.
      const nouveauPlanning = await addDoc(collection(db, 'planning_pro'), {
        ...(src.ref_users ? { ref_users: src.ref_users } : {}),
        ...(src.ref_client ? { ref_client: src.ref_client } : {}),
        type_planning: 'Séance en autonomie',
        date_planning: Timestamp.fromDate(now),
        heure_planning_debut: Timestamp.fromDate(debut),
        heure_planning_fin: Timestamp.fromDate(fin),
        // « Calé » et non « Non calé » (le défaut de la création manuelle) :
        // cette séance a bien lieu, à cette date, et rien n'est à convenir avec
        // le coach. Elle passera à « Effectué » quand le bilan sera rempli.
        etat_planning_rdv: 'Calé',
        // Trace l'origine : utile pour retrouver la séance modèle.
        refaiteDe: planningId,
        date_create: Timestamp.now(),
      })

      // 2. Les circuits, puis 3. leurs exercices — séquentiellement, chaque
      //    exercice devant pointer sur le circuit fraîchement créé.
      for (const s of seances) {
        const sSrc = s as any
        const copieCircuit = await addDoc(collection(db, 'seance'), {
          type_seance: sSrc.type_seance ?? 'Circuit classique',
          partie_seance: sSrc.partie_seance ?? 'Corps de séance',
          observations_seance: sSrc.observations_seance ?? '',
          nb_tours: sSrc.nb_tours ?? 3,
          recup_tours: sSrc.recup_tours ?? 30,
          tps_recup_exo_default: sSrc.tps_recup_exo_default ?? 5,
          type_effort_exo_default: sSrc.type_effort_exo_default ?? 'Durée (sec)',
          tps_effort_exo_default: sSrc.tps_effort_exo_default ?? 30,
          num_circuit: sSrc.num_circuit ?? 1,
          nb_exercice: s.programme.length,
          ref_planning: doc(db, 'planning_pro', nouveauPlanning.id),
          ref_users: doc(db, 'users', currentUser.uid),
          avancement_circuit: 0,
          date_create: Timestamp.now(),
        })

        for (const { item } of s.programme) {
          const i = item as any
          await addDoc(collection(db, 'programme_seance'), {
            ref_seance: doc(db, 'seance', copieCircuit.id),
            ...(i.exercice ? { exercice: i.exercice } : {}),
            num_exercice: i.num_exercice ?? 0,
            type_effort: i.type_effort ?? 'Durée (sec)',
            effort: i.effort ?? 0,
            recup_effort: i.recup_effort ?? 0,
            tempo_phase1: i.tempo_phase1 ?? 0,
            tempo_phase2: i.tempo_phase2 ?? 0,
            tempo_phase3: i.tempo_phase3 ?? 0,
            tempo_phase4: i.tempo_phase4 ?? 0,
            charge: i.charge ?? 0,
            materiel: i.materiel ?? '',
            alerte_exercice: i.alerte_exercice ?? '',
            raison_alerte_exercice: i.raison_alerte_exercice ?? '',
            intensite_exercice: i.intensite_exercice ?? '',
            explication_exercice: i.explication_exercice ?? '',
            // Le vécu ne se recopie pas : ni tours effectués, ni observations.
            nb_serie_effectuee: 0,
            date_create: Timestamp.now(),
          })
        }
      }

      // 4. Prévenir le coach : une séance en autonomie se décide sans lui, il
      //    n'a aucun autre moyen de l'apprendre avant le prochain rendez-vous.
      //    In-app ET push, comme à la création d'un compte.
      if (!isAdmin) {
        const nomClient = [userProfile?.prenom, userProfile?.nom].filter(Boolean).join(' ')
          || userProfile?.email || 'Un client'
        const texte = `${nomClient} refait une séance aujourd'hui (${planning.type_planning || 'Séance'}).`
        try {
          const admins = await getDocs(query(collection(db, 'users'), where('role_app', '==', 'Admin')))
          await Promise.all(admins.docs.map((a) =>
            addDoc(collection(db, 'Notifications'), {
              refUsers: doc(db, 'users', a.id),
              type_notification: 'SEANCE_AUTONOMIE',
              notification: texte,
              etat_notification: 'Non lu',
              ref_planning: doc(db, 'planning_pro', nouveauPlanning.id),
              date_create: Timestamp.now(),
            })
          ))
        } catch { /* la séance est créée : une notification manquée ne doit pas la bloquer */ }

        fetch('/api/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toAdmins: true,
            title: 'Séance en autonomie',
            body: texte,
            url: `/seances/apercu/${nouveauPlanning.id}`,
          }),
        }).catch(() => {})
      }

      setRefaite(true)
      // `nouvelle=1` : la page d'arrivée est la MÊME que celle qu'on quitte, au
      // paramètre près. Sans repère visuel, on croit que le clic n'a rien fait.
      router.push(`/seances/apercu/${nouveauPlanning.id}?nouvelle=1`)
    } finally {
      setRefaisant(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-gray-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (accessBlocked) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-3xl">🔒</div>
      <h2 className="text-xl font-bold text-gray-800">Accès aux séances expiré</h2>
      <p className="text-sm text-gray-500 max-w-xs">
        Votre période d'accès aux séances en ligne a pris fin. Contactez votre coach pour renouveler votre abonnement.
      </p>
      <button onClick={() => router.push('/accueil')} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
        Retour à l'accueil
      </button>
    </div>
  )

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/planning/${planningId}`)} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 capitalize">{dateStr}</h1>
          <p className="text-sm text-gray-500">{planning?.type_planning} · {seances.length} circuit(s)</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddCircuit(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-xl transition"
          >
            <PlusIcon className="w-4 h-4" />
            Circuit
          </button>
        )}
      </div>

      {/* Confirmation d'arrivée sur une séance fraîchement recréée, avec le
          bouton de lancement bien en vue : on quitte une page identique à
          celle-ci, sans ce repère on croit que rien ne s'est passé. */}
      {(estNouvelleSeance || doitRemplirForme) && seances.length > 0 && (
        <div className={`mb-4 rounded-2xl border-2 p-4 ${
          doitRemplirForme ? 'border-blue-500 bg-blue-50' : 'border-green-500 bg-green-50'
        }`}>
          <div className="flex items-start gap-2">
            <CheckIcon className={`w-5 h-5 shrink-0 mt-0.5 ${doitRemplirForme ? 'text-blue-600' : 'text-green-600'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${doitRemplirForme ? 'text-blue-900' : 'text-green-900'}`}>
                {doitRemplirForme ? 'Avant de commencer' : 'Votre séance est prête'}
              </p>
              <p className={`text-xs mt-0.5 ${doitRemplirForme ? 'text-blue-700' : 'text-green-700'}`}>
                {doitRemplirForme
                  ? 'Renseignez votre état de forme du jour : sommeil, fatigue, courbatures, stress. Il sert de repère avant l’effort et suit votre récupération.'
                  : 'Une copie a été créée pour aujourd’hui. Vos réponses de la séance d’origine sont conservées.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => doitRemplirForme ? setShowForme(true) : router.push(launchUrl(seances[0]))}
            className={`mt-3 w-full flex items-center justify-center gap-2 text-white font-bold text-base py-4 rounded-xl transition ${
              doitRemplirForme ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {!doitRemplirForme && <PlayIcon className="w-5 h-5" />}
            {doitRemplirForme ? 'Remplir mon état de forme' : 'Lancer la séance'}
          </button>
        </div>
      )}

      {/* Switch entre RDVs liés */}
      {isAdmin && linkedPlanningInfos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-none">
          <button className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border bg-indigo-600 text-white border-indigo-600 cursor-default">
            {currentLabel || (sourcePlanningId ? 'Ce RDV' : 'RDV principal')}
          </button>
          {linkedPlanningInfos.map((linked) => {
            const rootId = sourcePlanningId || planningId
            const url = linked.isRoot
              ? `/seances/apercu/${linked.planningId}`
              : `/seances/apercu/${linked.planningId}?sourcePlanningId=${rootId}`
            return (
              <button
                key={linked.planningId}
                onClick={() => router.push(url)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-600 transition"
              >
                {linked.isRoot ? `← ${linked.label}` : linked.label}
              </button>
            )
          })}
        </div>
      )}

      {seances.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">Aucun circuit dans cette séance</p>
          <button onClick={() => router.push(`/planning/${planningId}`)} className="mt-3 text-gray-600 text-sm hover:underline">
            Retour au RDV
          </button>
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── Circuits ── */}
          {seances.map((seance) => {
            const isOpen = !!expanded[seance.id]
            const isBilanVisible = !!bilanOpen[seance.id]
            const isAdminNotesVisible = !!adminNotesOpen[seance.id]
            const isDone = (seance.avancement_circuit ?? 0) >= 1
            const rpe = rpeValues[seance.id] ?? 0

            return (
              <div key={seance.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

                {/* Circuit header */}
                <div className="flex items-stretch">
                  <button
                    className="flex-1 min-w-0 flex items-center justify-between p-4 text-left"
                    onClick={() => setExpanded(e => ({ ...e, [seance.id]: !e[seance.id] }))}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {seance.num_circuit != null && (
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Circuit {seance.num_circuit}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isDone ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {isDone ? '✓ Terminé' : '● À faire'}
                        </span>
                      </div>
                      <p className="font-semibold text-gray-800">{seance.type_seance}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {seance.partie_seance} · {seance.nb_tours} tour(s) · Récup {seance.recup_tours}s
                        {seance.programme.length > 0 && ` · ${seance.programme.length} exercice(s)`}
                      </p>
                      {isDone && rpe > 0 && (
                        <p className={`text-xs font-bold mt-1 ${rpeColor(rpe)}`}>RPE circuit : {rpe}/10</p>
                      )}
                    </div>
                    {isOpen
                      ? <ChevronUpIcon className="w-5 h-5 text-gray-400 shrink-0 ml-2" />
                      : <ChevronDownIcon className="w-5 h-5 text-gray-400 shrink-0 ml-2" />
                    }
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => openEditCircuit(seance)}
                      title="Modifier le circuit"
                      className="shrink-0 flex items-center px-3 border-l border-gray-50 text-gray-300 hover:text-blue-600 hover:bg-gray-50 transition"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div>
                    {/* Exercise list */}
                    {seance.programme.length === 0 ? (
                      <div className="border-t border-gray-50 px-4 py-6 text-center">
                        <p className="text-sm text-gray-400">Aucun exercice dans ce circuit</p>
                      </div>
                    ) : (
                      <div className="border-t border-gray-50 divide-y divide-gray-50">
                        {seance.programme.map(({ item, exo }, idx) => (
                          <div
                            key={item.id}
                            className={`flex items-start gap-3 px-4 py-3 ${isAdmin ? 'cursor-pointer hover:bg-gray-50 transition' : ''}`}
                            onClick={isAdmin ? () => openEditExo(seance.id, item, exo?.nom_exercice || `Exercice ${idx + 1}`) : undefined}
                          >
                            <div className="shrink-0">
                              {exo?.image_exercice ? (
                                <img src={exo.image_exercice} alt="" className="w-12 h-12 rounded-lg object-cover" />
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-400">
                                  {idx + 1}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-800">{exo?.nom_exercice || `Exercice ${idx + 1}`}</p>
                                {/* Repère de travail du coach (léger / modéré / intense) :
                                    masqué au client, à qui il ne dirait rien d'utile
                                    et pourrait suggérer une difficulté avant l'effort. */}
                                {isAdmin && item.intensite_exercice && (
                                  <span className="text-xs shrink-0">{item.intensite_exercice}</span>
                                )}
                                {isAdmin && (
                                  <svg className="w-3.5 h-3.5 text-gray-300 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                )}
                              </div>
                              {item.alerte_exercice && (
                                <div className="mt-0.5">
                                  <p className="text-xs text-red-500 font-medium">⚠ {item.alerte_exercice}</p>
                                  {item.raison_alerte_exercice && (
                                    <p className="text-xs text-red-400">{item.raison_alerte_exercice}</p>
                                  )}
                                </div>
                              )}
                              <p className="text-xs text-gray-500 mt-0.5">
                                Effort : {item.effort} {item.type_effort === 'Répétitions' ? 'rép' : (item.type_effort === 'Secondes' || item.type_effort === 'Durée (sec)') ? 'sec' : (item.type_effort === 'Mètres' || item.type_effort === 'Distance (m)') ? 'm' : ''}
                                {(item.recup_effort ?? 0) > 0 && ` · récup ${item.recup_effort}s`}
                              </p>
                              {item.tempo_phase1 != null && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Tempo : {item.tempo_phase1}-{item.tempo_phase2 ?? 0}-{item.tempo_phase3 ?? 0}{item.tempo_phase4 != null ? `-${item.tempo_phase4}` : ''}
                                </p>
                              )}
                              {item.materiel && (
                                <p className="text-xs text-gray-400 mt-0.5">Matériel : {item.materiel}</p>
                              )}
                              {item.explication_exercice ? (
                                <p className="text-xs text-gray-500 italic mt-1 bg-amber-50 rounded-lg px-2 py-1">
                                  {item.explication_exercice}
                                </p>
                              ) : null}
                              {item.observations_exercice ? (
                                <p className="text-xs text-gray-400 mt-0.5">{item.observations_exercice}</p>
                              ) : null}
                              {((item.charge ?? 0) > 0 || (item.nb_serie_effectuee ?? 0) > 0) && (
                                <p className="text-xs text-gray-600 font-medium mt-1">
                                  {(item.charge ?? 0) > 0 && `${item.charge} kg`}
                                  {(item.nb_serie_effectuee ?? 0) > 0 && ` · ${item.nb_serie_effectuee} tour(s) effectué(s)`}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Intensité ressentie circuit (RPE) */}
                    {(isAdmin || droits?.questionnaire !== false) && <div className="border-t border-gray-100">
                      <button
                        onClick={() => setBilanOpen(b => ({ ...b, [seance.id]: !b[seance.id] }))}
                        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                      >
                        {isBilanVisible ? <ChevronUpIcon className="w-4 h-4 text-gray-500" /> : <ChevronDownIcon className="w-4 h-4 text-gray-500" />}
                        Intensité ressentie (circuit)
                        {rpe > 0 && <span className={`ml-auto text-xs font-bold ${rpeColor(rpe)}`}>RPE {rpe}/10</span>}
                      </button>

                      {isBilanVisible && (
                        saisieVerrouillee ? (
                          // Séance d'un jour révolu : le client relit son ressenti,
                          // il ne le réécrit plus.
                          <div className="px-4 pb-4">
                            {rpe > 0 ? (
                              <div className={`px-4 py-2.5 rounded-xl text-sm border ${rpeBg(rpe)}`}>
                                {RPE_LABELS[rpe]}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 italic">
                                Aucune intensité renseignée pour ce circuit.
                              </p>
                            )}
                            <p className="text-[11px] text-gray-400 mt-2">
                              Séance passée : le ressenti n&apos;est plus modifiable.
                            </p>
                          </div>
                        ) : (
                        <div className="px-4 pb-4 space-y-2">
                          <div className="space-y-1.5">
                            {RPE_LABELS.map((label, i) => (
                              <button
                                key={i}
                                onClick={() => setRpeValues(r => ({ ...r, [seance.id]: i }))}
                                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                                  i === rpe ? rpeBg(i) : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => saveRpe(seance.id)}
                            disabled={savingRpe[seance.id]}
                            className={`w-full text-sm font-semibold py-2.5 rounded-xl transition mt-1 ${
                              savedRpe[seance.id]
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-600 hover:bg-gray-700 disabled:opacity-60 text-white'
                            }`}
                          >
                            {savedRpe[seance.id] ? '✓ Enregistré' : savingRpe[seance.id] ? 'Sauvegarde...' : 'Enregistrer'}
                          </button>
                        </div>
                        )
                      )}
                    </div>}

                    {/* Notes admin (satisfaction + évaluation — admin uniquement) */}
                    {isAdmin && (
                      <div className="border-t border-gray-100">
                        <button
                          onClick={() => setAdminNotesOpen(a => ({ ...a, [seance.id]: !a[seance.id] }))}
                          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition"
                        >
                          {isAdminNotesVisible ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                          Indications circuit
                          {(satValues[seance.id] || intensiteGenValues[seance.id]) && (
                            <span className="ml-auto text-xs text-green-600">✓</span>
                          )}
                        </button>

                        {isAdminNotesVisible && (
                          <div className="px-4 pb-4 space-y-4">
                            <div>
                              <label className="text-xs font-semibold text-gray-600 block mb-1">Satisfaction / Ressenti</label>
                              <textarea
                                value={satValues[seance.id] ?? ''}
                                onChange={e => setSatValues(s => ({ ...s, [seance.id]: e.target.value }))}
                                rows={2}
                                placeholder="Comment s'est passé ce circuit ?"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-500 resize-none"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-gray-600 block mb-2">Évaluation</label>
                              <div className="flex gap-4">
                                {[
                                  { value: '🔵', color: '#93c5fd', shadow: '0 0 0 4px #bfdbfe', label: 'Léger' },
                                  { value: '🟡', color: '#facc15', shadow: '0 0 0 4px #fef08a', label: 'Modéré' },
                                  { value: '⚫', color: '#ef4444', shadow: '0 0 0 4px #fca5a5', label: 'Intense' },
                                ].map(({ value, color, shadow, label }) => {
                                  const selected = intensiteGenValues[seance.id] === value
                                  return (
                                    <button key={value}
                                      onClick={() => setIntensiteGenValues(c => ({ ...c, [seance.id]: selected ? '' : value }))}
                                      className="flex flex-col items-center gap-1"
                                    >
                                      <span className="w-9 h-9 rounded-full transition-all"
                                        style={{
                                          backgroundColor: color,
                                          boxShadow: selected ? shadow : 'none',
                                          transform: selected ? 'scale(1.1)' : 'scale(1)',
                                          opacity: selected ? 1 : 0.4,
                                        }}
                                      />
                                      <span className="text-[10px] text-gray-500">{label}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                            <button
                              onClick={() => saveAdminNotes(seance.id)}
                              disabled={savingAdmin[seance.id]}
                              className={`w-full text-sm font-semibold py-2.5 rounded-xl transition ${
                                savedAdmin[seance.id]
                                  ? 'bg-green-500 text-white'
                                  : 'bg-gray-600 hover:bg-gray-700 disabled:opacity-60 text-white'
                              }`}
                            >
                              {savedAdmin[seance.id] ? '✓ Enregistré' : savingAdmin[seance.id] ? 'Sauvegarde...' : 'Enregistrer les notes'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Lancer — masqué au client sur une séance passée : relancer
                        un circuit y réécrirait les données de la séance d'origine.
                        Pour la refaire, le bouton « Refaire cette séance » en bas
                        de page crée une activité datée d'aujourd'hui. */}
                    {!saisieVerrouillee && (
                      <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                        {doitRemplirForme ? (
                          // Le lancement reste fermé tant que l'état de forme
                          // n'est pas saisi : renseigné après l'effort, il ne
                          // décrirait plus l'état de départ.
                          <button
                            onClick={() => setShowForme(true)}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
                          >
                            Remplir mon état de forme d&apos;abord
                          </button>
                        ) : (
                          <button
                            onClick={() => router.push(launchUrl(seance))}
                            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition"
                          >
                            <PlayIcon className="w-4 h-4" />
                            {isDone ? 'Relancer ce circuit' : 'Lancer ce circuit'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Refaire la séance (client, séance passée) ── */}
          {saisieVerrouillee && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-700">Refaire cette séance</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-3">
                Crée une copie datée d&apos;aujourd&apos;hui, que vous pourrez lancer et remplir
                normalement. Cette séance-ci et vos réponses ne sont pas modifiées.
              </p>
              <button
                onClick={refaireSeance}
                disabled={refaisant || refaite}
                className={`w-full flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition ${
                  refaite
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white'
                }`}
              >
                <PlayIcon className="w-4 h-4" />
                {refaite ? '✓ Séance créée' : refaisant ? 'Création…' : 'Refaire cette séance'}
              </button>
            </div>
          )}

          {/* ── Bilan de fin de séance ── */}
          {(isAdmin || droits?.questionnaire !== false) && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setBilanFinOpen(b => !b)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left"
            >
              {bilanFinOpen
                ? <ChevronUpIcon className="w-5 h-5 text-gray-400 shrink-0" />
                : <ChevronDownIcon className="w-5 h-5 text-gray-400 shrink-0" />
              }
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-700">Bilan de fin de séance</p>
                {bilanFinFilled
                  ? <div className="flex flex-wrap gap-2 mt-0.5">
                      <p className={`text-xs font-medium ${scale5Color(motivSeance)}`}>
                        Motiv. : {motivSeance}/5
                      </p>
                      <p className={`text-xs font-medium ${scale5Color(intensiteMise)}`}>
                        Intensité : {intensiteMise}/5
                      </p>
                      {intensiteSeance > 0 && (
                        <p className={`text-xs font-medium ${rpeColor(intensiteSeance)}`}>
                          RPE : {intensiteSeance}/10
                        </p>
                      )}
                    </div>
                  : <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full mt-1">✗ Non rempli</span>
                }
              </div>
            </button>

            {bilanFinOpen && saisieVerrouillee && (
              // Séance d'un jour révolu : le client relit son bilan sans pouvoir
              // le réécrire. Un ressenti retouché des semaines plus tard ne
              // décrit plus la séance et fausse le suivi.
              <div className="px-4 pb-5 space-y-3 border-t border-gray-100 pt-4">
                {bilanFinFilled ? (
                  <>
                    <p className="text-sm text-gray-700">
                      Motivation :{" "}
                      <span className={`font-bold ${scale5Color(motivSeance)}`}>{motivSeance}/5</span>
                    </p>
                    <p className="text-sm text-gray-700">
                      Intensité mise :{" "}
                      <span className={`font-bold ${scale5Color(intensiteMise)}`}>{intensiteMise}/5</span>
                    </p>
                    {intensiteSeance > 0 && (
                      <p className="text-sm text-gray-700">
                        Intensité de la séance :{" "}
                        <span className="font-bold text-gray-800">{intensiteSeance}/10</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 italic">Bilan non rempli pour cette séance.</p>
                )}
                <p className="text-[11px] text-gray-400">
                  Séance passée : le bilan n&apos;est plus modifiable.
                </p>
              </div>
            )}

            {bilanFinOpen && !saisieVerrouillee && (
              <div className="px-4 pb-5 space-y-6 border-t border-gray-100 pt-4">

                {/* Motivation */}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    Motivation pendant la séance :
                    {motivSeance > 0 && (
                      <span className={`ml-2 font-bold ${scale5Color(motivSeance)}`}>{motivSeance}/5</span>
                    )}
                  </p>
                  <div className="space-y-1.5">
                    {MOTIV_LABELS.map((label, i) => {
                      const val = i + 1
                      return (
                        <button
                          key={val}
                          onClick={() => setMotivSeance(val)}
                          className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                            val === motivSeance ? scale5Bg(val) : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <hr className="border-gray-100" />

                {/* Intensité mise */}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    Intensité mise pendant la séance :
                    {intensiteMise > 0 && (
                      <span className={`ml-2 font-bold ${scale5Color(intensiteMise)}`}>{intensiteMise}/5</span>
                    )}
                  </p>
                  <div className="space-y-1.5">
                    {INTENSITE_MISE_LABELS.map((label, i) => {
                      const val = i + 1
                      return (
                        <button
                          key={val}
                          onClick={() => setIntensiteMise(val)}
                          className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                            val === intensiteMise ? scale5Bg(val) : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <hr className="border-gray-100" />

                {/* Intensité de la séance (RPE global) */}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    Intensité de la séance :
                    {intensiteSeance > 0 && (
                      <span className={`ml-2 font-bold ${rpeColor(intensiteSeance)}`}>{intensiteSeance}/10</span>
                    )}
                  </p>
                  <div className="space-y-1.5">
                    {RPE_LABELS.map((label, i) => (
                      <button
                        key={i}
                        onClick={() => setIntensiteSeance(i)}
                        className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition border ${
                          i === intensiteSeance ? rpeBg(i) : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={saveBilanFin}
                  disabled={savingBilanFin}
                  className={`w-full text-sm font-semibold py-3 rounded-xl transition ${
                    savedBilanFin
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white'
                  }`}
                >
                  {savedBilanFin ? '✓ Bilan enregistré' : savingBilanFin ? 'Sauvegarde...' : 'Enregistrer le bilan'}
                </button>
              </div>
            )}
          </div>}

          {/* ── Commentaires de séance (après le bilan) ── */}
          {(isAdmin || droits?.questionnaire !== false) && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setCommentairesOpen(b => !b)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left"
            >
              {commentairesOpen
                ? <ChevronUpIcon className="w-5 h-5 text-gray-400 shrink-0" />
                : <ChevronDownIcon className="w-5 h-5 text-gray-400 shrink-0" />
              }
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-700">Commentaires de séance</p>
                {(crCoach.trim() && crClient.trim())
                  ? <p className="text-xs text-green-600 mt-0.5 font-medium">✓ Commentaires enregistrés</p>
                  : (crCoach.trim() || crClient.trim())
                    ? <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-600 text-xs font-medium px-2 py-0.5 rounded-full mt-1">
                        ⚠ {crClient.trim() ? 'Commentaire du coach manquant' : 'Commentaire client manquant'}
                      </span>
                    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full mt-1">✗ Aucun commentaire</span>
                }
              </div>
            </button>

            {commentairesOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
                {/* Le commentaire du coach est ÉCRIT par le coach et seulement LU
                    par le client : côté client, un champ de saisie laisserait
                    croire qu'il peut répondre là — et il écraserait le mot du
                    coach. Il a son propre champ juste en dessous. */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    Commentaire du coach
                    {isAdmin && <span className="font-normal text-blue-500"> (visible par le client)</span>}
                  </label>
                  {isAdmin ? (
                    <textarea
                      value={crCoach}
                      onChange={e => setCrCoach(e.target.value)}
                      rows={3}
                      placeholder="Votre compte-rendu de séance..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-500 resize-none"
                    />
                  ) : crCoach.trim() ? (
                    <p className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {crCoach}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic px-1">Aucun commentaire pour le moment.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Commentaire client</label>
                  <textarea
                    value={crClient}
                    onChange={e => setCrClient(e.target.value)}
                    rows={3}
                    placeholder="Retour du client..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-500 resize-none"
                  />
                </div>
                <button
                  onClick={saveCommentaires}
                  disabled={savingCommentaires}
                  className={`w-full text-sm font-semibold py-2.5 rounded-xl transition ${
                    savedCommentaires
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-600 hover:bg-gray-700 disabled:opacity-60 text-white'
                  }`}
                >
                  {savedCommentaires ? '✓ Enregistré' : savingCommentaires ? 'Sauvegarde...' : 'Enregistrer les commentaires'}
                </button>
              </div>
            )}
          </div>}

        </div>
      )}
      {/* Questionnaire de forme, par-dessus la séance : le client le remplit
          sans quitter la page, et retrouve son écran à l'enregistrement. */}
      {showForme && (
        <QuestionnaireFormeModal
          isOpen
          planningId={planningId}
          initial={reponsesDepuisPlanning(planning as any)}
          onClose={() => setShowForme(false)}
          // Mise à jour locale : `planning` vient d'un chargement ponctuel, sans
          // ça le verrou resterait actif jusqu'au prochain rechargement.
          onSaved={() => setPlanning(p => p ? { ...p, questionnaire_rempli: true } : p)}
        />
      )}

      {/* Modal édition rapide d'un exercice (admin) */}
      <Modal isOpen={!!editExo} onClose={() => setEditExo(null)} title={editExo ? `Modifier — ${editExo.exoName}` : 'Modifier'} size="lg">
        <div className="space-y-4">
          {/* Sélection de l'exercice */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Exercice</label>
            {exoSelId && (() => {
              const sel = exercices.find(e => e.id === exoSelId) as any
              return sel ? (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <CheckIcon className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-medium text-blue-700 truncate">{sel.nom_exercice}</span>
                  <span className="text-xs text-blue-400 shrink-0">{`· ${normalizePartieCorps(sel.partie_prioritaire)}`}</span>
                </div>
              ) : null
            })()}
            <input
              type="text"
              placeholder="Rechercher un autre exercice..."
              value={exoSearch}
              onChange={e => setExoSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {exoSearch.trim() && (
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {exercices.filter(e => e.nom_exercice?.toLowerCase().includes(exoSearch.toLowerCase())).length === 0 ? (
                  <p className="text-xs text-gray-400 p-3">Aucun exercice trouvé</p>
                ) : (
                  exercices
                    .filter(e => e.nom_exercice?.toLowerCase().includes(exoSearch.toLowerCase()))
                    .map(ex => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => {
                          setExoSelId(ex.id)
                          setExoSearch('')
                          setExoForm(f => ({ ...f, explication_exercice: (ex as any).explications_commentees_exercice || '' }))
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 transition ${
                          exoSelId === ex.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <span>
                          {ex.nom_exercice}
                          <span className="text-xs text-gray-400 ml-2">{`· ${normalizePartieCorps((ex as any).partie_prioritaire)}`}</span>
                        </span>
                        {exoSelId === ex.id && <CheckIcon className="w-4 h-4 text-blue-600 shrink-0" />}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort</label>
              <select value={exoForm.type_effort} onChange={e => setExoForm(f => ({ ...f, type_effort: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {TYPES_EFFORT_APERCU.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort {exoForm.type_effort === 'Répétitions' ? '(rép)' : exoForm.type_effort === 'Distance (m)' ? '(m)' : '(sec)'}
              </label>
              <input type="number" min={0} value={exoForm.effort}
                onChange={e => setExoForm(f => ({ ...f, effort: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Récupération (sec)</label>
            <input type="number" min={0} value={exoForm.recup_effort}
              onChange={e => setExoForm(f => ({ ...f, recup_effort: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Tempo (Ph.1 / Ph.2 / Ph.3 / Ph.4)</label>
              <div className="flex gap-1">
                {TEMPO_PRESETS_APERCU.map(p => (
                  <button key={p.label} type="button"
                    onClick={() => setExoForm(f => ({ ...f, tempo_phase1: p.values[0], tempo_phase2: p.values[1], tempo_phase3: p.values[2], tempo_phase4: p.values[3] }))}
                    className="text-xs px-2 py-0.5 rounded-md border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition font-mono">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['tempo_phase1', 'tempo_phase2', 'tempo_phase3', 'tempo_phase4'] as const).map((key, i) => (
                <input key={key} type="number" min={0} value={(exoForm as any)[key]}
                  onChange={e => setExoForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                  placeholder={`Ph.${i + 1}`}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Charge (kg)</label>
            <input type="number" min={0} step={0.25} value={exoForm.charge}
              onChange={e => setExoForm(f => ({ ...f, charge: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Matériel</label>
            <input type="text" value={exoForm.materiel}
              onChange={e => setExoForm(f => ({ ...f, materiel: e.target.value }))}
              placeholder="Haltères, élastique…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alerte exercice</label>
            <input type="text" value={exoForm.alerte_exercice}
              onChange={e => setExoForm(f => ({ ...f, alerte_exercice: e.target.value }))}
              placeholder="Ex : Douleur genou, contrainte lombaire…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {exoForm.alerte_exercice && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Raison de l'alerte</label>
                <textarea value={exoForm.raison_alerte_exercice}
                  onChange={e => setExoForm(f => ({ ...f, raison_alerte_exercice: e.target.value }))}
                  rows={2} placeholder="Expliquer pourquoi il y a une alerte…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Intensité exercice</label>
            <div className="flex gap-4">
              {[
                { value: '🔵', color: '#93c5fd', shadow: '0 0 0 4px #bfdbfe', label: 'Léger' },
                { value: '🟡', color: '#facc15', shadow: '0 0 0 4px #fef08a', label: 'Modéré' },
                { value: '⚫', color: '#ef4444', shadow: '0 0 0 4px #fca5a5', label: 'Intense' },
              ].map(({ value, color, shadow, label }) => {
                const selected = exoForm.intensite_exercice === value
                return (
                  <button key={value} type="button"
                    onClick={() => setExoForm(f => ({ ...f, intensite_exercice: selected ? '' : value }))}
                    className="flex flex-col items-center gap-1">
                    <span className="w-9 h-9 rounded-full transition-all"
                      style={{ backgroundColor: color, boxShadow: selected ? shadow : 'none', transform: selected ? 'scale(1.1)' : 'scale(1)', opacity: selected ? 1 : 0.4 }} />
                    <span className="text-[10px] text-gray-500">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Explication</label>
            <textarea value={exoForm.explication_exercice}
              onChange={e => setExoForm(f => ({ ...f, explication_exercice: e.target.value }))}
              rows={2} placeholder="Consignes spécifiques…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea value={exoForm.observations_exercice}
              onChange={e => setExoForm(f => ({ ...f, observations_exercice: e.target.value }))}
              rows={2} placeholder="Notes supplémentaires…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setEditExo(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="button" onClick={handleSaveExo} disabled={savingExo}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
              {savingExo ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal ajouter circuit */}
      <Modal isOpen={showAddCircuit} onClose={() => setShowAddCircuit(false)} title="Ajouter un circuit">
        <form onSubmit={handleAddCircuit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie de séance</label>
            <select value={addCircuitForm.partie_seance}
              onChange={e => setAddCircuitForm({ ...addCircuitForm, partie_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PARTIES_SEANCE_APERCU.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de circuit</label>
            <select
              value={addCircuitForm.type_seance}
              onChange={e => {
                const defaults = getSeanceDefaultsApercu(e.target.value)
                setAddCircuitForm({ ...addCircuitForm, type_seance: e.target.value, ...defaults })
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_SEANCE_APERCU.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb tours</label>
              <input type="number" min={1} value={addCircuitForm.nb_tours}
                onChange={e => setAddCircuitForm({ ...addCircuitForm, nb_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup entre tours (s)</label>
              <input type="number" min={0} value={addCircuitForm.recup_tours}
                onChange={e => setAddCircuitForm({ ...addCircuitForm, recup_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort par défaut</label>
            <select value={addCircuitForm.type_effort_exo_default}
              onChange={e => setAddCircuitForm({ ...addCircuitForm, type_effort_exo_default: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_EFFORT_APERCU.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort par défaut {addCircuitForm.type_effort_exo_default === 'Durée (sec)' ? '(sec)' : '(rép)'}
              </label>
              <input type="number" min={0} value={addCircuitForm.tps_effort_exo_default}
                onChange={e => setAddCircuitForm({ ...addCircuitForm, tps_effort_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup par défaut (s)</label>
              <input type="number" min={0} value={addCircuitForm.tps_recup_exo_default}
                onChange={e => setAddCircuitForm({ ...addCircuitForm, tps_recup_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowAddCircuit(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit" disabled={savingCircuit}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition">
              {savingCircuit ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal modifier circuit (admin) */}
      <Modal isOpen={!!editCircuit} onClose={() => setEditCircuit(null)} title={editCircuit ? `Modifier le circuit ${(editCircuit as any).num_circuit ?? ''}`.trim() : 'Modifier le circuit'}>
        <form onSubmit={handleSaveEditCircuit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie de séance</label>
            <select value={editCircuitForm.partie_seance}
              onChange={e => setEditCircuitForm({ ...editCircuitForm, partie_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PARTIES_SEANCE_APERCU.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de circuit</label>
            <select value={editCircuitForm.type_seance}
              onChange={e => setEditCircuitForm({ ...editCircuitForm, type_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_SEANCE_APERCU.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb tours</label>
              <input type="number" min={1} value={editCircuitForm.nb_tours}
                onChange={e => setEditCircuitForm({ ...editCircuitForm, nb_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup entre tours (s)</label>
              <input type="number" min={0} value={editCircuitForm.recup_tours}
                onChange={e => setEditCircuitForm({ ...editCircuitForm, recup_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort par défaut</label>
            <select value={editCircuitForm.type_effort_exo_default}
              onChange={e => setEditCircuitForm({ ...editCircuitForm, type_effort_exo_default: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_EFFORT_APERCU.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort par défaut {editCircuitForm.type_effort_exo_default === 'Répétitions' ? '(rép)' : editCircuitForm.type_effort_exo_default === 'Distance (m)' ? '(m)' : '(sec)'}
              </label>
              <input type="number" min={0} value={editCircuitForm.tps_effort_exo_default}
                onChange={e => setEditCircuitForm({ ...editCircuitForm, tps_effort_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup par défaut (s)</label>
              <input type="number" min={0} value={editCircuitForm.tps_recup_exo_default}
                onChange={e => setEditCircuitForm({ ...editCircuitForm, tps_recup_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea value={editCircuitForm.observations_seance}
              onChange={e => setEditCircuitForm({ ...editCircuitForm, observations_seance: e.target.value })}
              rows={2} placeholder="Notes sur ce circuit…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setEditCircuit(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button type="submit" disabled={savingEditCircuit}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition">
              {savingEditCircuit ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  )
}
