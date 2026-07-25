'use client'

import { useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useUsers } from '@/hooks/useUsers'
import { useBieres } from '@/hooks/useBieres'
import { useBieresCouple } from '@/hooks/useBieresCouple'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { BieresShareModal } from '@/components/bieres/BieresShareModal'
import { Timestamp, deleteField } from 'firebase/firestore'
import { Plus, Pencil, Trash2, Search, Star, BarChart3, ListFilter, MapPin, Camera, LocateFixed, ChevronRight, Users } from 'lucide-react'
import {
  SERVICES, TYPES_BIERE, TYPOLOGIES, CONTEXTES, METEOS, RESSENTIS, NOTES,
  classer, bilan, formatNote, moyenneDegustation, moyennePersonne,
  topPersonne, lieuxFrequents, parAnnee, parSaison, saisonDe,
  type BiereCalculee,
} from '@/lib/biereModel'
import { uploadImage, deleteImage } from '@/lib/uploadImage'
import dynamic from 'next/dynamic'
import { pointsDeCarte } from '@/components/bieres/CarteBieres'
import FicheBiere from '@/components/bieres/FicheBiere'
import { ChoixIcones } from '@/components/bieres/Icones'
// Leaflet touche `window` dès l'import : rendu client uniquement, sinon la page casse.
const CarteBieres = dynamic(() => import('@/components/bieres/CarteBieres'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-2xl border border-gray-100 h-[70vh] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})
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
function ChoixNote({ valeur, onChange, libelle, onSupprimer }: {
  valeur: number | null; onChange: (v: number | null) => void; libelle: string
  /** Présent seulement pour les personnes ajoutées à la volée */
  onSupprimer?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="text-sm font-medium text-gray-700">{libelle}</label>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${valeur === null ? 'text-gray-300' : 'text-amber-700'}`}>
            {valeur === null ? 'non notée' : `${formatNote(valeur)}/5`}
          </span>
          {/* La corbeille vit sur la ligne de notation : une pastille à croix
              ailleurs obligeait à chercher où retirer la personne. */}
          {onSupprimer && (
            <button type="button" onClick={onSupprimer} title="Retirer cette personne"
              className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {/* Curseur pour viser vite au pouce, pastilles pour le geste précis :
          les deux pilotent la même valeur. */}
      <input type="range" min={0} max={5} step={0.5}
        value={valeur ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-600" />
      <div className="flex flex-wrap gap-1 mt-2">
        {NOTES.map((n) => (
          <button key={n} type="button"
            onClick={() => onChange(valeur === n ? null : n)}
            className={`w-10 py-1.5 rounded-lg text-xs font-medium border transition ${
              valeur === n ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-600 hover:border-amber-300'
            }`}>
            {formatNote(n)}
          </button>
        ))}
        {valeur !== null && (
          <button type="button" onClick={() => onChange(null)}
            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-red-600 transition">
            effacer
          </button>
        )}
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

  // Partage du catalogue entre 2 comptes (cf. useBieresCouple / /api/bieres-invite).
  const couple = useBieresCouple(uid)
  const [partageOuvert, setPartageOuvert] = useState(false)
  // Compte INVITÉ (lié à un catalogue qu'il n'a pas créé) → accès gratuit, sans
  // abonnement propre. On laisse passer pendant le chargement pour éviter le flash « Accès non activé ».
  const isSharedGuest = !!uid && !!couple.createdBy && couple.createdBy !== uid
  const gateBypass = isSharedGuest || couple.loading

  const [onglet, setOnglet] = useState<'catalogue' | 'carte' | 'bilan'>('catalogue')
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
  /** Villes déjà saisies — proposées en auto-complétion, pour éviter les variantes */
  const villesConnues = useMemo(
    () => [...new Set(liste.flatMap((b) => b.degustations).map((d) => d.ville?.trim()).filter((v): v is string => !!v))].sort(),
    [liste],
  )

  const listeFiltree = useMemo(() => {
    const out = liste.filter((b) => {
      const q = recherche.trim().toLowerCase()
      if (q && !`${b.biere.nom} ${b.biere.origine ?? ''}`.toLowerCase().includes(q)
        && !b.degustations.some((d) => `${d.lieu ?? ''} ${d.ville ?? ''} ${d.analyse ?? ''} ${d.evenement ?? ''}`.toLowerCase().includes(q))) return false
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

  // La carte porte TOUT le catalogue, pas la liste filtrée : on y cherche un
  // souvenir de lieu, pas le résultat d'un filtre posé dans l'onglet d'à côté.
  const pointsCarte = useMemo(() => pointsDeCarte(listeFiltree), [listeFiltree])

  /** Coordonnées relevées pour un lieu ou une ville, si une dégustation en porte */
  const gpsDuLieu = (label: string): string | null => {
    for (const b of liste) {
      for (const d of b.degustations) {
        if (d.gps && (d.lieu?.trim() === label || d.ville?.trim() === label)) return d.gps
      }
    }
    return null
  }

  // ⚠️ Le bilan se calcule sur la liste FILTRÉE : un filtre posé en haut doit se
  // répercuter partout, sinon on compare des chiffres qui ne parlent pas du même
  // ensemble que la liste affichée juste à côté.
  const resume = useMemo(() => bilan(listeFiltree), [listeFiltree])

  /** Détail ouvert depuis une ligne du bilan */
  const [detail, setDetail] = useState<{ titre: string; bieres: BiereCalculee[] } | null>(null)

  /**
   * Sections du bilan. Chacune sait retrouver LES BIÈRES derrière un libellé :
   * c'est ce qui permet d'ouvrir le détail d'une barre.
   */
  const sectionsBilan = useMemo(() => {
    const aDeg = (b: BiereCalculee, f: (d: Degustation) => boolean) => b.degustations.some(f)
    return [
      {
        titre: 'Par type', estLieu: false, data: resume.parType,
        pour: (l: string) => listeFiltree.filter((b) => b.biere.type === l),
      },
      {
        titre: 'Par typologie', estLieu: false, data: resume.parTypologie,
        pour: (l: string) => listeFiltree.filter((b) => b.biere.typologie === l),
      },
      {
        titre: 'Par service', estLieu: false, data: resume.parService,
        pour: (l: string) => listeFiltree.filter((b) => b.biere.service === l),
      },
      {
        titre: 'Par saison', estLieu: false,
        data: parSaison(listeFiltree).map((s) => ({ label: s.saison, n: s.nb })),
        pour: (l: string) => listeFiltree.filter((b) => aDeg(b, (d) => !!d.date && saisonDe(d.date.toDate()) === l)),
      },
      {
        titre: 'Par année', estLieu: false,
        data: parAnnee(listeFiltree).map((a) => ({ label: String(a.annee), n: a.nb })),
        pour: (l: string) => listeFiltree.filter((b) => b.annees.includes(Number(l))),
      },
      {
        titre: 'Où on boit le plus', estLieu: true,
        data: lieuxFrequents(listeFiltree).map((x) => ({ label: x.lieu, n: x.nb })),
        pour: (l: string) => listeFiltree.filter((b) => aDeg(b, (d) => d.lieu?.trim() === l)),
      },
      {
        titre: 'Par ville', estLieu: true,
        data: lieuxFrequents(listeFiltree, 10, 'ville').map((x) => ({ label: x.lieu, n: x.nb })),
        pour: (l: string) => listeFiltree.filter((b) => aDeg(b, (d) => d.ville?.trim() === l)),
      },
    ]
  }, [listeFiltree, resume])
  const nbFiltres = [filtreType, filtreTypologie, filtreService, filtreOrigine, filtreAnnee, filtreNoteMin]
    .filter(Boolean).length + (filtreMultiple ? 1 : 0) + (filtreNonNotees ? 1 : 0)
  const reinitialiser = () => {
    setFiltreType(''); setFiltreTypologie(''); setFiltreService(''); setFiltreOrigine('')
    setFiltreAnnee(''); setFiltreNoteMin(''); setFiltreMultiple(false); setFiltreNonNotees(false)
  }

  /**
   * Prénom d'un membre — y compris le sien : dans un catalogue à deux, « Sarah 4
   * · Teddy 3,5 » se relit des années après, « Moi » ne veut plus rien dire.
   */
  const prenom = (u: string) => {
    const p = users.find((x) => (x.uid ?? x.id) === u)
    const nom = p?.prenom || p?.nom
    if (nom) return nom
    if (u === uid) return currentUser?.displayName?.split(' ')[0] || 'Moi'
    // Clé libre (invité sans compte, ou reprise de l'ancienne base) : on l'affiche telle quelle
    return u.charAt(0).toUpperCase() + u.slice(1)
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
      if (ficheEditee) {
        await majBiere(ficheEditee.id, champs)
        setFicheOuverte(false)
      } else {
        const id = await ajouterBiere({ ...champs, members: couple.members, createdBy: uid } as Omit<Biere, 'id' | 'createdAt'>)
        setFicheOuverte(false)
        if (enchainerDegustation) {
          setEnchainerDegustation(false)
          setRechercheBiere('')
          // La bière n'est pas encore revenue par l'écoute Firestore : on compose
          // une fiche minimale, suffisante pour enregistrer la dégustation.
          ouvrirDegustation({
            biere: { id, ...champs, members: couple.members, createdBy: uid } as Biere,
            degustations: [], moyenne: null, nbDegustations: 0,
            annees: [], lieux: [], aPhoto: false,
          })
        }
      }
    } finally { setEnCours(false) }
  }

  // ── Dégustation ─────────────────────────────────────────────────────────────
  const [degPour, setDegPour] = useState<BiereCalculee | null>(null)
  /** Dégustation en cours de MODIFICATION (null = on en crée une nouvelle) */
  const [degEditee, setDegEditee] = useState<Degustation | null>(null)
  const [degForm, setDegForm] = useState({
    date: '', analyse: '', lieu: '', ville: '', gps: '',
    contexte: '', evenement: '', meteo: '', ressenti: '', temperature: '',
  })
  const [geoEnCours, setGeoEnCours] = useState(false)
  const [geoErreur, setGeoErreur] = useState('')

  /** Coordonnées de l'appareil — on note souvent la bière sur place */
  const releverPosition = () => {
    if (!navigator.geolocation) { setGeoErreur('Position non disponible sur cet appareil.'); return }
    setGeoEnCours(true); setGeoErreur('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // 6 décimales ≈ 10 cm : au-delà c'est du bruit, en deçà on perd le bar
        const { latitude, longitude } = pos.coords
        setDegForm((f) => ({ ...f, gps: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` }))
        setGeoEnCours(false)
      },
      (err) => {
        setGeoErreur(err.code === err.PERMISSION_DENIED
          ? 'Localisation refusée — autorise-la dans les réglages du navigateur.'
          : 'Position introuvable, réessaie dehors ou près d’une fenêtre.')
        setGeoEnCours(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  /** Une note par personne — on note à deux, et modifier la sienne ne doit pas effacer l'autre */
  const [degNotes, setDegNotes] = useState<Record<string, number | null>>({})

  /**
   * Personnes susceptibles de noter : moi, plus toutes celles déjà présentes
   * dans le catalogue (dont « sarah », issue de l'import).
   */
  const membresNotes = useMemo(() => {
    // Réguliers = ceux qui notent la moitié du temps. Afficher d'office tous
    // ceux qui ont noté une fois remplirait la modale d'invités d'un soir.
    const compte = new Map<string, number>()
    let total = 0
    for (const b of liste) for (const d of b.degustations) {
      const cles = Object.keys(d.notes ?? {})
      if (!cles.length) continue
      total++
      for (const k of cles) if (k !== uid) compte.set(k, (compte.get(k) ?? 0) + 1)
    }
    const reguliers = [...compte.entries()].filter(([, n]) => n >= total / 2).map(([k]) => k)
    return [uid, ...reguliers].filter((x): x is string => !!x)
  }, [liste, uid])

  /** Occasionnels : proposés en un clic, jamais affichés d'office */
  const noteursOccasionnels = useMemo(() => {
    const vus = new Set<string>()
    for (const b of liste) for (const d of b.degustations) {
      for (const k of Object.keys(d.notes ?? {})) if (k !== uid && !membresNotes.includes(k)) vus.add(k)
    }
    return [...vus]
  }, [liste, uid, membresNotes])

  /** Personnes ajoutées à la volée sur la dégustation en cours (invités d'un soir) */
  const [membresAjoutes, setMembresAjoutes] = useState<string[]>([])
  const [ajoutNoteur, setAjoutNoteur] = useState('')
  const membresAffiches = useMemo(
    () => [...new Set([...membresNotes, ...membresAjoutes])],
    [membresNotes, membresAjoutes],
  )

  /**
   * Ajoute un noteur : un compte de l'app si le nom correspond (la note suit la
   * personne), sinon une clé libre — on boit avec des gens sans compte.
   */
  const ajouterNoteur = (cle: string) => {
    const k = cle.trim().toLowerCase()
    if (!k || membresAffiches.includes(k)) { setAjoutNoteur(''); return }
    setMembresAjoutes((m) => [...m, k])
    setDegNotes((n) => ({ ...n, [k]: null }))
    setAjoutNoteur('')
  }

  const retirerNoteur = (cle: string) => {
    setMembresAjoutes((m) => m.filter((x) => x !== cle))
    setDegNotes((n) => { const c = { ...n }; delete c[cle]; return c })
  }
  const [photos, setPhotos] = useState<string[]>([])
  const [envoiPhoto, setEnvoiPhoto] = useState(false)

  /**
   * Envoi immédiat : l'URL est connue avant l'enregistrement, donc l'aperçu est
   * réel. Plusieurs fichiers d'un coup — on photographie souvent la bière et le
   * lieu dans la même minute.
   */
  const envoyerPhotos = async (files: File[]) => {
    if (!uid) return
    setEnvoiPhoto(true)
    try {
      for (const file of files) {
        try {
          const url = await uploadImage(file, `users/${uid}/bieres/${Date.now()}_${file.name}`)
          setPhotos((p) => [...p, url])
        } catch {
          // Un fichier trop lourd ne doit pas faire échouer les suivants
        }
      }
    } finally { setEnvoiPhoto(false) }
  }

  const dateInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const ouvrirDegustation = (b: BiereCalculee) => {
    setDegEditee(null)
    setDegForm({
      date: dateInput(new Date()), analyse: '', lieu: '', ville: '', gps: '', contexte: '',
      evenement: '', meteo: '', ressenti: '', temperature: '',
    })
    setMembresAjoutes([])
    setAjoutNoteur('')
    setDegNotes(Object.fromEntries(membresNotes.map((m) => [m, null])))
    setPhotos([])
    setDegPour(b)
  }

  const ouvrirEditionDegustation = (b: BiereCalculee, d: Degustation) => {
    setDegEditee(d)
    setDegForm({
      date: d.date ? dateInput(d.date.toDate()) : '',
      analyse: d.analyse ?? '', lieu: d.lieu ?? '', ville: d.ville ?? '', gps: d.gps ?? '',
      contexte: d.contexte ?? '', evenement: d.evenement ?? '',
      meteo: d.meteo ?? '', ressenti: d.ressenti ?? '',
      temperature: d.temperature != null ? String(d.temperature) : '',
    })
    // Les notes déjà là priment ; les autres personnes connues apparaissent vides.
    // Les noteurs propres à CETTE dégustation doivent rester affichés.
    setMembresAjoutes(Object.keys(d.notes ?? {}).filter((k) => !membresNotes.includes(k)))
    setAjoutNoteur('')
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
        ville: degForm.ville.trim() || undefined,
        gps: degForm.gps.trim() || undefined,
        contexte: degForm.contexte || undefined,
        evenement: degForm.evenement.trim() || undefined,
        meteo: degForm.meteo || undefined,
        ressenti: degForm.ressenti || undefined,
        temperature: degForm.temperature ? Number(degForm.temperature.replace(',', '.')) : undefined,
        photos: photos.length ? photos : undefined,
      }

      // Photos retirées pendant l'édition : on les efface de Storage À
      // L'ENREGISTREMENT, pas au clic sur la croix — annuler ne doit rien perdre.
      if (degEditee) {
        const retirees = (degEditee.photos ?? []).filter((p) => !photos.includes(p))
        await Promise.allSettled(retirees.map((url) => deleteImage(url)))
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

  /**
   * « Je bois une bière » : on part TOUJOURS de la recherche, jamais de la
   * création. Sans ça, une bière déjà goûtée se retrouve en double et son
   * historique se coupe en deux.
   */
  const [choixOuvert, setChoixOuvert] = useState(false)
  const [rechercheBiere, setRechercheBiere] = useState('')

  const suggestions = useMemo(() => {
    const q = rechercheBiere.trim().toLowerCase()
    if (!q) return liste.slice(0, 8)
    return liste.filter((b) => b.biere.nom.toLowerCase().includes(q)).slice(0, 12)
  }, [liste, rechercheBiere])

  /**
   * Création depuis le flux « Déguster » : on passe par la FICHE (type, service,
   * degré…), sinon la bière naîtrait avec son seul nom et il faudrait y revenir.
   * La dégustation s'enchaîne juste après l'enregistrement.
   */
  const [enchainerDegustation, setEnchainerDegustation] = useState(false)

  const creerPuisDeguster = () => {
    const nom = rechercheBiere.trim()
    if (!nom) return
    setChoixOuvert(false)
    setFicheEditee(null)
    setForm({ nom, service: '', type: '', typologie: '', degres: '', ibu: '', origine: '' })
    setEnchainerDegustation(true)
    setFicheOuverte(true)
  }

  if (loading) {
    return (
      <StoreGate appRoute="/bieres" bypass={gateBypass}>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </StoreGate>
    )
  }

  return (
    <StoreGate appRoute="/bieres" bypass={gateBypass}>
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
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setPartageOuvert(true)}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600 text-sm font-medium px-3 py-2 rounded-xl transition">
              <Users size={16} /><span className="hidden sm:inline">Partager</span>
            </button>
            <button onClick={() => { setRechercheBiere(''); setChoixOuvert(true) }}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition">
              <Plus size={16} />Déguster</button>
          </div>
        </div>

        <BieresShareModal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)} />

        {/* Onglets */}
        <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl sm:flex sm:w-fit">
          {([
            { k: 'catalogue', icon: ListFilter, l: 'Catalogue' },
            { k: 'carte', icon: MapPin, l: 'Carte' },
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

        {onglet === 'catalogue' && (
          <>

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
                  return (
                    <div key={b.biere.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-3">
                        {/* Le rang n'a de sens que sur le classement complet */}
                        {!recherche && nbFiltres === 0 && b.moyenne !== null && (
                          <span className="text-xs font-bold text-gray-300 w-6 shrink-0">#{i + 1}</span>
                        )}
                        {/* Vignette : une photo de la bière vaut mieux qu'un nom */}
                        {(() => {
                          const toutes = b.degustations.flatMap((d) => d.photos ?? [])
                          if (!toutes.length) return null
                          return (
                            <div className="relative shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={toutes[0]} alt="" className="w-12 h-12 rounded-xl object-cover" />
                              {/* Le compteur signale qu'il y en a d'autres à voir dans la fiche */}
                              {toutes.length > 1 && (
                                <span className="absolute -bottom-1 -right-1 bg-gray-900/80 text-white text-[10px] font-medium rounded-full px-1.5 py-0.5">
                                  +{toutes.length - 1}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                        <button onClick={() => setDeplie(b.biere.id)}
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

                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {onglet === 'carte' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              {pointsCarte.length} lieu{pointsCarte.length > 1 ? 'x' : ''} ·{' '}
              {pointsCarte.reduce((s, p) => s + p.bieres.length, 0)} dégustation
              {pointsCarte.reduce((s, p) => s + p.bieres.length, 0) > 1 ? 's' : ''} géolocalisée
              {pointsCarte.reduce((s, p) => s + p.bieres.length, 0) > 1 ? 's' : ''}.
              La taille du cercle indique le nombre de bières, sa couleur la note moyenne.
            </p>
            <CarteBieres points={pointsCarte} />
          </div>
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
              const toutes = listeFiltree.flatMap((b) => b.degustations)
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
              const membres = [...new Set(listeFiltree.flatMap((b) => b.degustations).flatMap((d) => Object.keys(d.notes ?? {})))]
              if (!membres.length) return null
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {membres.map((u) => {
                    const top = topPersonne(listeFiltree, u, 5)
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
              {sectionsBilan.filter((s) => s.data.length > 0).map((s) => (
                <div key={s.titre} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{s.titre}</p>
                  <div className="space-y-1">
                    {s.data.map((r) => {
                      const gps = s.estLieu ? gpsDuLieu(r.label) : null
                      return (
                        <div key={r.label} className="flex items-center gap-2 group">
                          {/* Toute la ligne ouvre le détail : le chiffre seul ne
                              dit pas DE QUELLES bières il s'agit. */}
                          <button onClick={() => setDetail({ titre: `${s.titre} · ${r.label}`, bieres: s.pour(r.label) })}
                            className="flex-1 flex items-center gap-2 min-w-0 py-1 rounded-lg hover:bg-amber-50 transition text-left">
                            <span className="text-sm text-gray-700 w-28 shrink-0 truncate">{r.label}</span>
                            <span className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <span className="block h-full bg-amber-500 rounded-full"
                                style={{ width: `${(r.n / s.data[0].n) * 100}%` }} />
                            </span>
                            <span className="text-xs text-gray-500 w-6 text-right">{r.n}</span>
                            <ChevronRight size={14} className="text-gray-300 group-hover:text-amber-600 shrink-0" />
                          </button>
                          {s.estLieu && (
                            <a href={`https://maps.google.com/?q=${encodeURIComponent(gps ?? r.label)}`}
                              target="_blank" rel="noopener noreferrer"
                              title={gps ? 'Voir sur la carte' : 'Rechercher ce lieu'}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-amber-700 hover:bg-amber-50 transition shrink-0">
                              <MapPin size={14} />
                            </a>
                          )}
                        </div>
                      )
                    })}
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

      {/* ── Détail d'une ligne du bilan ────────────────────────────────────── */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.titre ?? ''} size="lg">
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            {detail?.bieres.length ?? 0} bière{(detail?.bieres.length ?? 0) > 1 ? 's' : ''}
            {nbFiltres > 0 && ' (dans les filtres actifs)'}
          </p>
          <div className="space-y-1.5 max-h-[60vh] overflow-auto">
            {detail?.bieres.map((b) => (
              <button key={b.biere.id}
                onClick={() => { setDetail(null); setDeplie(b.biere.id) }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-100 hover:bg-amber-50 transition text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{b.biere.nom}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {[b.biere.type, b.biere.typologie,
                      b.nbDegustations > 1 ? `bue ${b.nbDegustations} fois` : null,
                      b.derniere?.lieu].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Note valeur={b.moyenne} taille="sm" />
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* ── Choix de la bière avant une dégustation ────────────────────────── */}
      <Modal isOpen={choixOuvert} onClose={() => setChoixOuvert(false)} title="Quelle bière ?">
        <div className="space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={rechercheBiere} onChange={(e) => setRechercheBiere(e.target.value)}
              placeholder="Chercher dans le catalogue…" autoFocus className={`${champCls} pl-9`} />
          </div>

          {suggestions.length > 0 && (
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 max-h-72 overflow-auto">
              {suggestions.map((b) => (
                <button key={b.biere.id}
                  onClick={() => { setChoixOuvert(false); ouvrirDegustation(b) }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-amber-50 transition">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{b.biere.nom}</p>
                    <p className="text-xs text-gray-500">
                      {[b.biere.type, b.biere.typologie,
                        b.nbDegustations > 0 ? `bue ${b.nbDegustations} fois` : 'jamais dégustée',
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Note valeur={b.moyenne} taille="sm" />
                </button>
              ))}
            </div>
          )}

          {rechercheBiere.trim() && (
            <button onClick={creerPuisDeguster} disabled={enCours}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-amber-300 text-amber-700 py-3 rounded-xl text-sm font-medium hover:bg-amber-50 transition">
              <Plus size={16} />
              {enCours ? '…' : `Nouvelle bière « ${rechercheBiere.trim()} »`}
            </button>
          )}
          {!rechercheBiere.trim() && (
            <p className="text-xs text-gray-400 text-center">
              Tape un nom : si la bière existe déjà, la dégustation s&apos;ajoute à sa fiche.
            </p>
          )}
        </div>
      </Modal>

      {/* ── Fiche détaillée d'une bière ────────────────────────────────────── */}
      {(() => {
        const b = liste.find((x) => x.biere.id === deplie)
        if (!b) return null
        return (
          <Modal isOpen onClose={() => setDeplie(null)} title={b.biere.nom} size="lg">
            <FicheBiere
              b={b}
              prenom={prenom}
              onNouvelleDegustation={() => { setDeplie(null); ouvrirDegustation(b) }}
              onModifierFiche={() => { setDeplie(null); ouvrirEdition(b.biere) }}
              onEditerDegustation={(d) => { setDeplie(null); ouvrirEditionDegustation(b, d) }}
              onSupprimerDegustation={(d) => supprimerDegustation(b.biere.id, d.id)}
              onSupprimerBiere={() => { setDeplie(null); setASupprimer(b) }}
            />
          </Modal>
        )
      })()}

      {/* ── Modale fiche bière ─────────────────────────────────────────────── */}
      <Modal isOpen={ficheOuverte} onClose={() => { setFicheOuverte(false); setEnchainerDegustation(false) }}
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
              {enCours ? '…' : ficheEditee ? 'Enregistrer' : enchainerDegustation ? 'Créer et noter' : 'Ajouter'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modale dégustation ─────────────────────────────────────────────── */}
      <Modal isOpen={!!degPour} onClose={() => { setDegPour(null); setDegEditee(null) }}
        title={degPour ? `${degEditee ? 'Modifier la dégustation' : 'Dégustation'} — ${degPour.biere.nom}` : ''} size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={degForm.date}
              onChange={(e) => setDegForm((f) => ({ ...f, date: e.target.value }))} className={champCls} />
          </div>

          {/* Une note par personne : corriger la sienne ne touche pas à celle des autres */}
          <div className="space-y-3">
            {membresAffiches.map((m) => (
              <ChoixNote key={m} libelle={`Note de ${prenom(m)}`} valeur={degNotes[m] ?? null}
                onChange={(v) => setDegNotes((n) => ({ ...n, [m]: v }))}
                onSupprimer={membresAjoutes.includes(m) ? () => retirerNoteur(m) : undefined} />
            ))}
          </div>

          {/* On boit rarement seul. Les personnes déjà croisées se rajoutent d'un
              clic ; sinon un simple prénom suffit — aucun compte n'est requis. */}
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-2">
            <p className="text-xs font-medium text-gray-600">Quelqu&apos;un d&apos;autre a goûté ?</p>

            {noteursOccasionnels.filter((n) => !membresAffiches.includes(n)).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {noteursOccasionnels.filter((n) => !membresAffiches.includes(n)).map((n) => (
                  <button key={n} type="button" onClick={() => ajouterNoteur(n)}
                    className="px-2.5 py-1 rounded-full text-xs border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-700 transition">
                    + {prenom(n)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input value={ajoutNoteur} onChange={(e) => setAjoutNoteur(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterNoteur(ajoutNoteur) } }}
                placeholder="Prénom" className={champCls} />
              <button type="button" onClick={() => ajouterNoteur(ajoutNoteur)} disabled={!ajoutNoteur.trim()}
                className="px-3 py-2 rounded-xl border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-40 transition shrink-0">
                Ajouter
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avis</label>
            <AutoTextarea value={degForm.analyse} onChange={(v) => setDegForm((f) => ({ ...f, analyse: v }))}
              minRows={2} placeholder="Amère, fruitée, trop sucrée…" className={champCls} />
          </div>

          {/* Bar et ville séparés : l'ancien « De Garre / Bruges » en un seul
              champ ne permettait aucune statistique par ville. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bar / établissement</label>
              <input value={degForm.lieu} onChange={(e) => setDegForm((f) => ({ ...f, lieu: e.target.value }))}
                placeholder="De Garre" className={champCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ville</label>
              <input value={degForm.ville} onChange={(e) => setDegForm((f) => ({ ...f, ville: e.target.value }))}
                placeholder="Bruges" className={champCls} list="villes-connues" />
              <datalist id="villes-connues">
                {villesConnues.map((v) => <option key={v} value={v} />)}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Coordonnées GPS</label>
            <div className="flex gap-2">
              <input value={degForm.gps} onChange={(e) => setDegForm((f) => ({ ...f, gps: e.target.value }))}
                placeholder="47.6293, -2.7791" className={champCls} />
              <button type="button" onClick={releverPosition} disabled={geoEnCours}
                title="Utiliser ma position actuelle"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-amber-50 hover:border-amber-300 disabled:opacity-60 transition shrink-0">
                <LocateFixed size={16} />
                <span className="hidden sm:inline">{geoEnCours ? 'Recherche…' : 'Ma position'}</span>
              </button>
            </div>
            {geoErreur && <p className="text-xs text-amber-700 mt-1">{geoErreur}</p>}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Météo</label>
            <ChoixIcones type="meteo" options={METEOS} valeur={degForm.meteo}
              onChange={(v) => setDegForm((f) => ({ ...f, meteo: v }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ressenti</label>
            <ChoixIcones type="ressenti" options={RESSENTIS} valeur={degForm.ressenti}
              onChange={(v) => setDegForm((f) => ({ ...f, ressenti: v }))} />
          </div>
          {/* Placée avec la météo, et nommée « extérieure » : à côté de la date,
              on croyait qu'il s'agissait de la température de la bière. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Température extérieure (°C)</label>
            <input type="text" inputMode="decimal" value={degForm.temperature}
              onChange={(e) => setDegForm((f) => ({ ...f, temperature: e.target.value.replace(/[^\d,.-]/g, '') }))}
              placeholder="18" className={`${champCls} sm:max-w-40`} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Photos <span className="text-gray-400">(la bière, le lieu, la tablée…)</span>
            </label>
            {photos.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 mb-1">
                  {photos.map((p, i) => (
                    <div key={p} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt="" className="w-20 h-20 rounded-xl object-cover" />
                      {/* La première photo est celle qui illustre la bière dans la
                          liste : l'ordre compte, on le règle à la flèche (le
                          glisser-déposer est peu fiable au doigt). */}
                      {i === 0 && (
                        <span className="absolute top-1 left-1 bg-amber-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          1ʳᵉ
                        </span>
                      )}
                      <button type="button" onClick={() => setPhotos((l) => l.filter((x) => x !== p))}
                        title="Retirer"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-600 text-xs shadow">
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                        <button type="button" disabled={i === 0} title="Reculer"
                          onClick={() => setPhotos((l) => {
                            const c = [...l];[c[i - 1], c[i]] = [c[i], c[i - 1]]; return c
                          })}
                          className="w-5 h-5 rounded-full bg-white/90 text-gray-600 text-xs leading-none shadow disabled:opacity-0">‹</button>
                        <button type="button" disabled={i === photos.length - 1} title="Avancer"
                          onClick={() => setPhotos((l) => {
                            const c = [...l];[c[i], c[i + 1]] = [c[i + 1], c[i]]; return c
                          })}
                          className="w-5 h-5 rounded-full bg-white/90 text-gray-600 text-xs leading-none shadow disabled:opacity-0">›</button>
                      </div>
                    </div>
                  ))}
                </div>
                {photos.length > 1 && (
                  <p className="text-[11px] text-gray-400 mb-2">
                    La première photo sert de vignette dans le catalogue.
                  </p>
                )}
              </>
            )}
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition cursor-pointer">
              <Camera size={15} />
              {envoiPhoto ? 'Envoi…' : 'Ajouter des photos'}
              {/* `multiple` : on prend souvent la bière ET le lieu dans la foulée */}
              <input type="file" accept="image/*" multiple className="hidden" disabled={envoiPhoto}
                onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) envoyerPhotos(fs); e.target.value = '' }} />
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
