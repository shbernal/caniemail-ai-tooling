VENDORED := skill/scripts/caniemail-core.mjs mcp/src/caniemail-core.mjs

.PHONY: sync-core check-vendor test test-network lint smoke help

help:
	@echo "sync-core     copy core/caniemail-core.mjs into both surfaces"
	@echo "check-vendor  verify the vendored copies match the core"
	@echo "test          run the core suite (no network)"
	@echo "test-network  run the core suite including live-fetch tests"
	@echo "smoke         drive the MCP server over real stdio JSON-RPC"

sync-core:
	@for dest in $(VENDORED); do \
		mkdir -p "$$(dirname $$dest)"; \
		cp core/caniemail-core.mjs "$$dest"; \
		echo "wrote $$dest"; \
	done

# Both surfaces are thin adapters over one implementation; if a vendored copy
# drifts from core/caniemail-core.mjs they silently stop behaving the same way.
check-vendor:
	@status=0; \
	for dest in $(VENDORED); do \
		if cmp -s core/caniemail-core.mjs "$$dest"; then \
			echo "ok   $$dest"; \
		else \
			echo "DRIFT $$dest differs from core/caniemail-core.mjs (run: make sync-core)"; \
			status=1; \
		fi; \
	done; \
	exit $$status

test:
	node --test 'core/*.test.mjs'

# Hits www.caniemail.com, so it is excluded from the default target and from CI.
test-network:
	CANIEMAIL_TEST_NETWORK=1 node --test 'core/*.test.mjs'

# Proves the MCP server answers a real stdio JSON-RPC session, which the unit
# tests do not cover — they exercise the core, not the transport.
smoke:
	node mcp/smoke.mjs
