'use strict';
/**
 * ProGramerly - OCR and document reading
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Turns a picture of words into words, on this machine.
 *
 * There are two honest ways to do that locally and this module offers both,
 * side by side, and says which one answered:
 *
 *  1. An OCR engine - Tesseract on PATH, or RapidOCR / EasyOCR inside the
 *     managed Python environment. Deterministic, fast, no model to load, and
 *     it returns the characters it actually found.
 *  2. A local vision model through Ollama - moondream, granite3.2-vision,
 *     llava, llama3.2-vision. Slower, but it reads handwriting, bad scans and
 *     layout, and it can be asked a question about the page rather than only
 *     transcribing it.
 *
 * Nothing here uploads anything. If no engine is installed, this module says
 * so and names the catalogue item that installs one - it never invents text.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ai = require('./ai');
const tasks = require('../installer/tasks');

/* ------------------------------------------------------------- the limits */

// The development root, the managed virtual environment and the python inside
// it are owned by installer/tasks.js. This module asks it rather than keeping
// a second opinion about where any of that lives.

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif']);
const PDF_EXT = new Set(['.pdf']);
const MAX_BYTES = 40 * 1024 * 1024;     // a page, not a photo library
const MAX_PDF_PAGES = 20;

/** Run a command and collect its output. Never throws; a failure is a result. */
function run(cmd, args, { timeoutMs = 180000, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: -1, out: '', err: e.message });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, out, err }); });
  });
}

/* ------------------------------------------------------------- the engines */

const venvPython = () => tasks.venvPython();
const haveVenv = () => { try { return fs.existsSync(venvPython()); } catch { return false; } };

/** Ask the managed environment whether a module imports. That is the only
 *  honest availability test for a Python package. */
async function venvHas(moduleName) {
  if (!haveVenv()) return false;
  const r = await run(venvPython(), ['-c', `import ${moduleName}`], { timeoutMs: 30000 });
  return r.ok;
}

async function tesseractVersion() {
  const r = await run('tesseract', ['--version'], { timeoutMs: 20000 });
  if (!r.ok) return null;
  const line = (r.out || r.err).split(/\r?\n/)[0] || '';
  return line.trim() || 'tesseract';
}

/**
 * Every reader this machine can actually use, right now, with the reason when
 * it cannot. The renderer shows this list verbatim - a missing engine is a
 * finding, not an error.
 */
async function engines() {
  const out = [];

  const tess = await tesseractVersion();
  out.push({
    id: 'tesseract',
    kind: 'engine',
    name: 'Tesseract',
    detail: tess || 'not on PATH',
    available: Boolean(tess),
    reason: tess ? null : 'Install "Tesseract OCR engine" from the Software workspace.',
    about: 'Deterministic character recognition. Best on clean scans and screenshots.',
  });

  const rapid = await venvHas('rapidocr_onnxruntime');
  out.push({
    id: 'rapidocr',
    kind: 'engine',
    name: 'RapidOCR',
    detail: rapid ? 'in the managed environment' : (haveVenv() ? 'not installed in the managed environment' : 'the managed Python environment does not exist yet'),
    available: rapid,
    reason: rapid ? null : 'Install "OCR toolkit" from the Software workspace.',
    about: 'ONNX runtime OCR. CPU only, no system dependency, good on mixed layouts.',
  });

  const easy = await venvHas('easyocr');
  out.push({
    id: 'easyocr',
    kind: 'engine',
    name: 'EasyOCR',
    detail: easy ? 'in the managed environment' : (haveVenv() ? 'not installed in the managed environment' : 'the managed Python environment does not exist yet'),
    available: easy,
    reason: easy ? null : 'Install "OCR toolkit" from the Software workspace.',
    about: 'Heavier, slower, better on photographs and odd fonts. Downloads its weights once.',
  });

  // Vision models are engines too - the ones actually pulled on this machine.
  let targets = [];
  try { targets = await ai.chatTargets(); } catch { targets = []; }
  const vision = targets.filter((t) => t.endpointId === 'ollama' && ai.isVisionModel(t.model));
  for (const t of vision) {
    out.push({
      id: `vision:${t.model}`,
      kind: 'vision',
      name: t.model,
      detail: `local model on ${t.endpoint || 'Ollama'}`,
      available: true,
      reason: null,
      model: t.model,
      endpointId: t.endpointId,
      port: t.port,
      about: 'A local vision model. Reads layout and handwriting, and can answer a question about the page.',
    });
  }
  if (!vision.length) {
    out.push({
      id: 'vision:none',
      kind: 'vision',
      name: 'Local vision model',
      detail: 'none pulled',
      available: false,
      reason: 'Install "Tiny OCR and vision (moondream + granite3.2-vision)" from the Software workspace.',
      about: 'A local vision model reads layout and handwriting, and can be asked about the page.',
    });
  }

  return {
    engines: out,
    venv: haveVenv() ? venvPython() : null,
    note: 'Everything below runs on this machine. No page is uploaded to read it.',
  };
}

