'use client'

import { useState, useEffect, useRef } from 'react'

export const INDICATIFS = [
  { code: '+33',  flag: '🇫🇷', iso: 'fr', pays: 'France' },
  { code: '+32',  flag: '🇧🇪', iso: 'be', pays: 'Belgique' },
  { code: '+41',  flag: '🇨🇭', iso: 'ch', pays: 'Suisse' },
  { code: '+352', flag: '🇱🇺', iso: 'lu', pays: 'Luxembourg' },
  { code: '+377', flag: '🇲🇨', iso: 'mc', pays: 'Monaco' },
  { code: '+1',   flag: '🇺🇸', iso: 'us', pays: 'USA / Canada' },
  { code: '+44',  flag: '🇬🇧', iso: 'gb', pays: 'Royaume-Uni' },
  { code: '+49',  flag: '🇩🇪', iso: 'de', pays: 'Allemagne' },
  { code: '+34',  flag: '🇪🇸', iso: 'es', pays: 'Espagne' },
  { code: '+39',  flag: '🇮🇹', iso: 'it', pays: 'Italie' },
  { code: '+351', flag: '🇵🇹', iso: 'pt', pays: 'Portugal' },
  { code: '+31',  flag: '🇳🇱', iso: 'nl', pays: 'Pays-Bas' },
  { code: '+212', flag: '🇲🇦', iso: 'ma', pays: 'Maroc' },
  { code: '+213', flag: '🇩🇿', iso: 'dz', pays: 'Algérie' },
  { code: '+216', flag: '🇹🇳', iso: 'tn', pays: 'Tunisie' },
  { code: '+225', flag: '🇨🇮', iso: 'ci', pays: "Côte d'Ivoire" },
  { code: '+221', flag: '🇸🇳', iso: 'sn', pays: 'Sénégal' },
  { code: '+237', flag: '🇨🇲', iso: 'cm', pays: 'Cameroun' },
]

// Drapeau en IMAGE (les emojis-drapeaux ne s'affichent pas sur Windows → « FR » au lieu de 🇫🇷).
//
// ⚠️ L'image vient d'un CDN externe : elle peut ne jamais arriver (hors-ligne,
// bloqueur DNS, réseau filtré) et laissait alors une icône « image cassée ».
// D'où le repli SANS RÉSEAU en cas d'échec : l'emoji là où il s'affiche
// (iOS/Android/macOS), le code pays en lettres sur Windows.
const emojiDrapeauRendu = () =>
  typeof navigator === 'undefined' || !/Windows/i.test(navigator.userAgent)

function Flag({ iso, emoji, className = 'w-5 h-auto rounded-sm' }: { iso?: string; emoji: string; className?: string }) {
  const [echec, setEchec] = useState(false)

  if (!iso || echec) {
    if (iso && !emojiDrapeauRendu()) {
      return (
        <span className="text-[10px] font-semibold tracking-wide text-gray-500 bg-gray-100 rounded px-1 py-0.5 leading-none">
          {iso.toUpperCase()}
        </span>
      )
    }
    return <span className="text-lg leading-none">{emoji}</span>
  }
  return (
    <img src={`https://flagcdn.com/${iso}.svg`} alt={emoji} className={className} loading="lazy"
      onError={() => setEchec(true)} />
  )
}

/**
 * Numéro au format international appelable, à partir de l'indicatif et du numéro
 * tel qu'il est saisi ou affiché (« 06 12 34 56 78 »).
 *
 * ⚠️ Le 0 de tête est un préfixe NATIONAL : « +33 06 12 34 56 78 » n'existe pas
 * et WhatsApp refusait le lien (« numéro invalide »). Il faut le retirer.
 * ⚠️ Exception l'Italie (+39), qui conserve son 0 sur les numéros fixes — ne pas
 * généraliser le retrait à tous les pays.
 */
export function numeroInternational(indicatif: string, telephone: string): string {
  const ind = (indicatif || '+33').replace(/[^\d]/g, '')
  let local = telephone.replace(/\D/g, '')
  if (ind !== '39' && local.startsWith('0')) local = local.slice(1)
  return `+${ind}${local}`
}

