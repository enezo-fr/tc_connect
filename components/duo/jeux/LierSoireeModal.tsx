'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { LigneAide } from '@/components/ui/NoteAide'
import { delierPartie, lierPartieASoiree } from '@/lib/duoJeuxDb'
import { nomSoireeParDefaut, nouvelleSoireeId, soireesDe } from '@/lib/duoJeux'
import { CalendarDays, Unlink } from 'lucide-react'
import type { DuoPartie } from '@/types'

/**
 * Rattacher une partie à une soirée — ou l'en détacher.
 *
 * Une soirée n'existe que par le `soireeId` recopié sur ses parties : la créer,
 * c'est simplement en poser un nouveau sur la partie courante. Rien à supprimer
 * quand la dernière partie s'en détache.
 */
export default function LierSoireeModal({ isOpen, onClose, partie, toutes }: {
  isOpen: boolean
  onClose: () => void
  partie: DuoPartie
  /** Toutes les parties visibles, pour proposer les soirées existantes. */
  toutes: DuoPartie[]
}) {
  const soirees = useMemo(() => soireesDe(toutes), [toutes])
  const [nom, setNom] = useState('')
  const [busy, setBusy] = useState(false)

  const agir = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); onClose() }
    finally { setBusy(false) }
  }

  const creer = () => agir(() =>
    lierPartieASoiree(partie.id, nouvelleSoireeId(), nom.trim() || nomSoireeParDefaut(partie)))

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rattacher à une soirée">
      <div className="space-y-4">
        <LigneAide>
          Les parties d&apos;une même soirée s&apos;additionnent dans un classement général, même si ce
          sont des jeux différents.
        </LigneAide>

        {partie.soireeId && (
          <div className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
            <p className="text-sm text-rose-900 min-w-0 break-words">
              Rattachée à <strong>{partie.soireeName || 'une soirée'}</strong>
            </p>
            <button onClick={() => agir(() => delierPartie(partie.id))} disabled={busy}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-red-600 border border-gray-200 bg-white px-2.5 py-1.5 rounded-lg transition">
              <Unlink size={13} />Détacher
            </button>
          </div>
        )}

        {soirees.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Soirées existantes</h3>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-hidden">
              {soirees.map((s) => (
                <button key={s.soireeId} disabled={busy || s.soireeId === partie.soireeId}
                  onClick={() => agir(() => lierPartieASoiree(partie.id, s.soireeId, s.nom, s.bareme))}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 break-words flex items-center gap-1.5">
                      <CalendarDays size={13} className="text-gray-300 shrink-0" />{s.nom}
                    </p>
                    <p className="text-xs text-gray-400">
                      {`${s.parties.length} partie${s.parties.length > 1 ? 's' : ''}`}
                      {s.jeux.length > 0 && ` · ${s.jeux.join(', ')}`}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-rose-600 shrink-0">
                    {s.soireeId === partie.soireeId ? 'Actuelle' : 'Rattacher'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nouvelle soirée</h3>
          <div className="flex gap-2">
            <input value={nom} onChange={(e) => setNom(e.target.value)}
              placeholder={nomSoireeParDefaut(partie)}
              className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-400" />
            <button onClick={creer} disabled={busy}
              className="shrink-0 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
              Créer
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
