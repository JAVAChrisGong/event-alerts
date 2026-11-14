// 抓取 6 个指数的日K（2020-06 至今），生成 data/indices.json + data/indices.js
// A 股：腾讯 fqkline（2000 根）；美股：新浪 US_MinKService（全量历史）
// 数据已与通达信/东财交叉验证一致
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "data", "indices.json");
const OUT_JS = path.join(__dirname, "..", "data", "indices.js");

const INDICES = [
  { key: "sh000001", code: "sh000001", name: "上证指数", market: "A 股", kind: "cn" },
  { key: "sz399006", code: "sz399006", name: "创业板指", market: "A 股", kind: "cn" },
  { key: "hs300",    code: "sh000300", name: "沪深 300", market: "A 股", kind: "cn" },
  { key: "sh000688", code: "sh000688", name: "科创 50", market: "A 股", kind: "cn" },
  { key: "csi2000",  code: "932000",   name: "中证 2000", market: "A 股", kind: "csindex" },
  { key: "ixic",     code: "usIXIC",   sina: ".IXIC", name: "纳斯达克综合", market: "美股", kind: "us" },
  { key: "dji",      code: "usDJI",    sina: ".DJI",  name: "道琼斯工业", market: "美股", kind: "us" },
  { key: "spx",      code: "usINX",    sina: ".INX",  name: "标普 500", market: "美股", kind: "us" },
];

const BEG = "2020-06-01"; // 覆盖 2020-11 事件前 60 个交易日

function fetchUrl(url, retries = 5) {
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
    const wait = 1500 * (6 - retries);
    console.log("  retry in " + wait + "ms: " + err.message);
    return new Promise(r => setTimeout(r, wait)).then(() => fetchUrl(url, retries - 1));
  });
}

async function fetchCN(code) {
  const url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + code + ",day,,,2000,qfq";
  const j = JSON.parse(await fetchUrl(url));
  const kl = j.data && j.data[code] && j.data[code].day;
  if (!kl || !kl.length) throw new Error(code + " no data");
  // [date, open, close, high, low, volume]
  return kl.map(row => [row[0], +(+row[1]).toFixed(2), +(+row[2]).toFixed(2), +(+row[3]).toFixed(2), +(+row[4]).toFixed(2), Math.round(+row[5])]);
}

async function fetchUS(symbol) {
  const url = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20d=/US_MinKService.getDailyK?symbol=" + symbol + "&___qn=3";
  const t = await fetchUrl(url);
  const m = t.match(/=\s*\((\[.*\])\)/s);
  if (!m) throw new Error(symbol + " no match");
  const arr = JSON.parse(m[1]);
  // {d, o, h, l, c, v} → [date, open, close, high, low, vol]
  return arr.map(r => [r.d, +(+r.o).toFixed(2), +(+r.c).toFixed(2), +(+r.h).toFixed(2), +(+r.l).toFixed(2), Math.round(+r.v)]);
}

// 中证指数官网（中证2000 等）：返回 {tradeDate, open, close, high, low, tradingVol}
async function fetchCsindex(code) {
  const url = "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=" + code + "&startDate=20200601&endDate=20990101";
  const j = JSON.parse(await fetchUrl(url));
  const d = j.data || [];
  if (!d.length) throw new Error(code + " no data");
  const norm = s => /^\d{8}$/.test(s) ? s.slice(0,4) + "-" + s.slice(4,6) + "-" + s.slice(6,8) : s;
  return d.map(r => [norm(r.tradeDate), +(+r.open).toFixed(2), +(+r.close).toFixed(2), +(+r.high).toFixed(2), +(+r.low).toFixed(2), Math.round(+r.tradingVol || 0)]);
}

(async () => {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { return null; } })();
  const prevMap = {};
  (prev ? prev.indices : []).forEach(it => { prevMap[it.key] = it; });
  const indices = [];
  for (const it of INDICES) {
    let raw = null;
    try {
      if (it.kind === "us") raw = await fetchUS(it.sina);
      else if (it.kind === "csindex") raw = await fetchCsindex(it.code);
      else raw = await fetchCN(it.code);
    } catch (e) {
      console.log("  [WARN] " + it.key + " 抓取失败: " + e.message);
    }
    if (!raw || !raw.length) {
      if (prevMap[it.key]) {
        indices.push(prevMap[it.key]);
        console.log(it.key, it.name, "保留旧数据:", prevMap[it.key].bars.length, "根");
      } else {
        console.log(it.key, it.name, "跳过（暂无数据源）");
      }
      continue;
    }
    const bars = raw.filter(r => r[0] >= BEG);
    if (!bars.length) {
      if (prevMap[it.key]) {
        indices.push(prevMap[it.key]);
        console.log(it.key, it.name, "保留旧数据:", prevMap[it.key].bars.length, "根");
      } else {
        console.log(it.key, it.name, "跳过（数据为空）");
      }
      continue;
    }
    indices.push({ key: it.key, name: it.name, market: it.market, bars });
    console.log(it.key, it.name, "bars:", bars.length, "first:", bars[0][0], "last:", bars[bars.length-1][0]);
    await new Promise(r => setTimeout(r, 800));
  }
  const out = { generatedAt: new Date().toISOString(), indices };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), "utf8");
  fs.writeFileSync(OUT_JS, "window.INDICES_DATA = " + JSON.stringify(out) + ";\n", "utf8");
  console.log("written", OUT, fs.statSync(OUT).size, "bytes");
  console.log("written", OUT_JS, fs.statSync(OUT_JS).size, "bytes");
})();
