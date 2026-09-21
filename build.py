#!/usr/bin/env python3
# Génère cowork-local-viewer.html : une page autonome (hors ligne) qui réutilise le moteur de l'extension
# pour afficher/exporter des sessions Cowork LOCALES déposées par glisser-déposer.
import base64, re, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "index.html")

def read(p): return open(os.path.join(ROOT, p), encoding="utf-8").read()
def b64(p): return base64.b64encode(open(os.path.join(ROOT, p), "rb").read()).decode()

FONTS = ["LibertinusSerif-Regular", "LibertinusSerif-Bold", "LibertinusSerif-Italic", "LibertinusSerif-BoldItalic", "FiraCode-Regular", "FiraCode-Bold"]

viewer_css = read("viewer.css")
viewer_js = read("viewer.js")
jszip = read("jszip.min.js")
archive = read("archive.js")

# 1) CSS avec polices intégrées
css_inline = viewer_css
for f in FONTS:
    css_inline = css_inline.replace(f'url("fonts/{f}.woff2")', f'url("data:font/woff2;base64,{b64("fonts/"+f+".woff2")}")')

# 2) archive.js : retirer l'init spécifique à l'extension (DOMContentLoaded), garder tout le moteur
i = archive.index("document.addEventListener('DOMContentLoaded'")
engine = archive[:i]
# hook : fichiers locaux ajoutés au ZIP avant le manifeste
engine = engine.replace("    zip.file('manifest.json', JSON.stringify(manifest, null, 2));",
                        "    if (window.LOCAL_EXTRA) await window.LOCAL_EXTRA(zip);\n    zip.file('manifest.json', JSON.stringify(manifest, null, 2));")
# coût : les audit.jsonl exposent total_cost_usd au lieu de modelUsage
engine = engine.replace("const cost = p.modelUsage ? Object.values(p.modelUsage).reduce((s, m) => s + (m.costUSD || 0), 0) : null;",
                        "const cost = p.modelUsage ? Object.values(p.modelUsage).reduce((s, m) => s + (m.costUSD || 0), 0) : (typeof p.total_cost_usd === 'number' ? p.total_cost_usd : null);")
assert "LOCAL_EXTRA" in engine

# 3) ressources servies via un faux chrome.runtime.getURL (data: URLs) pour buildTranscriptHtml
def data_url(mime, s): return f"data:{mime};base64," + base64.b64encode(s.encode("utf-8")).decode()
RES = {
    "viewer.css": data_url("text/css", viewer_css),
    "viewer.js": data_url("text/javascript", viewer_js),
}
for f in FONTS:
    RES["fonts/" + f + ".woff2"] = "data:font/woff2;base64," + b64("fonts/" + f + ".woff2")
res_js = "const RES = " + __import__("json").dumps(RES) + ";\nwindow.chrome = { runtime: { getURL: p => RES[p] || p } };"

loader = read("loader.js")

# Sécurité d'inlining : un "</script>" littéral dans du JS inline fermerait la balise HTML.
# Dans une chaîne/template JS, "<\/script>" vaut exactement "</script>", donc l'échappement est sans effet sur le code.
def safe_inline(js): return js.replace("</script>", "<\\/script>")
jszip = safe_inline(jszip); viewer_js = safe_inline(viewer_js); engine = safe_inline(engine); loader = safe_inline(loader)

