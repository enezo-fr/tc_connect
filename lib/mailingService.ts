// Mailing — accès Firestore côté client.
// Collections : prospects, mailing_metiers, mailing_envois, mailing_optout.

import { db } from '@/lib/firebase'
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField, getDocs,
  onSnapshot, query, where, writeBatch, Timestamp,
} from 'firebase/firestore'
import { cleanForFirestore } from '@/lib/firebaseUtils'
import { emailDomain, isEmailValide, makeToken, normalizeEmail, safeId } from '@/lib/mailingModel'
import type { InfoEntreprise } from '@/lib/sirene'
import type {
  Client, MailingEnvoi, MailingEvenement, MailingLogiciel, MailingMetier, MailingOptout,
  MailPerso, Prospect, ProspectStatut,
} from '@/types'

const prospectsCol = () => collection(db, 'prospects')
const metiersCol = () => collection(db, 'mailing_metiers')
const envoisCol = () => collection(db, 'mailing_envois')
const optoutCol = () => collection(db, 'mailing_optout')
const evenementsCol = () => collection(db, 'mailing_evenements')

/* ------------------------------------------------------------------ */
/* Kits métier                                                         */
/* ------------------------------------------------------------------ */

export const listenMetiers = (userId: string, cb: (m: MailingMetier[]) => void) => {
  const q = query(metiersCol(), where('userId', '==', userId))
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MailingMetier))
    data.sort((a, b) => (a.metier ?? '').localeCompare(b.metier ?? ''))
    cb(data)
  })
}

export const createMetier = async (
  data: Omit<MailingMetier, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<{ id: string }> => {
  const ref = await addDoc(metiersCol(), {
    ...cleanForFirestore(data as unknown as Record<string, unknown>),
    // Posés hors de cleanForFirestore, qui retire les chaînes vides : un kit
    // neuf doit exister avec des champs vides plutôt qu'absents, sinon les
    // inputs de l'éditeur démarrent non contrôlés.
    objet: data.objet ?? '',
    problematiques: data.problematiques ?? '',
    sections: data.sections ?? [],
    createdAt: Timestamp.now(),
  })
  return { id: ref.id }
}

export const updateMetier = async (id: string, data: Partial<MailingMetier>): Promise<void> => {
  const payload: Record<string, unknown> = {
    ...cleanForFirestore(data as unknown as Record<string, unknown>),
    updatedAt: Timestamp.now(),
  }
  // cleanForFirestore retire les chaînes vides : sans ce rattrapage, vider un
  // champ dans l'éditeur ne l'effacerait pas en base — l'ancienne valeur
  // resterait. On réinjecte donc tout ce que l'appelant a explicitement fourni.
  if (data.sections !== undefined) payload.sections = data.sections
  if (data.objet !== undefined) payload.objet = data.objet
  if (data.problematiques !== undefined) payload.problematiques = data.problematiques
  if (data.codesNaf !== undefined) payload.codesNaf = data.codesNaf
  if (data.mailScene !== undefined) payload.mailScene = data.mailScene
  if (data.mailExemples !== undefined) payload.mailExemples = data.mailExemples
  if (data.mailQuestion !== undefined) payload.mailQuestion = data.mailQuestion
  await updateDoc(doc(db, 'mailing_metiers', id), payload)
}

export const deleteMetier = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'mailing_metiers', id))
}

/* ------------------------------------------------------------------ */
/* Prospects                                                           */
/* ------------------------------------------------------------------ */

export const listenProspects = (userId: string, cb: (p: Prospect[]) => void) => {
  const q = query(prospectsCol(), where('userId', '==', userId))
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Prospect))
    data.sort((a, b) => (a.societe ?? '').localeCompare(b.societe ?? ''))
    cb(data)
  })
}

export type NouveauProspect = Omit<
  Prospect,
  'id' | 'createdAt' | 'updatedAt' | 'emailNormalise' | 'domaine' | 'optoutToken' | 'statut'
  | 'dernierEnvoiAt' | 'nbEnvois'
> & {
  statut?: ProspectStatut
  /** Dates reprises d'un import, pour conserver l'historique existant. */
  dateCreation?: Date
  dateDernierEnvoi?: Date
}

/**
 * Construit le document Firestore d'un prospect.
 * Les deux dates d'import sont retirées de la charge utile : ce sont des
 * paramètres de construction, pas des champs de `Prospect`.
 */
