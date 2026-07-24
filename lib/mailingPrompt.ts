// Prompt de recherche préalable à un envoi de prospection.
//
// L'app sait ce que dit le registre (effectif en tranche, activité, état) ; elle
// ne sait rien du réel — combien de personnes travaillent vraiment là, si le
// patron a déjà un logiciel, ce que disent ses clients. Ce prompt sert à confier
// cette recherche à un assistant IA, puis à en tirer la ligne de personnalisation.
//
// ⚠️ Le garde-fou anti-invention n'est pas décoratif : la phrase produite part
// dans un vrai mail, à une vraie entreprise, qui saura immédiatement si on lui
// prête un chantier ou une certification qu'elle n'a pas. Une personnalisation
// fausse est pire que pas de personnalisation du tout.

import { libelleEffectif } from '@/lib/sirene'
import { ANGLES, ANGLE_IDS, ROLES_CONTACT } from '@/lib/mailingModel'
import type { MailingMetier, MailPerso, Prospect } from '@/types'

/**
 * @param metier Kit du prospect, si connu : son mail type sert de base à la
 *   proposition de mail demandée en fin de prompt. Sans lui, l'étude est
 *   identique mais le mail proposé part de zéro.
 */
export function construirePromptRecherche(p: Prospect, metier?: MailingMetier | null): string {
  const connu: string[] = [`- Raison sociale : ${p.societe}`]
  if (p.ville || p.codePostal) {
    connu.push(`- Localisation : ${[p.codePostal, p.ville].filter(Boolean).join(' ')}`)
  }
  if (p.siret) connu.push(`- SIRET : ${p.siret}`)
  else if (p.siren) connu.push(`- SIREN : ${p.siren}`)
  if (p.metier) connu.push(`- Corps de métier ciblé : ${p.metier}`)
  if (p.activiteNaf) connu.push(`- Code d'activité (NAF) : ${p.activiteNaf}`)
  if (p.effectifCode) {
    connu.push(`- Tranche d'effectif déclarée à l'INSEE : ${libelleEffectif(p.effectifCode)}`
      + (p.effectifAnnee ? ` (${p.effectifAnnee})` : ''))
  }
  if (p.email) connu.push(`- Adresse de contact connue : ${p.email}`)
  if (p.telephone) connu.push(`- Téléphone connu : ${p.telephone}`)
  if (p.logicielActuel) connu.push(`- Logiciel déjà identifié : ${p.logicielActuel}`)

  return `Tu m'aides à préparer une prise de contact commerciale auprès d'une entreprise du bâtiment.
Je développe des outils de gestion sur mesure (plannings, suivi de chantier, devis, comptes rendus client).

CE QUE JE SAIS DÉJÀ
${connu.join('\n')}

CE QUE JE CHERCHE
1. Taille et organisation réelles. C'est le point le plus important, parce qu'il décide du message que je vais écrire :
   - combien de personnes travaillent dans l'entreprise, et combien sur le terrain ;
   - y a-t-il un bureau distinct des équipes de chantier ?
   - y a-t-il quelqu'un dont c'est le métier de planifier, gérer les devis ou l'administratif (assistante, chargé de planning, responsable d'exploitation, conjoint(e) qui gère la gestion), ou bien le dirigeant fait-il tout lui-même ?
   - qui répond au téléphone et qui reçoit les mails : le dirigeant, ou quelqu'un d'autre ?
2. Ancienneté, dirigeant(s), et signes de croissance récente (recrutements en cours, nouveaux locaux, nouvelle agence).

3. Santé et trajectoire économiques, si les comptes sont publiés (INPI, Pappers, Societe.com, Infogreffe) :
   - le CHIFFRE D'AFFAIRES annuel, et surtout son ÉVOLUTION sur les 3 derniers exercices : en croissance, stable, en recul ?
   - l'évolution du NOMBRE DE SALARIÉS sur la même période ;
   - le ratio CHIFFRE D'AFFAIRES PAR SALARIÉ, et sa tendance. Le chiffre d'affaires seul ne dit pas grand-chose : 800 000 € à trois personnes ou à douze, ce n'est pas la même entreprise.
   Ce que je cherche à lire là-dedans : une entreprise qui embauche plus vite que son chiffre d'affaires ne progresse est en train de perdre en efficacité — c'est souvent le moment où l'organisation craque et où un outil devient nécessaire. À l'inverse, un chiffre d'affaires par salarié qui monte indique une entreprise qui tient sa croissance.
   ⚠️ Beaucoup de TPE ne déposent pas leurs comptes, ou en demandent la confidentialité : dans ce cas écris « comptes non publiés » et n'invente aucun chiffre. Ne compare à une moyenne de secteur que si tu peux la sourcer.
4. Spécialités réelles et type de clientèle : particuliers ou professionnels, neuf ou rénovation, dépannage ou chantiers longs.
5. Présence en ligne : site web, réseaux sociaux, avis clients. Pour les avis, relève les THÈMES RÉCURRENTS, en particulier ce qui touche aux délais, aux devis, aux rendez-vous manqués ou à la communication.
6. Indices d'outillage informatique : logiciel de gestion ou de devis mentionné quelque part, prise de rendez-vous en ligne, espace client, offres d'emploi citant un outil précis.
7. Actualités récentes : certifications (RGE, Qualibat), partenariats, changements notables.

RÈGLES STRICTES
- Ne donne que ce que tu peux SOURCER. Indique l'URL à côté de chaque information.
- Si tu ne trouves pas une information, écris « non trouvé ». N'invente rien et ne déduis rien de « plausible » : une donnée vraisemblable mais fausse me fera écrire une bêtise à un vrai chef d'entreprise.
- Sépare clairement ce qui est CONFIRMÉ par une source de ce qui n'est qu'une HYPOTHÈSE.
- Attention aux homonymes : beaucoup d'entreprises du bâtiment portent le même nom dans des départements différents. Vérifie que ce que tu trouves correspond bien à la localisation ci-dessus, et signale-le si tu as un doute.

CE QUE JE VEUX EN SORTIE
- Une fiche courte et factuelle, point par point.

- Une section « ANGLES À PRIVILÉGIER ». Voici les angles d'accroche dont je dispose. Dis-moi TOUS CEUX QUI COLLENT à cette entreprise — pas un seul : chacun est une cartouche, pour le premier mail ou pour une relance. Classe-les du plus au moins pertinent, et pour CHACUN cite l'élément factuel précis qui te le fait retenir. Écarte explicitement ceux qui ne collent pas, en disant pourquoi (c'est aussi utile).
${ANGLES.map((a) => `  · ${a.id} — ${a.label} : ${a.quoi}. On le retient quand ${a.indice}.`).join('\n')}
  Deux angles peuvent parfaitement coexister. Si tu n'as pas assez d'éléments sur son organisation, ne retiens que « surcharge » : c'est le bon dans le doute, la grande majorité des artisans étant des patrons qui font tout eux-mêmes.

- ENFIN, tout à la fin de ta réponse, ajoute un BLOC RÉCAPITULATIF que je vais copier-coller tel quel dans mon logiciel pour remplir la fiche automatiquement. Respecte EXACTEMENT ce format : les deux délimiteurs chacun sur leur propre ligne, une clé par ligne, et chaque valeur tenant sur UNE SEULE ligne (condense si besoin, ne va JAMAIS à la ligne à l'intérieur d'une valeur — ni tableau, ni puce, ni saut de ligne). N'écris rien après le bloc. Ne reprends dans ce bloc QUE ce que ta fiche a établi plus haut. Si une information est inconnue, mets « inconnu » (ou « aucun » pour logiciel/site/réseaux/certifications). Pour "angles", reprends les identifiants retenus SÉPARÉS PAR DES VIRGULES, du plus au moins pertinent (ex : "surcharge, coordination"), ou "inconnu".

===ENEZO-FICHE===
dirigeant: <nom de la personne à qui écrire, ou "inconnu">
email: <adresse email de contact TROUVÉE, idéalement nominative (prenom.nom@…), sinon "inconnu" — RECOPIE-la ici MÊME si tu l'as déjà citée plus haut, c'est ce champ qui l'enregistre>
email_nom: <nom de la personne derrière cette adresse, si tu peux l'établir, sinon "inconnu">
email_role: <son rôle dans l'entreprise, UN SEUL mot parmi : ${ROLES_CONTACT.map((r) => r.id).join(', ')} — "generique" pour une adresse type contact@/info@, "inconnu" si tu ne sais pas>
dirigeant_age: <âge ou année de naissance du dirigeant si trouvé, ex "43 ans" ou "1981", sinon "inconnu">
dirigeant_profil: <"jeune" si le dirigeant a moins de ~45 ans (a priori plus réceptif au numérique) ; "senior" s'il a plus de ~55 ans (souvent fin de carrière, moins outillé) ; "inconnu">
groupe: <nom du groupe/holding si l'entreprise en fait partie (avec d'AUTRES sociétés), sinon "aucun">
angles: <identifiants d'angles retenus, séparés par des virgules, du plus au moins pertinent — parmi : ${ANGLE_IDS.join(', ')} — ou "inconnu">
effectif: <ex: 8 personnes dont 6 sur le terrain, ou "inconnu">
effectif_reel: <le NOMBRE de salariés seul si tu l'as trouvé, ex "8" ou "~12", sinon "inconnu">
developpement: <oui s'il y a des signes NETS de croissance (recrutement en cours, CA en hausse, rachat/reprise récente, nouveaux locaux/agence) ; non sinon ; inconnu>
site_etat: <"pro" si le site est propre et professionnel ; "bancal" s'il est à moitié fait, à l'abandon, daté ou peu pro ; "aucun" s'il n'y a pas de site ; "inconnu">
organisation: <ex: le dirigeant gère tout | bureau d'études + conduite de travaux + terrain, ou "inconnu">
admin_dedie: <oui si une personne fait SURTOUT de l'administratif/gestion/planning (assistante, conjoint(e) qui gère, responsable exploitation) ; non si le dirigeant gère tout lui-même ; inconnu>
anciennete: <année de création et/ou ancienneté, ou "inconnu">
zone: <zone géographique d'intervention, ou "inconnu">
specialites: <spécialités et types de chantiers, ou "inconnu">
croissance: <signes de croissance ou trajectoire récente, ou "inconnu">
sante: <santé économique SI les comptes sont publiés, sinon "comptes non publiés">
logiciel: <nom du logiciel de gestion/devis/chantier en place ; "aucun" si tu es sûr qu'il n'en a pas ; "inconnu" si tu ne sais pas>
site: <url du site principal, ou "aucun">
reseaux: <réseaux sociaux et plateformes d'avis, ou "aucun">
certifications: <RGE, Qualibat, labels, agréments, ou "aucun">
avis: <thèmes récurrents des avis clients (surtout délais / devis / communication), ou "aucun">
resume: <2 ou 3 phrases factuelles résumant l'entreprise, sur une seule ligne>
===FIN-FICHE===
${blocMail(metier)}`
}