html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cowork Local Viewer — sessions locales (lecture seule)</title>
<style>
{css_inline}
header {{ position: sticky; top: 0; z-index: 5; background: rgba(243,239,231,.96); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); padding: 12px 24px; }}
h1 {{ font-size: 18px; margin: 0 0 2px; }}
.sub {{ color: var(--muted); font-size: 13px; }}
.toolbar {{ display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }}
button:not(.btn) {{ padding: 8px 14px; font-size: 13px; font-weight: 600; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }}
button:not(.btn):disabled {{ background: #cfcac2; color: #fff; cursor: default; }}
.opts {{ font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 12px; }}
.bar {{ height: 6px; background: #e6e2da; border-radius: 3px; overflow: hidden; margin-top: 10px; }}
.bar > div {{ height: 100%; width: 0; background: var(--accent); transition: width .2s; }}
#log {{ font-family: "Fira Code", ui-monospace, Menlo, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; max-height: 160px; overflow: auto; margin: 16px auto 0; }}
#log:empty {{ display: none; }}
/* journal visible dans tous les modes (c'est le seul retour d'information en local) */
.ok {{ color: #2f7a3e; }} .warn {{ color: #b26b00; }} .err {{ color: #b3261e; }}
.safe {{ background: #eef6ea; border: 1px solid #cfe6c2; color: #2f5a34; font-size: 12.5px; border-radius: 10px; padding: 8px 12px; margin: 14px auto 0; }}
.drop {{ margin: 14px auto 0; border: 2px dashed #cbb9aa; border-radius: 14px; background: var(--paper); padding: 26px; text-align: center; color: var(--muted); transition: .15s; }}
.drop.over {{ border-color: var(--accent); background: #fff7f2; color: var(--ink); }}
.drop b {{ color: var(--ink); }}
.dstatus {{ margin: 10px auto 0; font-size: 13px; padding: 8px 12px; border-radius: 8px; background: #fff; border: 1px solid var(--line); color: var(--ink); white-space: pre-wrap; }}
.dstatus.ok {{ border-color: #cfe6c2; background: #eef6ea; color: #2f5a34; }}
.dstatus.warn {{ border-color: #f0d9a8; background: #fff7e6; color: #7a5200; }}
.dstatus.err {{ border-color: #f0b8b3; background: #fff0ee; color: #8a1f17; }}
.drop .big {{ font-size: 17px; color: var(--ink); line-height: 1.5; }}
.drop label.btn {{ display: inline-block; margin-top: 8px; cursor: pointer; }}
.drop .how {{ font-size: 13px; color: var(--muted); margin-top: 12px; line-height: 1.5; }}
input[type=file] {{ display: none; }}
#sessionsCard {{ margin: 14px auto 0; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }}
#sessionsCard h2 {{ font-size: 12px; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }}
#sessions {{ max-height: 260px; overflow: auto; }}
.srow {{ padding: 8px 10px; border-radius: 8px; cursor: pointer; }}
.srow:hover {{ background: #f4f1ea; }}
.srow.sel {{ background: #fdece4; }}
.stitle {{ font-size: 14px; font-weight: 600; }}
.smeta {{ font-size: 11.5px; color: var(--muted); }}
.srow.noconv .stitle {{ color: #6b665e; font-weight: 500; }}
.pchip {{ display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .02em; padding: 1px 8px; border-radius: 999px; background: #e7f0e2; color: #2f5a34; border: 1px solid #cfe6c2; margin-right: 8px; vertical-align: 1px; }}
.pchip.soft {{ background: #fff3e0; color: #7a5200; border-color: #f0d9a8; }}
select#daySelect {{ padding: 6px 8px; font-size: 12.5px; border: 1px solid var(--line); border-radius: 8px; max-width: 300px; }}
</style>
</head>
<body class="mode-hr">
<header>
  <div class="wrap">
    <h1>Cowork Local Viewer</h1>
    <div class="sub">Session <code id="sid">— aucune —</code></div>
    <div class="toolbar">
      <button id="zipBtn" disabled>Télécharger le ZIP</button>
      <button id="zipDayBtn" disabled title="Un dossier par jour, chacun avec le .md complet du jour et ses images">ZIP par jour</button>
      <button id="modeBtn" class="btn" data-mode="hr">Mode : lecture</button>
      <span id="dayExport" hidden style="display:inline-flex;gap:6px;align-items:center;">
        <select id="daySelect"></select>
        <button id="dayBtn" class="btn" disabled>Exporter ce jour (.md)</button>
      </span>
      <span id="tzWrap" style="display:inline-flex;gap:6px;align-items:center;" title="Les fichiers ne gardent que l'instant UTC, pas le lieu : choisis le fuseau où tu étais pendant cette session. Mémorisé par session.">
        <label for="tzSelect" style="font-size:12px;color:var(--muted);">Fuseau :</label>
        <select id="tzSelect" style="padding:6px 8px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;"></select>
        <button id="tzDefaultBtn" class="btn" title="Utiliser ce fuseau pour toutes les sessions sans choix mémorisé">Par défaut</button>
      </span>
      <div class="opts">
        <label><input type="checkbox" id="optImages" checked> images envoyées</label>
        <label><input type="checkbox" id="optWritten" checked> fichiers écrits par Claude</label>
        <label><input type="checkbox" id="optTranscript" checked> transcript.md + transcript.html</label>
        <label><input type="checkbox" id="optTech"> afficher les événements techniques</label>
      </div>
    </div>
    <div class="bar"><div id="progress"></div></div>
  </div>
</header>

<div class="wrap">
  <div class="safe">🔒 <b>Lecture seule, 100 % local.</b> Cette page tourne hors ligne dans ton navigateur : rien n'est envoyé, rien n'est modifié sur ton Mac. Elle lit ce que tu déposes et te laisse l'afficher et l'exporter.</div>
  <div id="drop" class="drop">
    <div class="big">Glisse ici le dossier <b>local_…</b> et son <b>local_….json</b> (sélectionne les deux dans le Finder, dépose-les ensemble)</div>
    <div class="how">Tu peux déposer plusieurs sessions à la fois. Le dépôt marche n'importe où sur la page, et les dépôts s'additionnent.<br>
    <b>Projets :</b> dépose <b>spaces.json</b> (dans <code>Application Support/Claude/</code>) pour voir à quel projet appartient chaque session.<br>
    <b>Relire une archive :</b> dépose un <b>ZIP</b> téléchargé ici (ou son dossier décompressé) : même vue, mode lecture/technique, filtre par jour, ré-export.<br>
    <b>Index de toutes les sessions :</b> dépose uniquement les fichiers <b>local_….json</b> (dans le Finder, tape « .json » dans la recherche du dossier des sessions, sélectionne tout, dépose) puis « Construire l'index ».<br>
    <label class="btn" for="dirInput">…ou choisir un dossier</label>
    <input type="file" id="dirInput" webkitdirectory directory multiple></div>
  </div>
  <div id="dropStatus" class="dstatus" hidden></div>
  <div id="sessionsCard" hidden>
    <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span>Sessions trouvées — clique pour afficher</span><span id="sessionsCount" style="font-weight:400;text-transform:none;letter-spacing:0;"></span><select id="projectSelect" hidden style="padding:6px 8px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;text-transform:none;letter-spacing:0;font-weight:400;max-width:260px;"></select><input id="sessionSearch" type="search" placeholder="Rechercher un titre…" hidden style="flex:1;min-width:160px;padding:6px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;text-transform:none;letter-spacing:0;font-weight:400;"><button id="csvBtn" class="btn" style="text-transform:none;letter-spacing:0;" title="Télécharge un .csv (Numbers/Excel) et un .md : projet, titre, identifiant, dates, taille — pour toutes les sessions listées">Construire l'index (.csv + .md)</button></h2>
    <div id="sessions"></div>
  </div>
  <div id="log"></div>
  <div id="summary"></div>
</div>
<div id="conv"></div>

<script>{res_js}</script>
<script>{jszip}</script>
<script>{viewer_js}</script>
<script>{engine}</script>
<script>{loader}</script>
</body>
</html>
"""
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8").write(html)
print("OK ->", OUT, f"({len(html)/1024/1024:.1f} Mo)")
