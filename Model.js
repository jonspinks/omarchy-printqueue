// Print Queue: turning CUPS's answer into what the bar shows.
//
// BarWidget.qml runs `ipptool -c ipp://localhost/ queue.test`, which asks
// CUPS for every job not yet finished and every printer's state, and prints
// two CSV tables one after the other, each with its own header row. Both
// come from the local CUPS server, but job names are whatever the printing
// app called the document, so every string is cleaned and clipped here.

var MAX_JOBS = 50
var MAX_TEXT = 60

function clip(s, n) {
  s = String(s === undefined || s === null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

// One CSV line into fields: commas split, double quotes group, "" is a quote.
function csvFields(line) {
  var out = [], field = "", quoted = false
  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i)
    if (quoted) {
      if (c === "\"") {
        if (line.charAt(i + 1) === "\"") { field += "\""; i++ }
        else quoted = false
      } else field += c
    } else if (c === "\"") quoted = true
    else if (c === ",") { out.push(field); field = "" }
    else field += c
  }
  out.push(field)
  return out
}

function list(value) {
  return String(value || "").split(",").map(function (s) { return s.trim() }).filter(function (s) { return s && s !== "none" })
}

// { jobs: [...], printers: { name: {...} } } from ipptool's CSV.
function parse(text) {
  var lines = String(text || "").split(/\r?\n/)
  var jobs = [], printers = {}, header = null, table = ""
  for (var i = 0; i < lines.length && i < 2000; i++) {
    var line = lines[i]
    if (!line) continue
    var f = csvFields(line)
    if (f[0] === "job-id") { header = f; table = "jobs"; continue }
    if (f[0] === "printer-name") { header = f; table = "printers"; continue }
    if (!header) continue
    var row = {}
    for (var k = 0; k < header.length; k++) row[header[k]] = f[k] === undefined ? "" : f[k]
    if (table === "jobs" && jobs.length < MAX_JOBS) {
      var id = parseInt(row["job-id"], 10)
      if (!(id > 0)) continue
      var uri = String(row["job-printer-uri"] || "")
      var printer = uri.indexOf("/printers/") >= 0 ? uri.slice(uri.lastIndexOf("/printers/") + 10) : uri.slice(uri.lastIndexOf("/") + 1)
      jobs.push({
        id: id,
        name: clip(row["job-name"], MAX_TEXT),
        state: clip(row["job-state"], 30),
        reasons: list(row["job-state-reasons"]).slice(0, 8),
        printer: clip(decodeURIComponent(printer), 40),
        user: clip(row["job-originating-user-name"], 32),
        kb: Math.max(0, parseInt(row["job-k-octets"], 10) || 0)
      })
    } else if (table === "printers") {
      var name = clip(row["printer-name"], 40)
      if (!name || Object.keys(printers).length >= 50) continue
      printers[name] = {
        state: clip(row["printer-state"], 20),
        reasons: list(row["printer-state-reasons"]).slice(0, 8),
        message: clip(row["printer-state-message"], 80),
        info: clip(row["printer-info"], 60)
      }
    }
  }
  return { jobs: jobs, printers: printers }
}

var JOB_STATES = {
  "pending": "waiting",
  "pending-held": "held",
  "processing": "printing",
  "processing-stopped": "stopped",
  "canceled": "cancelled",
  "aborted": "failed",
  "completed": "done"
}

// Printer conditions worth a person's attention, in plain words. The
// -report/-warning/-error suffix CUPS adds is stripped first.
var PRINTER_REASONS = {
  "media-empty": "out of paper",
  "media-needed": "needs paper",
  "media-low": "paper low",
  "media-jam": "paper jam",
  "toner-empty": "out of toner",
  "toner-low": "toner low",
  "marker-supply-empty": "out of ink or toner",
  "marker-supply-low": "ink or toner low",
  "door-open": "a door is open",
  "cover-open": "a cover is open",
  "input-tray-missing": "a paper tray is missing",
  "output-area-full": "output tray full",
  "offline": "offline",
  "paused": "paused",
  "shutdown": "switched off",
  "connecting-to-device": "connecting",
  "timed-out": "not answering",
  "other": "has a problem"
}

function reasonKey(r) { return String(r || "").replace(/-(report|warning|error)$/, "") }

function printerProblems(p) {
  if (!p) return []
  var out = []
  for (var i = 0; i < p.reasons.length; i++) {
    var words = PRINTER_REASONS[reasonKey(p.reasons[i])]
    if (words && out.indexOf(words) < 0) out.push(words)
  }
  if (p.state === "stopped" && out.indexOf("paused") < 0 && out.indexOf("stopped") < 0) out.push("stopped")
  return out
}

// A job needs the person, not just patience: stopped, failed, or held by
// something other than a plain "hold" they asked for.
function jobStuck(job, printer) {
  if (job.state === "processing-stopped" || job.state === "aborted") return true
  if (job.state === "pending-held" && job.reasons.indexOf("job-hold-until-specified") < 0) return true
  var probs = printerProblems(printer)
  for (var i = 0; i < probs.length; i++) if (probs[i] !== "connecting") return true
  return false
}

function jobLine(job, printers) {
  var printer = printers[job.printer]
  var state = JOB_STATES[job.state] || job.state || "queued"
  var bits = [state]
  var probs = printerProblems(printer)
  if (probs.length) bits.push("printer " + probs.join(", "))
  var title = job.name || ("Job " + job.id)
  return "• " + title + " — " + job.printer + " (" + bits.join("; ") + ")"
}

// Everything the bar needs, from one parse.
function view(parsed) {
  var jobs = parsed.jobs, printers = parsed.printers
  var stuck = false
  var lines = []
  for (var i = 0; i < jobs.length; i++) {
    if (jobStuck(jobs[i], printers[jobs[i].printer])) stuck = true
    if (i < 10) lines.push(jobLine(jobs[i], printers))
  }
  if (jobs.length > 10) lines.push("…and " + (jobs.length - 10) + " more")
  var head = jobs.length === 1 ? "1 print job" : jobs.length + " print jobs"
  if (stuck) head += " — needs attention"
  return {
    count: jobs.length,
    stuck: stuck,
    tip: jobs.length ? [head].concat(lines, ["Click to manage the queue"]).join("\n") : ""
  }
}

if (typeof module !== "undefined") {
  module.exports = { clip: clip, csvFields: csvFields, parse: parse, printerProblems: printerProblems, jobStuck: jobStuck, view: view }
}
