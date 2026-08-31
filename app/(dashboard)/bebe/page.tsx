'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useBebe } from '@/hooks/useBebe'
import { useBebeEvents, EVENTS_LIMIT_ALL } from '@/hooks/useBebeEvents'
import { StoreGate } from '@/components/ui/StoreGate'
import Modal from '@/components/ui/Modal'
import { Trash2, Pencil, Plus, Star, Moon, CalendarDays, LayoutList, Camera, Play, Gift, Users, TrendingUp, Droplets, Droplet, Thermometer, Syringe, HeartPulse, BarChart3 } from 'lucide-react'
import { Milk, Pill, Baby, Hourglass, Check, Sparkles, Search, X } from 'lucide-react'
import AutoTextarea from '@/components/ui/AutoTextarea'
import { NoteAide } from '@/components/ui/NoteAide'
import { GrowthChart, type GrowthPoint } from '@/components/bebe/GrowthChart'
import { BarChart } from '@/components/bebe/BarChart'
import { predireProchainSommeil } from '@/lib/bebeSommeil'
import { Timestamp } from 'firebase/firestore'
import { uploadImage } from '@/lib/uploadImage'
import { ArrivalSection } from '@/components/bebe/ArrivalSection'
import { ShareBabyModal } from '@/components/bebe/ShareBabyModal'
import type { BebeEvent, BebeEventType, BebeDefauts, BebeJournee, BebeBottleKind, BebeDiaperKind, BebeRoutine, BebeMedicament } from '@/types'

// ─── Icône couche (SVG custom rempli — aucun équivalent dans lucide) ──────────

function DiaperIcon({ size = 24, className }: { size?: number; className?: string }) {
  // Couche stylisée vue de face : trapèze arrondi pincé à la taille
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.2 5.5C3.2 4.7 3.9 4 4.7 4h14.6c.8 0 1.5.7 1.5 1.5 0 4.4-2.7 7-5.4 7.4-.9 2.6-2 4.6-3.4 4.6s-2.5-2-3.4-4.6C5.9 12.5 3.2 9.9 3.2 5.5z" opacity="0.92" />
      <path d="M8.5 8.2c.6 1.2 1.9 2 3.5 2s2.9-.8 3.5-2" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<BebeEventType, React.ElementType> = {
  bottle: Milk,
  diaper: DiaperIcon,
  sleep:  Moon,
  meds:   Pill,
  growth: TrendingUp,
  bath:    Droplets,
  temp:    Thermometer,
  vaccine: Syringe,
  pump:    Droplet,
  waste:   Trash2,
  soin:    Sparkles,
}

const EVENT_LABELS: Record<BebeEventType, string> = {
  // « Repas » et non « Biberon » : le même événement couvre la tétée au sein
  bottle: 'Repas',
  diaper: 'Couche',
  sleep:  'Sommeil',
  meds:   'Médicament',
  growth: 'Mesure',
  bath:    'Bain',
  temp:    'Température',
  vaccine: 'Vaccin',
  pump:    'Tirage',
  waste:   'Lait jeté',
  soin:    'Soin',
}

const EVENT_COLORS: Record<BebeEventType, { bg: string; text: string }> = {
  bottle: { bg: 'bg-sky-100',    text: 'text-sky-600'    },
  diaper: { bg: 'bg-teal-100',   text: 'text-teal-600'   },
  sleep:  { bg: 'bg-indigo-100', text: 'text-indigo-600' },
  meds:   { bg: 'bg-rose-100',   text: 'text-rose-600'   },
  growth: { bg: 'bg-violet-100', text: 'text-violet-600' },
  bath:    { bg: 'bg-cyan-100',    text: 'text-cyan-600'    },
  temp:    { bg: 'bg-orange-100',  text: 'text-orange-600'  },
  vaccine: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
  pump:    { bg: 'bg-pink-100',    text: 'text-pink-600'    },
  waste:   { bg: 'bg-gray-100',    text: 'text-gray-500'    },
  soin:    { bg: 'bg-amber-100',   text: 'text-amber-600'   },
}

/**
 * Calendrier vaccinal français du nourrisson (repères de saisie, PAS un rappel
 * médical) — l'âge indiqué est l'usage courant, le médecin fait foi.
 */
const VACCINS_SUGGESTIONS = [
  { name: 'Hexavalent (DTP-Coq-Hib-HépB)', age: '2 mois'      },
  { name: 'Hexavalent (DTP-Coq-Hib-HépB)', age: '4 mois'      },
  { name: 'Hexavalent (DTP-Coq-Hib-HépB)', age: '11 mois'     },
  { name: 'Pneumocoque (Prevenar)',        age: '2 mois'      },
  { name: 'Pneumocoque (Prevenar)',        age: '4 mois'      },
  { name: 'Pneumocoque (Prevenar)',        age: '11 mois'     },
  { name: 'Méningocoque B (Bexsero)',      age: '3 mois'      },
  { name: 'Méningocoque B (Bexsero)',      age: '5 mois'      },
  { name: 'Méningocoque B (Bexsero)',      age: '12 mois'     },
  { name: 'Méningocoque ACWY',             age: '6 mois'      },
  { name: 'Méningocoque ACWY',             age: '12 mois'     },
  { name: 'Rotavirus (oral)',              age: '2 à 6 mois'  },
  { name: 'ROR (rougeole-oreillons-rubéole)', age: '12 mois'  },
  { name: 'ROR (rougeole-oreillons-rubéole)', age: '16-18 mois' },
  { name: 'Grippe saisonnière',            age: 'dès 6 mois'  },
]

/** Seuil de fièvre (°C) — signalé dans la timeline, jamais interprété médicalement */
const SEUIL_FIEVRE = 38
/** Plage habituelle chez le nourrisson (°C) */
const TEMP_NORMALE = { min: 36, max: 37.5 }

/**
 * Zone dans laquelle tombe une température, avec sa couleur et le geste utile.
 *
 * ⚠️ Ce sont des REPÈRES DE SAISIE, jamais un avis médical : l'app signale ce qui
 * sort de la plage habituelle et rappelle d'appeler un médecin, elle ne
 * diagnostique rien. Toute formulation qui ressemblerait à une consigne de soin
 * doit rester à ce niveau-là.
 */
function zoneTemperature(t: number): {
  cle: 'tres_basse' | 'basse' | 'normale' | 'elevee' | 'fievre' | 'fievre_forte'
  titre: string; message: string; court: string; alerte: boolean
  bg: string; texte: string; sousTexte: string; pastille: string; icone: string
} {
  if (t < 35.5) return {
    cle: 'tres_basse', alerte: true, court: 'très basse', titre: 'Température très basse',
    message: 'Un nourrisson se refroidit vite. Réchauffez-le (peau à peau, couverture, bonnet) et reprenez la mesure. Si elle ne remonte pas, appelez un médecin.',
    bg: 'bg-blue-50 border-blue-200', texte: 'text-blue-800', sousTexte: 'text-blue-700',
    pastille: 'bg-blue-100', icone: 'text-blue-600',
  }
  if (t < TEMP_NORMALE.min) return {
    cle: 'basse', alerte: true, court: 'basse', titre: 'Température basse',
    message: `En dessous de ${TEMP_NORMALE.min} °C. Couvrez-le un peu plus et reprenez la mesure dans 20 à 30 minutes.`,
    bg: 'bg-sky-50 border-sky-200', texte: 'text-sky-800', sousTexte: 'text-sky-700',
    pastille: 'bg-sky-100', icone: 'text-sky-600',
  }
  if (t <= TEMP_NORMALE.max) return {
    cle: 'normale', alerte: false, court: '', titre: 'Température normale',
    message: `Plage habituelle : ${String(TEMP_NORMALE.min).replace('.', ',')} à ${String(TEMP_NORMALE.max).replace('.', ',')} °C.`,
    bg: 'bg-emerald-50 border-emerald-200', texte: 'text-emerald-800', sousTexte: 'text-emerald-700',
    pastille: 'bg-emerald-100', icone: 'text-emerald-600',
  }
  if (t < SEUIL_FIEVRE) return {
    cle: 'elevee', alerte: true, court: 'élevée', titre: 'Température un peu élevée',
    message: 'Découvrez-le un peu, proposez-lui à boire, et reprenez la mesure un peu plus tard.',
    bg: 'bg-amber-50 border-amber-200', texte: 'text-amber-800', sousTexte: 'text-amber-700',
    pastille: 'bg-amber-100', icone: 'text-amber-600',
  }
  if (t < 39) return {
    cle: 'fievre', alerte: true, court: 'fièvre', titre: `Fièvre — au-dessus de ${SEUIL_FIEVRE} °C`,
    message: 'Avant 3 mois, une fièvre justifie un avis médical rapide. Ne donnez un médicament que sur avis du médecin.',
    bg: 'bg-orange-50 border-orange-200', texte: 'text-orange-800', sousTexte: 'text-orange-700',
    pastille: 'bg-orange-100', icone: 'text-orange-600',
  }
  return {
    cle: 'fievre_forte', alerte: true, court: 'forte fièvre', titre: 'Fièvre élevée',
    message: 'Appelez le médecin, ou le 15 s\u2019il est très abattu, geignard, difficile à réveiller ou marbré.',
    bg: 'bg-red-50 border-red-200', texte: 'text-red-800', sousTexte: 'text-red-700',
    pastille: 'bg-red-100', icone: 'text-red-600',
  }
}

/** Exemples d'observation propres à chaque saisie (texte grisé du champ) */
const NOTE_PLACEHOLDERS: Record<BebeEventType, string> = {
  bottle:  'a régurgité, n\'a pas fini, s\'endort en buvant…',
  diaper:  'selles inhabituelles, rougeurs, fuite…',
  sleep:   's\'est réveillé en pleurant, long à s\'endormir…',
  meds:    'donné sur avis du médecin, en a recraché…',
  growth:  'pesé habillé, mesuré à la maison, chez le pédiatre…',
  bath:    'a adoré, eau trop chaude, premier bain…',
  temp:    'prise en rectal, au réveil, après le biberon…',
  vaccine: 'bien supporté, cuisse gauche, fièvre le soir…',
  pump:    'peu de lait ce matin, tire-lait manuel…',
  waste:   'périmé, biberon non terminé, laissé dehors…',
  soin:    'rougeurs, crème appliquée, cordon sec…',
}

/** Couleurs des deux courbes (valeurs CSS : le SVG ne lit pas les classes Tailwind) */
const COURBE_POIDS  = '#7c3aed' // violet-600
const COURBE_TAILLE = '#0d9488' // teal-600
const COURBE_PC     = '#d97706' // amber-600
// Histogrammes de l'onglet Stats
const COURBE_REPAS   = '#0284c7' // sky-600
const COURBE_LAIT    = '#38bdf8' // sky-400
const COURBE_COUCHES = '#0d9488' // teal-600
const COURBE_NUIT    = '#4f46e5' // indigo-600
const COURBE_SIESTE  = '#a5b4fc' // indigo-300

// Listes partagées entre les modales de saisie ET le réglage des valeurs par défaut
// Ce que le bébé REÇOIT. Le tire-lait n'est pas listé ici comme un acte : le lait
// tiré est donné au biberon → « Biberon de lait maternel ». Le tirage lui-même est
// un événement à part (type `pump`), sinon on compterait deux fois le même lait.
const BOTTLE_KINDS: { v: BebeBottleKind; l: string }[] = [
  { v: 'biberon',   l: 'Biberon'                 },
  { v: 'sein_g',    l: 'Sein gauche'             },
  { v: 'sein_d',    l: 'Sein droit'              },
  { v: 'tire_lait', l: 'Biberon de lait maternel' },
]

/** Côté tiré lors d'une séance de tire-lait */
const PUMP_KINDS: { v: string; l: string }[] = [
  { v: 'les_deux', l: 'Les deux' },
  { v: 'sein_g',   l: 'Sein gauche' },
  { v: 'sein_d',   l: 'Sein droit' },
]

// Les clés stockées ne changent pas (`urine`, `selles`) : seuls les libellés
// affichés passent au langage courant, sans toucher aux fiches déjà en base.
const DIAPER_KINDS: { v: BebeDiaperKind; l: string }[] = [
  { v: 'seche',  l: 'Sèche' },
  { v: 'urine',  l: 'Pipi'  },
  { v: 'selles', l: 'Caca'  },
  { v: 'mixte',  l: 'Mixte' },
]

const BOTTLE_AMOUNTS = [60, 90, 120, 150, 180, 210]
/** Volumes proposés en un clic pour un tirage (souvent plus petits qu'un biberon) */
const PUMP_AMOUNTS = [30, 60, 90, 120, 150, 180]
/** Restes jetés proposés en un clic (petites quantités) */
const WASTE_AMOUNTS = [10, 20, 30, 40, 60, 90]
/** Durées de tétée proposées (minutes) */
const TETEE_DUREES = [5, 10, 15, 20, 25, 30]

/** Une tétée au sein se mesure en minutes et par côté, pas en ml */
const estSein = (kind?: string): boolean => kind === 'sein_g' || kind === 'sein_d'

/** Repli quand le bébé n'a rien réglé — valeurs historiques, comportement inchangé */
const DEFAUTS_FALLBACK: Required<BebeDefauts> = {
  bottleKind: 'biberon',
  bottleAmount: 120,
  bottleDurationMin: 15,
  diaperKind: 'urine',
}

/** Journée par défaut quand elle n'a pas été réglée pour ce bébé */
const JOURNEE_FALLBACK: BebeJournee = { debut: '07:00', fin: '20:00' }

/** Soins courants du nourrisson — la saisie reste libre */
const SOINS_SUGGESTIONS = [
  'Soin de la peau', 'Crème hydratante', 'Cordon ombilical', 'Nez (sérum physiologique)',
  'Yeux', 'Ongles', 'Massage', 'Change de pansement',
]

/**
 * Suggestions de la modale « Autre récurrence » UNIQUEMENT : là, un seul champ
 * couvre les trois familles, donc le bain et la température ont leur place.
 * ⚠️ Surtout pas dans la modale Soin, où ils ont déjà leur propre tuile.
 */
const RECURRENCES_SUGGESTIONS = ['Bain', 'Température', ...SOINS_SUGGESTIONS]

/**
 * « Autre récurrence » : on tape ce qu'il y a à faire, et le type d'événement
 * écrit dans l'historique se déduit de l'intitulé.
 *
 * 🔑 Le but est qu'un bain reste un BAIN (il compte dans les bains de
 * l'historique et des stats) et qu'une température reste une TEMPÉRATURE (cocher
 * ouvre la saisie de la valeur), sans imposer un menu de types à qui veut juste
 * écrire « soin de la peau ». Tout le reste est un soin.
 */
function typeDepuisIntitule(nom: string): 'bath' | 'temp' | 'soin' {
  const n = nom.trim().toLowerCase()
  if (/\bbain|baignade/.test(n)) return 'bath'
  if (/temp[ée]rature|fi[èe]vre/.test(n)) return 'temp'
  return 'soin'
}

/** Unités de prise — au SINGULIER : l'accord se fait à l'affichage (`formatDose`) */
const UNITES_MEDS = ['goutte', 'ml', 'mg', 'comprimé', 'sachet', 'dosette', 'suppositoire', 'pulvérisation']
/** Symboles invariables : « 5 mls » n'existe pas */
const UNITES_INVARIABLES = new Set(['ml', 'mg', 'g', 'kg', 'UI', 'µg'])

const MEDS_SUGGESTIONS = [
  { nom: 'Doliprane nourrisson',  quantite: '2,5', unite: 'ml' },
  { nom: 'Doliprane nourrisson',  quantite: '5',   unite: 'ml' },
  { nom: 'Efferalgan nourrisson', quantite: '2,5', unite: 'ml' },
  { nom: 'Advil nourrisson',      quantite: '2,5', unite: 'ml' },
  { nom: 'Advil nourrisson',      quantite: '5',   unite: 'ml' },
  { nom: 'Spasfon',               quantite: '1',   unite: 'suppositoire' },
  { nom: 'Smecta',                quantite: '1',   unite: 'sachet' },
  { nom: 'Maalox nourrisson',     quantite: '5',   unite: 'ml' },
  { nom: 'Lactobacillus',         quantite: '5',   unite: 'goutte' },
  { nom: 'Vitamine D (Zymad)',    quantite: '1',   unite: 'goutte' },
  { nom: 'Vitamine D (Adrigyl)',  quantite: '2',   unite: 'goutte' },
  { nom: 'Physiomer nourrisson',  quantite: '1',   unite: 'jet/narine' },
  { nom: 'Rhinathiol nourrisson', quantite: '2,5', unite: 'ml' },
  { nom: 'Dafalgan pédiatrique',  quantite: '5',   unite: 'ml' },
  { nom: 'Homéopathie dentition', quantite: '1',   unite: 'dose' },
]

/** Clé de comparaison d'un médicament : même nom, même dose = même entrée */
const cleMed = (nom: string, quantite: string, unite: string) =>
  `${nom.trim().toLowerCase()}|${quantite.trim().replace('.', ',')}|${unite.trim().toLowerCase()}`

const STORAGE_KEY = 'bebe_primary_id'

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function formatTime(ts: Timestamp): string {
  return ts?.toDate?.().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) ?? '—'
}

function timeAgo(ts: Timestamp): string {
  const ms = ts?.toDate?.()?.getTime?.()
  if (!ms) return ''
  const d = Math.floor((Date.now() - ms) / 60_000)
  if (d < 1)  return "à l'instant"
  if (d < 60) return `il y a ${d}min`
  const h = Math.floor(d / 60), m = d % 60
  return m > 0 ? `il y a ${h}h${m}min` : `il y a ${h}h`
}