function docProspect(data: NouveauProspect): Record<string, unknown> {
  const { dateCreation, dateDernierEnvoi, ...champs } = data
  const envoye = !!dateDernierEnvoi
  return {
    ...cleanForFirestore(champs as unknown as Record<string, unknown>),
    emailNormalise: normalizeEmail(data.email),
    domaine: emailDomain(data.email),
    optoutToken: makeToken(),
    // Un prospect importé avec une date d'envoi est déjà contacté : le laisser
    // « à contacter » le ferait ressortir comme neuf dans le composeur et
    // remettrait le délai de relance à zéro.
    statut: data.statut ?? (envoye ? 'envoye' : 'a_contacter'),
    nbEnvois: envoye ? 1 : 0,
    ...(dateDernierEnvoi ? { dernierEnvoiAt: Timestamp.fromDate(dateDernierEnvoi) } : {}),
    createdAt: dateCreation ? Timestamp.fromDate(dateCreation) : Timestamp.now(),
  }
}

export const createProspect = async (data: NouveauProspect): Promise<{ id: string }> => {
  const ref = await addDoc(prospectsCol(), docProspect(data))
  return { id: ref.id }
}

/** Import de liste : écriture par lots de 400 (limite Firestore : 500 opérations). */
export const createProspectsBatch = async (items: NouveauProspect[]): Promise<number> => {
  let total = 0
  for (let i = 0; i < items.length; i += 400) {
    const lot = items.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const item of lot) batch.set(doc(prospectsCol()), docProspect(item))
    await batch.commit()
    total += lot.length
  }
  return total
}

export const updateProspect = async (id: string, data: Partial<Prospect>): Promise<void> => {
  const payload: Record<string, unknown> = {
    ...cleanForFirestore(data as unknown as Record<string, unknown>),
    updatedAt: Timestamp.now(),
  }
  // cleanForFirestore retire les chaînes vides : sans ce rattrapage, vider un
  // champ dans le formulaire ne l'effacerait pas — l'ancienne valeur resterait
  // en base. On réinjecte donc tout ce que l'appelant a explicitement fourni.
  for (const [cle, valeur] of Object.entries(data)) {
    if (valeur === '') payload[cle] = ''
    // Même piège avec les listes : retirer la dernière adresse supplémentaire
    // doit vider le champ, pas laisser l'ancienne liste en base.
    if (Array.isArray(valeur) && valeur.length === 0) payload[cle] = []
  }
  if (data.email !== undefined) {
    payload.emailNormalise = normalizeEmail(data.email)
    payload.domaine = emailDomain(data.email)
  }
  await updateDoc(doc(db, 'prospects', id), payload)
}

export const deleteProspect = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'prospects', id))
}

/* ------------------------------------------------------------------ */
/* Référentiel des logiciels concurrents                               */
/* ------------------------------------------------------------------ */

export const listenLogiciels = (userId: string, cb: (l: MailingLogiciel[]) => void) => {
  const q = query(collection(db, 'mailing_logiciels'), where('userId', '==', userId))
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MailingLogiciel))
    data.sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''))
    cb(data)
  })
}

export const ajouterLogiciel = async (userId: string, nom: string): Promise<void> => {
  await addDoc(collection(db, 'mailing_logiciels'), {
    userId, nom: nom.trim(), createdAt: Timestamp.now(),
  })
}

/**
 * Retire un logiciel du référentiel.
 * Les prospects qui le mentionnent gardent leur valeur : on ne réécrit pas
 * l'historique parce qu'on nettoie une liste de choix.
 */
export const supprimerLogiciel = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'mailing_logiciels', id))
}

/* ------------------------------------------------------------------ */
/* Enrichissement SIRET                                                */
/* ------------------------------------------------------------------ */

/**
 * Applique à un prospect les données officielles tirées de son SIRET.
 * Les champs saisis à la main (ville, code postal) ne sont complétés que s'ils
 * sont vides : l'API ne doit pas écraser une correction faite par l'utilisateur.
 */
