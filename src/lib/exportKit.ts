import { jsPDF } from "jspdf";

/** App theme colours (from src/index.css), reused so exports match the UI. */
const HEX = {
  pine900: "#16352a",
  pine800: "#1d4334",
  gold400: "#eeb73f",
  ink: "#1b2620",
  soft: "#5d6b62",
  mist: "#dde4d9",
  paper: "#eef1ea",
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function newThemedDoc(orientation: "portrait" | "landscape" = "landscape") {
  return new jsPDF({ unit: "mm", format: "a4", orientation });
}

/** Pine header band with gold underline — school name, document title, and a right-aligned subtitle. Returns the y-offset to start content below it. */
export function drawThemedHeader(doc: jsPDF, schoolName: string, title: string, subtitle: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...rgb(HEX.pine900));
  doc.rect(0, 0, w, 24, "F");
  doc.setFillColor(...rgb(HEX.gold400));
  doc.rect(0, 24, w, 1.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(schoolName || "School", 10, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(title, 10, 17);
  doc.setFontSize(8);
  doc.setTextColor(225, 232, 228);
  doc.text(subtitle, w - 10, 10, { align: "right" });
  doc.text(`Generated ${new Date().toLocaleDateString("en-GB")}`, w - 10, 16, { align: "right" });
  doc.setTextColor(...rgb(HEX.ink));
  return 32;
}

export interface PdfColumn {
  header: string;
  width: number;
  align?: "left" | "center" | "right";
}

/** A manually-drawn table (no plugin available) — pine header row, alternating paper-tint rows, mist borders. Returns the y-offset after the table. Paginates automatically. */
export function drawThemedTable(doc: jsPDF, startY: number, columns: PdfColumn[], rows: (string | number)[][]): number {
  const marginX = 10;
  const rowH = 7;
  const headerH = 7.5;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - marginX * 2;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = usableW / totalWidth;
  const cols = columns.map((c) => ({ ...c, width: c.width * scale }));
  let y = startY;

  const drawCell = (text: string, x: number, width: number, align: "left" | "center" | "right", yy: number) => {
    const tx = align === "right" ? x + width - 2 : align === "center" ? x + width / 2 : x + 2;
    doc.text(text, tx, yy, { align });
  };

  const header = () => {
    let x = marginX;
    doc.setFillColor(...rgb(HEX.pine800));
    doc.rect(marginX, y, usableW, headerH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    for (const c of cols) { drawCell(c.header, x, c.width, c.align ?? "left", y + headerH - 2.3); x += c.width; }
    y += headerH;
    doc.setTextColor(...rgb(HEX.ink));
    doc.setFont("helvetica", "normal");
  };

  header();
  rows.forEach((row, i) => {
    if (y + rowH > pageH - 14) { doc.addPage(); y = 14; header(); }
    if (i % 2 === 1) { doc.setFillColor(...rgb(HEX.paper)); doc.rect(marginX, y, usableW, rowH, "F"); }
    let x = marginX;
    doc.setFontSize(8);
    row.forEach((cell, ci) => { drawCell(String(cell ?? "—"), x, cols[ci].width, cols[ci].align ?? "left", y + rowH - 2.2); x += cols[ci].width; });
    doc.setDrawColor(...rgb(HEX.mist));
    doc.line(marginX, y + rowH, marginX + usableW, y + rowH);
    y += rowH;
  });
  return y;
}

/** A small section label between tables (e.g. a subject name before its detailed breakdown). */
export function drawThemedSectionLabel(doc: jsPDF, y: number, label: string): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 30) { doc.addPage(); y = 14; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...rgb(HEX.pine900));
  doc.text(label, 10, y + 5);
  doc.setTextColor(...rgb(HEX.ink));
  doc.setFont("helvetica", "normal");
  return y + 8;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((cell) => {
      const s = String(cell ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
