"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { construirePromptRecherche, parserFicheEtude } from "@/lib/mailingPrompt";
import { enregistrerEtude, majInfosProspect, definirPromptLance, definirMailPerso } from "@/lib/mailingService";
import { ANGLES, anglesDe, angleLabel } from "@/lib/mailingModel";
import type { MailingMetier, Prospect } from "@/types";

/** Libellé lisible de l'état « a un logiciel ? » (true / false / inconnu). */
function logicielTexte(aLogiciel: boolean | undefined, nom?: string): string | null {
  if (aLogiciel === true) return `A un logiciel${nom ? ` : ${nom}` : ""}`;
  if (aLogiciel === false) return "Pas de logiciel";
  if (nom) return `Logiciel : ${nom}`; // fiches anciennes : nom sans le booléen
  return null;
}

/** Libellé de l'état « responsable administratif dédié ? ». */
function adminTexte(r: boolean | undefined): string | null {
  if (r === true) return "Responsable administratif dédié";
  if (r === false) return "Pas d'admin dédié (le dirigeant gère tout)";
  return null;
}

const SITE_LABEL: Record<"pro" | "bancal" | "aucun", string> = {
  pro: "Site propre et pro",
  bancal: "Site bancal / à refaire",
  aucun: "Pas de site",
};

const inputCls =
  "w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

