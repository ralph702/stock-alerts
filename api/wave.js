// ─────────────────────────────────────────────────────────────────────
// /api/wave.js  —  🌊 WAVE SCANNER v2
//
// Built from a lookback at what ACTUALLY preceded NVDA's 2023 run,
// SanDisk's post-spinoff rip, and Bloom Energy's contract-driven moves:
//
//   NVDA lesson  → up-day volume dominated down-day volume for months
//                  (quiet institutional accumulation) + it was crushing
//                  its own sector (SOXX) BEFORE the earnings gap.
//   SNDK lesson  → spinoffs/new listings re-rate after forced selling.
//   BE lesson    → contract news + building volume weeks prior.
//
// WAVE SCORE v2 (0-100):
//   1. ACCUMULATION  (25) — up-day vol / down-day vol, last 20 sessions
//   2. REL STRENGTH  (20) — 60-day return vs SMH (sector benchmark)
//   3. STAGE TREND   (20) — above rising 50-day avg + higher lows
//   4. BASE+BREAKOUT (20) — tight base + distance from 52-week high
//   5. MOMENTUM      (15) — steady 20-day gain (parabolic = half credit)
//
// Edge-cached 6h. Uses Massive daily bars (Starter plan OK).
// ─────────────────────────────────────────────────────────────────────

const UNIVERSE = [
  { sym:'ALAB', name:'Astera Labs',       cat:'Chips' },
  { sym:'CRDO', name:'Credo Tech',        cat:'Chips' },
  { sym:'SITM', name:'SiTime',            cat:'Chips' },
  { sym:'RMBS', name:'Rambus',            cat:'Chips' },
  { sym:'MPWR', name:'Monolithic Power',  cat:'Chips' },
  { sym:'ONTO', name:'Onto Innovation',   cat:'Chip Equip' },
  { sym:'CAMT', name:'Camtek',            cat:'Chip Equip' },
  { sym:'ACLS', name:'Axcelis',           cat:'Chip Equip' },
  { sym:'AEHR', name:'Aehr Test',         cat:'Chip Equip' },
  { sym:'FORM', name:'FormFactor',        cat:'Chip Equip' },
  { sym:'LSCC', name:'Lattice Semi',      cat:'Chips' },
  { sym:'AMBA', name:'Ambarella',         cat:'Edge AI' },
  { sym:'MTSI', name:'MACOM',             cat:'Chips' },
  { sym:'POWI', name:'Power Integrations',cat:'Chips' },
  { sym:'LITE', name:'Lumentum',          cat:'Optical' },
  { sym:'COHR', name:'Coherent',          cat:'Optical' },
  { sym:'AAOI', name:'Applied Opto',      cat:'Optical' },
  { sym:'CIEN', name:'Ciena',             cat:'Networking' },
  { sym:'SNDK', name:'SanDisk',           cat:'Storage' },
  { sym:'STX',  name:'Seagate',           cat:'Storage' },
  { sym:'WDC',  name:'Western Digital',   cat:'Storage' },
  { sym:'APLD', name:'Applied Digital',   cat:'Data Center' },
  { sym:'NBIS', name:'Nebius',            cat:'AI Cloud' },
  { sym:'IREN', name:'IREN',              cat:'AI Cloud' },
  { sym:'WULF', name:'TeraWulf',          cat:'Data Center' },
  { sym:'CIFR', name:'Cipher Mining',     cat:'Data Center' },
  { sym:'CORZ', name:'Core Scientific',   cat:'Data Center' },
  { sym:'VRT',  name:'Vertiv',            cat:'DC Cooling' },
  { sym:'BE',   name:'Bloom Energy',      cat:'AI Energy' },
  { sym:'OKLO', name:'Oklo',              cat:'Nuclear' },
  { sym:'SMR',  name:'NuScale',           cat:'Nuclear' },
  { sym:'NNE',  name:'Nano Nuclear',      cat:'Nuclear' },
  { sym:'VST',  name:'Vistra',            cat:'AI Energy' },
  { sym:'TLN',  name:'Talen Energy',      cat:'AI Energy' },
  { sym:'EOSE', name:'Eos Energy',        cat:'Storage/Grid' },
  { sym:'PLUG', name:'Plug Power',        cat:'Hydrogen' },
];

function sma(arr, n, offset=0){
  const end=arr.length-offset;
  if(end<n) return null;
  const s=arr.slice(end-n,end);
  return s.reduce((a,b)=>a+b,0)/n;
}