export const appliquerEnrichissement = async (
  prospect: Prospect,
  info: InfoEntreprise,
): Promise<void> => {
  const patch: Partial<Prospect> = {
    siren: info.siren,
    effectifCode: info.effectifCode,
    effectifAnnee: info.effectifAnnee,
    effectifDeLEntreprise: info.effectifDeLEntreprise,
    activiteNaf: info.activiteNaf,
    etatEntreprise: info.etat,
    enrichiAt: Timestamp.now(),
  }
  if (info.siret) patch.siret = info.siret
  if (!prospect.ville?.trim() && info.ville) patch.ville = info.ville
  if (!prospect.codePostal?.trim() && info.codePostal) patch.codePostal = info.codePostal

  await updateDoc(doc(db, 'prospects', prospect.id), {
    ...cleanForFirestore(patch as Record<string, unknown>),
    // Booléen envoyé brut : cleanForFirestore ne filtre pas `false`, mais on
    // reste explicite pour que le champ puisse repasser à false.
    effectifDeLEntreprise: info.effectifDeLEntreprise,
    updatedAt: Timestamp.now(),
  })
}

/* ------------------------------------------------------------------ */
/* Registre d'opposition                                               */
/* ------------------------------------------------------------------ */

/**
 * Le registre est GLOBAL et vit hors de `prospects` : supprimer un prospect ou
 * réimporter une liste ne doit jamais faire réapparaître quelqu'un qui s'est
 * opposé. C'est le garde-fou principal de tout l'outil.
 */
export const listenOptouts = (cb: (emails: Set<string>, docs: MailingOptout[]) => void) =>
  onSnapshot(optoutCol(), (snap) => {
    const docsList = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MailingOptout))
    cb(new Set(docsList.map((o) => normalizeEmail(o.email))), docsList)
  })

export const chargerOptouts = async (): Promise<Set<string>> => {
  const snap = await getDocs(optoutCol())
  return new Set(snap.docs.map((d) => normalizeEmail((d.data() as MailingOptout).email)))
}

export const ajouterOptout = async (
  email: string,
  origine: MailingOptout['origine'],
  prospectId?: string,
): Promise<void> => {
  const norm = normalizeEmail(email)
  await setDoc(
    doc(db, 'mailing_optout', safeId(norm)),
    cleanForFirestore({ email: norm, origine, prospectId, createdAt: Timestamp.now() }),
    { merge: true },
  )
}

/* ------------------------------------------------------------------ */
/* Journal du parcours                                                 */
/* ------------------------------------------------------------------ */

export const listenEvenements = (userId: string, cb: (e: MailingEvenement[]) => void) => {
  const q = query(evenementsCol(), where('userId', '==', userId))
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MailingEvenement))
    data.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
    cb(data)
  })
}

/** Jours entiers écoulés depuis le dernier envoi, ou undefined si jamais contacté. */
function delaiDepuis(prospect: Prospect): number | undefined {
  if (!prospect.dernierEnvoiAt) return undefined
  const ms = Date.now() - prospect.dernierEnvoiAt.toDate().getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}

/**
 * Consigne un événement. Le délai depuis le dernier envoi est figé À L'ÉCRITURE :
 * recalculé plus tard il donnerait l'âge de l'envoi, pas le délai de réponse.
 */
export const journaliser = async (
  prospect: Prospect,
  evt: Pick<MailingEvenement, 'type'> &
    Partial<Pick<MailingEvenement, 'statutAvant' | 'statutApres' | 'observations'>>,
): Promise<void> => {
  await addDoc(evenementsCol(), {
    ...cleanForFirestore({
      userId: prospect.userId,
      prospectId: prospect.id,
      societe: prospect.societe,
      metier: prospect.metier,
      delaiDepuisEnvoi: delaiDepuis(prospect),
      ...evt,
    } as Record<string, unknown>),
    createdAt: Timestamp.now(),
  })
}

/**
 * Modifie une note du journal.
 * Réservé au type 'note' : les règles Firestore refusent la même opération sur
 * un envoi ou un changement de statut, et c'est volontaire.
 */
export const modifierNote = async (id: string, observations: string): Promise<void> => {
  await updateDoc(doc(db, 'mailing_evenements', id), {
    observations,
    modifieAt: Timestamp.now(),
  })
}

export const supprimerNote = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'mailing_evenements', id))
}

/* ------------------------------------------------------------------ */
/* Envois                                                              */
/* ------------------------------------------------------------------ */

export const listenEnvois = (userId: string, cb: (e: MailingEnvoi[]) => void) => {
  const q = query(envoisCol(), where('userId', '==', userId))
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MailingEnvoi))
    data.sort((a, b) => (b.envoyeAt?.toMillis() ?? 0) - (a.envoyeAt?.toMillis() ?? 0))
    cb(data)
  })
}

/**
 * Consigne un envoi : archive le corps FIGÉ puis met le prospect à jour.
 * Le snapshot est la raison d'être de cette collection — un mail archivé ne doit
 * jamais être recalculé depuis le kit courant.
 */
