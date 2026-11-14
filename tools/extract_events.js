// 从 index.html 提取 MEETINGS 数组，生成 data/events.json（供桌面浮窗使用）
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/const MEETINGS = (\[[\s\S]*?\n\]);/);
if (!m) { console.error("MEETINGS not found"); process.exit(1); }
const MEETINGS = eval(m[1]); // 数据字面量，安全
fs.writeFileSync(path.join(__dirname, "..", "data", "events.json"), JSON.stringify(MEETINGS, null, 1), "utf8");
console.log("events.json written:", MEETINGS.length, "events");