export function buildWhatsAppUrl(indicatif: string, telephone: string, message?: string): string {
  const url = `https://wa.me/${numeroInternational(indicatif, telephone).slice(1)}`
  return message ? `${url}?text=${message}` : url
}

/**
 * Découpe un numéro brut (carnet d'adresses, copier-coller) en indicatif + numéro.
 * On teste les indicatifs du plus long au plus court, sinon « +33 » avalerait « +352 ».
 */
export function separerIndicatif(brut: string, defaut = '+33'): { indicatif: string; telephone: string } {
  const compact = brut.replace(/[\s(). -]/g, '').replace(/^00/, '+')
  if (compact.startsWith('+')) {
    const codes = [...INDICATIFS].sort((a, b) => b.code.length - a.code.length)
    const trouve = codes.find((c) => compact.startsWith(c.code))
    if (trouve) return { indicatif: trouve.code, telephone: compact.slice(trouve.code.length) }
    // Indicatif inconnu : on garde les 1 à 3 chiffres qui suivent le « + »
    const m = compact.match(/^\+(\d{1,3})(\d+)$/)
    if (m) return { indicatif: `+${m[1]}`, telephone: m[2] }
  }
  return { indicatif: defaut, telephone: compact }
}

// ─── Carnet d'adresses de l'appareil ──────────────────────────────────────────
// Contact Picker API : Chrome/Android uniquement. iOS (Safari, y compris en PWA)
// ne l'implémente pas — d'où le bouton affiché seulement si l'API existe, et
// l'`autoComplete="tel"` sur le champ, seule aide au remplissage sur iPhone.

interface ContactSelectionne { name?: string[]; tel?: string[] }
interface ContactsManager {
  select: (props: string[], opts?: { multiple?: boolean }) => Promise<ContactSelectionne[]>
}

const carnet = (): ContactsManager | undefined => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return undefined
  if (!('contacts' in navigator) || !('ContactsManager' in window)) return undefined
  return (navigator as Navigator & { contacts?: ContactsManager }).contacts
}

/** Le carnet d'adresses est-il accessible depuis ce navigateur ? */
export const carnetDisponible = () => !!carnet()

/** Ouvre le sélecteur de contacts du téléphone (null si refusé / indisponible). */
export async function choisirDansCarnet(): Promise<{ nom?: string; tel?: string } | null> {
  const [premier] = await choisirPlusieursDansCarnet(false)
  return premier ?? null
}

/** Idem, en sélection multiple (liste vide si refusé / indisponible). */
export async function choisirPlusieursDansCarnet(multiple = true): Promise<{ nom?: string; tel?: string }[]> {
  const api = carnet()
  if (!api) return []
  try {
    const choisis = await api.select(['name', 'tel'], { multiple })
    return choisis
      .map((c) => ({ nom: c.name?.[0], tel: c.tel?.[0] }))
      .filter((c) => c.nom || c.tel)
  } catch {
    return [] // sélection annulée
  }
}

interface PhoneInputProps {
  indicatif: string
  telephone: string
  onIndicatifChange: (v: string) => void
  onTelephoneChange: (v: string) => void
  inputClassName?: string
  selectClassName?: string
  placeholder?: string
  /**
   * Annote le champ pour l'autoremplissage (`name="tel" autocomplete="tel"`).
   * ⚠️ **Opt-in volontaire, JAMAIS par défaut** : posé partout, ça avait fait
   * disparaître la proposition « Remplir depuis un contact » sur l'iPhone de
   * Teddy. À n'activer que là où on veut qu'iOS remplisse nom + téléphone
   * ensemble — le champ doit alors être dans le **même `<form>`** que deux
   * champs annotés `given-name` et `family-name`. Un champ « Nom » unique
   * (annoté `name` ou non) ne reçoit que le NOM DE FAMILLE, sans le numéro :
   * l'autoremplissage iOS raisonne par rôle de champ, pas par libellé.
   */
  autoCompleteTel?: boolean
}