export const enregistrerEnvoi = async (
  envoi: Omit<MailingEnvoi, 'id' | 'envoyeAt'>,
  prospect: Prospect,
): Promise<void> => {
  const now = Timestamp.now()
  await addDoc(envoisCol(), {
    ...cleanForFirestore(envoi as unknown as Record<string, unknown>),
    envoyeAt: now,
  })
  // Journalisé AVANT la mise à jour : `delaiDepuisEnvoi` doit mesurer l'écart
  // avec l'envoi précédent, pas avec celui qu'on est en train de consigner.
  await journaliser(prospect, {
    type: 'envoi',
    statutAvant: prospect.statut,
    statutApres: (prospect.nbEnvois ?? 0) > 0 ? 'relance' : 'envoye',
  })
  await updateDoc(doc(db, 'prospects', prospect.id), {
    statut: (prospect.nbEnvois ?? 0) > 0 ? 'relance' : 'envoye',
    nbEnvois: (prospect.nbEnvois ?? 0) + 1,
    dernierEnvoiAt: now,
    updatedAt: now,
  })
}

/**
 * Fusionne deux fiches d'une même entreprise (INSEE sans email + annuaire avec
 * email, typiquement). `garde` absorbe ce qui manque, `absorbe` est supprimée.
 *
 * ⚠️ LES ARCHIVES D'ENVOI NE SONT PAS DÉPLACÉES. `mailing_envois` et les faits
 * de `mailing_evenements` sont immuables côté règles Firestore (`update: if
 * false`) : impossible de leur réattribuer un `prospectId`. On fusionne donc les
 * COMPTEURS — `nbEnvois` cumulé et `dernierEnvoiAt` le plus récent — car ce sont
 * eux qui pilotent les garde-fous (délai de relance, plafond de relances). Les
 * messages archivés de la fiche absorbée restent en base, rattachés à son ancien
 * identifiant. Une note datée le consigne sur la fiche conservée.
 */