/**
 * Second bloc du prompt : la PROPOSITION DE MAIL.
 *
 * L'app ne rédige rien elle-même et n'appelle aucune IA — elle demande le texte
 * dans un bloc délimité, puis le relit. Le mail type du kit est fourni comme
 * point de départ : on veut une ADAPTATION de ce qui marche déjà, pas une
 * invention repartant de zéro à chaque prospect.
 *
 * Format à part de la fiche : ces blocs font plusieurs paragraphes, alors que le
 * récap impose une valeur par ligne.
 */
function blocMail(metier?: MailingMetier | null): string {
  const base = metier && metier.mailScene?.trim() && metier.mailExemples?.trim() && metier.mailQuestion?.trim()
    ? `
VOICI MON MAIL TYPE POUR CE MÉTIER — c'est lui qu'il faut ADAPTER, pas remplacer :
Objet : ${metier.objet ?? ''}
--scene--
${metier.mailScene}
--exemples--
${metier.mailExemples}
--question--
${metier.mailQuestion}
`
    : ''

  return `
PROPOSE-MOI ENSUITE LE MAIL
${base}
Écris-moi une version de ce mail adaptée à CETTE entreprise, en te servant de ce que tu viens d'établir sur elle (organisation, effectif réel, logiciel en place ou absence de logiciel, personne dédiée à l'administratif, croissance, état du site) et de l'angle que tu as retenu en premier.

Règles d'écriture, elles comptent autant que le fond :
- Environ 110 mots en tout, UN SEUL sujet. Un mail long ne se lit pas sur un téléphone, entre deux chantiers.
- Écris « je », jamais « nous » : je suis un développeur indépendant, pas une agence. C'est un avantage, pas une faiblesse.
- Une SCÈNE concrète que le lecteur reconnaît, pas une liste de fonctionnalités. Il doit faire lui-même le calcul de ce que ça lui coûte : ne chiffre JAMAIS un gain de temps ou d'argent, une promesse invisible est le marqueur du démarchage.
- Termine par UNE question ouverte. Sans question, il n'a aucune raison de répondre.
- Aucun émoji, aucun superlatif, aucune formule commerciale toute faite.
- N'utilise QUE des faits que tu as sourcés plus haut. Si tu n'as rien de solide sur cette entreprise, reprends le mail type presque tel quel plutôt que d'inventer : un détail faux dans un premier mail est irrattrapable.
- Ne mentionne ni le prix, ni la durée, ni la technique.

Rends-le dans ce bloc, à la toute fin de ta réponse, après le bloc fiche. Respecte EXACTEMENT les délimiteurs :

===ENEZO-MAIL===
objet: <objet du mail, une seule ligne, sans point final>
--scene--
<la scène, 2 ou 3 phrases, paragraphes autorisés>
--exemples--
<ce que ça change concrètement pour lui, 2 ou 3 phrases>
--question--
<la question finale, une ou deux phrases>
===FIN-MAIL===`
}

