// Builds a small synthetic invoice PDF for the browser import test. Every name and number in it
// is made up; it only mimics the layout of a Hetzner invoice so the real reader path runs.

/** One text line as cells placed at x positions, so columns are separate text runs as in a real PDF. */
type Line = Array<[number, string]>;

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/€/g, "\\200");

export function invoicePdf(opts: { number?: string; itemNet?: string } = {}): Buffer {
  const num = opts.number ?? "900000000042";
  const lines: Line[] = [
    [[50, "Rechnungsnummer: " + num]],
    [[50, "Rechnungsdatum: 03.08.2026"]],
    [[50, 'Projekt "production"'], [300, "07/2026"], [360, "90,00 €"], [430, "17,10 €A1"], [500, "107,10 €"]],
    [[50, 'Projekt "staging"'], [300, "07/2026"], [360, "10,00 €"], [430, "1,90 €A1"], [500, "11,90 €"]],
    [[50, "Summe"], [360, "100,00 €"], [430, "19,00 €"], [500, "119,00 €"]],
    [[250, "19 %"], [360, "100,00 €"], [430, "19,00 €"], [500, "119,00 €"]],
    [[50, 'Projekt "production" (07/2026)']],
    [[50, "1"], [80, "1 CPX31 Cloud Server"], [300, "Monate"], [360, "1"], [400, "80,0000 €"], [480, opts.itemNet ?? "80,0000 €"]],
    [[50, "2"], [80, "1 Volume 100 GB"], [300, "Monate"], [360, "1"], [400, "10,0000 €"], [480, "10,0000 €"]],
    [[400, "Zwischensumme"], [480, "90,00 €"]],
    [[50, 'Projekt "staging" (07/2026)']],
    [[50, "1"], [80, "1 CPX11 Cloud Server"], [300, "Monate"], [360, "1"], [400, "10,0000 €"], [480, "10,0000 €"]],
    [[400, "Zwischensumme"], [480, "10,00 €"]],
  ];
  const ops = lines.flatMap((cells, i) => cells.map(([x, t]) => `BT /F1 9 Tf ${x} ${780 - i * 18} Td (${esc(t)}) Tj ET`)).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
