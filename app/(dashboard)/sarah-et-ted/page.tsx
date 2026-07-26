'use client'

import { useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useDuoFilms, useDuoActivites, useDuoParties } from '@/hooks/useDuo'
import { useDuoCouple } from '@/hooks/useDuoCouple'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { DuoShareModal } from '@/components/duo/DuoShareModal'
import { Timestamp } from 'firebase/firestore'
import {
  Plus, Pencil, Trash2, Search, MapPin, Film, Compass, Dices, Check, Trophy, X, ChevronLeft, Users,
  Star, Eye, LocateFixed,
} from 'lucide-react'
import {
  TYPES_FILM, PLATEFORMES, CATEGORIES_FILM, SAISONS_PARTIES, TYPES_ACTIVITE, PRIORITES, GAMMES_PRIX,
  JEUX_COURANTS, categoriesFilm, classementPartie, palmares,
} from '@/lib/duoModel'
import { positionActuelle, formatCoords } from '@/lib/geoloc'
import type { DuoActivite, DuoFilm, DuoPartie } from '@/types'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500'
const chipCls = (actif: boolean) =>
  `px-3 py-1.5 rounded-xl text-sm border transition ${
    actif ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
  }`

function Chips({ options, valeur, onChange }: {
  options: readonly string[]; valeur: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(valeur === o ? '' : o)} className={chipCls(valeur === o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/**
 * Choix unique + pastille « Autre » qui ouvre un champ libre : c'est le texte
 * saisi qui est enregistré, pas le mot « Autre ».
 *
 * ⚠️ `libre` est porté par le formulaire (et non par un état interne) : la
 * modale est montée en permanence, un état interne resterait sur la fiche
 * précédente à la réouverture.
 */
function ChipsAutre({ options, valeur, libre, onChange, placeholder }: {
  options: readonly string[]
  valeur: string
  libre: boolean
  onChange: (valeur: string, libre: boolean) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(!libre && valeur === o ? '' : o, false)}
            className={chipCls(!libre && valeur === o)}>
            {o}
          </button>
        ))}
        <button type="button" onClick={() => onChange('', !libre)} className={chipCls(libre)}>Autre…</button>
      </div>
      {libre && (
        <input value={valeur} onChange={(e) => onChange(e.target.value, true)}
          placeholder={placeholder} className={champCls} />
      )}
    </div>
  )
}

/** Choix multiple + création d'une valeur absente de la liste (elle rejoint les pastilles). */
function ChipsMulti({ options, valeurs, onChange, placeholder }: {
  options: readonly string[]
  valeurs: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [saisie, setSaisie] = useState<string | null>(null)

  const basculer = (o: string) =>
    onChange(valeurs.includes(o) ? valeurs.filter((v) => v !== o) : [...valeurs, o])

  const ajouter = () => {
    const v = (saisie ?? '').trim()
    if (v && !valeurs.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...valeurs, v])
    setSaisie(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const actif = valeurs.includes(o)
          return (
            <button key={o} type="button" onClick={() => basculer(o)}
              className={`${chipCls(actif)} inline-flex items-center gap-1`}>
              {actif && <Check size={13} />}{o}
            </button>
          )
        })}
        <button type="button" onClick={() => setSaisie(saisie === null ? '' : null)}
          className={`${chipCls(false)} inline-flex items-center gap-1 border-dashed`}>
          <Plus size={13} />Autre
        </button>
      </div>
      {saisie !== null && (
        <div className="flex gap-2">
          <input value={saisie} onChange={(e) => setSaisie(e.target.value)} autoFocus placeholder={placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter() } }}
            className={champCls} />
          <button type="button" onClick={ajouter} disabled={!saisie.trim()}
            className="px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm shrink-0">
            Ajouter
          </button>
        </div>
      )}
    </div>
  )
}

