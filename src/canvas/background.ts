export interface LoadedBackground {
  dataUrl: string;
  width: number;
  height: number;
  /** Total pages, for a PDF. */
  pages: number;
}

/** Longest side of a rendered PDF page, in pixels. */
const MAX_RENDER_PX = 3200;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('The file is not an image this browser can read.'));
    img.src = url;
  });
}

async function loadPdf(file: File, pageNumber: number): Promise<LoadedBackground> {
  // Loaded on demand: pdf.js is large and most sessions never import a PDF.
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`This PDF has ${doc.numPages} page${doc.numPages > 1 ? 's' : ''}.`);
    }
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, MAX_RENDER_PX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render PDF pages.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: base.width,
      height: base.height,
      pages: doc.numPages,
    };
  } finally {
    await doc.destroy();
  }
}

/** Reads an image or one PDF page. Size is in drawing units, one per PDF point or pixel. */
export async function loadBackgroundFile(file: File, pageNumber = 1): Promise<LoadedBackground> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) return loadPdf(file, pageNumber);
  const dataUrl = await readAsDataUrl(file);
  const size = await imageSize(dataUrl);
  return { dataUrl, ...size, pages: 1 };
}
