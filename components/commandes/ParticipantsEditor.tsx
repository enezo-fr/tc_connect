'use client'

import { Trash2, Plus } from 'lucide-react'

export interface PRow { id: string; name: string }

export const pRowId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const champCls = 'flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

/**
 * Liste éditable des personnes d'une tournée : une ligne = un champ prénom
 * (modifiable) + une corbeille. Remplace les pastilles, plus propres à saisir.
 */
export function ParticipantsEditor({ rows, onChange, gensConnus = [] }: {
  rows: PRow[]
  onChange: (rows: PRow[]) => void
  gensConnus?: string[]
}) {
  const setName = (id: string, name: string) => onChange(rows.map((r) => (r.id === id ? { ...r, name } : r)))
  const retirer = (id: string) => onChange(rows.filter((r) => r.id !== id))
  const ajouter = (name = '') => onChange([...rows, { id: pRowId(), name }])

  const pris = new Set(rows.map((r) => r.name.trim().toLowerCase()))
  const suggestions = gensConnus.filter((p) => !pris.has(p.trim().toLowerCase()))

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <input value={r.name} onChange={(e) => setName(r.id, e.target.value)} placeholder="Prénom" className={champCls} />
          <button type="button" onClick={() => retirer(r.id)} title="Retirer"
            className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 hover:bg-red-50 transition shrink-0">
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <button type="button" onClick={() => ajouter('')}
        className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl py-2 text-sm text-gray-400 hover:border-sky-300 hover:text-sky-600 transition">
        <Plus size={15} />Ajouter une personne
      </button>

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
