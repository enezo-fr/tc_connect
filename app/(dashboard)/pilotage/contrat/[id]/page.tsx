'use client'

// Page dédiée d'un contrat Pilotage : Documents · Contenu projet · Mentions légales · Tâches · Aperçu.
// Remplace l'ancien « modal dans un modal » (Documents → Infos) par un écran plein, propre.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '@/context/AuthContext'
import { useBrand } from '@/context/BrandContext'
import { publicLinkOrigin } from '@/lib/brand'
import { usePilotageContrats } from '@/hooks/usePilotageContrats'
import { useClients } from '@/hooks/useClients'
import { useCompanies } from '@/hooks/useCompanies'
import { usePilotageDocuments } from '@/hooks/usePilotageDocuments'
import { usePilotageSettings } from '@/hooks/usePilotageSettings'
import { useInvoices } from '@/hooks/useInvoices'
import { uploadBlob, deleteImage } from '@/lib/uploadImage'
import SignaturePad from '@/components/ui/SignaturePad'
import Modal from '@/components/ui/Modal'
import { generatePilotageDocPdf, PILOTAGE_DOC_TYPES, STATUT_DOC_LABELS } from '@/lib/pilotageDocPdf'
import { buildDevisFromContrat, buildObjetAuto, buildValeurBannerAuto } from '@/lib/pilotageDevis'
import { DevisLinkPicker } from '@/components/pilotage/DevisLinkPicker'
import { ContratEditModal } from '@/components/pilotage/ContratEditModal'
import { createFacture } from '@/lib/facturationService'
import { defaultLegalFields, legalFieldGroupsAll, type LegalFields } from '@/lib/pilotageLegalTemplates'
import { defaultProjetContent, DEFAULT_PLANNING_ETAPES, DEFAULT_PLANNING_TEMPLATE, generatePlanningFromTemplate, type ProjetContent } from '@/lib/pilotageProjetTemplates'
import { StringListEditor, FonctionsEditor, PlanningEditor, TacheAjoutForm, TachesApercu, PlanningApercu, ProjetApercu, tauxHoraireFromTjm, prixFacture, estEnRetard } from '@/components/pilotage/ProjetUI'
import { CharteEditor, CharteApercu, defaultCharte } from '@/components/pilotage/CharteUI'
import EstimateurTarif from '@/components/pilotage/EstimateurTarif'
import { computeTarif, stateFromEstimation, fmtEur, featuresToFonctions, fonctionsToFeatures, type TarifResult } from '@/lib/pilotageEstimateur'
import { usePilotageCatalogue } from '@/hooks/usePilotageCatalogue'
import { randomUUID } from '@/lib/uuid'
import { copyText } from '@/lib/clipboard'
import { EvolutionEditor, DEFAULT_EVOLUTION } from '@/components/pilotage/EvolutionEditor'
import { PerimetreEditor, splitPerimetre, type PerimetreItem } from '@/components/pilotage/PerimetreEditor'
import { FicheNego } from '@/components/pilotage/FicheNego'
import SuivisPeriodiques from '@/components/pilotage/SuivisPeriodiques'
import InfraCostEstimator from '@/components/pilotage/InfraCostEstimator'
import type { PilotageContrat, PilotageDocument, PilotageDocumentType, ChartGraphique, PilotageEstimation, SavedEstimation, DevisEvolution, InfraInputs } from '@/types'
import {
  ArrowLeftIcon, TrashIcon, PlusIcon, CheckIcon, ArrowDownTrayIcon, ExclamationTriangleIcon, PencilIcon,
  EyeIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline'

const TABS = [
  { key: 'documents', label: 'Documents', essentiel: true },
  { key: 'calculateur', label: 'Calculateur', essentiel: true },
  { key: 'fichenego', label: 'Fiche négo', essentiel: false },
  { key: 'projet', label: 'Contenu projet', essentiel: true },
  { key: 'charte', label: 'Charte & cadrage', essentiel: false },
  { key: 'planning', label: 'Planning', essentiel: false },
  { key: 'legal', label: 'Mentions légales', essentiel: false },
  { key: 'taches', label: 'Tâches', essentiel: false },
  { key: 'suivi', label: 'Suivi', essentiel: false },
  { key: 'apercu', label: 'Aperçu', essentiel: false },
] as const
type TabKey = typeof TABS[number]['key']

// Sous-titre + ouverture par défaut de chaque section légale (accordéon)
// Champ texte qui démarre sur une ligne et s'agrandit vers le bas quand le texte est long
// (utilisé pour les mentions légales : plus de texte tronqué/coupé horizontalement).
function AutoTextarea({ value, onChange, placeholder, multiline }: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (!multiline && e.key === 'Enter') e.preventDefault() }}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden block" />
  )
}

// Éditeur de liste (chips + ajout via « + » + suggestions cliquables). Stocke une chaîne « a, b, c »
// (compatible avec le rendu en phrase dans les templates légaux).
function TagListField({ value, onChange, placeholder, suggestions }: {
  value: string; onChange: (v: string) => void; placeholder?: string; suggestions?: string[]
}) {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean)
  const [draft, setDraft] = useState('')
  const set = (next: string[]) => onChange(next.join(', '))
  const add = (label: string) => {
    const l = label.trim()
    if (!l || items.some((x) => x.toLowerCase() === l.toLowerCase())) { setDraft(''); return }
    set([...items, l]); setDraft('')
  }
  const remaining = (suggestions ?? []).filter((s) => !items.some((x) => x.toLowerCase() === s.toLowerCase()))
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-full pl-2.5 pr-1 py-0.5 text-xs">
              {it}
              <button type="button" onClick={() => set(items.filter((_, j) => j !== i))} className="text-blue-400 hover:text-blue-700 text-sm leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } }}
          placeholder={placeholder || 'Ajouter…'}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="button" onClick={() => add(draft)} disabled={!draft.trim()}
          className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition">+</button>
      </div>
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="text-[11px] border border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-700 rounded-full px-2 py-0.5 transition">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Liste unifiée « hors périmètre / options » reconstruite depuis le contrat enregistré.
function buildPerimetre(c: PilotageContrat | null): PerimetreItem[] {
  if (!c) return []
  return [
    ...(c.projet?.horsPerimetre ?? []).filter((l) => l.trim()).map((l): PerimetreItem => ({ label: l, type: 'exclu' })),
    ...(c.optionsDevis ?? []).map((o): PerimetreItem => ({ label: o.label, type: 'option', description: o.description, prixMin: o.prixMin, prixMax: o.prixMax })),
  ]
}

function legalGroupMeta(titre: string): { sub: string; open: boolean } {
  if (titre.startsWith('Prestataire')) return { sub: 'Tes infos — pré-remplies depuis ta Société', open: false }
  if (titre === 'Client') return { sub: 'Pré-rempli depuis la fiche client', open: false }
  if (titre.startsWith('Conditions')) return { sub: 'Contrat de prestation de services', open: true }
  if (titre.startsWith('RGPD')) return { sub: 'Accord DPA — si l’app traite des données personnelles', open: false }
  if (titre.startsWith('Licence')) return { sub: 'Contrat de licence / cession de droits', open: false }
  return { sub: '', open: false }
}

// Barre d'action d'un onglet éditable : lecture seule → « Modifier » → « Annuler » / « Enregistrer »
function EditBar({ editing, onEdit, onCancel, onSave, saveState }: {
  editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; saveState: 'idle' | 'saving' | 'done'
}) {
  if (editing) return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={onCancel} className="text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-1.5 rounded-lg transition">Annuler</button>
      <button onClick={onSave} disabled={saveState === 'saving'}
        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition">
        {saveState === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  )
  return (
    <div className="flex items-center justify-between gap-2">
      {saveState === 'done'
        ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckIcon className="w-3.5 h-3.5" /> Enregistré</span>
        : <span />}
      <button onClick={onEdit}
        className="flex items-center gap-1.5 text-sm font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 px-4 py-1.5 rounded-lg transition">
        <PencilIcon className="w-4 h-4" /> Modifier
      </button>
    </div>
  )
}

