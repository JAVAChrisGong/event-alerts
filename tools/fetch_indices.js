// 抓取 8 个指数日K（2020-06 至今），生成 data/indices.json + data/indices.js
// 多数据源自动切换（主源失败自动换备源）：
//   A 股 / 中证2000 / 美股 各有 2 个源，任一成功即可；全部失败时保留旧数据
// 海外环境（GitHub Actions）实测：腾讯 A 股源可用；中证官网 / 新浪美股源不可用 → 自动切东财
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "data", "indices.json");
const OUT_JS = path.join(__dirname, "..", "data", "indices.js");
const BEG = "2020-06-01";

const INDICES = [
  { key: "sh000001", name: "上证指数", market: "A 股",
    sources: [{ kind: "cn", code: "sh000001" }, { kind: "em", secid: "1.000001" }] },
  { key: "sz399006", name: "创业板指", market: "A 股",
    sources: [{ kind: "cn", code: "sz399006" }, { kind: "em", secid: "0.399006" }] },
  { key: "hs300", name: "沪深 300", market: "A 股",
    sources: [{ kind: "cn", code: "sh000300" }, { kind: "em", secid: "1.000300" }] },
  { key: "sh000688", name: "科创 50", market: "A 股",
    sources: [{ kind: "cn", code: "sh000688" }, { kind: "em", secid: "1.000688" }] },
  { key: "csi2000", name: "中证 2000", market: "A 股",
    sources: [{ kind: "csindex", code: "932000" }, { kind: "em", secid: "2.932000" }] },
  { key: "ixic", name: "纳斯达克综合", market: "美股",
    sources: [{ kind: "us", sina: ".IXIC" }, { kind: "em", secid: "100.NDX" }] },
  { key: "dji", name: "道琼斯工业", market: "美股",
    sources: [{ kind: "us", sina: ".DJI" }, { kind: "em", secid: "100.DJIA" }] },
  { key: "spx", name: "标普 500", market: "美股",
    sources: [{ kind: "us", sina: ".INX" }, { kind: "em", secid: "100.SPX" }] },
];

function fetchUrl(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: "https://gu.qq.com/" } }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        if (res.statusCode === 200) resolve(buf);
        else reject(new Error("HTTP " + res.statusCode));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(new Error("timeout")); });
  }).catch(err => {
    if (retries <= 0) throw err;
    const wait = 1500 * (4 - retries);
    return new Promise(r => setTimeout(r, wait)).then(() => fetchUrl(url, retries - 1));
  });
}

async function fetchCN(code) {
  const url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + code + ",day,,,2000,qfq";
  const j = JSON.parse(await fetchUrl(url));
  const kl = j.data && j.data[code] && j.data[code].day;
  if (!kl || !kl.length) throw new Error(code + " no data");
  return kl.map(row => [row[0], +(+row[1]).toFixed(2), +(+row[2]).toFixed(2), +(+row[3]).toFixed(2), +(+row[4]).toFixed(2), Math.round(+row[5])]);
}

async function fetchUS(symbol) {
  const url = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20d=/US_MinKService.getDailyK?symbol=" + symbol + "&___qn=3";
  const t = await fetchUrl(url);
  const m = t.match(/=\s*\((\[.*\])\)/s);
  if (!m) throw new Error(symbol + " no match");
  const arr = JSON.parse(m[1]);
  return arr.map(r => [r.d, +(+r.o).toFixed(2), +(+r.c).toFixed(2), +(+r.h).toFixed(2), +(+r.l).toFixed(2), Math.round(+r.v)]);
}

async function fetchCsindex(code) {
  const url = "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=" + code + "&startDate=20200601&endDate=20990101";
  const j = JSON.parse(await fetchUrl(url));
  const d = j.data || [];
  if (!d.length) throw new Error(code + " no data");
  const norm = s => /^\d{8}$/.test(s) ? s.slice(0,4) + "-" + s.slice(4,6) + "-" + s.slice(6,8) : s;
  return d.map(r => [norm(r.tradeDate), +(+r.open).toFixed(2), +(+r.close).toFixed(2), +(+r.high).toFixed(2), +(+r.low).toFixed(2), Math.round(+r.tradingVol || 0)]);
}

// 东方财富（海外可达，全量）：返回 [date, open, close, high, low, vol]
async function fetchEM(secid) {
  const url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" + secid +
    "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&lmt=3000&beg=20200601&end=20990101";
  const j = JSON.parse(await fetchUrl(url));
  const kl = j.data && j.data.klines;
  if (!kl || !kl.length) throw new Error(secid + " no data");
  return kl.map(s => {
    const p = s.split(",");
    return [p[0], +(+p[1]).toFixed(2), +(+p[2]).toFixed(2), +(+p[3]).toFixed(2), +(+p[4]).toFixed(2), Math.round(+p[5])];
  });
}

async function fetchSource(src) {
  if (src.kind === "cn") return fetchCN(src.code);
  if (src.kind === "us") return fetchUS(src.sina);
  if (src.kind === "csindex") return fetchCsindex(src.code);
  if (src.kind === "em") return fetchEM(src.secid);
  throw new Error("unknown source");
}

(async () => {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { return null; } })();
  const prevMap = {};
  (prev ? prev.indices : []).forEach(it => { prevMap[it.key] = it; });
  const indices = [];
  for (const it of INDICES) {
    let bars = null;
    for (const src of it.sources) {
      try {
        const raw = await fetchSource(src);
        bars = raw.filter(r => r[0] >= BEG);
        console.log(it.key, it.name, "源[" + src.kind + "]成功 | bars:", bars.length);
        break;
      } catch (e) {
        console.log("  " + it.key + " 源[" + src.kind + "]失败: " + e.message);
      }
    }
    if (!bars || !bars.length) {
      if (prevMap[it.key]) {
        indices.push(prevMap[it.key]);
        console.log(it.key, it.name, "全部源失败，保留旧数据:", prevMap[it.key].bars.length, "根");
      } else {
        console.log(it.key, it.name, "跳过（无数据源）");
      }
      continue;
    }
    indices.push({ key: it.key, name: it.name, market: it.market, bars });
    console.log(it.key, it.name, "最终 bars:", bars.length, "first:", bars[0][0], "last:", bars[bars.length-1][0]);
    await new Promise(r => setTimeout(r, 600));
  }
  const out = { generatedAt: new Date().toISOString(), indices };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), "utf8");
  fs.writeFileSync(OUT_JS, "window.INDICES_DATA = " + JSON.stringify(out) + ";\n", "utf8");
  console.log("written", OUT, fs.statSync(OUT).size, "bytes");
  console.log("written", OUT_JS, fs.statSync(OUT_JS).size, "bytes");
})();
