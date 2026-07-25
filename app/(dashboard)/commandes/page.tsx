'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useCommandes } from '@/hooks/useDuo'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import { CommandeShareModal } from '@/components/commandes/CommandeShareModal'
import { AjoutBoissonModal, type BoissonAjout } from '@/components/commandes/AjoutBoissonModal'
import { InfosCommandeModal, type InfosResult } from '@/components/commandes/InfosCommandeModal'
import { ParticipantsEditor, pRowId, type PRow } from '@/components/commandes/ParticipantsEditor'
import { Timestamp } from 'firebase/firestore'
import dynamic from 'next/dynamic'
import { resoudreBar, chargerBarProche, enregistrerPrix, chargerTousBars, type BarComplet } from '@/lib/barPrix'
import { BarLocationField } from '@/components/commandes/BarLocationField'
import {
  Plus, Trash2, ChevronLeft, Beer, ClipboardList, Users, Wallet, Check, Minus, Share2, Pencil, MapPin, History, ChevronDown,
} from 'lucide-react'

// Leaflet touche `window` dès l'import → carte en client uniquement.
const CarteBars = dynamic(() => import('@/components/commandes/CarteBars'), {
  ssr: false,
  loading: () => (
    <div className="h-[50vh] rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
      Chargement de la carte…
    </div>
  ),
})
import {
  BOISSONS_COURANTES, additionParPersonne, totalCommande, totalPartiel,
  nbVerres, euros, prixConnus, boissonsFrequentes, participantsFrequents, remapLignesParticipants, propagerPrix,
  recapParTournee, tourneeCouranteDe, nbTournees, numeroTournee,
} from '@/lib/commandeModel'
import type { Commande, LigneCommande } from '@/types'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

