// Mailing — règles métier pures (aucune dépendance Firestore/React).
// Partagé entre le client (import, composeur) et le serveur (désinscription).

import { estCessee, groupeEffectif } from '@/lib/sirene'
import type { MailingMetier, MailingSection, Prospect, ProspectStatut } from '@/types'

/* ------------------------------------------------------------------ */
/* Libellés partagés                                                   */
/* ------------------------------------------------------------------ */

export const STATUT_LABEL: Record<ProspectStatut, string> = {
  a_contacter: 'À contacter',
  envoye: 'Envoyé',
  relance: 'Relancé',
  repondu: 'A répondu',
  interesse: 'Intéressé',
  converti: 'Devenu client',
  pas_interesse: 'Pas intéressé',
  a_un_logiciel: 'Déjà équipé',
  email_manquant: 'Email à trouver',
  oppose: 'Opposition',
  bounce: 'Adresse invalide',
  cessee: "N'existe plus",
}

/** Explication affichée en aide : ces états engagent des conséquences durables. */
export const STATUT_AIDE: Record<ProspectStatut, string> = {
  a_contacter: "Jamais sollicité.",
  envoye: "Premier message parti, en attente de réponse.",
  relance: "Relancé au moins une fois, toujours sans réponse.",
  repondu: "A répondu, sans que ce soit un oui : « rappelez-moi en septembre », une question, un accusé de réception.",
  interesse: "Réponse positive. C'est le moment de le promouvoir en client : la suite se joue dans le CRM, plus dans le mailing.",
  converti: "Rattaché à une fiche client : sa vie se poursuit dans le CRM. Terminus du parcours de prospection.",
  pas_interesse: "A répondu non. On ne le recontacte plus.",
  a_un_logiciel: "Déjà outillé. Pas une perte : c'est le profil qui a la douleur et le budget, à revoir quand son outil le freinera.",
  email_manquant: "Entreprise identifiée via l'INSEE, sans adresse email. À compléter sur la fiche avant tout envoi.",
  oppose: "A demandé à ne plus être contacté (droit d'opposition RGPD). Définitif : l'adresse rejoint le registre et ne peut plus jamais être réimportée.",
  bounce: "Le message est revenu en erreur : adresse inexistante, boîte pleine ou domaine mort. Technique, pas un refus.",
  cessee: "La société n'existe plus : radiée, liquidée, ou reprise sous un autre nom. À distinguer de l'état INSEE, qui n'est connu que pour les prospects enrichis — ici c'est ton constat, il fait foi.",
}

export const STATUT_STYLE: Record<ProspectStatut, string> = {
  a_contacter: 'bg-gray-100 text-gray-700',
  envoye: 'bg-blue-100 text-blue-700',
  relance: 'bg-indigo-100 text-indigo-700',
  repondu: 'bg-teal-100 text-teal-700',
  interesse: 'bg-green-100 text-green-700',
  converti: 'bg-emerald-600 text-white',
  pas_interesse: 'bg-amber-100 text-amber-700',
  a_un_logiciel: 'bg-purple-100 text-purple-700',
  email_manquant: 'bg-orange-100 text-orange-700',
  oppose: 'bg-red-100 text-red-700',
  bounce: 'bg-red-50 text-red-600',
  cessee: 'bg-slate-700 text-white',
}

/* ------------------------------------------------------------------ */
/* Mesure du taux de réponse                                           */
/* ------------------------------------------------------------------ */

/**
 * Statuts qui traduisent une RÉPONSE, quelle qu'elle soit.
 *
 * « Pas intéressé » et « Déjà équipé » en font partie : le prospect a pris la
 * peine de répondre. Les exclure sous-estimerait le mail — ce qu'on mesure ici,
 * c'est sa capacité à faire réagir, pas le taux de vente. C'est aussi ce qui
 * distingue un message ignoré d'un message lu et refusé, deux problèmes très
 * différents à corriger.
 *
 * `oppose` (désinscription) en fait partie AUSSI : cliquer « me retirer de la
 * liste » est la preuve la plus forte que le mail a été ouvert, lu, et qu'il a
 * fait réagir — négativement, mais réagir. La cohorte étant filtrée sur les
 * prospects RÉELLEMENT contactés (`nbEnvois > 0`), une opposition posée à la
 * main sur un contact jamais démarché ne fausse pas la mesure.
 */
