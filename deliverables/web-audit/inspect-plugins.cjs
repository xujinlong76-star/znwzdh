const cp=require('child_process');
const out=cp.execSync('curl -s --noproxy * -m 20 "http://127.0.0.1:8787/api/plugins?limit=80"',{encoding:'utf8'});
let d;try{d=JSON.parse(out)}catch(e){console.log('parse err',out.slice(0,200));process.exit(0);}
const arr=Array.isArray(d)?d:(d.items||[]);
console.log('total plugins:',arr.length);
const nonAscii=arr.filter(p=>!/^[\x00-\x7F]*$/.test(p.slug||''));
console.log('non-ASCII slug count:',nonAscii.length);
nonAscii.slice(0,30).forEach(p=>console.log('  slug=',JSON.stringify(p.slug),'name=',p.name,'status=',p.status));
