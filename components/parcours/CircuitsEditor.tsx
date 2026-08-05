'use client'

import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  PlusIcon, TrashIcon, ClockIcon,
  ChevronUpIcon, ChevronDownIcon, LinkIcon,
} from '@heroicons/react/24/outline'
import type { Exercice } from '@/types'
import { normalizePartieCorps } from '@/lib/exerciceOptions'
import {
  type Circuit, type Exercise,
  newId, emptyExercise, emptyCircuit, calcCircuitSeconds, formatSeconds,
} from '@/lib/parcoursContent'

// Champ nom d'exercice avec suggestions depuis la base "exercices"
function ExerciseNameInput({
  value, linked, exercices, onChange, onSelectExercice,
}: {
  value: string
  linked: boolean
  exercices: Exercice[]
  onChange: (v: string) => void
  onSelectExercice: (ex: Exercice) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return exercices.slice(0, 8)
    return exercices.filter((e) => e.nom_exercice?.toLowerCase().includes(q)).slice(0, 8)
  }, [value, exercices])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div ref={ref} className="relative flex-1 min-w-32">
      <div className="relative">
        {linked && (
          <LinkIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-green-500 shrink-0" />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Nom de l'exercice"
          className={`w-full border border-gray-200 rounded-xl py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${linked ? 'pl-8 pr-3' : 'px-3'}`}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-50 left-0 mt-1 min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
          {matches.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelectExercice(ex); setOpen(false) }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 transition"
            >
              {ex.image_exercice ? (
                <img src={ex.image_exercice} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-gray-100" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 leading-snug break-words">{ex.nom_exercice}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-400">{normalizePartieCorps(ex.partie_prioritaire)}</span>
                  {Array.isArray(ex.Muscles) && ex.Muscles.slice(0, 2).map((m) => (
                    <span key={m} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{m}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Éditeur de circuits/exercices réutilisable (contenu d'une séance ou template).
export default function CircuitsEditor({
  circuits, setCircuits, exercices,
}: {
  circuits: Circuit[]
  setCircuits: Dispatch<SetStateAction<Circuit[]>>
  exercices: Exercice[]
}) {
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set())

  // À l'ouverture, déplie les exercices qui ont déjà des options renseignées.
  useEffect(() => {
    const expanded = new Set<string>()
    for (const c of circuits) {
      for (const ex of c.exercises) {
        if (ex.options || ex.optionHausse || ex.variant) expanded.add(ex.id)
      }
    }
    setExpandedExercises((prev) => {
      const next = new Set(prev)
      expanded.forEach((id) => next.add(id))
      return next
    })
    // On ne veut déplier qu'au montage / changement de jeu de circuits chargé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalSeconds = useMemo(() => circuits.reduce((s, c) => s + calcCircuitSeconds(c), 0), [circuits])

  // ── Circuit helpers ────────────────────────────────────────────
  const addCircuit = () => setCircuits((prev) => [...prev, emptyCircuit(prev.length + 1)])

  const removeCircuit = (cid: string) => setCircuits((prev) => prev.filter((c) => c.id !== cid))

  const updateCircuit = (cid: string, field: keyof Omit<Circuit, 'id' | 'exercises'>, value: any) =>
    setCircuits((prev) => prev.map((c) => c.id === cid ? { ...c, [field]: value } : c))

  const moveCircuit = (cid: string, dir: 'up' | 'down') => {
    setCircuits((prev) => {
      const idx = prev.findIndex((c) => c.id === cid)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const arr = [...prev]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
      return arr
    })
  }

  // ── Exercise helpers ───────────────────────────────────────────
  const addExercise = (cid: string) =>
    setCircuits((prev) => prev.map((c) => c.id === cid
      ? { ...c, exercises: [...c.exercises, emptyExercise()] }
      : c))

  const removeExercise = (cid: string, eid: string) =>
    setCircuits((prev) => prev.map((c) => c.id === cid
      ? { ...c, exercises: c.exercises.filter((ex) => ex.id !== eid) }
      : c))

  const updateExercise = (cid: string, eid: string, field: keyof Omit<Exercise, 'id'>, value: any) =>
    setCircuits((prev) => prev.map((c) => c.id === cid
      ? { ...c, exercises: c.exercises.map((ex) => ex.id === eid ? { ...ex, [field]: value } : ex) }
      : c))

  const moveExercise = (cid: string, eid: string, dir: 'up' | 'down') => {
    setCircuits((prev) => prev.map((c) => {
      if (c.id !== cid) return c
      const idx = c.exercises.findIndex((ex) => ex.id === eid)
      if (dir === 'up' && idx === 0) return c
      if (dir === 'down' && idx === c.exercises.length - 1) return c
      const arr = [...c.exercises]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
      return { ...c, exercises: arr }
    }))
  }

  return (
    <div className="space-y-5">
      {/* Circuits */}
      {circuits.map((circuit, ci) => {
        const circuitSec = calcCircuitSeconds(circuit)
        return (
          <div key={circuit.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            {/* Circuit header */}
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-100 px-5 py-4 rounded-t-2xl">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Move up/down */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => moveCircuit(circuit.id, 'up')} disabled={ci === 0}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition">
                    <ChevronUpIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => moveCircuit(circuit.id, 'down')} disabled={ci === circuits.length - 1}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition">
                    <ChevronDownIcon className="w-4 h-4" />
                  </button>
                </div>
                {/* Nom */}
                <input
                  type="text"
                  value={circuit.name}
                  onChange={(e) => updateCircuit(circuit.id, 'name', e.target.value)}
                  placeholder="Nom du circuit"
                  className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-purple-400 min-w-0"
                />
                {/* Temps circuit */}
                <span className="flex items-center gap-1 text-xs font-semibold text-purple-600 bg-white border border-purple-200 px-2.5 py-1.5 rounded-lg shrink-0">
                  <ClockIcon className="w-3.5 h-3.5" />{formatSeconds(circuitSec)}
                </span>
                {/* Supprimer circuit */}
                <button onClick={() => removeCircuit(circuit.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition shrink-0">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Paramètres circuit */}
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {/* Type selector */}
                <div className="flex rounded-lg overflow-hidden border border-gray-200 shrink-0">
                  {(['standard', 'amrap'] as const).map((t) => (
                    <button key={t} type="button"
                      onClick={() => updateCircuit(circuit.id, 'type', t)}
                      className={`px-2.5 py-1 text-xs font-semibold transition ${(circuit.type ?? 'standard') === t ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                      {t === 'standard' ? 'Standard' : 'AMRAP'}
                    </button>
                  ))}
                </div>
                {circuit.type === 'amrap' ? (
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="font-medium shrink-0 text-orange-600">Durée totale</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} value={Math.floor((circuit.dureeAmrap ?? 0) / 60)}
                        onChange={(e) => updateCircuit(circuit.id, 'dureeAmrap', Math.max(0, parseInt(e.target.value) || 0) * 60)}
                        className="w-16 border border-orange-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400" />
                      <span className="text-xs text-gray-400">min</span>
                    </div>
                  </label>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="font-medium shrink-0">Nb tours</span>
                      <input type="number" min={1} value={circuit.nbTours}
                        onChange={(e) => updateCircuit(circuit.id, 'nbTours', Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="font-medium shrink-0">Récup entre tours</span>
                      <div className="flex items-center gap-1">
                        <input type="number" min={0} value={circuit.recupEntreTours}
                          onChange={(e) => updateCircuit(circuit.id, 'recupEntreTours', Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400" />
                        <span className="text-xs text-gray-400">s</span>
                      </div>
                    </label>
                    <span className="text-xs text-gray-400 shrink-0">
                      ({circuit.nbTours} tour{circuit.nbTours > 1 ? 's' : ''} × {formatSeconds(circuit.exercises.reduce((s, ex) => s + ex.tempsEffort + ex.recupEntreExos, 0))}{circuit.nbTours > 1 ? ` + ${circuit.nbTours - 1}×${formatSeconds(circuit.recupEntreTours)} récup` : ''})
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Exercices */}
            <div className="divide-y divide-gray-50">
              {circuit.exercises.map((ex, ei) => {
                const isExpanded = expandedExercises.has(ex.id) || !!(ex.options || ex.optionHausse || ex.variant)
                const toggleExpand = () => setExpandedExercises((prev) => {
                  const next = new Set(prev)
                  if (next.has(ex.id)) next.delete(ex.id)
                  else next.add(ex.id)
                  return next
                })
                return (
                  <div key={ex.id} className="px-5 py-3 space-y-2">
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
                      {/* Move up/down */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveExercise(circuit.id, ex.id, 'up')} disabled={ei === 0}
                          className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 transition">
                          <ChevronUpIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveExercise(circuit.id, ex.id, 'down')} disabled={ei === circuit.exercises.length - 1}
                          className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 transition">
                          <ChevronDownIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Numéro */}
                      <span className="text-xs font-bold text-gray-400 w-4 shrink-0">{ei + 1}</span>
                      {/* Nom exercice avec suggestions */}
                      <ExerciseNameInput
                        value={ex.name}
                        linked={!!ex.exerciceRefId}
                        exercices={exercices}
                        onChange={(v) => {
                          setCircuits((prev) => prev.map((c) => c.id === circuit.id
                            ? { ...c, exercises: c.exercises.map((x) => x.id === ex.id ? { ...x, name: v, exerciceRefId: undefined } : x) }
                            : c))
                        }}
                        onSelectExercice={(picked) => {
                          setCircuits((prev) => prev.map((c) => c.id === circuit.id
                            ? { ...c, exercises: c.exercises.map((x) => x.id === ex.id ? { ...x, name: picked.nom_exercice, exerciceRefId: picked.id } : x) }
                            : c))
                        }}
                      />
                      {/* Paramètres : passent sous le nom sur mobile (w-full), en ligne sur desktop */}
                      <div className={`flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto pl-9 sm:pl-0 mt-1 sm:mt-0 ${circuit.type === 'amrap' ? 'sm:flex-1' : ''}`}>
                        {circuit.type === 'amrap' ? (
                          /* AMRAP : champ reps texte libre */
                          <input
                            type="text"
                            value={ex.reps ?? ''}
                            onChange={(e) => updateExercise(circuit.id, ex.id, 'reps', e.target.value)}
                            placeholder="Répétitions (ex: 10, variable…)"
                            className="flex-1 border border-orange-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-w-0"
                          />
                        ) : (
                          <>
                            {/* Temps effort */}
                            <label className="flex items-center gap-1.5 text-sm text-gray-600 shrink-0">
                              <span className="text-xs font-medium text-blue-600">Effort</span>
                              <input type="number" min={0} value={ex.tempsEffort}
                                onChange={(e) => updateExercise(circuit.id, ex.id, 'tempsEffort', Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
                              <span className="text-xs text-gray-400">s</span>
                            </label>
                            {/* Récup entre exos */}
                            <label className="flex items-center gap-1.5 text-sm text-gray-600 shrink-0">
                              <span className="text-xs font-medium text-green-600">Récup</span>
                              <input type="number" min={0} value={ex.recupEntreExos}
                                onChange={(e) => updateExercise(circuit.id, ex.id, 'recupEntreExos', Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-400" />
                              <span className="text-xs text-gray-400">s</span>
                            </label>
                            {/* Temps exercice */}
                            <span className="text-xs text-gray-400 shrink-0 w-12 text-right">
                              {ex.tempsEffort + ex.recupEntreExos > 0 ? formatSeconds(ex.tempsEffort + ex.recupEntreExos) : '—'}
                            </span>
                          </>
                        )}
                        {/* Toggle options */}
                        <button onClick={toggleExpand}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-lg border transition shrink-0 ${isExpanded ? 'bg-orange-50 border-orange-200 text-orange-600' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                          Options
                        </button>
                        {/* Supprimer exo */}
                        <button onClick={() => removeExercise(circuit.id, ex.id)}
                          className="p-1 text-gray-300 hover:text-red-400 transition shrink-0 ml-auto sm:ml-0">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="pl-10 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-gray-400 w-24 shrink-0">Option ↓ baisse</span>
                          <input
                            type="text"
                            value={ex.options ?? ''}
                            onChange={(e) => updateExercise(circuit.id, ex.id, 'options', e.target.value || undefined)}
                            placeholder="Version allégée (ex: genoux au sol)"
                            className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-300 placeholder-gray-300"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-blue-400 w-24 shrink-0">Option ↑ hausse</span>
                          <input
                            type="text"
                            value={ex.optionHausse ?? ''}
                            onChange={(e) => updateExercise(circuit.id, ex.id, 'optionHausse', e.target.value || undefined)}
                            placeholder="Version plus difficile (ex: avec charge)"
                            className="flex-1 border border-blue-100 rounded-xl px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder-gray-300"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-orange-400 w-24 shrink-0">Variante</span>
                          <input
                            type="text"
                            value={ex.variant ?? ''}
                            onChange={(e) => updateExercise(circuit.id, ex.id, 'variant', e.target.value || undefined)}
                            placeholder="Si limitation physique (ex: si épaules → ...)"
                            className="flex-1 border border-orange-100 rounded-xl px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-300 placeholder-gray-300"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Ajouter exercice */}
            <div className="px-5 py-3 border-t border-gray-50">
              <button onClick={() => addExercise(circuit.id)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition">
                <PlusIcon className="w-3.5 h-3.5" />
                Ajouter un exercice
              </button>
            </div>
          </div>
        )
      })}

      {/* Ajouter circuit */}
      <button onClick={addCircuit}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50 transition">
        <PlusIcon className="w-4 h-4" />
        Ajouter un circuit
      </button>

      {/* Récap temps global */}
      {circuits.length > 1 && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-purple-800 mb-2">Récapitulatif</p>
          <div className="space-y-1">
            {circuits.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{c.name || `Circuit ${circuits.indexOf(c) + 1}`}</span>
                <span className="font-medium text-purple-700">{formatSeconds(calcCircuitSeconds(c))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-purple-200">
              <span className="text-purple-800">Total estimé</span>
              <span className="text-purple-800">{formatSeconds(totalSeconds)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
