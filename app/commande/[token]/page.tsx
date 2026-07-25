'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import {
  BOISSONS_COURANTES, additionParPersonne, totalCommande, totalPartiel,
  nbVerres, euros, prixConnus, boissonsFrequentes, remapLignesParticipants, propagerPrix,
  recapParTournee, tourneeCouranteDe, nbTournees, numeroTournee,
} from '@/lib/commandeModel'
import { AjoutBoissonModal, type BoissonAjout } from '@/components/commandes/AjoutBoissonModal'
import { InfosCommandeModal, type InfosResult } from '@/components/commandes/InfosCommandeModal'
import type { Commande, LigneCommande } from '@/types'
import { Plus, Trash2, Beer, ClipboardList, Users, Wallet, Check, Minus, Pencil } from 'lucide-react'

const idLigne = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Vue publique renvoyée par l'API (date en millis). */
interface PublicCommande {
  id: string
  lieu: string
  date: number | null
  participants: string[]
  lignes: LigneCommande[]
  terminee: boolean
  tourneeCourante?: number | null
}

/** Page publique d'UNE commande, ouverte par lien/QR — modifiable sans compte. */
export default function CommandePubliquePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [cmd, setCmd] = useState<PublicCommande | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'invalid'>('loading')
  const [vue, setVue] = useState<'table' | 'bar' | 'addition'>('table')
  const [tourneeVue, setTourneeVue] = useState<number | 'all' | null>(null)
  // Prix connus du bar (catalogue partagé) — via route serveur (pas d'accès Firestore ici).
  const [barPrix, setBarPrix] = useState<Record<string, number>>({})
  const savingRef = useRef(false)
  const modalRef = useRef(false)

  const fetchCmd = useCallback(async () => {
    try {
      const res = await fetch(`/api/commande-share/${token}`)
      const data = await res.json()
      if (!res.ok || data.status !== 'ok') { setStatus('invalid'); return }
      // Ne pas écraser une édition locale en cours (poll)
      if (!savingRef.current && !modalRef.current) setCmd(data.commande)
      setStatus('ok')
    } catch {
      setStatus((s) => (s === 'loading' ? 'invalid' : s))
    }
  }, [token])

  useEffect(() => { fetchCmd() }, [fetchCmd])
  // Prix du bar (une fois) pour pré-remplir les saisies.
  useEffect(() => {
    fetch(`/api/commande-share/${token}/bar-prix`).then((r) => r.json())
      .then((d) => setBarPrix(d?.prix ?? {})).catch(() => {})
  }, [token])
  // Rafraîchissement léger : voir les modifs des autres personnes à table.
  useEffect(() => {
    const t = setInterval(() => { if (!savingRef.current && !modalRef.current) fetchCmd() }, 5000)
    return () => clearInterval(t)
  }, [fetchCmd])

  /** Persiste les lignes (et participants) via la route publique. */
  const persist = useCallback(async (next: PublicCommande) => {
    setCmd(next)
    savingRef.current = true
    try {
      const res = await fetch(`/api/commande-share/${token}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lieu: next.lieu, date: next.date, participants: next.participants,
          lignes: next.lignes, terminee: next.terminee, tourneeCourante: next.tourneeCourante ?? undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.commande) setCmd(data.commande)
    } catch { /* silencieux : on retentera au prochain geste ou poll */ }
    finally { savingRef.current = false }
  }, [token])

  // ── Mutations sur les lignes ────────────────────────────────────────────────
  const majLigne = (id: string, patch: Partial<LigneCommande>) => {
    if (!cmd) return
    persist({ ...cmd, lignes: cmd.lignes.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }
  const retirerLigne = (id: string) => {
    if (!cmd) return
    persist({ ...cmd, lignes: cmd.lignes.filter((l) => l.id !== id) })
  }
  const toggleServiTournee = (tournee: number, boisson: string, servie: boolean) => {
    if (!cmd) return
    const cle = boisson.trim().toLowerCase()
    persist({
      ...cmd,
      lignes: cmd.lignes.map((l) =>
        (numeroTournee(l) === tournee && l.boisson.trim().toLowerCase() === cle) ? { ...l, servie } : l),
    })
  }

  // ── Ajout / édition d'une boisson ─────────────────────────────────────────
  const [ajoutPour, setAjoutPour] = useState<string | null>(null)
  const [ligneEdit, setLigneEdit] = useState<LigneCommande | null>(null)
  const [dernierFormat, setDernierFormat] = useState('Pinte')
  const openAjout = (pour: string) => { modalRef.current = true; setAjoutPour(pour) }
  const openEdit = (l: LigneCommande) => { modalRef.current = true; setLigneEdit(l) }
  const closeBoisson = () => { modalRef.current = false; setAjoutPour(null); setLigneEdit(null) }

  const boissonsConnues = cmd
    ? (() => {
        const vues = boissonsFrequentes([cmd as unknown as Commande])
        return [...vues, ...BOISSONS_COURANTES.filter((b) => !vues.some((v) => v.toLowerCase() === b.toLowerCase()))]
      })()
    : []

  /** Alimente le catalogue de prix du bar (via route serveur) + local. */
  const memoriserPrixPublic = (boisson: string, prix: number | undefined) => {
    if (prix == null) return
    const cle = boisson.trim().toLowerCase()
    if (barPrix[cle] === prix) return
    setBarPrix((prev) => ({ ...prev, [cle]: prix }))
    fetch(`/api/commande-share/${token}/bar-prix`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boisson, prix }),
    }).catch(() => {})
  }

  const handleBoisson = (b: BoissonAjout) => {
    if (!cmd) return
    setDernierFormat(b.format)
    let lignes = cmd.lignes
    if (ligneEdit) {
      const id = ligneEdit.id
      lignes = lignes.map((l) => {
        if (l.id !== id) return l
        const nl: LigneCommande = { ...l, boisson: b.boisson, quantite: b.quantite }
        if (b.prix != null) nl.prix = b.prix; else delete nl.prix
        return nl
      })
      setLigneEdit(null)
    } else {
      const t = typeof tourneeVue === 'number' ? tourneeVue : tourneeCouranteDe(cmd as unknown as Commande)
      const ligne: LigneCommande = { id: idLigne(), boisson: b.boisson, quantite: b.quantite, tournee: t }
      if (b.prix != null) ligne.prix = b.prix
      if (ajoutPour && ajoutPour !== 'La table') ligne.pour = ajoutPour
      lignes = [...lignes, ligne]
      setAjoutPour(null)
    }
    if (b.prix != null) lignes = propagerPrix(lignes, b.boisson, b.prix)
    modalRef.current = false
    persist({ ...cmd, lignes })
    memoriserPrixPublic(b.boisson, b.prix)
  }

  const nouvelleTournee = () => {
    if (!cmd) return
    const n = nbTournees(cmd as unknown as Commande) + 1
    setTourneeVue(n)
    persist({ ...cmd, tourneeCourante: n })
  }

  // ── Modifier les infos (lieu / date / personnes) ────────────────────────────
  const [infosOuvert, setInfosOuvert] = useState(false)
  const openInfos = () => { modalRef.current = true; setInfosOuvert(true) }
  const enregistrerInfos = (r: InfosResult) => {
    if (!cmd) return
    modalRef.current = false
    persist({
      ...cmd, lieu: r.lieu, date: r.date, participants: r.participants,
      lignes: remapLignesParticipants(cmd.lignes, r.renames, r.removed),
    })
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (status === 'invalid' || !cmd) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center max-w-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Beer size={32} className="text-gray-400" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 mb-2">Commande introuvable</h1>
          <p className="text-sm text-gray-500">Ce lien n&apos;est plus valide, ou le partage a été coupé.</p>
        </div>
      </div>
    )
  }

  const addition = additionParPersonne(cmd as unknown as Commande)
  const total = totalCommande(cmd as unknown as Commande)
  const partiel = totalPartiel(cmd as unknown as Commande)
  const colonnes = ['La table', ...cmd.participants]
  const nbT = nbTournees(cmd as unknown as Commande)
  const round: number | 'all' = tourneeVue == null ? tourneeCouranteDe(cmd as unknown as Commande) : tourneeVue
  const toutes = round === 'all'

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* En-tête */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
            <Beer size={18} className="text-sky-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{cmd.lieu || 'Tournée'}</h1>
              <button onClick={openInfos} title="Modifier lieu, date et personnes"
                className="p-1 rounded-lg text-gray-400 hover:text-sky-600 hover:bg-sky-50 transition shrink-0">
                <Pencil size={15} />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              {cmd.date ? new Date(cmd.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''}
              {' · '}{nbVerres(cmd as unknown as Commande)} verre{nbVerres(cmd as unknown as Commande) > 1 ? 's' : ''}
              {' · '}{total !== null ? euros(total) : `${euros(partiel)} connus`}
            </p>
          </div>
          <button onClick={() => persist({ ...cmd, terminee: !cmd.terminee })}
            className="border border-gray-300 text-gray-700 text-xs px-3 py-2 rounded-xl hover:bg-gray-50 transition shrink-0">
            {cmd.terminee ? 'Rouvrir' : 'Terminer'}
          </button>
        </div>

        {cmd.terminee && (
          <div className="bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">
            Cette commande est marquée comme terminée.
          </div>
        )}

        {/* Onglets */}
        <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl sm:flex sm:w-fit">
          {([
            { k: 'table', icon: Users, l: 'La table' },
            { k: 'bar', icon: ClipboardList, l: 'Au bar' },
            { k: 'addition', icon: Wallet, l: 'Addition' },
          ] as const).map((o) => {
            const Icon = o.icon
            return (
              <button key={o.k} onClick={() => setVue(o.k)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  vue === o.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={15} />{o.l}
              </button>
            )
          })}
        </div>

        {/* Sélecteur de tournée (Table + Au bar s'y limitent) */}
        {vue !== 'addition' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {Array.from({ length: nbT }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setTourneeVue(n)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium border transition ${n === round ? 'bg-sky-600 text-white border-sky-600' : 'bg-white border-gray-200 text-gray-600 hover:border-sky-300'}`}>
                Tournée {n}
              </button>
            ))}
            {nbT > 1 && (
              <button onClick={() => setTourneeVue('all')}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium border transition ${toutes ? 'bg-sky-600 text-white border-sky-600' : 'bg-white border-gray-200 text-gray-600 hover:border-sky-300'}`}>
                Toutes
              </button>
            )}
            <button onClick={nouvelleTournee}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium border border-dashed border-gray-300 text-sky-600 hover:border-sky-400 hover:bg-sky-50 transition">
              <Plus size={14} />Nouvelle
            </button>
          </div>
        )}

        {/* Vue TABLE (tournée sélectionnée) */}
        {vue === 'table' && (
          <div className="space-y-3">
            {colonnes.map((p) => {
              const lignes = cmd.lignes.filter((l) => (l.pour?.trim() || 'La table') === p && (toutes || numeroTournee(l) === round))
              const sous = lignes.reduce((s, l) => s + (l.prix != null ? l.prix * l.quantite : 0), 0)
              return (
                <div key={p} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50/70 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800">{p}</p>
                    <span className="text-xs text-gray-500">
                      {lignes.reduce((s, l) => s + l.quantite, 0)} verre(s)
                      {sous > 0 && ` · ${euros(sous)}`}
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {lignes.length === 0 && <p className="text-xs text-gray-400 italic">Rien pour l&apos;instant.</p>}
                    {lignes.map((l) => (
                      <div key={l.id} className="flex items-center gap-2">
                        <button onClick={() => (l.quantite > 1 ? majLigne(l.id, { quantite: l.quantite - 1 }) : retirerLigne(l.id))}
                          className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center shrink-0">
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-gray-800">{l.quantite}</span>
                        <button onClick={() => majLigne(l.id, { quantite: l.quantite + 1 })}
                          className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center shrink-0">
                          <Plus size={13} />
                        </button>
                        <button onClick={() => openEdit(l)} title="Modifier"
                          className="flex-1 min-w-0 text-sm text-gray-700 truncate text-left hover:text-sky-600 transition">
                          {l.boisson}
                        </button>
                        {l.prix != null && <span className="text-xs text-gray-500 shrink-0">{euros(l.prix * l.quantite)}</span>}
                        <button onClick={() => retirerLigne(l.id)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => openAjout(p)}
                      className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl py-2 text-sm text-gray-400 hover:border-sky-300 hover:text-sky-600 transition">
                      <Plus size={15} />Ajouter une boisson
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Vue BAR — à lire au comptoir (tournée choisie ou toutes) */}
        {vue === 'bar' && (() => {
          const nums = toutes ? Array.from({ length: nbT }, (_, i) => i + 1) : [round as number]
          const blocs = nums.map((n) => ({ n, rec: recapParTournee(cmd as unknown as Commande).find((t) => t.tournee === n)?.recap ?? [] }))
          const vide = blocs.every((b) => b.rec.length === 0)
          return (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">
                {toutes ? 'Toutes les tournées' : `Tournée ${round}`} — à lire au comptoir. Coche au fur et à mesure du service.
              </p>
              {vide ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-400">Rien à commander.</p>
                </div>
              ) : blocs.filter((b) => b.rec.length > 0).map(({ n, rec }) => (
                <div key={n} className="space-y-2">
                  {toutes && <h3 className="text-base font-bold text-gray-900">Tournée {n}</h3>}
                  {rec.map((r) => {
                    const lignes = cmd.lignes.filter((l) => numeroTournee(l) === n && l.boisson.trim().toLowerCase() === r.boisson.toLowerCase())
                    const toutesServies = lignes.length > 0 && lignes.every((l) => l.servie)
                    return (
                      <div key={r.boisson}
                        className={`rounded-2xl border shadow-sm px-4 py-3.5 flex items-center gap-3 ${toutesServies ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'}`}>
                        <button onClick={() => toggleServiTournee(n, r.boisson, !toutesServies)}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition ${toutesServies ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}>
                          <Check size={16} />
                        </button>
                        <span className="text-3xl font-extrabold text-sky-700 w-10 text-center shrink-0 tabular-nums">{r.quantite}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-lg font-bold leading-tight ${toutesServies ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{r.boisson}</p>
                          {r.pour.length > 0 && <p className="text-xs text-gray-500 truncate">pour {r.pour.join(', ')}</p>}
                        </div>
                        {r.total !== null && <span className="text-sm text-gray-600 shrink-0">{euros(r.total)}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
              {total !== null && (
                <div className="bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-sky-900">Total soirée</span>
                  <span className="text-lg font-bold text-sky-900">{euros(total)}</span>
                </div>
              )}
            </div>
          )
        })()}

        {/* Vue ADDITION */}
        {vue === 'addition' && (
          <div className="space-y-2">
            {total === null && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Des prix manquent : les montants ne comptent que les boissons dont le prix est renseigné.
              </p>
            )}
            {addition.map((p) => (
              <div key={p.personne} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-800">{p.personne}</p>
                  <span className="text-base font-bold text-gray-900">
                    {p.total !== null ? euros(p.total) : euros(p.lignes.reduce((s, l) => s + (l.prix != null ? l.prix * l.quantite : 0), 0))}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{p.lignes.map((l) => `${l.quantite}× ${l.boisson}`).join(' · ')}</p>
              </div>
            ))}
            <div className="bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-sky-900">Total de la table</span>
              <span className="text-lg font-bold text-sky-900">{total !== null ? euros(total) : euros(partiel)}</span>
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-gray-400 pt-2">
          Commande partagée · les modifications sont visibles par tout le monde.
        </p>
      </div>

      {/* Ajout d'une boisson (contenance + nom) */}
      <AjoutBoissonModal isOpen={!!ajoutPour || !!ligneEdit} onClose={closeBoisson} pour={ajoutPour}
        boissonsConnues={boissonsConnues} formatDefaut={dernierFormat}
        initial={ligneEdit ? { boisson: ligneEdit.boisson, prix: ligneEdit.prix, quantite: ligneEdit.quantite } : null}
        prixConnu={(b) => (cmd ? (barPrix[b.trim().toLowerCase()] ?? prixConnus([cmd as unknown as Commande], b)) : null)} onAdd={handleBoisson} />

      <InfosCommandeModal isOpen={infosOuvert} onClose={() => { modalRef.current = false; setInfosOuvert(false) }}
        initial={{ lieu: cmd.lieu, date: cmd.date, participants: cmd.participants }}
        onSave={enregistrerInfos} />
    </div>
  )
}
