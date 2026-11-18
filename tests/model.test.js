// The queue parsing and wording in Model.js, under node.
//   node tests/model.test.js
// The fixtures are ipptool -c output from CUPS 2.4.20, as BarWidget.qml asks
// for it (queue.test), captured 2026-11-18 with a held job (printer names and users changed).
const M = require("../Model.js")

let failed = 0
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "\n     got  " + JSON.stringify(got) + "\n     want " + JSON.stringify(want)))
}

const PRINTERS = [
  "printer-name,printer-state,printer-state-reasons,printer-state-message,printer-info",
  "Office-Laser,idle,none,,Office laser",
  "Home-Printer,idle,none,Printer is ready to print,Home printer"
].join("\n")

// ---- Nothing queued: CUPS still sends the jobs header, or nothing at all.
eq(M.view(M.parse("job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets\n" + PRINTERS)), { count: 0, stuck: false, tip: "" }, "empty queue: hidden")
eq(M.view(M.parse("")).count, 0, "CUPS not answering: hidden")

// ---- A held job, as captured.
const held = M.parse([
  "job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets",
  "3,printqueue widget test,pending-held,job-hold-until-specified,ipp://localhost:631/printers/Home-Printer,alex,1",
  PRINTERS
].join("\n"))
eq(held.jobs, [{ id: 3, name: "printqueue widget test", state: "pending-held", reasons: ["job-hold-until-specified"], printer: "Home-Printer", user: "alex", kb: 1 }], "held job parsed")
eq(Object.keys(held.printers), ["Office-Laser", "Home-Printer"], "printers parsed")
const v = M.view(held)
eq([v.count, v.stuck], [1, false], "a hold you asked for is not stuck")
eq(v.tip, "1 print job\n• printqueue widget test — Home-Printer (held)\nClick to manage the queue", "tooltip")

// ---- Out of paper while printing: red, and said in words.
const jam = M.parse([
  "job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets",
  "7,Invoice 1042.pdf,processing,job-printing,ipp://localhost:631/printers/Office-Laser,alex,88",
  "8,Letter,pending,job-queued,ipp://localhost:631/printers/Office-Laser,alex,12",
  "printer-name,printer-state,printer-state-reasons,printer-state-message,printer-info",
  "Office-Laser,processing,\"media-empty-error,toner-low-warning\",Load paper in tray 2,Office laser",
].join("\n"))
eq(jam.printers["Office-Laser"].reasons, ["media-empty-error", "toner-low-warning"], "quoted multi-valued reasons")
eq(M.printerProblems(jam.printers["Office-Laser"]), ["out of paper", "toner low"], "reasons in words")
const jv = M.view(jam)
eq([jv.count, jv.stuck], [2, true], "out of paper needs attention")
eq(jv.tip.split("\n")[0], "2 print jobs — needs attention", "headline says so")
eq(jv.tip.split("\n")[1], "• Invoice 1042.pdf — Office-Laser (printing; printer out of paper, toner low)", "job line names the problem")

// ---- Stopped, failed, and held by CUPS rather than by you.
const mk = (state, reasons) => ({ id: 1, name: "x", state, reasons, printer: "P", user: "", kb: 0 })
eq(M.jobStuck(mk("processing-stopped", []), null), true, "stopped job is stuck")
eq(M.jobStuck(mk("aborted", []), null), true, "failed job is stuck")
eq(M.jobStuck(mk("pending-held", ["job-hold-until-authenticated"]), null), true, "held for a password is stuck")
eq(M.jobStuck(mk("pending", ["job-queued"]), { state: "stopped", reasons: ["paused"] }), true, "paused printer is stuck")
eq(M.jobStuck(mk("processing", ["job-printing"]), { state: "processing", reasons: ["connecting-to-device"] }), false, "connecting is not stuck")

// ---- Names from the printing app are untrusted: quotes, commas, markup,
// control characters and length.
const odd = M.parse([
  "job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets",
  "9,\"Report, \"\"final\"\" <img src=https://example.invalid/t>\",pending,job-queued,ipp://localhost:631/printers/Office-Laser,alex,3",
  "10,\"line\u0007one\nline two\",pending,job-queued,ipp://localhost:631/printers/Office-Laser,alex,3",
  "11," + "A".repeat(500) + ",pending,job-queued,ipp://localhost:631/printers/Office-Laser,alex,3",
  "0,bad id,pending,,ipp://localhost:631/printers/Office-Laser,,",
].join("\n"))
eq(odd.jobs[0].name, "Report, \"final\" <img src=https://example.invalid/t>", "commas and doubled quotes")
eq(odd.jobs[1].name, "line one", "control characters go; a broken row does not crash")
eq(odd.jobs[2].name.length, 60, "long names clipped")
eq(odd.jobs.length, 3, "a row without a job id is dropped")
eq(M.parse(Array(300).fill("1,a,pending,,ipp://h/printers/P,u,1").map((l, i) => i ? l.replace(/^1/, String(i + 1)) : "job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets").join("\n")).jobs.length, 50, "at most 50 jobs kept")
const many = M.view(M.parse(Array(15).fill(0).map((_, i) => (i + 1) + ",Doc " + (i + 1) + ",pending,,ipp://h/printers/P,u,1").concat([]).reduce((a, l) => a + "\n" + l, "job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets")))
eq(many.tip.split("\n").length, 1 + 10 + 1 + 1, "tooltip lists 10 and counts the rest")
eq(many.tip.split("\n")[11], "…and 5 more", "the rest counted")

// ---- Another user's job: CUPS hides its name, so it is called by number.
const other = M.view(M.parse("job-id,job-name,job-state,job-state-reasons,job-printer-uri,job-originating-user-name,job-k-octets\n12,,pending,job-queued,ipp://localhost:631/printers/Office-Laser,,40"))
eq(other.tip.split("\n")[1], "• Job 12 — Office-Laser (waiting)", "unnamed job by number")

console.log(failed ? "\n" + failed + " failed" : "\nall passed")
process.exit(failed ? 1 : 0)
