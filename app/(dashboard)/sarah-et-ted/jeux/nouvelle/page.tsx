'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import { NoteAide, LigneAide } from '@/components/ui/NoteAide'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import { depuisChampDate, versChampDate } from '@/lib/duoJeuxDb'
import {
  JEUX_CONNUS, jeuxJoues, joueursConnus, nomSoireePour, nouvelleSoireeId,
  reglagesDuJeu, soireesDe,
} from '@/lib/duoJeux'
import { Timestamp } from 'firebase/firestore'
import { ChevronLeft, Plus, Trash2, Check, Dices, CalendarDays, Target, TrendingDown } from 'lucide-react'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500'
const chipCls = (actif: boolean) =>
  `px-3 py-1.5 rounded-xl text-sm border transition ${
    actif ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
  }`

/** Interrupteur dessiné — jamais une case à cocher au rendu du système. */
function Interrupteur({ actif, onChange, titre, aide, icone: Icone }: {
  actif: boolean
  onChange: (v: boolean) => void
  titre: string
  aide?: string
  icone: typeof Target
}) {
  return (
    <button type="button" role="switch" aria-checked={actif} onClick={() => onChange(!actif)}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        actif ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition ${
        actif ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-400'
      }`}>
        <Icone size={15} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800">{titre}</span>
        {aide && <span className="block text-xs text-gray-500">{aide}</span>}
      </span>
      <span className={`w-10 h-6 rounded-full p-0.5 shrink-0 transition ${actif ? 'bg-rose-500' : 'bg-gray-200'}`}>
        <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${actif ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

/**
 * Création d'une partie — sur sa propre page, comme la nouvelle partie de belote :
 * le formulaire est trop haut pour une modale de téléphone (jeu, joueurs, mode de
 * score, session).
 *
 * `?soiree=<id>` pré-rattache la partie à une session : c'est ce que fait le
 * bouton « Ajouter une partie » depuis la page d'une session.
 */
export default function NouvellePartiePage() {
  const router = useRouter()
  const params = useSearchParams()
  const soireeDemandee = params.get('soiree')

  const { items, ajouter, base, bypass, pret } = useDuoJeux()

  const connus = useMemo(() => joueursConnus(items), [items])
  const dejaJoues = useMemo(() => jeuxJoues(items), [items])
  const soirees = useMemo(() => soireesDe(items), [items])
  const soireeCible = soirees.find((s) => s.soireeId === soireeDemandee) ?? null

  const [jeu, setJeu] = useState('')
  const [date, setDate] = useState(versChampDate(new Date()))
  const [joueurs, setJoueurs] = useState<string[]>([''])
  const [sansPoints, setSansPoints] = useState(false)
  const [scoreBasGagne, setScoreBasGagne] = useState(false)
  const [objectif, setObjectif] = useState('')
  const [infos, setInfos] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * Rattachement : `''` = partie isolée, `'nouvelle'` = créer une session,
   * sinon l'identifiant d'une session existante.
   */
  const [soiree, setSoiree] = useState<string>(soireeDemandee ?? '')
  const [nomSoiree, setNomSoiree] = useState('')

  /** Une pastille de jeu connu pré-règle le sens du classement. */
  const choisirJeu = (nom: string) => {
    setJeu(nom)
    const r = reglagesDuJeu(nom)
    setScoreBasGagne(r.scoreBasGagne)
    setSansPoints(r.sansPoints)
  }

  const basculerJoueur = (j: string) => {
    setJoueurs((liste) => {
      if (liste.some((x) => x.trim() === j)) return liste.filter((x) => x.trim() !== j)
      // On remplit la première ligne vide plutôt que d'en empiler une nouvelle.
      const vide = liste.findIndex((x) => !x.trim())
      return vide >= 0 ? liste.map((x, i) => (i === vide ? j : x)) : [...liste, j]
    })
  }

  /** Nom proposé pour une nouvelle session : celui de la date saisie. */
  const nomParDefaut = () => nomSoireePour(depuisChampDate(date)?.toDate() ?? new Date())

  const propres = joueurs.map((j) => j.trim()).filter(Boolean)
  const valide = pret && !!jeu.trim() && propres.length >= 2 && new Set(propres).size === propres.length

  const creer = async () => {
    if (!base || !valide) return
    setBusy(true)
    try {
      const cible = Math.round(Number(objectif)) || 0
      const lien = soiree === 'nouvelle'
        ? { soireeId: nouvelleSoireeId(), soireeName: nomSoiree.trim() || nomParDefaut() }
        : soiree
          ? { soireeId: soiree, soireeName: soirees.find((s) => s.soireeId === soiree)?.nom ?? 'Session de jeux' }
          : { soireeId: null, soireeName: null }

      const id = await ajouter({
        ...base,
        jeu: jeu.trim(),
        date: depuisChampDate(date) ?? Timestamp.now(),
        joueurs: propres,
        tours: [],
        ordre: [],
        sansPoints,
        scoreBasGagne: sansPoints ? false : scoreBasGagne,
        objectif: sansPoints || cible <= 0 ? null : cible,
        infos: infos.trim(),
        termine: false,
        ...lien,
      })
      router.replace(`/sarah-et-ted/jeux/${id}`)
    } finally { setBusy(false) }
  }

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-5">
        <div className="min-w-0">
          <button onClick={() => router.back()}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition mb-1">
            <ChevronLeft size={14} />Retour
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Nouvelle partie</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {soireeCible ? `Elle rejoindra « ${soireeCible.nom} ».` : 'Le jeu, les joueurs, et c’est parti.'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Colonne gauche : l'essentiel */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Jeu</label>
                <input value={jeu} onChange={(e) => setJeu(e.target.value)} autoFocus
                  placeholder="Uno, SkyJo…" className={champCls} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[...new Set([...dejaJoues, ...JEUX_CONNUS.map((j) => j.nom)])].map((nom) => (
                    <button key={nom} type="button" onClick={() => choisirJeu(nom)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                        jeu === nom ? 'bg-rose-600 text-white border-rose-600'
                          : 'border-gray-200 text-gray-600 hover:border-rose-300'
                      }`}>
                      {nom}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champCls} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Joueurs <span className="text-gray-400 font-normal">(2 minimum)</span>
                </label>
                {connus.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {connus.map((j) => {
                      const present = joueurs.some((x) => x.trim() === j)
                      return (
                        <button key={j} type="button" onClick={() => basculerJoueur(j)}
                          className={`${chipCls(present)} inline-flex items-center gap-1`}>
                          {present && <Check size={13} />}{j}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  {joueurs.map((j, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={j} placeholder={`Joueur ${i + 1}`}
                        onChange={(e) => setJoueurs((l) => l.map((x, k) => (k === i ? e.target.value : x)))}
                        className={champCls} />
                      {joueurs.length > 1 && (
                        <button type="button" aria-label={`Retirer le joueur ${i + 1}`}
                          onClick={() => setJoueurs((l) => l.filter((_, k) => k !== i))}
                          className="px-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition shrink-0">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setJoueurs((l) => [...l, ''])}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 transition">
                  <Plus size={14} />Ajouter un joueur
                </button>
                {propres.length !== new Set(propres).size && (
                  <p className="text-xs text-amber-600 mt-2">
                    Deux joueurs portent le même nom — ajoutez une initiale pour les distinguer.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Colonne droite : la façon de compter */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <p className="text-sm font-medium text-gray-700">Comment on compte</p>

              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setSansPoints(false)} className={chipCls(!sansPoints)}>
                  Avec des points
                </button>
                <button type="button" onClick={() => setSansPoints(true)} className={chipCls(sansPoints)}>
                  Juste le classement
                </button>
              </div>
              <LigneAide>
                {sansPoints
                  ? "Aucun score à saisir : on touche les joueurs dans l'ordre d'arrivée. Idéal pour les jeux sans points, qui comptent quand même dans le classement de la session."
                  : 'Un score par joueur et par tour, additionné automatiquement.'}
              </LigneAide>

              {!sansPoints && (
                <>
                  <Interrupteur actif={scoreBasGagne} onChange={setScoreBasGagne} icone={TrendingDown}
                    titre="Le plus petit score gagne"
                    aide="SkyJo, 6 qui prend, Rami… sans ça, le classement désigne le perdant." />

                  {/* Le mot change avec le sens du jeu : on court après 500 à
                      l'Uno, on fuit les 100 du SkyJo. */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {scoreBasGagne ? 'Limite de points' : 'Objectif de score'}
                      <span className="text-gray-400 font-normal"> (facultatif)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Target size={16} className="text-gray-300 shrink-0" />
                      <input type="number" inputMode="numeric" min={1} value={objectif}
                        onChange={(e) => setObjectif(e.target.value)}
                        placeholder={scoreBasGagne ? '100' : '500'} className={champCls} />
                    </div>
                    <LigneAide>
                      {scoreBasGagne
                        ? "Dès que quelqu'un touche cette limite, l'app vous propose de terminer la partie — c'est lui qui saute."
                        : "Atteint par n'importe qui, l'app vous propose de terminer la partie. La barre de progression suit l'avancée."}
                    </LigneAide>
                  </div>
                </>
              )}
            </div>

            {/* Session */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <CalendarDays size={15} className="text-gray-400" />Session
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setSoiree('')} className={chipCls(soiree === '')}>
                  Partie isolée
                </button>
                <button type="button"
                  onClick={() => { setSoiree('nouvelle'); if (!nomSoiree) setNomSoiree(nomParDefaut()) }}
                  className={chipCls(soiree === 'nouvelle')}>
                  Nouvelle session
                </button>
                {soirees.slice(0, 4).map((s) => (
                  <button key={s.soireeId} type="button" onClick={() => setSoiree(s.soireeId)}
                    className={chipCls(soiree === s.soireeId)}>
                    {s.nom}
                  </button>
                ))}
              </div>
              {soiree === 'nouvelle' && (
                <input value={nomSoiree} onChange={(e) => setNomSoiree(e.target.value)}
                  placeholder="Nom de la session" className={champCls} />
              )}
              <LigneAide>
                Une session additionne plusieurs parties — même jeu ou non — et désigne un vainqueur
                général. Vous pourrez toujours en rattacher une plus tard.
              </LigneAide>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(facultatif)</span>
              </label>
              <AutoTextarea value={infos} onChange={setInfos} minRows={2}
                placeholder="Chez qui, règles maison, anecdote…" className={champCls} />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => router.back()} disabled={busy}
            className="flex-1 sm:flex-none sm:px-6 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-60 transition">
            Annuler
          </button>
          <button onClick={creer} disabled={!valide || busy}
            className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            <Dices size={16} />{busy ? 'Création…' : 'Commencer la partie'}
          </button>
        </div>

        <NoteAide titre="À quoi sert le partage ?">
          <p>
            Une fois la partie créée, le bouton <strong>Partager</strong> produit un lien et un QR code.
            N&apos;importe qui autour de la table peut l&apos;ouvrir <strong>sans compte</strong> pour suivre
            et saisir les scores.
          </p>
          <p>
            Si la partie appartient à une session, le lien donne accès à <strong>toutes</strong> ses parties
            et au classement général.
          </p>
        </NoteAide>
      </div>
    </StoreGate>
  )
}
