'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import Modal from '@/components/ui/Modal'
import CardsLogo from '@/components/belote/CardsLogo'
import ScoreBoard from '@/components/belote/ScoreBoard'
import RoundHistory from '@/components/belote/RoundHistory'
import RoundForm from '@/components/belote/RoundForm'
import StatsJoueurs from '@/components/belote/StatsJoueurs'
import { useAuth } from '@/context/AuthContext'
import ReglesSelector from '@/components/belote/ReglesSelector'
import { cumulSerie, ecartSerie } from '@/lib/belote/serie'
import { REGLES_DEFAUT } from '@/lib/belote/rules'
import type {
  BeloteEndCondition, BeloteGame, BeloteRegles, BelotePlayer, BeloteRound, RoundInput,
} from '@/lib/belote/types'
import { Copy, Check, QrCode, Share2, UserPlus, Pencil, Plus } from 'lucide-react'

/** Vue publique d'une partie (dates en millis — aucun Timestamp Firestore ici). */
interface PartiePublique {
  id: string
  team1Id: string
  team2Id: string
  team1Name: string
  team2Name: string
  team1Players: BelotePlayer[]
  team2Players: BelotePlayer[]
  endCondition: BeloteEndCondition
  endValue: number
  regles: BeloteRegles
  status: 'in_progress' | 'finished'
  winnerId: string | null
  totalScore: { team1: number; team2: number }
  serieId: string | null
  serieName: string | null
  createdAt: number | null
  finishedAt: number | null
}

type TourPublic = Omit<BeloteRound, 'createdAt'>

/** Les composants de la belote n'utilisent que des champs présents dans la vue publique. */
const asGame = (p: PartiePublique) => p as unknown as BeloteGame
const asRounds = (r: TourPublic[]) => r as unknown as BeloteRound[]

/**
 * Page publique d'une partie de belote, ouverte par lien ou QR — SANS COMPTE.
 *
 * Le porteur du lien voit et modifie la partie (et toutes celles de sa série,
 * revanche comprise), mais ne peut pas en créer de nouvelles : c'est la
 * différence avec l'app, réservée aux comptes.
 */
