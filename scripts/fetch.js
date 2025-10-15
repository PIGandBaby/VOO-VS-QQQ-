// scripts/fetch.js
// 매일 실행되어 Stooq CSV에서 VOO/QQQ 종가를 받아 data/series.json을 갱신합니다.
// 주의: 무료 소스 특성상 갱신 시점/가용성은 보장되지 않음(일부 내용은 **추측**).

import fs from 'node:fs';
import path from 'node:path';

const BASE_DATE = '2025-10-15'; // 정규화 기준일 (이 날의 종가를 1.0으로)
const OUT = path.join(process.cwd(), 'data', 'series.json');

const TICKERS = {
  VOO: 'voo.us',
  QQQ: 'qqq.us',
};

async function fetchCSV(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.text();
}

function parseCSV(text) {
  // Date,Open,High,Low,Close,Volume
  const rows = text.trim().split(/\r?\n/);
  rows.shift(); // header
  const map = new Map();
  for (const line of rows) {
    const [Date, Open, High, Low, Close] = line.split(',');
    if (Date && Close && Close !== 'NULL') map.set(Date, Number(Close));
  }
  return map; // date -> close
}

function loadSeries() {
  if (fs.existsSync(OUT)) {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    return j;
  }
  return { baseDate: BASE_DATE, vooBaseClose: null, qqqBaseClose: null, series: [] };
}

function saveSeries(obj) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(obj, null, 2));
}

function ymd(d) { return d; } // already YYYY-MM-DD

(async () => {
  try {
    const [csvV, csvQ] = await Promise.all([
      fetchCSV(TICKERS.VOO),
      fetchCSV(TICKERS.QQQ)
    ]);
    const mapV = parseCSV(csvV);
    const mapQ = parseCSV(csvQ);

    const data = loadSeries();

    // base close (first run)
    if (!data.vooBaseClose) data.vooBaseClose = mapV.get(BASE_DATE) ?? null;
    if (!data.qqqBaseClose) data.qqqBaseClose = mapQ.get(BASE_DATE) ?? null;

    if (!data.vooBaseClose || !data.qqqBaseClose) {
      console.log('[warn] base close missing for BASE_DATE. Will wait until available.');
      saveSeries(data);
      process.exit(0);
    }

    const lastDate = data.series.length ? data.series[data.series.length - 1].date : null;

    const allDates = [...mapV.keys()].filter(d => mapQ.has(d) && d >= BASE_DATE).sort();
    const startIndex = lastDate ? Math.max(0, allDates.indexOf(lastDate) + 1) : 0;

    const toAppend = [];
    for (let i = startIndex; i < allDates.length; i++) {
      const d = allDates[i];
      const vClose = mapV.get(d);
      const qClose = mapQ.get(d);
      if (!vClose || !qClose) continue;
      toAppend.push({
        date: ymd(d),
        vooClose: vClose,
        qqqClose: qClose,
        vooN: Number((vClose / data.vooBaseClose).toFixed(6)),
        qqqN: Number((qClose / data.qqqBaseClose).toFixed(6)),
      });
    }

    if (!toAppend.length) {
      console.log('No new rows to append.');
      process.exit(0);
    }

    data.series.push(...toAppend);
    saveSeries(data);
    console.log(`Appended ${toAppend.length} rows. Last: ${toAppend[toAppend.length-1].date}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