export type FicheEtude = {
  personnalisation?: string
  email?: string
  /** Qui est derrière l'email trouvé, et à quel titre */
  emailNom?: string
  emailRole?: string
  dirigeant?: string
  dirigeantAge?: string
  dirigeantJeune?: boolean
  groupe?: string
  /** (legacy) Angle unique — encore renseigné pour les fiches déjà en base */
  angle?: 'surcharge' | 'circulation' | 'inconnu'
  /** Tous les angles qui collent, du plus au moins pertinent */
  angles?: string[]
  /** Mail proposé par l'étude, prêt à devenir `Prospect.mailPerso` après validation */
  mailPropose?: MailPerso
  logicielActuel?: string
  aLogiciel?: boolean
  responsableAdmin?: boolean
  effectifReel?: string
  enDeveloppement?: boolean
  siteEtat?: 'pro' | 'bancal' | 'aucun'
  etudeResume?: string
}

// Valeurs que l'IA écrit quand elle n'a rien trouvé : à traiter comme « vide ».
const VALEURS_VIDES = new Set(['', 'aucun', 'aucune', 'inconnu', 'inconnue', 'non trouvé', 'non trouve', 'n/a', 'na', '-', '—', '?'])

function estVide(v: string): boolean {
  return VALEURS_VIDES.has(v.trim().toLowerCase())
}