// Lecture seule des mentions légales (n'affiche que les champs renseignés)
function LegalApercu({ legal }: { legal: LegalFields }) {
  const groups = legalFieldGroupsAll()
    .map((g) => ({ titre: g.titre, champs: g.champs.filter((ch) => (legal[ch.key] ?? '').trim()) }))
    .filter((g) => g.champs.length > 0)
  if (groups.length === 0)
    return <p className="text-sm text-gray-400 text-center py-10">Aucune mention renseignée.<br />Clique sur « Modifier » pour remplir.</p>
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.titre}>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">{g.titre}</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {g.champs.map((ch) => (
              <div key={ch.key} className={ch.multiline ? 'sm:col-span-2' : ''}>
                <dt className="text-[11px] text-gray-400">{ch.label}</dt>
                <dd className="text-sm text-gray-700 whitespace-pre-wrap">{ch.kind === 'toggle' ? (legal[ch.key] === 'oui' ? 'Oui' : 'Non') : legal[ch.key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

export default function ContratPage() {
  const router = useRouter()
  const params = useParams()
  const id = String(params?.id ?? '')
  const { userProfile, currentUser } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const { brand } = useBrand()

  const { contrats, loading, updateContrat } = usePilotageContrats()
  const { clients } = useClients()
  const { companies } = useCompanies()
  const company = useMemo(
    () => companies.find((c) => (c.nom ?? '').toLowerCase().includes('solutions')) ?? companies[0] ?? null,
    [companies])
  const contrat = useMemo(() => contrats.find((c) => c.id === id) ?? null, [contrats, id])
  // Devis & factures générés depuis ce contrat (lien `contratId`), plus récents d'abord.
  const { invoices, loading: invoicesLoading } = useInvoices(currentUser?.uid ?? '')
  const { items: catalogueItems } = usePilotageCatalogue()
  const contratFactures = useMemo(
    () => invoices.filter((f) => f.contratId === id).sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)),
    [invoices, id],
  )
  const { documents, addDocument, updateDocument, deleteDocument } = usePilotageDocuments(id)

  // Génère un devis de prestation pré-rempli depuis le contrat, puis ouvre la fiche devis.
  const [genDevis, setGenDevis] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const generateDevis = async () => {
    if (!contrat || !currentUser) return
    setGenDevis(true)
    try {
      const client = clients.find((c) => c.id === contrat.clientId) ?? null
      const payload = buildDevisFromContrat(contrat, {
        userId: currentUser.uid,
        client,
        companyId: company?.id,
        companyNom: company?.nom,
      })
      const ref = await createFacture(payload)
      router.push(`/facturation/${ref.id}`)
    } catch (e) {
      console.error('[generateDevis]', e)
      setGenDevis(false)
    }
  }
  const { settings, saveSettings, loading: settingsLoading } = usePilotageSettings()
  // Étapes-types du planning (liste déroulante, persistées dans pilotage_settings et éditables)
  const etapesTypes = settings?.planningEtapes ?? DEFAULT_PLANNING_ETAPES
  const [etapesDraft, setEtapesDraft] = useState<string[] | null>(null)
  const etapesManaged = etapesDraft ?? etapesTypes
  const saveEtapes = () => { saveSettings({ planningEtapes: etapesManaged }); setEtapesDraft(null) }
  // Modèle de planning : génération en un clic + enregistrement du planning courant comme modèle
  const planningTemplate = settings?.planningTemplate?.length ? settings.planningTemplate : DEFAULT_PLANNING_TEMPLATE
  const [genConfirm, setGenConfirm] = useState(false)
  const [modeleSaved, setModeleSaved] = useState(false)
  const [showAjout, setShowAjout] = useState(false)   // onglet Tâches : afficher le formulaire d'ajout
  const todayStr = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
  const doGenerate = () => { updP({ planning: generatePlanningFromTemplate(planningTemplate, todayStr()) }); setGenConfirm(false) }
  const onGenerate = () => { if (formProjet.planning.length > 0) setGenConfirm(true); else doGenerate() }
  const savePlanningModele = () => { saveSettings({ planningTemplate: formProjet.planning.map((s) => ({ ...s, date: '', ancre: undefined })) }); setModeleSaved(true); setTimeout(() => setModeleSaved(false), 2000) }

  const [tab, setTab] = useState<TabKey>('documents')
  const [editing, setEditing] = useState(false)
  // Espace client (portail public par lien)
  const [portalCopied, setPortalCopied] = useState(false)
  // Lien remis au client → domaine de l'ESPACE ACTIF (cf. publicLinkOrigin), pas celui de navigation.
  const portalLink = (typeof window !== 'undefined' && contrat?.portalToken)
    ? `${publicLinkOrigin(brand, window.location.origin)}/espace/${contrat.portalToken}` : ''
  const activatePortal = () => {
    if (!contrat) return
    updateContrat(contrat.id, { portalToken: randomUUID().replace(/-/g, '') } as Partial<PilotageContrat>)
      .catch((e) => console.error('[portail activer]', e))
  }
  const regeneratePortal = () => {
    if (!contrat) return
    if (!confirm('Régénérer le lien ? L\'ancien lien cessera de fonctionner immédiatement.')) return
    updateContrat(contrat.id, { portalToken: randomUUID().replace(/-/g, '') } as Partial<PilotageContrat>)
      .catch((e) => console.error('[portail régénérer]', e))
  }
  const copyPortalLink = async () => {
    if (!portalLink) return
    const ok = await copyText(portalLink)
    if (ok) { setPortalCopied(true); setTimeout(() => setPortalCopied(false), 2000) }
    else window.prompt('Copiez le lien ci-dessous :', portalLink)
  }
  const [formProjet, setFormProjet] = useState<ProjetContent>(defaultProjetContent())
  const [formLegal, setFormLegal] = useState<LegalFields>(defaultLegalFields())
  const [formCharte, setFormCharte] = useState<ChartGraphique>(defaultCharte())
  // Liste unifiée « hors périmètre / options » : éditée d'un bloc, répartie à la sauvegarde
  // (exclusions → projet.horsPerimetre · options → optionsDevis). Sorties inchangées.
  const [formPerimetre, setFormPerimetre] = useState<PerimetreItem[]>([])
  // Persistance d'une ligne ajoutée / modifiée (« Terminer ») / supprimée / réordonnée.
  const persistPerimetre = (next: PerimetreItem[]) => {
    setFormPerimetre(next)
    const { horsPerimetre, options } = splitPerimetre(next)
    setFormProjet((p) => ({ ...p, horsPerimetre }))
    if (contrat) updateContrat(contrat.id, { 'projet.horsPerimetre': horsPerimetre, optionsDevis: options } as unknown as Partial<PilotageContrat>)
      .catch((e) => console.error('[perimetre persist]', e))
  }
  // Textes du devis (objet + descriptions de lignes) — édités librement, persistés au blur.
  const [devisObjet, setDevisObjet] = useState('')
  const [devisMes, setDevisMes] = useState('')   // description « Mise en service »
  const [devisAbo, setDevisAbo] = useState('')   // description « Abonnement mensuel »
  const persistDevisTexte = (patch: Partial<Pick<PilotageContrat, 'objetDevis' | 'miseEnServiceDesc' | 'abonnementDesc'>>) => {
    if (contrat) updateContrat(contrat.id, patch as Partial<PilotageContrat>).catch((e) => console.error('[devis textes persist]', e))
  }
  // Quota d'hébergement (alimente la modalité auto « Hébergement & quotas »).
  const [hebUsers, setHebUsers] = useState('')
  const [hebDepass, setHebDepass] = useState('')
  const persistHebergement = () => {
    if (!contrat) return
    const utilisateursInclus = hebUsers.trim() === '' ? undefined : Number(hebUsers)
    updateContrat(contrat.id, { hebergement: { utilisateursInclus, depassement: hebDepass.trim() } } as Partial<PilotageContrat>)
      .catch((e) => console.error('[hebergement persist]', e))
  }
  // Remise (tarif d'ami / partenaire) : réglée dans le calculateur (estimation), reportée au contrat via « aligner ».
  // Estimateur de coûts d'infra : on enregistre les entrées + le coût mensuel central sur le contrat.
  const persistInfra = (inputs: InfraInputs, central: number) => {
    if (!contrat) return
    updateContrat(contrat.id, { coutFirebaseInputs: inputs, coutFirebaseMensuel: Math.round(central) } as Partial<PilotageContrat>)
      .catch((e) => console.error('[infra persist]', e))
  }
  // Section « Évolution » (bloc structuré optionnel, ex : revente) — édité localement, persisté au clic.
  const [formEvolution, setFormEvolution] = useState<DevisEvolution>({})
  const [evolutionSaved, setEvolutionSaved] = useState(false)
  const [evolutionDefSaved, setEvolutionDefSaved] = useState(false)
  const [evolutionClearing, setEvolutionClearing] = useState(false)
  // Efface toute la section Évolution de CE contrat (les modèles par défaut restent).
  const clearEvolution = () => {
    setFormEvolution({})
    if (contrat) updateContrat(contrat.id, { evolution: {} } as Partial<PilotageContrat>).catch((e) => console.error('[evolution clear]', e))
    setEvolutionClearing(false)
  }
  const saveEvolution = () => {
    if (!contrat) return
    updateContrat(contrat.id, { evolution: formEvolution } as Partial<PilotageContrat>).catch((e) => console.error('[evolution persist]', e))
    setEvolutionSaved(true); setTimeout(() => setEvolutionSaved(false), 2000)
  }
  // Charge le modèle (le tien enregistré, sinon le générique de départ) dans l'éditeur — à adapter puis enregistrer.
  const loadEvolutionTemplate = () => setFormEvolution(settings?.evolutionDefault ?? DEFAULT_EVOLUTION)
  const saveEvolutionDefault = () => {
    saveSettings({ evolutionDefault: formEvolution })
    setEvolutionDefSaved(true); setTimeout(() => setEvolutionDefSaved(false), 2000)
  }
  // Bandeau « valeur » : contenu auto depuis l'estimation, simplement masquable.
  const bannerAuto = useMemo(() => (contrat ? buildValeurBannerAuto(contrat) : null), [contrat])
  const [bannerMasque, setBannerMasque] = useState(false)
  const persistBannerMasque = (masque: boolean) => {
    setBannerMasque(masque)
    if (contrat) updateContrat(contrat.id, { valeurBannerOverride: { masque } } as Partial<PilotageContrat>)
      .catch((e) => console.error('[banner masque persist]', e))
  }
  const [newDocType, setNewDocType] = useState<PilotageDocumentType>('cahier_charges')
  const [signDoc, setSignDoc] = useState<PilotageDocument | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>('idle')
  const hydratedFor = useRef<string | null>(null)

  const updP = (patch: Partial<ProjetContent>) => setFormProjet((p) => ({ ...p, ...patch }))
  const updL = (k: keyof LegalFields, v: string) => setFormLegal((f) => ({ ...f, [k]: v }))
  // Enregistre les champs « policy » courants comme valeurs par défaut des futurs contrats.
  const [legalDefSaved, setLegalDefSaved] = useState(false)
  const saveLegalDefaults = () => {
    const keys: (keyof LegalFields)[] = ['duree', 'etendueDroits', 'exclusivite', 'territoire', 'ajustementsInclus', 'reconduction', 'finalites', 'donneesTraitees', 'personnesConcernees', 'dureeConservation', 'sousTraitantsUlterieurs']
    const defs: Record<string, string> = {}
    for (const k of keys) { const v = (formLegal[k] ?? '').trim(); if (v) defs[k] = v }
    saveSettings({ legalDefaults: defs })
    setLegalDefSaved(true); setTimeout(() => setLegalDefSaved(false), 2000)
  }
  // Taux horaire (TJM ÷ 7) — TJM saisi sur le contrat en priorité, sinon estimation rattachée, sinon réglage global
  const tauxHoraire = tauxHoraireFromTjm(contrat?.tjm ?? contrat?.estimation?.tjm ?? settings?.tjm ?? 500)
  const aFacturer = (formProjet.taches ?? []).filter((t) => t.facturation === 'facturer' && !t.facturee)
  const totalAFacturer = aFacturer.reduce((s, t) => s + (prixFacture(t, tauxHoraire) ?? 0), 0)
  const aujourdhui = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()
  const enRetard = (formProjet.taches ?? []).filter((t) => estEnRetard(t, aujourdhui))

  // (Ré)initialise les formulaires depuis le contrat enregistré (prestataire = société, client = fiche client, puis sauvegardé)
  const resetForms = useCallback(() => {
    if (!contrat) return
    const cli = clients.find((x) => x.id === contrat.clientId)
    const clientAdresse = cli?.adresseEntreprise || [cli?.adresse, cli?.codePostal, cli?.ville].filter(Boolean).join(', ')
    const clientRepresentant = cli?.representantEntreprise || [cli?.prenom, cli?.nom].filter(Boolean).join(' ').trim()
    const prestaAdresse = [company?.adresse, company?.codePostal, company?.ville].filter(Boolean).join(', ')
    // Date des documents = celle du DEVIS lié (figée à sa création) → cohérence devis ↔ contrats.
    // À défaut de devis lié, date du jour. Comme le prix, elle n'est PAS reprise du snapshot sauvegardé.
    const linkedDevis = invoices.find((f) => f.id === contrat.devisId) ?? invoices.find((f) => f.contratId === contrat.id && f.type === 'devis')
    const devisTs = linkedDevis ? (linkedDevis.date ?? linkedDevis.createdAt) : null
    const docDateStr = devisTs?.seconds ? new Date(devisTs.seconds * 1000).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR')
    const prefill = defaultLegalFields({
      prestataireNom: company?.nom || 'Enezo',
      prestataireSiret: company?.siret || '',
      prestataireAdresse: prestaAdresse,
      prestataireEmail: company?.email || 'contact@enezo.fr',
      prestataireTel: company?.telephone || '+33 6 79 40 82 54',
      prestataireRepresentant: company?.representant || '',
      clientNom: cli?.nomEntreprise || contrat.clientNom || '',
      clientAdresse,
      clientSiret: cli?.siret || '',
      clientRepresentant,
      date: docDateStr,
      // Prix NET réellement facturé (catalogue − remise) → cohérent avec le devis, pas le tarif catalogue.
      prixCreation: contrat.fraisMiseEnPlace != null ? String(Math.round(contrat.fraisMiseEnPlace * (1 - (contrat.remiseMiseEnPlacePct ?? 0) / 100))) : '',
      prixAbo: contrat.abonnementMensuel != null ? String(Math.round(contrat.abonnementMensuel * (1 - (contrat.remiseAbonnementPct ?? 0) / 100))) : '',
    })
    // Valeurs par défaut de l'utilisateur (réglages) : remplissent les champs « policy »
    // encore vides (durée, droits, exclusivité, RGPD…), sans écraser Société/client/prix.
    const defs = settings?.legalDefaults
    if (defs) for (const k of Object.keys(defs)) {
      const kk = k as keyof LegalFields
      if (!(prefill[kk] ?? '').trim() && defs[k]?.trim()) prefill[kk] = defs[k]
    }
    const saved = contrat.legal
    // ⚠️ prixCreation/prixAbo sont TOUJOURS recalculés du contrat (net, ci-dessus) — on n'applique
    // jamais l'ancien snapshot figé de contrat.legal, sinon un vieux tarif resterait collé au document.
    if (saved) for (const k of Object.keys(saved) as (keyof LegalFields)[]) {
      if (k === 'prixCreation' || k === 'prixAbo' || k === 'date') continue   // toujours recalculés (prix net + date du devis)
      if (saved[k]) prefill[k] = saved[k]
    }
    setFormLegal(prefill)
    setFormProjet(contrat.projet ? defaultProjetContent(contrat.projet) : defaultProjetContent())
    setFormCharte(contrat.charte ? defaultCharte(contrat.charte) : defaultCharte())
    setFormPerimetre(buildPerimetre(contrat))
    setDevisObjet(contrat.objetDevis ?? '')
    setDevisMes(contrat.miseEnServiceDesc ?? '')
    setDevisAbo(contrat.abonnementDesc ?? '')
    setHebUsers(contrat.hebergement?.utilisateursInclus != null ? String(contrat.hebergement.utilisateursInclus) : '')
    setHebDepass(contrat.hebergement?.depassement ?? '')
    setBannerMasque(contrat.valeurBannerOverride?.masque ?? false)
    setFormEvolution(contrat.evolution ?? {})
  }, [contrat, clients, company, settings, invoices])

  // Onglet initial depuis ?tab=… (lu côté client pour éviter une frontière Suspense)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey)
  }, [])

  // Hydrate les formulaires une fois le contrat ET les réglages chargés (pour appliquer les défauts légaux)
  useEffect(() => {
    if (!contrat || settingsLoading || invoicesLoading || hydratedFor.current === contrat.id) return
    resetForms()
    hydratedFor.current = contrat.id
  }, [contrat, resetForms, settingsLoading, invoicesLoading])

  // Changement d'onglet : retour en lecture seule, on annule les modifications non enregistrées
  const goTab = (k: TabKey) => { setEditing(false); resetForms(); setTab(k) }
  const cancelEdit = () => { resetForms(); setEditing(false) }

  const save = async () => {
    if (!contrat) return
    setSaveState('saving')
    try {
      await updateContrat(contrat.id, { projet: formProjet, legal: formLegal, charte: formCharte })
      setEditing(false)
      setSaveState('done'); setTimeout(() => setSaveState('idle'), 2000)
    } catch (e) { console.error('[contrat save]', e); setSaveState('idle') }
  }

  // Édition/suppression d'une seule ligne depuis la lecture seule : on met à jour et on enregistre tout de suite.
  const persistProjet = async (patch: Partial<ProjetContent>) => {
    const next = { ...formProjet, ...patch }
    setFormProjet(next)
    if (contrat) { try { await updateContrat(contrat.id, { projet: next }) } catch (e) { console.error('[contrat persist]', e) } }
  }

  // Un seul document de chaque type par contrat : on masque les types déjà créés.
  const usedTypes = useMemo(() => new Set(documents.map((d) => d.type)), [documents])
  const availableDocTypes = useMemo(() => PILOTAGE_DOC_TYPES.filter((t) => !usedTypes.has(t.value)), [usedTypes])
  // Garde le type sélectionné valide (parmi ceux encore disponibles)
  useEffect(() => {
    if (availableDocTypes.length === 0) return
    if (!availableDocTypes.some((t) => t.value === newDocType)) setNewDocType(availableDocTypes[0].value)
  }, [availableDocTypes, newDocType])

  const createDoc = async () => {
    if (!contrat || usedTypes.has(newDocType)) return
    const meta = PILOTAGE_DOC_TYPES.find((t) => t.value === newDocType)
    await addDocument({
      contratId: contrat.id,
      clientNom: contrat.clientNom ?? '',
      type: newDocType,
      titre: `${meta?.label ?? 'Document'}${contrat.clientNom ? ' — ' + contrat.clientNom : ''}`,
      version: '1.0',
      statut: 'brouillon',
    } as Omit<PilotageDocument, 'id' | 'createdAt'>)
  }

  // ── PDF : génération → stockage Storage → ouverture/téléchargement ──
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [delDoc, setDelDoc] = useState<PilotageDocument | null>(null)

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  // Génère le PDF, le stocke sur le contrat, et pose l'instantané de rendu (renderSnapshot)
  // pour que l'espace client puisse régénérer le document À L'IDENTIQUE en y ajoutant la
  // signature du client. `download` = téléchargement immédiat (génération manuelle) ou non (régénération silencieuse).
  const buildAndStorePdf = async (d: PilotageDocument, download: boolean) => {
    if (!currentUser) return
    const { blob, filename } = await generatePilotageDocPdf(d, { company, projet: formProjet, legal: formLegal, charte: formCharte, options: splitPerimetre(formPerimetre).options, version: contrat?.version })
    const url = await uploadBlob(blob, `users/${currentUser.uid}/pilotage_pdf/${d.contratId}/${d.id}.pdf`)
    await updateDocument(d.id, {
      pdfUrl: url, pdfNom: filename, pdfGeneeLe: Timestamp.now(),
      pdfReflectsSignature: true,
      renderSnapshot: { legal: formLegal as unknown as Record<string, unknown>, projetContexte: formProjet?.contexte ?? '' },
    })
    if (download) triggerDownload(blob, filename)
  }

  // Génère (ou régénère) le PDF, le stocke sur le contrat et le télécharge.
  const genererPdf = async (d: PilotageDocument) => {
    if (!currentUser) return
    setPdfBusy(d.id)
    try { await buildAndStorePdf(d, true) }
    catch (e) { console.error('[pilotage pdf]', e) }
    setPdfBusy(null)
  }

  // Régénère silencieusement la copie stockée d'un document que le CLIENT vient de signer
  // depuis son espace : le PDF signé du client est produit dans SON navigateur ; ici on met à
  // jour la copie de référence (avec les 2 signatures) à ta prochaine ouverture du contrat.
  const regenDone = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!currentUser || !contrat || hydratedFor.current !== contrat.id) return
    for (const d of documents) {
      if (d.clientSigne && d.pdfReflectsSignature === false && !regenDone.current.has(d.id)) {
        regenDone.current.add(d.id)
        buildAndStorePdf(d, false).catch((e) => console.error('[pilotage regen]', e))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, contrat, documents])

  // Ouvre le PDF déjà stocké, sans en régénérer un.
  const ouvrirPdf = (d: PilotageDocument) => { if (d.pdfUrl) window.open(d.pdfUrl, '_blank', 'noopener,noreferrer') }

  // Suppression d'un document (après confirmation) : enlève aussi PDF + signature du Storage.
  const confirmDeleteDoc = async () => {
    const target = delDoc
    if (!target) return
    setDelDoc(null)
    try {
      await Promise.all([target.pdfUrl, target.signatureUrl].filter(Boolean).map((u) => deleteImage(u as string)))
      await deleteDocument(target.id)
    } catch (e) { console.error('[pilotage doc delete]', e) }
  }

  const handleSign = async (dataUrl: string) => {
    if (!signDoc || !currentUser) return
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const url = await uploadBlob(blob, `users/${currentUser.uid}/pilotage_signatures/${signDoc.id}.png`)
      await updateDocument(signDoc.id, { signe: true, statut: 'signe', signeLe: Timestamp.now(), signatureUrl: url })
    } catch (e) { console.error('[pilotage sign]', e) }
    setSignDoc(null)
  }

  // Upload d'un fichier de charte (logo, image…) vers Storage
  const uploadCharteFile = async (file: File) => {
    if (!currentUser || !contrat) throw new Error('Contexte manquant')
    const safe = file.name.replace(/[^a-z0-9._-]/gi, '_')
    const url = await uploadBlob(file, `users/${currentUser.uid}/pilotage_charte/${contrat.id}/${Date.now()}-${safe}`)
    return { name: file.name, url }
  }

  // ── Onglet Calculateur : plusieurs estimations nommées + sélection « validée » ──
  const [estEditingId, setEstEditingId] = useState<string | null>(null) // null = liste ; 'new' ou id = édition
  const [estLabel, setEstLabel] = useState('')
  const [estSeed, setEstSeed] = useState<PilotageEstimation | null>(null)
  const [estLive, setEstLive] = useState<{ est: PilotageEstimation; tarif: TarifResult } | null>(null)
  const [delEstId, setDelEstId] = useState<string | null>(null)

  const estimations: SavedEstimation[] = contrat?.estimations ?? []
  const estSelectedId = contrat?.estimationSelectedId ?? null
  // Synchronise les Fonctionnalités du projet DEPUIS le calculateur (briques de l'estimation
  // sélectionnée) : catégorie = groupe catalogue, description = libellé client (sinon nom).
  const [foncSynced, setFoncSynced] = useState(false)
  const [foncPushed, setFoncPushed] = useState(false)
  const syncFonctionsFromCalc = async () => {
    const selEst = contrat?.estimations?.find((e) => e.id === estSelectedId) ?? contrat?.estimations?.[0] ?? contrat?.estimation
    if (!selEst?.features?.length) return
    await persistProjet({ fonctionnalites: featuresToFonctions(selEst.features, catalogueItems) })
    setFoncSynced(true); setTimeout(() => setFoncSynced(false), 2000)
  }
  // Push inverse : copie les Fonctionnalités du projet DANS l'estimation sélectionnée (briques du calculateur).
  // Préserve nom/durée des briques dont le libellé matche ; nouvelles en taille 'm'. Visible au prochain
  // affichage du calculateur (il s'hydrate depuis l'estimation enregistrée).
  const pushFonctionsToCalc = async () => {
    if (!contrat) return
    const ests = contrat.estimations ?? []
    const sel = ests.find((e) => e.id === estSelectedId) ?? ests[0] ?? contrat.estimation
    if (!sel) return  // pas d'estimation cible : créer un chiffrage d'abord depuis l'onglet Calculateur
    const existingAsFeatures = (sel.features ?? []).map((e, i) => ({ id: String(i), ...e }))
    const newFeatures = fonctionsToFeatures(formProjet.fonctionnalites, existingAsFeatures).map(({ id: _id, ...rest }) => rest)
    const updatedEst = { ...sel, features: newFeatures }
    const patch = ests.some((e) => e.id === sel.id)
      ? { estimations: ests.map((e) => (e.id === sel.id ? updatedEst : e)) }
      : { estimation: updatedEst }
    try { await updateContrat(contrat.id, patch as Partial<PilotageContrat>); setFoncPushed(true); setTimeout(() => setFoncPushed(false), 2000) }
    catch (e) { console.error('[push fonctions→calc]', e) }
  }

  // Migration douce : ancienne estimation unique → liste (une seule fois)
  const migratedEst = useRef(false)
  useEffect(() => {
    if (migratedEst.current || !contrat) return
    if (!contrat.estimations && contrat.estimation) {
      migratedEst.current = true
      const id = randomUUID()
      updateContrat(contrat.id, {
        estimations: [{ id, label: 'Estimation initiale', ...contrat.estimation }],
        estimationSelectedId: contrat.estimationSelectedId ?? id,
      } as Partial<PilotageContrat>).catch((e) => console.error('[pilotage est migrate]', e))
    }
  }, [contrat])

  const newEst = () => { setEstEditingId('new'); setEstLabel(''); setEstSeed(null); setEstLive(null) }
  const editEst = (e: SavedEstimation) => { setEstEditingId(e.id); setEstLabel(e.label); setEstSeed(e); setEstLive(null) }
  const cancelEst = () => { setEstEditingId(null); setEstLive(null) }

  const saveEst = async () => {
    if (!contrat || !estLive) return
    const label = estLabel.trim() || `Estimation ${estimations.length + 1}`
    let next: SavedEstimation[]
    let selId = estSelectedId
    if (estEditingId === 'new') {
      const id = randomUUID()
      next = [...estimations, { id, label, ...estLive.est }]
      if (!selId) selId = id   // première estimation → validée par défaut
    } else {
      next = estimations.map((e) => (e.id === estEditingId ? { id: e.id, label, ...estLive.est } : e))
    }
    try {
      await updateContrat(contrat.id, { estimations: next, estimationSelectedId: selId ?? null } as Partial<PilotageContrat>)
      setEstEditingId(null); setEstLive(null)
    } catch (e) { console.error('[pilotage est save]', e) }
  }

  // « Valider » : ne change QUE le TJM du contrat (utilisé pour le prix des tâches à facturer)
  const validerEst = async (e: SavedEstimation) => {
    if (!contrat) return
    try { await updateContrat(contrat.id, { estimationSelectedId: e.id, tjm: e.tjm } as Partial<PilotageContrat>) }
    catch (err) { console.error('[pilotage est select]', err) }
  }

  const confirmDeleteEst = async () => {
    if (!contrat || !delEstId) return
    const id = delEstId; setDelEstId(null)
    const next = estimations.filter((e) => e.id !== id)
    const selId = estSelectedId === id ? (next[0]?.id ?? null) : estSelectedId
    try { await updateContrat(contrat.id, { estimations: next, estimationSelectedId: selId } as Partial<PilotageContrat>) }
    catch (err) { console.error('[pilotage est delete]', err) }
  }

  // Optionnel : aligner les autres chiffres du contrat sur l'estimation validée
  const alignerContrat = async (e: SavedEstimation) => {
    if (!contrat) return
    const t = computeTarif(stateFromEstimation(e))
    try {
      await updateContrat(contrat.id, {
        fraisMiseEnPlace: t.setup, abonnementMensuel: t.abo, coutFirebaseMensuel: e.infra,
        remiseMiseEnPlacePct: e.remiseSetupPct ?? 0, remiseAbonnementPct: e.remiseAboPct ?? 0,
      } as Partial<PilotageContrat>)
    } catch (err) { console.error('[pilotage est align]', err) }
  }

  if (!isAdmin) return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Accès réservé.</p></div>
  if (!contrat) {
    return loading
      ? <div className="text-center py-20 text-gray-400">Chargement…</div>
      : (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">Contrat introuvable.</p>
          <button onClick={() => router.push('/pilotage')} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 px-4 py-2 rounded-lg transition">
            <ArrowLeftIcon className="w-4 h-4" /> Retour au pilotage
          </button>
        </div>
      )
  }

  return (
    <div className="space-y-5 pb-24">
      {/* Modal d'édition du contrat (même composant que la page Pilotage) — édition en place, sans navigation */}
      <ContratEditModal isOpen={showEditModal} onClose={() => setShowEditModal(false)} contrat={contrat} />
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/pilotage')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition shrink-0">
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{contrat.clientNom || 'Contrat'}</h1>
            <p className="text-xs text-gray-400"><span className="font-mono text-gray-500" title="Référence du contrat (commune au devis et aux documents)">Réf {id.slice(0, 8)}</span> · Documents · contenu projet · mentions légales</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowEditModal(true)}
            title="Modifier les infos du contrat (client, tarifs, statut, devis rattachés…)"
            className="flex items-center gap-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition">
            <PencilIcon className="w-4 h-4" /> Modifier
          </button>
          <button onClick={generateDevis} disabled={genDevis}
            title="Crée un devis de prestation pré-rempli depuis ce contrat (objet, lignes, inclus, options, modalités)"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <PlusIcon className="w-4 h-4" /> {genDevis ? 'Génération…' : 'Générer un devis'}
          </button>
        </div>
      </div>

      {/* Repère essentiel / facultatif */}
      <div className="flex items-start gap-2 text-xs text-gray-600 bg-red-50/70 border border-red-100 rounded-lg px-3 py-2">
        <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
        <p>
          Les onglets marqués d'un <span className="text-red-600 font-semibold">point rouge</span> sont l'<strong className="text-red-700">essentiel pour un devis</strong> (client, prix, contenu projet).
          Les autres sont <strong>facultatifs</strong> — brief, planning, mentions (souvent auto-remplis depuis la fiche client et ta Société).
        </p>
      </div>

      {/* Onglets — une seule ligne : défilement latéral sur mobile (desktop : tout tient), reste en place au scroll vertical */}
      <div className="flex flex-nowrap gap-1 border-b border-gray-200 sticky top-0 bg-white z-10 pt-1 overflow-x-auto overflow-y-hidden touch-pan-x overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => goTab(t.key)}
            title={t.essentiel ? 'Essentiel pour un devis' : 'Facultatif'}
            className={`shrink-0 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${tab === t.key ? 'border-blue-600 text-blue-700' : `border-transparent hover:text-gray-700 ${t.essentiel ? 'text-gray-600' : 'text-gray-400'}`}`}>
            {t.essentiel && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />}
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenu de l'onglet */}
      <div className={`bg-white rounded-2xl border shadow-sm p-4 sm:p-5 ${TABS.find((t) => t.key === tab)?.essentiel ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-100'}`}>
        {TABS.find((t) => t.key === tab)?.essentiel && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            <span><strong>Essentiel pour le devis</strong> — à renseigner avec soin.</span>
          </div>
        )}
        {tab === 'documents' && (
          <div className="space-y-4">
            {/* Devis & factures rattachés à ce contrat (généré initial + avenants liés) → accès direct */}
            <div className="border border-gray-200 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-600">Devis &amp; factures de ce contrat</p>
                <button
                  onClick={() => router.push(`/facturation/create?type=devis&clientId=${contrat.clientId ?? ''}&contratId=${id}${contrat.abonnementId ? `&abonnementId=${contrat.abonnementId}` : ''}`)}
                  title="Créer un nouveau devis déjà rattaché à ce contrat (ex. un avenant)"
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition shrink-0">
                  <PlusIcon className="w-3.5 h-3.5" /> Nouveau devis
                </button>
              </div>
              {contratFactures.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {contratFactures.map((f) => (
                    <button key={f.id} onClick={() => router.push(`/facturation/${f.id}`)}
                      className="flex items-center justify-between gap-2 text-left border border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 rounded-lg px-3 py-2 transition">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${f.type === 'devis' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{f.type === 'devis' ? 'Devis' : 'Facture'}</span>
                        <span className="text-sm text-gray-700 truncate">{f.number}</span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{f.total != null ? `${fmtEur(f.total)} ` : ''}›</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400">Aucun devis/facture rattaché pour l'instant.</p>
              )}
              <details className="border-t border-gray-100 pt-2">
                <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 select-none list-none">+ Rattacher un devis déjà préparé</summary>
                <div className="mt-2">
                  <DevisLinkPicker contratId={id} uid={currentUser?.uid ?? ''} clientId={contrat.clientId || undefined} />
                </div>
              </details>
            </div>

            {/* Espace client : lien public où le client consulte et signe ses devis (portail /espace/[token]) */}
            <div className="border border-gray-200 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-600">Espace client (lien à partager)</p>
                {contrat.portalToken && (
                  <button onClick={regeneratePortal}
                    title="Génère un nouveau lien et révoque l'ancien"
                    className="text-[11px] font-medium text-gray-500 hover:text-red-600 transition shrink-0">
                    Régénérer
                  </button>
                )}
              </div>
              {!contrat.portalToken ? (
                <>
                  <p className="text-[11px] text-gray-400">
                    Activez un lien sécurisé que le client ouvre sans compte pour consulter et <strong>signer son devis en ligne</strong>. Vous serez notifié à la signature.
                  </p>
                  <button onClick={activatePortal}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                    Activer l'espace client
                  </button>
                </>
              ) : (
                <>
                  <div className="bg-white border border-blue-100 rounded-lg px-3 py-2 flex items-center gap-2">
                    <p className="text-xs text-gray-600 truncate flex-1">{portalLink}</p>
                    <button onClick={copyPortalLink}
                      className="text-xs font-semibold text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition shrink-0">
                      {portalCopied ? 'Copié !' : 'Copier'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`sms:?body=${encodeURIComponent(`Voici le lien pour consulter et signer votre devis : ${portalLink}`)}`}
                      className="text-xs font-medium text-blue-700 border border-blue-300 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">SMS</a>
                    <a href={`https://wa.me/?text=${encodeURIComponent(`Voici le lien pour consulter et signer votre devis : ${portalLink}`)}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium text-green-700 border border-green-300 bg-white hover:bg-green-50 px-3 py-1.5 rounded-lg transition">WhatsApp</a>
                    <a href={`mailto:?subject=${encodeURIComponent('Votre devis')}&body=${encodeURIComponent(`Bonjour,\n\nVous pouvez consulter et signer votre devis via ce lien :\n${portalLink}\n\nBien à vous.`)}`}
                      className="text-xs font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition">Email</a>
                  </div>
                </>
              )}
            </div>

            {availableDocTypes.length === 0 ? (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                Tous les types de documents ont été créés pour ce contrat. Chaque document n'existe qu'en un seul exemplaire (modifie-le ou régénère son PDF ci-dessous).
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="w-full sm:flex-1 sm:min-w-[180px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type de document</label>
                  <select value={newDocType} onChange={(e) => setNewDocType(e.target.value as PilotageDocumentType)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {(['projet', 'legal'] as const).map((fam) => {
                      const opts = availableDocTypes.filter((t) => t.famille === fam)
                      if (opts.length === 0) return null
                      return (
                        <optgroup key={fam} label={fam === 'projet' ? 'Documents projet' : 'Contrats légaux'}>
                          {opts.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </optgroup>
                      )
                    })}
                  </select>
                </div>
                <button onClick={createDoc}
                  className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition w-full sm:w-auto shrink-0">
                  <PlusIcon className="w-4 h-4" /> Créer
                </button>
              </div>
            )}

            {documents.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">Aucun document pour ce contrat.</div>
            ) : (
              <div className="space-y-2">
                {documents.map((d) => {
                  // PDF obsolète : le contenu du contrat a changé après la dernière génération
                  const pdfStale = !!d.pdfUrl && !!d.pdfGeneeLe && (contrat.updatedAt?.toMillis?.() ?? 0) > d.pdfGeneeLe.toMillis()
                  return (
                  <div key={d.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-xl p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{d.titre}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">v{contrat.version || '1.0'}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          d.statut === 'signe' ? 'bg-green-100 text-green-700'
                            : d.statut === 'finalise' ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-500'
                        }`}>{STATUT_DOC_LABELS[d.statut] ?? d.statut}</span>
                        {d.pdfUrl && !pdfStale && (
                          <span className="text-[10px] text-gray-400">
                            PDF {d.pdfGeneeLe ? 'du ' + new Date(d.pdfGeneeLe.toMillis()).toLocaleDateString('fr-FR') : 'prêt'}
                          </span>
                        )}
                        {pdfStale && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            <ExclamationTriangleIcon className="w-3 h-3" /> Contenu modifié — à régénérer
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!d.signe && (
                        <button onClick={() => setSignDoc(d)} title="Signer"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition">
                          <CheckIcon className="w-4 h-4" />
                        </button>
                      )}
                      {d.pdfUrl ? (
                        <>
                          <button onClick={() => ouvrirPdf(d)} title="Ouvrir le PDF"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                            <EyeIcon className="w-4 h-4" />
                          </button>
                          <button onClick={() => genererPdf(d)} disabled={pdfBusy === d.id} title="Mettre à jour le PDF (régénérer)"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40">
                            <ArrowPathIcon className={`w-4 h-4 ${pdfBusy === d.id ? 'animate-spin' : ''}`} />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => genererPdf(d)} disabled={pdfBusy === d.id} title="Générer le PDF"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition disabled:opacity-40">
                          <ArrowDownTrayIcon className={`w-4 h-4 ${pdfBusy === d.id ? 'animate-pulse' : ''}`} />
                        </button>
                      )}
                      <button onClick={() => setDelDoc(d)} title="Supprimer"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              Les documents projet (cahier des charges, bilan, besoins) partagent le <strong>contenu projet</strong> saisi sous l'onglet dédié. Le logo et les coordonnées viennent de ta société « {company?.nom ?? 'Enezo'} ». Le PDF généré est <strong>conservé</strong> : <strong>Ouvrir</strong> ré-affiche le même fichier, <strong>Mettre à jour</strong> le régénère depuis le contenu actuel (pense à <strong>enregistrer</strong> tes modifications avant).
            </p>
          </div>
        )}

        {tab === 'calculateur' && (
          <div className="space-y-4">
            {estEditingId === null ? (
              <>
                {/* Alerte : l'estimation validée n'est pas alignée avec les chiffres du contrat */}
                {(() => {
                  const sel = estimations.find((e) => e.id === estSelectedId)
                  if (!sel) return null
                  const t = computeTarif(stateFromEstimation(sel))
                  const diffs: string[] = []
                  if ((contrat.fraisMiseEnPlace ?? null) !== t.setup) diffs.push(`création contrat ${contrat.fraisMiseEnPlace != null ? fmtEur(contrat.fraisMiseEnPlace) : '—'} ≠ estimation ${fmtEur(t.setup)}`)
                  if ((contrat.abonnementMensuel ?? null) !== t.abo) diffs.push(`abonnement contrat ${contrat.abonnementMensuel != null ? fmtEur(contrat.abonnementMensuel) : '—'} ≠ estimation ${fmtEur(t.abo)}`)
                  if ((contrat.coutFirebaseMensuel ?? null) !== sel.infra) diffs.push(`coût infra contrat ${contrat.coutFirebaseMensuel != null ? fmtEur(contrat.coutFirebaseMensuel) : '—'} ≠ estimation ${fmtEur(sel.infra)}`)
                  if ((contrat.remiseMiseEnPlacePct ?? 0) !== (sel.remiseSetupPct ?? 0)) diffs.push(`remise création contrat ${contrat.remiseMiseEnPlacePct ?? 0}% ≠ estimation ${sel.remiseSetupPct ?? 0}%`)
                  if ((contrat.remiseAbonnementPct ?? 0) !== (sel.remiseAboPct ?? 0)) diffs.push(`remise abonnement contrat ${contrat.remiseAbonnementPct ?? 0}% ≠ estimation ${sel.remiseAboPct ?? 0}%`)
                  // Signature des chiffres qui définissent l'écart (contrat + estimation sélectionnée).
                  // « Ignorer » la mémorise ; tant qu'elle ne change pas, l'alerte reste masquée. Si un
                  // chiffre bouge (d'un côté ou de l'autre), la signature change → l'alerte réapparaît.
                  const signature = JSON.stringify([
                    contrat.fraisMiseEnPlace ?? null, contrat.abonnementMensuel ?? null, contrat.coutFirebaseMensuel ?? null,
                    contrat.remiseMiseEnPlacePct ?? 0, contrat.remiseAbonnementPct ?? 0,
                    t.setup, t.abo, sel.infra, sel.remiseSetupPct ?? 0, sel.remiseAboPct ?? 0, sel.id,
                  ])
                  if (diffs.length === 0 || contrat.alerteAlignementIgnoree === signature) return null
                  return (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                      <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-800">
                        <p>Le prix du contrat <strong>diffère</strong> de l&apos;estimation validée <strong>« {sel.label} »</strong> — c&apos;est <strong>normal si c&apos;est voulu</strong> (ex. prix « ami » plus bas que la valeur calculée). Pour info :</p>
                        <ul className="list-disc ml-4 mt-1 space-y-0.5 text-amber-700">{diffs.map((d, i) => <li key={i}>{d}</li>)}</ul>
                        <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                          <button onClick={() => alignerContrat(sel)} className="text-[11px] font-medium text-amber-800 underline hover:no-underline">Aligner le contrat sur l&apos;estimation</button>
                          <button onClick={() => updateContrat(contrat.id, { alerteAlignementIgnoree: signature } as Partial<PilotageContrat>).catch((e) => console.error('[masque alerte]', e))}
                            className="text-[11px] font-medium text-amber-700/70 hover:text-amber-800">Ignorer (le prix est voulu différent)</button>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {estimations.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Aucune estimation. Crée-en une pour chiffrer ce contrat — tu peux en enregistrer plusieurs (ex. « client final » et « revendeur ») et comparer.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {estimations.map((e) => {
                      const t = computeTarif(stateFromEstimation(e))
                      const sel = e.id === estSelectedId
                      return (
                        <div key={e.id} className={`rounded-xl p-3 border ${sel ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100'}`}>
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-gray-800">{e.label}</p>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${e.mode === 'revente' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{e.mode === 'revente' ? 'Revendeur' : 'Client final'}</span>
                                {sel && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-600 text-white"><CheckIcon className="w-3 h-3" /> Validée</span>}
                              </div>
                              <p className="text-[11px] text-gray-500 mt-1">
                                TJM <strong>{fmtEur(e.tjm)}</strong> · création <strong>{fmtEur(t.setup)}</strong> · {e.mode === 'revente' ? 'redevance' : 'abonnement'} <strong>{fmtEur(t.abo)}</strong>/mois
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!sel && (
                                <button onClick={() => validerEst(e)} title="Valider (pilote le TJM des tâches)"
                                  className="text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 px-2.5 py-1 rounded-lg transition">Valider</button>
                              )}
                              <button onClick={() => editEst(e)} title="Modifier"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"><PencilIcon className="w-4 h-4" /></button>
                              <button onClick={() => setDelEstId(e.id)} title="Supprimer"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"><TrashIcon className="w-4 h-4" /></button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button onClick={newEst}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                    <PlusIcon className="w-4 h-4" /> Nouvelle estimation
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  <strong>Valider</strong> une estimation fixe le <strong>TJM</strong> utilisé pour chiffrer les tâches « à facturer ». Les autres chiffres du contrat (frais, abonnement, infra) ne changent pas automatiquement — une alerte s'affiche s'ils diffèrent.
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l'estimation</label>
                  <input value={estLabel} onChange={(e) => setEstLabel(e.target.value)} placeholder="ex : Client final, Revendeur…"
                    className="w-full sm:max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <EstimateurTarif
                  key={estEditingId}
                  initial={estSeed}
                  defaults={settings}
                  projetFonctions={formProjet.fonctionnalites}
                  onCopyToFonctions={(feats) => persistProjet({ fonctionnalites: featuresToFonctions(feats, catalogueItems) })}
                  onChange={(est, t) => setEstLive({ est, tarif: t })}
                  footer={(
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={cancelEst}
                        className="text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-1.5 rounded-lg transition">Annuler</button>
                      <button onClick={saveEst} disabled={!estLive}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition">
                        <CheckIcon className="w-4 h-4" /> {estEditingId === 'new' ? 'Enregistrer l\'estimation' : 'Enregistrer les modifications'}
                      </button>
                    </div>
                  )}
                />
              </div>
            )}

            {/* Remise : désormais réglée DANS le calculateur (estimation), reportée sur le devis via « Aligner ». */}
            <div className="border-t border-gray-200 pt-4 mt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Remise <span className="font-normal normal-case text-gray-400">(tarif d'ami / partenaire)</span></h3>
              {(() => {
                const sel = estimations.find((e) => e.id === estSelectedId)
                const eRS = sel?.remiseSetupPct ?? 0
                const eRA = sel?.remiseAboPct ?? 0
                return (
                  <p className="text-[11px] text-gray-400">
                    La remise se règle <strong>dans le calculateur</strong> (champs « Remise création / abonnement »), avec le comparatif complet « sans remise → après remise ».
                    {sel
                      ? <> Estimation validée « {sel.label} » : <strong>{eRS}%</strong> sur la création · <strong>{eRA}%</strong> sur l&apos;abonnement.</>
                      : <> Valide une estimation pour la définir.</>}
                    {' '}Elle n&apos;arrive sur le <strong>devis PDF</strong> que quand tu utilises « Aligner » (l&apos;alerte au-dessus de la liste, uniquement s&apos;il y a un écart).
                  </p>
                )
              })()}
            </div>

            {/* Coûts d'infra + quota d'hébergement — tout au même endroit */}
            <div className="border-t border-gray-200 pt-4 mt-2 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Coûts d'infrastructure & quota d'hébergement</h3>
              <div className="flex items-start gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <span className="shrink-0 mt-0.5">💡</span>
                <p>Règle pour fixer ton quota sans te faire avoir : ton <strong>abonnement doit couvrir l&apos;infra ×3 à ×5</strong> au niveau du quota inclus. <strong>Sous ~50 utilisateurs, c&apos;est quasi gratuit</strong> chez Firebase → inclus un quota généreux sans risque ; le « au-delà » te protège pour la suite.</p>
              </div>
              <InfraCostEstimator key={contrat.id} initial={contrat.coutFirebaseInputs ?? settings?.coutFirebaseInputs} onCommit={persistInfra} />
              <div className="border border-gray-200 rounded-xl p-3">
                <p className="text-xs font-medium text-gray-600 mb-1">Quota d&apos;hébergement inclus <span className="font-normal text-gray-400">(modalité auto du devis)</span></p>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-gray-500">Utilisateurs inclus</label>
                  <input type="number" value={hebUsers} onChange={(e) => setHebUsers(e.target.value)} onBlur={persistHebergement}
                    placeholder={formCharte.usersMax != null ? String(formCharte.usersMax) : 'ex : 100'}
                    className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-[11px] text-gray-400">vide = « utilisateurs max » de la Charte</span>
                </div>
                <label className="block text-xs text-gray-500 mt-2 mb-1">Au-delà du quota</label>
                <textarea value={hebDepass} onChange={(e) => setHebDepass(e.target.value)} onBlur={persistHebergement}
                  rows={2} placeholder="ex : facturé 30 €/mois par tranche de 50 utilisateurs supplémentaires"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
                <p className="text-[11px] text-gray-400 mt-1">Modalité générée : « L&apos;abonnement inclut l&apos;hébergement (jusqu&apos;à X utilisateurs). Au-delà, … ». Vide = refacturation au réel par défaut.</p>
              </div>
            </div>
          </div>
        )}

        {tab === 'projet' && (
          <div className="space-y-4">
            <details open className="border border-gray-200 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 select-none">Contenu du projet</summary>
              <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
            <EditBar editing={editing} onEdit={() => setEditing(true)} onCancel={cancelEdit} onSave={save} saveState={saveState} />
            {editing ? (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Contexte / objet du projet</p>
                  <p className="text-[11px] text-gray-400 mb-2">En 1-2 phrases, ce que tu réalises pour le client. Sert aussi d'<strong>objet</strong> dans les documents légaux (plus besoin de le ressaisir ailleurs).</p>
                  <textarea rows={3} value={formProjet.contexte} onChange={(e) => updP({ contexte: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fonctionnalités</p>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={syncFonctionsFromCalc}
                        title="Remplace cette liste par les briques du calculateur (catégorie + libellé client + durée)"
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition shrink-0">
                        {foncSynced ? '✓ Repris' : '↓ Reprendre du calculateur'}
                      </button>
                      <button type="button" onClick={pushFonctionsToCalc}
                        title="Copie ces fonctionnalités dans les briques du calculateur (durée moyenne par défaut pour les nouvelles, à rechiffrer)"
                        className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900 transition shrink-0">
                        {foncPushed ? '✓ Copié' : '↑ Copier vers le calculateur'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-2">Ce que l'app <em>fait</em>. Édite ici, ou échange avec le <strong>calculateur</strong> dans les deux sens (les boutons à droite).</p>
                  <FonctionsEditor items={formProjet.fonctionnalites} onChange={(v) => updP({ fonctionnalites: v })} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Livrables</p>
                  <p className="text-[11px] text-gray-400 mb-2">Ce que le client <strong>reçoit concrètement</strong> (≠ fonctionnalités).</p>
                  <StringListEditor items={formProjet.livrables} onChange={(v) => updP({ livrables: v })} placeholder="Livrable…" reorderable />
                </div>
              </div>
            ) : (
              <ProjetApercu projet={formProjet} only={['contexte', 'fonctionnalites', 'livrables']} />
            )}
              </div>
            </details>

            {/* Textes du devis : objet + descriptions de lignes (générés auto si vides) */}
            <details className="border border-gray-200 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 select-none">
                Textes du devis
                <span className="ml-1 text-xs text-gray-400">— objet &amp; descriptions (auto si vides)</span>
              </summary>
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Objet du devis</label>
                  <textarea value={devisObjet} onChange={(e) => setDevisObjet(e.target.value)}
                    onBlur={() => persistDevisTexte({ objetDevis: devisObjet.trim() })}
                    rows={4} placeholder={buildObjetAuto(contrat)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
                  <p className="text-[11px] text-gray-400 mt-1">Décrit l'offre vendue (pas le contexte/besoin du client). Vide = phrase générée automatiquement (affichée en gris).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description « Mise en service »</label>
                  <textarea value={devisMes} onChange={(e) => setDevisMes(e.target.value)}
                    onBlur={() => persistDevisTexte({ miseEnServiceDesc: devisMes.trim() })}
                    rows={3} placeholder={(formProjet.livrables ?? []).filter((l) => l.trim()).join(' · ') || 'Vide = liste des livrables du projet'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
                  <p className="text-[11px] text-gray-400 mt-1">Vide = vos livrables (ci-dessus) collés bout à bout.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description « Abonnement mensuel »</label>
                  <textarea value={devisAbo} onChange={(e) => setDevisAbo(e.target.value)}
                    onBlur={() => persistDevisTexte({ abonnementDesc: devisAbo.trim() })}
                    rows={3} placeholder="Hébergement, maintenance corrective, support et petites évolutions. Engagement initial de 12 mois, reconductible."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
                  <p className="text-[11px] text-gray-400 mt-1">Vide = texte standard hébergement &amp; maintenance.</p>
                </div>

                {/* Bandeau « valeur » (ROI) — masquable (contenu auto depuis l'estimation) */}
                <div className="border-t border-gray-100 pt-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                    <input type="checkbox" checked={bannerMasque} onChange={(e) => persistBannerMasque(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    Masquer le bandeau « valeur » sur le devis
                  </label>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {bannerMasque
                      ? 'Le bandeau ne sera pas affiché sur le devis.'
                      : bannerAuto
                        ? `Affiché automatiquement depuis l'estimation validée (${bannerAuto.montant}). Coche pour le retirer.`
                        : 'Aucune estimation validée → aucun bandeau ne sera affiché de toute façon.'}
                  </p>
                </div>
              </div>
            </details>

            {/* Liste unifiée : hors périmètre (→ cahier des charges) + options (→ devis) */}
            <details className="border border-gray-200 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 select-none">
                Hors périmètre &amp; options du devis
                <span className="ml-1 text-xs text-gray-400">({formPerimetre.length})</span>
              </summary>
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="shrink-0 mt-0.5">💡</span>
                  <div>
                    <p><strong>Option</strong> = ce que tu proposes de <strong>vendre en plus</strong> (avec prix → devis + cahier des charges). <strong>Hors périmètre</strong> = ce que tu <strong>exclus pour te protéger</strong> (sans prix → cahier des charges) : ce que le client doit fournir, ce qui n&apos;est pas ton job, ce que tu plafonnes.</p>
                    <p className="mt-1 text-amber-700">Pas de vraie exclusion sur ce projet ? <strong>Laisse vide</strong>, c&apos;est normal — ne transforme pas tout en options (ça fait « menu sans fin » et dévalue ton offre).</p>
                  </div>
                </div>
                <PerimetreEditor items={formPerimetre} onChange={setFormPerimetre} onCommit={persistPerimetre} />
              </div>
            </details>

            {/* Section « Évolution » du devis (bloc structuré optionnel : revente / white-label) */}
            <details className="border border-gray-200 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 select-none">
                Section « Évolution » du devis
                <span className="ml-1 text-xs text-gray-400">— facultatif (revente / white-label)</span>
              </summary>
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={loadEvolutionTemplate}
                    className="text-xs font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition shrink-0">
                    Charger le modèle par défaut
                  </button>
                  <span className="text-[11px] text-gray-400">
                    Pré-remplit avec {settings?.evolutionDefault ? 'ton modèle enregistré' : 'un modèle générique de départ'} — à adapter ensuite.
                  </span>
                </div>
                <EvolutionEditor value={formEvolution} onChange={setFormEvolution} />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button onClick={saveEvolution}
                    className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition shrink-0">
                    <CheckIcon className="w-4 h-4" /> Enregistrer la section
                  </button>
                  <button onClick={saveEvolutionDefault}
                    className="text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition shrink-0">
                    Enregistrer comme modèle par défaut
                  </button>
                  <button onClick={() => setEvolutionClearing(true)}
                    className="text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition shrink-0">
                    Tout effacer
                  </button>
                  {evolutionSaved && <span className="text-[11px] text-emerald-600">✓ Section enregistrée</span>}
                  {evolutionDefSaved && <span className="text-[11px] text-emerald-600">✓ Modèle enregistré</span>}
                </div>
                {evolutionClearing && (
                  <div className="flex flex-wrap items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <span className="text-xs text-red-800">Effacer toute la section « Évolution » de ce devis ? <span className="text-red-600">(les modèles par défaut enregistrés ne sont pas touchés)</span></span>
                    <button onClick={clearEvolution} className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-lg transition">Oui, effacer</button>
                    <button onClick={() => setEvolutionClearing(false)} className="text-xs font-medium text-gray-600 hover:text-gray-800 px-2 py-1 transition">Annuler</button>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {tab === 'fichenego' && <FicheNego contrat={contrat} />}

        {tab === 'charte' && (
          <div className="space-y-4">
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <strong>Facultatif.</strong> Sert de <strong>brief projet</strong> (identité, plateformes, public, couleurs…) — pas nécessaire pour produire un devis. Remplis seulement ce qui t'est utile.
            </div>
            <EditBar editing={editing} onEdit={() => setEditing(true)} onCancel={cancelEdit} onSave={save} saveState={saveState} />
            {editing ? <CharteEditor value={formCharte} onChange={setFormCharte} onUpload={uploadCharteFile} /> : <CharteApercu value={formCharte} />}
          </div>
        )}

        {tab === 'planning' && (
          <div className="space-y-4">
            <EditBar editing={editing} onEdit={() => setEditing(true)} onCancel={cancelEdit} onSave={save} saveState={saveState} />
            {editing ? (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400 mb-2">Le champ « Étape » propose une liste déroulante (tape pour filtrer, ou saisis librement). Pour chaque étape : la <strong>date</strong> = son <strong>début</strong>, et les <strong>jours</strong> = sa <strong>durée</strong> (l'étape suivante démarre donc à cette date + la durée). Saisis une date à la main pour la <strong>fixer</strong>. Réordonne avec les flèches.</p>
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                  {genConfirm ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      Remplacer le planning actuel ?
                      <button type="button" onClick={doGenerate} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1.5 rounded-lg transition">Oui, générer</button>
                      <button type="button" onClick={() => setGenConfirm(false)} className="text-xs font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg transition">Annuler</button>
                    </span>
                  ) : (
                    <button type="button" onClick={onGenerate} className="flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition w-full sm:w-auto">
                      <PlusIcon className="w-3.5 h-3.5" /> Générer un planning type
                    </button>
                  )}
                  <button type="button" onClick={savePlanningModele} className="text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition w-full sm:w-auto">
                    {modeleSaved ? '✓ Modèle enregistré' : 'Enregistrer ce planning comme modèle'}
                  </button>
                </div>
                <PlanningEditor items={formProjet.planning} onChange={(v) => updP({ planning: v })} etapesTypes={etapesTypes} />
                <details className="group pt-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-indigo-700 list-none flex items-center gap-1.5">
                    <span className="inline-block transition group-open:rotate-90">▸</span> Gérer les étapes-types (liste déroulante)
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] text-gray-400">Ces étapes alimentent la liste déroulante du champ « Étape », pour tous tes contrats.</p>
                    <StringListEditor items={etapesManaged} onChange={setEtapesDraft} placeholder="Étape-type…" />
                    {etapesDraft && (
                      <button type="button" onClick={saveEtapes}
                        className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition">
                        Enregistrer la liste
                      </button>
                    )}
                  </div>
                </details>
              </div>
            ) : (
              <PlanningApercu planning={formProjet.planning} onChange={(v) => persistProjet({ planning: v })} etapesTypes={etapesTypes} />
            )}
          </div>
        )}

        {tab === 'legal' && (
          <div className="space-y-4">
            <EditBar editing={editing} onEdit={() => setEditing(true)} onCancel={cancelEdit} onSave={save} saveState={saveState} />
            {editing ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">Modèles types — <strong>à faire valider par un juriste</strong>. Champs vides → « [à compléter] » dans le PDF.</p>
                </div>
                {legalFieldGroupsAll().map((grp) => {
                  const meta = legalGroupMeta(grp.titre)
                  return (
                    <details key={grp.titre} open={meta.open} className="group border border-gray-200 rounded-xl overflow-hidden">
                      <summary className="cursor-pointer list-none flex items-center gap-2.5 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition">
                        <span className="inline-block text-gray-400 transition group-open:rotate-90">▸</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-700">{grp.titre}</span>
                          {meta.sub && <span className="block text-[11px] text-gray-400">{meta.sub}</span>}
                        </span>
                      </summary>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 border-t border-gray-100">
                        {grp.champs.map((ch) => (
                          <div key={ch.key} className={ch.multiline || ch.kind === 'taglist' || ch.kind === 'toggle' ? 'sm:col-span-2' : ''}>
                            {ch.kind === 'toggle' ? (
                              <label className="flex items-start gap-2 cursor-pointer">
                                <input type="checkbox" checked={formLegal[ch.key] === 'oui'}
                                  onChange={(e) => updL(ch.key, e.target.checked ? 'oui' : 'non')}
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="text-[11px] font-medium text-gray-600">{ch.label}</span>
                              </label>
                            ) : (
                              <>
                                <label className="block text-[11px] font-medium text-gray-600 mb-1">{ch.label}</label>
                                {ch.kind === 'taglist' ? (
                                  <TagListField value={formLegal[ch.key] ?? ''} onChange={(v) => updL(ch.key, v)}
                                    placeholder={ch.placeholder} suggestions={ch.suggestions} />
                                ) : (
                                  <AutoTextarea value={formLegal[ch.key] ?? ''} onChange={(v) => updL(ch.key, v)}
                                    placeholder={ch.placeholder} multiline={!!ch.multiline} />
                                )}
                              </>
                            )}
                            {ch.help && <p className="text-[10px] text-gray-400 mt-0.5">{ch.help}</p>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button onClick={saveLegalDefaults}
                    className="text-xs font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition shrink-0">
                    Enregistrer comme valeurs par défaut
                  </button>
                  <span className="text-[11px] text-gray-400">
                    {legalDefSaved
                      ? '✓ Enregistré — pré-remplira les nouveaux contrats'
                      : 'Durée, droits, exclusivité, RGPD… seront repris automatiquement sur tes futurs contrats.'}
                  </span>
                </div>
              </div>
            ) : (
              <LegalApercu legal={formLegal} />
            )}
          </div>
        )}

        {tab === 'taches' && (
          <div className="space-y-4">
            <details className="group bg-indigo-50/50 border border-indigo-100 rounded-xl">
              <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-indigo-800">
                <span className="inline-block text-indigo-400 transition group-open:rotate-90">▸</span> Une demande du client : inclus, maintenance ou à facturer ?
              </summary>
              <div className="px-3 pb-3 text-xs text-indigo-900/80 space-y-1.5">
                <p>✅ <strong>Inclus</strong> (gratuit) : ajustements de la maquette validée, corrections de bugs, retouches mineures dans le périmètre.</p>
                <p>🔧 <strong>Maintenance</strong> (déjà payé via l'abo) : petites évolutions récurrentes, mises à jour techniques, support.</p>
                <p>💶 <strong>À facturer</strong> (en plus) : nouvelle fonctionnalité hors périmètre validé. Mets la pastille « Facturer » sur la tâche + le temps → le prix est proposé, puis facture-la dans ta section <strong>Facturation</strong> et coche « facturée ».</p>
              </div>
            </details>
            {enRetard.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  <strong>{enRetard.length} tâche{enRetard.length > 1 ? 's' : ''} en retard</strong> (échéance dépassée, non terminée). Filtre « En retard » pour les voir, puis avance-les ou décale la date.
                </p>
              </div>
            )}
            {aFacturer.length > 0 && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
                <ExclamationTriangleIcon className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-800">
                  <strong>{aFacturer.length} évolution{aFacturer.length > 1 ? 's' : ''} à facturer</strong>{totalAFacturer > 0 ? <> · ≈ <strong>{totalAFacturer} €</strong></>: null} — pense à les ajouter dans ta section <strong>Facturation</strong>, puis coche « facturée ».
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowAjout((v) => !v)}
                className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition ${showAjout ? 'border border-gray-300 text-gray-600 hover:bg-gray-50' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                {showAjout ? 'Fermer' : <><PlusIcon className="w-4 h-4" /> Ajouter une tâche</>}
              </button>
            </div>
            {showAjout && <TacheAjoutForm items={formProjet.taches} onChange={(v) => persistProjet({ taches: v })} tauxHoraire={tauxHoraire} />}
            <p className="text-[11px] text-gray-400">Modifie chaque tâche directement dans la liste (statut, Moi/Client, date, facturation, terminée…). Les changements sont enregistrés automatiquement.</p>
            <TachesApercu taches={formProjet.taches} onChange={(v) => persistProjet({ taches: v })} tauxHoraire={tauxHoraire} />
          </div>
        )}

        {tab === 'suivi' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-slate-600">
                <strong>Suivis récurrents internes</strong> (non montrés au client) : relevé du quota d'utilisateurs, révision tarifaire annuelle… Les échéances qui approchent (≤ 7 j) ou en retard remontent dans le tableau « À suivre » de la page Pilotage et déclenchent un rappel push.
              </p>
            </div>
            <SuivisPeriodiques
              suivis={contrat?.suivisPeriodiques ?? []}
              anchor={contrat?.dateDebut?.toDate() ?? contrat?.createdAt?.toDate() ?? new Date()}
              onChange={(next) => { if (contrat) updateContrat(contrat.id, { suivisPeriodiques: next }).catch((e) => console.error('[suivis persist]', e)) }}
            />
          </div>
        )}

        {tab === 'apercu' && <ProjetApercu projet={formProjet} only={['contexte', 'fonctionnalites', 'livrables', 'horsPerimetre', 'planning']} />}
      </div>

      {signDoc && (
        <SignaturePad
          title={`Signer — ${signDoc.titre}`}
          subtitle="Dessinez ci-dessous ou importez une image de signature."
          onConfirm={handleSign}
          onCancel={() => setSignDoc(null)}
        />
      )}

      <Modal isOpen={!!delDoc} onClose={() => setDelDoc(null)} title="Supprimer le document" size="sm">
        <p className="text-sm text-gray-600">
          Supprimer définitivement <strong>{delDoc?.titre}</strong> ? Le PDF généré et la signature éventuelle seront aussi effacés. Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setDelDoc(null)}
            className="text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-1.5 rounded-lg transition">Annuler</button>
          <button onClick={confirmDeleteDoc}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-lg transition">
            <TrashIcon className="w-4 h-4" /> Supprimer
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!delEstId} onClose={() => setDelEstId(null)} title="Supprimer l'estimation" size="sm">
        <p className="text-sm text-gray-600">
          Supprimer définitivement l'estimation <strong>{estimations.find((e) => e.id === delEstId)?.label}</strong> ? Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setDelEstId(null)}
            className="text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-1.5 rounded-lg transition">Annuler</button>
          <button onClick={confirmDeleteEst}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-lg transition">
            <TrashIcon className="w-4 h-4" /> Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
