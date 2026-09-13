'use strict';
/* ProGramerly Command Center
   A real-data home surface layered over the existing renderer. */

(() => {
  VIEWS.home = 'homeView';

  const coreBoot = boot;
  let started = false;
  let dashboardPrograms = [];
  let dashboardSettings = {};
  let dashboardSync = null;
  let dashboardUpdate = null;
  let lastCommandItems = [];
  let kioskBusy = false;

  const WORKSPACES = [
    { tab: 'home', label: 'Command Center', detail: 'Live machine overview and launcher', glyph: '⌂', keys: 'home dashboard status kiosk' },
    { tab: 'software', label: 'Software Foundry', detail: 'Build and install a complete toolchain', glyph: '＋', keys: 'apps install packages tools' },
    { tab: 'ai', label: 'Local AI', detail: 'Models, chat, GPU and environments', glyph: 'AI', keys: 'gpt llm ollama models assistant' },
    { tab: 'projects', label: 'Projects', detail: 'Git workspaces and repository state', glyph: '◇', keys: 'git repos code workspace' },
    { tab: 'monitor', label: 'System Monitor', detail: 'Telemetry, disks and network history', glyph: '◉', keys: 'cpu ram temperature performance' },
    { tab: 'network', label: 'Network Lab', detail: 'Regions, throughput and official links', glyph: '◎', keys: 'internet speed ping sweep links' },
    { tab: 'hardware', label: 'Hardware Lab', detail: 'Sensors, cooling, RGB and memory', glyph: '⚙', keys: 'fans rgb sensors memory' },
    { tab: 'doctor', label: 'System Doctor', detail: 'Diagnostics, cleanup and ports', glyph: '✚', keys: 'repair diagnose health cleanup ports' },
    { tab: 'terminals', label: 'Terminals', detail: 'Open a real shell in the development root', glyph: '>_', keys: 'shell powershell cmd bash wsl' },
    { tab: 'maintenance', label: 'Maintenance', detail: 'Registry repair and system tools', glyph: '◫', keys: 'windows registry fix repair' },
    { tab: 'updates', label: 'Operations', detail: 'Updates, synchronization and releases', glyph: '↻', keys: 'update sync release' },
    { tab: 'settings', label: 'Settings', detail: 'Profile, startup and application controls', glyph: '☷', keys: 'preferences profile config' },
  ];

  const PROGRAM_GLYPHS = {
    fanzi: 'FAN',
    'aios-demo': 'AiOS',
    cic: 'CiC',
    'mcp-audit': 'MCP',
  };

  const safe = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

  function humanBytes(value) {
    const n = Number(value) || 0;
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const v = n / (1024 ** i);
    return `${v.toFixed(i < 2 || v >= 100 ? 0 : 1)} ${units[i]}`;
  }

  function humanBits(bytesPerSecond) {
    const value = (Number(bytesPerSecond) || 0) * 8;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} Gb/s`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} Mb/s`;
    if (value >= 1e3) return `${Math.round(value / 1e3)} kb/s`;
    return `${Math.round(value)} b/s`;
  }

  function humanDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${days ? `${days}d ` : ''}${hours}h ${minutes}m`;
  }

  function when(timestamp) {
    if (!timestamp) return 'not scheduled';
    return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setBar(id, percentage) {
    const element = $(id);
    if (element) element.style.width = `${clamp(percentage)}%`;
  }

  function setMetricState(id, value, warning = 75, error = 90) {
    const element = $(id);
    if (!element) return;
    element.classList.toggle('warn', Number(value) >= warning && Number(value) < error);
    element.classList.toggle('err', Number(value) >= error);
  }

  function updateClock() {
    const now = new Date();
    setText('homeClock', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setText('homeDate', now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const hour = now.getHours();
    setText('homeGreeting', hour < 5 ? 'Night shift command center'
      : hour < 12 ? 'Good morning'
        : hour < 18 ? 'Good afternoon' : 'Good evening');
  }

  function paintMetrics(packet) {
    const metrics = (packet && packet.metrics) || {};
    const cpu = metrics.cpu || {};
    const mem = metrics.mem || {};
    const net = metrics.net || {};
    const temp = metrics.temp && typeof metrics.temp.c === 'number' ? metrics.temp.c : null;
    const disks = Array.isArray(metrics.disks) ? metrics.disks : [];
    const systemDisk = disks.find((disk) => /^c:?/i.test(String(disk.name || ''))) || disks[0] || null;
    const diskPct = systemDisk ? Number(systemDisk.usedPct) || 0 : 0;
    const cpuPct = Number(cpu.load) || 0;
    const memPct = Number(mem.usedPct) || 0;

    setText('homeCpuValue', `${Math.round(cpuPct)}%`);
    setText('homeCpuNote', `${cpu.cores || '?'} threads · ${cpu.speedMHz ? `${Math.round(cpu.speedMHz)} MHz` : 'live load'}`);
    setBar('homeCpuBar', cpuPct);
    setMetricState('homeCpuMetric', cpuPct, 75, 90);

    setText('homeMemValue', `${Math.round(memPct)}%`);
    setText('homeMemNote', `${humanBytes((mem.total || 0) - (mem.free || 0))} of ${humanBytes(mem.total)}`);
    setBar('homeMemBar', memPct);
    setMetricState('homeMemMetric', memPct, 80, 92);

    setText('homeTempValue', temp == null ? '—' : `${Math.round(temp)}°`);
    setText('homeTempNote', metrics.temp && metrics.temp.source ? metrics.temp.source : 'No OS sensor');
    setBar('homeTempBar', temp == null ? 0 : clamp(((temp - 25) / 70) * 100));
    setMetricState('homeTempMetric', temp == null ? 0 : temp, 75, 88);

    setText('homeDiskValue', systemDisk ? `${Math.round(diskPct)}%` : '—');
    setText('homeDiskNote', systemDisk
      ? `${String(systemDisk.name || 'disk').replace(/\\$/, '')} · ${humanBytes(systemDisk.free)} free`
      : 'Waiting for drive data');
    setBar('homeDiskBar', diskPct);
    setMetricState('homeDiskMetric', diskPct, 82, 92);

    setText('homeNetValue', `↓ ${humanBits(net.rxBps)}`);
    setText('homeNetNote', `↑ ${humanBits(net.txBps)}${packet && packet.ping ? ` · ${Math.round(packet.ping)} ms` : ''}`);

    const pressure = [];
    let severity = 'ok';
    const flag = (condition, level, label) => {
      if (!condition) return;
      pressure.push(label);
      if (level === 'err' || severity === 'ok') severity = level;
    };
    flag(cpuPct >= 90, 'err', 'CPU saturated');
    flag(cpuPct >= 75 && cpuPct < 90, 'warn', 'CPU busy');
    flag(memPct >= 92, 'err', 'memory critical');
    flag(memPct >= 80 && memPct < 92, 'warn', 'memory pressure');
    flag(diskPct >= 92, 'err', 'disk nearly full');
    flag(diskPct >= 82 && diskPct < 92, 'warn', 'disk space low');
    flag(temp != null && temp >= 88, 'err', 'temperature critical');
    flag(temp != null && temp >= 75 && temp < 88, 'warn', 'temperature elevated');

    const health = $('homeHealth');
    health.className = `home-health ${severity}`;
    setText('homeHealthText', pressure.length ? pressure.join(' · ') : 'System nominal');
    setText('homeLiveBadge', metrics.at ? 'LIVE TELEMETRY' : 'WARMING UP');
    $('homeLiveBadge').classList.toggle('live', Boolean(metrics.at));
    setText('homeMetricsAt', metrics.at
      ? `updated ${new Date(metrics.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'collecting first sample');
    setText('homeMachineLine', [metrics.host, metrics.platform, `uptime ${humanDuration(metrics.uptimeSec)}`].filter(Boolean).join(' · '));
  }

  function programState(program) {
    if (program.integrity === 'invalid') return { label: 'integrity failed', className: 'bad' };
    if (program.downloading) return { label: `downloading ${program.progress && program.progress.pct != null ? `${program.progress.pct}%` : '…'}`, className: 'ready' };
    if (!program.available && program.downloadable) return { label: 'downloads on launch · SHA-256 pinned', className: 'ready' };
    if (!program.available) return { label: 'not in this build', className: 'missing' };
    if (program.verified) return { label: 'SHA-256 verified', className: 'ok' };
    if (program.staged || program.installed) return { label: 'staged · verifies on launch', className: 'ready' };
    return { label: 'bundled · verifies on launch', className: 'ready' };
  }

  function programButtonLabel(program) {
    if (!program.launchable) return program.available || program.downloadable ? 'Windows only' : 'Full release';
    if (!program.available && program.downloadable) return program.requiresConfirmation ? 'Get & install' : 'Get & launch';
    return program.requiresConfirmation ? 'Install' : 'Launch';
  }

  function paintPrograms() {
    const grid = $('homePrograms');
    if (!dashboardPrograms.length) {
      grid.innerHTML = '<p class="home-empty">No bundled utilities were found in this build.</p>';
      return;
    }
    grid.innerHTML = dashboardPrograms.map((program) => {
      const state = programState(program);
      const detail = [program.version ? `v${program.version}` : '', humanBytes(program.sizeBytes)].filter(Boolean).join(' · ');
      return `<article class="program-tile ${state.className}" data-program-tile="${safe(program.id)}">
        <div class="program-glyph">${safe(PROGRAM_GLYPHS[program.id] || program.name.slice(0, 2).toUpperCase())}</div>
        <div class="program-copy">
          <div class="program-title"><h4>${safe(program.name)}</h4><span class="program-state">${safe(state.label)}</span></div>
          <p>${safe(program.desc)}</p>
          <div class="program-meta"><span>${safe(detail)}</span><span>${safe((program.tags || []).join(' · '))}</span></div>
        </div>
        <button class="btn program-launch" data-program="${safe(program.id)}" ${program.launchable && !program.downloading ? '' : 'disabled'}>${programButtonLabel(program)}</button>
      </article>`;
    }).join('');

    grid.querySelectorAll('[data-program]').forEach((button) => {
      button.addEventListener('click', () => launchProgram(button.dataset.program, button));
    });
  }

  async function loadPrograms(showMessage = false) {
    if (showMessage) setText('homeProgramMessage', 'Refreshing the managed launcher…');
    try {
      dashboardPrograms = await api.programs.list();
      paintPrograms();
      const available = dashboardPrograms.filter((program) => program.available).length;
      const remote = dashboardPrograms.filter((program) => !program.available && program.downloadable).length;
      const missing = dashboardPrograms.length - available - remote;
      setText('homeProgramMessage', remote
        ? `${available} of ${dashboardPrograms.length} tools in this build · ${remote} fetched on first launch · every executable is SHA-256 checked before it runs`
        : missing
          ? `${available} of ${dashboardPrograms.length} tools in this build · the rest ship only with the full Windows release · every executable is SHA-256 checked before it runs`
          : `All ${dashboardPrograms.length} Ionity tools are part of this build · every executable is SHA-256 checked before it runs`);
      if ($('homeCommand').matches(':focus')) paintCommandResults($('homeCommand').value);
    } catch (error) {
      setText('homeProgramMessage', `Launcher unavailable: ${error.message || error}`);
      $('homePrograms').innerHTML = '<p class="home-empty">The program service did not answer.</p>';
    }
  }

  async function launchProgram(id, button) {
    const program = dashboardPrograms.find((item) => item.id === id);
    if (!program) return;
    if (program.requiresConfirmation && !window.confirm(`${program.name} is a setup program. Verify and start its installer now?`)) return;

    const original = button ? button.textContent : '';
    const fetching = !program.available && program.downloadable;
    if (button) { button.disabled = true; button.textContent = fetching ? 'Downloading…' : 'Verifying…'; }
    setText('homeProgramMessage', fetching
      ? `Downloading ${program.name} (${humanBytes(program.sizeBytes)}) from the pinned programs release, then hash-checking it…`
      : `Hash-checking and preparing ${program.name}…`);
    try {
      const result = await api.programs.launch(program.id);
      if (result.ok) {
        setText('homeProgramMessage', result.origin === 'downloaded'
          ? `${program.name} downloaded, SHA-256 verified and launched from the managed folder.`
          : `${program.name} launched from its verified managed copy.`);
        if (button) button.textContent = 'Opened';
      } else {
        setText('homeProgramMessage', `${program.name}: ${result.error || 'could not launch'}`);
        if (button) button.textContent = 'Failed';
      }
    } catch (error) {
      setText('homeProgramMessage', `${program.name}: ${error.message || error}`);
      if (button) button.textContent = 'Failed';
    }
    await loadPrograms(false);
    if (button) setTimeout(() => { button.textContent = original; button.disabled = !program.launchable; }, 1800);
  }

  /* Local AI is Ollama on this machine. The Command Center keeps one small
     default model (settings.aiDefaultModel, llama3.2:1b ~1.3 GB, CPU-friendly)
     so the copilot works out of the box; bigger models stay a choice in the AI
     workspace. aiSetup = null | 'install' | 'pull' | 'busy'. */
  let aiSetup = null;
  let aiPulling = false;

  function defaultModel() {
    return (dashboardSettings && dashboardSettings.aiDefaultModel) || 'llama3.2:1b';
  }

  function showAiSetup(mode, label) {
    aiSetup = mode;
    const button = $('homeAiSetup');
    button.hidden = !mode;
    if (label) button.textContent = label;
    button.disabled = mode === 'busy';
  }

  async function refreshAiState() {
    if (aiPulling) return;
    setText('homeAiState', 'Scanning local inference services…');
    $('homeAiLamp').classList.remove('online');
    try {
      const [endpoints, targets] = await Promise.all([api.aiEndpoints(), api.aiTargets()]);
      const ollama = (endpoints || []).find((endpoint) => endpoint.id === 'ollama' || endpoint.kind === 'ollama');
      const model = defaultModel();
      if (targets.length) {
        $('homeAiLamp').classList.add('online');
        const preferred = targets.find((target) => String(target.model || '').startsWith(model.split(':')[0]));
        setText('homeAiState', `${targets.length} local model${targets.length === 1 ? '' : 's'} ready`);
        setText('homeAiDetail', (preferred ? [preferred.model, ...targets.filter((target) => target !== preferred).map((target) => target.model)] : targets.map((target) => target.model)).slice(0, 3).join(' · '));
        showAiSetup(preferred ? null : 'pull', `Add ${model}`);
      } else if (ollama && ollama.up) {
        setText('homeAiState', 'Ollama is running - no model yet');
        setText('homeAiDetail', `One click pulls ${model} (~1.3 GB), a small model that runs on CPU.`);
        showAiSetup('pull', `Get ${model}`);
      } else {
        setText('homeAiState', 'Ollama is not running');
        setText('homeAiDetail', `Install Ollama and ${model} from the Software workspace - ProGramerly does it in one pass.`);
        showAiSetup('install', 'Set up local AI');
      }
    } catch {
      setText('homeAiState', 'Local AI check unavailable');
      setText('homeAiDetail', 'The rest of the command center remains fully available.');
      showAiSetup(null);
    }
  }

  async function runAiSetup() {
    const model = defaultModel();
    if (aiSetup === 'install') {
      // Same path as ticking the items in Software: the installer engine,
      // dependency order, one elevation. Ollama first, then the small model.
      ['ollama', 'ollama-small'].forEach((id) => { if (CATALOG.items.some((item) => item.id === id)) selected.add(id); });
      renderItems();
      showTab('software');
      setText('homeAiDetail', 'Ollama and the starter model are ticked in Software - press Install.');
      return;
    }
    if (aiSetup === 'pull') {
      aiPulling = true;
      showAiSetup('busy', `Pulling ${model}…`);
      $('homeAiLamp').classList.remove('online');
      setText('homeAiState', `Pulling ${model}`);
      setText('homeAiDetail', 'Ollama is downloading the model - progress is in the AI workspace log.');
      try {
        const result = await api.aiPull(model);
        if (!result || !result.ok) setText('homeAiDetail', `Pull failed: ${(result && (result.error || result.code)) || 'unknown'}`);
      } catch (error) {
        setText('homeAiDetail', `Pull failed: ${error.message || error}`);
      } finally {
        aiPulling = false;
        showAiSetup(null);
        refreshAiState();
      }
    }
  }

  function openAiWorkspace(prompt) {
    showTab('ai');
    if (prompt) $('aiPrompt').value = prompt;
    requestAnimationFrame(() => $('aiPrompt').focus());
  }

  function workspaceCommands() {
    const commands = WORKSPACES.map((workspace) => ({ ...workspace, type: 'tab' }));
    dashboardPrograms.forEach((program) => commands.push({
      type: 'program',
      id: program.id,
      label: program.name,
      detail: program.available ? `Open ${program.product || program.name} (verified)`
        : program.downloadable ? `Download ${humanBytes(program.sizeBytes)}, verify and launch` : 'Not in this build',
      glyph: PROGRAM_GLYPHS[program.id] || 'APP',
      keys: `${program.id} ${(program.tags || []).join(' ')} ${program.desc}`,
      disabled: !program.launchable,
    }));
    commands.push({ type: 'kiosk', label: 'Enter kiosk mode', detail: 'Full-screen operator shell · Ctrl+Shift+K to leave', glyph: '▣', keys: 'fullscreen focus display' });
    return commands;
  }

  function paintCommandResults(query = '') {
    const needle = query.trim().toLowerCase();
    lastCommandItems = workspaceCommands()
      .filter((item) => !needle || `${item.label} ${item.detail} ${item.keys || ''}`.toLowerCase().includes(needle))
      .slice(0, 7);
    const box = $('homeCommandResults');
    box.innerHTML = lastCommandItems.length ? lastCommandItems.map((item, index) => `
      <button class="command-result" data-command-index="${index}" ${item.disabled ? 'disabled' : ''}>
        <span class="command-glyph">${safe(item.glyph)}</span>
        <span><b>${safe(item.label)}</b><small>${safe(item.detail)}</small></span>
        <kbd>↵</kbd>
      </button>`).join('') : '<p class="home-empty">No matching workspace or utility.</p>';
    box.hidden = false;
    box.querySelectorAll('[data-command-index]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => runCommand(lastCommandItems[Number(button.dataset.commandIndex)]));
    });
  }

  async function runCommand(command) {
    if (!command || command.disabled) return;
    $('homeCommandResults').hidden = true;
    $('homeCommand').value = '';
    if (command.type === 'tab') showTab(command.tab);
    if (command.type === 'program') await launchProgram(command.id, null);
    if (command.type === 'kiosk') await setKiosk(true);
  }

  function applyKioskUi(enabled) {
    document.body.classList.toggle('kiosk-shell', Boolean(enabled));
    $('kioskExitBtn').hidden = !enabled;
    $('homeKioskBtn').textContent = enabled ? 'Leave kiosk mode' : 'Enter kiosk mode';
    setText('homeModeState', enabled ? 'Kiosk shell active' : 'Desktop window');
    setText('homeModeDetail', enabled
      ? 'Full-screen focus is active · Ctrl+Shift+K exits'
      : 'Kiosk mode is opt-in and never traps the operator');
  }

  async function setKiosk(enabled) {
    if (kioskBusy) return;
    kioskBusy = true;
    $('homeKioskBtn').disabled = true;
    try {
      dashboardSettings = await api.setSettings({ kioskMode: Boolean(enabled) });
      applyKioskUi(Boolean(dashboardSettings.kioskMode));
    } finally {
      kioskBusy = false;
      $('homeKioskBtn').disabled = false;
    }
  }

  function paintOperations() {
    const syncState = dashboardSync || (INFO && INFO.sync) || {};
    const updateState = dashboardUpdate || (INFO && INFO.update) || null;
    const installed = Array.isArray(dashboardSettings.installedIds) ? dashboardSettings.installedIds.length : 0;

    setText('homeSyncState', syncState.enabled ? 'Scheduled sync active' : 'Scheduled sync off');
    setText('homeSyncDetail', syncState.enabled ? `next ${when(syncState.nextRunAt)}` : 'Run a report or sync from Operations');
    setText('homeUpdateState', updateState && updateState.available ? `v${updateState.latest} available` : `ProGramerly v${INFO.appVersion}`);
    setText('homeUpdateDetail', updateState && updateState.available ? 'Open Operations to review and install' : 'Update checks remain user-controlled');
    setText('homeInstallState', `${installed} managed package${installed === 1 ? '' : 's'}`);
    setText('homeInstallDetail', `${CATALOG.items.length} catalog entries · ${CATALOG.groups.length} groups`);
    applyKioskUi(Boolean(dashboardSettings.kioskMode));
  }

  function bindDashboard() {
    document.querySelectorAll('[data-home-tab]').forEach((button) => {
      button.addEventListener('click', () => showTab(button.dataset.homeTab));
    });

    $('homeProgramsRefresh').addEventListener('click', () => loadPrograms(true));
    $('homeProgramsFolder').addEventListener('click', () => api.programs.openFolder());
    $('homeAiOpen').addEventListener('click', () => openAiWorkspace($('homeAiPrompt').value.trim()));
    $('homeAiRefresh').addEventListener('click', refreshAiState);
    $('homeAiSetup').addEventListener('click', runAiSetup);
    $('homeAiPrompt').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openAiWorkspace($('homeAiPrompt').value.trim());
      }
    });
    document.querySelectorAll('[data-ai-seed]').forEach((button) => {
      button.addEventListener('click', () => {
        $('homeAiPrompt').value = button.dataset.aiSeed;
        openAiWorkspace(button.dataset.aiSeed);
      });
    });

    $('homeKioskBtn').addEventListener('click', () => setKiosk(!dashboardSettings.kioskMode));
    $('kioskExitBtn').addEventListener('click', () => setKiosk(false));

    $('homeCommand').addEventListener('focus', () => paintCommandResults($('homeCommand').value));
    $('homeCommand').addEventListener('input', () => paintCommandResults($('homeCommand').value));
    $('homeCommand').addEventListener('blur', () => setTimeout(() => { $('homeCommandResults').hidden = true; }, 120));
    $('homeCommand').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { $('homeCommandResults').hidden = true; $('homeCommand').blur(); }
      if (event.key === 'Enter') { event.preventDefault(); runCommand(lastCommandItems[0]); }
    });
    $('homeCommandBtn').addEventListener('click', () => {
      paintCommandResults($('homeCommand').value);
      runCommand(lastCommandItems[0]);
    });

    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setKiosk(!dashboardSettings.kioskMode);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        showTab('home');
        $('homeCommand').focus();
        $('homeCommand').select();
      }
    });

    api.onMetrics(paintMetrics);
    // Live download / verify progress for a utility that is being fetched from
    // the programs release. Paints in place; the full list is re-read on 'ready'.
    api.programs.onProgress((packet) => {
      if (!packet || !packet.id) return;
      const tile = document.querySelector(`[data-program-tile="${packet.id}"]`);
      if (!tile) return;
      const state = tile.querySelector('.program-state');
      const button = tile.querySelector('[data-program]');
      if (packet.phase === 'download') {
        const pct = packet.pct != null ? `${packet.pct}%` : '';
        if (state) state.textContent = `downloading ${pct} · ${humanBytes(packet.received)} of ${humanBytes(packet.total)}`;
        if (button) { button.disabled = true; button.textContent = `Downloading ${pct}`.trim(); }
        setText('homeProgramMessage', `Fetching ${packet.file} ${pct} · ${humanBytes(packet.received)} of ${humanBytes(packet.total)}`);
      } else if (packet.phase === 'verify') {
        if (state) state.textContent = 'verifying SHA-256…';
        if (button) button.textContent = 'Verifying…';
      } else if (packet.phase === 'copy') {
        if (state) state.textContent = 'staging verified copy…';
      } else if (packet.phase === 'failed') {
        if (state) state.textContent = 'download failed';
        setText('homeProgramMessage', `${packet.file}: ${packet.error || 'download failed'}`);
        loadPrograms(false);
      } else if (packet.phase === 'ready') {
        loadPrograms(false);
      }
    });
    api.onSettingsChanged((next) => {
      dashboardSettings = next || {};
      paintOperations();
    });
    api.onUpdateAvailable((next) => { dashboardUpdate = next; paintOperations(); });
    api.onUpdateChecked((next) => { dashboardUpdate = next; paintOperations(); });
    api.onSyncSchedule((next) => {
      dashboardSync = { ...(dashboardSync || {}), ...next };
      paintOperations();
    });
    api.onSyncDone(async () => {
      dashboardSync = await api.syncStatus();
      paintOperations();
    });
  }

  async function initialiseDashboard() {
    if (started) return;
    started = true;
    dashboardSettings = SETTINGS || {};
    dashboardSync = INFO.sync || null;
    dashboardUpdate = INFO.update || null;

    bindDashboard();
    updateClock();
    setInterval(updateClock, 1000);
    paintOperations();

    const work = [
      api.metrics().then(paintMetrics),
      loadPrograms(false),
      refreshAiState(),
      api.syncStatus().then((state) => { dashboardSync = state; paintOperations(); }),
    ];
    await Promise.allSettled(work);

    // The setting is persisted, but BrowserWindow kiosk state is applied by
    // the main process only when this explicit setting message arrives.
    if (dashboardSettings.kioskMode) await setKiosk(true);

    // Re-read later so an operator-triggered launch or an external managed
    // folder change is reflected without restarting the shell.
    setTimeout(() => loadPrograms(false), 20000);
  }

  boot = async function bootWithCommandCenter() {
    await coreBoot();
    showTab('home');
    initialiseDashboard().catch((error) => {
      setText('homeProgramMessage', `Command Center started with limited data: ${error.message || error}`);
    });
  };
})();