/**
 * Extrait le mail proposé du bloc `===ENEZO-MAIL=== … ===FIN-MAIL===`.
 * Les blocs font plusieurs paragraphes : on découpe sur les marqueurs
 * `--scene--` / `--exemples--` / `--question--` plutôt que ligne à ligne.
 * Renvoie undefined si le bloc est absent ou vide — l'étude reste valable sans.
 */
export function parserBlocMail(texte: string): MailPerso | undefined {
  const bloc = texte.match(/===\s*ENEZO-MAIL\s*===([\s\S]*?)===\s*FIN-?MAIL\s*===/i)
  if (!bloc) return undefined
  const corps = bloc[1]

  const part = (marqueur: RegExp): string => {
    const m = corps.match(marqueur)
    return m ? m[1].trim() : ''
  }
  const objetLigne = corps.match(/^\s*objet\s*:\s*(.+?)\s*$/im)

  const perso: MailPerso = {
    objet: objetLigne ? objetLigne[1].trim() : '',
    scene: part(/--\s*scene\s*--([\s\S]*?)(?=--\s*exemples\s*--|--\s*question\s*--|$)/i),
    exemples: part(/--\s*exemples\s*--([\s\S]*?)(?=--\s*question\s*--|$)/i),
    question: part(/--\s*question\s*--([\s\S]*?)$/i),
  }
  // Un bloc présent mais vide ne doit pas écraser le kit par du blanc
  return perso.scene || perso.exemples || perso.question || perso.objet ? perso : undefined
}

