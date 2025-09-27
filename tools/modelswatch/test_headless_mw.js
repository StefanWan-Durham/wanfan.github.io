const puppeteer = require('puppeteer');

async function run(){
  const url = 'http://127.0.0.1:8000/lab/modelswatch/modelswatch.html';
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push({type: msg.type(), text: msg.text()}));

  try{
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // switch to HF mode
    await page.waitForSelector('#mw-modes button[data-mode="hf"]', {timeout:5000});
    await page.click('#mw-modes button[data-mode="hf"]');
    // allow render
    await page.waitForTimeout(500);

    // open cascader
    await page.waitForSelector('#mw-cas-trigger', {timeout:5000});
    await page.click('#mw-cas-trigger');
    await page.waitForSelector('#mw-cas-dd', {timeout:2000});

    // enable cross-date via cascader toggle
    await page.waitForSelector('#mw-toggle-all-cas', {timeout:2000});

    // Listen for the aggregated JSON request
    let allHFRequested = false;
    page.on('request', req => {
      const u = req.url();
      if(u.includes('all_dates_hf.json')) allHFRequested = true;
    });

    // click toggle
    await page.click('#mw-toggle-all-cas');

    // wait for either the all_dates_hf.json request or itemsAll population
    const waited = await Promise.race([
      page.waitForResponse(r => r.url().includes('all_dates_hf.json') && r.status()===200, {timeout:15000}).then(()=>({type:'response'})).catch(()=>null),
      page.waitForFunction(()=> window.itemsAll && Array.isArray(window.itemsAll) && window.itemsAll.length>0, {timeout:15000}).then(()=>({type:'itemsAll'})).catch(()=>null)
    ]);

    // capture task counts
    const taskCounts = await page.evaluate(()=> {
      return (window.__mw_task_counts && typeof window.__mw_task_counts === 'object') ? window.__mw_task_counts : null;
    });

    // ensure cascader columns rendered; pick first visible task in col3
    await page.waitForSelector('#mw-cas-c3 .mw-item', {timeout:5000});
    const taskKey = await page.evaluate(()=>{
      const el = document.querySelector('#mw-cas-c3 .mw-item');
      if(!el) return null;
      // dataset may not carry key for third column; the item has label and click toggles selectedTasks set.
      // Try to extract a task key from data attributes or nearby mapping: prefer to read map from CAT_TREE.
      const label = el.textContent.trim();
      // compute task key via CAT_TREE lookup if available
      try{
        const map = new Map();
        (CAT_TREE||[]).forEach(c=> (c.subcategories||[]).forEach(s=> (s.tasks||[]).forEach(t=> map.set(t.key, t))));
        // find key by matching label in any locale
        for(const [k,v] of map.entries()){
          if(v.zh===label || v.en===label || v.es===label) return k;
        }
      }catch{}
      return label || null;
    });

    // click the first task item to toggle selection
    await page.click('#mw-cas-c3 .mw-item');
    await page.waitForTimeout(200);

    // close cascader (applies filter)
    await page.click('#mw-cas-close');
    // wait for applyFilter to hide/show cards
    await page.waitForTimeout(800);

    // measure visible cards and how many match selected task key
    const stats = await page.evaluate((tk)=>{
      const cards = Array.from(document.querySelectorAll('.mw-card'));
      const visible = cards.filter(c=> c.offsetParent !== null && getComputedStyle(c).display !== 'none');
      let matched = 0;
      try{
        for(const c of visible){
          const dk = c.getAttribute('data-task-keys')||'';
          if(!tk) continue;
          if(dk.split(/\s+/).includes(tk)) matched++;
        }
      }catch{}
      return {visible: visible.length, matched};
    }, taskKey);

    const result = { allHFRequested, waited, taskKey, taskCounts, stats, logs };
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
    return 0;
  }catch(e){
    console.error('ERROR', e);
    try{ await browser.close(); }catch{};
    process.exitCode = 2;
    return 2;
  }
}

run();