export const fusionnerProspects = async (garde: Prospect, absorbe: Prospect): Promise<void> => {
  const patch: Record<string, unknown> = {}
  const vide = (v?: string) => !v?.trim()

  // Chaque champ absent chez `garde` est repris de `absorbe`.
  if (vide(garde.siren) && absorbe.siren) patch.siren = absorbe.siren
  if (vide(garde.siret) && absorbe.siret) patch.siret = absorbe.siret
  if (vide(garde.effectifCode) && absorbe.effectifCode) {
    patch.effectifCode = absorbe.effectifCode
    if (absorbe.effectifAnnee) patch.effectifAnnee = absorbe.effectifAnnee
    patch.effectifDeLEntreprise = !!absorbe.effectifDeLEntreprise
  }
  if (vide(garde.activiteNaf) && absorbe.activiteNaf) patch.activiteNaf = absorbe.activiteNaf
  if (vide(garde.etatEntreprise) && absorbe.etatEntreprise) patch.etatEntreprise = absorbe.etatEntreprise
  if (vide(garde.telephone) && absorbe.telephone) patch.telephone = absorbe.telephone
  if (vide(garde.ville) && absorbe.ville) patch.ville = absorbe.ville
  if (vide(garde.codePostal) && absorbe.codePostal) patch.codePostal = absorbe.codePostal
  if (vide(garde.metierId) && absorbe.metierId) {
    patch.metierId = absorbe.metierId
    if (absorbe.metier) patch.metier = absorbe.metier
  }
  if (vide(garde.logicielActuel) && absorbe.logicielActuel) patch.logicielActuel = absorbe.logicielActuel
  if (absorbe.enrichiAt && !garde.enrichiAt) patch.enrichiAt = absorbe.enrichiAt

  // Infos d'étude : chaque champ absent chez `garde` est repris de `absorbe`.
  if (vide(garde.dirigeant) && absorbe.dirigeant) patch.dirigeant = absorbe.dirigeant
  if (vide(garde.dirigeantAge) && absorbe.dirigeantAge) patch.dirigeantAge = absorbe.dirigeantAge
  if (garde.dirigeantJeune === undefined && absorbe.dirigeantJeune !== undefined) patch.dirigeantJeune = absorbe.dirigeantJeune
  if (vide(garde.groupe) && absorbe.groupe) patch.groupe = absorbe.groupe
  if (vide(garde.effectifReel) && absorbe.effectifReel) patch.effectifReel = absorbe.effectifReel
  if (vide(garde.etudeResume) && absorbe.etudeResume) patch.etudeResume = absorbe.etudeResume
  if (!garde.angle && absorbe.angle) patch.angle = absorbe.angle
  if (garde.aLogiciel === undefined && absorbe.aLogiciel !== undefined) patch.aLogiciel = absorbe.aLogiciel
  if (garde.responsableAdmin === undefined && absorbe.responsableAdmin !== undefined) patch.responsableAdmin = absorbe.responsableAdmin
  if (garde.enDeveloppement === undefined && absorbe.enDeveloppement !== undefined) patch.enDeveloppement = absorbe.enDeveloppement
  if (!garde.siteEtat && absorbe.siteEtat) patch.siteEtat = absorbe.siteEtat
  if (!garde.etudeAt && absorbe.etudeAt) patch.etudeAt = absorbe.etudeAt

  // Compteurs d'envoi : cumulés, date la plus récente conservée.
  const envois = (garde.nbEnvois ?? 0) + (absorbe.nbEnvois ?? 0)
  if (envois !== (garde.nbEnvois ?? 0)) patch.nbEnvois = envois
  const dG = garde.dernierEnvoiAt?.toMillis?.() ?? 0
  const dA = absorbe.dernierEnvoiAt?.toMillis?.() ?? 0
  if (dA > dG && absorbe.dernierEnvoiAt) patch.dernierEnvoiAt = absorbe.dernierEnvoiAt

  // La fiche conservée peut être celle SANS email (l'utilisateur choisit) :
  // l'email de l'autre devient alors le sien, avec ses champs dérivés — sans
  // quoi elle resterait « Email à trouver » et injoignable. `optoutToken` n'est
  // PAS repris : il est propre au document, pas à l'adresse.
  const lignes: string[] = []
  const emailAbsorbe = absorbe.email?.trim()
  if (emailAbsorbe && !garde.email?.trim()) {
    patch.email = emailAbsorbe
    patch.emailNormalise = normalizeEmail(emailAbsorbe)
    patch.domaine = emailDomain(emailAbsorbe)
    if (garde.statut === 'email_manquant') {
      patch.statut = (garde.nbEnvois ?? 0) > 0 ? 'envoye' : 'a_contacter'
    }
  } else if (emailAbsorbe && normalizeEmail(emailAbsorbe) !== normalizeEmail(garde.email ?? '')) {
    // Deux adresses différentes : la seconde n'est jamais écrasée ni perdue,
    // elle part dans les notes — l'utilisateur choisit au moment d'écrire.
    lignes.push(`Autre email connu : ${emailAbsorbe}`)
  }
  if (absorbe.notes?.trim()) lignes.push(absorbe.notes.trim())
  if (lignes.length) {
    patch.notes = [garde.notes?.trim(), ...lignes].filter(Boolean).join('\n')
  }

  patch.updatedAt = Timestamp.now()
  await updateDoc(doc(db, 'prospects', garde.id), patch)

  await journaliser(garde, {
    type: 'note',
    observations:
      `Fusion avec la fiche « ${absorbe.societe} »`
      + (absorbe.nbEnvois ? ` (${absorbe.nbEnvois} envoi(s) repris au compteur ;`
        + ' les messages archivés restent sur l\'ancienne fiche)' : ''),
  })

  await deleteDoc(doc(db, 'prospects', absorbe.id))
}

/** Mémorise qu'une paire n'est PAS un doublon, pour ne plus la reproposer. */
export const ignorerDoublon = async (a: Prospect, b: Prospect): Promise<void> => {
  await updateDoc(doc(db, 'prospects', a.id), {
    doublonsIgnores: [...(a.doublonsIgnores ?? []), b.id],
    updatedAt: Timestamp.now(),
  })
}

/**
 * Annule un « ce ne sont pas les mêmes ».
 * Nettoie les DEUX fiches : selon laquelle portait la marque, la paire
 * resterait masquée si on n'en traitait qu'une.
 */
export const oublierDoublonIgnore = async (a: Prospect, b: Prospect): Promise<void> => {
  const maj = async (p: Prospect, autreId: string) => {
    if (!p.doublonsIgnores?.includes(autreId)) return
    await updateDoc(doc(db, 'prospects', p.id), {
      doublonsIgnores: p.doublonsIgnores.filter((id) => id !== autreId),
      updatedAt: Timestamp.now(),
    })
  }
  await maj(a, b.id)
  await maj(b, a.id)
}

