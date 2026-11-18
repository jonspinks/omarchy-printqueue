import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Print Queue: a printer in the bar while CUPS has a job that is not finished
// (waiting, printing, held or stopped), and nothing at all otherwise.
//
// Every few seconds it asks the local CUPS server, through ipptool and
// queue.test beside this file, for unfinished jobs and printer states. That
// is one small local request; there is no helper process. Hover lists each
// job with its printer and state, and any printer problem CUPS reports (out
// of paper, jam, offline). The icon turns red when a job needs you. A click
// opens CUPS's own jobs page, where a job can be cancelled, held or released.
BarWidget {
  id: root
  moduleName: "blacksheep.printqueue"

  readonly property int idleMs: Math.max(2000, Number(setting("interval", 5)) * 1000)
  readonly property int busyMs: 2000
  readonly property string queryFile: Qt.resolvedUrl("queue.test").toString().replace(/^file:\/\//, "")

  property int count: 0
  property bool stuck: false
  property string tip: ""

  // Nerd Font printer; with an alert mark when a job needs attention.
  readonly property string glyph: stuck ? "\u{f042c}" : "\u{f042a}"
  readonly property bool showCount: count > 1 && !vertical

  function ingest(text) {
    var v = Model.view(Model.parse(text))
    root.count = v.count
    root.stuck = v.stuck
    root.tip = v.tip
  }

  function openQueue() {
    Quickshell.execDetached(["xdg-open", "http://localhost:631/jobs/"])
  }

  visible: count > 0
  implicitWidth: count > 0 ? (showCount ? counted.implicitWidth : icon.implicitWidth) : 0
  implicitHeight: showCount ? counted.implicitHeight : icon.implicitHeight

  Process {
    id: probe
    command: ["ipptool", "-T", "3", "-c", "ipp://localhost/", root.queryFile]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.ingest(text)
    }
  }

  Timer {
    interval: root.count > 0 ? root.busyMs : root.idleMs
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!probe.running) probe.running = true
  }

  IpcHandler {
    target: "blacksheep.printqueue"

    function refresh(): void { if (!probe.running) probe.running = true }
  }

  BarIconButton {
    id: icon
    anchors.fill: parent
    visible: !root.showCount
    bar: root.bar
    text: root.glyph
    slotSize: Style.bar.statusSlot
    tooltipText: root.tip
    active: root.stuck
    useActiveColor: true
    activeColor: root.bar ? root.bar.urgent : Color.urgent
    onPressed: function(b) { root.openQueue() }
  }

  WidgetButton {
    id: counted
    anchors.fill: parent
    visible: root.showCount
    bar: root.bar
    text: root.glyph + " " + root.count
    tooltipText: root.tip
    active: root.stuck
    useActiveColor: true
    onPressed: function(b) { root.openQueue() }
  }
}
