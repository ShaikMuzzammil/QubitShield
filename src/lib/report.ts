/**
 * Report & export utilities for every simulation in the app.
 *
 * Three formats, available everywhere a simulation runs:
 *  - JSON  → raw machine-readable inputs + outputs (reproducibility)
 *  - CSV   → tabular data for Excel / Python / MATLAB
 *  - HTML  → a print-ready formal report (Inputs / Outputs / Results tables)
 *            that opens in a new tab and automatically raises the print
 *            dialog so it can be saved as PDF in one click.
 */

export const PROJECT_TITLE = 'Interactive Quantum Error Correction Simulator';
export const PROJECT_SUBTITLE = 'Phase 2 Prototype · AMRITA VISHWA VIDYAPEETHAM';
export const TEAM_NAMES = ['K. Devendra Reddy', 'Shaik Muzzammil', 'D. Guna Samhith'];

export interface ReportCard {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
}

export interface ReportSection {
  heading: string;
  note?: string;
  /** key → value pairs (inputs, outputs, configuration) */
  kv?: [string, string][];
  cards?: ReportCard[];
  table?: { headers: string[]; rows: (string | number)[][] };
  text?: string;
  /** embedded image (e.g. circuit diagram snapshot) — data URL */
  image?: { dataUrl: string; caption?: string; maxWidth?: number };
  /** numbered step-by-step walkthrough ("how it came") */
  steps?: { title: string; body: string }[];
}

export interface ReportMeta {
  title: string;
  subtitle?: string;
  /** e.g. 'Single-Shot Pipeline', 'Monte Carlo Analysis', '3D Trajectory Lab' */
  runKind?: string;
}

