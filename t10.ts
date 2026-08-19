import { readFileSync } from "fs";
import { parseWorkbook, parseHistory, parseCarrierAr, parseServiceDetails, parseReferrals } from "./lib/parseAmd";
const b = readFileSync("/mnt/user-data/uploads/__Rapid_Rehab__test_-_Jul_2021.xlsx");
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const w = parseWorkbook(ab);
console.log("clinic :", w.detectedClinicName);
console.log("period :", w.detectedPeriod);
console.log("source :", w.detectedPeriodSource);
console.log("opening/closing:", w.summary.openingAr, "/", w.summary.closingAr);
console.log("FC A/R rows:", w.financialClassAr.length, " Activity rows:", w.financialClassActivity.length);
console.log("workbook issues:", w.issues.map(i => i.level + ": " + i.message));

const h = parseHistory(ab);
console.log("\nhistory months:", h.months.length, h.months[0], "->", h.months[h.months.length-1], "| rows:", h.rows.length, "| issues:", h.issues.length);

const ins = w.arSplit.find(s => s.payerType === "insurance")?.total;
const c = parseCarrierAr(ab, ins);
console.log("carriers:", c.rows.length, "sum:", c.rows.reduce((a,x)=>a+x.total,0).toFixed(2), "vs insurance AR:", ins?.toFixed(2), "| issues:", c.issues.length);

const sd = parseServiceDetails(ab);
const faTotal = w.financialClassActivity.reduce((a,r)=>a+r.charges,0);
console.log("services:", sd.rows.length, "charges:", sd.rows.reduce((a,r)=>a+r.charges,0).toFixed(2), "vs Financial Activity:", faTotal.toFixed(2), "| issues:", sd.issues.length);

const rf = parseReferrals(ab);
console.log("referrals:", rf.rows.length, "| issues:", rf.issues.map(i=>i.message));

// duplicate-key check, the thing that broke the import before
const dup = (arr: string[]) => arr.length - new Set(arr).size;
console.log("\nduplicate keys — services:", dup(sd.rows.map(r=>`${r.classCode}|${r.procCode}`)),
            "referrals:", dup(rf.rows.map(r=>`${r.name}|${r.zip}`)),
            "carriers:", dup(c.rows.map(r=>r.code)),
            "history:", dup(h.rows.map(r=>`${r.code}|${r.month}`)));
