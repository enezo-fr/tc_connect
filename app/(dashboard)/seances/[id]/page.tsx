'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { formatDate } from '@/lib/planningUtils'
import { useSeances } from '@/hooks/useSeances'
import { useExercices } from '@/hooks/useExercices'
import { useProgrammeSeance } from '@/hooks/useProgrammeSeance'
import { useAuth } from '@/context/AuthContext'
import Modal from '@/components/ui/Modal'
import { ArrowLeftIcon, PlusIcon, PencilIcon, TrashIcon, CheckIcon, ChevronUpIcon, ChevronDownIcon, PlayIcon } from '@heroicons/react/24/outline'
import { loadExerciceMemory, saveExerciceMemory } from '@/lib/exerciceMemory'
import { MUSCLES, MATERIEL, PARTIE_CORPS_DEFAUT, normalizePartieCorps } from '@/lib/exerciceOptions'
import { ChipsPartieCorps, ChipsMulti } from '@/components/exercices/ChampsExercice'
import BlocMedia from '@/components/exercices/BlocMedia'
import { type TypeMedia, TYPES_MEDIA, CHAMP_URL, CHAMP_SOURCE, supprimerMediaSiOrphelin } from '@/lib/exerciceMedia'

const TYPES_EFFORT = ['Répétitions', 'Durée (sec)', 'Distance (m)']
const TYPES_SEANCE_CIRCUIT_DETAIL = ['Circuit classique','Tabata','Circuit en 30-10','Circuit varié (rep)','Circuit varié (temps)','Circuit varié']
const TYPES_EFFORT_CIRCUIT_DETAIL = ['Répétitions', 'Durée (sec)']
const toFirestoreEffort = (v: string) =>
  v === 'Durée (sec)' ? 'Secondes' : v === 'Distance (m)' ? 'Mètres' : v
const fromFirestoreEffort = (v: string) =>
  v === 'Secondes' ? 'Durée (sec)' : v === 'Mètres' ? 'Distance (m)' : v

const TEMPO_PRESETS = [
  { label: '0-0-0-0', values: [0, 0, 0, 0] },
  { label: '3-1-1-1', values: [3, 1, 1, 1] },
]

// Unité d'effort lisible selon le type stocké en base
const effortUnit = (t: string) =>
  t === 'Répétitions' ? 'rép'
  : (t === 'Secondes' || t === 'Durée (sec)') ? 'sec'
  : (t === 'Mètres' || t === 'Distance (m)') ? 'm' : ''
const PARTIES_SEANCE_DETAIL = ['Échauffement','Corps de séance','Retour au calme','Séance complète']

function getCircuitDefaults(type: string) {
  switch (type) {
    case 'Tabata':                return { nb_tours: 4, recup_tours: 0,  tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 20 }
    case 'Circuit en 30-10':      return { nb_tours: 3, recup_tours: 10, tps_recup_exo_default: 10, type_effort_exo_default: 'Durée (sec)',  tps_effort_exo_default: 30 }
    case 'Circuit varié (rep)':   return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 10 }
    case 'Circuit varié (temps)': return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
    case 'Circuit varié':         return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Répétitions', tps_effort_exo_default: 30 }
    default:                      return { nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,  type_effort_exo_default: 'Durée (sec)', tps_effort_exo_default: 30 }
  }
}

