'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { ParticipantsEditor, pRowId, type PRow } from '@/components/commandes/ParticipantsEditor'
import { BarLocationField } from '@/components/commandes/BarLocationField'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

const dateInput = (ms: number | null) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface InfosInitial {
  lieu: string
  /** Millisecondes, ou null. */
  date: number | null
  participants: string[]
  lat?: number | null
  lng?: number | null
}

export interface InfosResult {
  lieu: string
  date: number | null
  participants: string[]
  /** Ancien prénom → nouveau (pour reporter le `pour` des boissons). */
  renames: Record<string, string>
  /** Personnes retirées (leurs boissons repassent sur « La table »). */
  removed: string[]
  /** Position du bar (présente seulement si `avecPosition`). */
  lat?: number | null
  lng?: number | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  initial: InfosInitial
  gensConnus?: string[]
  /** Affiche la carte de position du bar (in-app uniquement). */
  avecPosition?: boolean
  onSave: (r: InfosResult) => void | Promise<void>
}

/** Édite les infos d'une tournée (lieu, date, personnes) — partagé in-app / page publique. */
export function InfosCommandeModal({ isOpen, onClose, initial, gensConnus = [], avecPosition = false, onSave }: Props) {
  const [lieu, setLieu] = useState('')
  const [date, setDate] = useState('')
  const [rows, setRows] = useState<PRow[]>([])
  // Nom d'origine par id de ligne, pour détecter renommages et suppressions.
  const [origine, setOrigine] = useState<Record<string, string>>({})
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLieu(initial.lieu ?? '')
    setDate(dateInput(initial.date))
    const seed = (initial.participants ?? []).map((name) => ({ id: pRowId(), name }))
    setRows(seed)
    setOrigine(Object.fromEntries(seed.map((r) => [r.id, r.name])))
    setPos(initial.lat != null && initial.lng != null ? { lat: initial.lat, lng: initial.lng } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const enregistrer = async () => {
    setSaving(true)
    try {
      let ms: number | null = null
      if (date) { const [y, m, j] = date.split('-').map(Number); ms = new Date(y, m - 1, j, 20).getTime() }

      const finalNames = new Map<string, string>() // id → nom nettoyé (non vide)
      for (const r of rows) { const n = r.name.trim(); if (n) finalNames.set(r.id, n) }

      const renames: Record<string, string> = {}
      const removed: string[] = []
      for (const [id, oldName] of Object.entries(origine)) {
        const newName = finalNames.get(id)
        if (!newName) removed.push(oldName)
        else if (newName !== oldName) renames[oldName] = newName
      }

      const participants = Array.from(new Set([...finalNames.values()]))
      await onSave({
        lieu: lieu.trim(), date: ms, participants, renames, removed,
        ...(avecPosition ? { lat: pos?.lat ?? null, lng: pos?.lng ?? null } : {}),
      })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Modifier la tournée">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bar / lieu</label>
            <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Le Baluchon" className={champCls} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champCls} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Qui est là ?</label>
          <ParticipantsEditor rows={rows} onChange={setRows} gensConnus={gensConnus} />
        </div>

        {avecPosition && (
          <BarLocationField lat={pos?.lat ?? null} lng={pos?.lng ?? null}
            onChange={(lat, lng) => setPos({ lat, lng })} />
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
          <button onClick={enregistrer} disabled={saving}
            className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