/** Champ libre + raccourcis en pastilles (la pastille remplit le champ). */
function ChampAvecChips({ valeur, options, onChange, placeholder }: {
  valeur: string; options: readonly string[]; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <>
      <input value={valeur} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={champCls} />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(valeur === o ? '' : o)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition ${
              valeur === o ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-600 hover:border-rose-300'
            }`}>
            {o}
          </button>
        ))}
      </div>
    </>
  )
}

/** Note de 1 à 5. Re-cliquer l'étoile courante efface la note. */
function Etoiles({ note, onChange, taille = 22 }: {
  note?: number; onChange?: (n: number | undefined) => void; taille?: number
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const pleine = n <= (note ?? 0)
        return (
          <button key={n} type="button" disabled={!onChange}
            onClick={() => onChange?.(note === n ? undefined : n)}
            title={onChange ? (note === n ? 'Retirer la note' : `Noter ${n} sur 5`) : undefined}
            aria-label={`${n} sur 5`}
            className={`${onChange ? 'cursor-pointer' : 'cursor-default'} leading-none transition ${
              onChange && !pleine ? 'text-gray-300 hover:text-amber-300' : ''
            } ${pleine ? 'text-amber-400' : 'text-gray-300'}`}>
            <Star size={taille} strokeWidth={1.75} className={pleine ? 'fill-amber-400' : 'fill-transparent'} />
          </button>
        )
      })}
    </span>
  )
}

/** Interrupteur libellé — plus lisible qu'une case à cocher au rendu du système. */
function Interrupteur({ actif, onChange, titre, aide, icone: Icone }: {
  actif: boolean
  onChange: (v: boolean) => void
  titre: string
  aide?: string
  icone: typeof Eye
}) {
  return (
    <button type="button" role="switch" aria-checked={actif} onClick={() => onChange(!actif)}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        actif ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition ${
        actif ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'
      }`}>
        <Icone size={15} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800">{titre}</span>
        {aide && <span className="block text-xs text-gray-500">{aide}</span>}
      </span>
      <span className={`w-10 h-6 rounded-full p-0.5 shrink-0 transition ${actif ? 'bg-emerald-500' : 'bg-gray-200'}`}>
        <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${actif ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

const dateInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const versTimestamp = (s: string) => {
  if (!s) return undefined
  const [y, m, j] = s.split('-').map(Number)
  return Timestamp.fromDate(new Date(y, m - 1, j, 12))
}

export default function ADeuxPage() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const films = useDuoFilms(uid)
  const activites = useDuoActivites(uid)
  const parties = useDuoParties(uid)

  /**
   * `null` = accueil. On n'entre dans une section qu'en la choisissant :
   * trois listes empilées derrière des onglets donnaient l'impression que tout
   * était mélangé, alors que ce sont trois usages distincts.
   */
  const [section, setSection] = useState<'films' | 'activites' | 'jeux' | null>(null)
  const [recherche, setRecherche] = useState('')
  const [partageOuvert, setPartageOuvert] = useState(false)

  // Membres du couple (les deux UID une fois liés) : recopiés dans `members[]` à
  // chaque écriture pour que Sarah et Ted voient tout — cf. useDuoCouple.
  const couple = useDuoCouple(uid)
  const base = uid ? { members: couple.members, createdBy: uid } : null

  // Compte INVITÉ (lié à un couple qu'il n'a pas créé) → accès gratuit, sans
  // abonnement propre : le partage est inclus dans l'abonnement de celui qui invite.
  // On laisse aussi passer pendant le chargement, sinon l'invité voit brièvement
  // « Accès non activé » avant l'arrivée du couple.
  const isSharedGuest = !!uid && !!couple.createdBy && couple.createdBy !== uid
  const gateBypass = isSharedGuest || couple.loading

  // ── À voir ─────────────────────────────────────────────────────────────────
  const [filtreVu, setFiltreVu] = useState<'tous' | 'a_voir' | 'vus'>('tous')
  const [filtreType, setFiltreType] = useState('')
  const [filmOuvert, setFilmOuvert] = useState(false)
  const [filmEdite, setFilmEdite] = useState<DuoFilm | null>(null)
  const filmVide = {
    type: 'Film', nom: '', plateforme: '', plateformeLibre: false, categories: [] as string[],
    note: undefined as number | undefined, vu: false, dateSortie: '', saison: '', infos: '',
  }
  const [filmForm, setFilmForm] = useState(filmVide)

  const listeFilms = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return (films.items as DuoFilm[])
      .filter((f) => {
        if (filtreVu === 'a_voir' && f.vu) return false
        if (filtreVu === 'vus' && !f.vu) return false
        if (filtreType && f.type !== filtreType) return false
        if (q && !`${f.nom} ${categoriesFilm(f).join(' ')} ${f.infos ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => Number(a.vu ?? false) - Number(b.vu ?? false) || a.nom.localeCompare(b.nom))
  }, [films.items, filtreVu, filtreType, recherche])

  /** Catégories proposées : la liste d'origine + celles déjà créées à la main */
  const categoriesConnues = useMemo(() => {
    const s = new Set<string>(CATEGORIES_FILM)
    for (const f of films.items as DuoFilm[]) for (const c of categoriesFilm(f)) s.add(c)
    return [...s]
  }, [films.items])

  const ouvrirFilm = (f?: DuoFilm) => {
    setFilmEdite(f ?? null)
    setFilmForm(f ? {
      type: f.type, nom: f.nom,
      // Une plateforme hors liste (ou l'ancien « Autre » d'AppSheet) rouvre le champ libre
      plateforme: f.plateforme === 'Autre' ? '' : f.plateforme ?? '',
      plateformeLibre: !!f.plateforme && !(PLATEFORMES as readonly string[]).includes(f.plateforme),
      categories: categoriesFilm(f),
      note: f.note, vu: !!f.vu, dateSortie: f.dateSortie ? dateInput(f.dateSortie.toDate()) : '',
      saison: f.saison ?? '', infos: f.infos ?? '',
    } : filmVide)
    setFilmOuvert(true)
  }

  const enregistrerFilm = async () => {
    if (!base || !filmForm.nom.trim()) return
    const categories = filmForm.categories.map((c) => c.trim()).filter(Boolean)
    const champs = {
      type: filmForm.type, nom: filmForm.nom.trim(), plateforme: filmForm.plateforme.trim(),
      categories,
      // Champ historique tenu à jour : les fiches importées et les scripts le lisent encore
      categorie: categories[0] ?? '',
      note: filmForm.note ?? null, vu: filmForm.vu,
      dateSortie: versTimestamp(filmForm.dateSortie) ?? null,
      saison: filmForm.saison.trim(), infos: filmForm.infos.trim(),
    }
    if (filmEdite) await films.modifier(filmEdite.id, champs)
    else await films.ajouter({ ...base, ...champs })
    setFilmOuvert(false)
  }

  // ── À faire ────────────────────────────────────────────────────────────────
  const [filtreFait, setFiltreFait] = useState<'tous' | 'a_faire' | 'faits'>('tous')
  const [filtreTypeAct, setFiltreTypeAct] = useState('')
  const [actOuverte, setActOuverte] = useState(false)
  const [actEditee, setActEditee] = useState<DuoActivite | null>(null)
  const actVide = {
    nom: '', type: '', typeLibre: false, zone: '', gps: '', fait: false,
    note: undefined as number | undefined,
    priorite: '', conseillePar: '', lien: '', gammePrix: '', infos: '',
  }
  const [actForm, setActForm] = useState(actVide)
  const [gpsEnCours, setGpsEnCours] = useState(false)
  const [gpsRefuse, setGpsRefuse] = useState(false)

  /** Remplit les coordonnées avec la position du téléphone (droit à demander une fois). */
  const prendrePositionActuelle = async () => {
    setGpsEnCours(true)
    setGpsRefuse(false)
    try {
      const p = await positionActuelle()
      if (p) setActForm((f) => ({ ...f, gps: formatCoords(p) }))
      else setGpsRefuse(true)
    } finally {
      setGpsEnCours(false)
    }
  }

  const listeActivites = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return (activites.items as DuoActivite[])
      .filter((a) => {
        if (filtreFait === 'a_faire' && a.fait) return false
        if (filtreFait === 'faits' && !a.fait) return false
        if (filtreTypeAct && a.type !== filtreTypeAct) return false
        if (q && !`${a.nom} ${a.zone ?? ''} ${a.infos ?? ''} ${a.conseillePar ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => Number(a.fait ?? false) - Number(b.fait ?? false) || a.nom.localeCompare(b.nom))
  }, [activites.items, filtreFait, filtreTypeAct, recherche])

  const ouvrirActivite = (a?: DuoActivite) => {
    setActEditee(a ?? null)
    setGpsRefuse(false)
    setActForm(a ? {
      nom: a.nom,
      type: a.type === 'Autre' ? '' : a.type ?? '',
      typeLibre: !!a.type && !(TYPES_ACTIVITE as readonly string[]).includes(a.type),
      zone: a.zone ?? '', gps: a.gps ?? '', fait: !!a.fait,
      note: a.note, priorite: a.priorite ?? '', conseillePar: a.conseillePar ?? '',
      lien: a.lien ?? '', gammePrix: a.gammePrix ?? '', infos: a.infos ?? '',
    } : actVide)
    setActOuverte(true)
  }

  const enregistrerActivite = async () => {
    if (!base || !actForm.nom.trim()) return
    const champs = {
      nom: actForm.nom.trim(), type: actForm.type.trim(), zone: actForm.zone.trim(),
      gps: actForm.gps.trim(), fait: actForm.fait, note: actForm.note ?? null,
      priorite: actForm.priorite, conseillePar: actForm.conseillePar.trim(),
      lien: actForm.lien.trim(), gammePrix: actForm.gammePrix, infos: actForm.infos.trim(),
    }
    if (actEditee) await activites.modifier(actEditee.id, champs)
    else await activites.ajouter({ ...base, ...champs })
    setActOuverte(false)
  }

  // ── Scores ─────────────────────────────────────────────────────────────────
  const [partieOuverte, setPartieOuverte] = useState(false)
  const [partieForm, setPartieForm] = useState({ jeu: '', date: '', joueurs: [''], scoreBasGagne: false })
  const [partieActive, setPartieActive] = useState<string | null>(null)
  const [tourForm, setTourForm] = useState<Record<string, string>>({})

  const listeParties = useMemo(
    () => (parties.items as DuoPartie[]).sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0)),
    [parties.items],
  )
  const classementGeneral = useMemo(() => palmares(parties.items as DuoPartie[]), [parties.items])

  const creerPartie = async () => {
    if (!base || !partieForm.jeu.trim()) return
    const joueurs = partieForm.joueurs.map((j) => j.trim()).filter(Boolean)
    if (joueurs.length < 2) return
    const id = await parties.ajouter({
      ...base, jeu: partieForm.jeu.trim(),
      date: versTimestamp(partieForm.date) ?? Timestamp.now(),
      joueurs, tours: [], scoreBasGagne: partieForm.scoreBasGagne, termine: false,
    })
    setPartieOuverte(false)
    setPartieActive(id)
  }

  /** Joueurs déjà vus : on les propose en pastilles plutôt que de les retaper */
  const joueursConnus = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of parties.items as DuoPartie[]) {
      for (const j of p.joueurs) m.set(j, (m.get(j) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([j]) => j)
  }, [parties.items])

  /** Partie et index du tour en cours de saisie (index null = nouveau tour) */
  const [tourPour, setTourPour] = useState<{ partie: DuoPartie; index: number | null } | null>(null)

  const ouvrirTour = (partie: DuoPartie, index: number | null) => {
    const t = index !== null ? partie.tours?.[index] : null
    setTourForm(Object.fromEntries(
      partie.joueurs.map((j) => [j, String(t?.scores.find((s) => s.joueur === j)?.points ?? '')]),
    ))
    setTourPour({ partie, index })
  }

  const enregistrerTour = async () => {
    if (!tourPour) return
    const { partie, index } = tourPour
    const scores = partie.joueurs.map((j) => ({ joueur: j, points: Number(tourForm[j] ?? 0) || 0 }))
    const tours = [...(partie.tours ?? [])]
    if (index === null) tours.push({ scores })
    else tours[index] = { scores }
    await parties.modifier(partie.id, { tours })
    setTourPour(null)
    setTourForm({})
  }

  const retirerTour = async (p: DuoPartie, index: number) => {
    await parties.modifier(p.id, { tours: (p.tours ?? []).filter((_, i) => i !== index) })
  }

  /** Total actuel d'un joueur, hors tour en cours d'édition */
  const totalAvant = (p: DuoPartie, joueur: string, sauf: number | null) =>
    (p.tours ?? []).reduce((s, t, i) => (i === sauf ? s : s + (t.scores.find((x) => x.joueur === joueur)?.points ?? 0)), 0)

  const [aSupprimer, setASupprimer] = useState<{ quoi: string; nom: string; go: () => Promise<void> } | null>(null)

  const chargement = films.loading && activites.loading && parties.loading
  if (chargement) {
    return (
      <StoreGate appRoute="/sarah-et-ted" bypass={gateBypass}>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-rose-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </StoreGate>
    )
  }

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={gateBypass}>
      <div className="space-y-5 max-w-full">
        {/* ══ ACCUEIL : une carte par section ══ */}
        {section === null ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900">Sarah &amp; Ted</h1>
                <p className="text-sm text-gray-500">Choisis une section.</p>
              </div>
              <button onClick={() => setPartageOuvert(true)}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 text-sm font-medium px-3 py-2 rounded-xl transition shrink-0">
                <Users size={16} />Partager
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                {
                  k: 'films', icon: Film, titre: 'Films & séries',
                  desc: 'Ce qu’on veut regarder', couleur: 'bg-indigo-100 text-indigo-600',
                  total: (films.items as DuoFilm[]).length,
                  reste: (films.items as DuoFilm[]).filter((f) => !f.vu).length,
                  resteLabel: 'à voir',
                },
                {
                  k: 'activites', icon: Compass, titre: 'Activités',
                  desc: 'Les endroits et les sorties', couleur: 'bg-emerald-100 text-emerald-600',
                  total: (activites.items as DuoActivite[]).length,
                  reste: (activites.items as DuoActivite[]).filter((a) => !a.fait).length,
                  resteLabel: 'à faire',
                },
                {
                  k: 'jeux', icon: Dices, titre: 'Jeux',
                  desc: 'Les scores des parties', couleur: 'bg-amber-100 text-amber-600',
                  total: (parties.items as DuoPartie[]).length,
                  reste: 0, resteLabel: '',
                },
              ] as const).map((s) => {
                const Icon = s.icon
                return (
                  <button key={s.k} onClick={() => { setSection(s.k); setRecherche('') }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-rose-200 transition active:scale-[0.99]">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${s.couleur}`}>
                      <Icon size={22} />
                    </div>
                    <p className="text-base font-semibold text-gray-900">{s.titre}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                    <p className="text-sm text-gray-700 mt-3">
                      <strong>{s.total}</strong> {s.k === 'jeux' ? `partie${s.total > 1 ? 's' : ''}` : 'enregistré' + (s.total > 1 ? 's' : '')}
                      {s.reste > 0 && (
                        <span className="text-rose-600 font-medium"> · {s.reste} {s.resteLabel}</span>
                      )}
                    </p>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            {/* En-tête de section : retour visible, titre de la section ouverte */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button onClick={() => setSection(null)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition mb-1">
                  <ChevronLeft size={14} />Sarah &amp; Ted
                </button>
                <h1 className="text-xl font-bold text-gray-900">
                  {section === 'films' ? 'Films & séries' : section === 'activites' ? 'Activités' : 'Jeux'}
                </h1>
              </div>
              <button
                onClick={() => (section === 'films' ? ouvrirFilm() : section === 'activites' ? ouvrirActivite() : setPartieOuverte(true))}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition shrink-0">
                <Plus size={16} />Ajouter
              </button>
            </div>

            {section !== 'jeux' && (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Rechercher…" className={`${champCls} pl-9`} />
              </div>
            )}
          </>
        )}

        {/* ══ À VOIR ══ */}
        {section === 'films' && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {([['tous', 'Tous'], ['a_voir', 'À voir'], ['vus', 'Vus']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFiltreVu(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filtreVu === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <Chips options={TYPES_FILM} valeur={filtreType} onChange={setFiltreType} />
            </div>

            {listeFilms.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">Rien pour l&apos;instant.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {listeFilms.map((f) => (
                  <div key={f.id} className={`rounded-2xl border shadow-sm px-4 py-3 ${f.vu ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => films.modifier(f.id, { vu: !f.vu })}
                        title={f.vu ? 'Marquer comme non vu' : 'Marquer comme vu'}
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 transition ${
                          f.vu ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'
                        }`}>
                        <Check size={14} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold break-words ${f.vu ? 'text-gray-500' : 'text-gray-800'}`}>{f.nom}</p>
                        <p className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                          {[f.type, f.plateforme, categoriesFilm(f).join(', '), f.saison]
                            .filter(Boolean).map((t, i) => <span key={i}>{t}</span>)}
                          {f.dateSortie && <span>sortie le {f.dateSortie.toDate().toLocaleDateString('fr-FR')}</span>}
                        </p>
                        {f.infos && <p className="text-xs text-gray-500 italic mt-1 break-words">{f.infos}</p>}
                        <div className="mt-1"><Etoiles note={f.note} onChange={(n) => films.modifier(f.id, { note: n ?? null })} taille={14} /></div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => ouvrirFilm(f)} className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                        <button onClick={() => setASupprimer({ quoi: 'ce titre', nom: f.nom, go: () => films.supprimer(f.id) })}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ À FAIRE ══ */}
        {section === 'activites' && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {([['tous', 'Tous'], ['a_faire', 'À faire'], ['faits', 'Faits']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFiltreFait(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filtreFait === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <Chips options={TYPES_ACTIVITE} valeur={filtreTypeAct} onChange={setFiltreTypeAct} />
            </div>

            {listeActivites.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">Rien pour l&apos;instant.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {listeActivites.map((a) => (
                  <div key={a.id} className={`rounded-2xl border shadow-sm px-4 py-3 ${a.fait ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => activites.modifier(a.id, { fait: !a.fait })}
                        title={a.fait ? 'Marquer comme à faire' : 'Marquer comme fait'}
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 transition ${
                          a.fait ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'
                        }`}>
                        <Check size={14} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold break-words ${a.fait ? 'text-gray-500' : 'text-gray-800'}`}>{a.nom}</p>
                        <p className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                          {[a.type, a.zone, a.gammePrix, a.priorite].filter(Boolean).map((t, i) => <span key={i}>{t}</span>)}
                          {a.conseillePar && <span>conseillé par {a.conseillePar}</span>}
                        </p>
                        {a.infos && <p className="text-xs text-gray-500 italic mt-1 break-words">{a.infos}</p>}
                        <div className="flex items-center gap-3 mt-1">
                          <Etoiles note={a.note} onChange={(n) => activites.modifier(a.id, { note: n ?? null })} taille={14} />
                          {a.gps && (
                            <a href={`https://maps.google.com/?q=${encodeURIComponent(a.gps)}`} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-xs text-rose-600 hover:underline">
                              <MapPin size={12} />carte
                            </a>
                          )}
                          {a.lien && (
                            <a href={a.lien} target="_blank" rel="noopener noreferrer" className="text-xs text-rose-600 hover:underline">site</a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => ouvrirActivite(a)} className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                        <button onClick={() => setASupprimer({ quoi: 'cette activité', nom: a.nom, go: () => activites.supprimer(a.id) })}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ SCORES ══ */}
        {section === 'jeux' && (
          <>
            {classementGeneral.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Trophy size={13} />Palmarès — toutes parties
                </p>
                <div className="space-y-1.5">
                  {classementGeneral.map((j) => (
                    <div key={j.joueur} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-700">{j.joueur}</span>
                      <span className="text-xs text-gray-500">
                        <strong className="text-gray-800">{j.victoires}</strong> victoire{j.victoires > 1 ? 's' : ''} / {j.parties}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {listeParties.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                <Dices size={28} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Aucune partie enregistrée.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* En cours d'abord : c'est là qu'on saisit, le reste est de l'archive */}
                {([
                  { titre: 'Parties en cours', liste: listeParties.filter((p) => !p.termine) },
                  { titre: 'Parties terminées', liste: listeParties.filter((p) => p.termine) },
                ]).filter((g) => g.liste.length > 0).map((groupe) => (
                  <div key={groupe.titre} className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {groupe.titre} · {groupe.liste.length}
                    </p>
                    {groupe.liste.map((p) => {
                  const ouvert = partieActive === p.id
                  const cl = classementPartie(p)
                  const vainqueur = p.tours?.length ? cl[0] : null
                  return (
                    <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <button onClick={() => { setPartieActive(ouvert ? null : p.id); setTourForm({}) }}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{p.jeu}</p>
                          <p className="text-xs text-gray-500">
                            {p.date?.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {' · '}{p.joueurs.join(', ')}
                            {' · '}{p.tours?.length ?? 0} tour{(p.tours?.length ?? 0) > 1 ? 's' : ''}
                          </p>
                        </div>
                        {vainqueur && (
                          <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 font-medium shrink-0">
                            🏆 {vainqueur.joueur} · {vainqueur.total}
                          </span>
                        )}
                      </button>

                      {ouvert && (
                        <div className="border-t border-gray-50 px-4 py-3 space-y-3">
                          {/* Bouton principal : saisir un tour, sans avoir à viser un champ */}
                          {!p.termine && (
                            <button onClick={() => ouvrirTour(p, null)}
                              className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium py-2.5 rounded-xl transition">
                              <Plus size={16} />Ajouter un tour
                            </button>
                          )}

                          {/* Classement */}
                          <div className="space-y-1">
                            {cl.map((c) => (
                              <div key={c.joueur} className="flex items-center gap-2">
                                <span className={`text-xs font-bold w-5 ${c.rang === 1 && p.tours?.length ? 'text-amber-500' : 'text-gray-300'}`}>
                                  {c.rang}
                                </span>
                                <span className="text-sm text-gray-700 flex-1 truncate">{c.joueur}</span>
                                <span className="text-sm font-semibold text-gray-800">{c.total}</span>
                              </div>
                            ))}
                            <p className="text-[11px] text-gray-400 pt-1">
                              {p.scoreBasGagne ? 'Le plus petit score gagne.' : 'Le plus grand score gagne.'}
                            </p>
                          </div>

                          {/* Tours joués — cliquer un tour le corrige */}
                          {(p.tours?.length ?? 0) > 0 && (
                            <div className="border-t border-dashed border-gray-200 pt-2 space-y-1">
                              {p.tours.map((t, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <button onClick={() => ouvrirTour(p, i)}
                                    className="flex-1 flex items-center gap-2 text-left hover:bg-gray-50 rounded-lg px-1 py-1 transition">
                                    <span className="text-gray-400 w-12 shrink-0">Tour {i + 1}</span>
                                    <span className="flex-1 text-gray-600 truncate">
                                      {t.scores.map((s) => `${s.joueur} ${s.points}`).join(' · ')}
                                    </span>
                                    <Pencil size={11} className="text-gray-300 shrink-0" />
                                  </button>
                                  <button onClick={() => retirerTour(p, i)}
                                    className="p-1 text-gray-300 hover:text-red-500 transition"><X size={12} /></button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="border-t border-dashed border-gray-200 pt-3">
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => parties.modifier(p.id, { termine: !p.termine })}
                                className="border border-gray-300 text-gray-700 text-xs px-3 py-2 rounded-xl hover:bg-gray-50 transition">
                                {p.termine ? 'Rouvrir la partie' : 'Terminer la partie'}
                              </button>
                              <button onClick={() => setASupprimer({ quoi: 'cette partie', nom: p.jeu, go: () => parties.supprimer(p.id) })}
                                className="text-xs text-gray-400 hover:text-red-600 px-3 py-2 transition">
                                Supprimer
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modale saisie d'un tour ────────────────────────────────────────── */}
      <Modal isOpen={!!tourPour} onClose={() => setTourPour(null)}
        title={tourPour ? (tourPour.index === null
          ? `Tour ${(tourPour.partie.tours?.length ?? 0) + 1} — ${tourPour.partie.jeu}`
          : `Corriger le tour ${tourPour.index + 1} — ${tourPour.partie.jeu}`) : ''}>
        {tourPour && (
          <div className="space-y-4">
            <div className="space-y-2">
              {tourPour.partie.joueurs.map((j) => {
                const avant = totalAvant(tourPour.partie, j, tourPour.index)
                const saisi = Number(tourForm[j] ?? 0) || 0
                return (
                  <div key={j} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{j}</p>
                      {/* Le total à jour évite de compter de tête entre deux manches */}
                      <p className="text-[11px] text-gray-400">
                        {avant} → <span className="text-gray-700 font-medium">{avant + saisi}</span>
                      </p>
                    </div>
                    <input type="number" inputMode="numeric" value={tourForm[j] ?? ''}
                      onChange={(e) => setTourForm((f) => ({ ...f, [j]: e.target.value }))}
                      placeholder="0"
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-base text-right focus:outline-none focus:ring-2 focus:ring-rose-500" />
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setTourPour(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Annuler
              </button>
              <button onClick={enregistrerTour}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-xl text-sm font-medium transition">
                {tourPour.index === null ? 'Ajouter le tour' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modale film / série ────────────────────────────────────────────── */}
      <Modal isOpen={filmOuvert} onClose={() => setFilmOuvert(false)} title={filmEdite ? 'Modifier' : 'Ajouter un film ou une série'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <Chips options={TYPES_FILM} valeur={filmForm.type} onChange={(v) => setFilmForm((f) => ({ ...f, type: v || 'Film' }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titre</label>
            <input value={filmForm.nom} onChange={(e) => setFilmForm((f) => ({ ...f, nom: e.target.value }))} className={champCls} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plateforme</label>
            <ChipsAutre options={PLATEFORMES} valeur={filmForm.plateforme} libre={filmForm.plateformeLibre}
              placeholder="OCS, Apple TV+, DVD…"
              onChange={(v, libre) => setFilmForm((f) => ({ ...f, plateforme: v, plateformeLibre: libre }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Catégories <span className="text-gray-400 font-normal">(plusieurs possibles)</span>
            </label>
            <ChipsMulti options={categoriesConnues} valeurs={filmForm.categories} placeholder="Science-fiction, Animation…"
              onChange={(v) => setFilmForm((f) => ({ ...f, categories: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de sortie</label>
            <input type="date" value={filmForm.dateSortie} onChange={(e) => setFilmForm((f) => ({ ...f, dateSortie: e.target.value }))} className={champCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Saison / partie</label>
            <ChampAvecChips valeur={filmForm.saison} options={SAISONS_PARTIES} placeholder="Saison 2, Partie 1…"
              onChange={(v) => setFilmForm((f) => ({ ...f, saison: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <Etoiles note={filmForm.note} onChange={(n) => setFilmForm((f) => ({ ...f, note: n }))} />
          </div>
          <Interrupteur actif={filmForm.vu} onChange={(v) => setFilmForm((f) => ({ ...f, vu: v }))}
            titre="Déjà vu" aide="Le titre rejoint la liste des « Vus »." icone={Eye} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Infos</label>
            <AutoTextarea value={filmForm.infos} onChange={(v) => setFilmForm((f) => ({ ...f, infos: v }))} minRows={2}
              placeholder="Qui l'a conseillé, de quoi ça parle…" className={champCls} />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setFilmOuvert(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={enregistrerFilm} disabled={!filmForm.nom.trim()}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">Enregistrer</button>
          </div>
        </div>
      </Modal>

      {/* ── Modale activité ────────────────────────────────────────────────── */}
      <Modal isOpen={actOuverte} onClose={() => setActOuverte(false)} title={actEditee ? 'Modifier' : 'Ajouter une activité'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input value={actForm.nom} onChange={(e) => setActForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="1930 Conleau, Dent de Jaman…" className={champCls} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <ChipsAutre options={TYPES_ACTIVITE} valeur={actForm.type} libre={actForm.typeLibre}
              placeholder="Musée, Randonnée, Concert…"
              onChange={(v, libre) => setActForm((f) => ({ ...f, type: v, typeLibre: libre }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone / ville</label>
              <input value={actForm.zone} onChange={(e) => setActForm((f) => ({ ...f, zone: e.target.value }))} placeholder="Vannes" className={champCls} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-sm font-medium text-gray-700">Coordonnées GPS</label>
                <button type="button" onClick={prendrePositionActuelle} disabled={gpsEnCours}
                  className="text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1 disabled:opacity-60 shrink-0">
                  <LocateFixed size={13} />{gpsEnCours ? 'Localisation…' : 'Ma position'}
                </button>
              </div>
              <input value={actForm.gps} onChange={(e) => setActForm((f) => ({ ...f, gps: e.target.value }))}
                placeholder="47.6293, -2.7791" className={champCls} />
              {gpsRefuse && (
                <p className="text-xs text-amber-600 mt-1">
                  Position indisponible — autorisez la localisation pour ce site, ou saisissez les coordonnées à la main.
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priorité</label>
            <Chips options={PRIORITES} valeur={actForm.priorite} onChange={(v) => setActForm((f) => ({ ...f, priorite: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gamme de prix</label>
            <Chips options={GAMMES_PRIX} valeur={actForm.gammePrix} onChange={(v) => setActForm((f) => ({ ...f, gammePrix: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conseillé par</label>
              <input value={actForm.conseillePar} onChange={(e) => setActForm((f) => ({ ...f, conseillePar: e.target.value }))} className={champCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lien</label>
              <input value={actForm.lien} onChange={(e) => setActForm((f) => ({ ...f, lien: e.target.value }))} placeholder="https://" className={champCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <Etoiles note={actForm.note} onChange={(n) => setActForm((f) => ({ ...f, note: n }))} />
          </div>
          <Interrupteur actif={actForm.fait} onChange={(v) => setActForm((f) => ({ ...f, fait: v }))}
            titre="Déjà fait" aide="L'activité rejoint la liste des « Faits »." icone={Check} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Infos</label>
            <AutoTextarea value={actForm.infos} onChange={(v) => setActForm((f) => ({ ...f, infos: v }))} minRows={2} className={champCls} />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setActOuverte(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={enregistrerActivite} disabled={!actForm.nom.trim()}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">Enregistrer</button>
          </div>
        </div>
      </Modal>

      {/* ── Modale nouvelle partie ─────────────────────────────────────────── */}
      <Modal isOpen={partieOuverte} onClose={() => setPartieOuverte(false)} title="Nouvelle partie">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jeu</label>
            <input value={partieForm.jeu} onChange={(e) => setPartieForm((f) => ({ ...f, jeu: e.target.value }))}
              placeholder="Uno, SkyJo…" className={champCls} autoFocus />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {JEUX_COURANTS.map((j) => (
                <button key={j} type="button" onClick={() => setPartieForm((f) => ({ ...f, jeu: j }))}
                  className="px-2.5 py-1 rounded-lg text-xs border border-gray-200 text-gray-600 hover:border-rose-300 transition">
                  {j}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={partieForm.date || dateInput(new Date())}
              onChange={(e) => setPartieForm((f) => ({ ...f, date: e.target.value }))} className={champCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Joueurs</label>
            {/* Les joueurs déjà vus se rajoutent d'un clic : on rejoue souvent
                avec les mêmes, les retaper à chaque partie est le vrai irritant. */}
            {joueursConnus.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {joueursConnus.map((j) => {
                  const present = partieForm.joueurs.some((x) => x.trim() === j)
                  return (
                    <button key={j} type="button"
                      onClick={() => setPartieForm((f) => ({
                        ...f,
                        joueurs: present
                          ? f.joueurs.filter((x) => x.trim() !== j)
                          // On remplace la première ligne vide plutôt que d'en empiler une
                          : f.joueurs.some((x) => !x.trim())
                            ? f.joueurs.map((x, i) => (i === f.joueurs.findIndex((y) => !y.trim()) ? j : x))
                            : [...f.joueurs, j],
                      }))}
                      className={`px-3 py-1.5 rounded-xl text-sm border transition ${
                        present ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
                      }`}>
                      {j}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="space-y-2">
              {partieForm.joueurs.map((j, i) => (
                <div key={i} className="flex gap-2">
                  <input value={j} placeholder={`Joueur ${i + 1}`}
                    onChange={(e) => setPartieForm((f) => ({ ...f, joueurs: f.joueurs.map((x, k) => (k === i ? e.target.value : x)) }))}
                    className={champCls} />
                  {partieForm.joueurs.length > 1 && (
                    <button type="button" onClick={() => setPartieForm((f) => ({ ...f, joueurs: f.joueurs.filter((_, k) => k !== i) }))}
                      className="px-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition shrink-0"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setPartieForm((f) => ({ ...f, joueurs: [...f.joueurs, ''] }))}
              className="mt-2 px-3 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">+ Ajouter un joueur</button>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={partieForm.scoreBasGagne}
              onChange={(e) => setPartieForm((f) => ({ ...f, scoreBasGagne: e.target.checked }))} className="accent-rose-600 mt-0.5" />
            <span>
              Le plus petit score gagne
              <span className="block text-xs text-gray-400">SkyJo, 6 qui prend… sans ça, le classement désigne le perdant.</span>
            </span>
          </label>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setPartieOuverte(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={creerPartie}
              disabled={!partieForm.jeu.trim() || partieForm.joueurs.filter((j) => j.trim()).length < 2}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
              Commencer
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Confirmation suppression ───────────────────────────────────────── */}
      <Modal isOpen={!!aSupprimer} onClose={() => setASupprimer(null)} title="Supprimer" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Supprimer {aSupprimer?.quoi} — <strong>{aSupprimer?.nom}</strong> ?
          </p>
          <div className="flex gap-3">
            <button onClick={() => setASupprimer(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={async () => { await aSupprimer?.go(); setASupprimer(null) }}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium transition">Supprimer</button>
          </div>
        </div>
      </Modal>

      {/* ── Partage entre les deux comptes ─────────────────────────────────── */}
      <DuoShareModal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)} />
    </StoreGate>
  )
}
