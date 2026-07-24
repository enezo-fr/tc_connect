'use client'

import { useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useUsers } from '@/hooks/useUsers'
import { useBieres } from '@/hooks/useBieres'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { Timestamp, deleteField } from 'firebase/firestore'
import { Plus, Pencil, Trash2, Search, Star, BarChart3, ListFilter, MapPin, Camera } from 'lucide-react'
import {
  SERVICES, TYPES_BIERE, TYPOLOGIES, CONTEXTES, METEOS, RESSENTIS, NOTES,
  classer, bilan, formatNote, moyenneDegustation, moyennePersonne,
  topPersonne, lieuxFrequents, parAnnee, parSaison,
  type BiereCalculee,
} from '@/lib/biereModel'
import { uploadImage } from '@/lib/uploadImage'
import type { Biere, Degustation } from '@/types'

// ─── Sous-composants ──────────────────────────────────────────────────────────

/** Note affichée en pastille, colorée selon le niveau — repère visuel immédiat */
function Note({ valeur, taille = 'md' }: { valeur: number | null; taille?: 'sm' | 'md' }) {
  if (valeur === null) {
    return <span className="text-xs text-gray-300 italic">non notée</span>
  }
  const couleur =
    valeur >= 4 ? 'bg-emerald-100 text-emerald-700'
    : valeur >= 3 ? 'bg-lime-100 text-lime-700'
    : valeur >= 2 ? 'bg-amber-100 text-amber-700'
    : 'bg-rose-100 text-rose-700'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-lg font-semibold ${couleur} ${
      taille === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
    }`}>
      {formatNote(valeur)}<span className="opacity-50">/5</span>
    </span>
  )
}

function Chips({ options, valeur, onChange, autoriseVide = true }: {
  options: readonly string[]; valeur: string; onChange: (v: string) => void; autoriseVide?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button"
          onClick={() => onChange(autoriseVide && valeur === o ? '' : o)}
          className={`px-3 py-1.5 rounded-xl text-sm border transition ${
            valeur === o ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-700 hover:border-amber-300'
          }`}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Sélecteur de note 0 → 5 par pas de 0,5 */
function ChoixNote({ valeur, onChange, libelle }: {
  valeur: number | null; onChange: (v: number | null) => void; libelle: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{libelle}</label>
      <div className="flex flex-wrap gap-1">
        {NOTES.map((n) => (
          <button key={n} type="button"
            onClick={() => onChange(valeur === n ? null : n)}
            className={`w-10 py-1.5 rounded-lg text-xs font-medium border transition ${
              valeur === n ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-600 hover:border-amber-300'
            }`}>
            {formatNote(n)}
          </button>
        ))}
      </div>
    </div>
  )
}

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BieresPage() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const { users } = useUsers()
  const {
    bieres, degustations, loading,
    ajouterBiere, majBiere, supprimerBiere,
    ajouterDegustation, majDegustation, supprimerDegustation,
  } = useBieres(uid)

  const [onglet, setOnglet] = useState<'catalogue' | 'bilan'>('catalogue')
  const [recherche, setRecherche] = useState('')
  const [filtreType, setFiltreType] = useState('')
  const [filtreTypologie, setFiltreTypologie] = useState('')
  const [filtreService, setFiltreService] = useState('')
  const [filtreAnnee, setFiltreAnnee] = useState('')
  const [filtreOrigine, setFiltreOrigine] = useState('')
  const [filtreNoteMin, setFiltreNoteMin] = useState('')
  const [filtreMultiple, setFiltreMultiple] = useState(false)
  const [filtreNonNotees, setFiltreNonNotees] = useState(false)
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [tri, setTri] = useState<'note' | 'recent' | 'nom' | 'degres' | 'fois'>('note')

  const liste = useMemo(() => classer(bieres, degustations), [bieres, degustations])

  /** Origines réellement présentes — inutile de proposer un filtre vide */
  const origines = useMemo(
    () => [...new Set(liste.map((b) => b.biere.origine?.trim()).filter((o): o is string => !!o))].sort(),
    [liste],
  )
  const annees = useMemo(
    () => [...new Set(liste.flatMap((b) => b.annees))].sort((a, b) => b - a),
    [liste],
  )

  const listeFiltree = useMemo(() => {
    const out = liste.filter((b) => {
      const q = recherche.trim().toLowerCase()
      if (q && !`${b.biere.nom} ${b.biere.origine ?? ''}`.toLowerCase().includes(q)
        && !b.degustations.some((d) => `${d.lieu ?? ''} ${d.analyse ?? ''} ${d.evenement ?? ''}`.toLowerCase().includes(q))) return false
      if (filtreType && b.biere.type !== filtreType) return false
      if (filtreTypologie && b.biere.typologie !== filtreTypologie) return false
      if (filtreService && b.biere.service !== filtreService) return false
      if (filtreOrigine && b.biere.origine !== filtreOrigine) return false
      if (filtreAnnee && !b.annees.includes(Number(filtreAnnee))) return false
      if (filtreMultiple && b.nbDegustations < 2) return false
      if (filtreNonNotees && b.moyenne !== null) return false
      if (filtreNoteMin && (b.moyenne === null || b.moyenne < Number(filtreNoteMin))) return false
      return true
    })
    // Le tri par défaut (note) vient déjà de `classer`
    if (tri === 'nom') return [...out].sort((a, b) => a.biere.nom.localeCompare(b.biere.nom))
    if (tri === 'degres') return [...out].sort((a, b) => (b.biere.degres ?? -1) - (a.biere.degres ?? -1))
    if (tri === 'fois') return [...out].sort((a, b) => b.nbDegustations - a.nbDegustations)
    if (tri === 'recent') {
      return [...out].sort((a, b) => (b.derniere?.date?.seconds ?? 0) - (a.derniere?.date?.seconds ?? 0))
    }
    return out
  }, [liste, recherche, filtreType, filtreTypologie, filtreService, filtreOrigine,
      filtreAnnee, filtreMultiple, filtreNonNotees, filtreNoteMin, tri])

  const resume = useMemo(() => bilan(liste), [liste])
  const nbFiltres = [filtreType, filtreTypologie, filtreService, filtreOrigine, filtreAnnee, filtreNoteMin]
    .filter(Boolean).length + (filtreMultiple ? 1 : 0) + (filtreNonNotees ? 1 : 0)
  const reinitialiser = () => {
    setFiltreType(''); setFiltreTypologie(''); setFiltreService(''); setFiltreOrigine('')
    setFiltreAnnee(''); setFiltreNoteMin(''); setFiltreMultiple(false); setFiltreNonNotees(false)
  }

  /** Prénom d'un membre, pour afficher « Sarah 4 · Teddy 3,5 » sans rien coder en dur */
  const prenom = (u: string) => {
    if (u === uid) return 'Moi'
    const p = users.find((x) => (x.uid ?? x.id) === u)
    return p?.prenom || p?.nom || 'Autre'
  }

  // ── Fiche bière (création / édition) ────────────────────────────────────────
  const [ficheOuverte, setFicheOuverte] = useState(false)
  const [ficheEditee, setFicheEditee] = useState<Biere | null>(null)
  const [form, setForm] = useState({ nom: '', service: '', type: '', typologie: '', degres: '', ibu: '', origine: '' })
  const [enCours, setEnCours] = useState(false)

  const ouvrirNouvelle = () => {
    setFicheEditee(null)
    setForm({ nom: '', service: '', type: '', typologie: '', degres: '', ibu: '', origine: '' })
    setFicheOuverte(true)
  }
  const ouvrirEdition = (b: Biere) => {
    setFicheEditee(b)
    setForm({
      nom: b.nom, service: b.service ?? '', type: b.type ?? '', typologie: b.typologie ?? '',
      degres: b.degres != null ? String(b.degres) : '',
      ibu: b.ibu != null ? String(b.ibu) : '',
      origine: b.origine ?? '',
    })
    setFicheOuverte(true)
  }

  const enregistrerFiche = async () => {
    if (!uid || !form.nom.trim()) return
    setEnCours(true)
    try {
      const champs = {
        nom: form.nom.trim(),
        service: form.service,
        type: form.type,
        typologie: form.typologie,
        origine: form.origine.trim(),
        degres: form.degres ? Number(form.degres.replace(',', '.')) : undefined,
        ibu: form.ibu ? Number(form.ibu.replace(',', '.')) : undefined,
      }
      if (ficheEditee) await majBiere(ficheEditee.id, champs)
      else await ajouterBiere({ ...champs, members: [uid], createdBy: uid } as Omit<Biere, 'id' | 'createdAt'>)
      setFicheOuverte(false)
    } finally { setEnCours(false) }
  }

  // ── Dégustation ─────────────────────────────────────────────────────────────
  const [degPour, setDegPour] = useState<BiereCalculee | null>(null)
  /** Dégustation en cours de MODIFICATION (null = on en crée une nouvelle) */
  const [degEditee, setDegEditee] = useState<Degustation | null>(null)
  const [degForm, setDegForm] = useState({
    date: '', analyse: '', lieu: '', gps: '',
    contexte: '', evenement: '', meteo: '', ressenti: '', temperature: '',
  })
  /** Une note par personne — on note à deux, et modifier la sienne ne doit pas effacer l'autre */
  const [degNotes, setDegNotes] = useState<Record<string, number | null>>({})

  /**
   * Personnes susceptibles de noter : moi, plus toutes celles déjà présentes
   * dans le catalogue (dont « sarah », issue de l'import).
   */
  const membresNotes = useMemo(() => {
    const autres = new Set<string>()
    for (const b of liste) for (const d of b.degustations) {
      for (const k of Object.keys(d.notes ?? {})) if (k !== uid) autres.add(k)
    }
    return [uid, ...autres].filter((x): x is string => !!x)
  }, [liste, uid])
  const [photos, setPhotos] = useState<string[]>([])
  const [envoiPhoto, setEnvoiPhoto] = useState(false)

  /** Upload immédiat : l'URL est connue avant l'enregistrement, donc l'aperçu est réel */
  const envoyerPhoto = async (file: File) => {
    if (!uid) return
    setEnvoiPhoto(true)
    try {
      const url = await uploadImage(file, `users/${uid}/bieres/${Date.now()}_${file.name}`)
      setPhotos((p) => [...p, url])
    } catch {
      // Chemin `users/{uid}/**` autorisé par les règles Storage — un échec ici
      // vient d'un fichier trop lourd ou d'une coupure réseau.
    } finally { setEnvoiPhoto(false) }
  }

  const dateInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const ouvrirDegustation = (b: BiereCalculee) => {
    setDegEditee(null)
    setDegForm({
      date: dateInput(new Date()), analyse: '', lieu: '', gps: '', contexte: '',
      evenement: '', meteo: '', ressenti: '', temperature: '',
    })
    setDegNotes(Object.fromEntries(membresNotes.map((m) => [m, null])))
    setPhotos([])
    setDegPour(b)
  }

  const ouvrirEditionDegustation = (b: BiereCalculee, d: Degustation) => {
    setDegEditee(d)
    setDegForm({
      date: d.date ? dateInput(d.date.toDate()) : '',
      analyse: d.analyse ?? '', lieu: d.lieu ?? '', gps: d.gps ?? '',
      contexte: d.contexte ?? '', evenement: d.evenement ?? '',
      meteo: d.meteo ?? '', ressenti: d.ressenti ?? '',
      temperature: d.temperature != null ? String(d.temperature) : '',
    })
    // Les notes déjà là priment ; les autres personnes connues apparaissent vides
    setDegNotes({
      ...Object.fromEntries(membresNotes.map((m) => [m, null])),
      ...(d.notes ?? {}),
    })
    setPhotos(d.photos ?? [])
    setDegPour(b)
  }

  const enregistrerDegustation = async () => {
    if (!uid || !degPour) return
    setEnCours(true)
    try {
      const [y, m, j] = degForm.date.split('-').map(Number)
      // Seules les notes réellement saisies sont écrites : une note laissée vide
      // ne doit pas se transformer en 0, qui serait une très mauvaise note.
      const notes = Object.fromEntries(
        Object.entries(degNotes).filter(([, v]) => v !== null && v !== undefined),
      ) as Record<string, number>

      const champs = {
        date: degForm.date ? Timestamp.fromDate(new Date(y, m - 1, j, 12)) : undefined,
        notes: Object.keys(notes).length ? notes : undefined,
        analyse: degForm.analyse.trim() || undefined,
        lieu: degForm.lieu.trim() || undefined,
        gps: degForm.gps.trim() || undefined,
        contexte: degForm.contexte || undefined,
        evenement: degForm.evenement.trim() || undefined,
        meteo: degForm.meteo || undefined,
        ressenti: degForm.ressenti || undefined,
        temperature: degForm.temperature ? Number(degForm.temperature.replace(',', '.')) : undefined,
        photos: photos.length ? photos : undefined,
      }

      if (degEditee) {
        // `deleteField` sur les champs vidés : sans ça, effacer un lieu ou une
        // note laisserait l'ancienne valeur en base.
        const patch: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(champs)) patch[k] = v === undefined ? deleteField() : v
        await majDegustation(degPour.biere.id, degEditee.id, patch as Partial<Degustation>)
      } else {
        await ajouterDegustation(
          degPour.biere.id,
          { createdBy: uid, ...champs } as Omit<Degustation, 'id' | 'createdAt'>,
          degPour.biere.members,
        )
      }
      setDegPour(null)
      setDegEditee(null)
    } finally { setEnCours(false) }
  }

  const [aSupprimer, setASupprimer] = useState<BiereCalculee | null>(null)
  const [deplie, setDeplie] = useState<string | null>(null)

  if (loading) {
    return (
      <StoreGate appRoute="/bieres">
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </StoreGate>
    )
  }

  return (
    <StoreGate appRoute="/bieres">
      <div className="space-y-5 max-w-full">

        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Catalogue de bières</h1>
            <p className="text-sm text-gray-500">
              {resume.total} bière{resume.total > 1 ? 's' : ''}
              {resume.notees > 0 && ` · ${resume.notees} notée${resume.notees > 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={ouvrirNouvelle}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition shrink-0">
            <Plus size={16} />Ajouter
          </button>
        </div>

        {/* Onglets */}
        <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-xl sm:flex sm:w-fit">
          {([
            { k: 'catalogue', icon: ListFilter, l: 'Catalogue' },
            { k: 'bilan', icon: BarChart3, l: 'Bilan' },
          ] as const).map((o) => {
            const Icon = o.icon
            return (
              <button key={o.k} onClick={() => setOnglet(o.k)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  onglet === o.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={15} />{o.l}
              </button>
            )
          })}
        </div>

        {onglet === 'catalogue' && (
          <>
            {/* Recherche + filtres */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Nom, bar, avis…"
                  className={`${champCls} pl-9`} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setFiltresOuverts((v) => !v)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 transition">
                  {filtresOuverts ? 'Masquer les filtres' : 'Filtrer'}
                  {nbFiltres > 0 && ` · ${nbFiltres} actif${nbFiltres > 1 ? 's' : ''}`}
                </button>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  Trier par
                  <select value={tri} onChange={(e) => setTri(e.target.value as typeof tri)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="note">Note</option>
                    <option value="recent">Plus récentes</option>
                    <option value="nom">Nom</option>
                    <option value="degres">Degré</option>
                    <option value="fois">Nombre de fois bue</option>
                  </select>
                </label>
              </div>
              {filtresOuverts && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Type</p>
                    <Chips options={TYPES_BIERE} valeur={filtreType} onChange={setFiltreType} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Typologie</p>
                    <Chips options={TYPOLOGIES} valeur={filtreTypologie} onChange={setFiltreTypologie} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Service</p>
                    <Chips options={SERVICES} valeur={filtreService} onChange={setFiltreService} />
                  </div>
                  {origines.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Origine</p>
                      <select value={filtreOrigine} onChange={(e) => setFiltreOrigine(e.target.value)} className={champCls}>
                        <option value="">Toutes</option>
                        {origines.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  {annees.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Année</p>
                      <Chips options={annees.map(String)} valeur={filtreAnnee} onChange={setFiltreAnnee} />
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Note minimum</p>
                    <Chips options={['2', '3', '3,5', '4', '4,5']} valeur={filtreNoteMin.replace('.', ',')}
                      onChange={(v) => setFiltreNoteMin(v.replace(',', '.'))} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setFiltreMultiple((v) => !v)}
                      className={`px-3 py-1.5 rounded-xl text-sm border transition ${filtreMultiple ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-700 hover:border-amber-300'}`}>
                      Bues plusieurs fois
                    </button>
                    <button type="button" onClick={() => setFiltreNonNotees((v) => !v)}
                      className={`px-3 py-1.5 rounded-xl text-sm border transition ${filtreNonNotees ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-700 hover:border-amber-300'}`}>
                      Pas encore notées
                    </button>
                  </div>
                  {nbFiltres > 0 && (
                    <button onClick={reinitialiser} className="text-xs text-gray-500 hover:text-gray-700 underline">
                      Réinitialiser
                    </button>
                  )}
                </div>
              )}
              {(recherche || nbFiltres > 0) && (
                <p className="text-xs text-gray-400">{listeFiltree.length} sur {liste.length}</p>
              )}
            </div>

            {/* Liste */}
            {listeFiltree.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">
                  {liste.length === 0 ? 'Aucune bière pour l’instant.' : 'Aucune bière pour ces critères.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {listeFiltree.map((b, i) => {
                  const ouvert = deplie === b.biere.id
                  return (
                    <div key={b.biere.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-3">
                        {/* Le rang n'a de sens que sur le classement complet */}
                        {!recherche && nbFiltres === 0 && b.moyenne !== null && (
                          <span className="text-xs font-bold text-gray-300 w-6 shrink-0">#{i + 1}</span>
                        )}
                        {/* Vignette : une photo de la bière vaut mieux qu'un nom */}
                        {(() => {
                          const photo = b.degustations.flatMap((d) => d.photos ?? [])[0]
                          return photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photo} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                          ) : null
                        })()}
                        <button onClick={() => setDeplie(ouvert ? null : b.biere.id)}
                          className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-semibold text-gray-800 break-words">{b.biere.nom}</p>
                          <p className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                            {[b.biere.type, b.biere.typologie, b.biere.service,
                              b.biere.degres != null ? `${formatNote(b.biere.degres)}°` : null,
                              b.biere.origine].filter(Boolean).map((t, k) => <span key={k}>{t}</span>)}
                          </p>
                          {/* L'avis est le cœur de l'ancienne base : visible sans déplier */}
                          {b.derniere?.analyse && (
                            <p className="text-xs text-gray-600 italic mt-0.5 line-clamp-2 break-words">
                              {b.derniere.analyse}
                            </p>
                          )}
                          <p className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                            {b.derniere?.date && (
                              <span>{b.derniere.date.toDate().toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}</span>
                            )}
                            {b.derniere?.lieu && <span>{b.derniere.lieu}</span>}
                            {b.nbDegustations > 1 && (
                              <span className="text-amber-700 font-medium">bue {b.nbDegustations} fois</span>
                            )}
                          </p>
                        </button>
                        <Note valeur={b.moyenne} />
                      </div>

                      {ouvert && (
                        <div className="border-t border-gray-50 px-4 py-3 space-y-3">
                          {b.degustations.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Aucune dégustation enregistrée.</p>
                          ) : (
                            <div className="space-y-2">
                              {b.degustations.map((d) => (
                                <div key={d.id} className="bg-gray-50 rounded-xl px-3 py-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs text-gray-500">
                                        {d.date ? d.date.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'date inconnue'}
                                        {d.lieu && ` · ${d.lieu}`}
                                      </p>
                                      {d.notes && Object.keys(d.notes).length > 0 && (
                                        <p className="text-xs text-gray-700 mt-0.5">
                                          {Object.entries(d.notes).map(([u, n]) => `${prenom(u)} ${formatNote(n)}`).join(' · ')}
                                        </p>
                                      )}
                                      {d.analyse && <p className="text-sm text-gray-700 mt-1 break-words">{d.analyse}</p>}
                                      {(d.photos?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                                          {d.photos!.map((p) => (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img key={p} src={p} alt="" className="w-16 h-16 rounded-lg object-cover" />
                                          ))}
                                        </div>
                                      )}
                                      <p className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                                        {[d.contexte, d.evenement, d.meteo, d.ressenti,
                                          d.temperature != null ? `${d.temperature} °C` : null].filter(Boolean).map((t, k) => <span key={k}>{t}</span>)}
                                        {d.gps && (
                                          <a href={`https://maps.google.com/?q=${encodeURIComponent(d.gps)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 text-amber-700 hover:underline">
                                            <MapPin size={11} />carte
                                          </a>
                                        )}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Note valeur={moyenneDegustation(d)} taille="sm" />
                                      <button onClick={() => ouvrirEditionDegustation(b, d)}
                                        title="Modifier cette dégustation"
                                        className="p-1 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition">
                                        <Pencil size={13} />
                                      </button>
                                      <button onClick={() => supprimerDegustation(b.biere.id, d.id)}
                                        title="Supprimer cette dégustation"
                                        className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => ouvrirDegustation(b)}
                              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-2 rounded-xl transition">
                              <Star size={14} />Noter une dégustation
                            </button>
                            <button onClick={() => ouvrirEdition(b.biere)}
                              className="flex items-center gap-1.5 border border-gray-300 text-gray-700 text-xs px-3 py-2 rounded-xl hover:bg-gray-50 transition">
                              <Pencil size={14} />Modifier la fiche
                            </button>
                            <button onClick={() => setASupprimer(b)}
                              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 px-3 py-2 rounded-xl transition">
                              <Trash2 size={14} />Supprimer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {onglet === 'bilan' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l: 'Bières', v: String(resume.total) },
                { l: 'Notées', v: String(resume.notees) },
                { l: 'Moyenne', v: resume.moyenneGenerale !== null ? `${formatNote(resume.moyenneGenerale)}/5` : '—' },
                { l: 'Degré moyen', v: resume.degresMoyen !== null ? `${formatNote(resume.degresMoyen)}°` : '—' },
              ].map((c) => (
                <div key={c.l} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
                  <p className="text-xl font-bold text-gray-800">{c.v}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.l}</p>
                </div>
              ))}
            </div>

            {/* Notes moyennes par personne : le cœur d'un catalogue à deux */}
            {(() => {
              const toutes = liste.flatMap((b) => b.degustations)
              const membres = [...new Set(toutes.flatMap((d) => Object.keys(d.notes ?? {})))]
              if (membres.length === 0) return null
              return (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Note moyenne par personne</p>
                  <div className="space-y-1.5">
                    {membres.map((u) => (
                      <div key={u} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-gray-700">{prenom(u)}</span>
                        <Note valeur={moyennePersonne(toutes, u)} taille="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Les préférées de chacun : deux classements, pas une moyenne unique */}
            {(() => {
              const membres = [...new Set(liste.flatMap((b) => b.degustations).flatMap((d) => Object.keys(d.notes ?? {})))]
              if (!membres.length) return null
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {membres.map((u) => {
                    const top = topPersonne(liste, u, 5)
                    if (!top.length) return null
                    return (
                      <div key={u} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Les préférées de {prenom(u)}
                        </p>
                        <div className="space-y-1.5">
                          {top.map((t, i) => (
                            <div key={t.biere.id} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                              <span className="text-sm text-gray-700 flex-1 truncate">{t.biere.nom}</span>
                              <Note valeur={t.note} taille="sm" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { titre: 'Par type', data: resume.parType },
                { titre: 'Par typologie', data: resume.parTypologie },
                { titre: 'Par service', data: resume.parService },
                { titre: 'Par saison', data: parSaison(liste).map((s) => ({ label: s.saison, n: s.nb })) },
                { titre: 'Par année', data: parAnnee(liste).map((a) => ({ label: String(a.annee), n: a.nb })) },
                { titre: 'Où on boit le plus', data: lieuxFrequents(liste).map((l) => ({ label: l.lieu, n: l.nb })) },
              ].filter((s) => s.data.length > 0).map((s) => (
                <div key={s.titre} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{s.titre}</p>
                  <div className="space-y-1.5">
                    {s.data.map((r) => (
                      <div key={r.label} className="flex items-center gap-2">
                        <span className="text-sm text-gray-700 w-28 shrink-0 truncate">{r.label}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${(r.n / s.data[0].n) * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-8 text-right">{r.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {resume.meilleure && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-1">La meilleure</p>
                  <p className="text-sm font-semibold text-gray-800">{resume.meilleure.biere.nom}</p>
                  <Note valeur={resume.meilleure.moyenne} taille="sm" />
                </div>
                {resume.pire && resume.pire.biere.id !== resume.meilleure.biere.id && (
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-rose-700 uppercase tracking-wider mb-1">La moins bonne</p>
                    <p className="text-sm font-semibold text-gray-800">{resume.pire.biere.nom}</p>
                    <Note valeur={resume.pire.moyenne} taille="sm" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modale fiche bière ─────────────────────────────────────────────── */}
      <Modal isOpen={ficheOuverte} onClose={() => setFicheOuverte(false)}
        title={ficheEditee ? 'Modifier la bière' : 'Nouvelle bière'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="Duvel, Licorne Blonde…" className={champCls} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <Chips options={TYPES_BIERE} valeur={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Typologie</label>
            <Chips options={TYPOLOGIES} valeur={form.typologie} onChange={(v) => setForm((f) => ({ ...f, typologie: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
            <Chips options={SERVICES} valeur={form.service} onChange={(v) => setForm((f) => ({ ...f, service: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Degrés</label>
              <input type="text" inputMode="decimal" value={form.degres}
                onChange={(e) => setForm((f) => ({ ...f, degres: e.target.value.replace(/[^\d,.]/g, '') }))}
                placeholder="6,5" className={champCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amertume (IBU)</label>
              <input type="text" inputMode="decimal" value={form.ibu}
                onChange={(e) => setForm((f) => ({ ...f, ibu: e.target.value.replace(/[^\d,.]/g, '') }))}
                placeholder="40" className={champCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Origine</label>
            <input value={form.origine} onChange={(e) => setForm((f) => ({ ...f, origine: e.target.value }))}
              placeholder="Belgique, Bretagne…" className={champCls} />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setFicheOuverte(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={enregistrerFiche} disabled={enCours || !form.nom.trim()}
              className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
              {enCours ? '…' : ficheEditee ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modale dégustation ─────────────────────────────────────────────── */}
      <Modal isOpen={!!degPour} onClose={() => { setDegPour(null); setDegEditee(null) }}
        title={degPour ? `${degEditee ? 'Modifier la dégustation' : 'Dégustation'} — ${degPour.biere.nom}` : ''} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={degForm.date}
                onChange={(e) => setDegForm((f) => ({ ...f, date: e.target.value }))} className={champCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Température (°C)</label>
              <input type="text" inputMode="decimal" value={degForm.temperature}
                onChange={(e) => setDegForm((f) => ({ ...f, temperature: e.target.value.replace(/[^\d,.-]/g, '') }))}
                placeholder="18" className={champCls} />
            </div>
          </div>

          {/* Une note par personne : corriger la sienne ne touche pas à celle de l'autre */}
          <div className="space-y-3">
            {membresNotes.map((m) => (
              <ChoixNote key={m} libelle={`Note de ${prenom(m)}`} valeur={degNotes[m] ?? null}
                onChange={(v) => setDegNotes((n) => ({ ...n, [m]: v }))} />
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avis</label>
            <AutoTextarea value={degForm.analyse} onChange={(v) => setDegForm((f) => ({ ...f, analyse: v }))}
              minRows={2} placeholder="Amère, fruitée, trop sucrée…" className={champCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bar / Ville</label>
              <input value={degForm.lieu} onChange={(e) => setDegForm((f) => ({ ...f, lieu: e.target.value }))}
                placeholder="De Garre, Bruges" className={champCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Coordonnées GPS</label>
              <input value={degForm.gps} onChange={(e) => setDegForm((f) => ({ ...f, gps: e.target.value }))}
                placeholder="47.6293, -2.7791" className={champCls} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Événement</label>
            <input value={degForm.evenement} onChange={(e) => setDegForm((f) => ({ ...f, evenement: e.target.value }))}
              placeholder="Festival interceltique, week-end…" className={champCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contexte</label>
            <Chips options={CONTEXTES} valeur={degForm.contexte} onChange={(v) => setDegForm((f) => ({ ...f, contexte: v }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Météo</label>
              <Chips options={METEOS} valeur={degForm.meteo} onChange={(v) => setDegForm((f) => ({ ...f, meteo: v }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ressenti</label>
              <Chips options={RESSENTIS} valeur={degForm.ressenti} onChange={(v) => setDegForm((f) => ({ ...f, ressenti: v }))} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Photos</label>
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {photos.map((p) => (
                  <div key={p} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt="" className="w-20 h-20 rounded-xl object-cover" />
                    <button type="button" onClick={() => setPhotos((l) => l.filter((x) => x !== p))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-600 text-xs shadow">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition cursor-pointer">
              <Camera size={15} />
              {envoiPhoto ? 'Envoi…' : 'Ajouter une photo'}
              <input type="file" accept="image/*" className="hidden" disabled={envoiPhoto}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) envoyerPhoto(f); e.target.value = '' }} />
            </label>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setDegPour(null); setDegEditee(null) }}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={enregistrerDegustation} disabled={enCours}
              className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
              {enCours ? '…' : degEditee ? 'Enregistrer les modifications' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Confirmation suppression ───────────────────────────────────────── */}
      <Modal isOpen={!!aSupprimer} onClose={() => setASupprimer(null)} title="Supprimer la bière" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Supprimer <strong>{aSupprimer?.biere.nom}</strong> effacera aussi ses{' '}
            {aSupprimer?.nbDegustations ?? 0} dégustation{(aSupprimer?.nbDegustations ?? 0) > 1 ? 's' : ''}.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setASupprimer(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => {
              if (aSupprimer) await supprimerBiere(aSupprimer.biere.id)
              setASupprimer(null); setDeplie(null)
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