export function PhoneInput({
  indicatif,
  telephone,
  onIndicatifChange,
  onTelephoneChange,
  inputClassName,
  placeholder,
  autoCompleteTel = false,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [customCode, setCustomCode] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const knownEntry = INDICATIFS.find((c) => c.code === indicatif)
  const selected = knownEntry || { code: indicatif || '+33', flag: '🌍', iso: '', pays: 'Autre' }

  const filtered = search.trim()
    ? INDICATIFS.filter(
        (c) =>
          c.pays.toLowerCase().includes(search.toLowerCase()) ||
          c.code.includes(search)
      )
    : INDICATIFS

  // "Use this code" row when search looks like an unknown phone code
  const searchLooksLikeCode = /^\+?\d+$/.test(search.trim())
  const customSearchCode = search.trim().startsWith('+') ? search.trim() : search.trim() ? `+${search.trim()}` : ''
  const showUseRow = searchLooksLikeCode && customSearchCode && !INDICATIFS.some((c) => c.code === customSearchCode)

  const applyCustomCode = (raw: string) => {
    const code = raw.trim().startsWith('+') ? raw.trim() : `+${raw.trim()}`
    if (code.length > 1) {
      onIndicatifChange(code)
      setOpen(false)
      setCustomCode('')
    }
  }

  useEffect(() => {
    if (!open) { setSearch(''); setCustomCode(''); return }
    setTimeout(() => searchRef.current?.focus(), 30)
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const base = 'border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="flex gap-2">
      {/* Flag button + dropdown */}
      <div ref={wrapperRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`${base} bg-white flex items-center gap-1 px-2 min-w-[3.5rem] justify-center`}
          title={`${selected.flag} ${selected.code} ${selected.pays}`}
        >
          <Flag iso={selected.iso} emoji={selected.flag} />
          <svg className="w-3 h-3 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[26rem]">
            {/* Search */}
            <div className="p-2 border-b border-gray-100 shrink-0">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pays ou code (+261…)"
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
              />
            </div>

            {/* Country list */}
            <div className="overflow-y-auto flex-1">
              {showUseRow && (
                <button
                  type="button"
                  onClick={() => { onIndicatifChange(customSearchCode); setOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-blue-50 transition text-left border-b border-gray-100"
                >
                  <span className="text-lg">🌍</span>
                  <span className="text-blue-600 font-mono text-xs w-10 shrink-0">{customSearchCode}</span>
                  <span className="text-blue-600 min-w-0 truncate font-medium">Utiliser ce code</span>
                </button>
              )}
              {filtered.length === 0 && !showUseRow && (
                <p className="text-xs text-gray-400 text-center py-4">Aucun résultat</p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onIndicatifChange(c.code); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition text-left ${c.code === indicatif ? 'bg-blue-50' : ''}`}
                >
                  <Flag iso={c.iso} emoji={c.flag} />
                  <span className="text-gray-500 w-10 shrink-0 font-mono text-xs">{c.code}</span>
                  <span className="text-gray-700 min-w-0 truncate">{c.pays}</span>
                </button>
              ))}
            </div>

            {/* Always-visible manual entry */}
            <div className="border-t border-gray-100 px-3 py-2.5 shrink-0 bg-gray-50">
              <p className="text-[11px] text-gray-400 mb-1.5">Indicatif personnalisé :</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="+261"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 font-mono bg-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); applyCustomCode(customCode) }
                  }}
                />
                <button
                  type="button"
                  onClick={() => applyCustomCode(customCode)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ⚠️ Par défaut AUCUNE annotation ici : ajoutée partout le 2026-07-26 pour
          « aider » l'autoremplissage iOS, elle l'avait fait DISPARAÎTRE. Safari
          propose « Remplir depuis un contact » tout seul sur un simple `type="tel"`,
          mais ne remplit alors QUE le champ touché. L'annotation (+ un <form> commun
          avec le nom) est ce qui permet de remplir les deux d'un coup : réservée aux
          endroits qui la demandent explicitement, via `autoCompleteTel`. */}
      <input
        type="tel"
        {...(autoCompleteTel ? { name: 'tel', autoComplete: 'tel' as const } : {})}
        value={telephone}
        onChange={(e) => onTelephoneChange(e.target.value)}
        placeholder={placeholder || '06 12 34 56 78'}
        className={inputClassName || `flex-1 ${base}`}
      />
    </div>
  )
}