export const STATUTS_AVEC_REPONSE: ProspectStatut[] = [
  'repondu', 'interesse', 'converti', 'pas_interesse', 'a_un_logiciel', 'oppose',
]

export function aRepondu(p: Prospect): boolean {
  return STATUTS_AVEC_REPONSE.includes(p.statut)
}

/* ------------------------------------------------------------------ */
/* Priorité de contact                                                 */
/* ------------------------------------------------------------------ */

export type EvalPriorite = {
  /** Prioritaire selon le SEUL score automatique (avant surcharge manuelle). */
  auto: boolean
  score: number
  max: number
  /** Critères REMPLIS, en clair — pour l'infobulle. */
  raisons: string[]
  /** Critères manquants, en clair — pour expliquer pourquoi ce n'est pas prioritaire. */
  manques: string[]
}

/** Au-delà de ce score (sur `max`), un prospect est jugé prioritaire par l'auto. */
export const SEUIL_PRIORITE_AUTO = 3

/** En-deçà de cette distance (km) au point de référence, un prospect est « proche ». */
export const SEUIL_PROXIMITE_KM = 30

/**
 * Score AUTOMATIQUE de priorité de contact — volontairement TRANSPARENT et
 * ajustable (chaque critère est une ligne, pas un poids caché).
 *
 * Prérequis dur : être JOIGNABLE (email valide). Un prospect qu'on ne peut pas
 * contacter n'est jamais « à contacter en priorité » — score 0.
 *
 * `distanceKm` est optionnel car le calcul de distance est ASYNCHRONE (coordonnées
 * chargées côté UI). Quand elle est CONNUE, la proximité joue en BONUS/MALUS :
 * proche (≤ rayon) = +1, loin (> rayon) = −1 (max = 5). Ça favorise le local sans
 * l'exclure absolument — l'exclusion fine se fait à la main avec le filtre par
 * distance. Quand elle est inconnue, le score reste sur 4 et rien ne change.
 *
 * Les critères visent le profil le plus rentable pour de la prospection locale :
 * une petite entreprise vivante, proche, à taille où le patron décide encore vite,
 * jamais contactée, joignable sur une adresse nominative. À faire évoluer avec le
 * retour terrain — c'est une PREMIÈRE grille, pas une vérité.
 */
export function evaluerPrioriteAuto(p: Prospect, distanceKm?: number | null): EvalPriorite {
  const raisons: string[] = []
  const manques: string[] = []
  const norm = normalizeEmail(p.email ?? '')
  const joignable = !!norm && isEmailValide(norm)

  // Chaque critère : +1, et on trace pourquoi (rempli ou manquant).
  const crit = (ok: boolean, siOui: string, siNon: string) => {
    if (ok) raisons.push(siOui)
    else manques.push(siNon)
    return ok ? 1 : 0
  }

  let max = 4
  if (!joignable) {
    manques.push('pas d’adresse email valide (injoignable)')
    return { auto: false, score: 0, max, raisons, manques }
  }

  let score = 0
  score += crit(!isEmailGenerique(norm), 'adresse nominative', 'adresse générique (contact@, info@…)')
  score += crit(
    !!p.siret && !estCessee(p.etatEntreprise),
    'entreprise enrichie et active',
    'entreprise non enrichie ou cessée',
  )
  const g = groupeEffectif(p.effectifCode)
  score += crit(g === 'micro' || g === 'petite', 'taille cible (1 à 19 salariés)', 'taille hors cible ou inconnue')
  score += crit((p.nbEnvois ?? 0) === 0, 'jamais contacté', 'déjà contacté')

  // 5ᵉ critère seulement si la distance est connue (coordonnées chargées) :
  // BONUS proche / MALUS loin. L'exclusion des lointains se gère à la main via le
  // filtre par distance ; ici on ne fait que pencher la balance.
  if (typeof distanceKm === 'number' && Number.isFinite(distanceKm)) {
    max = 5
    if (distanceKm <= SEUIL_PROXIMITE_KM) {
      score += 1
      raisons.push(`proche (≤ ${SEUIL_PROXIMITE_KM} km) : +1`)
    } else {
      score -= 1
      manques.push(`loin (> ${SEUIL_PROXIMITE_KM} km) : −1`)
    }
  }

  return { auto: score >= SEUIL_PRIORITE_AUTO, score, max, raisons, manques }
}

