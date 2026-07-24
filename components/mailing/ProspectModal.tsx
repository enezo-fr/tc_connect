"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { createProspect, updateProspect } from "@/lib/mailingService";
import { isEmailGenerique, isEmailValide, normalizeEmail, ROLES_CONTACT } from "@/lib/mailingModel";
import { TrashIcon } from "@heroicons/react/24/outline";
import {
  libelleEffectif, normaliserSiret, rechercherCandidats, rechercherParSiret, siretValide,
  type Candidats, type InfoEntreprise,
} from "@/lib/sirene";
import type { MailingMetier, Prospect, ProspectContact, ProspectStatut } from "@/types";

const inputCls = "w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

export default function ProspectModal({
  userId, metiers, existants, optouts, prospect, onClose, onToast,
}: {
  userId: string;
  metiers: MailingMetier[];
  existants: Prospect[];
  optouts: Set<string>;
  /** Fourni = édition ; absent = création. */
  prospect?: Prospect | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const edition = !!prospect;

  const [societe, setSociete] = useState(prospect?.societe ?? "");
  const [email, setEmail] = useState(prospect?.email ?? "");
  const [emailRole, setEmailRole] = useState(prospect?.emailRole ?? "");
  const [emailNom, setEmailNom] = useState(prospect?.emailNom ?? "");
  // Contacts supplémentaires : le mail leur part dans le MÊME message.
  // Éditables en lignes (adresse / rôle / nom), pas en pastilles : on saisit et
  // on corrige ces champs, une croix à côté du texte se cliquerait par erreur.
  const [contactsSup, setContactsSup] = useState<ProspectContact[]>(
    prospect?.contactsSupplementaires ?? [],
  );
  const [metierId, setMetierId] = useState(prospect?.metierId ?? "");
  const [telephone, setTelephone] = useState(prospect?.telephone ?? "");
  const [codePostal, setCodePostal] = useState(prospect?.codePostal ?? "");
  const [ville, setVille] = useState(prospect?.ville ?? "");
  const [siret, setSiret] = useState(prospect?.siret ?? "");
  const [info, setInfo] = useState<InfoEntreprise | null>(null);
  const [errSiret, setErrSiret] = useState<string | null>(null);
  const [enrichEnCours, setEnrichEnCours] = useState(false);
  const [rechEnCours, setRechEnCours] = useState(false);
  const [candidats, setCandidats] = useState<Candidats | null>(null);
  const [enCours, setEnCours] = useState(false);

  const chercherParNom = async () => {
    setRechEnCours(true);
    setErrSiret(null);
    try {
      const naf = metiers.find((m) => m.id === metierId)?.codesNaf;
      setCandidats(await rechercherCandidats(societe, codePostal.trim() || undefined, naf));
    } catch {
      setErrSiret("L'annuaire des entreprises est injoignable pour le moment.");
    } finally {
      setRechEnCours(false);
    }
  };

  // Choix explicite de l'utilisateur : au-delà d'un candidat, on ne devine pas.
  const retenirCandidat = (c: InfoEntreprise) => {
    setInfo(c);
    setCandidats(null);
    if (c.siret) setSiret(c.siret);
    if (!ville.trim() && c.ville) setVille(c.ville);
    if (!codePostal.trim() && c.codePostal) setCodePostal(c.codePostal);
  };

  // L'enrichissement ne remplit que ce qui est vide : il complète une saisie,
  // il ne la corrige pas dans le dos de l'utilisateur.
  const enrichir = async () => {
    setEnrichEnCours(true);
    setErrSiret(null);
    try {
      const res = await rechercherParSiret(siret);
      if (!res) {
        setErrSiret("Aucune entreprise trouvée pour ce numéro.");
        setInfo(null);
        return;
      }
      setInfo(res);
      if (!societe.trim() && res.nom) setSociete(res.nom);
      if (!ville.trim() && res.ville) setVille(res.ville);
      if (!codePostal.trim() && res.codePostal) setCodePostal(res.codePostal);
    } catch {
      setErrSiret("L'annuaire des entreprises est injoignable pour le moment.");
    } finally {
      setEnrichEnCours(false);
    }
  };

  const norm = normalizeEmail(email);
  const soc = societe.trim().toLowerCase();

  // En édition, le prospect courant ne doit évidemment pas être son propre doublon.
  const autres = existants.filter((p) => p.id !== prospect?.id);

  // Mêmes garde-fous qu'à l'import : ni la saisie manuelle ni la modification
  // ne doivent permettre de contourner le registre d'opposition.
  const oppose = !!norm && optouts.has(norm);
  const doublonEmail = !!norm && autres.some((p) => (p.emailNormalise || normalizeEmail(p.email)) === norm);
  const societeOpposee =
    !!soc &&
    autres.some(
      (p) =>
        (p.societe ?? "").trim().toLowerCase() === soc &&
        (p.statut === "oppose" || optouts.has(p.emailNormalise || normalizeEmail(p.email))),
    );
  const doublonSociete = !!soc && autres.some((p) => (p.societe ?? "").trim().toLowerCase() === soc);

  const emailOk = !!norm && isEmailValide(norm);

  const majContact = (i: number, patch: Partial<ProspectContact>) =>
    setContactsSup((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // Une adresse supplémentaire vide n'est pas une erreur : la ligne vient d'être
  // ajoutée. On ne signale que ce qui est saisi ET faux.
  const contactsInvalides = contactsSup.some(
    (c) => c.email.trim() && !isEmailValide(normalizeEmail(c.email)),
  );
  // Signalé, mais non bloquant : l'adresse est simplement écartée à l'envoi.
  const contactOppose = contactsSup.some((c) => optouts.has(normalizeEmail(c.email)));
  const bloquant = oppose || doublonEmail || societeOpposee;
  const valide = societe.trim().length >= 2 && emailOk && !bloquant;

  const enregistrer = async () => {
    if (!valide) return;
    setEnCours(true);
    try {
      const champs = {
        societe: societe.trim(),
        email: norm,
        emailRole,
        emailNom: emailNom.trim(),
        // Lignes vides ignorées, adresses normalisées, et jamais l'adresse
        // principale en double (elle est déjà destinataire).
        contactsSupplementaires: contactsSup
          .map((c) => ({
            email: normalizeEmail(c.email),
            role: c.role ?? "",
            nom: (c.nom ?? "").trim(),
          }))
          .filter((c) => c.email && isEmailValide(c.email) && c.email !== norm),
        metierId,
        metier: metiers.find((m) => m.id === metierId)?.metier ?? "",
        telephone: telephone.trim(),
        codePostal: codePostal.trim(),
        ville: ville.trim(),
        siret: normaliserSiret(siret),
        ...(info
          ? {
              siren: info.siren,
              effectifCode: info.effectifCode,
              effectifAnnee: info.effectifAnnee,
              effectifDeLEntreprise: info.effectifDeLEntreprise,
              activiteNaf: info.activiteNaf,
              etatEntreprise: info.etat,
            }
          : {}),
        // Un prospect INSEE importé sans email garde le statut « Email à trouver » :
        // dès qu'on lui saisit une adresse valide, il redevient contactable.
        ...(edition && prospect?.statut === "email_manquant" && emailOk
          ? { statut: "a_contacter" as ProspectStatut }
          : {}),
      };
      if (edition && prospect) {
        await updateProspect(prospect.id, champs);
        onToast("Prospect modifié.");
      } else {
        await createProspect({ userId, ...champs });
        onToast("Prospect ajouté.");
      }
      onClose();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={edition ? "Modifier le prospect" : "Ajouter un prospect"} size="lg">
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Société <span className="text-red-500">*</span></label>
            <input value={societe} onChange={(e) => setSociete(e.target.value)} className={inputCls} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Email <span className="text-red-500">*</span></label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@exemple.fr"
              className={inputCls}
            />
          </div>
        </div>

        {/* Qui est derrière l'adresse principale */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Rôle de ce contact</label>
            <select value={emailRole} onChange={(e) => setEmailRole(e.target.value)} className={inputCls}>
              <option value="">— Non précisé —</option>
              {ROLES_CONTACT.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Nom de la personne</label>
            <input
              value={emailNom}
              onChange={(e) => setEmailNom(e.target.value)}
              placeholder="Jean Dupont"
              className={inputCls}
            />
          </div>
        </div>

        {/* Contacts supplémentaires — un seul message part, avec tout le monde
            en destinataire. Ce n'est donc pas un second contact. */}
        <div>
          <label className={labelCls}>
            Autres contacts{" "}
            <span className="text-gray-400">(mis en destinataire du même message)</span>
          </label>

          {contactsSup.length > 0 && (
            <div className="space-y-2 mb-2">
              {contactsSup.map((c, i) => (
                <div key={i} className="border rounded-lg p-2.5 bg-gray-50/60 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={c.email}
                      onChange={(e) => majContact(i, { email: e.target.value })}
                      placeholder="direction@exemple.fr"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => setContactsSup((prev) => prev.filter((_, j) => j !== i))}
                      className="px-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition shrink-0"
                      title="Retirer ce contact"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <select
                      value={c.role ?? ""}
                      onChange={(e) => majContact(i, { role: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">— Rôle non précisé —</option>
                      {ROLES_CONTACT.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                    <input
                      value={c.nom ?? ""}
                      onChange={(e) => majContact(i, { nom: e.target.value })}
                      placeholder="Nom de la personne"
                      className={inputCls}
                    />
                  </div>
                  {!!c.email.trim() && !isEmailValide(normalizeEmail(c.email)) && (
                    <p className="text-[11px] text-amber-700">Cette adresse n&apos;est pas valide.</p>
                  )}
                  {normalizeEmail(c.email) === norm && !!norm && (
                    <p className="text-[11px] text-amber-700">
                      C&apos;est déjà l&apos;adresse principale : elle ne sera pas ajoutée deux fois.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setContactsSup((prev) => [...prev, { email: "", role: "", nom: "" }])}
            className="px-3 py-2 rounded-lg text-sm border hover:bg-gray-50 transition"
          >
            + Ajouter un contact
          </button>

          {contactOppose && (
            <p className="text-[11px] text-amber-700 mt-1">
              Une de ces adresses s&apos;est opposée à toute sollicitation : elle sera
              automatiquement retirée des destinataires au moment de l&apos;envoi.
            </p>
          )}
        </div>

        <div>
          <label className={labelCls}>SIRET</label>
          <div className="flex gap-2">
            <input
              value={siret}
              onChange={(e) => { setSiret(e.target.value); setInfo(null); setErrSiret(null); }}
              placeholder="14 chiffres"
              className={inputCls}
            />
            <button
              onClick={siret.trim() ? enrichir : chercherParNom}
              disabled={
                siret.trim()
                  ? !siretValide(siret) || enrichEnCours
                  : societe.trim().length < 2 || rechEnCours
              }
              className="shrink-0 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {enrichEnCours || rechEnCours
                ? "Recherche…"
                : siret.trim()
                  ? "Enrichir"
                  : "Trouver par nom"}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            {siret.trim()
              ? "Complète effectif, activité et état depuis l'annuaire public des entreprises."
              : societe.trim().length < 2
                ? "Renseigne d'abord la société : le SIRET sera retrouvé à partir de son nom."
                : "Pas de SIRET ? Il sera retrouvé depuis la raison sociale et le code postal."}
          </p>

          {candidats && (
            <div className="mt-2 border rounded-lg divide-y">
              <div className="px-3 py-1.5 text-[11px] text-gray-500 bg-gray-50">
                {candidats.candidats.length === 0
                  ? "Aucune entreprise trouvée."
                  : `${candidats.candidats.length} candidat(s) pour « ${candidats.requete} »`}
                {candidats.nomTronque && (
                  <span className="text-amber-700">
                    {" "}— trouvé en retirant le début du nom (enseigne de réseau ?)
                  </span>
                )}
              </div>
              {candidats.candidats.map((c) => (
                <button
                  key={c.siren}
                  onClick={() => retenirCandidat(c)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 transition"
                >
                  <div className="text-xs font-medium">{c.nom}</div>
                  <div className="text-[11px] text-gray-500">
                    SIREN {c.siren} · {libelleEffectif(c.effectifCode)}
                    {c.activiteNaf ? ` · NAF ${c.activiteNaf}` : ""}
                    {c.ville ? ` · ${c.ville}` : ""}
                    {c.etat === "C" && <span className="text-red-700"> · cessée</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {errSiret && <p className="text-[11px] text-amber-700 mt-1">{errSiret}</p>}
          {info && (
            <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs space-y-0.5">
              <div className="font-medium text-gray-800">{info.nom}</div>
              <div className="text-gray-600">
                Effectif : {libelleEffectif(info.effectifCode)}
                {info.effectifAnnee ? ` (${info.effectifAnnee})` : ""}
                {info.effectifDeLEntreprise && (
                  <span className="text-gray-400"> — au niveau de l&apos;entreprise</span>
                )}
              </div>
              {info.activiteNaf && <div className="text-gray-600">Activité : {info.activiteNaf}</div>}
              {info.adresse && <div className="text-gray-600">{info.adresse}</div>}
              {info.etat === "C" && (
                <div className="text-red-700 font-medium">
                  Société cessée — elle ne pourra pas être contactée.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Kit métier</label>
            <select value={metierId} onChange={(e) => setMetierId(e.target.value)} className={inputCls}>
              <option value="">— Aucun —</option>
              {metiers.map((m) => (
                <option key={m.id} value={m.id}>{m.metier}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Téléphone</label>
            <input value={telephone} onChange={(e) => setTelephone(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <div>
              <label className={labelCls}>CP</label>
              <input value={codePostal} onChange={(e) => setCodePostal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Ville</label>
              <input value={ville} onChange={(e) => setVille(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {oppose && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            Cette adresse figure au registre d&apos;opposition. Elle ne peut pas être utilisée.
          </div>
        )}
        {!oppose && societeOpposee && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            Un contact de cette société s&apos;est opposé. Écrire à un collègue est précisément ce
            qui fait passer une prospection pour du spam.
          </div>
        )}
        {!oppose && doublonEmail && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Cette adresse est déjà utilisée par un autre prospect.
          </div>
        )}
        {!bloquant && !doublonEmail && doublonSociete && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Tu as déjà un contact dans cette société. Tu peux le garder, mais n&apos;écris
            qu&apos;à l&apos;un des deux.
          </div>
        )}
        {!!norm && !emailOk && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Cette adresse email n&apos;est pas valide.
          </div>
        )}
        {emailOk && isEmailGenerique(norm) && !bloquant && (
          <div className="rounded-lg bg-gray-50 text-gray-600 text-sm px-3 py-2">
            Adresse générique (contact@, info@…) : joignable, mais elle convertit moins bien
            qu&apos;une adresse nominative.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
            Annuler
          </button>
          <button
            onClick={enregistrer}
            disabled={!valide || enCours}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enCours ? "Enregistrement…" : edition ? "Enregistrer" : "Ajouter le prospect"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
