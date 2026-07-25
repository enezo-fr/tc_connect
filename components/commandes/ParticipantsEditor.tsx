'use client'

import { useState } from 'react'
import { Trash2, Plus, Pencil, Check } from 'lucide-react'

export interface PRow { id: string; name: string }

export const pRowId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const champCls = 'flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

/**
 * Personnes d'une tournée : un champ unique + bouton « + » pour ajouter. Les
 * personnes ajoutées s'affichent en texte (non modifiable par défaut) ; un crayon
 * permet de corriger le prénom, une corbeille de retirer.
 */
export function ParticipantsEditor({ rows, onChange, gensConnus = [] }: {
  rows: PRow[]
  onChange: (rows: PRow[]) => void
  gensConnus?: string[]
}) {
  const [saisie, setSaisie] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const setName = (id: string, name: string) => onChange(rows.map((r) => (r.id === id ? { ...r, name } : r)))
  const retirer = (id: string) => { if (editingId === id) setEditingId(null); onChange(rows.filter((r) => r.id !== id)) }
  const ajouter = (name: string) => {
    const n = name.trim()
    if (!n) return
    setSaisie('')
    if (rows.some((r) => r.name.trim().toLowerCase() === n.toLowerCase())) return
    onChange([...rows, { id: pRowId(), name: n }])
  }

  const pris = new Set(rows.map((r) => r.name.trim().toLowerCase()))
  const suggestions = gensConnus.filter((p) => !pris.has(p.trim().toLowerCase()))

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (editingId === r.id ? (
        <div key={r.id} className="flex items-center gap-2">
          <input autoFocus value={r.name} onChange={(e) => setName(r.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditingId(null) } }}
            onBlur={() => setEditingId(null)} placeholder="Prénom" className={champCls} />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditingId(null)} title="Valider"
            className="p-2 rounded-lg border border-gray-200 text-green-600 hover:bg-green-50 transition shrink-0">
            <Check size={15} />
          </button>
        </div>
      ) : (
        <div key={r.id} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          <span className="flex-1 min-w-0 truncate text-sm text-gray-800">
            {r.name.trim() || <span className="text-gray-400 italic">sans nom</span>}
          </span>
          <button type="button" onClick={() => setEditingId(r.id)} title="Modifier le prénom"
            className="p-1.5 rounded-lg text-gray-400 hover:text-sky-600 hover:bg-sky-50 transition shrink-0">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => retirer(r.id)} title="Retirer"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      )))}

      {/* Champ d'ajout unique + bouton « + » */}
      <div className="flex items-center gap-2">
        <input value={saisie} onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && saisie.trim()) { e.preventDefault(); ajouter(saisie) } }}
          placeholder="Ajouter une personne" className={champCls} />
        <button type="button" onClick={() => ajouter(saisie)} disabled={!saisie.trim()} title="Ajouter"
          className="p-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 transition shrink-0">
          <Plus size={16} />
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {suggestions.map((p) => (
            <button key={p} type="button" onClick={() => ajouter(p)}
              className="px-2.5 py-1 rounded-full text-xs border border-gray-200 text-gray-600 hover:border-sky-300 hover:text-sky-700 transition">
              + {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
