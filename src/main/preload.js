'use strict';
/**
 * ProGramerly - preload bridge
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The renderer gets exactly these calls and nothing else. No Node, no fs,
 * no arbitrary IPC channel names.
 */

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('programerly', {
  /* ------------------------------------------------------------ catalog */
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  start: (ids) => ipcRenderer.invoke('install:start', ids),
  cancel: () => ipcRenderer.invoke('install:cancel'),

  /* ---------------------------------------------------------------- app */
  elevate: () => ipcRenderer.invoke('app:elevate'),
  openLog: () => ipcRenderer.invoke('app:openLog'),
  openDevRoot: () => ipcRenderer.invoke('app:openDevRoot'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  createShortcut: () => ipcRenderer.invoke('app:createShortcut'),
  loginState: () => ipcRenderer.invoke('app:loginState'),
  minimiseToTray: () => ipcRenderer.invoke('app:minimiseToTray'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /* ----------------------------------------------------------- settings */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  /* -------------------------------------------------------------- intro */
  introConfig: () => ipcRenderer.invoke('intro:config'),
  introDone: () => ipcRenderer.send('intro:done'),

  /* ------------------------------------------------------------ metrics */
  metrics: () => ipcRenderer.invoke('metrics:snapshot'),

  /* ------------------------------------------------------------ network */
  geo: () => ipcRenderer.invoke('net:geo'),
  sweep: () => ipcRenderer.invoke('net:sweep'),
  cancelSweep: () => ipcRenderer.invoke('net:cancel'),
  speedTest: () => ipcRenderer.invoke('net:speedtest'),
  links: () => ipcRenderer.invoke('net:links'),
  checkLinks: () => ipcRenderer.invoke('net:checkLinks'),

  /* --------------------------------------------------------------- sync */
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncRun: (opts) => ipcRenderer.invoke('sync:run', opts),

  /* ------------------------------------------------------------- update */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: (file) => ipcRenderer.invoke('update:install', file),

  /* ----------------------------------------------------------- registry */
  registryScan: () => ipcRenderer.invoke('registry:scan'),
  registryApply: (ids) => ipcRenderer.invoke('registry:apply', ids),
  registryTool: (id) => ipcRenderer.invoke('registry:tool', id),
  registryOpenEditor: (key) => ipcRenderer.invoke('registry:openEditor', key),
  registryOpenBackups: () => ipcRenderer.invoke('registry:openBackups'),

  /* ------------------------------------------------------------- publish */
  publishStatus: () => ipcRenderer.invoke('publish:status'),
  publishSetRepo: (patch) => ipcRenderer.invoke('publish:setRepo', patch),
  publishSetToken: (token) => ipcRenderer.invoke('publish:setToken', token),
  publishClearToken: () => ipcRenderer.invoke('publish:clearToken'),
  publishInstallGh: () => ipcRenderer.invoke('publish:installGh'),
  publishRun: () => ipcRenderer.invoke('publish:run'),

  /* -------------------------------------------------------------- doctor */
  doctorScan: () => ipcRenderer.invoke('doctor:scan'),
  doctorFix: (id) => ipcRenderer.invoke('doctor:fix', id),
  doctorFixAll: () => ipcRenderer.invoke('doctor:fixAll'),
  doctorReport: () => ipcRenderer.invoke('doctor:report'),
  doctorOpenFolder: () => ipcRenderer.invoke('doctor:openFolder'),
  doctorEnvironment: () => ipcRenderer.invoke('doctor:environment'),
  doctorCleanScan: () => ipcRenderer.invoke('doctor:cleanScan'),
  doctorCleanRun: (ids) => ipcRenderer.invoke('doctor:cleanRun', ids),
  doctorPort: (port) => ipcRenderer.invoke('doctor:port', port),
  doctorPortScan: () => ipcRenderer.invoke('doctor:portScan'),

  /* ------------------------------------------------------------------ ai */
  aiEndpoints: () => ipcRenderer.invoke('ai:endpoints'),
  aiModels: () => ipcRenderer.invoke('ai:models'),
  aiLoaded: () => ipcRenderer.invoke('ai:loaded'),
  aiPull: (model) => ipcRenderer.invoke('ai:pull', model),
  aiDelete: (model) => ipcRenderer.invoke('ai:delete', model),
  aiCurated: () => ipcRenderer.invoke('ai:curated'),
  aiEnvironments: () => ipcRenderer.invoke('ai:environments'),
  aiTargets: () => ipcRenderer.invoke('ai:targets'),
  aiChat: (req) => ipcRenderer.invoke('ai:chat', req),
  aiBenchmark: (target) => ipcRenderer.invoke('ai:benchmark', target),
  aiGpu: () => ipcRenderer.invoke('ai:gpu'),
  aiExplain: (req) => ipcRenderer.invoke('ai:explain', req),

  /* ------------------------------------------------------------ projects */
  projScan: () => ipcRenderer.invoke('proj:scan'),
  projFetch: (dir) => ipcRenderer.invoke('proj:fetch', dir),
  projFetchAll: () => ipcRenderer.invoke('proj:fetchAll'),
  projOpenEditor: (dir) => ipcRenderer.invoke('proj:openEditor', dir),

  /* ----------------------------------------------------------- terminals */
  termList: () => ipcRenderer.invoke('term:list'),
  termOpen: (id, extra) => ipcRenderer.invoke('term:open', { id, extra }),
  termWsl: () => ipcRenderer.invoke('term:wsl'),

  /* ------------------------------------------------------------ hardware */
  hwSensors: () => ipcRenderer.invoke('hw:sensors'),
  hwTools: () => ipcRenderer.invoke('hw:tools'),
  hwInstallTool: (id) => ipcRenderer.invoke('hw:installTool', id),
  hwLaunchTool: (id) => ipcRenderer.invoke('hw:launchTool', id),
  hwMemory: () => ipcRenderer.invoke('hw:memory'),
  hwRamFlush: () => ipcRenderer.invoke('hw:ramFlush'),
  hwPurgeStandby: () => ipcRenderer.invoke('hw:purgeStandby'),
  hwClearTemp: () => ipcRenderer.invoke('hw:clearTemp'),

  /* ----------------------------------------------------------------- rgb */
  rgbStatus: () => ipcRenderer.invoke('rgb:status'),
  rgbSetColor: (hex, device) => ipcRenderer.invoke('rgb:setColor', { hex, device }),
  rgbApplyMode: (device, mode) => ipcRenderer.invoke('rgb:applyMode', { device, mode }),

  /* ------------------------------------------------------------- profile */
  profileGet: () => ipcRenderer.invoke('profile:get'),
  profileSave: (patch) => ipcRenderer.invoke('profile:save', patch),

  /* ------------------------------------------------------------- events */
  onLog: (cb) => on('install:log', cb),
  onItem: (cb) => on('install:item', cb),
  onQueue: (cb) => on('install:queue', cb),
  onDone: (cb) => on('install:done', cb),
  onMetrics: (cb) => on('metrics:tick', cb),
  onHud: (cb) => on('hud:data', cb),
  onNetProgress: (cb) => on('net:progress', cb),
  onSpeed: (cb) => on('net:speed', cb),
  onSpeedDone: (cb) => on('net:speedDone', cb),
  onSyncLog: (cb) => on('sync:log', cb),
  onSyncLinks: (cb) => on('sync:links', cb),
  onSyncStart: (cb) => on('sync:start', cb),
  onSyncDone: (cb) => on('sync:done', cb),
  onSyncSchedule: (cb) => on('sync:schedule', cb),
  onUpdateAvailable: (cb) => on('update:available', cb),
  onUpdateChecked: (cb) => on('update:checked', cb),
  onUpdateProgress: (cb) => on('update:progress', cb),
  onUpdateDownloaded: (cb) => on('update:downloaded', cb),
  onMaintLog: (cb) => on('maint:log', cb),
  onPublishLog: (cb) => on('publish:log', cb),
  onDoctorLog: (cb) => on('doctor:log', cb),
  onAiLog: (cb) => on('ai:log', cb),
  onAiToken: (cb) => on('ai:token', cb),
  onProjLog: (cb) => on('proj:log', cb),
  onHwLog: (cb) => on('hw:log', cb),
  onSettingsChanged: (cb) => on('settings:changed', cb),
  onTab: (cb) => on('ui:tab', cb),
  onAction: (cb) => on('ui:action', cb),
});
