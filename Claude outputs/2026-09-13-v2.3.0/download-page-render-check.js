const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('file:///G:/.Development/ProGramerly-Basic%20Software%20for%20All/docs/index.html'); await p.waitForTimeout(3500);
  const out = await p.evaluate(() => ({
    relmeta: document.getElementById('relmeta').textContent,
    utilmeta: document.getElementById('utilmeta').textContent,
    rows: document.querySelectorAll('#dlBody tr').length,
    utilRows: document.querySelectorAll('#utilBody tr').length,
    cards: document.querySelectorAll('#utilGrid .util').length,
    firstDl: document.querySelector('#dlBody a').href,
    firstUtil: document.querySelector('#utilGrid a.get').href,
    primary: document.getElementById('dlPrimaryLabel').textContent,
  }));
  console.log(JSON.stringify(out, null, 1)); console.log('page errors:', errors);
  await p.goto('file:///G:/.Development/ProGramerly-Basic%20Software%20for%20All/docs/index.html#utilities'); await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/pgtest/utilities.png' });
  await b.close();
})();
