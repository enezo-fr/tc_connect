'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Plus, Pencil, Trash2, MessageSquare, Send, Weight, Ruler, Clock, Baby as BabyIcon, Tag,
  CheckCircle2, RotateCcw, Copy, Check, Share2, Users, User, BookUser, CopyPlus,
} from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import Modal from '@/components/ui/Modal'
import { copyText } from '@/lib/clipboard'
import {
  PhoneInput, buildWhatsAppUrl, carnetDisponible, choisirDansCarnet, separerIndicatif,
} from '@/components/ui/PhoneInput'
import { useBebeContacts } from '@/hooks/useBebeContacts'
import type { Bebe, ArrivalTemplate, BebeContact } from '@/types'

// ─── Variables disponibles dans les messages ──────────────────────────────────

const VARIABLES = [
  { token: '{prenom}', label: 'Prénom' },
  { token: '{ne}',     label: 'né / née' },
  { token: '{sexe}',   label: 'garçon / fille' },
  { token: '{date}',   label: 'Date' },
  { token: '{heure}',  label: 'Heure' },
  { token: '{poids}',  label: 'Poids' },
  { token: '{taille}', label: 'Taille' },
]

const DEFAULT_TEMPLATE_BODY =
  '🎉 Quelle joie de vous annoncer l\'arrivée de {prenom} ! {ne} le {date} à {heure}, {poids} pour {taille}. Maman et bébé se portent à merveille 💙'

// ─── Utilitaires ───────────────────────────────────────────────────────────────

// crypto.randomUUID() n'existe qu'en contexte sécurisé (HTTPS/localhost) → fallback robuste
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Grammes → "3,450 kg" (toujours 3 décimales, virgule) */
function formatWeight(g?: number): string {
  if (!g) return ''
  return `${(g / 1000).toFixed(3).replace('.', ',')} kg`
}

/** Grammes → champ kg éditable "3,450" */
function weightToKgInput(g?: number): string {
  if (!g) return ''
  return (g / 1000).toFixed(3).replace('.', ',')
}