/**
 * « Mes prioritaires » — marqués À LA MAIN, à contacter en premier. Liste sûre,
 * indépendante du score auto : les deux ne se mélangent JAMAIS.
 */
export function estPrioritaireManuel(p: Prospect): boolean {
  return p.prioritaireManuel === true
}

/** Suggéré par le score automatique (indicatif, ne force rien). */
export function estPrioritaireAuto(p: Prospect, distanceKm?: number | null): boolean {
  return evaluerPrioriteAuto(p, distanceKm).auto
}

/**
 * Le prospect a-t-il été contacté dans la période mesurée ?
 *
 * ⚠️ Indispensable depuis la reprise de l'historique AppSheet : 1070 prospects
 * portent un envoi ancien resté sans réponse. Sans borne, une nouvelle campagne
 * de 200 mails avec 10 réponses afficherait ~1 % au lieu de 5 % — et on
 * conclurait à tort que le message ne marche pas.
 */
export function contacteDepuis(p: Prospect, depuis: Date | null): boolean {
  if ((p.nbEnvois ?? 0) <= 0) return false
  if (!depuis) return true
  const d = p.dernierEnvoiAt?.toDate?.()
  return !!d && d >= depuis
}

/* ------------------------------------------------------------------ */
/* Destinataires                                                       */
/* ------------------------------------------------------------------ */

/**
 * Toutes les adresses à mettre en destinataire pour un prospect : l'adresse
 * principale puis les supplémentaires, normalisées, dédupliquées et **purgées
 * des adresses opposées**.
 *
 * ⚠️ Le registre d'opposition est GLOBAL et vaut par ADRESSE : si le dirigeant
 * s'est désinscrit mais que `contact@` ne l'a pas fait, on n'écrit qu'à la
 * seconde. Sans ce filtre, une adresse retirée continuerait de recevoir le mail
 * en copie — exactement ce que le lien de désinscription promet d'empêcher.
 * (Le blocage complet quand l'adresse PRINCIPALE est opposée reste, lui, dans
 * `peutContacter`.)
 */