/**
 * Efface les données INSEE d'un prospect mal apparié.
 *
 * Le cas réel : un nom sans code postal trouve un homonyme à l'autre bout de la
 * France, l'enrichissement l'applique, ET complète le code postal vide avec
 * celui de l'homonyme — le prospect « déménage ». Comme on ne sait pas quelle
 * ville était la bonne, on retire aussi la ville et le code postal issus de
 * l'enrichissement : mieux vaut un champ vide qu'une fausse adresse.
 *
 * Le prospect ressortira au prochain enrichissement (il n'a plus de `siren`).
 */
export const annulerEnrichissement = async (prospect: Prospect): Promise<void> => {
  await updateDoc(doc(db, 'prospects', prospect.id), {
    siren: deleteField(),
    siret: deleteField(),
    effectifCode: deleteField(),
    effectifAnnee: deleteField(),
    effectifDeLEntreprise: deleteField(),
    activiteNaf: deleteField(),
    etatEntreprise: deleteField(),
    enrichiAt: deleteField(),
    codePostal: deleteField(),
    ville: deleteField(),
    updatedAt: Timestamp.now(),
  })
}

/**
 * Défait le dernier envoi CONSIGNÉ sur un prospect — typiquement un clic sur
 * « Envoyé » alors que le mail n'est jamais parti.
 *
 * L'archive `mailing_envois` et le journal ne sont PAS touchés : ils sont
 * immuables par conception (règles Firestore) et c'est ce qui garantit qu'un
 * message archivé reste le message réellement composé. On consigne donc
 * l'annulation comme un fait de plus, on ne réécrit pas l'histoire. Seul l'état
 * du prospect revient en arrière — ce qui relâche le délai de relance.
 */
export const annulerDernierEnvoi = async (prospect: Prospect): Promise<void> => {
  const nouveauNb = Math.max(0, (prospect.nbEnvois ?? 0) - 1)

  // Dernier envoi encore valide après annulation. L'archive conserve TOUS les
  // envois, y compris ceux déjà annulés : on compte à rebours depuis sa fin
  // plutôt que de prendre l'avant-dernier, sinon deux annulations successives
  // restaureraient la même date.
  const snap = await getDocs(query(envoisCol(), where('prospectId', '==', prospect.id)))
  const archives = snap.docs
    .map((d) => d.data() as MailingEnvoi)
    .sort((a, b) => (b.envoyeAt?.toMillis() ?? 0) - (a.envoyeAt?.toMillis() ?? 0))
  const precedent = nouveauNb > 0 ? archives[archives.length - nouveauNb] : undefined

  // Un prospect qui a RÉPONDU depuis garde son statut : annuler un envoi de
  // trop ne doit pas le renvoyer dans la file des gens à contacter.
  const rendreStatut = prospect.statut === 'envoye' || prospect.statut === 'relance'
  const nouveauStatut: ProspectStatut =
    nouveauNb === 0 ? 'a_contacter' : nouveauNb === 1 ? 'envoye' : 'relance'

  await journaliser(prospect, {
    type: 'annulation',
    statutAvant: prospect.statut,
    ...(rendreStatut ? { statutApres: nouveauStatut } : {}),
  })

  await updateDoc(doc(db, 'prospects', prospect.id), {
    nbEnvois: nouveauNb,
    dernierEnvoiAt: precedent?.envoyeAt ?? deleteField(),
    ...(rendreStatut ? { statut: nouveauStatut } : {}),
    updatedAt: Timestamp.now(),
  })
}

/* ------------------------------------------------------------------ */
/* Promotion vers le CRM                                               */
/* ------------------------------------------------------------------ */

/**
 * Un prospect qui répond quitte le mailing et entre dans le CRM.
 * C'est la frontière du modèle : `prospects` porte le contact froid,
 * `clients` porte la relation engagée. Pas de double magasin.
 */
export interface SuggestionClient {
  clientId: string
  /** Ce qui a déclenché le rapprochement, à afficher pour que l'utilisateur juge. */
  raison: string
}

/**
 * Propose un client existant correspondant au prospect — sans rien décider.
 * L'appariement automatique s'est révélé trop fragile : un email différent de
 * celui de la fiche client suffit à le mettre en échec, et il créait alors un
 * doublon en silence. C'est donc une SUGGESTION, confirmée par l'utilisateur.
 */