export default function DetailSeancePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const planningId = searchParams.get('planningId') || ''
  const sourcePlanningId = searchParams.get('sourcePlanningId') || ''
  const { currentUser, userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const { seances, updateSeance, deleteSeance } = useSeances(planningId || undefined)
  const { exercices, addExercice, updateExercice } = useExercices()
  const { programme, loading, addExerciceToSeance, updateExerciceSeance, removeExerciceFromSeance } =
    useProgrammeSeance(id)

  const seance = seances.find((s) => s.id === id)
  const siblingCircuits = [...seances]
    .sort((a, b) => ((a as any).num_circuit ?? 0) - ((b as any).num_circuit ?? 0))

  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const [showEditCircuitModal, setShowEditCircuitModal] = useState(false)
  const [deleteCircuitConfirm, setDeleteCircuitConfirm] = useState(false)
  const [deleteExerciceConfirm, setDeleteExerciceConfirm] = useState<string | null>(null)
  const [editCircuitForm, setEditCircuitForm] = useState({
    type_seance: 'Circuit classique', partie_seance: 'Corps de séance',
    observations_seance: '', nb_tours: 3, recup_tours: 30, tps_recup_exo_default: 5,
    type_effort_exo_default: 'Durée (sec)' as string, tps_effort_exo_default: 30, intensite_circuit_planifie: 0,
  })

  const [showCreateExo, setShowCreateExo] = useState(false)
  const [creatingExo, setCreatingExo] = useState(false)
  const NOUVEL_EXO_VIDE = {
    nom_exercice: '',
    partie_prioritaire: PARTIE_CORPS_DEFAUT as string,
    explications_commentees_exercice: '',
    image_exercice: '',
    video_exercice: '',
    lien_exercice: '',
    Muscles: [] as string[],
    Materiel: [] as string[],
    image_source_id: '',
    video_source_id: '',
  }
  const [newExoForm, setNewExoForm] = useState(NOUVEL_EXO_VIDE)
  const [newMateriel, setNewMateriel] = useState('')

  const [form, setForm] = useState({
    exercice_id: '',
    type_effort: 'Répétitions',
    effort: 10,
    recup_effort: 60,
    tempo_phase1: 1,
    tempo_phase2: 1,
    tempo_phase3: 1,
    tempo_phase4: 1,
    materiel: '',
    charge: 0,
    alerte_exercice: '',
    raison_alerte_exercice: '',
    intensite_exercice: '🟡',
    explication_exercice: '',
    observations_exercice: '',
  })

  // Client lié à ce RDV (pour la mémoire intensité/alerte par exercice)
  const [clientId, setClientId] = useState<string | null>(null)
  const [linkedSeancesInfo, setLinkedSeancesInfo] = useState<{ planningId: string; seanceId: string; label: string; isRoot: boolean }[]>([])
  const [currentLabel, setCurrentLabel] = useState('')

  useEffect(() => {
    if (!planningId) { setClientId(null); setLinkedSeancesInfo([]); return }
    const numCircuit = (seance as any)?.num_circuit
    if (numCircuit == null) return
    const rootPlanningId = sourcePlanningId || planningId

    const fetchName = async (d: any): Promise<string> => {
      const uid = d?.ref_users?.id ?? d?.ref_client?.id ?? null
      if (!uid) return ''
      try {
        const u = (await getDoc(doc(db, 'users', uid))).data() as any
        return [u?.prenom, u?.nom].filter(Boolean).join(' ')
      } catch { return '' }
    }
    const buildLabel = (d: any, name: string) => {
      const dateStr = formatDate(d?.date_planning)
      return [name, dateStr].filter(Boolean).join(' · ')
    }

    ;(async () => {
      try {
        const [currentSnap, rootSnap] = await Promise.all([
          getDoc(doc(db, 'planning_pro', planningId)),
          sourcePlanningId ? getDoc(doc(db, 'planning_pro', sourcePlanningId)) : Promise.resolve(null),
        ])
        if (currentSnap.exists()) {
          const d = currentSnap.data() as any
          setClientId(d.ref_users?.id ?? d.ref_client?.id ?? null)
          const name = await fetchName(d)
          setCurrentLabel(buildLabel(d, name))
        }
        const rootData = (rootSnap ?? currentSnap).data() as any
        const parts: string[] = ((rootData?.participants_supplementaires as any[]) || [])
          .map((p: any) => typeof p.ref_planning_id === 'string' ? p.ref_planning_id : '')
          .filter(Boolean)

        const allPlanningIds = [rootPlanningId, ...parts]
        const results = (await Promise.all(allPlanningIds.map(async (lpId) => {
          if (lpId === planningId) return null
          try {
            const [lpSnap, seancesSnap] = await Promise.all([
              getDoc(doc(db, 'planning_pro', lpId)),
              getDocs(query(
                collection(db, 'seance'),
                where('ref_planning', '==', doc(db, 'planning_pro', lpId)),
                where('num_circuit', '==', numCircuit),
              )),
            ])
            if (seancesSnap.empty) return null
            const d = lpSnap.exists() ? lpSnap.data() as any : null
            const name = d ? await fetchName(d) : ''
            const label = buildLabel(d, name) || lpId
            const isRoot = lpId === rootPlanningId
            return { planningId: lpId, seanceId: seancesSnap.docs[0].id, label, isRoot }
          } catch { return null }
        }))).filter(Boolean) as { planningId: string; seanceId: string; label: string; isRoot: boolean }[]
        setLinkedSeancesInfo(results)
      } catch {}
    })()
  }, [planningId, sourcePlanningId, (seance as any)?.num_circuit])

  // Sélectionne un exercice et restaure sa mémoire (intensité/alerte) pour ce client
  const selectExercice = async (exId: string, explication: string) => {
    setForm((f) => ({ ...f, exercice_id: exId, explication_exercice: explication, materiel: '' }))
    const mem = await loadExerciceMemory(clientId, exId)
    if (mem) {
      // N'appliquer que si l'exercice sélectionné est toujours celui-ci (évite les races)
      setForm((f) => f.exercice_id === exId ? {
        ...f,
        intensite_exercice: mem.intensite_exercice || f.intensite_exercice,
        alerte_exercice: mem.alerte_exercice ?? f.alerte_exercice,
        raison_alerte_exercice: mem.raison_alerte_exercice ?? f.raison_alerte_exercice,
      } : f)
    }
  }

  const openAdd = () => {
    setEditItem(null)
    setSearch('')
    setForm({
      exercice_id: '',
      type_effort: fromFirestoreEffort((seance as any)?.type_effort_exo_default || 'Répétitions'),
      effort: (seance as any)?.tps_effort_exo_default ?? 10,
      recup_effort: (seance as any)?.tps_recup_exo_default ?? 60,
      tempo_phase1: 1,
      tempo_phase2: 1,
      tempo_phase3: 1,
      tempo_phase4: 1,
      materiel: '',
      charge: 0,
      alerte_exercice: '',
      raison_alerte_exercice: '',
      intensite_exercice: '🟡',
      explication_exercice: '',
      observations_exercice: '',
    })
    setShowModal(true)
  }

  const openEdit = (item: any) => {
    setEditItem(item)
    setForm({
      exercice_id: item.exercice?.id || '',
      type_effort: fromFirestoreEffort(item.type_effort || 'Répétitions'),
      effort: item.effort ?? 10,
      recup_effort: item.recup_effort ?? 60,
      tempo_phase1: item.tempo_phase1 ?? 1,
      tempo_phase2: item.tempo_phase2 ?? 1,
      tempo_phase3: item.tempo_phase3 ?? 1,
      tempo_phase4: item.tempo_phase4 ?? 1,
      materiel: item.materiel || '',
      charge: item.charge || 0,
      alerte_exercice: item.alerte_exercice || '',
      raison_alerte_exercice: (item as any).raison_alerte_exercice || '',
      intensite_exercice: item.intensite_exercice ?? '',
      explication_exercice: item.explication_exercice || '',
      observations_exercice: item.observations_exercice || '',
    })
    setShowModal(true)
  }

  /** Un média envoyé puis remplacé/abandonné avant la création n'appartient à personne → on l'efface. */
  const majNouvelExoMedia = (type: TypeMedia, url: string, sourceId: string) => {
    const precedente = newExoForm[CHAMP_URL[type]]
    const precedentEtaitRepris = !!newExoForm[CHAMP_SOURCE[type]]
    setNewExoForm((f) => ({ ...f, [CHAMP_URL[type]]: url, [CHAMP_SOURCE[type]]: sourceId }))
    if (precedente && precedente !== url && !precedentEtaitRepris) {
      supprimerMediaSiOrphelin(precedente, exercices, [])
    }
  }

  const annulerCreationExo = () => {
    for (const type of TYPES_MEDIA) {
      const url = newExoForm[CHAMP_URL[type]]
      if (url && !newExoForm[CHAMP_SOURCE[type]]) supprimerMediaSiOrphelin(url, exercices, [])
    }
    setShowCreateExo(false)
    setNewExoForm(NOUVEL_EXO_VIDE)
  }

  const handleCreateExo = async () => {
    if (!newExoForm.nom_exercice.trim()) return
    setCreatingExo(true)
    try {
      const created = await addExercice({
        ...newExoForm,
        nom_exercice: newExoForm.nom_exercice.trim(),
      } as any)
      setForm((f) => ({
        ...f,
        exercice_id: (created as any)?.id || '',
        explication_exercice: newExoForm.explications_commentees_exercice,
        materiel: '',
      }))
      setSearch(newExoForm.nom_exercice.trim())
      setShowCreateExo(false)
      setNewExoForm(NOUVEL_EXO_VIDE)
    } finally {
      setCreatingExo(false)
    }
  }

  const openEditCircuit = () => {
    if (!seance) return
    setEditCircuitForm({
      type_seance: (seance as any).type_seance || 'Circuit classique',
      partie_seance: (seance as any).partie_seance || 'Corps de séance',
      observations_seance: (seance as any).observations_seance || '',
      nb_tours: (seance as any).nb_tours ?? 3,
      recup_tours: (seance as any).recup_tours ?? 30,
      tps_recup_exo_default: (seance as any).tps_recup_exo_default ?? 5,
      type_effort_exo_default: fromFirestoreEffort((seance as any).type_effort_exo_default || 'Durée (sec)'),
      tps_effort_exo_default: (seance as any).tps_effort_exo_default ?? 30,
      intensite_circuit_planifie: (seance as any).intensite_circuit_planifie ?? 0,
    })
    setShowEditCircuitModal(true)
  }

  const handleEditCircuit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateSeance(id, {
      ...editCircuitForm,
      nb_tours: Number(editCircuitForm.nb_tours),
      recup_tours: Number(editCircuitForm.recup_tours),
      tps_recup_exo_default: Number(editCircuitForm.tps_recup_exo_default),
      type_effort_exo_default: toFirestoreEffort(editCircuitForm.type_effort_exo_default),
      tps_effort_exo_default: Number(editCircuitForm.tps_effort_exo_default),
      intensite_circuit_planifie: Number(editCircuitForm.intensite_circuit_planifie),
    } as any)
    setShowEditCircuitModal(false)
  }

  const handleDeleteCircuit = async () => {
    await deleteSeance(id)
    setDeleteCircuitConfirm(false)
    if (planningId) router.replace(`/planning/${planningId}`)
    else router.replace('/seances')
  }

  const handleMoveExercice = async (itemId: string, direction: 'up' | 'down') => {
    const idx = programme.findIndex(p => p.id === itemId)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === programme.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const a = programme[idx]
    const b = programme[swapIdx]
    const numA = a.num_exercice ?? idx + 1
    const numB = b.num_exercice ?? swapIdx + 1
    await Promise.all([
      updateExerciceSeance(a.id, { num_exercice: numB }),
      updateExerciceSeance(b.id, { num_exercice: numA }),
    ])
  }

  const handleAddMateriel = async () => {
    const val = newMateriel.trim()
    if (!val || !form.exercice_id) return
    const exo = exercices.find(e => e.id === form.exercice_id)
    const existing: string[] = (exo as any)?.Materiel || []
    if (!existing.includes(val)) {
      await updateExercice(form.exercice_id, { Materiel: [...existing, val] } as any)
    }
    setForm(f => ({ ...f, materiel: val }))
    setNewMateriel('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.exercice_id) return
    setSaving(true)
    try {
      const basePayload = {
        ref_seance: doc(db, 'seance', id),
        exercice: doc(db, 'exercices', form.exercice_id),
        type_effort: toFirestoreEffort(form.type_effort),
        effort: Number(form.effort),
        recup_effort: Number(form.recup_effort),
        tempo_phase1: Number(form.tempo_phase1),
        tempo_phase2: Number(form.tempo_phase2),
        tempo_phase3: Number(form.tempo_phase3),
        tempo_phase4: Number(form.tempo_phase4),
        materiel: form.materiel,
        charge: Number(form.charge),
        alerte_exercice: form.alerte_exercice,
        raison_alerte_exercice: form.raison_alerte_exercice,
        intensite_exercice: form.intensite_exercice,
        explication_exercice: form.explication_exercice,
        observations_exercice: form.observations_exercice,
      }
      if (editItem) {
        await updateExerciceSeance(editItem.id, basePayload as any)
      } else {
        const nextNum = programme.length + 1
        const payload = {
          ...basePayload,
          num_exercice: nextNum,
          nb_serie_effectuee: 0,
          ref_users: currentUser ? doc(db, 'users', currentUser.uid) : undefined,
          date_create: new Date(),
        }
        await addExerciceToSeance(payload as any)
        // Dupliquer l'exercice sur chaque séance des RDVs liés
        for (const linked of linkedSeancesInfo) {
          try {
            const lSnap = await getDoc(doc(db, 'seance', linked.seanceId))
            const lNb = (lSnap.data()?.nb_exercice ?? 0) + 1
            await addDoc(collection(db, 'programme_seance'), {
              ...basePayload,
              ref_seance: doc(db, 'seance', linked.seanceId),
              num_exercice: lNb,
              nb_serie_effectuee: 0,
              ref_users: currentUser ? doc(db, 'users', currentUser.uid) : undefined,
              date_create: new Date(),
            })
            await updateDoc(doc(db, 'seance', linked.seanceId), { nb_exercice: lNb })
          } catch (e) { console.error('[linked seance sync]', e) }
        }
      }
      // Mémoriser l'intensité/alerte de cet exercice pour ce client
      await saveExerciceMemory(clientId, form.exercice_id, {
        intensite_exercice: form.intensite_exercice,
        alerte_exercice: form.alerte_exercice,
        raison_alerte_exercice: form.raison_alerte_exercice,
      })
      setShowModal(false)
    } catch (err) {
      console.error('Erreur lors de la sauvegarde de l\'exercice :', err)
      alert('Une erreur est survenue lors de l\'enregistrement. Veuillez réessayer.')
    } finally {
      setSaving(false)
    }
  }

  const getExercice = (exerciceRef: any) => {
    const exId = typeof exerciceRef === 'string' ? exerciceRef : exerciceRef?.id
    return exercices.find((e) => e.id === exId) ?? null
  }
  const getExerciceName = (exerciceRef: any) => getExercice(exerciceRef)?.nom_exercice || '—'

  const filteredExercices = exercices.filter((e) =>
    e.nom_exercice?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-2 mb-4">
        <button
          onClick={() => planningId ? router.push(`/planning/${planningId}`) : router.push('/seances')}
          className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0 mt-0.5"
        >
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-800 leading-snug">
            {seance?.type_seance || '...'}
          </h1>
          <p className="text-xs text-gray-500 leading-relaxed">
            {seance?.partie_seance} · {seance?.nb_tours} tour(s) · Récup {seance?.recup_tours}s
            {(seance as any)?.intensite_circuit_planifie > 0 && ` · RPE cible ${(seance as any).intensite_circuit_planifie}/10`}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={openEditCircuit} title="Modifier le circuit"
              className="p-2 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition">
              <PencilIcon className="w-4 h-4" />
            </button>
            <button onClick={() => setDeleteCircuitConfirm(true)} title="Supprimer le circuit"
              className="p-2 rounded-lg border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition">
              <TrashIcon className="w-4 h-4" />
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-2.5 py-2 rounded-lg transition">
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Exercice</span>
            </button>
          </div>
        )}
      </div>

      {/* RPE cible + bilan circuit */}
      {((seance as any)?.intensite_circuit_planifie > 0 || ((seance as any)?.avancement_circuit >= 1 && ((seance as any)?.satisfaction_circuit || (seance as any)?.intensite_circuit > 0))) && (
        <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 mb-4 space-y-1">
          {(seance as any)?.intensite_circuit_planifie > 0 && (
            <p className="text-xs font-semibold text-blue-600">RPE cible : {(seance as any).intensite_circuit_planifie}/10</p>
          )}
          {(seance as any)?.intensite_circuit > 0 && (
            <p className="text-xs font-semibold text-gray-600">RPE ressenti : {(seance as any).intensite_circuit}/10</p>
          )}
          {(seance as any)?.satisfaction_circuit && (
            <p className="text-xs text-gray-500 italic">{(seance as any).satisfaction_circuit}</p>
          )}
        </div>
      )}

      {/* Switch entre RDVs liés */}
      {isAdmin && linkedSeancesInfo.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-2 scrollbar-none">
          <button className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border bg-indigo-600 text-white border-indigo-600 cursor-default">
            {currentLabel || (sourcePlanningId ? 'Ce RDV' : 'RDV principal')}
          </button>
          {linkedSeancesInfo.map((linked) => {
            const rootId = sourcePlanningId || planningId
            const url = linked.isRoot
              ? `/seances/${linked.seanceId}?planningId=${linked.planningId}`
              : `/seances/${linked.seanceId}?planningId=${linked.planningId}&sourcePlanningId=${rootId}`
            return (
              <button
                key={linked.seanceId}
                onClick={() => router.push(url)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-600 transition"
              >
                {linked.isRoot ? `← ${linked.label}` : linked.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Navigation rapide entre circuits */}
      {planningId && siblingCircuits.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-none">
          {siblingCircuits.map((s) => {
            const isCurrent = s.id === id
            const isDone = ((s as any).avancement_circuit ?? 0) >= 1
            return (
              <button
                key={s.id}
                onClick={() => !isCurrent && router.push(`/seances/${s.id}?planningId=${planningId}`)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  isCurrent
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                {isDone && !isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                C{(s as any).num_circuit ?? siblingCircuits.indexOf(s) + 1}
                {(s as any).type_seance && (
                  <span className={`${isCurrent ? 'text-blue-200' : 'text-gray-400'} hidden sm:inline`}>
                    · {(s as any).type_seance}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

{seance && programme.length > 0 && (
  <div className="mb-4 space-y-2">
    {(seance.avancement_circuit ?? 0) >= 1 && (
      <div className="text-center text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl py-2 font-medium">
        ✓ Circuit terminé
      </div>
    )}
    <button
      onClick={() => router.push(
        planningId
          ? `/seances/apercu/${planningId}`
          : `/seances/lancement/${id}?exo=1${(seance.avancement_circuit ?? 0) >= 1 ? '&replay=1' : ''}`
      )}
      className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-2xl transition"
    >
      <PlayIcon className="w-4 h-4" />
      {(seance.avancement_circuit ?? 0) >= 1 ? 'Relancer le circuit' : 'Lancer ce circuit'}
    </button>
  </div>
)}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      ) : programme.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">Aucun exercice dans cette séance</p>
          {isAdmin && (
            <button
              onClick={openAdd}
              className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition shadow-sm"
            >
              <PlusIcon className="w-4 h-4" />
              Ajouter un exercice
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {programme.map((item, index) => (
            <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
              <div className="flex items-start gap-2">

                {/* Flèches réordonnement */}
                {isAdmin && (
                  <div className="flex flex-col gap-0.5 shrink-0 mt-1">
                    <button type="button" onClick={() => handleMoveExercice(item.id, 'up')} disabled={index === 0}
                      className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition">
                      <ChevronUpIcon className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => handleMoveExercice(item.id, 'down')} disabled={index === programme.length - 1}
                      className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition">
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Image ou numéro */}
                {(() => {
                  const ex = getExercice(item.exercice)
                  return ex?.image_exercice ? (
                    <img src={ex.image_exercice} alt={ex.nom_exercice} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0 mt-0.5">
                      {item.num_exercice ?? index + 1}
                    </div>
                  )
                })()}

                {/* Contenu — prend toute la largeur restante (cliquable pour l'admin) */}
                <div
                  className={`flex-1 min-w-0 ${isAdmin ? 'cursor-pointer' : ''}`}
                  onClick={isAdmin ? () => openEdit(item) : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-gray-800 text-sm leading-tight truncate">
                      {getExerciceName(item.exercice)}
                    </p>
                    {(item as any).intensite_exercice && (
                      <span className="text-xs shrink-0">{(item as any).intensite_exercice}</span>
                    )}
                  </div>
                  {(item as any).alerte_exercice && (
                    <div className="mt-0.5">
                      <p className="text-xs text-red-500 font-medium truncate">⚠ {(item as any).alerte_exercice}</p>
                      {(item as any).raison_alerte_exercice && (
                        <p className="text-xs text-red-400 truncate">{(item as any).raison_alerte_exercice}</p>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    Effort : {item.effort} {effortUnit(item.type_effort)} · Récup {item.recup_effort}s
                  </p>
                  <p className="text-xs text-gray-400">
                    Tempo : {item.tempo_phase1}/{item.tempo_phase2}/{item.tempo_phase3}/{(item as any).tempo_phase4 ?? 0}
                  </p>
                  {(item as any).charge > 0 && (
                    <p className="text-xs text-gray-400">Charge : {(item as any).charge} kg</p>
                  )}
                  {(item as any).materiel && (
                    <p className="text-xs text-gray-400 truncate">Matériel : {(item as any).materiel}</p>
                  )}
                  {item.explication_exercice && (
                    <p className="text-xs text-gray-400 italic mt-1 line-clamp-2">{item.explication_exercice}</p>
                  )}
                  {(item as any).observations_exercice && (
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{(item as any).observations_exercice}</p>
                  )}
                </div>

                {/* Boutons icône-only, empilés verticalement */}
                {isAdmin && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => openEdit(item)}
                      className="p-1.5 rounded-lg text-blue-500 bg-blue-50 hover:bg-blue-100 transition"
                      title="Modifier">
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteExerciceConfirm(item.id)}
                      className="p-1.5 rounded-lg text-red-400 bg-red-50 hover:bg-red-100 transition"
                      title="Retirer">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal ajout exercice */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editItem ? "Modifier l'exercice" : 'Ajouter un exercice'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Recherche + création exercice */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Exercice</label>
            {form.exercice_id && (() => {
              const sel = exercices.find(e => e.id === form.exercice_id)
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
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowCreateExo(false) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {showCreateExo ? (
              <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 space-y-3">
                <p className="text-xs font-semibold text-blue-700">Créer un nouvel exercice</p>

                {/* Nom */}
                <input
                  type="text"
                  placeholder="Nom de l'exercice *"
                  value={newExoForm.nom_exercice}
                  onChange={(e) => setNewExoForm((f) => ({ ...f, nom_exercice: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />

                {/* Partie prioritaire */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Partie prioritaire</p>
                  <ChipsPartieCorps
                    valeur={newExoForm.partie_prioritaire}
                    onChange={(p) => setNewExoForm((f) => ({ ...f, partie_prioritaire: p }))}
                  />
                </div>

                {/* Muscles (multi-sélection) */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Muscles sollicités</p>
                  <ChipsMulti
                    options={MUSCLES}
                    valeurs={newExoForm.Muscles}
                    onChange={(v) => setNewExoForm((f) => ({ ...f, Muscles: v }))}
                  />
                </div>

                {/* Photo et vidéo — envoyées ou reprises d'un autre exercice */}
                <BlocMedia
                  type="image"
                  label="Photo"
                  url={newExoForm.image_exercice}
                  sourceId={newExoForm.image_source_id}
                  exercices={exercices}
                  onChange={(url, sourceId) => majNouvelExoMedia('image', url, sourceId)}
                />

                <BlocMedia
                  type="video"
                  label="Vidéo de démonstration"
                  url={newExoForm.video_exercice}
                  sourceId={newExoForm.video_source_id}
                  exercices={exercices}
                  onChange={(url, sourceId) => majNouvelExoMedia('video', url, sourceId)}
                />

                {/* Lien */}
                <input
                  type="url"
                  placeholder="Lien externe (article, ressource...)"
                  value={newExoForm.lien_exercice}
                  onChange={(e) => setNewExoForm((f) => ({ ...f, lien_exercice: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />

                {/* Matériel — pastilles courantes + saisie libre (« Élastique rouge »…) */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Matériel nécessaire</p>
                  <ChipsMulti
                    options={MATERIEL}
                    valeurs={newExoForm.Materiel}
                    onChange={(v) => setNewExoForm((f) => ({ ...f, Materiel: v }))}
                    couleur="gray"
                    avecAutre
                    placeholderAutre="Élastique rouge, charge…"
                  />
                </div>

                {/* Explications */}
                <textarea
                  placeholder="Explications / consignes (facultatif)"
                  value={newExoForm.explications_commentees_exercice}
                  onChange={(e) => setNewExoForm((f) => ({ ...f, explications_commentees_exercice: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                />

                <div className="flex gap-2">
                  <button type="button" onClick={annulerCreationExo}
                    className="flex-1 border border-gray-300 text-gray-600 py-1.5 rounded-lg text-xs hover:bg-white transition">
                    Annuler
                  </button>
                  <button type="button" onClick={handleCreateExo} disabled={creatingExo || !newExoForm.nom_exercice.trim()}
                    className="flex-1 bg-blue-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                    {creatingExo ? 'Création…' : 'Créer et sélectionner'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-36 overflow-y-auto">
                  {filteredExercices.length === 0 ? (
                    <div className="p-3">
                      <p className="text-xs text-gray-400 mb-2">Aucun exercice trouvé</p>
                    </div>
                  ) : (
                    filteredExercices.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => selectExercice(ex.id, (ex as any).explications_commentees_exercice || '')}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 transition ${
                          form.exercice_id === ex.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <span>
                          {ex.nom_exercice}
                          <span className="text-xs text-gray-400 ml-2">{`· ${normalizePartieCorps(ex.partie_prioritaire)}`}</span>
                        </span>
                        {form.exercice_id === ex.id && <CheckIcon className="w-4 h-4 text-blue-600 shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setNewExoForm((f) => ({ ...f, nom_exercice: search })); setShowCreateExo(true) }}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-blue-600 font-medium bg-blue-50 hover:bg-blue-100 border-t border-blue-100 transition"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Créer un nouvel exercice{search ? ` "${search}"` : ''}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort</label>
            <select
              value={form.type_effort}
              onChange={(e) => setForm({ ...form, type_effort: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TYPES_EFFORT.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effort</label>
              <input
                type="number" min={0} value={form.effort}
                onChange={(e) => setForm({ ...form, effort: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup (sec)</label>
              <input
                type="number" min={0} value={form.recup_effort}
                onChange={(e) => setForm({ ...form, recup_effort: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Tempo (Ph.1 / Ph.2 / Ph.3 / Ph.4)
              </label>
              <div className="flex gap-1">
                {TEMPO_PRESETS.map(p => (
                  <button key={p.label} type="button"
                    onClick={() => setForm({ ...form, tempo_phase1: p.values[0], tempo_phase2: p.values[1], tempo_phase3: p.values[2], tempo_phase4: p.values[3] })}
                    className="text-xs px-2 py-0.5 rounded-md border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition font-mono">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['tempo_phase1', 'tempo_phase2', 'tempo_phase3', 'tempo_phase4'] as const).map((key, i) => (
                <input
                  key={key}
                  type="number" min={0}
                  value={(form as any)[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  placeholder={`Ph.${i + 1}`}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Charge (kg)</label>
            <input
              type="number" min={0} value={form.charge}
              onChange={(e) => setForm({ ...form, charge: Number(e.target.value) })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {(() => {
            const selectedExo = exercices.find(e => e.id === form.exercice_id)
            const materiels: string[] = (selectedExo as any)?.Materiel || []
            return (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Matériel</label>
                {materiels.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {materiels.map((m) => (
                      <button key={m} type="button"
                        onClick={() => setForm({ ...form, materiel: form.materiel === m ? '' : m })}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                          form.materiel === m
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMateriel}
                    onChange={e => setNewMateriel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMateriel() } }}
                    placeholder="Ajouter un matériel..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="button" onClick={handleAddMateriel}
                    disabled={!newMateriel.trim()}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                    +
                  </button>
                </div>
              </div>
            )
          })()}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alerte exercice</label>
            <input
              type="text" value={form.alerte_exercice}
              onChange={(e) => setForm({ ...form, alerte_exercice: e.target.value })}
              placeholder="Ex : Douleur genou, contrainte lombaire…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {form.alerte_exercice && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Raison de l'alerte</label>
                <textarea
                  value={form.raison_alerte_exercice}
                  onChange={(e) => setForm({ ...form, raison_alerte_exercice: e.target.value })}
                  rows={2} placeholder="Expliquer pourquoi il y a une alerte sur cet exercice…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
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
                const selected = form.intensite_exercice === value
                return (
                  <button key={value} type="button"
                    onClick={() => setForm({ ...form, intensite_exercice: selected ? '' : value })}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Explication</label>
            <textarea
              value={form.explication_exercice}
              onChange={(e) => setForm({ ...form, explication_exercice: e.target.value })}
              rows={2} placeholder="Consignes spécifiques..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea
              value={form.observations_exercice}
              onChange={(e) => setForm({ ...form, observations_exercice: e.target.value })}
              rows={2} placeholder="Notes supplémentaires..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving || !form.exercice_id}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {saving ? 'Enregistrement…' : editItem ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal modifier circuit */}
      <Modal isOpen={showEditCircuitModal} onClose={() => setShowEditCircuitModal(false)} title="Modifier le circuit">
        <form onSubmit={handleEditCircuit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie de séance</label>
            <select value={editCircuitForm.partie_seance}
              onChange={(e) => setEditCircuitForm({ ...editCircuitForm, partie_seance: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PARTIES_SEANCE_DETAIL.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de circuit</label>
            <select value={editCircuitForm.type_seance}
              onChange={(e) => {
                const defaults = getCircuitDefaults(e.target.value)
                setEditCircuitForm({ ...editCircuitForm, type_seance: e.target.value, ...defaults })
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_SEANCE_CIRCUIT_DETAIL.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb tours</label>
              <input type="number" min={1} value={editCircuitForm.nb_tours}
                onChange={(e) => setEditCircuitForm({ ...editCircuitForm, nb_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup entre tours (s)</label>
              <input type="number" min={0} value={editCircuitForm.recup_tours}
                onChange={(e) => setEditCircuitForm({ ...editCircuitForm, recup_tours: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type d'effort par défaut</label>
            <select value={editCircuitForm.type_effort_exo_default}
              onChange={(e) => setEditCircuitForm({ ...editCircuitForm, type_effort_exo_default: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES_EFFORT_CIRCUIT_DETAIL.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effort par défaut {editCircuitForm.type_effort_exo_default === 'Durée (sec)' ? '(sec)' : '(rép)'}
              </label>
              <input type="number" min={0} value={editCircuitForm.tps_effort_exo_default}
                onChange={(e) => setEditCircuitForm({ ...editCircuitForm, tps_effort_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Récup par défaut (s)</label>
              <input type="number" min={0} value={editCircuitForm.tps_recup_exo_default}
                onChange={(e) => setEditCircuitForm({ ...editCircuitForm, tps_recup_exo_default: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RPE cible{editCircuitForm.intensite_circuit_planifie > 0 && <span className="ml-1.5 text-blue-600 font-bold">{editCircuitForm.intensite_circuit_planifie}/10</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[0,1,2,3,4,5,6,7,8,9,10].map((v) => (
                <button key={v} type="button"
                  onClick={() => setEditCircuitForm({ ...editCircuitForm, intensite_circuit_planifie: v })}
                  className={`w-8 h-8 rounded-lg text-xs font-bold border transition ${
                    editCircuitForm.intensite_circuit_planifie === v
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
            <textarea value={editCircuitForm.observations_seance}
              onChange={(e) => setEditCircuitForm({ ...editCircuitForm, observations_seance: e.target.value })}
              rows={3} placeholder="Notes sur ce circuit..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowEditCircuitModal(false)}
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
      <Modal isOpen={!!deleteExerciceConfirm} onClose={() => setDeleteExerciceConfirm(null)} title="Retirer cet exercice ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Cet exercice sera retiré de la séance. Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteExerciceConfirm(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={() => { if (deleteExerciceConfirm) { removeExerciceFromSeance(deleteExerciceConfirm, programme.length - 1); setDeleteExerciceConfirm(null); } }}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">
            Retirer
          </button>
        </div>
      </Modal>

      <Modal isOpen={deleteCircuitConfirm} onClose={() => setDeleteCircuitConfirm(false)} title="Supprimer ce circuit ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Cette action est irréversible. Les exercices du circuit seront également supprimés.</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteCircuitConfirm(false)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={handleDeleteCircuit}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}