function formatDuration(min: number): string {
  if (min <= 0)  return '0min'
  if (min < 60)  return `${min}min`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

/**
 * Écart en JOURS CIVILS entre deux dates : J+1 = le lendemain, quelle que soit
 * l'heure de chacune.
 *
 * ⚠️ Comparer les millisecondes bruts se trompe d'un jour dès que les heures
 * diffèrent : une naissance datée à minuit et une mesure notée à 12 h donnaient
 * 1,5 jour → arrondi à « J+2 » le lendemain de la naissance. On ramène les deux
 * dates à minuit avant de compter. (`Math.round` absorbe les journées de 23 h/25 h
 * des changements d'heure.)
 */
function joursEntre(depuis: Date, jusqua: Date): number {
  const a = new Date(depuis); a.setHours(0, 0, 0, 0)
  const b = new Date(jusqua); b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function getBabyAge(birthDate: Timestamp): string {
  const b = birthDate?.toDate?.()
  if (!b) return ''
  const days = joursEntre(b, new Date())
  if (days < 7)  return `${days}j`
  const w = Math.floor(days / 7)
  if (w < 8)     return `${w} sem.`
  const mo = Math.floor(days / 30.44)
  if (mo < 24)   return `${mo} mois`
  return `${Math.floor(mo / 12)} ans`
}

/**
 * « 2 » + « goutte » → « 2 gouttes ». L'unité est stockée au singulier et
 * accordée ici : sinon « 1 gouttes » ou « 5 mls » finissent à l'écran.
 */
function formatDose(quantite?: number | string | null, unite?: string | null): string {
  const q = typeof quantite === 'number' ? quantite : Number(String(quantite ?? '').replace(',', '.'))
  const u = (unite ?? '').trim()
  if (!Number.isFinite(q) || !String(quantite ?? '').trim()) return u
  const qTxt = String(q).replace('.', ',')
  if (!u) return qTxt
  const accord = q > 1 && !UNITES_INVARIABLES.has(u) && !/[sx]$/.test(u)
  return `${qTxt} ${u}${accord ? 's' : ''}`
}

/**
 * Ancien format : la dose était UNE chaîne libre (« 2.5 ml », « 1 suppositoire »).
 * On la redécoupe à l'ouverture d'une fiche pour ne pas perdre la saisie d'origine.
 */
function parserDose(dose: string): { quantite: string; unite: string } {
  const m = dose.trim().match(/^([\d.,]+)\s*(.*)$/)
  if (!m) return { quantite: '', unite: dose.trim() }
  return { quantite: m[1].replace('.', ','), unite: m[2].trim().replace(/s$/, '') }
}

/** Date à laquelle le bébé aura `mois` mois — sert aux raccourcis de fin de traitement */
function dateAgeMois(naissance: Date, mois: number): Date {
  const d = new Date(naissance)
  d.setMonth(d.getMonth() + mois)
  return d
}

function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** « HH:MM » (+ jour optionnel « AAAA-MM-JJ ») → Timestamp */
function timeStrToTs(s: string, dateStr?: string): Timestamp {
  const [h, m] = s.split(':').map(Number)
  const d = dateStr ? dateFromInput(dateStr) : new Date()
  d.setHours(h, m, 0, 0)
  return Timestamp.fromDate(d)
}

/** « AAAA-MM-JJ » → Date locale (le constructeur Date() lirait de l'UTC et décalerait le jour) */
function dateFromInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function addMin(s: string, minutes: number): string {
  const [h, m] = s.split(':').map(Number)
  const t = h * 60 + m + minutes
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function tsToTimeStr(ts: Timestamp): string {
  const d = ts?.toDate?.()
  if (!d) return nowTimeStr()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayKey(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
/** « 12/07 » — axe des histogrammes, où la place manque */
function labelJourCourt(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
function dayLabel(d: Date): string {
  const today = new Date(); today.setHours(0,0,0,0)
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1)
  const dm    = new Date(d); dm.setHours(0,0,0,0)
  if (dm.getTime() === today.getTime()) return "Aujourd'hui"
  if (dm.getTime() === yest.getTime())  return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eventDescription(type: BebeEventType, data: Record<string, any>, journee?: BebeJournee): string {
  switch (type) {
    case 'bottle': {
      const k: Record<string, string> = { biberon: 'Biberon', sein_g: 'Sein G.', sein_d: 'Sein D.', tire_lait: 'Tire-lait' }
      // Au sein on mesure une DURÉE et un côté ; au biberon, un volume.
      const mesure = estSein(data.kind)
        ? (data.durationMin ? formatDuration(data.durationMin) : null)
        : (data.amount ? `${data.amount} ml` : null)
      return [
        mesure,
        data.kind ? k[data.kind] ?? data.kind : null,
        data.wasted ? `+ ${data.wasted} ml jeté` : null,
      ].filter(Boolean).join(' · ') || 'Repas'
    }
    case 'diaper': {
      const k: Record<string, string> = { seche: 'Sèche', urine: 'Pipi', selles: 'Caca', mixte: 'Mixte' }
      return k[data.kind] ?? 'Couche'
    }
    case 'sleep': {
      const dur   = data.durationMin ? formatDuration(data.durationMin) : null
      const debut = data.startTime?.toDate?.() as Date | undefined
      const start = debut ? formatTime(data.startTime as Timestamp) : null
      // Sieste ou nuit : déterminé par l'heure de DÉBUT face aux bornes de journée
      const nature = journee && debut ? (estNuit(debut, journee) ? 'Nuit' : 'Sieste') : null
      return [nature, dur, start ? `depuis ${start}` : null].filter(Boolean).join(' · ') || 'Sommeil'
    }
    case 'meds':
      return [data.name, formatDose(data.quantite, data.unite) || data.dose].filter(Boolean).join(' · ') || 'Médicament'
    case 'soin':
      return data.name || 'Soin'
    case 'growth':
      return [
        data.weightG ? formatKg(data.weightG) : null,
        data.heightCm ? `${data.heightCm} cm` : null,
        data.headCm ? `${data.headCm} cm PC` : null,
      ].filter(Boolean).join(' · ') || 'Mesure'
    case 'bath':
      return ''
    case 'temp': {
      if (!data.tempC) return ''
      const t = Number(data.tempC)
      const z = zoneTemperature(t)
      return `${t.toFixed(1).replace('.', ',')} °C${z.court ? ` · ${z.court}` : ''}`
    }
    case 'vaccine':
      return data.name ?? ''
    case 'pump': {
      const k: Record<string, string> = { les_deux: 'Les deux', sein_g: 'Sein G.', sein_d: 'Sein D.' }
      return [
        data.amount ? `${data.amount} ml` : null,
        data.kind ? k[data.kind] ?? data.kind : null,
      ].filter(Boolean).join(' · ') || 'Tirage'
    }
    case 'waste':
      return data.amount ? `${data.amount} ml jeté` : 'Lait jeté'
  }
}

/** Grammes → « 3,450 kg » */
function formatKg(g: number): string {
  return `${(g / 1000).toFixed(3).replace('.', ',')} kg`
}

/** Champ « 3,450 » (kg) → grammes, ou undefined si vide/invalide */
function kgToGrams(s: string): number | undefined {
  const v = parseFloat(s.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : undefined
}

/** Minuscules sans accents : « Température » trouve « temperature » et inversement */
function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** « HH:MM » → minutes depuis minuit */
function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Date de RATTACHEMENT d'un événement. Pour un sommeil on prend son DÉBUT
 * (l'événement est stocké à son heure de fin) : une nuit commencée à 20 h reste
 * dans la journée du 20 h, pas dans celle du réveil.
 */
function dateRattachement(e: BebeEvent): Date | null {
  if (e.type === 'sleep' && e.data?.startTime?.toDate) return e.data.startTime.toDate()
  return e.timestamp?.toDate?.() ?? null
}

/**
 * Un sommeil est-il une NUIT ? Vrai si son début tombe hors de la plage de
 * journée (après l'heure de coucher, ou avant l'heure de réveil).
 */
function estNuit(debutSommeil: Date, j: BebeJournee): boolean {
  const min = debutSommeil.getHours() * 60 + debutSommeil.getMinutes()
  return min >= hhmmToMin(j.fin) || min < hhmmToMin(j.debut)
}

/** Date → « 2026-07-24 » pour un <input type="date"> */
function dateInputStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, bg, tc }: {
  icon: React.ElementType; label: string; value: string; sub?: string; bg: string; tc: string
}) {
  // Le libellé n'est pas réaffiché : l'icône suffit à identifier l'indicateur.
  // Il reste en `title` pour le survol et les lecteurs d'écran.
  return (
    <div title={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 ${bg}`}>
        <Icon size={18} className={tc} />
      </div>
      <p className="text-xl font-bold text-gray-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

/** Date + heure de l'événement — modifiable partout (on saisit souvent après coup) */
function WhenField({ date, time, onDate, onTime, label = 'Date et heure' }: {
  date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void; label?: string
}) {
  const cls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={date} onChange={e => onDate(e.target.value)} className={cls} />
        <input type="time" value={time} onChange={e => onTime(e.target.value)} className={cls} />
      </div>
    </div>
  )
}

/** Observations libres — présent sur TOUS les types d'événement (stocké dans `data.note`) */
function NoteField({ value, onChange, type }: {
  value: string; onChange: (v: string) => void; type: BebeEventType
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
      <AutoTextarea value={value} onChange={onChange} minRows={2}
        placeholder={`Facultatif — ${NOTE_PLACEHOLDERS[type]}`}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}

/** Bloc de statistiques : un thème, plusieurs lignes libellé / valeur */
function StatBloc({ icon: Icon, bg, tc, titre, lignes }: {
  icon: React.ElementType; bg: string; tc: string
  titre: string; lignes: { l: string; v: string }[]
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon size={15} className={tc} />
        </div>
        <p className="text-sm font-semibold text-gray-800">{titre}</p>
      </div>
      <div className="space-y-1.5">
        {lignes.map((li, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-gray-500">{li.l}</span>
            <span className="text-sm font-semibold text-gray-800 text-right">{li.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModalFooter({ onCancel, onSave, saving, label = 'Enregistrer', disabled = false }: {
  onCancel: () => void; onSave: () => void; saving: boolean; label?: string; disabled?: boolean
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onCancel} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
      <button onClick={onSave} disabled={saving || disabled}
        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
        {saving ? '…' : label}
      </button>
    </div>
  )
}

/** Sélecteur de photo rond avec aperçu */
function PhotoPicker({ preview, onPick }: { preview: string; onPick: (file: File) => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <label className="relative cursor-pointer group">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-sky-100 flex items-center justify-center border-2 border-gray-100 group-hover:border-sky-300 transition">
          {preview
            ? <img src={preview} alt="" className="w-full h-full object-cover" />
            : <Baby size={36} className="text-sky-400" />
          }
        </div>
        <div className="absolute bottom-0 right-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md group-hover:bg-blue-700 transition">
          <Camera size={14} />
        </div>
        <input type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f) }} />
      </label>
      <span className="text-xs text-gray-400">Photo (optionnelle)</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BebePage() {
  const { currentUser } = useAuth()
  const { babies, loading: loadingBabies, addBebe, updateBebe, deleteBabeWithEvents } = useBebe(currentUser?.uid)

  // ── Sélection + bébé principal ────────────────────────────────────────────
  const [selectedBabyId, setSelectedBabyId] = useState<string | null>(null)
  const [primaryId, setPrimaryId] = useState<string | null>(null)

  useEffect(() => { try { setPrimaryId(localStorage.getItem(STORAGE_KEY)) } catch {} }, [])

  useEffect(() => {
    if (!babies.length) return
    if (selectedBabyId && babies.some(b => b.id === selectedBabyId)) return
    const pref = babies.find(b => b.id === primaryId) ?? babies[0]
    setSelectedBabyId(pref.id)
  }, [babies, primaryId, selectedBabyId])

  const selectedBaby = babies.find(b => b.id === selectedBabyId) ?? null

  // Plages d'affichage — déclarées ici car elles pilotent la PROFONDEUR du chargement :
  // « tout » (planning complet ou stats sur tout) rouvre l'abonnement avec un plafond élevé.
  const [planningRange, setPlanningRange] = useState<'7j' | '30j' | 'tout'>('7j')
  const [statsRange,    setStatsRange]    = useState<'7j' | '30j' | 'tout'>('7j')
  const historiqueComplet = planningRange === 'tout' || statsRange === 'tout'

  const { events, plafondAtteint, addEvent, updateEvent, deleteEvent } = useBebeEvents(selectedBabyId, historiqueComplet)

  // ── Partage co-parent ─────────────────────────────────────────────────────
  const [showShareModal, setShowShareModal] = useState(false)

  /** Créateur du bébé sélectionné (les bébés d'avant le partage n'ont pas toujours `createdBy`). */
  const isBabyCreator = !selectedBaby?.createdBy || selectedBaby.createdBy === currentUser?.uid

  /** Co-parent invité sur le bébé de quelqu'un d'autre → accès sans abonnement propre
   *  (le partage est inclus dans l'abonnement du parent qui invite). */
  const isSharedGuest = useMemo(
    () => !!currentUser && babies.some(b => !!b.createdBy && b.createdBy !== currentUser.uid),
    [babies, currentUser],
  )
  /** On laisse passer aussi pendant le chargement des bébés : sinon un co-parent sans
   *  abonnement voit brièvement l'écran « Accès non activé » avant que la liste arrive. */
  const gateBypass = isSharedGuest || loadingBabies

  const markAsPrimary = (id: string) => {
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
    setPrimaryId(id); setSelectedBabyId(id)
  }

  // ── Vue ───────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'dashboard' | 'planning' | 'stats' | 'growth' | 'arrival'>('dashboard')

  // Filtres du planning — liste de types VIDE = tout afficher
  const [planningTypes,  setPlanningTypes]  = useState<BebeEventType[]>([])
  const [planningSearch, setPlanningSearch] = useState('')

  // ── Timer sommeil actif ───────────────────────────────────────────────────
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!selectedBaby?.activeSleep) return
    const iv = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(iv)
  }, [selectedBaby?.activeSleep])
  void tick

  const sleepElapsedMin = selectedBaby?.activeSleep
    ? Math.max(0, Math.floor((Date.now() - (selectedBaby.activeSleep.startTime?.toMillis?.() ?? Date.now())) / 60_000))
    : 0

  // ── Ajout / édition bébé ──────────────────────────────────────────────────
  const [showAddBabyModal, setShowAddBabyModal] = useState(false)
  const [addBabyForm, setAddBabyForm] = useState({ name: '', birthDate: '' })
  const [addPhotoFile, setAddPhotoFile] = useState<File | null>(null)
  const [addPhotoPreview, setAddPhotoPreview] = useState<string>('')
  const [savingAdd, setSavingAdd] = useState(false)

  const handleAddBebe = async () => {
    if (!currentUser || !addBabyForm.name.trim() || !addBabyForm.birthDate) return
    setSavingAdd(true)
    try {
      const [y, m, d] = addBabyForm.birthDate.split('-').map(Number)
      let photoUrl: string | undefined
      if (addPhotoFile) {
        photoUrl = await uploadImage(addPhotoFile, `users/${currentUser.uid}/bebe_photos/${Date.now()}_${addPhotoFile.name}`)
      }
      const ref = await addBebe({
        name: addBabyForm.name.trim(),
        birthDate: Timestamp.fromDate(new Date(y, m - 1, d)),
        members: [currentUser.uid],
        createdBy: currentUser.uid,
        ...(photoUrl ? { photoUrl } : {}),
      })
      const newId = (ref as any)?.id
      if (newId) setSelectedBabyId(newId)
      setShowAddBabyModal(false)
      setAddBabyForm({ name: '', birthDate: '' })
      setAddPhotoFile(null); setAddPhotoPreview('')
    } finally { setSavingAdd(false) }
  }

  const [showEditBabyModal, setShowEditBabyModal] = useState(false)
  const [editBabyForm, setEditBabyForm] = useState({
    name: '', birthDate: '',
    bottleKind: DEFAUTS_FALLBACK.bottleKind as BebeBottleKind,
    bottleAmount: String(DEFAUTS_FALLBACK.bottleAmount),
    bottleDuration: String(DEFAUTS_FALLBACK.bottleDurationMin),
    diaperKind: DEFAUTS_FALLBACK.diaperKind as BebeDiaperKind,
    journeeDebut: JOURNEE_FALLBACK.debut,
    journeeFin: JOURNEE_FALLBACK.fin,
  })
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editPhotoPreview, setEditPhotoPreview] = useState<string>('')
  const [savingEditBaby, setSavingEditBaby] = useState(false)

  const openEditBaby = () => {
    if (!selectedBaby) return
    const b = selectedBaby.birthDate?.toDate?.()
    setEditBabyForm({
      name: selectedBaby.name,
      // ⚠️ PAS `toISOString()` : il convertit en UTC, et une naissance datée à minuit
      // en heure française revient au 23 pour un bébé né le 24 — réenregistrer la fiche
      // décalait alors la naissance d'un jour VERS L'ARRIÈRE, à chaque passage.
      birthDate: b ? dateInputStr(b) : '',
      bottleKind:   selectedBaby.defauts?.bottleKind   ?? DEFAUTS_FALLBACK.bottleKind,
      bottleAmount: String(selectedBaby.defauts?.bottleAmount ?? DEFAUTS_FALLBACK.bottleAmount),
      bottleDuration: String(selectedBaby.defauts?.bottleDurationMin ?? DEFAUTS_FALLBACK.bottleDurationMin),
      diaperKind:   selectedBaby.defauts?.diaperKind   ?? DEFAUTS_FALLBACK.diaperKind,
      journeeDebut: selectedBaby.journee?.debut || JOURNEE_FALLBACK.debut,
      journeeFin:   selectedBaby.journee?.fin   || JOURNEE_FALLBACK.fin,
    })
    setEditPhotoFile(null)
    setEditPhotoPreview(selectedBaby.photoUrl ?? '')
    setShowEditBabyModal(true)
  }

  const handleSaveEditBaby = async () => {
    if (!selectedBabyId || !editBabyForm.name.trim() || !editBabyForm.birthDate) return
    setSavingEditBaby(true)
    try {
      const [y, m, d] = editBabyForm.birthDate.split('-').map(Number)
      let photoUrl = selectedBaby?.photoUrl
      if (editPhotoFile && currentUser) {
        photoUrl = await uploadImage(editPhotoFile, `users/${currentUser.uid}/bebe_photos/${Date.now()}_${editPhotoFile.name}`)
      }
      await updateBebe(selectedBabyId, {
        name: editBabyForm.name.trim(),
        birthDate: Timestamp.fromDate(new Date(y, m - 1, d)),
        ...(photoUrl ? { photoUrl } : {}),
        defauts: {
          bottleKind: editBabyForm.bottleKind,
          bottleAmount: Number(editBabyForm.bottleAmount) || DEFAUTS_FALLBACK.bottleAmount,
          bottleDurationMin: Number(editBabyForm.bottleDuration) || DEFAUTS_FALLBACK.bottleDurationMin,
          diaperKind: editBabyForm.diaperKind,
        },
        journee: { debut: editBabyForm.journeeDebut, fin: editBabyForm.journeeFin },
      })
      setShowEditBabyModal(false)
      setEditPhotoFile(null); setEditPhotoPreview('')
    } finally { setSavingEditBaby(false) }
  }

  // ── Suppression bébé ──────────────────────────────────────────────────────
  const [showDeleteBabyConfirm, setShowDeleteBabyConfirm] = useState(false)
  const [deletingBaby, setDeletingBaby] = useState(false)

  const handleDeleteBaby = async () => {
    if (!selectedBabyId) return
    setDeletingBaby(true)
    try {
      await deleteBabeWithEvents(selectedBabyId)
      setSelectedBabyId(null)
      setShowDeleteBabyConfirm(false)
      // Retirer du localStorage si c'était le principal
      if (selectedBabyId === primaryId) { try { localStorage.removeItem(STORAGE_KEY) } catch {}; setPrimaryId(null) }
    } finally { setDeletingBaby(false) }
  }

  // ── Sommeil actif ─────────────────────────────────────────────────────────
  const handleStartSleep = async () => {
    if (!selectedBabyId) return
    await updateBebe(selectedBabyId, { activeSleep: { startTime: Timestamp.now() } })
  }

  const handleWakeUp = async () => {
    if (!currentUser || !selectedBabyId || !selectedBaby?.activeSleep) return
    const startTs = selectedBaby.activeSleep.startTime
    const endTs   = Timestamp.now()
    const durationMin = Math.max(1, Math.floor((endTs.toMillis() - startTs.toMillis()) / 60_000))
    // La note écrite au coucher (sommeil saisi « fin en attente ») suit l'événement
    const note = selectedBaby.activeSleep.note?.trim()
    await addEvent({
      type: 'sleep',
      data: { startTime: startTs, durationMin, ...(note ? { note } : {}) },
      timestamp: endTs,
      createdBy: currentUser.uid,
    })
    await updateBebe(selectedBabyId, { activeSleep: null })
  }

  /** Replier/déplier les lignes déjà faites du jour (masquées par défaut) */
  const [voirFaits, setVoirFaits] = useState(false)

  /** Ligne de « À faire aujourd'hui » en attente de confirmation (clé de la ligne) */
  const [confirmPrise, setConfirmPrise] = useState<string | null>(null)

  /** Routine en attente de saisie (température) : rattache l'événement à venir */
  const [routineEnCours, setRoutineEnCours] = useState<{ id: string; prise: string } | null>(null)

  // ── Traitements réguliers ─────────────────────────────────────────────────
  const [showTraitModal, setShowTraitModal] = useState(false)
  const [traitEditId,    setTraitEditId]    = useState<string | null>(null)
  const [traitDelete,    setTraitDelete]    = useState<string | null>(null)
  const [savingTrait,    setSavingTrait]    = useState(false)
  const [traitForm,      setTraitForm]      = useState<{
    nom: string; type: 'meds' | 'autre'; quantite: string; unite: string
    tousLes: string; heures: string[]; jusquAu: string; note: string
  }>({ nom: '', type: 'meds', quantite: '', unite: '', tousLes: '1', heures: ['08:00'], jusquAu: '', note: '' })

  const openTraitModal = (t?: BebeRoutine) => {
    setTraitEditId(t?.id ?? null)
    setTraitForm({
      nom: t?.nom ?? '',
      // Une routine sans type est une fiche d'avant les routines : c'était un médicament
      type: (t?.type ?? 'meds') === 'meds' ? 'meds' : 'autre',
      quantite: t?.quantite != null ? String(t.quantite).replace('.', ',') : '',
      unite: t?.unite ?? '',
      tousLes: String(t?.tousLesNJours ?? 1),
      heures: t?.heures?.length ? [...t.heures] : ['08:00'],
      jusquAu: t?.jusquAu?.toDate ? dateInputStr(t.jusquAu.toDate()) : '',
      note: t?.note ?? '',
    })
    setShowTraitModal(true)
  }

  const saveTraitement = async () => {
    if (!selectedBabyId || !traitForm.nom.trim()) return
    setSavingTrait(true)
    try {
      const q = Number(traitForm.quantite.replace(',', '.'))
      const heures = traitForm.heures.filter(Boolean).sort()
      // Clés absentes plutôt qu'`undefined` : `updateBebe` écrit l'objet tel quel
      // dans Firestore, qui refuse `undefined`.
      const n = Math.max(1, Math.round(Number(traitForm.tousLes) || 1))
      const t: BebeRoutine = {
        id: traitEditId ?? `t${Date.now().toString(36)}`,
        nom: traitForm.nom.trim(),
        // « Autre récurrence » : le type réel se lit dans l'intitulé
        type: traitForm.type === 'meds' ? 'meds' : typeDepuisIntitule(traitForm.nom),
        tousLesNJours: n,
        // Au-delà du quotidien, une seule heure sert de repère
        heures: n > 1 ? (heures.length ? [heures[0]] : []) : (heures.length ? heures : ['08:00']),
        ...(traitForm.type === 'meds' && Number.isFinite(q) && traitForm.quantite.trim() ? { quantite: q } : {}),
        ...(traitForm.type === 'meds' && traitForm.unite.trim() ? { unite: traitForm.unite.trim() } : {}),
        ...(traitForm.note.trim() ? { note: traitForm.note.trim() } : {}),
        ...(traitForm.jusquAu ? { jusquAu: Timestamp.fromDate(dateFromInput(traitForm.jusquAu)) } : {}),
      }
      if (traitForm.type === 'meds') {
        await memoriserMedicament(traitForm.nom, traitForm.quantite, traitForm.unite)
      }
      const liste = selectedBaby?.traitements ?? []
      await updateBebe(selectedBabyId, {
        traitements: traitEditId ? liste.map(x => (x.id === traitEditId ? t : x)) : [...liste, t],
      })
      setShowTraitModal(false)
    } finally { setSavingTrait(false) }
  }

  const supprimerTraitement = async (id: string) => {
    if (!selectedBabyId) return
    await updateBebe(selectedBabyId, { traitements: (selectedBaby?.traitements ?? []).filter(x => x.id !== id) })
    setTraitDelete(null)
  }

  // ── Modales événements ────────────────────────────────────────────────────
  const [modalType,    setModalType]    = useState<BebeEventType | null>(null)
  const [editingEvent, setEditingEvent] = useState<BebeEvent | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [savingEvent,   setSavingEvent]   = useState(false)

  // Valeurs par défaut du bébé sélectionné (réglées dans « Modifier »), avec repli
  const defauts: Required<BebeDefauts> = useMemo(() => ({
    bottleKind:   selectedBaby?.defauts?.bottleKind   ?? DEFAUTS_FALLBACK.bottleKind,
    bottleAmount: selectedBaby?.defauts?.bottleAmount ?? DEFAUTS_FALLBACK.bottleAmount,
    bottleDurationMin: selectedBaby?.defauts?.bottleDurationMin ?? DEFAUTS_FALLBACK.bottleDurationMin,
    diaperKind:   selectedBaby?.defauts?.diaperKind   ?? DEFAUTS_FALLBACK.diaperKind,
  }), [selectedBaby])

  const [bottleForm, setBottleForm] = useState({ amount: '120', kind: 'biberon', duration: '15', wasted: '' })

  // Dernière tétée au sein : sert à alterner les côtés (l'info que cherche un
  // parent qui allaite, et qu'aucun écran ne donnait).
  const derniereTetee = useMemo(() => {
    const t = events
      .filter(e => e.type === 'bottle' && estSein(e.data?.kind))
      .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))[0]
    if (!t) return null
    return { kind: t.data.kind as 'sein_g' | 'sein_d', at: t.timestamp }
  }, [events])
  const [diaperForm, setDiaperForm] = useState({ kind: 'urine' })
  // `enAttente` = on connaît le coucher mais pas encore le réveil : au lieu d'un
  // événement, on repose le sommeil EN COURS du bébé, clos plus tard par « Réveillé ! ».
  const [sleepForm,  setSleepForm]  = useState({ startTime: nowTimeStr(), endTime: nowTimeStr(), enAttente: false })
  const [medsForm,   setMedsForm]   = useState({ name: '', quantite: '', unite: '' })
  const [medsSearch, setMedsSearch] = useState('')
  // Une mesure porte une DATE (pesée à la PMI notée le soir), pas l'heure courante
  const [growthForm, setGrowthForm] = useState({ weight: '', height: '', head: '', date: '', time: '' })
  // Observations libres — commun à TOUS les types d'événement (`data.note`)
  const [noteForm, setNoteForm] = useState('')
  const [tempForm, setTempForm] = useState('')
  // Quand l'événement a eu lieu — commun aux saisies « instantanées »
  // (biberon, couche, médicament, bain, température) ; on note souvent après coup.
  const [whenForm, setWhenForm] = useState({ date: '', time: '' })
  // Vaccin : porte une date (souvent saisi le soir, après le rendez-vous)
  const [vaccineForm, setVaccineForm] = useState({ name: '', date: '', time: '' })
  const [pumpForm, setPumpForm] = useState({ amount: '100', kind: 'les_deux' })
  // Lait maternel jeté (action à part) — sort de la réserve sans avoir été bu
  const [wasteForm, setWasteForm] = useState({ amount: '' })
  // Soin libre : seul son intitulé le distingue (peau, cordon, ongles…)
  const [soinForm, setSoinForm] = useState({ name: '' })

  const openNewModal = (type: BebeEventType) => {
    setEditingEvent(null)
    if (type === 'bottle') {
      // Si le bébé est allaité, on propose le côté OPPOSÉ à la dernière tétée :
      // l'alternance est la règle, et c'est ce qu'on oublie le plus vite la nuit.
      const kind = estSein(defauts.bottleKind) && derniereTetee
        ? (derniereTetee.kind === 'sein_g' ? 'sein_d' : 'sein_g')
        : defauts.bottleKind
      setBottleForm({ amount: String(defauts.bottleAmount), kind, duration: String(defauts.bottleDurationMin), wasted: '' })
    }
    if (type === 'diaper') setDiaperForm({ kind: defauts.diaperKind })
    if (type === 'sleep')  setSleepForm({ startTime: nowTimeStr(), endTime: nowTimeStr(), enAttente: false })
    if (type === 'meds')   { setMedsForm({ name: '', quantite: '', unite: '' }); setMedsSearch('') }
    if (type === 'growth') setGrowthForm({ weight: '', height: '', head: '', date: dateInputStr(new Date()), time: nowTimeStr() })
    if (type === 'temp')    setTempForm('')
    if (type === 'vaccine') setVaccineForm({ name: '', date: dateInputStr(new Date()), time: nowTimeStr() })
    if (type === 'pump')    setPumpForm({ amount: '100', kind: 'les_deux' })
    if (type === 'waste')   setWasteForm({ amount: '' })
    if (type === 'soin')    setSoinForm({ name: '' })
    setWhenForm({ date: dateInputStr(new Date()), time: nowTimeStr() })
    setNoteForm('')
    setModalType(type)
  }

  const openEditModal = (event: BebeEvent) => {
    setEditingEvent(event)
    if (event.type === 'bottle') {
      setBottleForm({
        amount: String(event.data?.amount ?? defauts.bottleAmount),
        kind: event.data?.kind ?? defauts.bottleKind,
        duration: String(event.data?.durationMin ?? 15),
        wasted: event.data?.wasted ? String(event.data.wasted) : '',
      })
    }
    if (event.type === 'diaper') setDiaperForm({ kind: event.data?.kind ?? defauts.diaperKind })
    if (event.type === 'sleep') {
      const startStr = event.data?.startTime ? tsToTimeStr(event.data.startTime as Timestamp) : nowTimeStr()
      const endStr   = tsToTimeStr(event.timestamp)
      setSleepForm({ startTime: startStr, endTime: endStr, enAttente: false })
    }
    if (event.type === 'meds') {
      // Fiche d'avant la séparation quantité/unité : on redécoupe sa dose libre
      const ancien = event.data?.dose ? parserDose(String(event.data.dose)) : null
      setMedsForm({
        name: event.data?.name ?? '',
        quantite: event.data?.quantite != null ? String(event.data.quantite).replace('.', ',') : (ancien?.quantite ?? ''),
        unite: event.data?.unite ?? ancien?.unite ?? '',
      })
      setMedsSearch('')
    }
    if (event.type === 'growth') {
      setGrowthForm({
        weight: event.data?.weightG ? (event.data.weightG / 1000).toFixed(3).replace('.', ',') : '',
        height: event.data?.heightCm ? String(event.data.heightCm) : '',
        head: event.data?.headCm ? String(event.data.headCm) : '',
        date: dateInputStr(event.timestamp?.toDate?.() ?? new Date()),
        time: tsToTimeStr(event.timestamp),
      })
    }
    if (event.type === 'temp') setTempForm(event.data?.tempC ? String(event.data.tempC) : '')
    if (event.type === 'pump') {
      setPumpForm({
        amount: String(event.data?.amount ?? 100),
        kind: event.data?.kind ?? 'les_deux',
      })
    }
    if (event.type === 'waste') setWasteForm({ amount: String(event.data?.amount ?? '') })
    if (event.type === 'soin')  setSoinForm({ name: event.data?.name ?? '' })
    if (event.type === 'vaccine') {
      setVaccineForm({
        name: event.data?.name ?? '',
        date: dateInputStr(event.timestamp?.toDate?.() ?? new Date()),
        time: tsToTimeStr(event.timestamp),
      })
    }
    // Pour un sommeil, le « jour » est celui du COUCHER (l'événement est stocké à
    // son heure de fin) : sans ça, rééditer une nuit la décalerait d'un jour.
    const quand = (event.type === 'sleep' ? event.data?.startTime?.toDate?.() : null)
      ?? event.timestamp?.toDate?.() ?? new Date()
    setWhenForm({ date: dateInputStr(quand), time: tsToTimeStr(event.timestamp) })
    setNoteForm(event.data?.note ?? '')
    setModalType(event.type)
  }

  const closeModal = () => { setModalType(null); setEditingEvent(null); setRoutineEnCours(null) }

  const handleSaveEvent = async () => {
    if (!currentUser || !modalType) return
    setSavingEvent(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: Record<string, any> = {}
      let ts = Timestamp.now()

      if (modalType === 'bottle') {
        // Deux jeux de champs selon le mode : jamais de ml sur une tétée, jamais
        // de durée sur un biberon — sinon les totaux mélangent des unités.
        data = estSein(bottleForm.kind)
          ? { kind: bottleForm.kind, durationMin: Number(bottleForm.duration) || 0 }
          : {
              kind: bottleForm.kind,
              amount: Number(bottleForm.amount) || 0,
              // « jeté » : uniquement pour un biberon de lait maternel, et seulement s'il y a un reste.
              // ⚠️ C'est un décrément EN PLUS de `amount` (= ce qui a été bu), pas une part de celui-ci.
              ...(bottleForm.kind === 'tire_lait' && Number(bottleForm.wasted) > 0
                ? { wasted: Number(bottleForm.wasted) } : {}),
            }
      } else if (modalType === 'diaper') {
        data = { kind: diaperForm.kind }
      } else if (modalType === 'sleep') {
        const startTs = timeStrToTs(sleepForm.startTime, whenForm.date)
        // Fin « en attente » : rien à historiser, on pose le sommeil en cours sur le
        // bébé (même mécanique que « Commencer maintenant », mais à l'heure voulue).
        if (sleepForm.enAttente && selectedBabyId) {
          const noteAttente = noteForm.trim()
          // On repartait d'un événement déjà enregistré : il redevient « en cours »
          if (editingEvent) await deleteEvent(editingEvent.id)
          await updateBebe(selectedBabyId, {
            activeSleep: { startTime: startTs, ...(noteAttente ? { note: noteAttente } : {}) },
          })
          closeModal()
          return
        }
        let endDate   = timeStrToTs(sleepForm.endTime, whenForm.date).toDate()
        // Fin ≤ début ⇒ le sommeil a franchi minuit : la fin est le LENDEMAIN.
        // (avant, seule la durée était corrigée, la date de fin restait au jour du début)
        if (endDate.getTime() <= startTs.toMillis()) endDate = new Date(endDate.getTime() + 24 * 3600_000)
        const endTs = Timestamp.fromDate(endDate)
        const durationMin = Math.max(1, Math.floor((endTs.toMillis() - startTs.toMillis()) / 60_000))
        data = { startTime: startTs, durationMin }; ts = endTs
      } else if (modalType === 'meds') {
        // Quantité et unité SÉPARÉES : corriger « 2 gouttes » en 3 ne doit pas
        // obliger à réécrire l'unité. Champ vide = clé absente.
        const qMeds = Number(medsForm.quantite.replace(',', '.'))
        data = {
          name: medsForm.name.trim(),
          ...(Number.isFinite(qMeds) && medsForm.quantite.trim() ? { quantite: qMeds } : {}),
          ...(medsForm.unite.trim() ? { unite: medsForm.unite.trim() } : {}),
        }
        // Un médicament saisi à la main rejoint la liste proposée la prochaine fois
        await memoriserMedicament(medsForm.name, medsForm.quantite, medsForm.unite)
      } else if (modalType === 'growth') {
        const weightG  = kgToGrams(growthForm.weight)
        const heightCm = growthForm.height ? Number(growthForm.height) : undefined
        const headCm   = growthForm.head ? Number(growthForm.head) : undefined
        // Champ vide = clé absente : la courbe correspondante ignore le point,
        // au lieu d'y lire un 0 qui écraserait l'échelle.
        data = {
          ...(weightG ? { weightG } : {}),
          ...(heightCm ? { heightCm } : {}),
          ...(headCm ? { headCm } : {}),
        }
        // Heure réelle de la pesée : sans elle la mesure se rangeait à midi dans le
        // planning. Repli sur 12 h si le champ est vide (comportement d'avant).
        ts = timeStrToTs(growthForm.time || '12:00', growthForm.date)
      } else if (modalType === 'pump') {
        data = {
          amount: Number(pumpForm.amount) || 0,
          kind: pumpForm.kind,
        }
      } else if (modalType === 'waste') {
        data = { amount: Number(wasteForm.amount) || 0 }
      } else if (modalType === 'soin') {
        data = { name: soinForm.name.trim() }
      } else if (modalType === 'bath') {
        data = {}
      } else if (modalType === 'temp') {
        data = { tempC: Number(tempForm.replace(',', '.')) }
      } else if (modalType === 'vaccine') {
        data = { name: vaccineForm.name.trim() }
        ts = timeStrToTs(vaccineForm.time || '12:00', vaccineForm.date)
      }

      // Saisies « instantanées » : l'horodatage vient des champs date + heure
      // (le sommeil pose le sien depuis ses bornes, mesure et vaccin depuis leur date).
      if ((['bottle', 'diaper', 'meds', 'bath', 'soin', 'temp', 'pump', 'waste'] as BebeEventType[]).includes(modalType)
          && whenForm.date && whenForm.time) {
        ts = timeStrToTs(whenForm.time, whenForm.date)
      }

      // Saisie ouverte depuis une routine (température) : on l'y rattache pour
      // que la ligne du jour se coche toute seule.
      if (routineEnCours && !editingEvent) {
        data.traitementId = routineEnCours.id
        if (routineEnCours.prise) data.prise = routineEnCours.prise
      }

      // ⚠️ `updateEvent` remplace TOUT le `data` : sans cette recopie, corriger
      // l'heure d'une prise la décrochait de sa routine et la ligne du jour
      // repassait « à faire » alors qu'elle venait d'être cochée.
      if (editingEvent?.data?.traitementId) {
        data.traitementId = editingEvent.data.traitementId
        if (editingEvent.data.prise) data.prise = editingEvent.data.prise
      }

      // Observations : commun à tous les types. Chaîne vide = clé absente, pour
      // qu'une note effacée disparaisse vraiment au lieu de rester en `''`.
      const note = noteForm.trim()
      if (note) data.note = note

      if (editingEvent) {
        await updateEvent(editingEvent.id, { type: modalType, data, timestamp: ts, createdBy: currentUser.uid })
      } else {
        await addEvent({ type: modalType, data, timestamp: ts, createdBy: currentUser.uid })
      }
      closeModal()
    } finally { setSavingEvent(false) }
  }

  // ── Données calculées ─────────────────────────────────────────────────────
  // Journée logique du bébé (réglable dans « Modifier »), avec repli 7 h → 20 h
  const journee: BebeJournee = useMemo(() => ({
    debut: selectedBaby?.journee?.debut || JOURNEE_FALLBACK.debut,
    fin:   selectedBaby?.journee?.fin   || JOURNEE_FALLBACK.fin,
  }), [selectedBaby])

  // Journée CIVILE (minuit), volontairement : rattacher un biberon de 6 h 30 à la
  // veille sous prétexte que la journée du bébé commence à 7 h est incompréhensible
  // — l'événement est daté d'aujourd'hui, il doit compter aujourd'hui.
  // Ce qui reste corrigé : un sommeil compte au jour où il a COMMENCÉ
  // (cf. dateRattachement), donc une nuit à cheval sur minuit n'est plus coupée en deux.
  // Les bornes de journée servent au classement sieste / nuit, pas au découpage.
  const todayEvents = useMemo(() => {
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0)
    return events.filter(e => {
      const d = dateRattachement(e)
      return d && d >= debutJour
    })
  }, [events])

  const todayStats = useMemo(() => {
    const b = todayEvents.filter(e => e.type === 'bottle')
    const d = todayEvents.filter(e => e.type === 'diaper')
    const s = todayEvents.filter(e => e.type === 'sleep')
    const min = (list: BebeEvent[]) => list.reduce((n, e) => n + ((e.data?.durationMin as number) ?? 0), 0)
    const nuits   = s.filter(e => { const d = dateRattachement(e); return d && estNuit(d, journee) })
    const siestes = s.filter(e => !nuits.includes(e))
    return {
      bottleCount: b.length,
      bottleMl: b.reduce((n, e) => n + ((e.data?.amount as number) ?? 0), 0),
      // Les tétées se totalisent en minutes : additionner des ml et des minutes
      // donnerait un chiffre qui ne veut rien dire.
      teteeMin: b.filter(e => estSein(e.data?.kind)).reduce((n, e) => n + ((e.data?.durationMin as number) ?? 0), 0),
      diaperCount: d.length,
      sleepMin: min(s),
      siesteMin: min(siestes),
      nuitMin: min(nuits),
      siesteCount: siestes.length,
    }
  }, [todayEvents, journee])

  // Prédiction du prochain endormissement — cf. lib/bebeSommeil.ts (fenêtres d'éveil).
  // Rien tant que le bébé dort : la fenêtre en cours n'a pas commencé.
  const sleepPrediction = useMemo(() => {
    if (selectedBaby?.activeSleep) return null
    const termines = events
      .filter(e => e.type === 'sleep' && e.data?.startTime?.toDate && e.timestamp?.toDate)
      .map(e => ({ debut: e.data.startTime.toDate() as Date, fin: e.timestamp.toDate() as Date }))
      .sort((a, b) => b.fin.getTime() - a.fin.getTime())
    return predireProchainSommeil(termines, selectedBaby?.birthDate?.toDate?.() ?? null, new Date())
  }, [events, selectedBaby])

  const bottlePrediction = useMemo(() => {
    const b = events.filter(e => e.type === 'bottle').sort((a, z) => (z.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))
    if (b.length < 2) return null
    const r = b.slice(0, 5)
    const intervals = r.slice(0, -1).map((e, i) => ((e.timestamp?.seconds ?? 0) - (r[i+1].timestamp?.seconds ?? 0)) / 60)
    const avgMin = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length)
    const predictedMs = (b[0].timestamp?.seconds ?? 0) * 1000 + avgMin * 60_000
    return { predictedAt: new Date(predictedMs), avgIntervalMin: avgMin, lastBottle: b[0], diffMin: Math.floor((predictedMs - Date.now()) / 60_000) }
  }, [events])

  // ── Statistiques sur une période (`statsRange` est déclaré plus haut) ───────
  const stats = useMemo(() => {
    const cutoff = new Date()
    if (statsRange !== 'tout') {
      cutoff.setDate(cutoff.getDate() - (statsRange === '7j' ? 7 : 30))
      cutoff.setHours(0, 0, 0, 0)
    } else {
      cutoff.setTime(0)
    }
    const dans = events.filter(e => { const d = dateRattachement(e); return d && d >= cutoff })
    const par = (t: BebeEventType) => dans.filter(e => e.type === t)
    const somme = (list: BebeEvent[], cle: string) =>
      list.reduce((n, e) => n + ((e.data?.[cle] as number) ?? 0), 0)

    // Nombre de jours RÉELLEMENT couverts : diviser par 7 alors qu'on n'a que
    // 2 jours de saisie donnerait des moyennes trois fois trop basses.
    const jours = new Set(dans.map(e => { const d = dateRattachement(e)!; return dayKey(d) })).size || 1

    const repas = par('bottle')
    const biberons = repas.filter(e => !estSein(e.data?.kind))
    const tetees = repas.filter(e => estSein(e.data?.kind))
    const couches = par('diaper')
    const sommeils = par('sleep')
    const nuits = sommeils.filter(e => { const d = dateRattachement(e); return d && estNuit(d, journee) })
    const siestes = sommeils.filter(e => !nuits.includes(e))

    // Série jour par jour pour les histogrammes. On part des jours RÉELLEMENT
    // couverts (mêmes jours que les moyennes) plutôt que d'un calendrier plein :
    // une colonne à zéro pour un jour non saisi ferait croire à un jour sans repas.
    const parJour = new Map<string, { date: Date; repas: number; ml: number; couches: number; sieste: number; nuit: number }>()
    for (const e of dans) {
      const d = dateRattachement(e); if (!d) continue
      const k = dayKey(d)
      if (!parJour.has(k)) {
        const jour = new Date(d); jour.setHours(0, 0, 0, 0)
        parJour.set(k, { date: jour, repas: 0, ml: 0, couches: 0, sieste: 0, nuit: 0 })
      }
      const j = parJour.get(k)!
      if (e.type === 'bottle') {
        j.repas += 1
        if (!estSein(e.data?.kind)) j.ml += (e.data?.amount as number) ?? 0
      } else if (e.type === 'diaper') {
        j.couches += 1
      } else if (e.type === 'sleep') {
        const min = (e.data?.durationMin as number) ?? 0
        if (estNuit(d, journee)) j.nuit += min; else j.sieste += min
      }
    }
    const serie = Array.from(parJour.values()).sort((a, b) => a.date.getTime() - b.date.getTime())

    return {
      jours,
      serie,
      repas: repas.length,
      biberonMl: somme(biberons, 'amount'),
      teteeMin: somme(tetees, 'durationMin'),
      teteeCount: tetees.length,
      couches: couches.length,
      couchesParType: DIAPER_KINDS.map(k => ({ ...k, n: couches.filter(e => e.data?.kind === k.v).length })),
      sommeilMin: somme(sommeils, 'durationMin'),
      siesteMin: somme(siestes, 'durationMin'),
      siesteCount: siestes.length,
      nuitMin: somme(nuits, 'durationMin'),
      bains: par('bath').length,
      tirages: par('pump').length,
      tirageMl: somme(par('pump'), 'amount'),
      meds: par('meds').length,
      temps: par('temp').length,
      fievres: par('temp').filter(e => Number(e.data?.tempC) >= SEUIL_FIEVRE).length,
      tempsBasses: par('temp').filter(e => Number(e.data?.tempC) < TEMP_NORMALE.min).length,
    }
  }, [events, statsRange, journee])

  // ── Réserve de lait maternel ───────────────────────────────────────────────
  // Stock physique (frigo/congélateur), donc CUMULÉ sur tout l'historique :
  //   ce qui a été tiré  −  ce qui a été bu  −  ce qui a été jeté.
  // « Bu » = biberons de lait maternel (kind `tire_lait`). « Jeté » vient de deux
  // sources : le reste d'un biberon (`wasted`) et l'action « Lait jeté » (type `waste`).
  const stockLait = useMemo(() => {
    let tire = 0, bu = 0, jete = 0
    for (const e of events) {
      if (e.type === 'pump') tire += Number(e.data?.amount) || 0
      else if (e.type === 'bottle' && e.data?.kind === 'tire_lait') {
        bu   += Number(e.data?.amount) || 0
        jete += Number(e.data?.wasted) || 0
      } else if (e.type === 'waste') jete += Number(e.data?.amount) || 0
    }
    return { tire, bu, jete, restant: tire - bu - jete, actif: tire > 0 || bu > 0 || jete > 0 }
  }, [events])

  // ── Croissance ─────────────────────────────────────────────────────────────
  // Les infos de naissance servent de PREMIER point : la courbe démarre à la
  // naissance sans avoir à ressaisir ce qui est déjà dans le faire-part.
  const mesures = useMemo(() => {
    const liste = events
      .filter(e => e.type === 'growth')
      .map(e => ({
        id: e.id,
        date: e.timestamp?.toDate?.() ?? new Date(),
        weightG: e.data?.weightG as number | undefined,
        heightCm: e.data?.heightCm as number | undefined,
        headCm: e.data?.headCm as number | undefined,
        origine: false,
        event: e as BebeEvent | null,
      }))

    const naissance = selectedBaby?.birthDate?.toDate?.()
    if (naissance && (selectedBaby?.birthWeightG || selectedBaby?.birthHeightCm || selectedBaby?.birthHeadCm)) {
      liste.push({
        id: 'naissance',
        date: naissance,
        weightG: selectedBaby.birthWeightG,
        heightCm: selectedBaby.birthHeightCm,
        headCm: selectedBaby.birthHeadCm,
        origine: true,
        event: null,
      })
    }
    return liste.sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [events, selectedBaby])

  const pointsPoids: GrowthPoint[] = useMemo(
    () => mesures.filter(m => m.weightG).map(m => ({ date: m.date, value: m.weightG! / 1000, origine: m.origine })),
    [mesures],
  )
  const pointsTaille: GrowthPoint[] = useMemo(
    () => mesures.filter(m => m.heightCm).map(m => ({ date: m.date, value: m.heightCm!, origine: m.origine })),
    [mesures],
  )
  const pointsPC: GrowthPoint[] = useMemo(
    () => mesures.filter(m => m.headCm).map(m => ({ date: m.date, value: m.headCm!, origine: m.origine })),
    [mesures],
  )

  // Vaccins et températures : historique COMPLET (le planning ne remonte qu'à 30 j)
  const vaccins = useMemo(
    () => events.filter(e => e.type === 'vaccine')
      .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0)),
    [events],
  )
  const temperatures = useMemo(
    () => events.filter(e => e.type === 'temp')
      .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0)),
    [events],
  )

  // Planning : regroupement par jour
  const planningDays = useMemo(() => {
    // « tout » : aucun seuil, on remonte aussi loin que l'historique chargé
    const cutoff = new Date()
    if (planningRange === 'tout') cutoff.setTime(0)
    else { cutoff.setDate(cutoff.getDate() - (planningRange === '7j' ? 7 : 30)); cutoff.setHours(0, 0, 0, 0) }
    // Regroupement par jour civil de la date de RATTACHEMENT : un sommeil compte
    // au jour de son coucher, donc une nuit à cheval sur minuit reste entière.
    const groups: Record<string, { label: string; date: Date; events: BebeEvent[] }> = {}
    events.forEach(e => {
      const d = dateRattachement(e); if (!d || d < cutoff) return
      const jour = new Date(d); jour.setHours(0, 0, 0, 0)
      const k = dayKey(jour)
      if (!groups[k]) groups[k] = { label: dayLabel(jour), date: jour, events: [] }
      groups[k].events.push(e)
    })
    return Object.values(groups).sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [events, planningRange])

  /**
   * Le planning filtré : par type et par texte libre.
   *
   * La recherche porte sur tout ce qui est LISIBLE de l'événement — son type, sa
   * description telle qu'elle s'affiche, son intitulé et son observation — pour
   * que « doliprane », « caca » ou « régurgité » tombent juste sans rien connaître
   * de la structure des données. Un jour qui ne garde aucun événement disparaît.
   *
   * ⚠️ Volontairement séparé de `planningDays` : les moyennes par jour restent
   * calculées sur TOUS les événements de la période, sinon filtrer sur « Couche »
   * afficherait 0 ml de lait par jour.
   */
  const planningDaysFiltres = useMemo(() => {
    const q = normaliser(planningSearch.trim())
    if (!planningTypes.length && !q) return planningDays
    const correspond = (e: BebeEvent) => {
      if (planningTypes.length && !planningTypes.includes(e.type)) return false
      if (!q) return true
      const texte = normaliser([
        EVENT_LABELS[e.type],
        eventDescription(e.type, e.data ?? {}, journee),
        e.data?.name,
        e.data?.note,
      ].filter(Boolean).join(' '))
      return texte.includes(q)
    }
    return planningDays
      .map(j => ({ ...j, events: j.events.filter(correspond) }))
      .filter(j => j.events.length > 0)
  }, [planningDays, planningTypes, planningSearch, journee])

  const planningFiltreActif = planningTypes.length > 0 || planningSearch.trim().length > 0
  const planningNbTrouves = planningDaysFiltres.reduce((n, j) => n + j.events.length, 0)

  /** Libellé de périodicité, partagé par la carte d'accueil et la liste de l'onglet Santé */
  const libelleRecurrence = (r: BebeRoutine) => {
    const n = Math.max(1, r.tousLesNJours ?? 1)
    if (n > 1) {
      if (n === 7) return 'chaque semaine'
      if (n === 14) return 'toutes les 2 semaines'
      if (n === 30) return 'chaque mois'
      if (n % 30 === 0) return `tous les ${n / 30} mois`
      return `tous les ${n} jours`
    }
    return r.heures?.length > 1 ? `${r.heures.length}×/jour — ${r.heures.join(', ')}` : 'chaque jour'
  }

  /** Depuis combien de jours cette routine a-t-elle été faite pour la dernière fois ? */
  const dernierFait = (r: BebeRoutine): number | null => {
    const d = events
      .filter(e => e.data?.traitementId === r.id)
      .map(e => e.timestamp?.toDate?.())
      .filter((x): x is Date => !!x)
      .sort((a, b) => b.getTime() - a.getTime())[0]
    return d ? joursEntre(d, new Date()) : null
  }

  /**
   * Ce qu'il reste à faire aujourd'hui : une ligne par échéance.
   *
   * 🔑 Une routine à plus d'un jour d'intervalle se recale sur la DERNIÈRE fois
   * où elle a été faite, jamais sur un calendrier fixe : un bain « tous les 2
   * jours » sauté reste dû le lendemain (et s'affiche en retard) au lieu de
   * disparaître jusqu'à la prochaine case du planning.
   *
   * Une ligne quotidienne est « faite » quand un événement du jour porte le même
   * `traitementId` ET le même horaire prévu — c'est ce qui permet de cocher
   * matin et soir séparément.
   */
  const prisesDuJour = useMemo(() => {
    const routines = selectedBaby?.traitements ?? []
    if (!routines.length) return []
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0)
    const aujourdhui = new Date()
    const duJour = events.filter(e => {
      const d = e.timestamp?.toDate?.()
      return d && d >= debutJour
    })
    const lignes = routines.flatMap(r => {
      // La date de fin est INCLUSE : la routine disparaît le lendemain
      const fin = r.jusquAu?.toDate?.()
      if (fin && joursEntre(fin, aujourdhui) > 0) return []
      const n = Math.max(1, r.tousLesNJours ?? 1)

      if (n === 1) {
        const heures = r.heures?.length ? r.heures : ['']
        return heures.map(h => ({
          cle: `${r.id}-${h}`, routine: r, heure: h, tousLes: 1, retard: 0, depuis: null as number | null,
          event: duJour.find(e => e.data?.traitementId === r.id && (e.data?.prise ?? '') === h) ?? null,
        }))
      }

      const depuis = dernierFait(r)
      const faitAujourdhui = depuis === 0
      // Pas encore l'échéance : la ligne ne s'affiche pas du tout
      if (!faitAujourdhui && depuis !== null && depuis < n) return []
      const h = r.heures?.[0] ?? ''
      return [{
        cle: `${r.id}-${h}`, routine: r, heure: h, tousLes: n, depuis,
        retard: faitAujourdhui || depuis === null ? 0 : depuis - n,
        event: faitAujourdhui ? (duJour.find(e => e.data?.traitementId === r.id) ?? null) : null,
      }]
    })
    return lignes.sort((a, b) => (a.heure || '99:99').localeCompare(b.heure || '99:99'))
  }, [selectedBaby, events])

  /**
   * Une ligne quitte « À faire aujourd'hui » dès qu'elle est faite — et seulement
   * une fois l'événement réellement enregistré : `l.event` vient de l'écoute
   * Firestore, jamais d'un état local posé au moment du clic. Rien ne disparaît
   * donc sur une écriture qui échouerait.
   */
  const prisesAFaire = prisesDuJour.filter(l => !l.event)
  const prisesFaites = prisesDuJour.filter(l => l.event)

  /** Cocher une ligne écrit un VRAI événement du type de la routine (médicament, bain, soin) */
  const noterPrise = async (ligne: { routine: BebeRoutine; heure: string }) => {
    if (!currentUser) return
    const r = ligne.routine
    const type = r.type ?? 'meds'
    // Une température ne se coche pas : on ouvre la saisie, l'événement créé
    // sera rattaché à la routine par `routineEnCours`.
    if (type === 'temp') {
      setRoutineEnCours({ id: r.id, prise: ligne.heure })
      openNewModal('temp')
      return
    }
    await addEvent({
      type,
      data: {
        // Le bain n'a pas d'intitulé propre : son type suffit à le nommer
        ...(type === 'bath' ? {} : { name: r.nom }),
        ...(type === 'meds' && r.quantite != null ? { quantite: r.quantite } : {}),
        ...(type === 'meds' && r.unite ? { unite: r.unite } : {}),
        traitementId: r.id,
        ...(ligne.heure ? { prise: ligne.heure } : {}),
      },
      timestamp: Timestamp.now(),
      createdBy: currentUser.uid,
    })
  }

  /**
   * Liste proposée partout où l'on saisit un médicament : les suggestions
   * intégrées + celles ajoutées par les parents (`Bebe.medicaments`). Un
   * médicament saisi à la main rejoint la liste à l'enregistrement, il n'y a
   * donc rien à « créer » explicitement.
   */
  const medsConnus = useMemo(() => {
    const perso = (selectedBaby?.medicaments ?? []).map(m => ({
      nom: m.nom,
      quantite: m.quantite != null ? String(m.quantite).replace('.', ',') : '',
      unite: m.unite ?? '',
      perso: true,
    }))
    const vus = new Set(perso.map(m => cleMed(m.nom, m.quantite, m.unite)))
    const integres = MEDS_SUGGESTIONS
      .filter(m => !vus.has(cleMed(m.nom, m.quantite, m.unite)))
      .map(m => ({ ...m, perso: false }))
    return [...perso, ...integres]
  }, [selectedBaby])

  /** Ajoute le médicament saisi à la liste du bébé s'il n'y figure pas déjà */
  const memoriserMedicament = async (nom: string, quantite: string, unite: string) => {
    if (!selectedBabyId || !nom.trim()) return
    if (medsConnus.some(m => cleMed(m.nom, m.quantite, m.unite) === cleMed(nom, quantite, unite))) return
    const q = Number(quantite.replace(',', '.'))
    const entree: BebeMedicament = {
      nom: nom.trim(),
      ...(Number.isFinite(q) && quantite.trim() ? { quantite: q } : {}),
      ...(unite.trim() ? { unite: unite.trim() } : {}),
    }
    await updateBebe(selectedBabyId, { medicaments: [...(selectedBaby?.medicaments ?? []), entree] })
  }

  const oublierMedicament = async (nom: string, quantite: string, unite: string) => {
    if (!selectedBabyId) return
    await updateBebe(selectedBabyId, {
      medicaments: (selectedBaby?.medicaments ?? []).filter(
        m => cleMed(m.nom, m.quantite != null ? String(m.quantite) : '', m.unite ?? '') !== cleMed(nom, quantite, unite),
      ),
    })
  }

  const filteredMeds = medsConnus.filter(m => !medsSearch.trim() || m.nom.toLowerCase().includes(medsSearch.toLowerCase()))

  // ─── Rendu ────────────────────────────────────────────────────────────────

  if (loadingBabies) {
    return (
      <StoreGate appRoute="/bebe" bypass={gateBypass}>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </StoreGate>
    )
  }

  // ── Écran de création (premier bébé) ──────────────────────────────────────
  if (babies.length === 0) {
    return (
      <StoreGate appRoute="/bebe" bypass={gateBypass}>
        <div className="max-w-sm mx-auto pt-8 px-2">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Baby size={32} className="text-sky-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-800">Suivi Bébé</h1>
            <p className="text-sm text-gray-500 mt-1">Commencez par ajouter votre bébé</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <PhotoPicker
              preview={addPhotoPreview}
              onPick={(file) => { setAddPhotoFile(file); setAddPhotoPreview(URL.createObjectURL(file)) }}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
              <input type="text" placeholder="Emma, Léo…" value={addBabyForm.name}
                onChange={e => setAddBabyForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de naissance</label>
              <input type="date" value={addBabyForm.birthDate}
                onChange={e => setAddBabyForm(f => ({ ...f, birthDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={handleAddBebe} disabled={savingAdd || !addBabyForm.name.trim() || !addBabyForm.birthDate}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
              {savingAdd ? 'Création…' : 'Créer le profil'}
            </button>
          </div>
        </div>
      </StoreGate>
    )
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <StoreGate appRoute="/bebe" bypass={gateBypass}>
      <div className="space-y-5">

        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-sky-100 flex items-center justify-center shrink-0 border border-gray-100">
              {selectedBaby?.photoUrl
                ? <img src={selectedBaby.photoUrl} alt={selectedBaby.name} className="w-full h-full object-cover" />
                : <Baby size={24} className="text-sky-600" />
              }
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-800">{selectedBaby?.name}</h1>
                {babies.length > 1 && (
                  <button onClick={() => selectedBabyId && markAsPrimary(selectedBabyId)}
                    title={selectedBabyId === primaryId ? 'Bébé principal' : 'Définir comme principal'}>
                    <Star size={14} className={selectedBabyId === primaryId ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-yellow-400 transition'} />
                  </button>
                )}
              </div>
              {selectedBaby?.birthDate && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {getBabyAge(selectedBaby.birthDate)} · né le {selectedBaby.birthDate.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {babies.length > 1 && (
              <select value={selectedBabyId ?? ''} onChange={e => setSelectedBabyId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {babies.map(b => <option key={b.id} value={b.id}>{b.id === primaryId ? '★ ' : ''}{b.name}</option>)}
              </select>
            )}
            <button onClick={() => setShowShareModal(true)} title="Partager avec l'autre parent"
              className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition relative">
              <Users size={16} />
              {(selectedBaby?.members?.length ?? 0) > 1 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />
              )}
            </button>
            <button onClick={openEditBaby} title="Modifier" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
              <Pencil size={16} />
            </button>
            <button onClick={() => { setAddBabyForm({ name: '', birthDate: '' }); setAddPhotoFile(null); setAddPhotoPreview(''); setShowAddBabyModal(true) }} title="Ajouter un bébé"
              className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
              <Plus size={16} />
            </button>
            {/* Suppression réservée au parent principal : un co-parent invité passe par
                « Quitter le partage » (sinon il effacerait les données de tout le monde). */}
            {isBabyCreator && (
              <button onClick={() => setShowDeleteBabyConfirm(true)} title="Supprimer ce bébé"
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Onglets vue — 5 entrées.
            Sur mobile, une rangée horizontale débordait sur deux lignes, avec une
            seconde ligne à moitié vide : on passe en 5 colonnes égales, icône
            au-dessus du libellé, comme la barre du bas. Sur écran large, la
            pastille horizontale d'origine. */}
        <div className="grid grid-cols-5 gap-1 bg-gray-100 p-1 rounded-xl sm:flex sm:w-fit">
          {([
            // `court` : « Aujourd'hui » ne tient pas dans une colonne sur cinq
            // des petits écrans — il serait tronqué en « Aujourd'h… ».
            { key: 'dashboard', icon: LayoutList,   label: "Aujourd'hui", court: 'Jour' },
            { key: 'planning',  icon: CalendarDays, label: 'Planning' },
            { key: 'stats',     icon: BarChart3,    label: 'Stats' },
            { key: 'growth',    icon: HeartPulse,   label: 'Santé' },
            { key: 'arrival',   icon: Gift,         label: 'Arrivée' },
          ] as const).map(v => {
            const Icon = v.icon
            const court = 'court' in v ? v.court : v.label
            return (
              <button key={v.key} onClick={() => setViewMode(v.key)}
                className={`flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg text-[11px] leading-none font-medium transition sm:flex-row sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-sm ${viewMode === v.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                <Icon size={16} className="shrink-0 sm:w-[15px] sm:h-[15px]" />
                <span className="sm:hidden">{court}</span>
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            )
          })}
        </div>

        {/* ═══ VUE AUJOURD'HUI ═══ */}
        {viewMode === 'dashboard' && (
          <>
            {/* Sommeil actif */}
            {selectedBaby?.activeSleep && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                      <Moon size={18} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-indigo-800">{selectedBaby.name} dort</p>
                      <p className="text-xs text-indigo-600">
                        Depuis {formatTime(selectedBaby.activeSleep.startTime)}
                        {sleepElapsedMin > 0 && ` · ${formatDuration(sleepElapsedMin)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => updateBebe(selectedBabyId!, { activeSleep: null })}
                      className="text-xs text-indigo-400 hover:text-indigo-600 px-2 py-1 transition">
                      Annuler
                    </button>
                    <button onClick={handleWakeUp}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition">
                      Réveillé !
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Prochain endormissement estimé — indication, jamais une consigne */}
            {sleepPrediction && (() => {
              const { dansMin, prevuA, fenetre, dernierReveil } = sleepPrediction
              const depasse = dansMin < 0
              const proche  = !depasse && dansMin < 20
              const msg = depasse ? `Fenêtre dépassée de ${formatDuration(-dansMin)}`
                : dansMin < 5 ? 'Maintenant' : `Dans ${formatDuration(dansMin)}`
              return (
                <div className={`rounded-2xl border p-4 ${depasse ? 'bg-violet-50 border-violet-200' : proche ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                      <Moon size={18} className="text-indigo-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-indigo-800">
                        Prochain dodo — {msg}
                      </p>
                      <p className="text-xs text-gray-500">
                        vers {prevuA.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}éveillé depuis {formatTime(Timestamp.fromDate(dernierReveil))}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fenetre.source === 'mixte'
                          ? `Fenêtre d'éveil ${formatDuration(fenetre.minutes)}, d'après ses ${fenetre.nbMesures} derniers réveils (repère de son âge : ${formatDuration(fenetre.minutesAge)})`
                          : `Fenêtre d'éveil ${formatDuration(fenetre.minutes)}, repère de son âge — pas encore assez de sommeils notés pour se caler sur lui`}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Prochain biberon */}
            {bottlePrediction && (() => {
              const { diffMin, predictedAt, avgIntervalMin, lastBottle } = bottlePrediction
              const ov = diffMin < 0, sn = !ov && diffMin < 30
              const card  = ov ? 'bg-red-50 border-red-200' : sn ? 'bg-orange-50 border-orange-200' : 'bg-sky-50 border-sky-200'
              const tc    = ov ? 'text-red-700' : sn ? 'text-orange-700' : 'text-sky-700'
              const ic    = ov ? 'bg-red-100' : sn ? 'bg-orange-100' : 'bg-sky-100'
              const itc   = ov ? 'text-red-500' : sn ? 'text-orange-500' : 'text-sky-500'
              const msg   = ov ? `En retard de ${formatDuration(-diffMin)}` : diffMin < 5 ? 'Maintenant !' : `Dans ${formatDuration(diffMin)}`
              return (
                <div className={`rounded-2xl border p-4 ${card}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${ic}`}>
                      <Milk size={18} className={itc} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${tc}`}>Prochain repas — {msg}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Vers {predictedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}Moy. {formatDuration(avgIntervalMin)}
                        {' · '}Dernier {formatTime(lastBottle.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Dernière température du jour hors plage habituelle — signalée tout de suite */}
            {(() => {
              const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0)
              const derniere = events
                .filter(e => e.type === 'temp' && (e.timestamp?.toDate?.() ?? debutJour) >= debutJour)
                .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))[0]
              const val = Number(derniere?.data?.tempC)
              if (!derniere || !Number.isFinite(val)) return null
              const z = zoneTemperature(val)
              if (!z.alerte) return null
              return (
                <div className={`rounded-2xl border p-4 ${z.bg}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${z.pastille}`}>
                      <Thermometer size={18} className={z.icone} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${z.texte}`}>
                        {`${z.titre} — ${val.toFixed(1).replace('.', ',')} °C à ${formatTime(derniere.timestamp)}`}
                      </p>
                      <p className={`text-xs mt-0.5 ${z.sousTexte}`}>{z.message}</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Repère de saisie, jamais un avis médical.
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Routines du jour — une coche = c'est noté dans l'historique */}
            {prisesDuJour.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-rose-500" />
                    <p className="text-sm font-semibold text-gray-800">À faire aujourd&apos;hui</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400">
                      {`${prisesDuJour.filter(l => l.event).length}/${prisesDuJour.length}`}
                    </span>
                    <button onClick={() => setViewMode('growth')}
                      className="text-xs font-medium text-rose-600 hover:text-rose-700 transition">
                      Gérer
                    </button>
                  </div>
                </div>
                {prisesAFaire.length === 0 && !voirFaits && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <Check size={14} className="text-emerald-600" />
                    </div>
                    <p className="text-sm text-gray-500">Tout est fait pour aujourd&apos;hui.</p>
                  </div>
                )}
                <div className="space-y-2">
                  {(voirFaits ? [...prisesAFaire, ...prisesFaites] : prisesAFaire).map(l => {
                    const fait = !!l.event
                    const Icone = EVENT_ICONS[l.routine.type ?? 'meds']
                    const coul  = EVENT_COLORS[l.routine.type ?? 'meds']
                    const dose  = formatDose(l.routine.quantite, l.routine.unite)
                    const sousTitre = fait
                      ? `fait à ${formatTime(l.event!.timestamp)}`
                      : l.tousLes > 1
                        ? [
                            libelleRecurrence(l.routine),
                            l.depuis === null ? 'jamais fait' : `dernier il y a ${l.depuis} j`,
                          ].join(' · ')
                        : (l.heure ? `vers ${l.heure}` : 'dans la journée')
                    const enConfirmation = confirmPrise === l.cle
                    // Une température se valide déjà dans sa fenêtre de saisie : pas de
                    // confirmation en plus pour la cocher. Décocher efface, donc toujours.
                    const aConfirmer = fait || (l.routine.type ?? 'meds') !== 'temp'
                    const demander = () => (aConfirmer ? setConfirmPrise(l.cle) : noterPrise(l))
                    const confirmer = async () => {
                      setConfirmPrise(null)
                      if (fait) await deleteEvent(l.event!.id)
                      else await noterPrise(l)
                    }
                    return (
                      <div key={l.cle} className="flex items-center gap-3">
                        <button
                          onClick={() => (enConfirmation ? setConfirmPrise(null) : demander())}
                          title={fait ? 'Annuler' : 'Noter comme fait'}
                          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition ${
                            fait ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}>
                          <Check size={14} />
                        </button>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${fait ? 'bg-gray-100' : coul.bg}`}>
                          <Icone size={15} className={fait ? 'text-gray-400' : coul.text} />
                        </div>
                        {enConfirmation ? (
                          // Confirmation EN LIGNE, sur la ligne concernée : pas de fenêtre
                          // par-dessus l'accueil pour un geste aussi courant.
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <p className="flex-1 min-w-0 text-xs text-gray-600 truncate">
                              {fait ? `Annuler « ${l.routine.nom} » ?` : `Noter « ${l.routine.nom} » ?`}
                            </p>
                            <button onClick={() => setConfirmPrise(null)}
                              className="shrink-0 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition">
                              Non
                            </button>
                            <button onClick={confirmer}
                              className={`shrink-0 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition ${
                                fait ? 'bg-gray-500 hover:bg-gray-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                              {fait ? 'Oui, annuler' : 'Oui, fait'}
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm truncate ${fait ? 'text-gray-400 line-through' : 'font-medium text-gray-800'}`}>
                                {[l.routine.nom, dose].filter(Boolean).join(' · ')}
                              </p>
                              <p className={`text-xs ${!fait && l.retard > 0 ? 'text-orange-500 font-medium' : 'text-gray-400'}`}>
                                {!fait && l.retard > 0
                                  ? `en retard de ${l.retard} j · ${sousTitre}`
                                  : sousTitre}
                              </p>
                              {/* La note dit COMMENT faire : elle a sa place au moment de le faire */}
                              {!fait && l.routine.note && (
                                <p className="text-xs text-gray-500 italic truncate">{l.routine.note}</p>
                              )}
                            </div>
                            {!fait && (
                              <button onClick={demander}
                                className="shrink-0 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1.5 rounded-lg transition">
                                Fait
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
                {prisesFaites.length > 0 && (
                  <button onClick={() => setVoirFaits(v => !v)}
                    className="text-xs font-medium text-gray-400 hover:text-gray-600 transition mt-2">
                    {voirFaits
                      ? 'Masquer ce qui est fait'
                      : `Voir ce qui est fait (${prisesFaites.length})`}
                  </button>
                )}
              </div>
            )}

            {/* Stats */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={Milk} label="Repas" value={String(todayStats.bottleCount)}
                  sub={[
                    todayStats.bottleMl > 0 ? `${todayStats.bottleMl} ml` : null,
                    todayStats.teteeMin > 0 ? formatDuration(todayStats.teteeMin) : null,
                  ].filter(Boolean).join(' · ') || undefined}
                  bg="bg-sky-100" tc="text-sky-600" />
                <StatCard icon={DiaperIcon} label="Couches" value={String(todayStats.diaperCount)} bg="bg-teal-100" tc="text-teal-600" />
                <StatCard icon={Moon} label="Sommeil"
                  value={todayStats.sleepMin > 0 ? formatDuration(todayStats.sleepMin) : '—'}
                  sub={todayStats.sleepMin > 0
                    ? `${formatDuration(todayStats.siesteMin)} sieste · ${formatDuration(todayStats.nuitMin)} nuit`
                    : undefined}
                  bg="bg-indigo-100" tc="text-indigo-600" />
              </div>
            </div>

            {/* Réserve de lait maternel — n'apparaît que si le foyer tire/donne du lait maternel */}
            {stockLait.actif && (
              <div className="rounded-2xl border border-pink-200 bg-pink-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-pink-100">
                    <Droplet size={18} className="text-pink-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pink-700">Réserve de lait maternel</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Tiré {stockLait.tire} ml · Bu {stockLait.bu} ml · Jeté {stockLait.jete} ml
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-2xl font-bold leading-none ${stockLait.restant < 0 ? 'text-orange-600' : 'text-pink-700'}`}>
                      {stockLait.restant}
                    </p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">ml restant</p>
                  </div>
                </div>
                {stockLait.restant < 0 && (
                  <p className="text-xs text-orange-600 mt-2">
                    Réserve négative : des tirages n&apos;ont pas été notés, ou des biberons de lait maternel ont été comptés en trop.
                  </p>
                )}
              </div>
            )}

            {/* 4 boutons rapides + Start sommeil */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ajouter</p>
              <div className="grid grid-cols-3 gap-2">
                {(['bottle', 'pump', 'waste', 'diaper', 'sleep', 'bath', 'soin', 'temp', 'meds', 'growth', 'vaccine'] as BebeEventType[]).map(type => {
                  const Icon = EVENT_ICONS[type]
                  const c    = EVENT_COLORS[type]
                  return (
                    <button key={type} onClick={() => openNewModal(type)}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-col items-center gap-2 hover:shadow-md hover:border-blue-200 transition active:scale-95">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg}`}>
                        <Icon size={18} className={c.text} />
                      </div>
                      <span className="text-[11px] font-medium text-gray-600 text-center leading-tight">{EVENT_LABELS[type]}</span>
                    </button>
                  )
                })}
              </div>
              {!selectedBaby?.activeSleep && (
                <button onClick={handleStartSleep}
                  className="mt-2 w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-2xl py-2.5 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-600 transition">
                  <Moon size={16} />
                  Commencer le sommeil maintenant
                </button>
              )}
            </div>

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Timeline · {todayEvents.length} événement{todayEvents.length !== 1 ? 's' : ''}
              </p>
              {todayEvents.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                  <Milk size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Aucun événement aujourd'hui</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayEvents.map(event => {
                    const Icon = EVENT_ICONS[event.type]
                    const c    = EVENT_COLORS[event.type]
                    return (
                      <div key={event.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
                          <Icon size={16} className={c.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">
                            {EVENT_LABELS[event.type]}
                            {' '}<span className="font-normal text-gray-500">{eventDescription(event.type, event.data ?? {}, journee)}</span>
                          </p>
                          <p className="text-xs text-gray-400">{formatTime(event.timestamp)} · {timeAgo(event.timestamp)}</p>
                          {event.data?.note && (
                            <p className="text-xs text-gray-500 italic mt-0.5 break-words">{event.data.note}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openEditModal(event)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteConfirm(event.id)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ VUE PLANNING ═══ */}
        {viewMode === 'planning' && (
          <>
            {/* Sélecteur plage — libellés courts sur mobile, sinon les 3 boutons débordent */}
            <div>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
                {([
                  { k: '7j',   court: '7 j',  l: '7 derniers jours' },
                  { k: '30j',  court: '30 j', l: '30 derniers jours' },
                  { k: 'tout', court: 'Tout', l: 'Planning complet' },
                ] as const).map(r => (
                  <button key={r.k} onClick={() => setPlanningRange(r.k)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${planningRange === r.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    <span className="sm:hidden">{r.court}</span>
                    <span className="hidden sm:inline">{r.l}</span>
                  </button>
                ))}
              </div>
              {planningRange === 'tout' && plafondAtteint && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Historique très fourni : seuls les {EVENTS_LIMIT_ALL.toLocaleString('fr-FR')} événements les plus récents sont affichés.
                </p>
              )}
            </div>

            {/* Recherche et filtres */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-2.5">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  type="text"
                  value={planningSearch}
                  onChange={e => setPlanningSearch(e.target.value)}
                  placeholder="Rechercher (doliprane, caca, régurgité…)"
                  className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {planningSearch && (
                  <button onClick={() => setPlanningSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-gray-500 transition">
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(['bottle', 'diaper', 'sleep', 'meds', 'bath', 'soin', 'temp', 'growth', 'vaccine', 'pump', 'waste'] as BebeEventType[]).map(t => {
                  const Icone = EVENT_ICONS[t]
                  const c = EVENT_COLORS[t]
                  const actif = planningTypes.includes(t)
                  return (
                    <button key={t}
                      onClick={() => setPlanningTypes(l => (actif ? l.filter(x => x !== t) : [...l, t]))}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                        actif ? `${c.bg} ${c.text} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      <Icone size={13} />
                      {EVENT_LABELS[t]}
                    </button>
                  )
                })}
              </div>
              {planningFiltreActif && (
                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <p className="text-xs text-gray-400">
                    {planningNbTrouves === 0
                      ? 'Aucun événement trouvé'
                      : `${planningNbTrouves} événement${planningNbTrouves > 1 ? 's' : ''} sur ${planningDaysFiltres.length} jour${planningDaysFiltres.length > 1 ? 's' : ''}`}
                  </p>
                  <button onClick={() => { setPlanningTypes([]); setPlanningSearch('') }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition shrink-0">
                    Tout afficher
                  </button>
                </div>
              )}
            </div>

            {/* Moyennes de la période affichée — la dose de lait par jour d'abord */}
            {planningDays.length > 0 && (() => {
              const jours = planningDays.length
              const somme = (f: (e: BebeEvent) => number) =>
                planningDays.reduce((n, d) => n + d.events.reduce((m, e) => m + f(e), 0), 0)
              const ml     = somme(e => (e.type === 'bottle' ? ((e.data?.amount as number) ?? 0) : 0))
              const repas  = somme(e => (e.type === 'bottle' ? 1 : 0))
              const dodo   = somme(e => (e.type === 'sleep' ? ((e.data?.durationMin as number) ?? 0) : 0))
              const tire   = somme(e => (e.type === 'pump' ? ((e.data?.amount as number) ?? 0) : 0))
              const moy = (v: number) => Math.round(v / jours)
              return (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Moyennes par jour
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center shrink-0">
                        <Milk size={14} className="text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{`${moy(ml)} ml`}</p>
                        <p className="text-[11px] text-gray-400">de lait</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center shrink-0">
                        <Milk size={14} className="text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{`${(repas / jours).toFixed(1).replace('.', ',')}`}</p>
                        <p className="text-[11px] text-gray-400">repas</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                        <Moon size={14} className="text-indigo-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{formatDuration(moy(dodo))}</p>
                        <p className="text-[11px] text-gray-400">de sommeil</p>
                      </div>
                    </div>
                    {/* Le tirage n'apparaît que si le foyer en fait, comme la réserve de lait */}
                    {tire > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center shrink-0">
                          <Droplet size={14} className="text-pink-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{`${moy(tire)} ml`}</p>
                          <p className="text-[11px] text-gray-400">tirés</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {`Sur ${jours} jour${jours > 1 ? 's' : ''} où quelque chose a été noté — les jours vides ne comptent pas.`}
                    {planningFiltreActif ? ' Moyennes calculées sur toute la période, sans tenir compte du filtre.' : ''}
                  </p>
                </div>
              )
            })()}

            {planningDaysFiltres.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <CalendarDays size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">
                  {planningFiltreActif ? 'Aucun événement ne correspond' : 'Aucune donnée sur cette période'}
                </p>
                {planningFiltreActif && (
                  <button onClick={() => { setPlanningTypes([]); setPlanningSearch('') }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition mt-2">
                    Tout afficher
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {planningDaysFiltres.map(({ label: dl, events: dayEvts }) => {
                  const bottles = dayEvts.filter(e => e.type === 'bottle')
                  const diapers = dayEvts.filter(e => e.type === 'diaper')
                  const sleeps  = dayEvts.filter(e => e.type === 'sleep')
                  const meds    = dayEvts.filter(e => e.type === 'meds')
                  const pumps   = dayEvts.filter(e => e.type === 'pump')
                  const totalMl  = bottles.reduce((n, e) => n + ((e.data?.amount as number) ?? 0), 0)
                  const tireMl   = pumps.reduce((n, e) => n + ((e.data?.amount as number) ?? 0), 0)
                  const sleepMin = sleeps.reduce((n, e) => n + ((e.data?.durationMin as number) ?? 0), 0)
                  const sleepSiesteMin = sleeps
                    .filter(e => { const d = dateRattachement(e); return d && !estNuit(d, journee) })
                    .reduce((n, e) => n + ((e.data?.durationMin as number) ?? 0), 0)
                  return (
                    <div key={dl} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-700 capitalize">{dl}</p>
                        <p className="text-xs text-gray-400">{dayEvts.length} événement{dayEvts.length !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {bottles.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center shrink-0">
                              <Milk size={14} className="text-sky-600" />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Biberons</p>
                              <p className="text-sm font-semibold text-gray-800">{bottles.length} · {totalMl} ml</p>
                            </div>
                          </div>
                        )}
                        {diapers.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center shrink-0">
                              <DiaperIcon size={14} className="text-teal-600" />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Couches</p>
                              <p className="text-sm font-semibold text-gray-800">{diapers.length}</p>
                            </div>
                          </div>
                        )}
                        {sleeps.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                              <Moon size={14} className="text-indigo-600" />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Sommeil</p>
                              <p className="text-sm font-semibold text-gray-800">{formatDuration(sleepMin)}</p>
                              <p className="text-[11px] text-gray-400">
                                {formatDuration(sleepSiesteMin)} sieste · {formatDuration(sleepMin - sleepSiesteMin)} nuit
                              </p>
                            </div>
                          </div>
                        )}
                        {pumps.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center shrink-0">
                              <Droplet size={14} className="text-pink-600" />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Tirages</p>
                              <p className="text-sm font-semibold text-gray-800">{`${pumps.length} · ${tireMl} ml`}</p>
                            </div>
                          </div>
                        )}
                        {meds.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center shrink-0">
                              <Pill size={14} className="text-rose-600" />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Médicaments</p>
                              <p className="text-sm font-semibold text-gray-800 truncate max-w-[100px]">
                                {[...new Set(meds.map(e => e.data?.name).filter(Boolean))].join(', ') || String(meds.length)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Timeline du jour (détail) */}
                      <div className="px-4 pb-3 space-y-1.5 border-t border-gray-50 pt-2">
                        {dayEvts.map(event => {
                          const Icon = EVENT_ICONS[event.type]
                          const c    = EVENT_COLORS[event.type]
                          return (
                            <div key={event.id} className="flex items-center gap-2.5">
                              <span className="text-xs text-gray-400 w-10 shrink-0">{formatTime(event.timestamp)}</span>
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${c.bg}`}>
                                <Icon size={12} className={c.text} />
                              </div>
                              <span className="text-xs text-gray-600 flex-1 min-w-0 truncate">
                                {EVENT_LABELS[event.type]} · {eventDescription(event.type, event.data ?? {}, journee)}
                              </span>
                              <div className="flex gap-1 shrink-0">
                                <button onClick={() => openEditModal(event)} className="p-1 text-gray-300 hover:text-blue-500 transition"><Pencil size={12} /></button>
                                <button onClick={() => setDeleteConfirm(event.id)} className="p-1 text-gray-300 hover:text-red-500 transition"><Trash2 size={12} /></button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ VUE STATS ═══ */}
        {viewMode === 'stats' && (
          <>
            <div>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
                {([{ k: '7j', l: '7 jours' }, { k: '30j', l: '30 jours' }, { k: 'tout', l: 'Tout' }] as const).map(r => (
                  <button key={r.k} onClick={() => setStatsRange(r.k)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${statsRange === r.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {r.l}
                  </button>
                ))}
              </div>
              {statsRange === 'tout' && plafondAtteint && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Calculé sur les {EVENTS_LIMIT_ALL.toLocaleString('fr-FR')} événements les plus récents.
                </p>
              )}
            </div>

            {stats.repas + stats.couches + stats.sommeilMin === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <BarChart3 size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Aucune donnée sur cette période.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  Moyennes calculées sur les <strong>{stats.jours} jour{stats.jours > 1 ? 's' : ''}</strong> où
                  quelque chose a été noté — pas sur la période entière, sinon les jours sans saisie
                  tireraient les moyennes vers le bas.
                </p>

                {/* Courbes du jour le jour — l'écart entre deux jours saute aux
                    yeux là où une moyenne le lisse. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Repas par jour</p>
                    <BarChart
                      points={stats.serie.map(j => ({ label: labelJourCourt(j.date), valeurs: [j.repas] }))}
                      couleurs={[COURBE_REPAS]}
                    />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Couches par jour</p>
                    <BarChart
                      points={stats.serie.map(j => ({ label: labelJourCourt(j.date), valeurs: [j.couches] }))}
                      couleurs={[COURBE_COUCHES]}
                    />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Sommeil par jour</p>
                    <BarChart
                      points={stats.serie.map(j => ({ label: labelJourCourt(j.date), valeurs: [j.nuit, j.sieste] }))}
                      couleurs={[COURBE_NUIT, COURBE_SIESTE]}
                      format={v => formatDuration(Math.round(v))}
                      legendes={['Nuit', 'Siestes']}
                    />
                  </div>
                  {stats.biberonMl > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <p className="text-xs font-semibold text-gray-500 mb-1">Lait au biberon par jour (ml)</p>
                      <BarChart
                        points={stats.serie.map(j => ({ label: labelJourCourt(j.date), valeurs: [j.ml] }))}
                        couleurs={[COURBE_LAIT]}
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <StatBloc icon={Milk} bg="bg-sky-100" tc="text-sky-600" titre="Repas"
                    lignes={[
                      { l: 'Total', v: String(stats.repas) },
                      { l: 'Par jour', v: (stats.repas / stats.jours).toFixed(1).replace('.', ',') },
                      ...(stats.biberonMl > 0 ? [
                        { l: 'Lait au biberon', v: `${stats.biberonMl} ml` },
                        { l: 'Par jour', v: `${Math.round(stats.biberonMl / stats.jours)} ml` },
                      ] : []),
                      ...(stats.teteeCount > 0 ? [
                        { l: 'Tétées', v: `${stats.teteeCount} · ${formatDuration(stats.teteeMin)}` },
                        { l: 'Durée moyenne', v: formatDuration(Math.round(stats.teteeMin / stats.teteeCount)) },
                      ] : []),
                    ]} />

                  <StatBloc icon={DiaperIcon} bg="bg-teal-100" tc="text-teal-600" titre="Couches"
                    lignes={[
                      { l: 'Total', v: String(stats.couches) },
                      { l: 'Par jour', v: (stats.couches / stats.jours).toFixed(1).replace('.', ',') },
                      ...stats.couchesParType.filter(t => t.n > 0).map(t => ({ l: t.l, v: String(t.n) })),
                    ]} />

                  <StatBloc icon={Moon} bg="bg-indigo-100" tc="text-indigo-600" titre="Sommeil"
                    lignes={[
                      { l: 'Total', v: formatDuration(stats.sommeilMin) },
                      { l: 'Par jour', v: formatDuration(Math.round(stats.sommeilMin / stats.jours)) },
                      { l: 'Dont nuit', v: formatDuration(stats.nuitMin) },
                      { l: 'Dont siestes', v: `${stats.siesteCount} · ${formatDuration(stats.siesteMin)}` },
                      ...(stats.siesteCount > 0 ? [{ l: 'Sieste moyenne', v: formatDuration(Math.round(stats.siesteMin / stats.siesteCount)) }] : []),
                    ]} />

                  <StatBloc icon={HeartPulse} bg="bg-rose-100" tc="text-rose-600" titre="Soins et divers"
                    lignes={[
                      { l: 'Bains', v: String(stats.bains) },
                      { l: 'Médicaments', v: String(stats.meds) },
                      { l: 'Températures', v: stats.temps > 0
                          ? [
                              String(stats.temps),
                              stats.fievres > 0 ? `${stats.fievres} au-dessus de ${SEUIL_FIEVRE} °C` : null,
                              stats.tempsBasses > 0 ? `${stats.tempsBasses} sous ${TEMP_NORMALE.min} °C` : null,
                            ].filter(Boolean).join(' · ')
                          : '0' },
                      ...(stats.tirages > 0 ? [
                        { l: 'Tirages', v: String(stats.tirages) },
                        { l: 'Lait tiré', v: `${stats.tirageMl} ml` },
                      ] : []),
                      ...(stockLait.actif ? [
                        { l: 'Réserve de lait (actuelle)', v: `${stockLait.restant} ml` },
                      ] : []),
                    ]} />
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ VUE CROISSANCE ═══ */}
        {viewMode === 'growth' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Croissance · {mesures.length} mesure{mesures.length !== 1 ? 's' : ''}
              </p>
              <button onClick={() => openNewModal('growth')}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-2 rounded-xl transition">
                <Plus size={14} />Ajouter une mesure
              </button>
            </div>

            {mesures.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <TrendingUp size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Aucune mesure enregistrée.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Renseignez le poids et la taille de naissance dans l&apos;onglet Arrivée : ils
                  serviront de premier point.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Poids (kg)</p>
                    <GrowthChart points={pointsPoids} unite="kg" couleur={COURBE_POIDS} decimales={3} />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Taille (cm)</p>
                    <GrowthChart points={pointsTaille} unite="cm" couleur={COURBE_TAILLE} decimales={0} />
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Périmètre crânien (cm)</p>
                    <GrowthChart points={pointsPC} unite="cm" couleur={COURBE_PC} decimales={1} />
                  </div>
                </div>

                {/* Historique — l'évolution depuis la mesure précédente est ce qui rassure */}
                <div className="space-y-2">
                  {[...mesures].reverse().map((m, i, arr) => {
                    const prec = arr[i + 1] // liste inversée → l'élément suivant est le précédent dans le temps
                    const dPoids  = m.weightG  && prec?.weightG  ? m.weightG  - prec.weightG  : null
                    const dTaille = m.heightCm && prec?.heightCm ? m.heightCm - prec.heightCm : null
                    const dPC     = m.headCm   && prec?.headCm   ? m.headCm   - prec.headCm   : null
                    const naiss = selectedBaby?.birthDate?.toDate?.()
                    const jours = naiss ? joursEntre(naiss, m.date) : 0
                    return (
                      <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${m.origine ? 'bg-gray-100' : 'bg-violet-100'}`}>
                          <TrendingUp size={16} className={m.origine ? 'text-gray-400' : 'text-violet-600'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">
                            {[
                              m.weightG ? formatKg(m.weightG) : null,
                              m.heightCm ? `${m.heightCm} cm` : null,
                              m.headCm ? `${m.headCm} cm PC` : null,
                            ].filter(Boolean).join(' · ')}
                            {(dPoids !== null || dTaille !== null || dPC !== null) && (
                              <span className="font-normal text-xs text-green-600 ml-2">
                                {[
                                  dPoids  !== null ? `${dPoids  >= 0 ? '+' : '−'}${Math.abs(dPoids)} g`   : null,
                                  dTaille !== null ? `${dTaille >= 0 ? '+' : '−'}${Math.abs(dTaille)} cm` : null,
                                  dPC     !== null ? `${dPC     >= 0 ? '+' : '−'}${Math.abs(dPC)} cm PC`  : null,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">
                            {m.origine ? 'Naissance' : m.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {!m.origine && jours > 0 && ` · J+${jours}`}
                          </p>
                        </div>
                        {m.event && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => openEditModal(m.event!)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                            <button onClick={() => setDeleteConfirm(m.event!.id)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* ── Routines (ce qui revient régulièrement) ──────────────────── */}
            <div className="pt-2">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  À faire régulièrement · {(selectedBaby?.traitements ?? []).length}
                </p>
                <button onClick={() => openTraitModal()}
                  className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 transition">
                  <Plus size={14} />Ajouter
                </button>
              </div>
              {(selectedBaby?.traitements ?? []).length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
                  <Check size={26} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Rien de régulier pour l&apos;instant.</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Vitamine D chaque jour, bain un jour sur deux, soin de la peau… Tout ce qui revient
                    s&apos;affiche sur l&apos;accueil, à cocher une fois fait.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(selectedBaby?.traitements ?? []).map(t => {
                    const fin = t.jusquAu?.toDate?.()
                    const termine = fin ? joursEntre(fin, new Date()) > 0 : false
                    const Icone = EVENT_ICONS[t.type ?? 'meds']
                    const coul  = EVENT_COLORS[t.type ?? 'meds']
                    // Prochaine échéance, comptée depuis la dernière fois où ça a été fait
                    const n = Math.max(1, t.tousLesNJours ?? 1)
                    const depuis = dernierFait(t)
                    const dans = depuis === null ? 0 : Math.max(0, n - depuis)
                    const echeance = termine || n === 1
                      ? null
                      : dans === 0 ? 'à faire aujourd\u2019hui' : dans === 1 ? 'à faire demain' : `à faire dans ${dans} jours`
                    return (
                      <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${termine ? 'bg-gray-100' : coul.bg}`}>
                          <Icone size={16} className={termine ? 'text-gray-400' : coul.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium break-words ${termine ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                            {[t.nom, formatDose(t.quantite, t.unite)].filter(Boolean).join(' · ')}
                          </p>
                          <p className="text-xs text-gray-400">
                            {[
                              libelleRecurrence(t),
                              echeance,
                              fin ? `${termine ? 'terminé le' : 'jusqu\u2019au'} ${fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                          {t.note && (
                            <p className="text-xs text-gray-500 italic mt-0.5 break-words">{t.note}</p>
                          )}
                        </div>
                        {traitDelete === t.id ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setTraitDelete(null)}
                              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Annuler</button>
                            <button onClick={() => supprimerTraitement(t.id)}
                              className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition">
                              Supprimer
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => openTraitModal(t)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                            <button onClick={() => setTraitDelete(t.id)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Vaccins ─────────────────────────────────────────────────── */}
            <div className="pt-2">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Vaccins · {vaccins.length}
                </p>
                <button onClick={() => openNewModal('vaccine')}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition">
                  <Plus size={14} />Ajouter
                </button>
              </div>
              {vaccins.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
                  <Syringe size={26} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Aucun vaccin enregistré.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {vaccins.map(v => {
                    const d = v.timestamp?.toDate?.()
                    const naiss = selectedBaby?.birthDate?.toDate?.()
                    const jours = d && naiss ? joursEntre(naiss, d) : null
                    return (
                      <div key={v.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                          <Syringe size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 break-words">{v.data?.name}</p>
                          <p className="text-xs text-gray-400">
                            {d?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {jours !== null && jours > 0 && ` · J+${jours}`}
                          </p>
                          {v.data?.note && <p className="text-xs text-gray-500 italic mt-0.5 break-words">{v.data.note}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openEditModal(v)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteConfirm(v.id)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Températures ────────────────────────────────────────────── */}
            <div className="pt-2">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Températures · {temperatures.length}
                </p>
                <button onClick={() => openNewModal('temp')}
                  className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 transition">
                  <Plus size={14} />Ajouter
                </button>
              </div>
              {temperatures.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
                  <Thermometer size={26} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Aucune température relevée.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {temperatures.slice(0, 20).map(t => {
                    const val = Number(t.data?.tempC)
                    const z = zoneTemperature(val)
                    const hors = z.alerte
                    return (
                      <div key={t.id} className={`rounded-xl border shadow-sm px-4 py-3 flex items-center gap-3 ${hors ? z.bg : 'bg-white border-gray-100'}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${hors ? z.pastille : 'bg-gray-100'}`}>
                          <Thermometer size={16} className={hors ? z.icone : 'text-gray-400'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${hors ? z.texte : 'text-gray-800'}`}>
                            {`${val.toFixed(1).replace('.', ',')} °C${z.court ? ` · ${z.court}` : ''}`}
                          </p>
                          <p className="text-xs text-gray-400">
                            {t.timestamp?.toDate?.().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à {formatTime(t.timestamp)}
                          </p>
                          {t.data?.note && <p className="text-xs text-gray-500 italic mt-0.5 break-words">{t.data.note}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openEditModal(t)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteConfirm(t.id)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )
                  })}
                  {temperatures.length > 20 && (
                    <p className="text-xs text-gray-400 text-center pt-1">
                      20 dernières affichées sur {temperatures.length}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ VUE ARRIVÉE DU BÉBÉ ═══ */}
        {viewMode === 'arrival' && selectedBaby && (
          <ArrivalSection baby={selectedBaby} updateBebe={updateBebe} />
        )}

      </div>

      {/* ── Modale Biberon ──────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'bottle'} onClose={closeModal} title={editingEvent ? 'Modifier — Repas' : 'Repas'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {BOTTLE_KINDS.map(o => (
                <button key={o.v} type="button" onClick={() => setBottleForm(f => ({ ...f, kind: o.v }))}
                  className={`px-3 py-2.5 rounded-xl text-sm border transition text-left ${bottleForm.kind === o.v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            {estSein(bottleForm.kind) && derniereTetee && (
              <p className="text-xs text-gray-500 mt-2">
                Dernière tétée : <strong>{derniereTetee.kind === 'sein_g' ? 'sein gauche' : 'sein droit'}</strong>
                {' · '}{timeAgo(derniereTetee.at)}
              </p>
            )}
          </div>

          {/* Sein → durée et côté ; biberon / tire-lait → volume */}
          {estSein(bottleForm.kind) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Durée (minutes)</label>
              <input type="number" min={0} step={1} value={bottleForm.duration}
                onChange={e => setBottleForm(f => ({ ...f, duration: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1.5 mt-2">
                {TETEE_DUREES.map(min => (
                  <button key={min} type="button" onClick={() => setBottleForm(f => ({ ...f, duration: String(min) }))}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition ${bottleForm.duration === String(min) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                    {min}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantité (ml)</label>
              <input type="number" min={0} step={5} value={bottleForm.amount}
                onChange={e => setBottleForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1.5 mt-2">
                {BOTTLE_AMOUNTS.map(ml => (
                  <button key={ml} type="button" onClick={() => setBottleForm(f => ({ ...f, amount: String(ml) }))}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition ${bottleForm.amount === String(ml) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                    {ml}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reste jeté — seulement pour un biberon de lait maternel (sort de la réserve) */}
          {bottleForm.kind === 'tire_lait' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Jeté (ml)</label>
              <input type="number" min={0} step={5} value={bottleForm.wasted}
                onChange={e => setBottleForm(f => ({ ...f, wasted: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1.5 mt-2">
                {WASTE_AMOUNTS.map(ml => (
                  <button key={ml} type="button" onClick={() => setBottleForm(f => ({ ...f, wasted: String(ml) }))}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition ${bottleForm.wasted === String(ml) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                    {ml}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Ce qui restait dans le biberon et qui part à l&apos;évier — <strong>en plus</strong> de
                la quantité bue, jamais compris dedans. Laissez vide si tout a été bu.
              </p>
              {/* Le total sorti du frigo, dit noir sur blanc : c'est là que le doute naissait */}
              {Number(bottleForm.wasted) > 0 && (
                <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 mt-2">
                  <p className="text-xs text-sky-800">
                    {`${Number(bottleForm.amount) || 0} ml bus + ${Number(bottleForm.wasted)} ml jetés = ${(Number(bottleForm.amount) || 0) + Number(bottleForm.wasted)} ml sortis de la réserve.`}
                  </p>
                </div>
              )}
            </div>
          )}

          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Couche ───────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'diaper'} onClose={closeModal} title={editingEvent ? 'Modifier — Couche' : 'Couche'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div className="grid grid-cols-2 gap-2">
            {DIAPER_KINDS.map(o => (
              <button key={o.v} type="button" onClick={() => setDiaperForm({ kind: o.v })}
                className={`px-3 py-3 rounded-xl text-sm border transition text-left ${diaperForm.kind === o.v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                {o.l}
              </button>
            ))}
          </div>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Sommeil ──────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'sleep'} onClose={closeModal} title={editingEvent ? 'Modifier — Sommeil' : 'Sommeil'}>
        <div className="space-y-4">
          {/* Démarrer un sommeil en direct (uniquement en création, si aucun en cours) */}
          {!editingEvent && !selectedBaby?.activeSleep && (
            <>
              <button
                onClick={async () => { await handleStartSleep(); closeModal() }}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition">
                <Play size={16} />
                Commencer le sommeil maintenant
              </button>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400">ou saisir manuellement</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jour</label>
            <input type="date" value={whenForm.date} onChange={e => setWhenForm(f => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Jour du COUCHER — une fin plus tôt que le début passe au lendemain.</p>
          </div>
          <div className={sleepForm.enAttente ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
              <input type="time" value={sleepForm.startTime} onChange={e => setSleepForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {!sleepForm.enAttente && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
                <input type="time" value={sleepForm.endTime} onChange={e => setSleepForm(f => ({ ...f, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
          </div>
          {/* Fin pas encore connue : le bébé dort toujours au moment de la saisie */}
          {!selectedBaby?.activeSleep && (
            <button type="button" onClick={() => setSleepForm(f => ({ ...f, enAttente: !f.enAttente }))}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition ${
                sleepForm.enAttente
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'}`}>
              <Hourglass size={15} />
              {sleepForm.enAttente ? 'Indiquer une heure de fin' : 'Fin en attente — il dort encore'}
            </button>
          )}
          {sleepForm.enAttente && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
              <p className="text-xs text-indigo-700">
                Enregistré comme sommeil en cours depuis {sleepForm.startTime || '—'}. Le réveil se note avec « Réveillé ! » sur l&apos;accueil, et la durée se calcule toute seule.
              </p>
            </div>
          )}
          {selectedBaby?.activeSleep && !editingEvent && (
            <p className="text-xs text-gray-400">
              Un sommeil est déjà en cours depuis {formatTime(selectedBaby.activeSleep.startTime)} — clôturez-le avec « Réveillé ! » pour en mettre un autre en attente.
            </p>
          )}
          {!sleepForm.enAttente && sleepForm.startTime && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Raccourcis durée</p>
              <div className="flex gap-1.5 flex-wrap">
                {[30, 60, 90, 120, 150, 180, 240].map(min => (
                  <button key={min} type="button" onClick={() => setSleepForm(f => ({ ...f, endTime: addMin(f.startTime, min) }))}
                    className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition font-mono">
                    +{min < 60 ? `${min}min` : `${min/60}h`}
                  </button>
                ))}
                <button type="button" onClick={() => setSleepForm(f => ({ ...f, endTime: nowTimeStr() }))}
                  className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition">
                  Maintenant
                </button>
              </div>
            </div>
          )}
          {!sleepForm.enAttente && sleepForm.startTime && sleepForm.endTime && (() => {
            const [sh, sm] = sleepForm.startTime.split(':').map(Number)
            const [eh, em] = sleepForm.endTime.split(':').map(Number)
            let diff = (eh * 60 + em) - (sh * 60 + sm)
            if (diff < 0) diff += 24 * 60
            return (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-center">
                <p className="text-sm font-semibold text-indigo-700">Durée : {formatDuration(diff)}</p>
              </div>
            )
          })()}
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Médicament ───────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'meds'} onClose={closeModal} title={editingEvent ? 'Modifier — Médicament' : 'Médicament'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Médicaments</label>
            <input type="text" placeholder="Rechercher…" value={medsSearch} onChange={e => setMedsSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2" />
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
              {filteredMeds.map((s, i) => (
                <div key={i}
                  className={`w-full flex items-center ${medsForm.name === s.nom && medsForm.quantite === s.quantite && medsForm.unite === s.unite ? 'bg-blue-50' : ''}`}>
                  <button type="button"
                    onClick={() => { setMedsForm({ name: s.nom, quantite: s.quantite, unite: s.unite }); setMedsSearch('') }}
                    className="flex-1 min-w-0 flex items-center justify-between px-3 py-2 text-left hover:bg-blue-50 transition">
                    <span className="text-sm text-gray-800 truncate">{s.nom}</span>
                    <span className="text-xs text-gray-400 ml-2 shrink-0">{formatDose(s.quantite, s.unite)}</span>
                  </button>
                  {/* Seules les entrées ajoutées par les parents peuvent être retirées */}
                  {s.perso && (
                    <button type="button" onClick={() => oublierMedicament(s.nom, s.quantite, s.unite)}
                      title="Retirer de la liste"
                      className="p-2 text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
              {filteredMeds.length === 0 && <p className="text-sm text-gray-400 px-3 py-2 italic">Aucun résultat</p>}
            </div>
          </div>
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">
              Saisie personnalisée <span className="font-normal text-gray-400">— ajoutée à la liste en enregistrant</span>
            </p>
            <input type="text" placeholder="Nom du médicament" value={medsForm.name} onChange={e => setMedsForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {/* Quantité et unité séparées : on ne corrige que le chiffre d'une prise à l'autre */}
            <div className="grid grid-cols-3 gap-2">
              <input type="text" inputMode="decimal" placeholder="2" value={medsForm.quantite}
                onChange={e => setMedsForm(f => ({ ...f, quantite: e.target.value.replace(/[^\d,.]/g, '') }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="text" placeholder="gouttes, ml…" value={medsForm.unite}
                onChange={e => setMedsForm(f => ({ ...f, unite: e.target.value }))}
                className="col-span-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {UNITES_MEDS.map(u => (
                <button key={u} type="button" onClick={() => setMedsForm(f => ({ ...f, unite: u }))}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition ${medsForm.unite === u ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                  {u}
                </button>
              ))}
            </div>
            {(medsForm.quantite.trim() || medsForm.unite.trim()) && (
              <p className="text-xs text-gray-400">{`Sera noté : ${formatDose(medsForm.quantite, medsForm.unite)}`}</p>
            )}
          </div>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} disabled={!medsForm.name.trim()} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Traitement régulier ──────────────────────────────────────── */}
      <Modal isOpen={showTraitModal} onClose={() => setShowTraitModal(false)}
        title={traitEditId ? 'Modifier — Routine' : 'À faire régulièrement'}>
        <div className="space-y-4">
          {/* Le type choisi décide de l'événement écrit dans l'historique quand on coche */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { k: 'meds',  l: 'Médicament', i: EVENT_ICONS.meds },
                { k: 'autre', l: 'Autre récurrence', i: EVENT_ICONS.soin },
              ] as const).map(o => {
                const Icone = o.i
                const actif = traitForm.type === o.k
                return (
                  <button key={o.k} type="button"
                    onClick={() => setTraitForm(f => ({
                      ...f, type: o.k,
                      // La dose n'a de sens que pour un médicament
                      ...(o.k === 'meds' ? {} : { quantite: '', unite: '' }),
                    }))}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition ${
                      actif ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-500 hover:border-rose-300'}`}>
                    <Icone size={16} />
                    {o.l}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Intitulé</label>
            <input type="text"
              placeholder={traitForm.type === 'meds' ? 'Vitamine D (Adrigyl)' : 'Bain, soin de la peau, température…'}
              value={traitForm.nom}
              onChange={e => setTraitForm(f => ({ ...f, nom: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {traitForm.type === 'meds' && (
              <div className="mt-2 max-h-32 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
                {medsConnus.map((m, i) => (
                  <button key={i} type="button"
                    onClick={() => setTraitForm(f => ({ ...f, nom: m.nom, quantite: m.quantite, unite: m.unite }))}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-rose-50 transition ${traitForm.nom === m.nom && traitForm.quantite === m.quantite ? 'bg-rose-50' : ''}`}>
                    <span className="text-sm text-gray-800 truncate">{m.nom}</span>
                    <span className="text-xs text-gray-400 ml-2 shrink-0">{formatDose(m.quantite, m.unite)}</span>
                  </button>
                ))}
              </div>
            )}
            {traitForm.type === 'autre' && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {RECURRENCES_SUGGESTIONS.map(x => (
                  <button key={x} type="button" onClick={() => setTraitForm(f => ({ ...f, nom: x }))}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition ${traitForm.nom === x ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600'}`}>
                    {x}
                  </button>
                ))}
              </div>
            )}
            {/* On dit ce que l'intitulé a déclenché : rien de magique en douce */}
            {traitForm.type === 'autre' && traitForm.nom.trim() && (
              <p className="text-xs text-gray-400 mt-1.5">
                {typeDepuisIntitule(traitForm.nom) === 'bath'
                  ? 'Compté comme un bain dans l\u2019historique et les statistiques.'
                  : typeDepuisIntitule(traitForm.nom) === 'temp'
                    ? 'Compté comme une prise de température : cocher la ligne ouvrira la saisie de la valeur.'
                    : 'Compté comme un soin dans l\u2019historique.'}
              </p>
            )}
          </div>
          {/* Périodicité : au-delà du quotidien, l'échéance se recale sur la dernière fois faite */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tous les combien ?</label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { n: '1', l: 'chaque jour' }, { n: '2', l: '1 jour sur 2' }, { n: '3', l: 'tous les 3 j' },
                { n: '4', l: 'tous les 4 j' }, { n: '5', l: 'tous les 5 j' }, { n: '7', l: 'chaque semaine' },
                { n: '10', l: 'tous les 10 j' }, { n: '14', l: 'toutes les 2 sem.' }, { n: '15', l: 'tous les 15 j' },
                { n: '21', l: 'toutes les 3 sem.' }, { n: '30', l: 'chaque mois' }, { n: '60', l: 'tous les 2 mois' },
                { n: '90', l: 'tous les 3 mois' },
              ].map(o => (
                <button key={o.n} type="button" onClick={() => setTraitForm(f => ({ ...f, tousLes: o.n }))}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${traitForm.tousLes === o.n ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600'}`}>
                  {o.l}
                </button>
              ))}
              <input type="text" inputMode="numeric" value={traitForm.tousLes}
                onChange={e => setTraitForm(f => ({ ...f, tousLes: e.target.value.replace(/\D/g, '') }))}
                className="w-14 px-2 py-1.5 border border-gray-300 rounded-lg text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {Number(traitForm.tousLes) > 1 && (
              <p className="text-xs text-gray-400 mt-1.5">
                L&apos;échéance se recale sur la dernière fois où ça a été fait : si le jour prévu est sauté,
                ça reste à faire le lendemain, signalé en retard.
              </p>
            )}
          </div>
          {traitForm.type === 'meds' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dose à chaque prise</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" inputMode="decimal" placeholder="2" value={traitForm.quantite}
                onChange={e => setTraitForm(f => ({ ...f, quantite: e.target.value.replace(/[^\d,.]/g, '') }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="text" placeholder="gouttes, ml…" value={traitForm.unite}
                onChange={e => setTraitForm(f => ({ ...f, unite: e.target.value }))}
                className="col-span-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-1.5 flex-wrap mt-2">
              {UNITES_MEDS.map(u => (
                <button key={u} type="button" onClick={() => setTraitForm(f => ({ ...f, unite: u }))}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition ${traitForm.unite === u ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600'}`}>
                  {u}
                </button>
              ))}
            </div>
          </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {Number(traitForm.tousLes) > 1 ? 'Heure indicative' : 'Moments de la journée'}
            </label>
            <div className="space-y-2">
              {(Number(traitForm.tousLes) > 1 ? traitForm.heures.slice(0, 1) : traitForm.heures).map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={h}
                    onChange={e => setTraitForm(f => ({ ...f, heures: f.heures.map((x, j) => (j === i ? e.target.value : x)) }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {Number(traitForm.tousLes) <= 1 && traitForm.heures.length > 1 && (
                    <button type="button" onClick={() => setTraitForm(f => ({ ...f, heures: f.heures.filter((_, j) => j !== i) }))}
                      className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            {Number(traitForm.tousLes) <= 1 && (
              <button type="button" onClick={() => setTraitForm(f => ({ ...f, heures: [...f.heures, '20:00'] }))}
                className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 transition mt-2">
                <Plus size={14} />Ajouter une prise
              </button>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {Number(traitForm.tousLes) > 1
                ? 'Simple repère dans la liste — aucune alerte n\u2019est déclenchée.'
                : 'Une ligne par prise quotidienne — l\u2019heure sert de repère, elle ne déclenche aucune alerte.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jusqu&apos;au (inclus)</label>
            <input type="date" value={traitForm.jusquAu}
              onChange={e => setTraitForm(f => ({ ...f, jusquAu: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {selectedBaby?.birthDate?.toDate && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {[6, 12, 18, 24, 36].map(mois => (
                  <button key={mois} type="button"
                    onClick={() => setTraitForm(f => ({ ...f, jusquAu: dateInputStr(dateAgeMois(selectedBaby.birthDate!.toDate(), mois)) }))}
                    className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600 transition">
                    {mois < 24 ? `ses ${mois} mois` : `ses ${mois / 12} ans`}
                  </button>
                ))}
                {traitForm.jusquAu && (
                  <button type="button" onClick={() => setTraitForm(f => ({ ...f, jusquAu: '' }))}
                    className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 transition">
                    sans fin
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <AutoTextarea value={traitForm.note} onChange={v => setTraitForm(f => ({ ...f, note: v }))} minRows={2}
              placeholder="Facultatif — dans le biberon du matin, après le bain, ordonnance du 12/08…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">
              Elle reste attachée à la routine — elle décrit comment faire, elle n&apos;est pas recopiée
              sur chaque prise notée.
            </p>
          </div>
          <ModalFooter onCancel={() => setShowTraitModal(false)} onSave={saveTraitement} saving={savingTrait}
            disabled={!traitForm.nom.trim()} label={traitEditId ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Tirage (tire-lait) ───────────────────────────────────────── */}
      <Modal isOpen={modalType === 'pump'} onClose={closeModal} title={editingEvent ? 'Modifier — Tirage' : 'Tirage'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lait recueilli (ml)</label>
            <input type="number" min={0} step={5} value={pumpForm.amount}
              onChange={e => setPumpForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-1.5 mt-2">
              {PUMP_AMOUNTS.map(ml => (
                <button key={ml} type="button" onClick={() => setPumpForm(f => ({ ...f, amount: String(ml) }))}
                  className={`flex-1 text-xs py-1.5 rounded-lg border transition ${pumpForm.amount === String(ml) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                  {ml}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Côté</label>
            <select value={pumpForm.kind} onChange={e => setPumpForm(f => ({ ...f, kind: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PUMP_KINDS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-400">
            Le tirage n&apos;est pas un repas : il n&apos;entre pas dans le compte du jour. Le lait
            recueilli s&apos;ajoute à la réserve, puis se note comme « Biberon de lait maternel »
            au moment où il est donné.
          </p>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Lait jeté ────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'waste'} onClose={closeModal} title={editingEvent ? 'Modifier — Lait jeté' : 'Lait jeté'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité jetée (ml)</label>
            <input type="number" min={0} step={5} value={wasteForm.amount}
              onChange={e => setWasteForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-1.5 mt-2">
              {WASTE_AMOUNTS.map(ml => (
                <button key={ml} type="button" onClick={() => setWasteForm(f => ({ ...f, amount: String(ml) }))}
                  className={`flex-1 text-xs py-1.5 rounded-lg border transition ${wasteForm.amount === String(ml) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                  {ml}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Lait maternel jeté sans avoir été bu (périmé, reste d&apos;un biberon…). Il est retiré
            de la réserve. Pour le fond d&apos;un biberon donné, utilisez plutôt le champ « jeté »
            du repas.
          </p>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent}
            disabled={!(Number(wasteForm.amount) > 0)} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Bain ─────────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'bath'} onClose={closeModal} title={editingEvent ? 'Modifier — Bain' : 'Bain'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div className="bg-cyan-50 border border-cyan-100 rounded-xl px-4 py-2.5">
            <p className="text-sm font-medium text-cyan-800">Eau à 37 °C</p>
          </div>
          <p className="text-sm text-gray-500">
            Ajoutez une observation si besoin (eau trop chaude, a pleuré, premier bain…).
          </p>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Soin ─────────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'soin'} onClose={closeModal} title={editingEvent ? 'Modifier — Soin' : 'Soin'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quel soin ?</label>
            <input type="text" placeholder="Soin de la peau" value={soinForm.name}
              onChange={e => setSoinForm({ name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-1.5 flex-wrap mt-2">
              {SOINS_SUGGESTIONS.map(x => (
                <button key={x} type="button" onClick={() => setSoinForm({ name: x })}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition ${soinForm.name === x ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600'}`}>
                  {x}
                </button>
              ))}
            </div>
          </div>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent}
            disabled={!soinForm.name.trim()} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Température ──────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'temp'} onClose={closeModal} title={editingEvent ? 'Modifier — Température' : 'Température'}>
        <div className="space-y-4">
          <WhenField date={whenForm.date} time={whenForm.time}
            onDate={v => setWhenForm(f => ({ ...f, date: v }))} onTime={v => setWhenForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Température (°C)</label>
            <input type="text" inputMode="decimal" placeholder="37,2" value={tempForm}
              onChange={e => setTempForm(e.target.value.replace(/[^\d,.]/g, ''))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-1.5 mt-2">
              {['36,5', '37,0', '37,5', '38,0', '38,5', '39,0'].map(t => (
                <button key={t} type="button" onClick={() => setTempForm(t)}
                  className={`flex-1 text-xs py-1.5 rounded-lg border transition ${tempForm === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {/* Lecture immédiate de la valeur saisie — c'est là qu'on veut être alerté */}
          {(() => {
            const v = Number(tempForm.replace(',', '.'))
            if (!tempForm.trim() || !Number.isFinite(v) || v <= 0) return null
            const z = zoneTemperature(v)
            return (
              <div className={`rounded-xl border px-4 py-2.5 ${z.bg}`}>
                <p className={`text-sm font-semibold ${z.texte}`}>{z.titre}</p>
                <p className={`text-xs mt-0.5 ${z.sousTexte}`}>{z.message}</p>
                {z.alerte && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Repère de saisie uniquement — en cas de doute, c&apos;est le médecin qui tranche.
                  </p>
                )}
              </div>
            )
          })()}
          <NoteAide titre="Bien prendre la température">
            <p>La voie <strong>rectale</strong> est la référence chez le nourrisson : c&apos;est la plus fiable.</p>
            <p>Sous le bras ou au front, on lit environ <strong>0,3 à 0,5 °C de moins</strong> — à confirmer en rectal si le chiffre est limite.</p>
            <p>Pas juste après un bain, un repas ou s&apos;il était très couvert : attendez une vingtaine de minutes.</p>
            <p>Plage habituelle : <strong>36 à 37,5 °C</strong>. Fièvre à partir de <strong>38 °C</strong>.</p>
          </NoteAide>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent}
            disabled={!tempForm.trim()} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Vaccin ───────────────────────────────────────────────────── */}
      <Modal isOpen={modalType === 'vaccine'} onClose={closeModal} title={editingEvent ? 'Modifier — Vaccin' : 'Vaccin'}>
        <div className="space-y-4">
          <WhenField date={vaccineForm.date} time={vaccineForm.time}
            onDate={v => setVaccineForm(f => ({ ...f, date: v }))}
            onTime={v => setVaccineForm(f => ({ ...f, time: v }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vaccin</label>
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50 mb-2">
              {VACCINS_SUGGESTIONS.map((v, i) => (
                <button key={i} type="button" onClick={() => setVaccineForm(f => ({ ...f, name: v.name }))}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-blue-50 transition ${vaccineForm.name === v.name ? 'bg-blue-50' : ''}`}>
                  <span className="text-sm text-gray-800">{v.name}</span>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">{v.age}</span>
                </button>
              ))}
            </div>
            <input type="text" placeholder="ou saisir un autre vaccin" value={vaccineForm.name}
              onChange={e => setVaccineForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1.5">
              Les âges affichés sont les repères usuels du calendrier français — le médecin fait foi.
            </p>
          </div>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent}
            disabled={!vaccineForm.name.trim() || !vaccineForm.date} label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Mesure (poids / taille) ──────────────────────────────────── */}
      <Modal isOpen={modalType === 'growth'} onClose={closeModal} title={editingEvent ? 'Modifier — Mesure' : 'Mesure'}>
        <div className="space-y-4">
          <WhenField date={growthForm.date} time={growthForm.time}
            onDate={v => setGrowthForm(f => ({ ...f, date: v }))}
            onTime={v => setGrowthForm(f => ({ ...f, time: v }))}
            label="Date et heure de la mesure" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poids (kg)</label>
              <input type="text" inputMode="decimal" placeholder="0,000" value={growthForm.weight}
                onChange={e => setGrowthForm(f => ({ ...f, weight: e.target.value.replace(/[^\d,.]/g, '') }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Taille (cm)</label>
              <input type="number" min={0} step={0.5} placeholder="50" value={growthForm.height}
                onChange={e => setGrowthForm(f => ({ ...f, height: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Périmètre crânien (cm)</label>
              <input type="number" min={0} step={0.5} placeholder="35" value={growthForm.head}
                onChange={e => setGrowthForm(f => ({ ...f, head: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Une seule des trois valeurs suffit — une pesée sans taille reste utile à la courbe de poids.
          </p>
          <NoteField value={noteForm} onChange={setNoteForm} type={modalType ?? 'bottle'} />
          <ModalFooter onCancel={closeModal} onSave={handleSaveEvent} saving={savingEvent}
            disabled={!growthForm.date || (!growthForm.weight.trim() && !growthForm.height.trim() && !growthForm.head.trim())}
            label={editingEvent ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale Ajouter bébé ─────────────────────────────────────────────── */}
      <Modal isOpen={showAddBabyModal} onClose={() => setShowAddBabyModal(false)} title="Ajouter un bébé">
        <div className="space-y-4">
          <PhotoPicker
            preview={addPhotoPreview}
            onPick={(file) => { setAddPhotoFile(file); setAddPhotoPreview(URL.createObjectURL(file)) }}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
            <input type="text" placeholder="Emma, Léo…" value={addBabyForm.name} onChange={e => setAddBabyForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de naissance</label>
            <input type="date" value={addBabyForm.birthDate} onChange={e => setAddBabyForm(f => ({ ...f, birthDate: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <ModalFooter onCancel={() => setShowAddBabyModal(false)} onSave={handleAddBebe} saving={savingAdd} label="Créer" disabled={!addBabyForm.name.trim() || !addBabyForm.birthDate} />
        </div>
      </Modal>

      {/* ── Modale Éditer bébé ──────────────────────────────────────────────── */}
      <Modal isOpen={showEditBabyModal} onClose={() => setShowEditBabyModal(false)} title={`Modifier — ${selectedBaby?.name}`}>
        <div className="space-y-4">
          <PhotoPicker
            preview={editPhotoPreview}
            onPick={(file) => { setEditPhotoFile(file); setEditPhotoPreview(URL.createObjectURL(file)) }}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
            <input type="text" value={editBabyForm.name} onChange={e => setEditBabyForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de naissance</label>
            <input type="date" value={editBabyForm.birthDate} onChange={e => setEditBabyForm(f => ({ ...f, birthDate: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Journée du bébé — sépare siestes et nuit, et rattache une nuit au bon jour */}
          <div className="border-t border-dashed border-gray-200 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Journée du bébé</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sert à distinguer les siestes de la nuit : un sommeil commencé après l&apos;heure
                de coucher (ou avant celle du réveil) est compté comme une nuit. Le découpage
                des journées, lui, reste à minuit.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Réveil habituel</label>
                <input type="time" value={editBabyForm.journeeDebut}
                  onChange={e => setEditBabyForm(f => ({ ...f, journeeDebut: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Coucher habituel</label>
                <input type="time" value={editBabyForm.journeeFin}
                  onChange={e => setEditBabyForm(f => ({ ...f, journeeFin: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Valeurs par défaut — pré-cochées à chaque nouvelle saisie pour CE bébé */}
          <div className="border-t border-dashed border-gray-200 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Valeurs par défaut</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Ce qui sera déjà sélectionné à l&apos;ouverture d&apos;une nouvelle saisie. Modifiable à chaque fois.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alimentation</label>
              <div className="grid grid-cols-2 gap-2">
                {BOTTLE_KINDS.map(o => (
                  <button key={o.v} type="button" onClick={() => setEditBabyForm(f => ({ ...f, bottleKind: o.v }))}
                    className={`px-3 py-2.5 rounded-xl text-sm border transition text-left ${editBabyForm.bottleKind === o.v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            {/* Le réglage suit le mode choisi : des ml pour un biberon, des minutes pour une tétée */}
            {estSein(editBabyForm.bottleKind) ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Durée de tétée (minutes)</label>
                <input type="number" min={0} step={1} value={editBabyForm.bottleDuration}
                  onChange={e => setEditBabyForm(f => ({ ...f, bottleDuration: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex gap-1.5 mt-2">
                  {TETEE_DUREES.map(min => (
                    <button key={min} type="button" onClick={() => setEditBabyForm(f => ({ ...f, bottleDuration: String(min) }))}
                      className={`flex-1 text-xs py-1.5 rounded-lg border transition ${editBabyForm.bottleDuration === String(min) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                      {min}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Le côté proposé alterne automatiquement avec la dernière tétée enregistrée.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité (ml)</label>
                <input type="number" min={0} step={5} value={editBabyForm.bottleAmount}
                  onChange={e => setEditBabyForm(f => ({ ...f, bottleAmount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex gap-1.5 mt-2">
                  {BOTTLE_AMOUNTS.map(ml => (
                    <button key={ml} type="button" onClick={() => setEditBabyForm(f => ({ ...f, bottleAmount: String(ml) }))}
                      className={`flex-1 text-xs py-1.5 rounded-lg border transition ${editBabyForm.bottleAmount === String(ml) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}>
                      {ml}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Couche</label>
              <div className="grid grid-cols-2 gap-2">
                {DIAPER_KINDS.map(o => (
                  <button key={o.v} type="button" onClick={() => setEditBabyForm(f => ({ ...f, diaperKind: o.v }))}
                    className={`px-3 py-2.5 rounded-xl text-sm border transition text-left ${editBabyForm.diaperKind === o.v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ModalFooter onCancel={() => setShowEditBabyModal(false)} onSave={handleSaveEditBaby} saving={savingEditBaby} disabled={!editBabyForm.name.trim() || !editBabyForm.birthDate} />
        </div>
      </Modal>

      {/* ── Confirmation suppression bébé ──────────────────────────────────── */}
      <Modal isOpen={showDeleteBabyConfirm} onClose={() => setShowDeleteBabyConfirm(false)} title="Supprimer le bébé" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-sm font-semibold text-red-700">Attention — action irréversible</p>
            <p className="text-xs text-red-600 mt-0.5">
              Supprimer <strong>{selectedBaby?.name}</strong> effacera définitivement tous ses biberons, couches, sommeils et médicaments.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteBabyConfirm(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={handleDeleteBaby} disabled={deletingBaby}
              className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
              {deletingBaby ? 'Suppression…' : 'Supprimer tout'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Confirmation suppression événement ─────────────────────────────── */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Supprimer l'événement" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Confirmer la suppression de cet événement ?</p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteConfirm(null)}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
            <button onClick={async () => { if (deleteConfirm) { await deleteEvent(deleteConfirm); setDeleteConfirm(null) } }}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium transition">
              Supprimer
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Partage avec l'autre parent ─────────────────────────────────────── */}
      {selectedBaby && (
        <ShareBabyModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          baby={selectedBaby}
          onLeft={() => setSelectedBabyId(null)}
        />
      )}

    </StoreGate>
  )
}
