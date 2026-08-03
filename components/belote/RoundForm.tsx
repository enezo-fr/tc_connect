'use client'

import { useMemo, useState } from 'react'
import { calculerTour, validateRoundPoints, BELOTE_TOTAL, REGLES_DEFAUT } from '@/lib/belote/rules'
import type { BeloteGame, BeloteRegles, BelotePlayer, RoundInput, TeamSlot } from '@/lib/belote/types'

interface Props {
  game: BeloteGame
  team1Players: BelotePlayer[]
  team2Players: BelotePlayer[]
  /** Règles de la partie — elles décident du contrat et du sort d'une égalité. */
  regles?: BeloteRegles
  onSubmit: (input: RoundInput, meta: { dealer: string; trumpTaker: string }) => Promise<void>
  initial?: { input: RoundInput; dealer: string; trumpTaker: string }   // mode édition
  submitLabel?: string
}

interface PlayerOption { name: string; team: TeamSlot }

/** Sélecteur direct Non / Nous (team1) / Eux (team2) */
function TriSelect({ value, onChange }: { value: TeamSlot | null; onChange: (v: TeamSlot | null) => void }) {
  const opts: [TeamSlot | null, string][] = [[null, 'Non'], ['team1', 'Nous'], ['team2', 'Eux']]
  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
      {opts.map(([v, label]) => {
        const active = value === v
        return (
          <button key={label} type="button" onClick={() => onChange(v)}
            className={`flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition ${
              active ? (v === null ? 'bg-white text-gray-700 shadow' : 'bg-blue-600 text-white shadow') : 'text-gray-500'
            }`}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

export default function RoundForm({
  game, team1Players, team2Players, regles = REGLES_DEFAUT, onSubmit, initial, submitLabel,
}: Props) {
  const players = useMemo<PlayerOption[]>(() => [
    ...team1Players.map(p => ({ name: `${p.firstName} ${p.lastName}`.trim(), team: 'team1' as TeamSlot })),
    ...team2Players.map(p => ({ name: `${p.firstName} ${p.lastName}`.trim(), team: 'team2' as TeamSlot })),
  ], [team1Players, team2Players])

  const [dealer, setDealer] = useState(initial?.dealer ?? '')
  const [dealerOpen, setDealerOpen] = useState(!initial?.dealer)
  const [trumpTaker, setTrumpTaker] = useState(initial?.trumpTaker ?? '')
  const [takerOpen, setTakerOpen] = useState(!initial?.trumpTaker)
  const [rawNous, setRawNous] = useState(initial ? String(initial.input.rawScoreNous) : '')   // team1
  const [rawEux, setRawEux] = useState(initial ? String(initial.input.rawScoreEux) : '')       // team2
  const [capotSel, setCapotSel] = useState<TeamSlot | null>(initial?.input.capot ? initial.input.capotTeam : null)
  const [beloteSel, setBeloteSel] = useState<TeamSlot | null>(initial?.input.beloteRebelote ? initial.input.beloteRebeloteTeam : null)
  const [beloteJoueur, setBeloteJoueur] = useState(initial?.input.beloteRebelotePlayer ?? '')
  const [force, setForce] = useState<boolean | undefined>(initial?.input.dedansForce)
  const [correction, setCorrection] = useState(initial?.input.dedansForce !== undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // L'équipe preneuse découle du preneur d'atout : c'est lui qui porte le contrat.
  const teamTaker: TeamSlot = players.find(p => p.name === trumpTaker)?.team ?? 'team1'

  const input: RoundInput = {
    teamTaker,
    rawScoreNous: Number(rawNous) || 0,
    rawScoreEux: Number(rawEux) || 0,
    capot: capotSel !== null,
    capotTeam: capotSel,
    beloteRebelote: beloteSel !== null,
    beloteRebeloteTeam: beloteSel,
    // Le joueur ne vaut que si l'annonce existe et qu'il est bien de cette équipe.
    beloteRebelotePlayer: beloteSel && players.find(p => p.name === beloteJoueur)?.team === beloteSel
      ? beloteJoueur : '',
    ...(force !== undefined ? { dedansForce: force } : {}),
  }

  const resultat = calculerTour(input, regles)
  const showRawInputs = capotSel === null
  const pointsSaisis = showRawInputs && (rawNous !== '' || rawEux !== '')
  const sommeOk = validateRoundPoints(Number(rawNous) || 0, Number(rawEux) || 0)
  const nomEquipe = (t: TeamSlot) => (t === 'team1' ? game.team1Name : game.team2Name)

  const onChangeNous = (v: string) => {
    setRawNous(v)
    if (v !== '') setRawEux(String(Math.max(0, BELOTE_TOTAL - (Number(v) || 0))))
  }
  const onChangeEux = (v: string) => {
    setRawEux(v)
    if (v !== '') setRawNous(String(Math.max(0, BELOTE_TOTAL - (Number(v) || 0))))
  }

  const handleSubmit = async () => {
    setError('')
    // Distributeur facultatif (souvent oublié pendant la partie)
    if (!trumpTaker) return setError("Sélectionnez le preneur d'atout.")
    // Un verdict imposé se passe du compte exact : la donne entière change de main.
    if (showRawInputs && force === undefined && !sommeOk) {
      return setError(`La somme des points doit faire ${BELOTE_TOTAL} (actuel : ${(Number(rawNous) || 0) + (Number(rawEux) || 0)}).`)
    }
    setSaving(true)
    try {
      await onSubmit(input, { dealer, trumpTaker })
    } catch {
      setError("Erreur lors de l'enregistrement du tour.")
      setSaving(false)
    }
  }

  const chip = (active: boolean) =>
    `px-3 py-2 rounded-lg text-sm border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`

  // ── Verdict affiché ────────────────────────────────────────────────────────
  const verdict = (() => {
    if (!trumpTaker) return null
    if (resultat.issue === 'capot') {
      return capotSel === teamTaker
        ? { ton: 'ok' as const, titre: 'Capot du preneur', detail: `${nomEquipe(teamTaker)} rafle tous les plis.` }
        : { ton: 'ko' as const, titre: 'Capot encaissé', detail: `${nomEquipe(teamTaker)} a pris et perd tous les plis.` }
    }
    if (!pointsSaisis && force === undefined) return null
    if (resultat.issue === 'litige') {
      return {
        ton: 'attente' as const,
        titre: 'Litige',
        detail: `Égalité : ${resultat.potAjoute} points partent en attente et reviendront à qui gagne la donne suivante.`,
      }
    }
    if (resultat.dedans) {
      return {
        ton: 'ko' as const,
        titre: 'Dedans',
        detail: `${nomEquipe(teamTaker)} a pris et chute — il fallait ${resultat.seuil} points aux cartes.`,
      }
    }
    return {
      ton: 'ok' as const,
      titre: 'Contrat tenu',
      detail: `${nomEquipe(teamTaker)} a pris et tient son contrat (${resultat.seuil} requis).`,
    }
  })()

  const tons = {
    ok: 'bg-green-50 border-green-200 text-green-800',
    ko: 'bg-red-50 border-red-200 text-red-700',
    attente: 'bg-amber-50 border-amber-200 text-amber-800',
  }

  return (
    <div className="space-y-4">
      {/* Légende Nous / Eux */}
      <p className="text-xs text-gray-400">
        <span className="font-medium text-gray-600">Nous</span> = {game.team1Name} ·{' '}
        <span className="font-medium text-gray-600">Eux</span> = {game.team2Name}
      </p>

      {/* Distributeur (facultatif) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Distributeur <span className="font-normal text-gray-400">(facultatif)</span></label>
        {dealerOpen ? (
          <div className="flex flex-wrap gap-2 items-center">
            {players.map(p => (
              <button key={p.name} type="button" onClick={() => { setDealer(p.name); setDealerOpen(false) }} className={chip(dealer === p.name)}>
                {p.name}
              </button>
            ))}
            <button type="button" onClick={() => { setDealer(''); setDealerOpen(false) }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2 transition">Passer</button>
          </div>
        ) : (
          <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm font-medium text-gray-800">{dealer || <span className="text-gray-400 font-normal">Non renseigné</span>}</span>
            <button type="button" onClick={() => setDealerOpen(true)} className="text-xs text-blue-600 hover:underline">Modifier</button>
          </div>
        )}
      </div>

      {/* Preneur d'atout */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Preneur d&apos;atout</label>
        {takerOpen ? (
          <div className="flex flex-wrap gap-2">
            {players.map(p => (
              <button key={p.name} type="button" onClick={() => { setTrumpTaker(p.name); setTakerOpen(false) }} className={chip(trumpTaker === p.name)}>
                {p.name}
                <span className="text-xs opacity-60 ml-1">{p.team === 'team1' ? '(Nous)' : '(Eux)'}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm font-medium text-gray-800">
              {trumpTaker} <span className="text-xs text-gray-400">· {nomEquipe(teamTaker)}</span>
            </span>
            <button type="button" onClick={() => setTakerOpen(true)} className="text-xs text-blue-600 hover:underline">Modifier</button>
          </div>
        )}
      </div>

      {/* Événements */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Capot <span className="font-normal text-gray-400">(tous les plis)</span></label>
          <TriSelect value={capotSel} onChange={setCapotSel} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Belote &amp; rebelote <span className="font-normal text-gray-400">(+20)</span></label>
          <TriSelect value={beloteSel} onChange={(v) => { setBeloteSel(v); setBeloteJoueur('') }} />

          {/* Qui l'a annoncée : facultatif, mais c'est ce qui la compte au joueur */}
          {beloteSel && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1.5">
                Qui l&apos;a annoncée ? <span className="text-gray-400">(facultatif)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {players.filter(p => p.team === beloteSel).map(p => (
                  <button key={p.name} type="button"
                    onClick={() => setBeloteJoueur(beloteJoueur === p.name ? '' : p.name)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                      beloteJoueur === p.name
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-gray-200 text-gray-700 hover:border-amber-300'
                    }`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saisie brute */}
      {showRawInputs && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 truncate">Nous <span className="text-gray-400 font-normal">· {game.team1Name}</span></label>
            <input type="number" inputMode="numeric" min={0} max={BELOTE_TOTAL} value={rawNous}
              onChange={e => onChangeNous(e.target.value)} placeholder="0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-center outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 truncate">Eux <span className="text-gray-400 font-normal">· {game.team2Name}</span></label>
            <input type="number" inputMode="numeric" min={0} max={BELOTE_TOTAL} value={rawEux}
              onChange={e => onChangeEux(e.target.value)} placeholder="0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-center outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
      )}

      {/* Verdict calculé d'après les règles de la partie */}
      {verdict && (
        <div className={`rounded-xl border px-4 py-3 ${tons[verdict.ton]}`}>
          <p className="text-sm font-semibold">
            {verdict.titre}
            {force !== undefined && <span className="font-normal opacity-70"> · corrigé à la main</span>}
          </p>
          <p className="text-xs mt-0.5 opacity-90">{verdict.detail}</p>
        </div>
      )}

      {/* Prévisualisation */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-medium text-blue-500 mb-1.5 text-center">Score de ce tour</p>
        <div className="flex items-center justify-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-500 truncate max-w-[120px]">Nous</p>
            <p className="text-2xl font-bold text-blue-700 tabular-nums">{resultat.finalScore.team1}</p>
          </div>
          <span className="text-gray-300">·</span>
          <div className="text-center">
            <p className="text-xs text-gray-500 truncate max-w-[120px]">Eux</p>
            <p className="text-2xl font-bold text-blue-700 tabular-nums">{resultat.finalScore.team2}</p>
          </div>
        </div>
      </div>

      {/* Correction manuelle du verdict */}
      {!correction ? (
        <button type="button" onClick={() => setCorrection(true)}
          className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition">
          Le verdict ne correspond pas ? Corriger à la main
        </button>
      ) : (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Verdict du tour</label>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {([[undefined, 'Automatique'], [false, 'Contrat tenu'], [true, 'Dedans']] as [boolean | undefined, string][]).map(([v, lbl]) => (
              <button key={lbl} type="button" onClick={() => setForce(v)}
                className={`flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition ${
                  force === v ? 'bg-white text-gray-900 shadow' : 'text-gray-500'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button onClick={handleSubmit} disabled={saving}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition">
        {saving ? 'Enregistrement…' : (submitLabel ?? 'Valider le tour')}
      </button>
    </div>
  )
}
