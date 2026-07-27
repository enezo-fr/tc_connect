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
import { MoiPicker } from '@/components/commandes/MoiPicker'
import { LA_TABLE, lireMoi, ecrireMoi, suivreMoi } from '@/lib/commandeMoi'
import { Timestamp } from 'firebase/firestore'
import dynamic from 'next/dynamic'
import { resoudreBar, chargerBarProche, enregistrerPrix, enregistrerBar, chargerTousBars, type BarComplet } from '@/lib/barPrix'
import { BarLocationField } from '@/components/commandes/BarLocationField'
import {
  Plus, Trash2, ChevronLeft, Beer, ClipboardList, Users, Wallet, Check, Minus, Share2, Pencil, MapPin, History, ChevronDown, UserRound,
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
  recapParTournee, tourneeCouranteDe, nbTournees, numeroTournee, supprimerTournee,
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
  // Qui tient le téléphone (pré-sélection du destinataire des boissons) — null = personne.
  const [newMoi, setNewMoi] = useState<string | null>(null)
  // Position du bar choisie sur la carte à la création (plus de capture auto).
  const [newLoc, setNewLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [newEphemere, setNewEphemere] = useState(false)

  const ouvrirNouvelle = () => {
    setForm({ lieu: '', date: dateInput(new Date()) })
    setPartRows([])
    setNewMoi(null)
    setNewLoc(null)
    setNewEphemere(false)
    setNouvelleOuverte(true)
  }

  // Prénoms saisis à la création, pour proposer « qui êtes-vous ? » au fil de la frappe.
  const newNoms = useMemo(
    () => Array.from(new Set(partRows.map((r) => r.name.trim()).filter(Boolean))),
    [partRows],
  )
  // La personne choisie vient d'être renommée / retirée → on ne garde pas un fantôme.
  useEffect(() => {
    if (newMoi && !newNoms.includes(newMoi)) setNewMoi(null)
  }, [newNoms, newMoi])

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
      // Enregistre le bar tout de suite (apparaît sur la carte, même sans prix).
      enregistrerBar({ cell: bar.cell, pos: newLoc, nom: form.lieu.trim() }).catch(() => {})
    }
    const id = await ajouter({
      members: [uid], createdBy: uid,
      lieu: form.lieu.trim(),
      date: form.date ? Timestamp.fromDate(new Date(y, m - 1, j, 20)) : Timestamp.now(),
      participants,
      lignes: [], terminee: false,
      ...geo,
    })
    // Identité de CET appareil (jamais en base) : le créateur ne se la redemande plus.
    ecrireMoi(id, newMoi)
    setMoi(newMoi)
    setNouvelleOuverte(false)
    setOuverteId(id)
  }

  // ── Qui suis-je (pré-sélection du destinataire) ─────────────────────────────
  const [moi, setMoi] = useState<string | null>(null)
  const [moiOuvert, setMoiOuvert] = useState(false)
  // Relu à chaque commande ouverte : l'identité est mémorisée par commande.
  useEffect(() => { setMoi(lireMoi(ouverteId).nom) }, [ouverteId])

  const choisirMoi = (nom: string | null) => { ecrireMoi(ouverteId, nom); setMoi(nom) }

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
        enregistrerBar({ cell: bar.cell, pos: { lat: r.lat, lng: r.lng }, nom: r.lieu }).catch(() => {})
        setBarPrix(bar.prix)
      } else {
        patch.lat = null; patch.lng = null; patch.barCell = null
        setBarPrix({})
      }
    }
    // Le prénom que je me suis attribué suit un renommage, et disparaît si on me retire.
    setMoi(suivreMoi(ouverte.id, r.renames, r.removed))
    await modifier(ouverte.id, patch)
  }

  // ── Ajout / édition d'une boisson ───────────────────────────────────────────
  const [ajoutPour, setAjoutPour] = useState<string | null>(null)
  const [ligneEdit, setLigneEdit] = useState<LigneCommande | null>(null)
  // Contenance mémorisée pour enchaîner vite (toute la tablée à la pinte…)
  const [dernierFormat, setDernierFormat] = useState('Pinte')

  /** Écrit le prix dans le catalogue partagé du bar (+ historique) — sauf bar de passage. */
  const memoriserPrixBar = (boisson: string, prix: number | undefined) => {
    if (!ouverte || prix == null || !uid || ouverte.barEphemere) return
    if (ouverte.lat == null || ouverte.lng == null || !ouverte.barCell) return
    const cle = boisson.trim().toLowerCase()
    if (barPrix[cle] === prix) return
    setBarPrix((prev) => ({ ...prev, [cle]: prix }))
    enregistrerPrix({ cell: ouverte.barCell, pos: { lat: ouverte.lat, lng: ouverte.lng }, nom: ouverte.lieu, boisson, prix, uid }).catch(() => {})
  }

  const handleBoisson = async (b: BoissonAjout) => {
    if (!ouverte) return
    setDernierFormat(b.format)
    let lignes = ouverte.lignes ?? []
    if (ligneEdit) {
      const id = ligneEdit.id
      lignes = lignes.map((l) => {
        if (l.id !== id) return l
        const nl: LigneCommande = { ...l, boisson: b.boisson, quantite: b.quantite }
        if (b.prix != null) nl.prix = b.prix; else delete nl.prix
        // Le destinataire est modifiable dans la modale : « La table » = pas de clé.
        if (b.pour) nl.pour = b.pour; else delete nl.pour
        return nl
      })
      setLigneEdit(null)
    } else {
      const t = typeof tourneeVue === 'number' ? tourneeVue : tourneeCouranteDe(ouverte)
      const ligne: LigneCommande = { id: idLigne(), boisson: b.boisson, quantite: b.quantite, tournee: t }
      if (b.prix != null) ligne.prix = b.prix
      if (b.pour) ligne.pour = b.pour
      lignes = [...lignes, ligne]
      setAjoutPour(null)
    }
    // Prix fixe par bar : on le reporte sur toutes les mêmes boissons.
    if (b.prix != null) lignes = propagerPrix(lignes, b.boisson, b.prix)
    await modifier(ouverte.id, { lignes })
    memoriserPrixBar(b.boisson, b.prix)
  }

  const nouvelleTournee = async () => {
    if (!ouverte) return
    const n = nbTournees(ouverte) + 1
    setTourneeVue(n)
    await modifier(ouverte.id, { tourneeCourante: n })
  }

  const [tourneeASupprimer, setTourneeASupprimer] = useState<number | null>(null)
  const confirmerSupprTournee = async () => {
    if (!ouverte || tourneeASupprimer == null) return
    const { lignes, tourneeCourante } = supprimerTournee(ouverte, tourneeASupprimer)
    setTourneeVue(null)
    setTourneeASupprimer(null)
    await modifier(ouverte.id, { lignes, tourneeCourante })
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
  // Tournée affichée/éditée (null = la dernière ; 'all' = toutes). Reset au changement de commande.
  const [tourneeVue, setTourneeVue] = useState<number | 'all' | null>(null)
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
                          {t !== null ? euros(t) : (totalPartiel(c) > 0 ? euros(totalPartiel(c)) : '')}
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

            {/* Qui tient le téléphone : pré-sélectionne le destinataire des boissons.
                Facultatif — « Personne » reste possible (on note pour la table). */}
            {newNoms.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Et vous, qui êtes-vous ? <span className="text-gray-400 font-normal">(facultatif)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {newNoms.map((n) => (
                    <button key={n} type="button" onClick={() => setNewMoi((c) => (c === n ? null : n))}
                      className={`px-3 py-1.5 rounded-xl text-sm border transition ${newMoi === n ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'}`}>
                      {n}
                    </button>
                  ))}
                  <button type="button" onClick={() => setNewMoi(null)}
                    className={`px-3 py-1.5 rounded-xl text-sm border transition ${newMoi === null ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                    Personne
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Vos boissons seront pré-affectées à ce prénom.
                </p>
              </div>
            )}

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
  const colonnes = [LA_TABLE, ...ouverte.participants]
  // Tournée en cours d'affichage (Table + Au bar s'y limitent ; l'Addition reste globale).
  // `round` = numéro, ou 'all' pour tout voir d'un coup.
  const nbT = nbTournees(ouverte)
  const round: number | 'all' = tourneeVue == null ? tourneeCouranteDe(ouverte) : tourneeVue
  const toutes = round === 'all'

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
            {/* Qui tient ce téléphone : pré-sélection du destinataire, réglable à tout moment */}
            <button onClick={() => setMoiOuvert(true)}
              className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                moi ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100' : 'border-dashed border-gray-300 text-gray-500 hover:border-sky-300 hover:text-sky-600'
              }`}>
              <UserRound size={13} />{moi ? `Moi · ${moi}` : 'Dire qui je suis'}
            </button>
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

        {/* Supprimer la tournée affichée (bien visible) */}
        {vue !== 'addition' && !toutes && nbT > 1 && (
          <button onClick={() => setTourneeASupprimer(round as number)}
            className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 transition -mt-2">
            <Trash2 size={13} />Supprimer la tournée
          </button>
        )}

        {/* ── Vue TABLE : on fait le tour, personne par personne (tournée sélectionnée) ── */}
        {vue === 'table' && (
          <div className="space-y-3">
            {/* Chemin court : ma boisson en deux gestes, sans chercher ma carte */}
            {moi && (
              <button onClick={() => setAjoutPour(moi)}
                className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white py-2.5 rounded-xl text-sm font-semibold shadow-sm transition active:scale-[0.99]">
                <Plus size={16} />Ajouter ma boisson
              </button>
            )}
            {colonnes.map((p) => {
              const lignes = (ouverte.lignes ?? []).filter(
                (l) => (l.pour?.trim() || LA_TABLE) === p && (toutes || numeroTournee(l) === round),
              )
              const sous = lignes.reduce((s, l) => s + (l.prix != null ? l.prix * l.quantite : 0), 0)
              const estMoi = !!moi && p === moi
              return (
                <div key={p} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${estMoi ? 'border-sky-300 ring-1 ring-sky-100' : 'border-gray-100'}`}>
                  <div className={`px-4 py-2.5 flex items-center justify-between gap-2 ${estMoi ? 'bg-sky-50/70' : 'bg-gray-50/70'}`}>
                    <p className="text-sm font-semibold text-gray-800">
                      {p}{estMoi && <span className="ml-1.5 text-xs font-medium text-sky-600">moi</span>}
                    </p>
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
                        <button onClick={() => setLigneEdit(l)} title="Modifier"
                          className="flex-1 min-w-0 text-sm text-gray-700 truncate text-left hover:text-sky-600 transition">
                          {l.boisson}
                        </button>
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

        {/* ── Vue BAR : à lire au comptoir, en gros (tournée choisie ou toutes) ── */}
        {vue === 'bar' && (() => {
          const nums = toutes ? Array.from({ length: nbT }, (_, i) => i + 1) : [round as number]
          const blocs = nums.map((n) => ({ n, rec: recapParTournee(ouverte).find((t) => t.tournee === n)?.recap ?? [] }))
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
                    const lignes = (ouverte.lignes ?? []).filter(
                      (l) => numeroTournee(l) === n && l.boisson.trim().toLowerCase() === r.boisson.toLowerCase(),
                    )
                    const toutesServies = lignes.length > 0 && lignes.every((l) => l.servie)
                    return (
                      <div key={r.boisson}
                        className={`rounded-2xl border shadow-sm px-4 py-3.5 flex items-center gap-3 ${toutesServies ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'}`}>
                        <button
                          onClick={() => modifier(ouverte.id, {
                            lignes: (ouverte.lignes ?? []).map((l) =>
                              (numeroTournee(l) === n && l.boisson.trim().toLowerCase() === r.boisson.toLowerCase())
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
      <AjoutBoissonModal isOpen={!!ajoutPour || !!ligneEdit} onClose={() => { setAjoutPour(null); setLigneEdit(null) }} pour={ajoutPour}
        participants={ouverte.participants ?? []}
        boissonsConnues={boissonsConnues} formatDefaut={dernierFormat}
        initial={ligneEdit ? { boisson: ligneEdit.boisson, prix: ligneEdit.prix, quantite: ligneEdit.quantite, pour: ligneEdit.pour ?? null } : null}
        prixConnu={(b) => barPrix[b.trim().toLowerCase()] ?? prixConnus(commandes, b)} onAdd={handleBoisson} />

      {/* Qui suis-je — sur cet appareil, pour cette commande */}
      <MoiPicker isOpen={moiOuvert} onClose={() => setMoiOuvert(false)}
        participants={ouverte.participants ?? []} moi={moi} onChoisir={choisirMoi}
        onAjouterPersonne={async (nom) => {
          await modifier(ouverte.id, { participants: [...(ouverte.participants ?? []), nom] })
        }} />

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

      <Modal isOpen={tourneeASupprimer != null} onClose={() => setTourneeASupprimer(null)} title="Supprimer la tournée" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Supprimer la <strong>tournée {tourneeASupprimer}</strong> et ses boissons ? Les tournées
            suivantes seront renumérotées.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setTourneeASupprimer(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={confirmerSupprTournee}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium transition">
              Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </StoreGate>
  )
}