/**
 * Extrait la fiche du RÉCAPITULATIF collé (réponse complète de l'IA ou juste le
 * bloc). Tolérant : on isole le bloc `===ENEZO-FICHE=== … ===FIN-FICHE===` s'il
 * est là, sinon on parse le texte entier ligne à ligne. Renvoie null si rien
 * d'exploitable — l'app pourra alors prévenir plutôt que d'écrire du vide.
 */
export function parserFicheEtude(texte: string): FicheEtude | null {
  if (!texte?.trim()) return null
  const bloc = texte.match(/===\s*ENEZO-FICHE\s*===([\s\S]*?)===\s*FIN-?FICHE\s*===/i)
  // Le bloc mail est retiré du corps analysé : ses lignes « objet: … » seraient
  // sinon relues comme des clés de la fiche.
  const mailPropose = parserBlocMail(texte)
  const corps = bloc ? bloc[1] : texte.replace(/===\s*ENEZO-MAIL\s*===[\s\S]*?===\s*FIN-?MAIL\s*===/i, '')

  const paires = new Map<string, string>()
  for (const ligne of corps.split(/\r?\n/)) {
    const m = ligne.match(/^\s*[-*]?\s*([A-Za-zÀ-ſ_]+)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const cle = m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    if (!paires.has(cle)) paires.set(cle, m[2].trim())
  }
  // Un mail proposé sans fiche exploitable reste une réponse utile
  if (paires.size === 0) return mailPropose ? { mailPropose } : null

  const val = (k: string) => {
    const v = paires.get(k)
    return v && !estVide(v) ? v : undefined
  }

  const fiche: FicheEtude = {}
  if (mailPropose) fiche.mailPropose = mailPropose
  const perso = val('personnalisation')
  if (perso) fiche.personnalisation = perso

  const dirigeant = val('dirigeant')
  if (dirigeant) fiche.dirigeant = dirigeant

  // Email trouvé par l'étude — on ne retient qu'une valeur qui ressemble à une adresse.
  const emailBrut = val('email')
  if (emailBrut && /\S+@\S+\.\S+/.test(emailBrut)) {
    const m = emailBrut.match(/[^\s<>()"]+@[^\s<>()"]+\.[^\s<>()"]+/)
    if (m) fiche.email = m[0]
  }

  // Qui est derrière cette adresse. Le rôle est filtré sur le catalogue : une
  // valeur inventée n'aurait aucun libellé dans l'app.
  const emailNom = val('email_nom')
  if (emailNom) fiche.emailNom = emailNom
  const roleBrut = (paires.get('email_role') ?? '').trim().toLowerCase()
  if (ROLES_CONTACT.some((r) => r.id === roleBrut)) fiche.emailRole = roleBrut

  const age = val('dirigeant_age')
  if (age) fiche.dirigeantAge = age
  const profilBrut = (paires.get('dirigeant_profil') ?? '').trim().toLowerCase()
  if (profilBrut.startsWith('jeune')) fiche.dirigeantJeune = true
  else if (profilBrut.startsWith('senior') || profilBrut.startsWith('âg') || profilBrut.startsWith('ag')) fiche.dirigeantJeune = false

  const groupe = val('groupe')
  if (groupe) fiche.groupe = groupe

  // Angles : liste séparée par des virgules, filtrée sur le catalogue connu (une
  // valeur inventée par le modèle n'aurait ni libellé ni filtre côté app).
  // `angle` (mono-valeur) reste renseigné avec le premier, pour les écrans qui
  // n'ont pas encore basculé et pour les fiches anciennes.
  const anglesRaw = (paires.get('angles') ?? paires.get('angle') ?? '').toLowerCase()
  const anglesTrouves = anglesRaw
    .split(/[,;/]+/)
    .map((s) => s.trim())
    .filter((s) => ANGLE_IDS.includes(s))
  if (anglesTrouves.length) {
    fiche.angles = Array.from(new Set(anglesTrouves))
    const premier = fiche.angles[0]
    if (premier === 'surcharge' || premier === 'circulation') fiche.angle = premier
  } else if (anglesRaw.includes('inconnu')) {
    fiche.angle = 'inconnu'
  }

  // Logiciel : trois cas distincts.
  //  - un NOM  → il en a un (aLogiciel = true) + on retient le nom ;
  //  - "aucun" / "pas de logiciel" / "non" → il n'en a pas (aLogiciel = false) ;
  //  - "inconnu" ou absent → on ne sait pas (rien).
  const logicielBrut = (paires.get('logiciel') ?? '').trim().toLowerCase()
  const AUCUN = new Set(['aucun', 'aucune', 'pas de logiciel', 'non', 'sans logiciel', 'rien'])
  const logicielNom = val('logiciel')
  if (logicielNom) {
    fiche.logicielActuel = logicielNom
    fiche.aLogiciel = true
  } else if (AUCUN.has(logicielBrut)) {
    fiche.aLogiciel = false
  }

  // Responsable administratif dédié : oui / non / (inconnu = rien).
  const adminBrut = (paires.get('admin_dedie') ?? '').trim().toLowerCase()
  if (adminBrut.startsWith('oui')) fiche.responsableAdmin = true
  else if (adminBrut.startsWith('non')) fiche.responsableAdmin = false

  // Effectif réel (nombre seul).
  const effReel = val('effectif_reel')
  if (effReel) fiche.effectifReel = effReel

  // En développement : oui / non / (inconnu = rien).
  const devBrut = (paires.get('developpement') ?? '').trim().toLowerCase()
  if (devBrut.startsWith('oui')) fiche.enDeveloppement = true
  else if (devBrut.startsWith('non')) fiche.enDeveloppement = false

  // État du site : pro / bancal / aucun.
  const siteBrut = (paires.get('site_etat') ?? '').trim().toLowerCase()
  if (/bancal|stand|abandon|dat|moiti|amateur|peu pro/.test(siteBrut)) fiche.siteEtat = 'bancal'
  else if (/aucun|pas de site|sans site|absent/.test(siteBrut)) fiche.siteEtat = 'aucun'
  else if (/pro|propre|soign|correct|ok/.test(siteBrut)) fiche.siteEtat = 'pro'

  // Fiche compilée : le résumé d'abord, puis chaque rubrique renseignée. Tout ce
  // que le bloc ramène est conservé — c'est ce qui manquait avant.
  const lignes: string[] = []
  const ajoute = (cle: string, prefixe: string) => {
    const v = val(cle)
    if (v) lignes.push(prefixe ? `${prefixe} : ${v}` : v)
  }
  ajoute('resume', '')
  ajoute('effectif', 'Effectif')
  ajoute('organisation', 'Organisation')
  ajoute('anciennete', 'Ancienneté')
  ajoute('zone', 'Zone')
  ajoute('specialites', 'Spécialités')
  ajoute('croissance', 'Croissance')
  ajoute('sante', 'Santé éco')
  ajoute('site', 'Site')
  ajoute('reseaux', 'Réseaux')
  ajoute('certifications', 'Certifications')
  ajoute('avis', 'Avis')
  if (lignes.length) fiche.etudeResume = lignes.join('\n')

  if (
    !fiche.personnalisation && !fiche.email && !fiche.dirigeant && !fiche.dirigeantAge &&
    fiche.dirigeantJeune === undefined && !fiche.groupe && !fiche.angle && !fiche.angles?.length &&
    !fiche.logicielActuel && fiche.aLogiciel === undefined &&
    fiche.responsableAdmin === undefined && !fiche.effectifReel &&
    fiche.enDeveloppement === undefined && !fiche.siteEtat && !fiche.etudeResume &&
    !fiche.mailPropose
  ) {
    return null
  }
  return fiche
}
