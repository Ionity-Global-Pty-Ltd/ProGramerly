# ProGramerly — the AI and ML structure

Ionity (Pty) Ltd | AEDI — Policy 986 AED
Author: Johan Wilhelm van Antwerp · <https://www.ionity.today>
Applies to ProGramerly 3.4.0 and later.

Everything in this document runs on the machine ProGramerly is installed on.
No prompt, no data set, no page and no reading is sent anywhere. Where a
capability is missing, the application says which catalogue item installs it
rather than reaching for a network service.

---

## 1. The shape of it

```
                      the operator
                           │
        ┌──────────────────┴──────────────────┐
        │            the shell                │
        │  ask box · orb · brief · workspaces │
        └───────┬───────────────────┬─────────┘
                │                   │
        services/dome.js      services/ocr.js
       (what can be known)   (what can be read)
                │                   │
        ┌───────┴───────┐    ┌──────┴───────┐
        │ the registry  │    │ the readers  │
        │ datasets.json │    │ engines +    │
        │ dome.json     │    │ vision models│
        └───────┬───────┘    └──────┬───────┘
                │                   │
        ┌───────┴───────────────────┴────────┐
        │           services/ai.js           │
        │  endpoints · models · chat · GPU   │
        └───────────────┬────────────────────┘
                        │
                  Ollama, locally
```

Three files are the contract:

| File | What it fixes |
| --- | --- |
| `src/main/data/dome.json` | The structure: 5 strata, 25 segments, what each segment reads and what to watch for |
| `src/main/data/datasets.json` | The boundary: the 29 data sets a model may read, their class, and the 11 standing questions |
| `src/main/catalog/catalog.json` | What can be installed: every model, engine and framework, by profile |

Nothing outside `datasets.json` is servable. `dome.dataset('etc.passwd')` is
refused because it is not in the registry — not because a filter caught it.

---

## 2. Models

### 2.1 Roles

Every curated model in `services/ai.js` declares a **role**, and the rest of
the application reads that role rather than guessing from the name:

| Role | Used by | Models |
| --- | --- | --- |
| `chat` | the ask box, the launch brief, every Ask control | llama3.2 (1b/3b), llama3.1:8b, mistral:7b, **gemma3:1b, gemma2:2b, gemma3:4b, gemma4:e2b, gemma4:e4b** |
| `code` | code questions in the AI workspace | qwen2.5-coder (7b/14b) |
| `reason` | longer analysis | deepseek-r1:8b, phi4:14b |
| `vision` | the Reading workspace, OCR | **moondream, granite3.2-vision**, llava:7b, llama3.2-vision:11b, gemma3 (4b and up) |
| `embed` | retrieval | nomic-embed-text |

`sizeBytes` sits beside the human size so a fit check is arithmetic, not
string parsing.

### 2.2 Gemma

Gemma is a first-class family in ProGramerly 3.4.0.

| Tag | Size | What it is for |
| --- | --- | --- |
| `gemma3:1b` | ~815 MB | Pocket size. Quick triage on any machine. **Text only** |
| `gemma2:2b` | ~1.6 GB | Small, steady instruction following |
| `gemma3:4b` | ~3.3 GB | The middle step; multimodal, so it can also read a page |
| `gemma4:e2b` | ~7.2 GB | The everyday Ionity model above the starter — the default to move up to |
| `gemma4:e4b` | ~9.6 GB | Long reasoning and document work, where the memory is there |

Two catalogue items install them:

- **`ollama-gemma`** — `gemma4:e2b` + `gemma3:1b` (in the `full` and `ai` profiles)
- **`ollama-gemma-large`** — `gemma4:e4b` + `gemma3:4b` (opt-in)

Multimodality is stated exactly: Gemma 3 reads images from 4b upwards, and
`gemma3:1b` is listed as text only. The application never offers a model as a
reader when it cannot read.

---

## 3. Reading — OCR and vision

`src/main/services/ocr.js` offers two kinds of reader and always says which
one answered.

### 3.1 OCR engines

| Engine | Installed by | Character |
| --- | --- | --- |
| **Tesseract** | `ocr-engine` (winget / brew / apt / dnf / pacman) | Deterministic. Returns the characters it found. Best on clean scans and screenshots |
| **RapidOCR** | `ocr-toolkit` (managed venv) | ONNX runtime, CPU only, no system dependency, good on mixed layouts |
| **EasyOCR** | `ocr-toolkit` (managed venv) | Heavier and slower, better on photographs and odd fonts |

### 3.2 Vision models

| Model | Size | Installed by |
| --- | --- | --- |
| **moondream** | ~1.7 GB | `ollama-ocr` — the tiny reader; a screenshot in seconds, on CPU |
| **granite3.2-vision** | ~2.4 GB | `ollama-ocr` — built for documents: tables, forms, invoices, scans |
| llava:7b | ~4.7 GB | `ollama-models` |
| llama3.2-vision:11b | ~7.9 GB | curated list |

A vision model can be asked a question about the page — *"what is the invoice
total and its date"* — instead of transcribing it. An OCR engine cannot; it
returns characters.

