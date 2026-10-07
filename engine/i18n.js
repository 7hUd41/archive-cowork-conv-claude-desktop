// Cowork Session Archiver — i18n.js
// authors: 7hud41
// license: MIT
//
// Tiny translation layer. Source strings are English and double as dictionary keys;
// `t('Download ZIP')` returns the French string when the UI language is "fr", else the key itself.
// Placeholders use {name} and are substituted after lookup. The chosen language is persisted
// in localStorage and applied to static markup through data-i18n / data-i18n-title / data-i18n-placeholder.

const I18N = {
  languages: { en: 'English', fr: 'Français' },
  storageKey: 'csa-lang',
  fr: {
    // --- generic UI ---
    'Download ZIP': 'Télécharger le ZIP',
    '1. Fetch the conversation': '1. Récupérer la conversation',
    '2. Download ZIP': '2. Télécharger le ZIP',
    'ZIP by day': 'ZIP par jour',
    'One folder per day, each with the full .md of that day and its images': 'Un dossier par jour, chacun avec le .md complet du jour et ses images',
    'Mode: reading': 'Mode : lecture',
    'Mode: full details': 'Mode : infos complètes',
    'Export this day (.md)': 'Exporter ce jour (.md)',
    'Export this day as .md, ready to feed back to Claude after a compaction': 'Exporter cette journée en .md, à redonner à Claude pour combler une compaction',
    'uploaded images': 'images envoyées',
    'files written by Claude': 'fichiers écrits par Claude',
    'transcript.md + transcript.html': 'transcript.md + transcript.html',
    'show technical events': 'afficher les événements techniques',
    'technical events': 'événements techniques',
    'Language': 'Langue',
    'Session': 'Session',
    'Archiving session': 'Archivage de la session',
    'Cowork session archive': 'Archivage de la session Cowork',
    '(none)': '(aucune)',
    'Pick a day…  (show all)': 'Choisir un jour…  (tout afficher)',
    '{label} — {user} from you, {claude} from Claude': '{label} — {user} de toi, {claude} de Claude',
    'Pick a day in the menu first.': 'Choisis d\'abord un jour dans le menu.',
    'Day {key} exported as .md': 'Journée {key} exportée en .md',
    'Missing or invalid session id.': 'Identifiant de session manquant ou invalide.',
    'Failed: {msg}': 'Échec : {msg}',
    'Failed (by day): {msg}': 'Échec (par jour) : {msg}',
    'Compressing ZIP…': 'Compression du ZIP…',
    'Compressing the by-day ZIP…': 'Compression du ZIP par jour…',
    'Archive downloaded: {name} ({size} MB)': 'Archive téléchargée : {name} ({size} Mo)',
    'By-day archive downloaded: {name} — {n} folder(s) ({size} MB)': 'Archive par jour téléchargée : {name} — {n} dossier(s) ({size} Mo)',
    '{n} image(s) extracted.': '{n} image(s) extraite(s).',
    '{n} file(s) written by Claude rebuilt.': '{n} fichier(s) écrit(s) par Claude reconstitué(s).',
    'transcript.html generated (standalone preview).': 'transcript.html généré (aperçu autonome).',
    'transcript.html not generated: {msg}': 'transcript.html non généré : {msg}',
    'Preview ready: {user} messages from you, {claude} from Claude, {tools} tool calls, {images} images. Check it, then download the ZIP.': 'Aperçu prêt : {user} messages de toi, {claude} de Claude, {tools} appels d\'outil, {images} images. Vérifie, puis télécharge le ZIP.',
    'Preview ready: {user} messages from you, {claude} from Claude, {tools} tool calls, {images} images.': 'Aperçu prêt : {user} messages de toi, {claude} de Claude, {tools} appels d\'outil, {images} images.',

    // --- fetching ---
    'Session metadata fetched.': 'Métadonnées de session récupérées.',
    'Session metadata unavailable ({msg}) — continuing.': 'Métadonnées de session indisponibles ({msg}) — on continue.',
    'Page 1: {url}': 'Page 1 : {url}',
    'Unexpected response: no "data" array.': 'Réponse inattendue : pas de tableau "data".',
    '  {n} events, next_cursor = {cursor}': '  {n} événements, next_cursor = {cursor}',
    '  parameter "{p}" rejected: {msg}': '  paramètre "{p}" refusé : {msg}',
    '  parameter "{p}" ignored by the server (same events)': '  paramètre "{p}" ignoré par le serveur (mêmes événements)',
    'Cannot paginate past sequence {seq}: no cursor parameter accepted. The archive will be partial.': 'Impossible de paginer au-delà de la séquence {seq} : aucun paramètre de curseur accepté. L\'archive sera partielle.',
    'Page {page} ({param}={cursor}): {n} events, next_cursor = {next}': 'Page {page} ({param}={cursor}) : {n} événements, next_cursor = {next}',
    'Same cursor as the previous page, stopping.': 'Curseur identique à la page précédente, arrêt.',
    'Total: {n} events, sequences {min} → {max}.': 'Total : {n} événements, séquences {min} → {max}.',
    'Missing sequences: {list}': 'Séquences absentes : {list}',
    'The oldest sequence received is {min} (not 1): check that the preview starts at the beginning.': 'La plus ancienne séquence reçue est {min} (pas 1) : vérifie que l\'aperçu commence bien au début.',

    // --- transcript / preview labels ---
    'You': 'Vous',
    'Claude': 'Claude',
    'Agent': 'Agent',
    'Message to the agent': 'Message vers l\'agent',
    'Agent activity': 'Activité de l\'agent',
    'Activity': 'Activité',
    '{n} action(s)': '{n} action(s)',
    'COMPACTION SUMMARY — context kept by Claude (this is NOT a message from the user)': 'RÉSUMÉ DE COMPACTION — contexte retenu par Claude (ce n\'est PAS un message de l\'utilisateur)',
    'Compaction summary': 'Résumé de compaction',
    'context kept by Claude — this is NOT a message from the user': 'contexte retenu par Claude — ce n\'est PAS un message de l\'utilisateur',
    'injected system reminder (see events.json)': 'rappel système injecté (voir events.json)',
    'injected system reminder': 'rappel système injecté',
    'injected technical note': 'note technique injectée',
    '[uploaded image #{n}]': '[image envoyée n°{n}]',
    '(uploaded image — see images/ in the archive)': '(image envoyée — voir images/ dans l\'archive)',
    'tool': 'outil',
    'result of {tool}: {text}': 'résultat de {tool} : {text}',
    '[attached document]': '[document joint]',
    '[{type} block]': '[bloc {type}]',
    '{type} block': 'bloc {type}',
    'attachment: {name} ({kind})': 'pièce jointe : {name} ({kind})',
    '(attachment: {name}{note})': '(pièce jointe : {name}{note})',
    ' — content not included': ' — contenu non inclus',
    'image': 'image',
    'file': 'fichier',
    'end of turn': 'fin de tour',
    'end of turn {n}': 'fin de tour {n}',
    'ERROR': 'ERREUR',
    'environment started': 'démarrage de l\'environnement',
    'model': 'modèle',
    'Reasoning (thinking) blocks are empty in the API and cannot be archived. The complete raw log is in events.json.': 'Les blocs de raisonnement (thinking) sont vides dans l\'API et ne peuvent pas être archivés. Le journal brut complet est dans events.json.',
    'Session: `{id}`': 'Session : `{id}`',
    'Archived on: {when}': 'Archivé le : {when}',
    'Events: {n}': 'Événements : {n}',
    'Events': 'Événements',
    'Time zone of displayed times: {tz} (raw timestamps in events.json are UTC)': 'Fuseau horaire des heures affichées : {tz} (les horodatages bruts d\'events.json sont en UTC)',
    'browser time zone': 'fuseau du navigateur',
    '[binary data ~{kb} KB omitted]': '[données binaires ~{kb} Ko omises]',
    '{day} at {time}': '{day} à {time}',
    'unnamed': 'sans-nom',
    '(unnamed)': '(sans nom)',
    'FILE': 'FICHIER',
    'content not included in the API': 'contenu non inclus dans l\'API',
    'image {n}': 'image {n}',
    'parameters · id {id} · #{seq}': 'paramètres · id {id} · #{seq}',
    '✓ result · ': '✓ résultat · ',
    '✗ result (error) · ': '✗ résultat (erreur) · ',
    'tool result without a matching call · {when}': 'résultat d\'outil sans appel associé · {when}',
    'shared on {when}': 'partagé le {when}',
    'turn summary: {text}': 'résumé du tour : {text}',
    'system': 'système',
    'environment': 'environnement',
    'suggested prompt: “{text}”': 'suggestion proposée : « {text} »',
    '{n} internal exchange(s)': '{n} échange(s) interne(s)',
    '{n} permission(s) denied': '{n} permission(s) refusée(s)',
    'Title': 'Titre',
    'Period': 'Période',
    'Time zone': 'Fuseau',
    'times shown in {tz} (raw timestamps in UTC)': 'heures affichées en {tz} (horodatages bruts en UTC)',
    '{n} (sequences {min} → {max})': '{n} (séquences {min} → {max})',
    'Messages': 'Messages',
    '{user} from you · {claude} from Claude · {turns} turns': '{user} de vous · {claude} de Claude · {turns} tours',
    '{tools} tool call(s) · {images} uploaded image(s)': '{tools} appel(s) d\'outil · {images} image(s) envoyée(s)',
    'Compactions': 'Compactions',
    '{n} compaction summary(ies) found': '{n} résumé(s) de compaction repéré(s)',

    // --- tool headlines / categories ---
    'writes file {path}': 'écrit le fichier {path}',
    'edits file {path}': 'modifie le fichier {path}',
    'reads {path}': 'lit {path}',
    'runs {cmd}': 'exécute {cmd}',
    'searches {pattern}': 'cherche {pattern}',
    ' in {path}': ' dans {path}',
    'web search “{q}”': 'recherche web « {q} »',
    'reads page {url}': 'lit la page {url}',
    'Project · {method}': 'Projet · {method}',
    'sends {files}': 'envoie {files}',
    'starts an agent{type}: {desc}': 'lance un agent{type} : {desc}',
    'asks a question': 'pose une question',
    'task: {subject}': 'tâche : {subject}',
    'task #{id} → {status}': 'tâche #{id} → {status}',
    'updated': 'mise à jour',
    'loads skill {skill}': 'charge la compétence {skill}',
    'loads tools ({q})': 'charge des outils ({q})',
    'file created': 'fichier créé',
    'file edited': 'fichier modifié',
    'file read': 'fichier lu',
    'command run': 'commande exécutée',
    'file search': 'recherche dans les fichiers',
    'web search': 'recherche web',
    'web page read': 'page web lue',
    'project updated': 'projet mis à jour',
    'project read': 'projet consulté',
    'file shared': 'fichier partagé',
    'agent started': 'agent lancé',
    'question asked': 'question posée',
    'task list': 'liste de tâches',
    'skill loaded': 'compétence chargée',
    'tools loaded': 'outils chargés',
    'connector {name}': 'connecteur {name}',

    // --- file kinds ---
    'File': 'Fichier',
    'Image': 'Image',
    'Document': 'Document',
    'Spreadsheet': 'Tableur',
    'Presentation': 'Présentation',
    'Archive': 'Archive',
    'Code': 'Code',
    'Audio': 'Audio',
    'Video': 'Vidéo',
    'B': 'o', 'KB': 'Ko', 'MB': 'Mo', 'GB': 'Go', 'TB': 'To',

    // --- by-day export ---
    '{title} — day {label}': '{title} — journée du {label}',
    'Time zone: {tz} (days are split in this zone; raw timestamps in UTC)': 'Fuseau horaire : {tz} (journée découpée dans ce fuseau ; horodatages bruts en UTC)',
    'Cowork archive extract (session `{id}`), **full day**, meant to be fed back to Claude to re-ingest this day after a mid-day compaction. Full text, nothing is summarised.': 'Extrait d\'archive Cowork (session `{id}`), **journée complète**, destiné à être redonné à Claude pour réingérer cette journée après une compaction de mi-journée. Texte intégral, rien n\'est résumé.',
    'Sequences #{min} to #{max}.': 'Séquences #{min} à #{max}.',
    '{title} — archive by day': '{title} — archive par jour',
    'Session `{id}` · {n} day(s) · generated on {when}': 'Session `{id}` · {n} jour(s) · généré le {when}',
    '| Day | You | Claude | Images | Files |': '| Jour | Toi | Claude | Images | Fichiers |',
    'archived on': 'archivé le',
    'session': 'session',
    'Cowork archive': 'archive Cowork',

    // --- manifest notes ---
    'events.json = raw log, untouched, sorted by ascending sequence_num.': 'events.json = journal brut, intact, trié par sequence_num croissant.',
    'Uploaded images are embedded as base64 in events.json and extracted into images/.': 'Les images envoyées sont embarquées en base64 dans events.json et extraites dans images/.',
    'Non-image uploads are only referenced by name and uuid: their content is not in the events API.': 'Les fichiers non-image envoyés ne sont référencés que par nom et uuid : leur contenu n\'est pas dans l\'API events.',
    'Thinking blocks are empty server-side.': 'Les blocs thinking sont vides côté serveur.',
    'transcript.html = the same preview as in the extension, standalone (fonts and images embedded), reading mode by default.': 'transcript.html = le même aperçu que dans l\'extension, autonome (polices et images embarquées), mode lecture par défaut.',

    // --- popup ---
    'Cowork Session Archiver': 'Cowork Session Archiver',
    'Looking for a session in the active tab…': 'Recherche d\'une session dans l\'onglet actif…',
    'Session id': 'Identifiant de session',
    'cse_… or session_…': 'cse_… ou session_…',
    'Archive this session': 'Archiver cette session',
    'The archive opens in a new tab and downloads as a ZIP. Everything happens in your browser, with your existing claude.ai session.': 'L\'archive s\'ouvre dans un nouvel onglet et se télécharge en ZIP. Tout se passe dans ton navigateur, avec ta session claude.ai déjà connectée.',
    'Session detected: ': 'Session détectée : ',
    'No Cowork session in the active tab. Open a claude.ai/cowork/cse_… page or paste the id below.': 'Aucune session Cowork dans l\'onglet actif. Ouvre une page claude.ai/cowork/cse_… ou colle l\'identifiant ci-dessous.',

    // --- local viewer (desktop) ---
    'Cowork Local Viewer': 'Cowork Local Viewer',
    'Cowork Archive Viewer': 'Cowork Archive Viewer',
    'Read-only, 100% local.': 'Lecture seule, 100 % local.',
    'This page runs offline in your browser: nothing is sent anywhere, nothing on your disk is modified. It reads what you drop and lets you view and export it.': 'Cette page tourne hors ligne dans ton navigateur : rien n\'est envoyé, rien n\'est modifié sur ton disque. Elle lit ce que tu déposes et te laisse l\'afficher et l\'exporter.',
    'Drop a <b>local_…</b> folder and its <b>local_….json</b> here (select both in the Finder, drop them together)': 'Glisse ici le dossier <b>local_…</b> et son <b>local_….json</b> (sélectionne les deux dans le Finder, dépose-les ensemble)',
    'You can drop several sessions at once. Dropping works anywhere on the page, and drops add up.': 'Tu peux déposer plusieurs sessions à la fois. Le dépôt marche n\'importe où sur la page, et les dépôts s\'additionnent.',
    '<b>Projects:</b> drop <b>spaces.json</b> (in <code>Application Support/Claude/</code>) to see which project each session belongs to.': '<b>Projets :</b> dépose <b>spaces.json</b> (dans <code>Application Support/Claude/</code>) pour voir à quel projet appartient chaque session.',
    '<b>Reopen an archive:</b> drop a downloaded <b>ZIP</b> here (or its unzipped folder): same view, reading/full mode, day filter, re-export.': '<b>Relire une archive :</b> dépose un <b>ZIP</b> téléchargé ici (ou son dossier décompressé) : même vue, mode lecture/technique, filtre par jour, ré-export.',
    '<b>Index of all sessions:</b> drop only the <b>local_….json</b> files (in the Finder, type “.json” in the search box of the sessions folder, select all, drop) then “Build the index”.': '<b>Index de toutes les sessions :</b> dépose uniquement les fichiers <b>local_….json</b> (dans le Finder, tape « .json » dans la recherche du dossier des sessions, sélectionne tout, dépose) puis « Construire l\'index ».',
    'Drop a downloaded archive here: a <b>ZIP</b> or its unzipped folder (the one containing <b>events.json</b>)': 'Dépose ici une archive téléchargée : un <b>ZIP</b> ou son dossier décompressé (celui qui contient <b>events.json</b>)',
    'Same view as when it was exported: reading or full-details mode, day filter, day export, re-export. Drops add up.': 'Même vue qu\'à l\'export : mode lecture ou infos complètes, filtre par jour, export du jour, ré-export. Les dépôts s\'additionnent.',
    '…or choose a folder': '…ou choisir un dossier',
    'Sessions found — click to display': 'Sessions trouvées — clique pour afficher',
    'Search a title…': 'Rechercher un titre…',
    'Build the index (.csv + .md)': 'Construire l\'index (.csv + .md)',
    'Downloads a .csv (Numbers/Excel) and a .md: project, title, id, dates, size — for every listed session': 'Télécharge un .csv (Numbers/Excel) et un .md : projet, titre, identifiant, dates, taille — pour toutes les sessions listées',
    'Time zone:': 'Fuseau :',
    'Files only keep the UTC instant, not the place: pick the time zone you were in during this session. Remembered per session.': 'Les fichiers ne gardent que l\'instant UTC, pas le lieu : choisis le fuseau où tu étais pendant cette session. Mémorisé par session.',
    'Default': 'Par défaut',
    'Use this time zone for every session without a remembered choice': 'Utiliser ce fuseau pour toutes les sessions sans choix mémorisé',
    'Toronto / Montréal (Eastern)': 'Toronto / Montréal (heure de l\'Est)',
    'Paris': 'Paris',
    'UTC (raw)': 'UTC (brut)',
    'Vancouver': 'Vancouver',
    'London': 'Londres',
    'Lisbon': 'Lisbonne',
    'Tokyo': 'Tokyo',
    'Error: {msg}': 'Erreur : {msg}',
    'Drop received — {items} item(s) [{kinds}], {files} flat file(s). Reading…': 'Dépôt reçu — {items} élément(s) [{kinds}], {files} fichier(s) plats. Lecture…',
    '(no items)': '(pas d\'items)',
    '{n} file(s) read: {list}': '{n} fichier(s) lus : {list}',
    'Nothing received by drag-and-drop. If you opened the page by double-clicking it (file:// address), start it with node server.js: Chrome does not read folders dropped on a file:// page.': 'Rien reçu par glisser-déposer. Si tu as ouvert la page en double-cliquant (adresse file://), lance-la avec node server.js : Chrome ne lit pas les dossiers déposés sur une page file://.',
    '{n} file(s) in the chosen folder. Reading…': '{n} fichier(s) dans le dossier choisi. Lecture…',
    'spaces.json read: {n} known project(s) ({list}).': 'spaces.json lu : {n} projet(s) connus ({list}).',
    'spaces.json unreadable: {msg}': 'spaces.json illisible : {msg}',
    'remote-sessions-spaces.json read: {n} cloud session(s) linked to a folder.': 'remote-sessions-spaces.json lu : {n} session(s) cloud rattachée(s) à un dossier.',
    'remote-sessions-spaces.json unreadable: {msg}': 'remote-sessions-spaces.json illisible : {msg}',
    '(inferred)': '(déduit)',
    '(folder)': '(dossier)',
    'ZIP {name} unreadable: {msg}': 'ZIP {name} illisible : {msg}',
    'Archive {name} unreadable: {msg}': 'Archive {name} illisible : {msg}',
    '(title inferred from the first message)': '(titre déduit du 1er message)',
    'No session listed: drop local_….json files first (and spaces.json for projects).': 'Aucune session listée : dépose d\'abord des local_….json (et spaces.json pour les projets).',
    'project': 'projet',
    'project_source': 'projet_source',
    'title': 'titre',
    'id': 'identifiant',
    'created_utc': 'creee_le_utc',
    'last_activity_utc': 'derniere_activite_utc',
    'time_zone': 'fuseau',
    'created_local': 'creee_le_locale',
    'last_activity_local': 'derniere_activite_locale',
    'conversation_dropped': 'conversation_deposee',
    'audit_kb': 'audit_ko',
    'uploads': 'envois',
    'outputs': 'produits',
    'archived': 'archivee',
    'project_folder': 'dossier_projet',
    'yes': 'oui',
    'no': 'non',
    '# Index of local Cowork sessions — {date}': '# Index des sessions Cowork locales — {date}',
    '{n} session(s) listed · {projects} linked to a project · {convs} with their conversation dropped.': '{n} session(s) listée(s) · {projects} rattachée(s) à un projet · {convs} avec leur conversation déposée.',
    'Columns: title · id (folder `local_<id>`) · created → last activity (in the time zone chosen for the session, default {tz}; the CSV also gives raw UTC) · audit size · Conv = conversation dropped in this page.': 'Colonnes : titre · identifiant (dossier `local_<id>`) · créée → dernière activité (dans le fuseau choisi pour la session, défaut {tz} ; le CSV donne aussi l\'UTC brut) · taille de l\'audit · Conv = conversation déposée dans cette page.',
    '(no project identified)': '(sans projet identifié)',
    '## {name} — {n} session(s)': '## {name} — {n} session(s)',
    'Project folder(s): {folders}  ·  project id: `{id}`': 'Dossier(s) du projet : {folders}  ·  identifiant du projet : `{id}`',
    '| Title | Id | Created | Last activity | Time zone | Audit | Conv | Archived |': '| Titre | Identifiant | Créée | Dernière activité | Fuseau | Audit | Conv | Archivée |',
    '## Cloud sessions (remote-sessions-spaces.json)': '## Sessions cloud (remote-sessions-spaces.json)',
    'These sessions live on claude.ai (archive them with the browser extension); this file only gives their folder, not their title.': 'Ces sessions vivent sur claude.ai (à archiver avec l\'extension navigateur) ; ce fichier ne donne que leur dossier, pas leur titre.',
    '| Cloud id | Project | Folder(s) |': '| Identifiant cloud | Projet | Dossier(s) |',
    '## Known projects (spaces.json)': '## Projets connus (spaces.json)',
    '| Project | Sessions listed here | Folder(s) | Created |': '| Projet | Sessions listées ici | Dossier(s) | Créé |',
    'Index exported: {csv} (separator ; — Numbers/Excel) + {md} ({n} sessions, {groups} group(s)).': 'Index exporté : {csv} (séparateur ; — Numbers/Excel) + {md} ({n} sessions, {groups} groupe(s)).',
    '{n} project(s) loaded from spaces.json{remote}. Now drop local_….json files (index) and/or local_… folders (conversations).': '{n} projet(s) chargé(s) depuis spaces.json{remote}. Dépose maintenant les local_….json (index) et/ou les dossiers local_… (conversations).',
    ' + {n} cloud session(s)': ' + {n} session(s) cloud',
    'No session found among {n} received file(s) ({list}). Drop local_… folders (conversation), local_….json files (index), spaces.json (projects), an audit.jsonl, or an exported archive (ZIP).': 'Aucune session trouvée parmi {n} fichier(s) reçus ({list}). Dépose des dossiers local_… (conversation), des local_….json (index), spaces.json (projets), un audit.jsonl, ou une archive exportée (ZIP).',
    'No archive found among {n} received file(s) ({list}). Drop an exported ZIP or its unzipped folder (the one containing events.json).': 'Aucune archive trouvée parmi {n} fichier(s) reçus ({list}). Dépose un ZIP exporté ou son dossier décompressé (celui qui contient events.json).',
    'All projects ({n})': 'Tous les projets ({n})',
    'No project identified ({n})': 'Sans projet identifié ({n})',
    '{n} session(s)': '{n} session(s)',
    'archive reopened ({name}{exported}{events})': 'archive relue ({name}{exported}{events})',
    ', exported on {when}': ', exportée le {when}',
    ', {n} events': ', {n} événements',
    'audit {size}': 'audit {size}',
    'conversation not dropped (drop the local_{id}… folder to open it)': 'conversation non déposée (dépose le dossier local_{id}… pour l\'ouvrir)',
    '{n} upload(s)': '{n} envoi(s)',
    '{n} output(s)': '{n} produit(s)',
    'archived': 'archivée',
    '{n} session(s) listed: {titles} with their official title, {convs} with their conversation, {projects} linked to a project{hint}.': '{n} session(s) listée(s) : {titles} avec leur titre officiel, {convs} avec leur conversation, {projects} rattachée(s) à un projet{hint}.',
    ' (drop spaces.json for project names)': ' (dépose spaces.json pour les noms de projets)',
    'To get every title, also drop the local_….json files (next to the local_… folders).': 'Pour avoir tous les titres, dépose aussi les fichiers local_….json (à côté des dossiers local_…).',
    '{n} session(s) listed — only titles/dates/projects were read, no conversation is open. Click ONE session to display it, or “Build the index”.': '{n} session(s) listée(s) — seuls titres/dates/projets ont été lus, aucune conversation n\'est ouverte. Clique UNE session pour l\'afficher, ou « Construire l\'index ».',
    '{n} archive(s) listed. Click one to display it.': '{n} archive(s) listée(s). Clique-en une pour l\'afficher.',
    'This session only has its title (local_….json). To read the conversation, drop the local_{id} FOLDER.': 'Cette session n\'a que son titre (local_….json). Pour lire la conversation, dépose le DOSSIER local_{id}.',
    'project: {name}': 'projet : {name}',
    'Times shown in {tz}.': 'Heures affichées en {tz}.',
    'Times now shown in {tz} for this session (remembered).': 'Heures maintenant affichées en {tz} pour cette session (mémorisé).',
    'Default time zone: {tz}.': 'Fuseau par défaut : {tz}.',
    '{tz} is now the default time zone for sessions without a remembered choice.': '{tz} devient le fuseau par défaut des sessions sans choix mémorisé.',
    '{n} item(s) copied from the original archive.': '{n} pièce(s) recopiée(s) depuis l\'archive d\'origine.',
    'These files could not be re-read by the browser when the ZIP was built (reference invalidated: file modified since the drop, session still open in Cowork, cloud file not downloaded, or permissions).\nDrop the session again and retry to include them.\n\n': 'Ces fichiers n\'ont pas pu être relus par le navigateur au moment du ZIP (référence invalidée : fichier modifié depuis le dépôt, session encore ouverte dans Cowork, fichier cloud non téléchargé, ou permissions).\nRe-dépose la session et recommence pour les inclure.\n\n',
    '{n} file(s) not re-read — ZIP built without them (list in UNREADABLE-FILES.txt): {list}': '{n} fichier(s) non relu(s) — ZIP créé sans eux (liste dans UNREADABLE-FILES.txt) : {list}',
    '{n} local item(s) (uploads/, outputs/) + audit.jsonl added to the ZIP.': '{n} pièce(s) locale(s) (uploads/, outputs/) + audit.jsonl ajoutés au ZIP.',
  },
};