// « Étudier cette entreprise » — trois voies :
//  1. copier le prompt ;
//  2. coller la réponse IA (parse automatique) ;
//  3. saisir/corriger à la main (entreprise qu'on connaît déjà).
export default function EtudeModal({
  prospect,
  metier,
  onClose,
  onToast,
}: {
  prospect: Prospect;
  /** Kit du prospect : son mail type sert de base au mail proposé par l'étude */
  metier?: MailingMetier | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [onglet, setOnglet] = useState<"prompt" | "coller" | "manuel">("prompt");
  const [copie, setCopie] = useState(false);
  const [texte, setTexte] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [promptLance, setPromptLance] = useState(!!prospect.promptLanceAt);

  // Saisie manuelle — pré-remplie avec ce qui est déjà connu.
  const [dirigeantM, setDirigeantM] = useState(prospect.dirigeant ?? "");
  const [ageM, setAgeM] = useState(prospect.dirigeantAge ?? "");
  const [profilM, setProfilM] = useState<"" | "jeune" | "senior">(
    prospect.dirigeantJeune === true ? "jeune" : prospect.dirigeantJeune === false ? "senior" : "",
  );
  const [groupeM, setGroupeM] = useState(prospect.groupe ?? "");
  const [logicielM, setLogicielM] = useState<"" | "oui" | "non">(
    prospect.aLogiciel === true ? "oui" : prospect.aLogiciel === false ? "non" : prospect.logicielActuel ? "oui" : "",
  );
  const [logicielNomM, setLogicielNomM] = useState(prospect.logicielActuel ?? "");
  const [adminM, setAdminM] = useState<"" | "oui" | "non">(
    prospect.responsableAdmin === true ? "oui" : prospect.responsableAdmin === false ? "non" : "",
  );
  // Plusieurs angles peuvent coexister : chacun est une cartouche pour un mail
  // ou une relance. On coche, on ne choisit plus.
  const [anglesM, setAnglesM] = useState<string[]>(anglesDe(prospect));
  const [effectifReelM, setEffectifReelM] = useState(prospect.effectifReel ?? "");
  const [devM, setDevM] = useState<"" | "oui" | "non">(
    prospect.enDeveloppement === true ? "oui" : prospect.enDeveloppement === false ? "non" : "",
  );
  const [siteM, setSiteM] = useState<"" | "pro" | "bancal" | "aucun">(prospect.siteEtat ?? "");
  const [resumeM, setResumeM] = useState(prospect.etudeResume ?? "");

  const prompt = construirePromptRecherche(prospect, metier);
  // Le mail proposé est enregistré avec l'étude, sauf refus explicite.
  const [garderMail, setGarderMail] = useState(true);
  const fiche = useMemo(() => parserFicheEtude(texte), [texte]);
  const dejaEtudie = !!(
    prospect.etudeAt || prospect.dirigeant || prospect.personnalisation ||
    prospect.etudeResume || prospect.aLogiciel !== undefined
  );

  const marquerLance = async (lance: boolean) => {
    setPromptLance(lance);
    try {
      await definirPromptLance(prospect.id, lance);
    } catch {
      setPromptLance(!lance);
      onToast("Le marquage n'a pas pu être enregistré.");
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopie(true);
      onToast("Prompt copié — colle-le dans ton assistant IA.");
      if (!promptLance) void marquerLance(true);
    } catch {
      onToast("Copie impossible : sélectionne le texte à la main.");
    }
  };

  const enregistrer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      // Le mail proposé ne fait pas partie de la fiche : il va dans `mailPerso`,
      // et seulement si Teddy le garde (case décochable).
      const { mailPropose, ...champsFiche } = fiche;
      await enregistrerEtude(prospect, champsFiche);
      if (mailPropose && garderMail) await definirMailPerso(prospect.id, mailPropose);
      onToast(
        mailPropose && garderMail
          ? "Fiche mise à jour, mail adapté enregistré."
          : "Fiche mise à jour depuis l'étude.",
      );
      onClose();
    } catch {
      onToast("Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  };

  const enregistrerManuel = async () => {
    setEnCours(true);
    try {
      await majInfosProspect(prospect, {
        dirigeant: dirigeantM.trim() || null,
        dirigeantAge: ageM.trim() || null,
        dirigeantJeune: profilM === "jeune" ? true : profilM === "senior" ? false : null,
        groupe: groupeM.trim() || null,
        angles: anglesM.length ? anglesM : null,
        etudeResume: resumeM.trim() || null,
        aLogiciel: logicielM === "oui" ? true : logicielM === "non" ? false : null,
        logicielActuel: logicielM === "oui" ? logicielNomM.trim() || null : null,
        responsableAdmin: adminM === "oui" ? true : adminM === "non" ? false : null,
        effectifReel: effectifReelM.trim() || null,
        enDeveloppement: devM === "oui" ? true : devM === "non" ? false : null,
        siteEtat: siteM || null,
      });
      onToast("Infos enregistrées sur la fiche.");
      onClose();
    } catch {
      onToast("Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  };

  const ongletCls = (actif: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${
      actif ? "bg-blue-600 text-white" : "border text-gray-600 hover:bg-gray-50"
    }`;

  const logDeja = logicielTexte(prospect.aLogiciel, prospect.logicielActuel);
  const logFiche = fiche ? logicielTexte(fiche.aLogiciel, fiche.logicielActuel) : null;
  const adminDeja = adminTexte(prospect.responsableAdmin);
  const adminFiche = fiche ? adminTexte(fiche.responsableAdmin) : null;
  const dateEtude = prospect.etudeAt ? prospect.etudeAt.toDate().toLocaleString("fr-FR") : null;
  const profilDeja =
    prospect.dirigeantJeune === true ? "gérant jeune" : prospect.dirigeantJeune === false ? "gérant senior" : null;

  return (
    <Modal isOpen onClose={onClose} title={`Étudier ${prospect.societe}`} size="lg">
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <button className={ongletCls(onglet === "prompt")} onClick={() => setOnglet("prompt")}>
            1 · Copier le prompt
          </button>
          <button className={ongletCls(onglet === "coller")} onClick={() => setOnglet("coller")}>
            2 · Coller le résultat
          </button>
          <button className={ongletCls(onglet === "manuel")} onClick={() => setOnglet("manuel")}>
            ✎ Saisie manuelle
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={promptLance} onChange={(e) => marquerLance(e.target.checked)} />
          J&apos;ai déjà lancé un prompt sur cette entreprise
          {prospect.promptLanceAt && (
            <span className="text-gray-400">
              (le {prospect.promptLanceAt.toDate().toLocaleString("fr-FR")})
            </span>
          )}
        </label>

        {dejaEtudie && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800 space-y-0.5">
            <div className="font-medium">
              Déjà connu{dateEtude ? ` — étude du ${dateEtude}` : ""} :
            </div>
            {dateEtude && (
              <div className="text-[11px] text-emerald-600">
                ⏱️ Récupéré le {dateEtude}. Le code évolue : si c&apos;est ancien, relance le prompt pour récupérer les nouveaux champs.
              </div>
            )}
            {prospect.dirigeant && <div>👤 Dirigeant : {prospect.dirigeant}</div>}
            {(prospect.dirigeantAge || profilDeja) && (
              <div>🎂 {[prospect.dirigeantAge, profilDeja].filter(Boolean).join(" · ")}</div>
            )}
            {prospect.groupe && <div>👥 Groupe : {prospect.groupe}</div>}
            {prospect.personnalisation && <div>✍ {prospect.personnalisation}</div>}
            {anglesDe(prospect).length > 0 && (
              <div>🎯 Angles : {anglesDe(prospect).map(angleLabel).join(" · ")}</div>
            )}
            {logDeja && <div>🧩 {logDeja}</div>}
            {adminDeja && <div>🗂️ {adminDeja}</div>}
            {prospect.effectifReel && <div>👷 {prospect.effectifReel} salariés (réel)</div>}
            {prospect.enDeveloppement === true && <div>📈 En développement</div>}
            {prospect.siteEtat && <div>🌐 {SITE_LABEL[prospect.siteEtat]}</div>}
            {prospect.etudeResume && (
              <div className="whitespace-pre-wrap text-emerald-700">{prospect.etudeResume}</div>
            )}
          </div>
        )}

        {onglet === "prompt" && (
          <>
            <p className="text-xs text-gray-500">
              Copie ce prompt dans ton assistant IA (ChatGPT, Claude…). Il te renseigne sur
              l&apos;entreprise ET finit par un bloc récapitulatif que tu colleras dans
              l&apos;onglet 2 pour remplir la fiche automatiquement.
            </p>
            <textarea
              readOnly
              value={prompt}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full h-64 border rounded-lg px-3 py-2 text-xs font-mono leading-relaxed outline-none focus:border-blue-400 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
                Fermer
              </button>
              <button
                onClick={copier}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
              >
                {copie ? "Copié ✓" : "Copier le prompt"}
              </button>
            </div>
          </>
        )}

        {onglet === "coller" && (
          <>
            <p className="text-xs text-gray-500">
              Colle ici la réponse de l&apos;IA (le bloc <code>===ENEZO-FICHE===</code> suffit,
              mais tu peux coller toute la réponse). Vérifie l&apos;aperçu, puis enregistre.
            </p>
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder="Colle la réponse de l'assistant IA ici…"
              className="w-full h-40 border rounded-lg px-3 py-2 text-xs font-mono leading-relaxed outline-none focus:border-blue-400 resize-none"
            />

            {texte.trim() && !fiche && (
              <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
                Rien de reconnu. Vérifie que le bloc récapitulatif (entre
                <code> ===ENEZO-FICHE=== </code> et <code> ===FIN-FICHE=== </code>) est bien présent.
              </div>
            )}

            {fiche && (
              <div className="rounded-lg border px-3 py-2 text-xs space-y-1 bg-gray-50">
                <div className="font-medium text-gray-700">Aperçu — sera enregistré sur la fiche :</div>
                {fiche.email && (
                  <div>
                    <span className="text-gray-400">Email trouvé :</span> {fiche.email}
                    {!prospect.email?.trim() ? (
                      <span className="text-green-600 font-medium"> — sera ajouté à la fiche</span>
                    ) : (
                      <span className="text-gray-400"> — l&apos;email existant est gardé, celui-ci ira en note</span>
                    )}
                  </div>
                )}
                {fiche.dirigeant && (
                  <div><span className="text-gray-400">Dirigeant :</span> {fiche.dirigeant}</div>
                )}
                {(fiche.dirigeantAge || fiche.dirigeantJeune !== undefined) && (
                  <div>
                    <span className="text-gray-400">Gérant :</span>{" "}
                    {[fiche.dirigeantAge, fiche.dirigeantJeune === true ? "jeune" : fiche.dirigeantJeune === false ? "senior" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {fiche.groupe && (
                  <div><span className="text-gray-400">Groupe :</span> {fiche.groupe}</div>
                )}
                {fiche.personnalisation && (
                  <div><span className="text-gray-400">Personnalisation :</span> {fiche.personnalisation}</div>
                )}
                {fiche.angles && fiche.angles.length > 0 && (
                  <div><span className="text-gray-400">Angles :</span> {fiche.angles.map(angleLabel).join(" · ")}</div>
                )}
                {logFiche && (
                  <div><span className="text-gray-400">Logiciel :</span> {logFiche}</div>
                )}
                {adminFiche && (
                  <div><span className="text-gray-400">Admin :</span> {adminFiche}</div>
                )}
                {fiche.effectifReel && (
                  <div><span className="text-gray-400">Effectif réel :</span> {fiche.effectifReel}</div>
                )}
                {fiche.enDeveloppement === true && (
                  <div><span className="text-gray-400">Développement :</span> en croissance</div>
                )}
                {fiche.siteEtat && (
                  <div><span className="text-gray-400">Site :</span> {SITE_LABEL[fiche.siteEtat]}</div>
                )}
                {fiche.etudeResume && (
                  <div className="whitespace-pre-wrap">
                    <span className="text-gray-400">Fiche :</span> {fiche.etudeResume}
                  </div>
                )}
              </div>
            )}

            {/* Mail proposé par l'étude — pas encore enregistré, et toujours modifiable ensuite */}
            {fiche?.mailPropose && (
              <div className="border border-violet-200 bg-violet-50/60 rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-violet-800">
                    Mail proposé pour {prospect.societe}
                  </p>
                  <label className="flex items-center gap-1.5 text-[11px] text-violet-800 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={garderMail}
                      onChange={(e) => setGarderMail(e.target.checked)}
                      className="accent-violet-600"
                    />
                    L&apos;enregistrer
                  </label>
                </div>
                <div className="bg-white border rounded-lg p-2.5 text-xs text-gray-700 space-y-2">
                  {fiche.mailPropose.objet && (
                    <div><span className="text-gray-400">Objet :</span> {fiche.mailPropose.objet}</div>
                  )}
                  {fiche.mailPropose.scene && (
                    <div className="whitespace-pre-wrap">{fiche.mailPropose.scene}</div>
                  )}
                  {fiche.mailPropose.exemples && (
                    <div className="whitespace-pre-wrap">{fiche.mailPropose.exemples}</div>
                  )}
                  {fiche.mailPropose.question && (
                    <div className="whitespace-pre-wrap font-medium">{fiche.mailPropose.question}</div>
                  )}
                </div>
                <p className="text-[11px] text-violet-700">
                  Il remplacera le mail du kit pour cette société uniquement. Tu pourras le
                  corriger ensuite avec le crayon « Adapter le mail », ou revenir au kit d&apos;un clic.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
                Annuler
              </button>
              <button
                onClick={enregistrer}
                disabled={!fiche || enCours}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enCours ? "Enregistrement…" : "Enregistrer sur la fiche"}
              </button>
            </div>
          </>
        )}

        {onglet === "manuel" && (
          <>
            <p className="text-xs text-gray-500">
              Pour une entreprise que tu connais déjà : renseigne à la main ce que tu sais.
              Laisse vide ce que tu ignores.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Dirigeant</label>
                <input
                  value={dirigeantM}
                  onChange={(e) => setDirigeantM(e.target.value)}
                  placeholder="Nom de la personne"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Âge / année de naissance du dirigeant</label>
                <input
                  value={ageM}
                  onChange={(e) => setAgeM(e.target.value)}
                  placeholder="Ex : 43 ans, 1981"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Profil du dirigeant</label>
                <select value={profilM} onChange={(e) => setProfilM(e.target.value as typeof profilM)} className={inputCls}>
                  <option value="">On ne sait pas</option>
                  <option value="jeune">Jeune (&lt; ~45 ans, réceptif au numérique)</option>
                  <option value="senior">Senior (&gt; ~55 ans, fin de carrière)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Groupe / holding (si lié à d&apos;autres sociétés)</label>
                <input
                  value={groupeM}
                  onChange={(e) => setGroupeM(e.target.value)}
                  placeholder="Ex : Groupe BIBARD"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>
                Angles qui collent <span className="text-gray-400">(plusieurs possibles)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ANGLES.map((a) => {
                  const actif = anglesM.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={a.quoi}
                      onClick={() =>
                        setAnglesM((prev) =>
                          prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs border transition ${
                        actif
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-gray-200 text-gray-600 hover:border-blue-300"
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Chaque angle retenu est une cartouche : premier mail, puis relance sous un autre angle.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Logiciel de gestion ?</label>
                <select
                  value={logicielM}
                  onChange={(e) => setLogicielM(e.target.value as typeof logicielM)}
                  className={inputCls}
                >
                  <option value="">On ne sait pas</option>
                  <option value="oui">Oui, il en a un</option>
                  <option value="non">Non, pas de logiciel</option>
                </select>
              </div>
              {logicielM === "oui" && (
                <div>
                  <label className={labelCls}>Nom du logiciel (optionnel)</label>
                  <input
                    value={logicielNomM}
                    onChange={(e) => setLogicielNomM(e.target.value)}
                    placeholder="Ex : Batappli"
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Responsable administratif dédié ?</label>
                <select value={adminM} onChange={(e) => setAdminM(e.target.value as typeof adminM)} className={inputCls}>
                  <option value="">On ne sait pas</option>
                  <option value="oui">Oui, une personne dédiée</option>
                  <option value="non">Non, le dirigeant gère tout</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>En développement ?</label>
                <select value={devM} onChange={(e) => setDevM(e.target.value as typeof devM)} className={inputCls}>
                  <option value="">On ne sait pas</option>
                  <option value="oui">Oui (recrutement, CA↑, rachat récent…)</option>
                  <option value="non">Non, rien de notable</option>
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Nombre de salariés réel</label>
                <input
                  value={effectifReelM}
                  onChange={(e) => setEffectifReelM(e.target.value)}
                  placeholder="Ex : 8"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>État du site web</label>
                <select value={siteM} onChange={(e) => setSiteM(e.target.value as typeof siteM)} className={inputCls}>
                  <option value="">On ne sait pas</option>
                  <option value="pro">Propre et pro</option>
                  <option value="bancal">Bancal / à refaire</option>
                  <option value="aucun">Pas de site</option>
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Infos / fiche (effectif réel, organisation, notes…)</label>
              <textarea
                value={resumeM}
                onChange={(e) => setResumeM(e.target.value)}
                placeholder="Ex : 12 personnes, 8 sur le terrain. Le patron gère les devis le soir…"
                className="w-full h-28 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
                Annuler
              </button>
              <button
                onClick={enregistrerManuel}
                disabled={enCours}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enCours ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
