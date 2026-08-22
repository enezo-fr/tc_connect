'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { LigneAide } from '@/components/ui/NoteAide'
import { depuisChampDate, versChampDate } from '@/lib/duoJeuxDb'
import { secondesPartie, totalJoueur } from '@/lib/duoJeux'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import type { DuoPartie } from '@/types'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500'
const chipCls = (actif: boolean) =>
  `px-3 py-1.5 rounded-xl text-sm border transition ${
    actif ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
  }`

/**
 * Réglages d'une partie déjà créée : le jeu, la date, la façon de compter, les
 * joueurs, les notes.
 *
 * Retirer un joueur ici n'efface rien tant qu'on n'enregistre pas — d'où
 * l'avertissement en clair plutôt qu'une modale de confirmation : deux modales
 * empilées se disputent le verrou de défilement de la page.
 */
export default function ModifierPartieModal({ partie, onClose, onEnregistrer }: {
  partie: DuoPartie
  onClose: () => void
  onEnregistrer: (patch: Record<string, unknown>) => Promise<void> | void
}) {
  const [jeu, setJeu] = useState(partie.jeu)
  const [date, setDate] = useState(versChampDate(new Date((secondesPartie(partie) || Date.now() / 1000) * 1000)))
  const [joueurs, setJoueurs] = useState<string[]>(partie.joueurs ?? [])
  const [nouveau, setNouveau] = useState('')
  const [sansPoints, setSansPoints] = useState(!!partie.sansPoints)
  const [scoreBasGagne, setScoreBasGagne] = useState(!!partie.scoreBasGagne)
  const [objectif, setObjectif] = useState(partie.objectif ? String(partie.objectif) : '')
  const [infos, setInfos] = useState(partie.infos ?? '')
  const [busy, setBusy] = useState(false)

  const retires = (partie.joueurs ?? []).filter((j) => !joueurs.includes(j))
  const retiresAvecScore = retires.filter((j) => totalJoueur(partie, j) !== 0)
  const valide = !!jeu.trim() && joueurs.length >= 2

  const ajouterJoueur = () => {
    const v = nouveau.trim()
    if (!v || joueurs.some((j) => j.toLowerCase() === v.toLowerCase())) return
    setJoueurs((l) => [...l, v])
    setNouveau('')
  }

  const enregistrer = async () => {
    if (!valide) return
    setBusy(true)
    try {
      const cible = Math.round(Number(objectif)) || 0
      // Les joueurs retirés disparaissent aussi des tours et de l'ordre d'arrivée,
      // sinon leurs points continueraient de vivre dans le document.
      const tours = (partie.tours ?? []).map((t) => ({
        ...t,
        scores: (t.scores ?? []).filter((s) => joueurs.includes(s.joueur)),
      }))
      await onEnregistrer({
        jeu: jeu.trim(),
        date: depuisChampDate(date) ?? partie.date ?? null,
        joueurs,
        tours,
        ordre: (partie.ordre ?? []).filter((j) => joueurs.includes(j)),
        sansPoints,
        scoreBasGagne: sansPoints ? false : scoreBasGagne,
        objectif: sansPoints || cible <= 0 ? null : cible,
        infos: infos.trim(),
      })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title="Modifier la partie">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Jeu</label>
          <input value={jeu} onChange={(e) => setJeu(e.target.value)} className={champCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Joueurs</label>
          <div className="space-y-1.5">
            {joueurs.map((j) => (
              <div key={j} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className="flex-1 min-w-0 text-sm text-gray-800 break-words">{j}</span>
                {!partie.sansPoints && (
                  <span className="text-xs text-gray-400 tabular-nums shrink-0">{totalJoueur(partie, j)}</span>
                )}
                {joueurs.length > 2 && (
                  <button type="button" aria-label={`Retirer ${j}`}
                    onClick={() => setJoueurs((l) => l.filter((x) => x !== j))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition shrink-0">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input value={nouveau} onChange={(e) => setNouveau(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterJoueur() } }}
              placeholder="Ajouter un joueur" className={champCls} />
            <button type="button" onClick={ajouterJoueur} disabled={!nouveau.trim()}
              className="shrink-0 flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 px-3 rounded-lg text-sm transition">
              <Plus size={15} />Ajouter
            </button>
          </div>
          {retires.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                {`À l'enregistrement, ${retires.join(', ')} ${retires.length > 1 ? 'quittent' : 'quitte'} la partie`}
                {retiresAvecScore.length > 0 && ' et leurs points seront effacés'}.
              </span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Comment on compte</label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSansPoints(false)} className={chipCls(!sansPoints)}>
              Avec des points
            </button>
            <button type="button" onClick={() => setSansPoints(true)} className={chipCls(sansPoints)}>
              Juste le classement
            </button>
          </div>
          {sansPoints && (partie.tours?.length ?? 0) > 0 && (
            <LigneAide>
              Les tours déjà saisis sont conservés, mais ils ne compteront plus : c&apos;est l&apos;ordre
              d&apos;arrivée qui départage.
            </LigneAide>
          )}
        </div>

        {!sansPoints && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setScoreBasGagne(false)} className={chipCls(!scoreBasGagne)}>
                Le plus grand score gagne
              </button>
              <button type="button" onClick={() => setScoreBasGagne(true)} className={chipCls(scoreBasGagne)}>
                Le plus petit gagne
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Objectif de score <span className="text-gray-400 font-normal">(facultatif)</span>
              </label>
              <input type="number" inputMode="numeric" min={1} value={objectif}
                onChange={(e) => setObjectif(e.target.value)} placeholder="500" className={champCls} />
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <AutoTextarea value={infos} onChange={setInfos} minRows={2} className={champCls}
            placeholder="Chez qui, règles maison, anecdote…" />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-60 transition">
            Annuler
          </button>
          <button onClick={enregistrer} disabled={!valide || busy}
            className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
