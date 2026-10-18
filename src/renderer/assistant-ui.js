/* ProGramerly - AEDi assistant surfaces (3.9.0)
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   The providers card (local / Claude, both off by default), "Suggest with
   AEDi" on the Software list, "Explain failures" after a run and "Explain
   with AEDi" in Doctor. Loaded after renderer.js and shares its globals
   ($, esc, api, lastDoctorScan, loadTargets). */
(() => {
  'use strict';
  const A = api.assistant;
  if (!A) return;

  let status = null;
  let streamId = 0;
  let streamBox = null;
  let streamText = '';

  /* ---------------------------------------------------- streaming boxes */
  A.onToken((p) => {
    if (!streamBox || (p.id && streamId && p.id !== streamId)) return;
    const body = streamBox.querySelector('.ai-body');
    if (p.token) { streamText += p.token; body.textContent = streamText; streamBox.scrollTop = streamBox.scrollHeight; }
    if (p.error) { body.textContent += `\n${p.error}`; streamBox.classList.add('err'); }
  });

  function openBox(box, label) {
    box.hidden = false;
    box.classList.remove('err');
    box.innerHTML = `<span class="ai-meta"></span><span class="ai-body">Thinking…</span>`;
    box.querySelector('.ai-meta').textContent = label;
    streamBox = box; streamText = ''; streamId = 0;
  }
  function closeBox(box, res) {
    if (res && res.id) streamId = res.id;
    if (!res || !res.ok) {
      box.classList.add('err');
      box.querySelector('.ai-body').textContent = (res && res.error) || 'No answer.';
    } else if (res.text && !streamText) {
      box.querySelector('.ai-body').textContent = res.text;
    }
    streamBox = null;
  }
  function who() {
    if (!status) return 'AEDi';
    const cloud = status.claudeEnabled && (status.provider !== 'local' || !status.localEnabled);
    return cloud ? `AEDi · Claude (${status.claudeModel}) · sent to Anthropic` : 'AEDi · local model · stays on this machine';
  }
  function anyOn() { return Boolean(status && (status.localEnabled || status.claudeEnabled)); }

  /* --------------------------------------------------- providers card */
  function paint() {
    if (!status) return;
    $('aiLocalOn').checked = status.localEnabled;
    $('aiClaudeOn').checked = status.claudeEnabled;
    $('aiClaudeOn').disabled = !status.claudeKey;
    $('aiBriefOn').checked = Boolean(SETTINGS && SETTINGS.aiAutoBrief);
    $('provLocal').classList.toggle('on', status.localEnabled);
    $('provClaude').classList.toggle('on', status.claudeEnabled);
    $('aiClaudeForget').hidden = !status.claudeKey;
    $('aiClaudeKey').placeholder = status.claudeKey ? 'A key is stored (encrypted). Paste a new one to replace it.' : 'sk-ant-… (console.anthropic.com → API keys)';
    $('aiProvider').value = status.provider === 'local' ? 'local' : 'auto';
    $('aiProvider').disabled = !(status.localEnabled && status.claudeEnabled);
    const st = $('aiProvState');
    const on = [status.localEnabled && 'local AI', status.claudeEnabled && `Claude (${status.claudeModel})`].filter(Boolean);
    st.textContent = on.length ? `On: ${on.join(' + ')}` : 'Both off - AEDi does not answer until you turn one on.';
    st.classList.toggle('good', on.length > 0);
    const note = $('aiClaudeNote');
    if (!status.encryption && !note.textContent) note.textContent = 'OS encryption is unavailable on this machine, so a key cannot be stored safely here.';
    const rec = $('recBtn'); if (rec) { rec.disabled = !anyOn(); rec.title = anyOn() ? '' : 'Turn on an AI provider in AEDi first'; }
  }

  async function refresh() {
    status = await A.status();
    paint();
    if (status.claudeKey) {
      const m = await A.models();
      const sel = $('aiClaudeModel');
      if (m && m.ok && m.models.length) {
        sel.innerHTML = m.models.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.id)}</option>`).join('');
        sel.value = status.claudeModel;
        if (!sel.value) sel.selectedIndex = 0;
      } else {
        sel.innerHTML = `<option value="${esc(status.claudeModel)}">${esc(status.claudeModel)}</option>`;
        if (m && m.error) $('aiClaudeNote').textContent = `Could not list models: ${m.error}`;
      }
    }
  }

  async function configure(patch) {
    status = await A.configure(patch);
    paint();
    if (typeof loadTargets === 'function') loadTargets().catch(() => {});
    window.dispatchEvent(new CustomEvent('pg:ai-changed'));
  }

  $('aiLocalOn').addEventListener('change', (e) => configure({ aiLocalEnabled: e.target.checked }));
  $('aiClaudeOn').addEventListener('change', (e) => configure({ aiClaudeEnabled: e.target.checked }));
  $('aiProvider').addEventListener('change', (e) => configure({ aiProvider: e.target.value }));
  $('aiBriefOn').addEventListener('change', (e) => configure({ aiAutoBrief: e.target.checked }));
  $('aiClaudeModel').addEventListener('change', (e) => configure({ aiClaudeModel: e.target.value }));

  $('aiClaudeSave').addEventListener('click', async () => {
    const key = $('aiClaudeKey').value.trim();
    if (!key) { $('aiClaudeNote').textContent = 'Paste a key first.'; return; }
    const b = $('aiClaudeSave'); b.disabled = true; b.textContent = 'Checking…';
    const res = await A.setKey(key);
    b.disabled = false; b.textContent = 'Save key';
    $('aiClaudeKey').value = '';
    $('aiClaudeNote').textContent = res.ok
      ? `Key verified and stored encrypted. Claude is on (${res.model}). Prompts you send with Claude go to Anthropic.`
      : res.error;
    await refresh();
    if (typeof loadTargets === 'function') loadTargets().catch(() => {});
    window.dispatchEvent(new CustomEvent('pg:ai-changed'));
  });
  $('aiClaudeForget').addEventListener('click', async () => {
    await A.setKey('');
    $('aiClaudeNote').textContent = 'Key removed from this machine. Claude is off.';
    $('aiClaudeModel').innerHTML = '<option value="">Save a key to list your models</option>';
    await refresh();
    window.dispatchEvent(new CustomEvent('pg:ai-changed'));
  });

  /* ------------------------------------------------ Suggest with AEDi */
  async function recommend() {
    const text = $('recText').value.trim();
    const note = $('recNote');
    if (!text) { $('recText').focus(); return; }
    if (!anyOn()) { note.textContent = 'Turn on local AI or add a Claude key in AEDi → Providers first.'; note.classList.add('err'); return; }
    const b = $('recBtn'); b.disabled = true; b.textContent = 'Thinking…';
    note.classList.remove('err');
    note.textContent = `${who()} is reading the catalog…`;
    const res = await A.recommend(text);
    b.disabled = false; b.textContent = 'Suggest with AEDi';
    if (!res || !res.ok) { note.textContent = (res && res.error) || 'No answer.'; note.classList.add('err'); return; }
    if (!res.ids.length) { note.textContent = 'AEDi did not name any catalog items for that. Try describing the languages and tools.'; note.classList.add('err'); return; }
    const n = window.PGSelection.set(res.ids);
    note.textContent = `${n} items ticked${res.why ? ` - ${res.why}` : ''}. Review the list, then Install.`;
  }
  $('recBtn').addEventListener('click', recommend);
  $('recText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); recommend(); } });

  /* ------------------------------------------- Explain failures (run) */
  $('summaryExplain').addEventListener('click', async () => {
    const box = $('summaryAi');
    if (!anyOn()) { box.hidden = false; box.className = 'ai-answer err'; box.textContent = 'Turn on an AI provider in AEDi → Providers to have failures explained.'; return; }
    const b = $('summaryExplain'); b.disabled = true;
    openBox(box, `${who()} · reading the log of the failed items`);
    closeBox(box, await A.explainRun());
    b.disabled = false;
  });

  /* ---------------------------------------------------------- Doctor */
  $('docAiBtn').addEventListener('click', async () => {
    const box = $('docAi');
    if (!lastDoctorScan) return;
    if (!anyOn()) { box.hidden = false; box.className = 'ai-answer err'; box.textContent = 'Turn on an AI provider in AEDi → Providers to have the scan explained.'; return; }
    const b = $('docAiBtn'); b.disabled = true;
    openBox(box, `${who()} · ranking ${lastDoctorScan.results.length} checks`);
    closeBox(box, await A.explainDoctor(lastDoctorScan.results.map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail }))));
    b.disabled = false;
  });

  api.onSettingsChanged((s) => { if (s) { SETTINGS = s; refresh().catch(() => {}); } });
  refresh().catch(() => {});
})();
