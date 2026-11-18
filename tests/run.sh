#!/usr/bin/env bash
# The queue logic in Model.js, under node.
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/model.test.js