export default function PartiePubliquePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const { currentUser } = useAuth()

  const [parties, setParties] = useState<PartiePublique[]>([])
  const [gameId, setGameId] = useState<string>('')
  const [rounds, setRounds] = useState<TourPublic[]>([])
  const [pot, setPot] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ok' | 'invalid'>('loading')
  const [erreur, setErreur] = useState('')

  const [tourOuvert, setTourOuvert] = useState<'new' | string | null>(null)
  const [reglagesOuverts, setReglagesOuverts] = useState(false)
  const [partageOuvert, setPartageOuvert] = useState(false)
  const [copie, setCopie] = useState(false)
  const [rejoint, setRejoint] = useState(false)
  const [busy, setBusy] = useState(false)

  const partie = useMemo(() => parties.find((p) => p.id === gameId) ?? null, [parties, gameId])

  const charger = useCallback(async (id?: string) => {
    try {
      const q = id ? `?game=${encodeURIComponent(id)}` : ''
      const res = await fetch(`/api/belote-share/${token}${q}`)
      const data = await res.json()
      if (!res.ok || data.status !== 'ok') { setStatus('invalid'); return }
      setParties(data.parties ?? [])
      setGameId(data.gameId)
      setRounds(data.rounds ?? [])
      setPot(data.pot ?? 0)
      setStatus('ok')
    } catch {
      setStatus((s) => (s === 'loading' ? 'invalid' : s))
    }
  }, [token])

  useEffect(() => { charger() }, [charger])

  // Rafraîchissement doux : plusieurs appareils peuvent saisir la même partie.
  // Suspendu pendant une saisie, sinon le formulaire ouvert serait écrasé.
  useEffect(() => {
    if (status !== 'ok' || tourOuvert !== null || reglagesOuverts) return
    const t = setInterval(() => charger(gameId), 12000)
    return () => clearInterval(t)
  }, [status, gameId, charger, tourOuvert, reglagesOuverts])

  const url = typeof window !== 'undefined' ? window.location.href : ''

  const appel = async (chemin: string, body: Record<string, unknown>) => {
    setBusy(true); setErreur('')
    try {
      const res = await fetch(`/api/belote-share/${token}/${chemin}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, ...body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Une erreur est survenue.')
      if (data.partie) setParties((ps) => ps.map((p) => (p.id === data.partie.id ? data.partie : p)))
      if (data.rounds) setRounds(data.rounds)
      if (typeof data.pot === 'number') setPot(data.pot)
      return data
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Une erreur est survenue.')
      throw e
    } finally { setBusy(false) }
  }

  const enregistrerTour = async (input: RoundInput, meta: { dealer: string; trumpTaker: string }) => {
    const enEdition = tourOuvert && tourOuvert !== 'new' ? tourOuvert : null
    await appel('round', {
      action: enEdition ? 'update' : 'add',
      roundId: enEdition ?? undefined,
      ...input,
      ...meta,
    })
    setTourOuvert(null)
  }

  const supprimerTour = async (roundId: string) => {
    try { await appel('round', { action: 'delete', roundId }) } catch { /* message affiché */ }
  }

  const rejoindre = async () => {
    if (!currentUser) return
    setBusy(true); setErreur('')
    try {
      const idToken = await currentUser.getIdToken()
      const res = await fetch(`/api/belote-share/${token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Rattachement impossible.')
      setRejoint(true)
      router.push(`/belote/${data.gameId}`)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Rattachement impossible.')
    } finally { setBusy(false) }
  }

  const copier = async () => {
    try { await navigator.clipboard.writeText(url); setCopie(true); setTimeout(() => setCopie(false), 2000) }
    catch { setErreur('Copie impossible — sélectionnez le lien à la main.') }
  }

  const partager = async () => {
    try { await navigator.share({ title: 'Partie de belote', text: 'Suis la partie :', url }) }
    catch { /* annulé */ }
  }

  // ── Série : cumul et écart de points entre les parties liées ────────────────
  const lignes = useMemo(
    () => (parties.length > 1 ? cumulSerie(parties.map(asGame)) : []),
    [parties],
  )
  const ecart = useMemo(() => ecartSerie(lignes), [lignes])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'invalid' || !partie) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CardsLogo className="w-14 h-14 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-sm text-gray-500">
            Ce lien de partage n&apos;existe plus. Demandez-en un nouveau à la personne qui vous l&apos;a envoyé.
          </p>
        </div>
      </div>
    )
  }

  const tourEnEdition = tourOuvert && tourOuvert !== 'new' ? rounds.find((r) => r.id === tourOuvert) : undefined

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 py-6 space-y-5 max-w-5xl mx-auto">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <CardsLogo className="w-11 h-11 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-800 truncate">
                {partie.team1Name} <span className="text-gray-300">vs</span> {partie.team2Name}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {partie.serieName ? partie.serieName : 'Partie partagée'} · sans compte
              </p>
            </div>
          </div>
          <button onClick={() => setPartageOuvert(true)}
            className="shrink-0 flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition">
            <QrCode size={15} /> Partager
          </button>
        </div>

        {erreur && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">{erreur}</div>
        )}

        {/* Rattachement à un compte */}
        {currentUser && !rejoint && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-blue-900">
              Vous êtes connecté : rattachez cette partie à votre compte pour la retrouver dans l&apos;app.
            </p>
            <button onClick={rejoindre} disabled={busy}
              className="shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-xl transition">
              <UserPlus size={15} /> Rejoindre
            </button>
          </div>
        )}

        {/* Sélecteur de partie (série) */}
        {parties.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {parties.map((p, i) => (
              <button key={p.id} onClick={() => { setGameId(p.id); charger(p.id) }}
                className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium border transition ${
                  p.id === gameId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                Partie {i + 1}
                <span className={`ml-1.5 tabular-nums ${p.id === gameId ? 'text-blue-100' : 'text-gray-400'}`}>
                  {p.totalScore.team1}·{p.totalScore.team2}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Écart de points sur la série */}
        {ecart && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Sur les {parties.length} parties liées
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{ecart.enTete.name}</p>
                <p className="text-xs text-gray-500">
                  {ecart.enTete.points} pts · {ecart.second.name} {ecart.second.points} pts
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-blue-600 tabular-nums">
                  {ecart.ecart === 0 ? '—' : `+${ecart.ecart}`}
                </p>
                <p className="text-xs text-gray-400">{ecart.ecart === 0 ? 'à égalité' : "d'écart"}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-4">
            <ScoreBoard game={asGame(partie)} rounds={asRounds(rounds)} pot={pot} />

            {partie.status === 'in_progress' ? (
              <button onClick={() => setTourOuvert('new')}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition">
                <Plus size={18} /> Nouveau tour
              </button>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center text-sm font-medium text-green-700">
                Partie terminée
              </div>
            )}

            <button onClick={() => setReglagesOuverts(true)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 py-1.5 transition">
              <Pencil size={14} /> Modifier la fin de partie
            </button>

            <p className="text-xs text-gray-400 text-center">
              Vous pouvez voir et modifier {parties.length > 1 ? 'ces parties' : 'cette partie'}.
              Créer de nouvelles parties demande un compte.
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tours</h2>
              <RoundHistory
                game={asGame(partie)}
                rounds={asRounds(rounds)}
                onEdit={(id) => setTourOuvert(id)}
                onDelete={supprimerTour}
              />
            </div>
            <StatsJoueurs parties={[{ game: asGame(partie), rounds: asRounds(rounds) }]}
              titre="Statistiques de la partie" />
          </div>
        </div>
      </div>

      {/* Saisie d'un tour */}
      <Modal isOpen={tourOuvert !== null} onClose={() => setTourOuvert(null)}
        title={tourEnEdition ? `Modifier le tour ${tourEnEdition.roundNumber}` : 'Nouveau tour'}>
        <RoundForm
          key={tourOuvert ?? 'new'}
          game={asGame(partie)}
          regles={partie.regles ?? REGLES_DEFAUT}
          team1Players={partie.team1Players}
          team2Players={partie.team2Players}
          initial={tourEnEdition ? {
            dealer: tourEnEdition.dealer,
            trumpTaker: tourEnEdition.trumpTaker,
            input: {
              teamTaker: tourEnEdition.teamTaker,
              rawScoreNous: tourEnEdition.rawScoreNous,
              rawScoreEux: tourEnEdition.rawScoreEux,
              capot: tourEnEdition.capot,
              capotTeam: tourEnEdition.capotTeam,
              beloteRebelote: tourEnEdition.beloteRebelote,
              beloteRebeloteTeam: tourEnEdition.beloteRebeloteTeam,
              beloteRebelotePlayer: tourEnEdition.beloteRebelotePlayer ?? '',
              ...(typeof tourEnEdition.dedansForce === 'boolean'
                ? { dedansForce: tourEnEdition.dedansForce } : {}),
            },
          } : undefined}
          submitLabel={tourEnEdition ? 'Enregistrer les modifications' : 'Valider le tour'}
          onSubmit={enregistrerTour}
        />
      </Modal>

      {/* Fin de partie */}
      <ReglagesModal
        isOpen={reglagesOuverts}
        onClose={() => setReglagesOuverts(false)}
        partie={partie}
        busy={busy}
        onSave={async (endCondition, endValue, regles) => {
          await appel('settings', { endCondition, endValue, regles })
          setReglagesOuverts(false)
        }}
      />

      {/* Lien + QR */}
      <Modal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)} title="Partager la partie">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Faites scanner ce QR, ou envoyez le lien : la personne pourra suivre et compléter la partie
            sans créer de compte.
          </p>
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded-2xl border border-gray-200">
              <QRCodeSVG value={url} size={188} level="M" />
            </div>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
            <span className="text-xs text-blue-900 truncate flex-1">{url}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={copier}
              className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
              {copie ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button onClick={partager}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-sm transition">
                <Share2 size={15} />Partager
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Fin de partie (score cible / nombre de tours) — même réglage que dans l'app. */
function ReglagesModal({ isOpen, onClose, partie, busy, onSave }: {
  isOpen: boolean
  onClose: () => void
  partie: PartiePublique
  busy: boolean
  onSave: (endCondition: BeloteEndCondition, endValue: number, regles: BeloteRegles) => Promise<void>
}) {
  const [endCondition, setEndCondition] = useState<BeloteEndCondition>(partie.endCondition)
  const [endValue, setEndValue] = useState(String(partie.endValue))
  const [regles, setRegles] = useState<BeloteRegles>(partie.regles ?? REGLES_DEFAUT)

  useEffect(() => {
    if (isOpen) {
      setEndCondition(partie.endCondition)
      setEndValue(String(partie.endValue))
      setRegles(partie.regles ?? REGLES_DEFAUT)
    }
  }, [isOpen, partie.endCondition, partie.endValue, partie.regles])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Modifier la partie">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Fin de partie</label>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {([['score', 'Par score'], ['rounds', 'Par tours']] as [BeloteEndCondition, string][]).map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setEndCondition(k)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  endCondition === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {endCondition === 'score' ? 'Score cible' : 'Nombre de tours'}
          </label>
          <input type="number" inputMode="numeric" min={1} value={endValue}
            onChange={(e) => setEndValue(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <div className="border-t border-dashed border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Règles de la table</h3>
          <ReglesSelector valeur={regles} onChange={setRegles} avertirRecalcul />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            Annuler
          </button>
          <button onClick={() => onSave(endCondition, Number(endValue) || 1, regles)} disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            Enregistrer
          </button>
        </div>
      </div>
    </Modal>
  )
}
