import { linesFromItems, parseInvoiceText, type ParseResult, type TextItem } from "../../../src/map/invoice-parse";

/** Hetzner invoices are a few pages; anything far larger is not one. */
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 40;

let workerReady: Promise<void> | undefined;

// The PDF reader loads only when someone adds an invoice, as its own chunk with its own worker.
async function reader() {
  const pdfjs = await import("pdfjs-dist");
  workerReady ??= import("pdfjs-dist/build/pdf.worker.min.mjs?worker").then(({ default: PdfWorker }) => {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  });
  await workerReady;
  return pdfjs;
}

/** Reads one invoice PDF in this browser. The file never leaves the page; only the parsed totals do. */
export async function readInvoicePdf(file: File): Promise<ParseResult> {
  if (file.size > MAX_BYTES) return { ok: false, error: "This file is larger than 10 MB, which no Hetzner invoice is." };
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return { ok: false, error: "Only PDF files can be read." };
  try {
    const { getDocument } = await reader();
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, verbosity: 0 });
    try {
      const doc = await task.promise;
      const pages = Array.from({ length: Math.min(doc.numPages, MAX_PAGES) }, (_, i) => i + 1);
      const contents = await Promise.all(pages.map((p) => doc.getPage(p).then((page) => page.getTextContent())));
      const items: TextItem[] = [];
      contents.forEach((content, i) => {
        for (const it of content.items) {
          if ("str" in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height, page: i + 1 });
        }
      });
      return parseInvoiceText(linesFromItems(items));
    } finally {
      void task.destroy();
    }
  } catch {
    return { ok: false, error: "This PDF could not be read. It may be damaged or password protected." };
  }
}
