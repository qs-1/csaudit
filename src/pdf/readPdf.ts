import { linesFromItems, type PdfItem } from '../engine';

/**
 * Reads the text of a PDF in this browser. pdf.js and its worker only load when a PDF is chosen,
 * so people who paste text never download them. The file never leaves the tab.
 */
export async function readPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of tc.items) {
        if ('str' in it) items.push({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width });
      }
      pages.push(linesFromItems(items));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
}
