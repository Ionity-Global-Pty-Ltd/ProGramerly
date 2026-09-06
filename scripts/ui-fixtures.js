'use strict';
/* ProGramerly - UI fixtures
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Windows-only screens cannot be looked at from a Linux CI runner, and a
   screen nobody has ever looked at is a screen nobody has tested. Set
   PROGRAMERLY_UI_FIXTURES=1 and the Windows-only readers return a fixed
   sample so the layout can be rendered and screenshotted anywhere.

   This file is never reached unless that variable is set. */

const path = require('node:path');
const fs = require('node:fs');

function registryScan() {
  const data = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'data', 'registry-fixes.json'), 'utf8',
  ));

  const fixes = data.fixes.map((fix, idx) => {
    // Alternate so both states are visible in one screenshot.
    const actionable = idx % 3 !== 1;
    const values = fix.values.map((v) => {
      if (fix.action === 'remove') {
        return { ...v, current: actionable ? '{4d36e967-e325-11ce-bfc1-08002be10318}' : null, state: actionable ? 'present' : 'clean' };
      }
      if (!actionable) return { ...v, current: v.data, state: 'correct' };
      return { ...v, current: typeof v.data === 'number' ? 4 : '', state: idx % 2 ? 'missing' : 'wrong' };
    });
    return { ...fix, values, status: actionable ? 'actionable' : 'clean' };
  });

  return {
    ok: true,
    fixes,
    tools: data.tools,
    meta: data.meta,
    actionable: fixes.filter((f) => f.status === 'actionable').length,
    fixture: true,
  };
}

module.exports = { registryScan, enabled: () => process.env.PROGRAMERLY_UI_FIXTURES === '1' };