const idLigne = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const dateInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function CommandesPage() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const { items, loading, ajouter, modifier, supprimer } = useCommandes(uid)
  const commandes = items as Commande[]

  // Compte rattaché à une commande qu'il n'a pas créée → accès gratuit (bypass).
  const isSharedGuest = !!uid && commandes.some((c) => !!c.createdBy && c.createdBy !== uid)
  const gateBypass = isSharedGuest || loading

  const [partageOuvert, setPartageOuvert] = useState(false)
  const [ouverteId, setOuverteId] = useState<string | null>(null)

  // Onglet de la page liste : les commandes, ou la carte des bars répertoriés.
  const [ongletListe, setOngletListe] = useState<'commandes' | 'bars'>('commandes')
  const [bars, setBars] = useState<BarComplet[]>([])
  const [barsLoading, setBarsLoading] = useState(false)
  const [barsCharges, setBarsCharges] = useState(false)
  const [barOuvert, setBarOuvert] = useState<string | null>(null)

  useEffect(() => {
    if (ongletListe !== 'bars' || barsCharges) return
    setBarsLoading(true)
    chargerTousBars()
      .then((b) => { setBars(b); setBarsCharges(true) })
      .catch(() => {})
      .finally(() => setBarsLoading(false))
  }, [ongletListe, barsCharges])
  const ouverte = commandes.find((c) => c.id === ouverteId) ?? null

  const listeTriee = useMemo(
    () => [...commandes].sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0)),
    [commandes],
  )
  const boissonsConnues = useMemo(() => {
    const vues = boissonsFrequentes(commandes)
    // L'historique d'abord : ce qu'on commande vraiment prime sur une liste type
    return [...vues, ...BOISSONS_COURANTES.filter((b) => !vues.some((v) => v.toLowerCase() === b.toLowerCase()))]
  }, [commandes])
  const gensConnus = useMemo(() => participantsFrequents(commandes), [commandes])

  // ── Nouvelle commande ──────────────────────────────────────────────────────
  const [nouvelleOuverte, setNouvelleOuverte] = useState(false)
  const [form, setForm] = useState({ lieu: '', date: '' })
  const [partRows, setPartRows] = useState<PRow[]>([])
  // Position du bar choisie sur la carte à la création (plus de capture auto).
  const [newLoc, setNewLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [newEphemere, setNewEphemere] = useState(false)

  const ouvrirNouvelle = () => {
    setForm({ lieu: '', date: dateInput(new Date()) })
    setPartRows([])
    setNewLoc(null)
    setNewEphemere(false)
    setNouvelleOuverte(true)
  }

  const creer = async () => {
    if (!uid) return
    const [y, m, j] = form.date.split('-').map(Number)
    const participants = Array.from(new Set(partRows.map((r) => r.name.trim()).filter(Boolean)))
    // Position du bar posée sur la carte → rattache au catalogue de prix partagé.
    // Bar de passage (« éphémère ») → on ne mémorise rien.
    let geo: Record<string, unknown> = {}
    if (newEphemere) {
      geo = { barEphemere: true }
    } else if (newLoc) {
      const bar = await resoudreBar(newLoc)
      geo = { lat: newLoc.lat, lng: newLoc.lng, barCell: bar.cell }
    }
    const id = await ajouter({
      members: [uid], createdBy: uid,
      lieu: form.lieu.trim(),
      date: form.date ? Timestamp.fromDate(new Date(y, m - 1, j, 20)) : Timestamp.now(),
      participants,
      lignes: [], terminee: false,
      ...geo,
    })
    setNouvelleOuverte(false)
    setOuverteId(id)
  }

  // ── Catalogue de prix par bar (partagé, géolocalisé) ────────────────────────
  const [barPrix, setBarPrix] = useState<Record<string, number>>({})

  // Charge les prix connus du bar dès qu'une commande géolocalisée est ouverte.
  useEffect(() => {
    const lat = ouverte?.lat, lng = ouverte?.lng
    if (lat == null || lng == null) { setBarPrix({}); return }
    let vivant = true
    chargerBarProche({ lat, lng }).then((bar) => { if (vivant) setBarPrix(bar?.prix ?? {}) }).catch(() => {})
    return () => { vivant = false }
  }, [ouverte?.id, ouverte?.lat, ouverte?.lng])

  // ── Modifier les infos (lieu / date / personnes / position) ─────────────────
  const [infosOuvert, setInfosOuvert] = useState(false)
  const enregistrerInfos = async (r: InfosResult) => {
    if (!ouverte) return
    const patch: Record<string, unknown> = {
      lieu: r.lieu,
      date: r.date ? Timestamp.fromMillis(r.date) : null,
      participants: r.participants,
      lignes: remapLignesParticipants(ouverte.lignes ?? [], r.renames, r.removed),
    }
    // Position du bar / bar de passage → recale (ou coupe) le catalogue de prix.
    if (r.barEphemere) {
      patch.barEphemere = true; patch.lat = null; patch.lng = null; patch.barCell = null
      setBarPrix({})
    } else {
      patch.barEphemere = false
      if (r.lat != null && r.lng != null) {
        const bar = await resoudreBar({ lat: r.lat, lng: r.lng })
        patch.lat = r.lat; patch.lng = r.lng; patch.barCell = bar.cell
        setBarPrix(bar.prix)
      } else {
        patch.lat = null; patch.lng = null; patch.barCell = null
        setBarPrix({})
      }
    }
    await modifier(ouverte.id, patch)
  }

  // ── Ajout d'une ligne ──────────────────────────────────────────────────────
  const [ajoutPour, setAjoutPour] = useState<string | null>(null)
  // Contenance mémorisée pour enchaîner vite (toute la tablée à la pinte…)
  const [dernierFormat, setDernierFormat] = useState('Pinte')

  const ajouterBoisson = async (b: BoissonAjout) => {
    if (!ouverte) return
    setDernierFormat(b.format)
    const ligne: LigneCommande = {
      id: idLigne(),
      boisson: b.boisson,
      quantite: b.quantite,
      prix: b.prix,
      pour: ajoutPour && ajoutPour !== 'La table' ? ajoutPour : undefined,
    }
    if (ligne.prix === undefined) delete ligne.prix
    if (ligne.pour === undefined) delete ligne.pour
    ligne.tournee = tourneeVue ?? tourneeCouranteDe(ouverte)
    let lignes = [...(ouverte.lignes ?? []), ligne]
    // Prix fixe par bar : on le reporte sur toutes les mêmes boissons de la tournée.
    if (b.prix != null) lignes = propagerPrix(lignes, ligne.boisson, b.prix)
    await modifier(ouverte.id, { lignes })
    setAjoutPour(null)
    // Mémorise le prix dans le catalogue partagé du bar (+ historique) — sauf bar de passage.
    if (b.prix != null && uid && !ouverte.barEphemere && ouverte.lat != null && ouverte.lng != null && ouverte.barCell) {
      const cle = ligne.boisson.trim().toLowerCase()
      if (barPrix[cle] !== b.prix) {
        setBarPrix((prev) => ({ ...prev, [cle]: b.prix! }))
        enregistrerPrix({ cell: ouverte.barCell, pos: { lat: ouverte.lat, lng: ouverte.lng }, nom: ouverte.lieu, boisson: ligne.boisson, prix: b.prix, uid }).catch(() => {})
      }
    }
  }

  const nouvelleTournee = async () => {
    if (!ouverte) return
    const n = nbTournees(ouverte) + 1
    setTourneeVue(n)
    await modifier(ouverte.id, { tourneeCourante: n })
  }

  const majLigne = async (id: string, patch: Partial<LigneCommande>) => {
    if (!ouverte) return
    await modifier(ouverte.id, {
      lignes: (ouverte.lignes ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })
  }
  const retirerLigne = async (id: string) => {
    if (!ouverte) return
    await modifier(ouverte.id, { lignes: (ouverte.lignes ?? []).filter((l) => l.id !== id) })
  }

  const [vue, setVue] = useState<'table' | 'bar' | 'addition'>('table')
  // Tournée affichée/éditée (null = par défaut la dernière). Reset au changement de commande.
  const [tourneeVue, setTourneeVue] = useState<number | null>(null)
  const [aSupprimer, setASupprimer] = useState<Commande | null>(null)

  if (loading) {
    return (
      <StoreGate appRoute="/commandes" bypass={gateBypass}>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </StoreGate>
    )
  }

  // ═══ Liste des commandes ═══
  if (!ouverte) {
    return (
      <StoreGate appRoute="/commandes" bypass={gateBypass}>
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Commandes</h1>
              <p className="text-sm text-gray-500">Qui prend quoi, ce qu&apos;on dit au bar, et qui paie quoi.</p>
            </div>
            <button onClick={ouvrirNouvelle}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition shrink-0">
              <Plus size={16} />Nouvelle tournée
            </button>
          </div>

          {/* Onglets : les commandes, ou la carte des bars répertoriés */}
          <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-xl sm:flex sm:w-fit">
            {([{ k: 'commandes', l: 'Tournées', icon: ClipboardList }, { k: 'bars', l: 'Bars & prix', icon: MapPin }] as const).map((o) => {
              const I = o.icon
              return (
                <button key={o.k} onClick={() => setOngletListe(o.k)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${ongletListe === o.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  <I size={15} />{o.l}
                </button>
              )
            })}
          </div>

          {ongletListe === 'commandes' && (listeTriee.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
              <ClipboardList size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Aucune commande enregistrée.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {([
                { titre: 'En cours', liste: listeTriee.filter((c) => !c.terminee) },
                { titre: 'Terminées', liste: listeTriee.filter((c) => c.terminee) },
              ]).filter((g) => g.liste.length > 0).map((g) => (
                <div key={g.titre} className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {g.titre} · {g.liste.length}
                  </p>
                  {g.liste.map((c) => {
                    const t = totalCommande(c)
                    return (
                      <button key={c.id} onClick={() => { setOuverteId(c.id); setVue('table'); setTourneeVue(null) }}
                        className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 text-left hover:shadow-md transition">
                        <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                          <Beer size={18} className="text-sky-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">
                            {c.lieu || 'Tournée'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {c.date?.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {' · '}{nbVerres(c)} verre{nbVerres(c) > 1 ? 's' : ''}
                            {c.participants.length > 0 && ` · ${c.participants.length} pers.`}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-gray-800 shrink-0">
                          {t !== null ? euros(t) : '—'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}

          {ongletListe === 'bars' && (
            <div className="space-y-4">
              {barsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <CarteBars bars={bars} />
                  <div className="space-y-2">
                    {bars.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '')).map((b) => {
                      const ouvert = barOuvert === b.key
                      const entrees = Object.entries(b.prix).sort((x, y) => x[0].localeCompare(y[0]))
                      return (
                        <div key={b.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                          <button onClick={() => setBarOuvert(ouvert ? null : b.key)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                            <div className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0"><MapPin size={16} className="text-sky-600" /></div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-800 truncate">{b.nom || 'Bar'}</p>
                              <p className="text-xs text-gray-500">{entrees.length} boisson{entrees.length > 1 ? 's' : ''} tarifée{entrees.length > 1 ? 's' : ''}</p>
                            </div>
                            <ChevronDown size={16} className={`text-gray-400 shrink-0 transition ${ouvert ? 'rotate-180' : ''}`} />
                          </button>
                          {ouvert && (
                            <div className="px-4 pb-3 space-y-3">
                              {entrees.length > 0 && (
                                <ul className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                                  {entrees.map(([boisson, prix]) => (
                                    <li key={boisson} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                      <span className="text-gray-700 capitalize">{boisson}</span><strong className="text-gray-900">{euros(prix)}</strong>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {b.histo.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><History size={12} />Historique des prix</p>
                                  <ul className="space-y-1 max-h-48 overflow-auto">
                                    {b.histo.slice().reverse().map((h, i) => (
                                      <li key={i} className="text-xs text-gray-600 flex items-center justify-between gap-3">
                                        <span className="capitalize flex-1 min-w-0 truncate">{h.boisson}</span>
                                        <span className="text-gray-400 shrink-0">{h.at?.toDate?.().toLocaleDateString('fr-FR') ?? ''}</span>
                                        <strong className="text-gray-800 shrink-0">{euros(h.prix)}</strong>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Nouvelle tournée */}
        <Modal isOpen={nouvelleOuverte} onClose={() => setNouvelleOuverte(false)} title="Nouvelle tournée">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bar / lieu</label>
                <input value={form.lieu} onChange={(e) => setForm((f) => ({ ...f, lieu: e.target.value }))}
                  placeholder="Le Baluchon" className={champCls} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={champCls} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Qui est là ?</label>
              <ParticipantsEditor rows={partRows} onChange={setPartRows} gensConnus={gensConnus} />
            </div>

            <BarLocationField lat={newLoc?.lat ?? null} lng={newLoc?.lng ?? null}
              onChange={(lat, lng) => setNewLoc({ lat, lng })}
              ephemere={newEphemere} onEphemere={setNewEphemere} />

            <div className="flex gap-3 pt-1">
              <button onClick={() => setNouvelleOuverte(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Annuler
              </button>
              <button onClick={creer}
                className="flex-1 bg-sky-600 hover:bg-sky-700 text-white py-2.5 rounded-xl text-sm font-medium transition">
                Commencer
              </button>
            </div>
          </div>
        </Modal>
      </StoreGate>
    )
  }

  // ═══ Détail d'une commande ═══
  const addition = additionParPersonne(ouverte)
  const total = totalCommande(ouverte)
  const partiel = totalPartiel(ouverte)
  const colonnes = ouverte.participants.length ? [...ouverte.participants, 'La table'] : ['La table']
  // Tournée en cours d'affichage (Table + Au bar s'y limitent ; l'Addition reste globale)
  const round = tourneeVue ?? tourneeCouranteDe(ouverte)
  const nbT = nbTournees(ouverte)

  return (
    <StoreGate appRoute="/commandes" bypass={gateBypass}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <button onClick={() => setOuverteId(null)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition mb-1">
              <ChevronLeft size={14} />Commandes
            </button>
            <h1 className="text-xl font-bold text-gray-900 truncate">{ouverte.lieu || 'Tournée'}</h1>
            <p className="text-sm text-gray-500">
              {ouverte.date?.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
              {' · '}{nbVerres(ouverte)} verre{nbVerres(ouverte) > 1 ? 's' : ''}
              {' · '}{total !== null ? euros(total) : `${euros(partiel)} connus`}
            </p>
          </div>
          {/* Actions — sous le titre sur mobile, à droite sur desktop */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setInfosOuvert(true)}
              className="flex items-center gap-1.5 border border-gray-300 text-gray-700 text-xs font-medium px-3 py-2 rounded-xl hover:bg-gray-50 transition">
              <Pencil size={14} />Modifier
            </button>
            <button onClick={() => setPartageOuvert(true)} title="Partager cette commande"
              className={`p-2 rounded-xl border transition ${ouverte.shareToken ? 'border-sky-300 text-sky-600 bg-sky-50' : 'border-gray-300 text-gray-400 hover:text-sky-600 hover:border-sky-300 hover:bg-sky-50'}`}>
              <Share2 size={16} />
            </button>
            <button onClick={() => modifier(ouverte.id, { terminee: !ouverte.terminee })}
              className="border border-gray-300 text-gray-700 text-xs px-3 py-2 rounded-xl hover:bg-gray-50 transition">
              {ouverte.terminee ? 'Rouvrir' : 'Terminer'}
            </button>
            <button onClick={() => setASupprimer(ouverte)} title="Supprimer cette commande"
              className="p-2 rounded-xl border border-gray-300 text-gray-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <CommandeShareModal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)}
          commande={ouverte} modifier={modifier} />
        <InfosCommandeModal isOpen={infosOuvert} onClose={() => setInfosOuvert(false)} avecPosition
          initial={{ lieu: ouverte.lieu ?? '', date: ouverte.date?.toMillis?.() ?? null, participants: ouverte.participants ?? [], lat: ouverte.lat ?? null, lng: ouverte.lng ?? null, barEphemere: ouverte.barEphemere ?? false }}
          gensConnus={gensConnus} onSave={enregistrerInfos} />

        {/* Trois lectures de la même commande */}
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
            <button onClick={nouvelleTournee}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium border border-dashed border-gray-300 text-sky-600 hover:border-sky-400 hover:bg-sky-50 transition">
              <Plus size={14} />Nouvelle
            </button>
          </div>
        )}

        {/* ── Vue TABLE : on fait le tour, personne par personne (tournée sélectionnée) ── */}
        {vue === 'table' && (
          <div className="space-y-3">
            {colonnes.map((p) => {
              const lignes = (ouverte.lignes ?? []).filter(
                (l) => (l.pour?.trim() || 'La table') === p && numeroTournee(l) === round,
              )
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
                    {lignes.length === 0 && (
                      <p className="text-xs text-gray-400 italic">Rien pour l&apos;instant.</p>
                    )}
                    {lignes.map((l) => (
                      <div key={l.id} className="flex items-center gap-2">
                        {/* Le pas +/- évite de rouvrir un formulaire pour une tournée de plus */}
                        <button onClick={() => (l.quantite > 1 ? majLigne(l.id, { quantite: l.quantite - 1 }) : retirerLigne(l.id))}
                          className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center shrink-0">
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-gray-800">{l.quantite}</span>
                        <button onClick={() => majLigne(l.id, { quantite: l.quantite + 1 })}
                          className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center shrink-0">
                          <Plus size={13} />
                        </button>
                        <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">{l.boisson}</span>
                        {l.prix != null && (
                          <span className="text-xs text-gray-500 shrink-0">{euros(l.prix * l.quantite)}</span>
                        )}
                        <button onClick={() => retirerLigne(l.id)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setAjoutPour(p)}
                      className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl py-2 text-sm text-gray-400 hover:border-sky-300 hover:text-sky-600 transition">
                      <Plus size={15} />Ajouter une boisson
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Vue BAR : la tournée sélectionnée, en gros pour lire au comptoir ── */}
        {vue === 'bar' && (() => {
          const rec = recapParTournee(ouverte).find((t) => t.tournee === round)?.recap ?? []
          return (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Tournée {round} — à lire au comptoir. Coche au fur et à mesure du service.
              </p>
              {rec.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-400">Rien dans cette tournée.</p>
                </div>
              ) : rec.map((r) => {
                const lignes = (ouverte.lignes ?? []).filter(
                  (l) => numeroTournee(l) === round && l.boisson.trim().toLowerCase() === r.boisson.toLowerCase(),
                )
                const toutesServies = lignes.length > 0 && lignes.every((l) => l.servie)
                return (
                  <div key={r.boisson}
                    className={`rounded-2xl border shadow-sm px-4 py-3.5 flex items-center gap-3 ${toutesServies ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'}`}>
                    <button
                      onClick={() => modifier(ouverte.id, {
                        lignes: (ouverte.lignes ?? []).map((l) =>
                          (numeroTournee(l) === round && l.boisson.trim().toLowerCase() === r.boisson.toLowerCase())
                            ? { ...l, servie: !toutesServies } : l),
                      })}
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
              {total !== null && (
                <div className="bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-sky-900">Total soirée</span>
                  <span className="text-lg font-bold text-sky-900">{euros(total)}</span>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Vue ADDITION : qui doit combien ── */}
        {vue === 'addition' && (
          <div className="space-y-2">
            {total === null && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Des prix manquent : les montants ci-dessous ne comptent que les boissons dont le prix est renseigné.
              </p>
            )}
            {addition.map((p) => (
              <div key={p.personne} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-800">{p.personne}</p>
                  <span className="text-base font-bold text-gray-900">
                    {p.total !== null
                      ? euros(p.total)
                      : euros(p.lignes.reduce((s, l) => s + (l.prix != null ? l.prix * l.quantite : 0), 0))}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {p.lignes.map((l) => `${l.quantite}× ${l.boisson}`).join(' · ')}
                </p>
              </div>
            ))}
            <div className="bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-sky-900">Total de la table</span>
              <span className="text-lg font-bold text-sky-900">
                {total !== null ? euros(total) : euros(partiel)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Ajout d'une boisson (contenance + nom) ─────────────────────────── */}
      <AjoutBoissonModal isOpen={!!ajoutPour} onClose={() => setAjoutPour(null)} pour={ajoutPour}
        boissonsConnues={boissonsConnues} formatDefaut={dernierFormat}
        prixConnu={(b) => barPrix[b.trim().toLowerCase()] ?? prixConnus(commandes, b)} onAdd={ajouterBoisson} />

      <Modal isOpen={!!aSupprimer} onClose={() => setASupprimer(null)} title="Supprimer la commande" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Supprimer <strong>{aSupprimer?.lieu || 'cette tournée'}</strong> et ses{' '}
            {aSupprimer ? nbVerres(aSupprimer) : 0} verre(s) ?
          </p>
          <div className="flex gap-3">
            <button onClick={() => setASupprimer(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => {
              if (aSupprimer) await supprimer(aSupprimer.id)
              setASupprimer(null); setOuverteId(null)
            }}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium transition">
              Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </StoreGate>
  )
}