/** Champ kg "3,450" → grammes (3450), ou undefined si vide/invalide */
function kgInputToGrams(s: string): number | undefined {
  const v = parseFloat(s.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : undefined
}

/**
 * Le texte qui précède la variable ouvre-t-il une phrase ?
 * (tout début du message, début de ligne, ou fin de la phrase précédente)
 */
function ouvrePhrase(avant: string): boolean {
  // On écarte les blancs et les caractères ouvrants collés à la variable
  // pour retrouver le vrai caractère qui la précède. Le \n est conservé exprès.
  const reste = avant.replace(/[ \t"'«([]+$/, '')
  if (reste === '') return true
  if (reste.endsWith('\n')) return true
  return /[.!?…:]$/.test(reste)
}

/**
 * Remplace une variable par sa valeur, avec MAJUSCULE quand elle ouvre une phrase.
 * Sans ça, « … arrivée de Léa ! {ne} le 12 juillet » sortait « ! né le … ».
 */
function remplacer(body: string, variable: RegExp, valeur: string): string {
  return body.replace(variable, (_m, offset: number, source: string) =>
    valeur && ouvrePhrase(source.slice(0, offset))
      ? valeur.charAt(0).toUpperCase() + valeur.slice(1)
      : valeur
  )
}

function resolveMessage(body: string, baby: Bebe): string {
  const ne   = baby.sex === 'girl' ? 'née' : baby.sex === 'boy' ? 'né' : 'né(e)'
  const sexe = baby.sex === 'girl' ? 'fille' : baby.sex === 'boy' ? 'garçon' : ''
  const date = baby.birthDate?.toDate?.().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) ?? ''
  let out = body
  out = remplacer(out, /\{prenom\}/gi, baby.name ?? '')
  out = remplacer(out, /\{ne\}/gi, ne)
  out = remplacer(out, /\{sexe\}/gi, sexe)
  out = remplacer(out, /\{date\}/gi, date)
  out = remplacer(out, /\{heure\}/gi, baby.birthTime ?? '')
  out = remplacer(out, /\{poids\}/gi, formatWeight(baby.birthWeightG))
  out = remplacer(out, /\{taille\}/gi, baby.birthHeightCm ? `${baby.birthHeightCm} cm` : '')
  return out
}

function smsHref(indicatif: string, telephone: string, text: string): string {
  const num = `${indicatif || '+33'}${telephone.replace(/[\s().+-]/g, '')}`
  return `sms:${num}?&body=${encodeURIComponent(text)}`
}

/**
 * WhatsApp SANS destinataire : ouvre l'app avec le texte prêt et laisse choisir
 * la conversation — c'est la seule façon d'atteindre un GROUPE (un groupe n'a
 * pas de numéro, `wa.me/<numéro>` ne peut donc pas le viser).
 */
const whatsappGroupeHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

// ─── Composant ─────────────────────────────────────────────────────────────────

export function ArrivalSection({
  baby,
  updateBebe,
}: {
  baby: Bebe
  updateBebe: (id: string, data: Partial<Omit<Bebe, 'id'>>) => Promise<void>
}) {
  const { contacts, addContact, updateContact, deleteContact } = useBebeContacts(baby.id)
  const templates = baby.arrivalTemplates ?? []

  // ── Infos de naissance ──────────────────────────────────────────────────────
  const [showInfo, setShowInfo] = useState(false)
  const [infoForm, setInfoForm] = useState({ sex: '', weight: '', height: '', time: '' })
  const [savingInfo, setSavingInfo] = useState(false)

  const openInfo = () => {
    setInfoForm({
      sex: baby.sex ?? '',
      weight: weightToKgInput(baby.birthWeightG),
      height: baby.birthHeightCm ? String(baby.birthHeightCm) : '',
      time: baby.birthTime ?? '',
    })
    setShowInfo(true)
  }

  const saveInfo = async () => {
    setSavingInfo(true)
    try {
      await updateBebe(baby.id, {
        sex: infoForm.sex === 'boy' || infoForm.sex === 'girl' ? infoForm.sex : undefined,
        birthWeightG: kgInputToGrams(infoForm.weight),
        birthHeightCm: infoForm.height ? Number(infoForm.height) : undefined,
        birthTime: infoForm.time || undefined,
      })
      setShowInfo(false)
    } finally { setSavingInfo(false) }
  }

  // ── Modèles de message ──────────────────────────────────────────────────────
  const [tplModal, setTplModal] = useState<{ open: boolean; editing: ArrivalTemplate | null }>({ open: false, editing: null })
  const [tplForm, setTplForm] = useState({ label: '', body: '', groupe: false })
  const [savingTpl, setSavingTpl] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const openNewTpl = () => {
    setTplForm({ label: '', body: templates.length === 0 ? DEFAULT_TEMPLATE_BODY : '', groupe: false })
    setTplModal({ open: true, editing: null })
  }
  const openEditTpl = (t: ArrivalTemplate) => {
    setTplForm({ label: t.label, body: t.body, groupe: !!t.groupe })
    setTplModal({ open: true, editing: t })
  }
  /**
   * Repartir d'un message existant : on ouvre la modale en création (pas en
   * édition) avec le texte déjà là — écrire « Amis » à partir de « Famille »
   * ne demande alors que les retouches, et l'original n'est pas touché.
   */
  const dupliquerTpl = (t: ArrivalTemplate) => {
    setTplForm({ label: `${t.label} (copie)`, body: t.body, groupe: !!t.groupe })
    setTplModal({ open: true, editing: null })
  }

  const insertVar = (token: string) => {
    const el = bodyRef.current
    if (!el) { setTplForm(f => ({ ...f, body: f.body + token })); return }
    const start = el.selectionStart, end = el.selectionEnd
    setTplForm(f => ({ ...f, body: f.body.slice(0, start) + token + f.body.slice(end) }))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length })
  }

  const saveTpl = async () => {
    if (!tplForm.label.trim() || !tplForm.body.trim()) return
    setSavingTpl(true)
    try {
      const champs = { label: tplForm.label.trim(), body: tplForm.body.trim(), groupe: tplForm.groupe }
      let next: ArrivalTemplate[]
      if (tplModal.editing) {
        next = templates.map(t => t.id === tplModal.editing!.id ? { ...t, ...champs } : t)
      } else {
        next = [...templates, { id: genId(), ...champs }]
      }
      await updateBebe(baby.id, { arrivalTemplates: next })
      setTplModal({ open: false, editing: null })
    } finally { setSavingTpl(false) }
  }

  const deleteTpl = async (id: string) => {
    await updateBebe(baby.id, { arrivalTemplates: templates.filter(t => t.id !== id) })
  }

  // ── Copier / partager le message sans passer par un contact ────────────────
  // (groupes Messenger, WhatsApp, réseaux… : on colle le texte à la main)
  const [copie, setCopie] = useState<string | null>(null)

  const copier = async (cle: string, texte: string) => {
    const ok = await copyText(texte)
    if (!ok) return
    setCopie(cle)
    setTimeout(() => setCopie(c => (c === cle ? null : c)), 2000)
  }

  const peutPartager = typeof navigator !== 'undefined' && 'share' in navigator

  const partager = async (texte: string) => {
    try { await navigator.share({ text: texte }) } catch { /* partage annulé */ }
  }

  /**
   * Messenger n'accepte AUCUN texte pré-rempli (pas d'équivalent de `?text=`) :
   * on copie le message, puis on ouvre l'app pour n'avoir qu'à coller.
   * Si l'app n'est pas installée, rien ne se passe → repli sur messenger.com,
   * annulé si l'app a bien pris la main (la page passe en arrière-plan).
   */
  const ouvrirMessenger = async (cle: string, texte: string) => {
    await copier(cle, texte)
    const repli = setTimeout(() => {
      if (!document.hidden) window.open('https://www.messenger.com/', '_blank', 'noopener')
    }, 1200)
    const stop = () => { if (document.hidden) clearTimeout(repli) }
    document.addEventListener('visibilitychange', stop, { once: true })
    window.location.href = 'fb-messenger://'
  }

  // ── Contacts ────────────────────────────────────────────────────────────────
  const [ctModal, setCtModal] = useState<{ open: boolean; editing: BebeContact | null }>({ open: false, editing: null })
  const [ctForm, setCtForm] = useState({ name: '', indicatif: '+33', telephone: '', templateId: '' })
  const [savingCt, setSavingCt] = useState(false)
  const [deleteCt, setDeleteCt] = useState<string | null>(null)

  const openNewCt = () => {
    setCtForm({ name: '', indicatif: '+33', telephone: '', templateId: templates[0]?.id ?? '' })
    setCtModal({ open: true, editing: null })
  }
  const openEditCt = (c: BebeContact) => {
    setCtForm({ name: c.name, indicatif: c.indicatif || '+33', telephone: c.telephone, templateId: c.templateId ?? '' })
    setCtModal({ open: true, editing: c })
  }

  /** Reprend un contact du téléphone (nom + numéro découpé en indicatif). */
  const importerDepuisCarnet = async () => {
    const c = await choisirDansCarnet()
    if (!c) return
    setCtForm(f => {
      const tel = c.tel ? separerIndicatif(c.tel, f.indicatif) : null
      return {
        ...f,
        name: c.nom?.trim() || f.name,
        indicatif: tel?.indicatif ?? f.indicatif,
        telephone: tel?.telephone ?? f.telephone,
      }
    })
  }

  const saveCt = async () => {
    if (!ctForm.name.trim() || !ctForm.telephone.trim()) return
    setSavingCt(true)
    try {
      const data = {
        name: ctForm.name.trim(),
        indicatif: ctForm.indicatif || '+33',
        telephone: ctForm.telephone.trim(),
        templateId: ctForm.templateId || undefined,
      }
      if (ctModal.editing) await updateContact(ctModal.editing.id, data)
      else await addContact(data)
      setCtModal({ open: false, editing: null })
    } finally { setSavingCt(false) }
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────
  const [sendCt, setSendCt] = useState<BebeContact | null>(null)
  const [sendTplId, setSendTplId] = useState<string>('')
  const [sendText, setSendText] = useState('')

  const openSend = (c: BebeContact) => {
    const tpl = templates.find(t => t.id === c.templateId) ?? templates[0]
    setSendCt(c)
    setSendTplId(tpl?.id ?? '')
    setSendText(tpl ? resolveMessage(tpl.body, baby) : '')
  }
  const pickSendTpl = (id: string) => {
    setSendTplId(id)
    const tpl = templates.find(t => t.id === id)
    if (tpl) setSendText(resolveMessage(tpl.body, baby))
  }

  // `via: null` = envoyé autrement (texte copié puis collé dans un groupe…)
  const markSent = (c: BebeContact, via: 'sms' | 'whatsapp' | null) =>
    updateContact(c.id, { sentAt: Timestamp.now(), sentVia: via })
  const unmarkSent = (c: BebeContact) =>
    updateContact(c.id, { sentAt: null, sentVia: null })

  const tplLabel = (id?: string) => templates.find(t => t.id === id)?.label

  // ── Filtres ─────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'sent'>('all')
  const [tplFilter, setTplFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const sentCount = useMemo(() => contacts.filter(c => c.sentAt).length, [contacts])

  const filteredContacts = useMemo(() => contacts.filter(c => {
    if (statusFilter === 'todo' && c.sentAt) return false
    if (statusFilter === 'sent' && !c.sentAt) return false
    if (tplFilter === 'none' && c.templateId) return false
    if (tplFilter !== 'all' && tplFilter !== 'none' && c.templateId !== tplFilter) return false
    if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }), [contacts, statusFilter, tplFilter, search])

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Infos de naissance */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Faire-part — infos de naissance</p>
          <button onClick={openInfo} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
            <Pencil size={15} />
          </button>
        </div>
        {/* Pas de périmètre crânien ici : on ne l'annonce pas dans un faire-part.
            Il se suit dans l'onglet Santé, via une mesure. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoCell icon={BabyIcon} label="Sexe"  value={baby.sex === 'girl' ? 'Fille' : baby.sex === 'boy' ? 'Garçon' : '—'} />
          <InfoCell icon={Weight}   label="Poids" value={formatWeight(baby.birthWeightG) || '—'} />
          <InfoCell icon={Ruler}    label="Taille" value={baby.birthHeightCm ? `${baby.birthHeightCm} cm` : '—'} />
          <InfoCell icon={Clock}    label="Heure" value={baby.birthTime || '—'} />
        </div>
      </div>

      {/* Modèles de message */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Modèles de message</p>
          <button onClick={openNewTpl} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition">
            <Plus size={14} /> Nouveau
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
            <MessageSquare size={28} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Aucun modèle. Créez-en un (Famille, Amis…) pour pouvoir envoyer.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.id} className={`rounded-xl border shadow-sm px-4 py-3 ${t.groupe ? 'bg-indigo-50/50 border-indigo-100' : 'bg-white border-gray-100'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 flex-wrap">
                      {t.label}
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md ${
                        t.groupe ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {t.groupe ? <><Users size={11} />Groupe</> : <><User size={11} />Personne</>}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{resolveMessage(t.body, baby)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => copier(t.id, resolveMessage(t.body, baby))}
                      title="Copier le message"
                      className={`p-1.5 rounded-lg transition ${copie === t.id ? 'text-green-600 bg-green-50' : 'text-gray-300 hover:text-blue-500 hover:bg-blue-50'}`}>
                      {copie === t.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {peutPartager && (
                      <button onClick={() => partager(resolveMessage(t.body, baby))}
                        title="Partager le message"
                        className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Share2 size={14} /></button>
                    )}
                    <button onClick={() => dupliquerTpl(t)} title="Dupliquer ce modèle"
                      className="p-1.5 rounded-lg text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition"><CopyPlus size={14} /></button>
                    <button onClick={() => openEditTpl(t)} className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                    <button onClick={() => deleteTpl(t.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                  </div>
                </div>

                {/* Message de groupe : pas de numéro à composer, on ouvre l'app
                    et on choisit la conversation. D'où l'envoi ICI, sur le modèle,
                    et non depuis la liste des personnes. */}
                {t.groupe && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <a href={whatsappGroupeHref(resolveMessage(t.body, baby))} target="_blank" rel="noopener noreferrer"
                      className="flex-1 min-w-[8rem] flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white py-2 rounded-xl text-sm font-medium transition">
                      <Send size={15} />WhatsApp
                    </a>
                    <button onClick={() => ouvrirMessenger(`msg-${t.id}`, resolveMessage(t.body, baby))}
                      className="flex-1 min-w-[8rem] flex items-center justify-center gap-2 bg-[#0084FF] hover:bg-[#0072dd] text-white py-2 rounded-xl text-sm font-medium transition">
                      {copie === `msg-${t.id}` ? <><Check size={15} />Texte copié</> : <><MessageSquare size={15} />Messenger</>}
                    </button>
                  </div>
                )}
                {t.groupe && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    WhatsApp s&apos;ouvre avec le texte prêt, vous choisissez le groupe. Messenger
                    n&apos;accepte pas de texte pré-rempli : il est copié, il n&apos;y a plus qu&apos;à coller.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Liste des personnes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Personnes à prévenir · {sentCount}/{contacts.length} envoyé{sentCount > 1 ? 's' : ''}
          </p>
          <button onClick={openNewCt} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition">
            <Plus size={14} /> Ajouter
          </button>
        </div>

        {/* Filtres */}
        {contacts.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {([
                  { k: 'all',  l: 'Tous' },
                  { k: 'todo', l: 'À envoyer' },
                  { k: 'sent', l: 'Envoyés' },
                ] as const).map(s => (
                  <button key={s.k} onClick={() => setStatusFilter(s.k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === s.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {s.l}
                  </button>
                ))}
              </div>
              {templates.length > 0 && (
                <select value={tplFilter} onChange={e => setTplFilter(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="all">Tous les modèles</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value="none">Sans modèle</option>
                </select>
              )}
            </div>
            <input type="text" placeholder="Rechercher une personne…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}

        {contacts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
            <Send size={28} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Ajoutez les personnes à qui annoncer l&apos;arrivée.</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-400">Aucune personne pour ce filtre.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredContacts.map(c => (
              <div key={c.id} className={`rounded-xl border shadow-sm px-4 py-3 flex items-center gap-3 ${c.sentAt ? 'bg-green-50/60 border-green-100' : 'bg-white border-gray-100'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                    {c.sentAt && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                    {c.name}
                  </p>
                  <p className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                    <span>{c.indicatif} {c.telephone}</span>
                    {tplLabel(c.templateId) && (
                      <span className="inline-flex items-center gap-1 text-blue-500"><Tag size={11} />{tplLabel(c.templateId)}</span>
                    )}
                    {c.sentAt && (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        Envoyé{c.sentVia === 'whatsapp' ? ' · WhatsApp' : c.sentVia === 'sms' ? ' · SMS' : ''}
                        {' '}le {c.sentAt.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à {c.sentAt.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.sentAt && (
                    <button onClick={() => unmarkSent(c)} title="Marquer comme non envoyé"
                      className="p-1.5 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition"><RotateCcw size={14} /></button>
                  )}
                  <button
                    onClick={() => openSend(c)}
                    disabled={templates.length === 0}
                    className={`flex items-center gap-1.5 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-xl transition ${c.sentAt ? 'bg-gray-400 hover:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    <Send size={13} /> {c.sentAt ? 'Renvoyer' : 'Envoyer'}
                  </button>
                  <button onClick={() => openEditCt(c)} className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteCt(c.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modale infos de naissance ─────────────────────────────────────── */}
      <Modal isOpen={showInfo} onClose={() => setShowInfo(false)} title="Infos de naissance">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sexe</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ v: 'boy', l: 'Garçon' }, { v: 'girl', l: 'Fille' }].map(o => (
                <button key={o.v} type="button" onClick={() => setInfoForm(f => ({ ...f, sex: f.sex === o.v ? '' : o.v }))}
                  className={`px-3 py-2.5 rounded-xl text-sm border transition ${infoForm.sex === o.v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poids (kg)</label>
              <input type="text" inputMode="decimal" placeholder="0,000" value={infoForm.weight}
                onChange={e => setInfoForm(f => ({ ...f, weight: e.target.value.replace(/[^\d,.]/g, '') }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Taille (cm)</label>
              <input type="number" min={0} step={1} placeholder="50" value={infoForm.height}
                onChange={e => setInfoForm(f => ({ ...f, height: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Heure de naissance</label>
            <input type="time" value={infoForm.time} onChange={e => setInfoForm(f => ({ ...f, time: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <FooterBtns onCancel={() => setShowInfo(false)} onSave={saveInfo} saving={savingInfo} />
        </div>
      </Modal>

      {/* ── Modale modèle ─────────────────────────────────────────────────── */}
      <Modal isOpen={tplModal.open} onClose={() => setTplModal({ open: false, editing: null })} title={tplModal.editing ? 'Modifier le modèle' : 'Nouveau modèle'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom du modèle</label>
            <input type="text" placeholder="Famille, Amis, Collègues…" value={tplForm.label}
              onChange={e => setTplForm(f => ({ ...f, label: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: false, l: 'Une personne', aide: 'SMS / WhatsApp au numéro', icone: User },
                { v: true,  l: 'Un groupe',    aide: 'Messenger / WhatsApp', icone: Users },
              ] as const).map(o => {
                const actif = tplForm.groupe === o.v
                const Icone = o.icone
                return (
                  <button key={String(o.v)} type="button" onClick={() => setTplForm(f => ({ ...f, groupe: o.v }))}
                    className={`px-3 py-2.5 rounded-xl border text-left transition ${
                      actif ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-700 hover:border-blue-300'
                    }`}>
                    <span className="flex items-center gap-1.5 text-sm font-medium"><Icone size={14} />{o.l}</span>
                    <span className={`block text-[11px] mt-0.5 ${actif ? 'text-blue-100' : 'text-gray-400'}`}>{o.aide}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea ref={bodyRef} rows={5} value={tplForm.body}
              onChange={e => setTplForm(f => ({ ...f, body: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {VARIABLES.map(v => (
                <button key={v.token} type="button" onClick={() => insertVar(v.token)}
                  className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition font-mono">
                  {v.token}
                </button>
              ))}
            </div>
          </div>
          {tplForm.body.trim() && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
              <p className="text-[11px] text-gray-400 mb-1">Aperçu</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{resolveMessage(tplForm.body, baby)}</p>
            </div>
          )}
          <FooterBtns onCancel={() => setTplModal({ open: false, editing: null })} onSave={saveTpl} saving={savingTpl}
            disabled={!tplForm.label.trim() || !tplForm.body.trim()} />
        </div>
      </Modal>

      {/* ── Modale contact ────────────────────────────────────────────────── */}
      <Modal isOpen={ctModal.open} onClose={() => setCtModal({ open: false, editing: null })} title={ctModal.editing ? 'Modifier la personne' : 'Ajouter une personne'}>
        <div className="space-y-4">
          {/* Carnet d'adresses : bouton affiché uniquement si le navigateur
              expose la Contact Picker API (Chrome/Android). Sur iPhone elle
              n'existe pas — le champ téléphone propose l'autoremplissage iOS. */}
          {carnetDisponible() && (
            <button type="button" onClick={importerDepuisCarnet}
              className="w-full flex items-center justify-center gap-2 border border-blue-200 bg-blue-50 text-blue-700 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-100 transition">
              <BookUser size={16} />Choisir dans mes contacts
            </button>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input type="text" placeholder="Mamie, Tonton Paul…" value={ctForm.name}
              onChange={e => setCtForm(f => ({ ...f, name: e.target.value }))}
              autoComplete="name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
            <PhoneInput
              indicatif={ctForm.indicatif}
              telephone={ctForm.telephone}
              onIndicatifChange={v => setCtForm(f => ({ ...f, indicatif: v }))}
              onTelephoneChange={v => setCtForm(f => ({ ...f, telephone: v }))}
            />
          </div>
          {templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modèle de message</label>
              <select value={ctForm.templateId} onChange={e => setCtForm(f => ({ ...f, templateId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Aucun —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.label}{t.groupe ? ' (groupe)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          <FooterBtns onCancel={() => setCtModal({ open: false, editing: null })} onSave={saveCt} saving={savingCt}
            disabled={!ctForm.name.trim() || !ctForm.telephone.trim()} label={ctModal.editing ? 'Enregistrer' : 'Ajouter'} />
        </div>
      </Modal>

      {/* ── Modale envoi ──────────────────────────────────────────────────── */}
      <Modal isOpen={!!sendCt} onClose={() => setSendCt(null)} title={sendCt ? `Annoncer à ${sendCt.name}` : ''}>
        {sendCt && (
          <div className="space-y-4">
            {templates.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Modèle</label>
                <select value={sendTplId} onChange={e => pickSendTpl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message (modifiable avant envoi)</label>
              <textarea rows={6} value={sendText} onChange={e => setSendText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <div className="flex gap-3">
              <a href={smsHref(sendCt.indicatif, sendCt.telephone, sendText)}
                onClick={() => { markSent(sendCt, 'sms'); setSendCt(null) }}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                <MessageSquare size={16} /> SMS
              </a>
              <a href={buildWhatsAppUrl(sendCt.indicatif, sendCt.telephone, encodeURIComponent(sendText))}
                target="_blank" rel="noopener noreferrer"
                onClick={() => { markSent(sendCt, 'whatsapp'); setSendCt(null) }}
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white py-2.5 rounded-xl text-sm font-medium transition">
                <Send size={16} /> WhatsApp
              </a>
            </div>
            <div className="flex gap-3">
              <button onClick={() => copier('send', sendText)}
                className={`flex-1 flex items-center justify-center gap-2 border py-2.5 rounded-xl text-sm font-medium transition ${copie === 'send' ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                {copie === 'send' ? <><Check size={16} />Copié</> : <><Copy size={16} />Copier le texte</>}
              </button>
              {peutPartager && (
                <button onClick={() => partager(sendText)}
                  className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                  <Share2 size={16} />Partager
                </button>
              )}
            </div>
            {!sendCt.sentAt && (
              <button onClick={() => { markSent(sendCt, null); setSendCt(null) }}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-green-600 py-1.5 transition">
                <CheckCircle2 size={15} />Marquer comme envoyé
              </button>
            )}
            <p className="text-[11px] text-gray-400 text-center">
              SMS / WhatsApp ouvrent la conversation avec le message pré-rempli.
              « Copier » sert pour un groupe (Messenger, WhatsApp…) : l&apos;envoi n&apos;étant pas
              détectable, marquez-le à la main.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Confirmation suppression contact ──────────────────────────────── */}
      <Modal isOpen={!!deleteCt} onClose={() => setDeleteCt(null)} title="Supprimer la personne" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Confirmer la suppression de ce contact ?</p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteCt(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={async () => { if (deleteCt) { await deleteContact(deleteCt); setDeleteCt(null) } }}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium transition">Supprimer</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────────

function InfoCell({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center shrink-0">
        <Icon size={14} className="text-sky-600" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-800 truncate">{value}</p>
      </div>
    </div>
  )
}

function FooterBtns({ onCancel, onSave, saving, label = 'Enregistrer', disabled = false }: {
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