### 3.3 What happens when you read a page

1. The file is checked: it must be an image or a PDF, and at most 40 MB.
2. A PDF is rasterised first, at 200 dpi, up to 20 pages, with PyMuPDF in the
   managed environment. Without PyMuPDF the application says so and stops.
3. The chosen reader runs, page by page, streaming text back on `ocr:token`.
4. The result carries the engine, the page count, the elapsed time, the mean
   confidence where the reader reports one, and a note saying whether this was
   characters found or a model's reading.

Nothing is written unless you save it. Saved readings go to
`<userData>/readings`.

### 3.4 The honest part

- An engine that is not installed is reported with **the reason and the
  catalogue item that installs it**, never hidden.
- The reading note distinguishes *"these are the characters it found"* from
  *"this is a model's reading — check anything that matters"*.
- Illegible text is asked for as `[illegible]`, not guessed.

---

## 4. The data registry — what a model may see

Each of the 29 sets carries a **class**, and every figure the model quotes
carries the class of the set it came from:

| Class | Meaning |
| --- | --- |
| `measured` | Read from a sensor, the OS or a live scan on this machine, now |
| `catalogue` | Curated data shipped inside the application |
| `manifest` | A pinned record — sizes and SHA-256 digests |
| `state` | What this installation has recorded about itself |
| `computed` | Derived from other sets. Never a reading |

Sets marked `cost: scan` (the registry probe, the installed-tool probe, the
development-root walk, the port scan, the reclaim scan, the repository sweep,
the Python environment sweep and the reader probe) are skipped by the quick
pass and read in full behind it. A segment whose sets have not been scanned
reports **"not scanned yet"** rather than being scored from nothing.

### 4.1 The intelligence stratum

| Segment | Code | Reads | Says |
| --- | --- | --- | --- |
| Local models | MDL | `ollama.models`, `ai.endpoints` | What is held and what is loaded |
| **Reading and OCR** | **OCR** | `ocr.engines`, `ollama.models` | What can turn a picture of words into words |
| Acceleration | ACC | `gpu.devices` | What the models will actually run on |
| Python environments | PY | `python.envs` | Where the ML stack lives |
| Data sets | DAT | `dome.datasets` | The registry describing itself |
| Presets | PRE | `dome.presets` | The standing questions |

### 4.2 The presets

Eleven standing questions, each declaring the sets it reads: state of the
machine, thermal and airflow brief, which curve to run, disk pressure and
reclaim, toolchain gaps, repository standing, model fit, **what can this
machine read**, integrity and privilege, explain the last scan, and *what can
you see*.

---

## 5. The ML stack

Installed into one managed virtual environment — `<devRoot>/.venvs/ionity` —
so the whole set is removable in one folder and the system Python is never
touched.

| Item | Contents |
| --- | --- |
| `python-venv` | The managed environment itself |
| `ml-toolkit` | numpy, pandas, scipy, scikit-learn, matplotlib, seaborn, JupyterLab, ipykernel, OpenCV, Pillow, polars, pyarrow |
| `pytorch` | torch, torchvision, torchaudio |
| `transformers` | transformers, datasets, accelerate |
| `tensorflow` | TensorFlow + Keras |
| `agent-frameworks` | LangChain, LangGraph, LlamaIndex, CrewAI |
| **`ocr-toolkit`** | rapidocr-onnxruntime, easyocr, pytesseract, PyMuPDF, pdf2image, Pillow |

---

## 6. Startup

1. **The intro** — its own frameless window. The DOME assembles arc by arc
   from this machine's real facts (host, OS, cores, memory, catalogue size,
   strata, data sets, presets, tools).
2. **The DOME boot** — the startup of the official IONITY Ai-OS DOME build,
   carried into the shell window: the mark, the wordmark line, the fill and
   the step list. Each step is ticked by the milestone it names —
   *verifying the integrated tools, loading the analysis presets, reading
   sensors and volumes, waking the local core, assembling the dome* — so the
   fill is the share of real work done and cannot run ahead of the machine. A
   20-second ceiling clears it whatever happens.
3. **The shell** — and, if the launch brief is on and a model is present, the
   machine reads itself once and reports on the deck.

---

## 7. Where each piece lives

| Path | What it is |
| --- | --- |
| `src/main/services/ai.js` | Endpoints, models, pulls, chat, benchmark, GPU, the curated list and the vision rule |
| `src/main/services/ocr.js` | The readers, PDF rasterising, reading, saving |
| `src/main/services/dome.js` | The readers behind the registry, the scorers, the cache, the brief builder |
| `src/main/data/dome.json` | 5 strata, 25 segments |
| `src/main/data/datasets.json` | 29 data sets, 5 classes, 11 presets |
| `src/main/catalog/catalog.json` | 116 installable items in 19 groups |
| `src/renderer/apps.js` | The DOME surface, the fan surface, the Reading surface |
| `src/renderer/shell.js` | The shell, the boot, the brief, the orb, the options |

---

Governance: Policy 986 AED · Licence AED 900
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All rights reserved — TM
*Building Tomorrow, Today.*