export const suggererClient = async (
  prospect: Prospect, clients: Client[],
): Promise<SuggestionClient | null> => {
  const email = normalizeEmail(prospect.email)
  const siret = (prospect.siret ?? '').replace(/\D/g, '')
  const soc = prospect.societe.trim().toLowerCase()

  for (const c of clients) {
    if (email && normalizeEmail(c.email ?? '') === email) return { clientId: c.id, raison: 'même email' }
    if (siret && (c.siret ?? '').replace(/\D/g, '') === siret) return { clientId: c.id, raison: 'même SIRET' }
  }
  for (const c of clients) {
    const noms = [c.nomEntreprise, c.nom].map((n) => (n ?? '').trim().toLowerCase())
    if (soc && noms.includes(soc)) return { clientId: c.id, raison: 'même raison sociale' }
  }
  return null
}

/**
 * Annule le rattachement d'un prospect à une fiche client.
 * Nécessaire notamment quand la fiche client a été supprimée entre-temps : le
 * prospect gardait sinon une référence morte et ne pouvait plus être promu.
 * `deleteField()` retire vraiment la clé — la mettre à `''` la laisserait
 * présente et le bouton de promotion resterait masqué.
 */
export const detacherDuClient = async (
  prospect: Prospect, nouveauStatut: ProspectStatut,
): Promise<void> => {
  await journaliser(prospect, {
    type: 'note',
    observations: 'Rattachement au client annulé — le prospect redevient promouvable.',
  })
  await updateDoc(doc(db, 'prospects', prospect.id), {
    clientId: deleteField(),
    statut: nouveauStatut,
    updatedAt: Timestamp.now(),
  })
}

/**
 * Marque (ou retire) « mes prioritaires » — la liste sûre à contacter en premier,
 * distincte du score auto. `false` efface le champ (`deleteField()` plutôt que
 * stocker `false`, pour garder les fiches propres).
 */
export const definirPrioriteManuelle = async (
  id: string, prioritaire: boolean,
): Promise<void> => {
  await updateDoc(doc(db, 'prospects', id), {
    prioritaireManuel: prioritaire ? true : deleteField(),
    updatedAt: Timestamp.now(),
  })
}

/**
 * Enregistre (ou supprime) le mail adapté à ce prospect.
 *
 * `null` efface la surcharge via `deleteField()` : le prospect repart sur le
 * mail du kit métier. Les blocs vides sont retirés de l'objet enregistré, pour
 * qu'un bloc laissé vide retombe sur le kit plutôt que de vider le mail.
 */