let LANG = 'en';

function t(key, vars) {
  let s = (LANG !== 'en' && I18N[LANG] && Object.prototype.hasOwnProperty.call(I18N[LANG], key)) ? I18N[LANG][key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

function currentLang() { return LANG; }
function dateLocale() { return LANG === 'fr' ? 'fr-FR' : 'en-GB'; }

function applyLang(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.documentElement.lang = LANG;
  const sel = document.getElementById('langSelect');
  if (sel && sel.value !== LANG) sel.value = LANG;
}

function setLang(lang, silent) {
  LANG = (lang === 'en' || I18N[lang]) ? lang : 'en';
  try { localStorage.setItem(I18N.storageKey, LANG); } catch (_) {}
  applyLang();
  if (!silent && typeof window.onLangChange === 'function') window.onLangChange(LANG);
}

function initLang() {
  let lang = 'en';
  try { lang = localStorage.getItem(I18N.storageKey) || 'en'; } catch (_) {}
  LANG = (lang === 'en' || I18N[lang]) ? lang : 'en';
  const sel = document.getElementById('langSelect');
  if (sel) {
    sel.innerHTML = '';
    for (const [code, name] of Object.entries(I18N.languages)) { const o = document.createElement('option'); o.value = code; o.textContent = name; sel.appendChild(o); }
    sel.value = LANG;
    sel.addEventListener('change', () => setLang(sel.value));
  }
  applyLang();
}
