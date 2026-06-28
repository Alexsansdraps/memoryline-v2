import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
const urls = readFileSync('/tmp/ml-archive/product-urls.txt','utf8').split('\n').filter(Boolean);
function balanced(str){let d=0;for(let i=0;i<str.length;i++){if(str[i]==='{')d++;else if(str[i]==='}'){d--;if(d===0)return str.slice(0,i+1);}}return null;}
const b = await chromium.launch();
const results = {}; let done=0, ok=0;
for (const url of urls) {
  const slug = url.split('/products/')[1];
  const p = await b.newPage();
  try {
    await p.goto(url, {waitUntil:'networkidle', timeout:35000});
    await p.waitForTimeout(1500);
    const blob = await p.evaluate(() => {
      const t=[...document.querySelectorAll('script:not([src])')].map(s=>s.textContent)
        .find(x=>/\{"backgrounds":/.test(x));
      if(!t) return null;
      return t.slice(t.indexOf('{"backgrounds":'));
    });
    if (blob) {
      const raw = balanced(blob);
      try { results[slug] = JSON.parse(raw.replace(/\\\//g,'/')); ok++; } catch {}
    }
  } catch(e){}
  await p.close();
  done++;
  if(done%25===0) console.log(`  ${done}/${urls.length} (${ok} configs)`);
}
writeFileSync('/tmp/ml-archive/product-configs.json', JSON.stringify(results,null,2));
console.log(`TERMINÉ: ${done} fiches, ${ok} configs produit récupérées`);
await b.close();