export function destinatairesProspect(p: Prospect, optouts?: Set<string>): string[] {
  const brut = [p.email, ...(p.emailsSupplementaires ?? [])]
  const vus = new Set<string>()
  const out: string[] = []
  for (const e of brut) {
    const n = normalizeEmail(e ?? '')
    if (!n || !isEmailValide(n) || vus.has(n)) continue
    if (optouts?.has(n)) continue
    vus.add(n)
    out.push(n)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Angles de discours                                                  */
/* ------------------------------------------------------------------ */

/**
 * Catalogue des angles d'accroche.
 *
 * L'étude en renvoie AUTANT QUE PERTINENT pour une entreprise donnée, classés du
 * plus au moins fort : chaque angle est une cartouche pour le premier mail ou une
 * relance. Ils ne pilotent aucun rendu automatique — c'est en adaptant le mail
 * (`Prospect.mailPerso`) qu'on s'en sert, donc en ajouter un ici ne casse rien.
 *
 * `indice` = ce qui, dans les faits recueillis, permet de le retenir. Ce texte
 * part tel quel dans le prompt : le modifier change ce que l'étude cherche.
 */
export interface AngleDef {
  id: string
  label: string
  /** Ce que le mail raconterait sous cet angle */
  quoi: string
  /** À quoi on voit que l'angle colle */
  indice: string
}

export const ANGLES: AngleDef[] = [
  {
    id: 'surcharge',
    label: 'Surcharge du dirigeant',
    quoi: "le planning refait le soir, le téléphone qui sonne depuis les chantiers, le temps perdu entre les chantiers plutôt que sur les chantiers",
    indice: "le dirigeant fait tout lui-même : pas de bureau, pas de personne dédiée à la planification",
  },
  {
    id: 'circulation',
    label: "Circulation de l'information",
    quoi: "le planning fait au bureau que le chantier ne voit pas, les heures reconstituées en fin de mois sur des feuilles papier",
    indice: "il y a un bureau et quelqu'un dont c'est le métier de planifier : la surcharge est déjà réglée, l'info ne redescend pas",
  },
  {
    id: 'coordination',
    label: 'Coordination multi-chantiers',
    quoi: "plusieurs équipes ou sous-traitants à faire tenir ensemble, qui est passé où, qui attend quoi",
    indice: "plusieurs équipes, des chantiers en parallèle, de la sous-traitance, ou un métier qui enchaîne les sites dans la journée",
  },
  {
    id: 'tracabilite',
    label: 'Traçabilité et preuve',
    quoi: "prouver un passage, une réserve levée, un accord client — quand la parole du client contredit la vôtre",
    indice: "contrats d'entretien, interventions récurrentes, réserves et litiges, avis clients faisant état de désaccords",
  },
  {
    id: 'rentabilite',
    label: 'Rentabilité réelle du chantier',
    quoi: "le coût réel d'un chantier connu une fois qu'il est terminé, les heures qui dérapent sans qu'on le voie",
    indice: "des chantiers longs ou au forfait, un devis serré, une entreprise qui parle marges ou qui a grossi vite",
  },
  {
    id: 'croissance',
    label: 'Structuration d\'une entreprise qui grandit',
    quoi: "ce qui tenait à 5 ne tient plus à 15 : les méthodes de la petite équipe qui craquent",
    indice: "recrutement en cours, CA en hausse, rachat ou nouvelle agence, effectif qui a nettement augmenté",
  },
  {
    id: 'administratif',
    label: 'Charge administrative',
    quoi: "la double saisie, les mêmes informations recopiées du chantier au devis puis à la facture",
    indice: "une personne dédiée à l'administratif, ou un logiciel de compta sans lien avec le terrain",
  },
  {
    id: 'reprise_outil',
    label: 'Outil en place mal adapté',
    quoi: "un logiciel payé mais contourné, que les équipes n'utilisent pas sur le terrain",
    indice: "un logiciel de gestion identifié, surtout généraliste ou ancien",
  },
]

export const ANGLE_IDS = ANGLES.map((a) => a.id)

export const angleLabel = (id: string): string =>
  ANGLES.find((a) => a.id === id)?.label ?? id

/**
 * Angles retenus pour un prospect, avec repli sur l'ancien champ mono-valeur
 * `angle` (fiches étudiées avant le passage au multi-angles).
 */
export const anglesDe = (p: { angles?: string[]; angle?: string }): string[] => {
  if (p.angles?.length) return p.angles
  if (p.angle && p.angle !== 'inconnu') return [p.angle]
  return []
}

/* ------------------------------------------------------------------ */
/* Garde-fous anti-spam                                                */
/* ------------------------------------------------------------------ */

/** Plafond d'envois par jour. Le volume est la première cause de dérive en spam. */
export const QUOTA_JOUR = 25

/** Délai minimum avant de relancer un prospect resté silencieux. */
export const DELAI_RELANCE_JOURS = 8

/** Nombre de relances autorisées. Au-delà, le prospect est laissé tranquille. */
export const MAX_RELANCES = 2

/** Longueur minimale de la ligne de personnalisation exigée avant envoi. */
export const MIN_PERSONNALISATION = 30

/** Nombre de thèmes retenus dans le mail par défaut (la brochure porte le détail). */
export const NB_THEMES_MAIL_DEFAUT = 3

/** Préfixes d'adresses génériques : joignables, mais moins bien ciblés. */
const PREFIXES_GENERIQUES = [
  'contact', 'info', 'infos', 'accueil', 'secretariat', 'secretariat',
  'admin', 'administration', 'commercial', 'devis', 'bonjour', 'hello',
  'direction', 'compta', 'comptabilite', 'service', 'sav', 'no-reply', 'noreply',
]

/**
 * Webmails et FAI grand public. Deux artisans en @gmail.com ne sont PAS
 * collègues : chez les TPE du bâtiment ces adresses sont majoritaires, donc
 * traiter le domaine comme un employeur ferait passer toute la base pour une
 * seule et même entreprise.
 */
const DOMAINES_GENERIQUES = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com',
  'outlook.fr', 'live.fr', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.fr',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net',
  'bbox.fr', 'aliceadsl.fr', 'numericable.fr', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'gmx.fr', 'aol.com',
])

