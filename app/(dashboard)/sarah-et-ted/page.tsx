'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useDuoFilms, useDuoActivites, useDuoParties } from '@/hooks/useDuo'
import { useDuoCouple } from '@/hooks/useDuoCouple'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { DuoShareModal } from '@/components/duo/DuoShareModal'
import { Timestamp } from 'firebase/firestore'
import {
  Plus, Pencil, Trash2, Search, MapPin, Film, Compass, Dices, Check, ChevronLeft, Users,
  Star, Eye, List, Map as MapIcon,
} from 'lucide-react'
import {
  TYPES_FILM, PLATEFORMES, CATEGORIES_FILM, SAISONS_PARTIES, TYPES_ACTIVITE, PRIORITES, GAMMES_PRIX,
  categoriesFilm,
} from '@/lib/duoModel'
import ChampLieu from '@/components/duo/ChampLieu'
import { groupesActivites, pointsActivites } from '@/lib/duoActivites'
import dynamic from 'next/dynamic'
import type { DuoActivite, DuoFilm, DuoPartie } from '@/types'

// Leaflet touche `window` dès l'import : la carte est chargée côté client seulement.
const CarteActivites = dynamic(() => import('@/components/duo/CarteActivites'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-2xl border border-gray-100 h-[65vh] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

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
  const router = useRouter()
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
  const [section, setSection] = useState<'films' | 'activites' | null>(null)
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
    nom: '', type: '', typeLibre: false, zone: '', adresse: '', gps: '', fait: false,
    note: undefined as number | undefined,
    priorite: '', conseillePar: '', lien: '', gammePrix: '', infos: '',
  }
  const [actForm, setActForm] = useState(actVide)
  /** Liste ou carte : deux façons de regarder les mêmes activités. */
  const [vueActivites, setVueActivites] = useState<'liste' | 'carte'>('liste')
  // Filtres partagés par les deux vues : ce qu'on voit dans la liste est
  // exactement ce qu'on voit sur la carte.
  const [filtrePriorite, setFiltrePriorite] = useState('')
  const [filtrePrix, setFiltrePrix] = useState('')
  /** N'afficher que ce qui a un point GPS (utile avant de basculer sur la carte). */
  const [filtreGeo, setFiltreGeo] = useState(false)

  const listeActivites = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return (activites.items as DuoActivite[])
      .filter((a) => {
        if (filtreFait === 'a_faire' && a.fait) return false
        if (filtreFait === 'faits' && !a.fait) return false
        if (filtreTypeAct && a.type !== filtreTypeAct) return false
        if (filtrePriorite && a.priorite !== filtrePriorite) return false
        if (filtrePrix && a.gammePrix !== filtrePrix) return false
        if (filtreGeo && !a.gps?.trim()) return false
        if (q && !`${a.nom} ${a.zone ?? ''} ${a.adresse ?? ''} ${a.infos ?? ''} ${a.conseillePar ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => Number(a.fait ?? false) - Number(b.fait ?? false) || a.nom.localeCompare(b.nom))
  }, [activites.items, filtreFait, filtreTypeAct, filtrePriorite, filtrePrix, filtreGeo, recherche])

  // La carte suit les mêmes filtres que la liste : ce qu'on voit à l'écran est
  // ce qu'on voit sur la carte.
  const pointsCarte = useMemo(() => pointsActivites(listeActivites), [listeActivites])
  const nbEndroits = useMemo(() => groupesActivites(pointsCarte).length, [pointsCarte])

  const ouvrirActivite = (a?: DuoActivite) => {
    setActEditee(a ?? null)
    setActForm(a ? {
      nom: a.nom,
      type: a.type === 'Autre' ? '' : a.type ?? '',
      typeLibre: !!a.type && !(TYPES_ACTIVITE as readonly string[]).includes(a.type),
      zone: a.zone ?? '', adresse: a.adresse ?? '', gps: a.gps ?? '', fait: !!a.fait,
      note: a.note, priorite: a.priorite ?? '', conseillePar: a.conseillePar ?? '',
      lien: a.lien ?? '', gammePrix: a.gammePrix ?? '', infos: a.infos ?? '',
    } : actVide)
    setActOuverte(true)
  }

  const enregistrerActivite = async () => {
    if (!base || !actForm.nom.trim()) return
    const champs = {
      nom: actForm.nom.trim(), type: actForm.type.trim(), zone: actForm.zone.trim(),
      adresse: actForm.adresse.trim(),
      gps: actForm.gps.trim(), fait: actForm.fait, note: actForm.note ?? null,
      priorite: actForm.priorite, conseillePar: actForm.conseillePar.trim(),
      lien: actForm.lien.trim(), gammePrix: actForm.gammePrix, infos: actForm.infos.trim(),
    }
    if (actEditee) await activites.modifier(actEditee.id, champs)
    else await activites.ajouter({ ...base, ...champs })
    setActOuverte(false)
  }

  // ── Jeux ───────────────────────────────────────────────────────────────────
  // Le module a sa propre section d'écrans (`/sarah-et-ted/jeux`) : une partie
  // par page, avec ses sessions, son partage et ses statistiques. Ici, la carte
  // d'accueil ne fait plus que compter et ouvrir.

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
                  // Les jeux ne sont plus une section dépliée ici : ils ont leurs
                  // propres écrans, une partie par page.
                  k: 'jeux', icon: Dices, titre: 'Jeux',
                  desc: 'Les scores des parties', couleur: 'bg-amber-100 text-amber-600',
                  total: parties.items.length,
                  reste: (parties.items as DuoPartie[]).filter((p) => !p.termine).length,
                  resteLabel: 'en cours',
                  unite: 'partie',
                },
              ] as const).map((s) => {
                const Icon = s.icon
                const unite = 'unite' in s ? s.unite : 'enregistré'
                return (
                  <button key={s.k}
                    onClick={() => {
                      if (s.k === 'jeux') { router.push('/sarah-et-ted/jeux'); return }
                      setSection(s.k)
                      setRecherche('')
                    }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-rose-200 transition active:scale-[0.99]">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${s.couleur}`}>
                      <Icon size={22} />
                    </div>
                    <p className="text-base font-semibold text-gray-900">{s.titre}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                    <p className="text-sm text-gray-700 mt-3">
                      <strong>{s.total}</strong> {`${unite}${s.total > 1 ? 's' : ''}`}
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
                  {section === 'films' ? 'Films & séries' : 'Activités'}
                </h1>
              </div>
              <button
                onClick={() => (section === 'films' ? ouvrirFilm() : ouvrirActivite())}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition shrink-0">
                <Plus size={16} />Ajouter
              </button>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher…" className={`${champCls} pl-9`} />
            </div>
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

              {/* Liste ou carte — la carte suit exactement les mêmes filtres */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl ml-auto">
                {([['liste', 'Liste', List], ['carte', 'Carte', MapIcon]] as const).map(([k, l, Icone]) => (
                  <button key={k} onClick={() => setVueActivites(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 ${
                      vueActivites === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                    }`}>
                    <Icone size={13} />{l}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtres fins : priorité, prix, et « seulement ce qui est placé » */}
            <div className="flex flex-wrap items-center gap-2">
              <Chips options={PRIORITES} valeur={filtrePriorite} onChange={setFiltrePriorite} />
              <Chips options={GAMMES_PRIX} valeur={filtrePrix} onChange={setFiltrePrix} />
              <button onClick={() => setFiltreGeo((v) => !v)}
                className={`px-3 py-1.5 rounded-xl text-sm border transition inline-flex items-center gap-1.5 ${
                  filtreGeo ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
                }`}>
                <MapPin size={13} />Placées sur la carte
              </button>
              {(filtrePriorite || filtrePrix || filtreGeo || filtreTypeAct || filtreFait !== 'tous') && (
                <button
                  onClick={() => {
                    setFiltrePriorite(''); setFiltrePrix(''); setFiltreGeo(false)
                    setFiltreTypeAct(''); setFiltreFait('tous')
                  }}
                  className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 transition">
                  Tout afficher
                </button>
              )}
            </div>

            {vueActivites === 'carte' ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  {`${pointsCarte.length} activité${pointsCarte.length > 1 ? 's' : ''} placée${pointsCarte.length > 1 ? 's' : ''} sur ${listeActivites.length}`}
                  {/* Deux activités à la même adresse ne font qu'un rond : le dire
                      évite de croire qu'il en manque sur la carte. */}
                  {nbEndroits < pointsCarte.length && ` · ${nbEndroits} endroits distincts`}
                  {listeActivites.length > pointsCarte.length
                    && ' — les autres n’ont ni adresse ni point GPS.'}
                </p>
                <CarteActivites points={pointsCarte} onOuvrir={ouvrirActivite} />
              </div>
            ) : listeActivites.length === 0 ? (
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
                        {a.adresse && (
                          <p className="text-xs text-gray-400 mt-0.5 flex items-start gap-1 break-words">
                            <MapPin size={11} className="shrink-0 mt-0.5" />{a.adresse}
                          </p>
                        )}
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
      </div>

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
          {/* Adresse et GPS se remplissent l'un l'autre — cf. ChampLieu */}
          <ChampLieu
            valeurs={{ adresse: actForm.adresse, gps: actForm.gps, zone: actForm.zone }}
            onChange={(v) => setActForm((f) => ({ ...f, ...v }))} />
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
