#!/usr/bin/env bash
set -euo pipefail

# Release preparation aligns every workspace before ccore creates the tag.
bun -e "import manifest from './package.json' with { type: 'json' }; process.stdout.write(manifest.version + '\n')"