/** Un domaine d'email n'identifie une entreprise que s'il lui est propre. */
export function isDomaineEntreprise(domaine: string): boolean {
  const d = (domaine ?? '').trim().toLowerCase()
  return !!d && !DOMAINES_GENERIQUES.has(d)
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Forme canonique d'un email : sert de clé de dédup ET de contrôle d'opposition. */
export function normalizeEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * Identifiant de document Firestore dérivé d'un email.
 * On garde l'email lisible (registre d'opposition consultable à l'œil) en
 * neutralisant les caractères interdits dans un doc id.
 */
export function safeId(email: string): string {
  const norm = normalizeEmail(email)
  return norm.replace(/[^a-z0-9@._+-]/g, '_').slice(0, 400)
}

export function emailDomain(email: string): string {
  const norm = normalizeEmail(email)
  const at = norm.lastIndexOf('@')
  return at === -1 ? '' : norm.slice(at + 1)
}

/** Validation de forme, volontairement stricte : une liste importée est sale. */
export function isEmailValide(email: string): boolean {
  const norm = normalizeEmail(email)
  if (!norm || /\s/.test(norm)) return false
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(norm)
}

/** Adresse de type contact@ / info@ : pas disqualifiante, mais à signaler. */
export function isEmailGenerique(email: string): boolean {
  const norm = normalizeEmail(email)
  const local = norm.split('@')[0] ?? ''
  return PREFIXES_GENERIQUES.includes(local)
}

/** Jeton de désinscription. */
export function makeToken(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  return uuid.replace(/-/g, '')
}

/* ------------------------------------------------------------------ */
/* Sélection des thèmes                                                */
/* ------------------------------------------------------------------ */

/**
 * Thèmes retenus pour le MAIL.
 * Le système AppSheet piochait via `ANY(...)`, qui renvoie un élément arbitraire
 * de la liste — et son champ « Important ou non » n'était jamais utilisé dans le
 * filtre. Ici l'ordre est déterministe : les sections importantes d'abord, puis
 * `ordre` croissant.
 */
export function sectionsPourMail(metier: MailingMetier): MailingSection[] {
  const n = metier.nbThemesMail ?? NB_THEMES_MAIL_DEFAUT
  return [...(metier.sections ?? [])]
    .filter((s) => s.afficher && s.problemeMail?.trim() && s.solutionMail?.trim())
    .sort((a, b) => Number(b.important) - Number(a.important) || a.ordre - b.ordre)
    .slice(0, Math.max(1, n))
}

/** Thèmes retenus pour la BROCHURE : tout ce qui est affiché, dans l'ordre. */
export function sectionsPourBrochure(metier: MailingMetier): MailingSection[] {
  return [...(metier.sections ?? [])]
    .filter((s) => s.afficher && (s.problemesBrochure?.length || s.solutionsBrochure?.length))
    .sort((a, b) => a.ordre - b.ordre)
}

/* ------------------------------------------------------------------ */
/* Éligibilité d'un prospect                                           */
/* ------------------------------------------------------------------ */

export type Blocage =
  | { ok: true }
  | { ok: false; raison: string }

/**
 * Peut-on écrire à ce prospect maintenant ?
 * `optouts` est l'ensemble des emails normalisés en opposition.
 */
export function peutContacter(
  p: Prospect,
  optouts: Set<string>,
  maintenant: Date = new Date(),
): Blocage {
  if (optouts.has(p.emailNormalise)) {
    return { ok: false, raison: "Ce contact s'est opposé à toute sollicitation." }
  }
  if (p.statut === 'oppose') {
    return { ok: false, raison: "Ce contact s'est opposé à toute sollicitation." }
  }
  if (p.statut === 'bounce') {
    return { ok: false, raison: 'Adresse invalide : le message est revenu en erreur.' }
  }
  if (p.statut === 'pas_interesse') {
    return { ok: false, raison: 'Ce contact a répondu ne pas être intéressé.' }
  }
  // Sortie du flux courant, mais pas un refus définitif : à revoir le jour où
  // son outil actuel le freine.
  if (p.statut === 'a_un_logiciel') {
    return {
      ok: false,
      raison: p.logicielActuel
        ? `Déjà équipé (${p.logicielActuel}).`
        : 'Déjà équipé d\'un logiciel.',
    }
  }
  if (p.statut === 'repondu') {
    return { ok: false, raison: 'Ce contact a déjà répondu — la conversation est engagée.' }
  }
  if (p.statut === 'interesse') {
    return { ok: false, raison: 'Contact intéressé — promeus-le en client, la suite est dans le CRM.' }
  }
  if (p.statut === 'converti') {
    return { ok: false, raison: 'Devenu client — la relation se suit dans le CRM.' }
  }
  // Constat de l'utilisateur : il prime sur tout, il a vérifié.
  if (p.statut === 'cessee') {
    return { ok: false, raison: "Cette société n'existe plus." }
  }
  // Donnée officielle INSEE : écrire à une société radiée est une perte sèche.
  // ⚠️ Deux codes possibles ('F' établissement, 'C' entreprise) : ne tester que
  // 'C' — ce que faisait ce garde-fou — laissait passer les 62 sociétés fermées.
  if (estCessee(p.etatEntreprise)) {
    return { ok: false, raison: 'Société cessée selon les données INSEE.' }
  }
  // On se fie à l'email RÉEL, pas au statut : un prospect importé de l'INSEE garde
  // le statut `email_manquant` même après qu'on lui a saisi une adresse — le bloquer
  // là-dessus empêchait de l'envoyer alors que l'email est bien présent.
  if (!p.email?.trim()) {
    return { ok: false, raison: "Pas d'adresse email : complète la fiche avant d'envoyer." }
  }
  if (!isEmailValide(p.email)) {
    return { ok: false, raison: 'Adresse email invalide.' }
  }
  const relances = Math.max(0, (p.nbEnvois ?? 0) - 1)
  if (relances >= MAX_RELANCES) {
    return { ok: false, raison: `Déjà relancé ${MAX_RELANCES} fois sans réponse — on s'arrête là.` }
  }
  if (p.dernierEnvoiAt) {
    const dernier = p.dernierEnvoiAt.toDate()
    const jours = (maintenant.getTime() - dernier.getTime()) / 86_400_000
    if (jours < DELAI_RELANCE_JOURS) {
      const reste = Math.ceil(DELAI_RELANCE_JOURS - jours)
      return { ok: false, raison: `Dernier envoi il y a moins de ${DELAI_RELANCE_JOURS} jours (encore ${reste} j).` }
    }
  }
  return { ok: true }
}

/**
 * Une seule sollicitation par société : écrire à trois personnes de la même
 * boîte est le réflexe qui fait basculer une prospection en spam perçu.
 */
export function doublonSociete(p: Prospect, tous: Prospect[]): Prospect | null {
  // Le domaine ne vaut comme signal que s'il appartient à l'entreprise : un
  // webmail partagé (gmail, orange…) rapprocherait des sociétés étrangères.
  const domBrut = p.domaine || emailDomain(p.email)
  const dom = isDomaineEntreprise(domBrut) ? domBrut : ''
  const soc = (p.societe ?? '').trim().toLowerCase()
  return (
    tous.find(
      (autre) =>
        autre.id !== p.id &&
        (autre.nbEnvois ?? 0) > 0 &&
        ((dom && (autre.domaine || emailDomain(autre.email)) === dom) ||
          (soc && (autre.societe ?? '').trim().toLowerCase() === soc)),
    ) ?? null
  )
}
