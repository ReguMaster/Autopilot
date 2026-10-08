#!/bin/sh
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/core/autopilot_loop.js" stop