/* ---------------------------------------------------------------- reading */

function checkFile(filePath) {
  if (!filePath) return 'No file was given.';
  let st;
  try { st = fs.statSync(filePath); } catch { return `${filePath} cannot be read.`; }
  if (!st.isFile()) return `${filePath} is not a file.`;
  if (st.size > MAX_BYTES) return `That file is ${Math.round(st.size / 1048576)} MB. The reader takes up to ${MAX_BYTES / 1048576} MB.`;
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXT.has(ext) && !PDF_EXT.has(ext)) return `${ext || 'That file'} is not an image or a PDF.`;
  return null;
}

const isPdf = (f) => PDF_EXT.has(path.extname(f).toLowerCase());

/**
 * Rasterise a PDF into PNG pages with PyMuPDF, in a temporary folder.
 * Returns the page files, or a reason. PDFs are the one format that needs a
 * step before any reader can see them.
 */
async function pdfPages(filePath, limit = MAX_PDF_PAGES) {
  if (!(await venvHas('fitz'))) {
    return { ok: false, reason: 'Reading a PDF needs PyMuPDF. Install "OCR toolkit" from the Software workspace.' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ocr-'));
  const script = [
    'import sys, fitz',
    'src, out, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])',
    'doc = fitz.open(src)',
    'n = min(len(doc), limit)',
    'for i in range(n):',
    '    pix = doc[i].get_pixmap(dpi=200)',
    '    pix.save(f"{out}/page-{i+1:03d}.png")',
    'print(n)',
  ].join('\n');
  const r = await run(venvPython(), ['-c', script, filePath, dir, String(limit)], { timeoutMs: 300000 });
  if (!r.ok) return { ok: false, reason: `The PDF could not be rendered: ${(r.err || r.out).trim().split('\n').pop()}` };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(dir, f));
  return { ok: true, dir, files, pages: files.length };
}

function cleanup(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

async function readWithTesseract(file, lang) {
  const r = await run('tesseract', [file, 'stdout', '-l', lang || 'eng'], { timeoutMs: 180000 });
  if (!r.ok) return { ok: false, reason: (r.err || 'tesseract failed').trim().split('\n').slice(-1)[0] };
  return { ok: true, text: r.out.replace(/\r\n/g, '\n').trim() };
}

const RAPID_SCRIPT = [
  'import sys, json',
  'from rapidocr_onnxruntime import RapidOCR',
  'engine = RapidOCR()',
  'res, _ = engine(sys.argv[1])',
  'rows = res or []',
  'print(json.dumps({"lines": [{"text": r[1], "conf": float(r[2])} for r in rows]}))',
].join('\n');

const EASY_SCRIPT = [
  'import sys, json',
  'import easyocr',
  'reader = easyocr.Reader(["en"], gpu=False, verbose=False)',
  'rows = reader.readtext(sys.argv[1])',
  'print(json.dumps({"lines": [{"text": r[1], "conf": float(r[2])} for r in rows]}))',
].join('\n');

async function readWithPython(script, file) {
  const r = await run(venvPython(), ['-c', script, file], { timeoutMs: 600000 });
  if (!r.ok) return { ok: false, reason: (r.err || 'the reader failed').trim().split('\n').slice(-1)[0] };
  const last = r.out.trim().split('\n').pop() || '{}';
  let parsed;
  try { parsed = JSON.parse(last); } catch { return { ok: false, reason: 'the reader returned something that is not a result' }; }
  const lines = parsed.lines || [];
  const conf = lines.length ? lines.reduce((a, l) => a + (l.conf || 0), 0) / lines.length : null;
  return { ok: true, text: lines.map((l) => l.text).join('\n').trim(), confidence: conf == null ? null : +conf.toFixed(3), lines: lines.length };
}

const TRANSCRIBE = 'Transcribe every word in this image, exactly as it appears, preserving line breaks and reading order. '
  + 'Output only the transcription - no preamble, no description, no commentary. '
  + 'If part of it is illegible, write [illegible] in its place rather than guessing.';

async function readWithVision(file, engine, question, onToken) {
  const b64 = fs.readFileSync(file).toString('base64');
  const res = await ai.chat({
    endpointId: engine.endpointId || 'ollama',
    port: engine.port,
    model: engine.model,
    messages: [{ role: 'user', content: question || TRANSCRIBE, images: [b64] }],
  }, (t) => { if (onToken && t.token) onToken(t.token); });
  if (!res.ok) return { ok: false, reason: res.error || 'the model did not answer' };
  return { ok: true, text: (res.text || '').trim(), stats: res.stats || null };
}

/**
 * Read one file with one engine.
 *
 * The result always names the engine that produced it and how long it took,
 * because "which reader said this" is part of the answer.
 */
async function read({ filePath, engineId, question, lang } = {}, onToken) {
  const bad = checkFile(filePath);
  if (bad) return { ok: false, error: bad };

  const list = await engines();
  const engine = list.engines.find((e) => e.id === engineId)
    || list.engines.find((e) => e.available);
  if (!engine) return { ok: false, error: 'No OCR engine is installed on this machine yet.' };
  if (!engine.available) return { ok: false, error: engine.reason || `${engine.name} is not available.` };

  const started = Date.now();
  let files = [filePath];
  let tmpDir = null;
  let pages = 1;

  if (isPdf(filePath)) {
    const r = await pdfPages(filePath);
    if (!r.ok) return { ok: false, error: r.reason };
    if (!r.files.length) { cleanup(r.dir); return { ok: false, error: 'That PDF has no renderable pages.' }; }
    files = r.files; tmpDir = r.dir; pages = r.pages;
  }

  const parts = [];
  let confidence = null;
  let stats = null;
  try {
    for (const [i, f] of files.entries()) {
      if (onToken && files.length > 1) onToken(`\n--- page ${i + 1} of ${files.length} ---\n`);
      /* eslint-disable no-await-in-loop */
      let r;
      if (engine.id === 'tesseract') r = await readWithTesseract(f, lang);
      else if (engine.id === 'rapidocr') r = await readWithPython(RAPID_SCRIPT, f);
      else if (engine.id === 'easyocr') r = await readWithPython(EASY_SCRIPT, f);
      else r = await readWithVision(f, engine, question, onToken);
      /* eslint-enable no-await-in-loop */
      if (!r.ok) return { ok: false, error: `${engine.name}: ${r.reason}`, engine: engine.name };
      if (r.confidence != null) confidence = confidence == null ? r.confidence : (confidence + r.confidence) / 2;
      if (r.stats) stats = r.stats;
      parts.push(files.length > 1 ? `--- page ${i + 1} ---\n${r.text}` : r.text);
      if (onToken && engine.kind !== 'vision') onToken(parts[parts.length - 1]);
    }
  } finally {
    cleanup(tmpDir);
  }

  const text = parts.join('\n\n').trim();
  return {
    ok: true,
    text,
    chars: text.length,
    words: text ? text.split(/\s+/).length : 0,
    pages,
    confidence,
    stats,
    engine: engine.name,
    engineId: engine.id,
    kind: engine.kind,
    file: path.basename(filePath),
    ms: Date.now() - started,
    note: engine.kind === 'vision'
      ? 'Read by a local vision model. It reads layout and handwriting, but it is a model - check anything that matters.'
      : 'Read by an OCR engine. These are the characters it found, not an interpretation.',
  };
}

/** Where read text is saved when the operator asks for a file. */
function saveText(text, baseName, dir) {
  const target = dir || path.join(os.tmpdir(), 'programerly-ocr');
  fs.mkdirSync(target, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(target, `${(baseName || 'reading').replace(/\.[^.]+$/, '')}-${stamp}.txt`);
  fs.writeFileSync(file, `${text}\n`, 'utf8');
  return file;
}

module.exports = { engines, read, saveText, IMAGE_EXT, PDF_EXT, MAX_PDF_PAGES };
