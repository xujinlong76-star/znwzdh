import fs from 'node:fs';

async function checkSite(name, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const text = await res.text();
    const links = [...text.matchAll(/<link[^>]+>/gi)].map(m => m[0]).filter(l => l.includes('icon'));
    console.log(`=== ${name} (${url}) ===`);
    links.forEach(l => console.log('  ', l));
  } catch (e) {
    console.log(`=== ${name} ERROR ===`, e.message);
  }
}

async function run() {
  await checkSite('Doubao', 'https://www.doubao.com/');
  await checkSite('Yiyan', 'https://yiyan.baidu.com/');
  await checkSite('Lingma', 'https://lingma.aliyun.com/');
  await checkSite('Runway', 'https://runwayml.com/');
  await checkSite('Kimi', 'https://kimi.moonshot.cn/');
}

run();