function computeWave(bars, benchRet60){
  if(!bars||bars.length<60) return null;
  const closes=bars.map(b=>b.c), vols=bars.map(b=>b.v);
  const lows=bars.map(b=>b.l), highs=bars.map(b=>b.h);
  const last=closes[closes.length-1], n=closes.length;

  // 1. ACCUMULATION (25) — the NVDA tell
  let upV=0,dnV=0;
  for(let i=Math.max(1,n-20);i<n;i++){
    if(closes[i]>closes[i-1]) upV+=vols[i];
    else if(closes[i]<closes[i-1]) dnV+=vols[i];
  }
  const adRatio=dnV>0?upV/dnV:(upV>0?3:1);
  const accPts=Math.max(0,Math.min(25,((adRatio-0.8)/1.2)*25));

  // 2. RELATIVE STRENGTH vs sector (20)
  const c60=closes[Math.max(0,n-61)];
  const ret60=((last-c60)/c60)*100;
  const rs=ret60-(benchRet60||0);
  const rsPts=Math.max(0,Math.min(20,(rs/25)*20));

  // 3. STAGE TREND (20)
  const s50=sma(closes,50), s50prev=sma(closes,50,10);
  let trendPts=0;
  if(s50&&last>s50) trendPts+=8;
  if(s50&&s50prev&&s50>s50prev) trendPts+=6;
  const lowA=Math.min(...lows.slice(Math.max(0,n-30),n-15));
  const lowB=Math.min(...lows.slice(n-15));
  const higherLows=lowB>lowA;
  if(higherLows) trendPts+=6;

  // 4. BASE + BREAKOUT (20)
  const hi52=Math.max(...closes);
  const pctFromHigh=((hi52-last)/hi52)*100;
  let brkPts=0;
  if(pctFromHigh<=2) brkPts+=12;
  else if(pctFromHigh<=8) brkPts+=8;
  else if(pctFromHigh<=15) brkPts+=4;
  const r15=Math.max(...highs.slice(-15))-Math.min(...lows.slice(-15));
  const r45=Math.max(...highs.slice(-45))-Math.min(...lows.slice(-45));
  const tight=r45>0?r15/r45:1;
  if(tight<=0.35) brkPts+=8;
  else if(tight<=0.5) brkPts+=5;
  else if(tight<=0.7) brkPts+=2;
  brkPts=Math.min(20,brkPts);

  // 5. MOMENTUM (15)
  const c20=closes[Math.max(0,n-21)];
  const mom20=((last-c20)/c20)*100;
  let momPts=0;
  if(mom20>0) momPts=Math.min(15,(mom20/25)*15);
  if(mom20>60) momPts=7;

  const score=Math.round(accPts+rsPts+trendPts+brkPts+momPts);
  return{
    score:Math.max(0,Math.min(100,score)),
    adRatio:Math.round(adRatio*100)/100,
    rs60:Math.round(rs*10)/10,
    mom20:Math.round(mom20*10)/10,
    aboveSMA50:s50?last>s50:false,
    higherLows, pctFromHigh:Math.round(pctFromHigh*10)/10,
    newHigh:pctFromHigh<=0.5, tightBase:tight<=0.5,
    price:Math.round(last*100)/100,
  };
}

async function fetchBars(sym,KEY,from,to){
  const url=`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=400&apiKey=${KEY}`;
  const r=await fetch(url);
  if(!r.ok) return null;
  const d=await r.json();
  return(d.results||[]).map(b=>({c:b.c,v:b.v,l:b.l,h:b.h}));
}

async function mapLimit(items,limit,fn){
  const out=[];let i=0;
  await Promise.all(Array(Math.min(limit,items.length)).fill(0).map(async()=>{
    while(i<items.length){const idx=i++;out[idx]=await fn(items[idx]);}
  }));
  return out;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Cache-Control','s-maxage=21600, stale-while-revalidate=86400');
  if(req.method==='OPTIONS') return res.status(200).end();

  const KEY=process.env.MASSIVE_KEY;
  if(!KEY) return res.status(500).json({ok:false,error:'MASSIVE_KEY not set'});

  const to=new Date();
  const from=new Date(to.getTime()-380*24*3600*1000);
  const f=d=>d.toISOString().slice(0,10);

  let benchRet60=0;
  try{
    const bb=await fetchBars('SMH',KEY,f(from),f(to));
    if(bb&&bb.length>61){
      const bl=bb[bb.length-1].c,b60=bb[bb.length-61].c;
      benchRet60=((bl-b60)/b60)*100;
    }
  }catch(e){}

  const results=await mapLimit(UNIVERSE,8,async(u)=>{
    try{
      const bars=await fetchBars(u.sym,KEY,f(from),f(to));
      const w=computeWave(bars,benchRet60);
      if(!w) return null;
      return{...u,...w};
    }catch(e){return null;}
  });

  const stocks=results.filter(Boolean).sort((a,b)=>b.score-a.score);
  return res.status(200).json({
    ok:true, ts:Date.now(),
    scannedAt:new Date().toISOString(),
    benchRet60:Math.round(benchRet60*10)/10,
    count:stocks.length,
    alarmCount:stocks.filter(s=>s.score>=85).length,
    waveCount:stocks.filter(s=>s.score>=70&&s.score<85).length,
    stocks,
  });
}