export const definirMailPerso = async (
  id: string, perso: MailPerso | null,
): Promise<void> => {
  const nettoye = perso
    ? Object.fromEntries(Object.entries(perso).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v))
    : {}
  const vide = Object.keys(nettoye).length === 0
  await updateDoc(doc(db, 'prospects', id), {
    mailPerso: vide ? deleteField() : nettoye,
    mailPersoAt: vide ? deleteField() : Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

/**
 * Enregistre le résultat de l'étude IA sur la fiche prospect. Ne touche QUE les
 * champs fournis (cleanForFirestore écarte vides et undefined) : une étude qui ne
 * ramène rien de neuf n'efface pas ce qui était déjà là.
 */
export const enregistrerEtude = async (
  prospect: Prospect,
  fiche: {
    personnalisation?: string
    email?: string
    dirigeant?: string
    dirigeantAge?: string
    dirigeantJeune?: boolean
    groupe?: string
    angle?: 'surcharge' | 'circulation' | 'inconnu'
    angles?: string[]
    logicielActuel?: string
    aLogiciel?: boolean
    responsableAdmin?: boolean
    effectifReel?: string
    enDeveloppement?: boolean
    siteEtat?: 'pro' | 'bancal' | 'aucun'
    etudeResume?: string
  },
): Promise<void> => {
  // L'email est traité à part : il faut ses champs dérivés + le statut, et il ne
  // doit JAMAIS écraser un email déjà présent (l'officiel prime).
  const { email, ...rest } = fiche
  const data: Record<string, unknown> = {
    // cleanForFirestore garde `false` (utile pour aLogiciel) et retire les vides.
    ...cleanForFirestore(rest as Record<string, unknown>),
    etudeAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }
  const notes: string[] = []
  const trouve = email?.trim() ? normalizeEmail(email) : ''
  if (trouve && isEmailValide(trouve)) {
    if (!prospect.email?.trim()) {
      data.email = trouve
      data.emailNormalise = trouve
      data.domaine = emailDomain(trouve)
      if (prospect.statut === 'email_manquant') {
        data.statut = (prospect.nbEnvois ?? 0) > 0 ? 'envoye' : 'a_contacter'
      }
      notes.push(`Email ajouté depuis l'étude : ${trouve}`)
    } else if (trouve !== normalizeEmail(prospect.email)) {
      // Email officiel conservé ; l'autre est noté pour ne pas le perdre.
      notes.push(`Autre email trouvé par l'étude : ${trouve}`)
    }
  }
  await updateDoc(doc(db, 'prospects', prospect.id), data)
  await journaliser(prospect, {
    type: 'note',
    observations: ['Étude IA enregistrée sur la fiche.', ...notes].join(' '),
  })
}

/**
 * Saisie/édition MANUELLE des infos connues d'un prospect (entreprise qu'on
 * connaît déjà). `null` ou `''` efface le champ (`deleteField`) ; pour le logiciel,
 * `null` = « on ne sait pas », `false` = « pas de logiciel », `true` = « en a un ».
 */
export const majInfosProspect = async (
  prospect: Prospect,
  patch: {
    dirigeant?: string | null
    dirigeantAge?: string | null
    dirigeantJeune?: boolean | null
    groupe?: string | null
    logicielActuel?: string | null
    aLogiciel?: boolean | null
    responsableAdmin?: boolean | null
    effectifReel?: string | null
    enDeveloppement?: boolean | null
    siteEtat?: 'pro' | 'bancal' | 'aucun' | null
    angle?: 'surcharge' | 'circulation' | 'inconnu' | null
    angles?: string[] | null
    etudeResume?: string | null
  },
): Promise<void> => {
  const data: Record<string, unknown> = { etudeAt: Timestamp.now(), updatedAt: Timestamp.now() }
  for (const [cle, v] of Object.entries(patch)) {
    if (v === undefined) continue
    // Un tableau vide vaut « plus aucun angle » → on efface le champ.
    const vide = v === null || v === '' || (Array.isArray(v) && v.length === 0)
    data[cle] = vide ? deleteField() : v
  }
  await updateDoc(doc(db, 'prospects', prospect.id), data)
  await journaliser(prospect, { type: 'note', observations: 'Infos saisies à la main sur la fiche.' })
}

/** Marque (ou retire) « prompt déjà lancé » sur un prospect. */
export const definirPromptLance = async (id: string, lance: boolean): Promise<void> => {
  await updateDoc(doc(db, 'prospects', id), {
    promptLanceAt: lance ? Timestamp.now() : deleteField(),
    updatedAt: Timestamp.now(),
  })
}

/** Rattache le prospect à une fiche client CHOISIE, sans rien créer. */
export const rattacherAClient = async (prospect: Prospect, clientId: string): Promise<void> => {
  await journaliser(prospect, {
    type: 'promotion',
    statutAvant: prospect.statut,
    statutApres: 'converti',
    observations: 'Rattaché à une fiche client existante.',
  })
  await updateDoc(doc(db, 'prospects', prospect.id), {
    statut: 'converti' as ProspectStatut,
    clientId,
    updatedAt: Timestamp.now(),
  })
}

export const promouvoirEnClient = async (
  prospect: Prospect,
  userId: string,
): Promise<{ clientId: string }> => {
  const ref = await addDoc(collection(db, 'clients'), {
    ...cleanForFirestore({
      userId,
      nom: prospect.societe,
      nomEntreprise: prospect.societe,
      email: prospect.email,
      telephone: prospect.telephone,
      ville: prospect.ville,
      codePostal: prospect.codePostal,
      profession: prospect.metier,
      statut: 'Prospect',
      commentConnuCoach: prospect.origine ? `Prospection — ${prospect.origine}` : 'Prospection',
    } as Record<string, unknown>),
    // Posés hors de cleanForFirestore : il filtre les chaînes vides, or `prenom`
    // est requis côté Client et reste vide pour une société.
    prenom: '',
    marques: ['enezo'],
    pipelineStage: 'contacte' as Client['pipelineStage'],
    pipelineUpdatedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  })
  await journaliser(prospect, {
    type: 'promotion',
    statutAvant: prospect.statut,
    statutApres: 'converti',
    observations: 'Promu en client — suite dans le pipeline CRM.',
  })
  await updateDoc(doc(db, 'prospects', prospect.id), {
    statut: 'converti' as ProspectStatut,
    clientId: ref.id,
    updatedAt: Timestamp.now(),
  })
  return { clientId: ref.id }
}