export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function runId(): string {
  return `QEC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Raw file downloads                                                  */
/* ------------------------------------------------------------------ */

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadJSON(filename: string, data: unknown) {
  downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  downloadFile(filename, csv, 'text/csv;charset=utf-8');
}

/* ------------------------------------------------------------------ */
/* Printable HTML report                                               */
/* ------------------------------------------------------------------ */

const escHTML = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildReportHTML(meta: ReportMeta, sections: ReportSection[]): string {
  const stamp = nowStamp();
  const id = runId();

  const cardsHTML = (cards: ReportCard[]) => `
    <div class="cards">
      ${cards
        .map(
          (c) => `<div class="card ${c.tone ?? 'neutral'}">
            <div class="card-label">${escHTML(c.label)}</div>
            <div class="card-value">${escHTML(c.value)}</div>
          </div>`
        )
        .join('')}
    </div>`;

  const kvHTML = (kv: [string, string][]) => `
    <table class="kv">
      <tbody>
        ${kv.map(([k, v]) => `<tr><td class="k">${escHTML(k)}</td><td class="v">${escHTML(v)}</td></tr>`).join('')}
      </tbody>
    </table>`;

  const tableHTML = (t: NonNullable<ReportSection['table']>) => `
    <table class="grid">
      <thead><tr>${t.headers.map((h) => `<th>${escHTML(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${t.rows
          .map(
            (r, i) =>
              `<tr class="${i % 2 ? 'alt' : ''}">${r.map((c) => `<td>${escHTML(String(c))}</td>`).join('')}</tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  const stepsHTML = (steps: NonNullable<ReportSection['steps']>) => `
    <ol class="steps">
      ${steps
        .map(
          (st) =>
            `<li><div class="step-title">${escHTML(st.title)}</div><div class="step-body">${escHTML(st.body)}</div></li>`
        )
        .join('')}
    </ol>`;

  const sectionHTML = (s: ReportSection) => `
    <section>
      <h2>${escHTML(s.heading)}</h2>
      ${s.note ? `<p class="note">${escHTML(s.note)}</p>` : ''}
      ${s.image ? `<figure class="rpt-fig"><img src="${s.image.dataUrl}" style="max-width:${s.image.maxWidth ?? 100}%" /><figcaption>${escHTML(s.image.caption ?? '')}</figcaption></figure>` : ''}
      ${s.cards ? cardsHTML(s.cards) : ''}
      ${s.kv ? kvHTML(s.kv) : ''}
      ${s.table ? tableHTML(s.table) : ''}
      ${s.steps ? stepsHTML(s.steps) : ''}
      ${s.text ? `<p class="body-text">${escHTML(s.text)}</p>` : ''}
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHTML(meta.title)} — QEC Simulator Report</title>
<style>
  :root { --violet:#7c3aed; --violet-dark:#4c1d95; --cyan:#0891b2; --ink:#1e293b; --muted:#64748b; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: var(--ink); margin: 0; background:#f8fafc; }
  .page { max-width: 860px; margin: 0 auto; background:#fff; padding: 42px 52px 56px; min-height: 100vh; }
  header.rpt { border-bottom: 3px solid var(--violet); padding-bottom: 18px; margin-bottom: 8px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .logo { width:44px; height:44px; border-radius:10px; background:linear-gradient(135deg,#7c3aed,#06b6d4); color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; }
  h1 { font-size: 21px; margin: 0; color:#0f172a; }
  .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .metaline { display:flex; flex-wrap:wrap; gap: 18px; margin-top: 12px; font-size: 11.5px; color: var(--muted); }
  .metaline b { color:#334155; font-weight:600; }
  h2 { font-size: 14.5px; color: var(--violet-dark); text-transform: uppercase; letter-spacing: .06em; margin: 26px 0 10px; padding-left: 10px; border-left: 4px solid var(--violet); }
  section { margin-bottom: 6px; }
  .note { font-size: 12px; color: var(--muted); margin: 0 0 10px 14px; }
  .body-text { font-size: 13px; line-height: 1.65; margin: 6px 0 10px 14px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px 14px; max-width: calc(100% - 14px); }
  .kv td { font-size: 12.5px; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .kv td.k { width: 34%; color: var(--muted); font-weight: 600; }
  .kv td.v { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; }
  .grid th { background: #f1f5f9; font-size: 11.5px; text-transform: uppercase; letter-spacing:.04em; color:#334155; text-align:left; padding: 7px 10px; border: 1px solid var(--line); }
  .grid td { font-size: 12px; padding: 6px 10px; border: 1px solid var(--line); font-family: Consolas, monospace; }
  .grid tr.alt td { background:#fafbfc; }
  .cards { display:flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 14px 14px; }
  .rpt-fig { margin: 10px 0 14px 14px; }
  .rpt-fig img { border: 1px solid var(--line); border-radius: 8px; width: 100%; height: auto; }
  .rpt-fig figcaption { font-size: 11px; color: var(--muted); margin-top: 5px; }
  ol.steps { margin: 8px 0 14px 32px; padding: 0; }
  ol.steps li { margin-bottom: 9px; }
  .step-title { font-size: 12.5px; font-weight: 700; color: #0f172a; }
  .step-body { font-size: 12px; color: #334155; line-height: 1.55; font-family: Consolas, monospace; }
  .card { min-width: 150px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; background:#fbfbfe; }
  .card.good { border-color:#86efac; background:#f0fdf4; } .card.good .card-value { color:#15803d; }
  .card.bad { border-color:#fda4af; background:#fff1f2; } .card.bad .card-value { color:#be123c; }
  .card.neutral .card-value { color:#1d4ed8; }
  .card-label { font-size: 10px; text-transform: uppercase; letter-spacing:.07em; color: var(--muted); margin-bottom: 3px; }
  .card-value { font-size: 19px; font-weight: 700; font-family: Consolas, monospace; }
  footer.rpt { margin-top: 34px; border-top: 1px solid var(--line); padding-top: 14px; font-size: 11px; color: var(--muted); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:99px; border:1px solid var(--line); background:#f8fafc; }
  @media print {
    body { background:#fff; }
    .page { padding: 10mm 12mm; }
    section { break-inside: avoid; }
    .print-hint { display: none; }
    @page { margin: 12mm; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="rpt">
    <div class="brand">
      <div class="logo">Q</div>
      <div>
        <h1>${escHTML(meta.title)}</h1>
        <div class="sub">${escHTML(PROJECT_TITLE)} · ${escHTML(meta.runKind ?? 'Simulation Report')}${meta.subtitle ? ' — ' + escHTML(meta.subtitle) : ''}</div>
      </div>
    </div>
    <div class="metaline">
      <span>Report ID <b>${id}</b></span>
      <span>Generated <b>${stamp}</b></span>
      <span>Engine <b>Client-side state-vector simulator</b></span>
    </div>
  </header>

  ${sections.map(sectionHTML).join('\n')}

  <footer class="rpt">
    <span>Generated by the QEC Simulator — all quantities computed in-browser from first principles (state-vector engine, seeded RNG).</span>
    <span><b>${TEAM_NAMES.map(escHTML).join(' · ')}</b></span>
  </footer>
</div>
</body>
</html>`;
}

/** Opens the report in a new tab and raises the print dialog (Save as PDF). */
export function openPrintableReport(meta: ReportMeta, sections: ReportSection[], autoPrint = true): boolean {
  const html = buildReportHTML(meta, sections);
  const win = window.open('', '_blank');
  if (!win) {
    // popup blocked — fall back to downloading the report as an .html file
    downloadFile(`qec-report-${Date.now()}.html`, html, 'text/html');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  if (autoPrint) setTimeout(() => { try { win.focus(); win.print(); } catch { /* noop */ } }, 350);
  return true;
}
