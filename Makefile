# The shipped core: the implementation modules and the dataset snapshot they
# fall back to. Every one is copied byte-identically into both surfaces.
# `upstream-detect.mjs` and the tests are deliberately absent — they are
# development-only and must never reach a surface.
CORE_FILES := \
	caniemail-core.mjs \
	detect.mjs \
	css-scan.mjs \
	html-scan.mjs \
	feature-titles.mjs \
	selector-shapes.mjs \
	data/caniemail.json

# Each vendor directory, with the one file in it that is not a core copy: the
# surface's own adapter. Together with CORE_FILES that is everything the
# directory may hold, and both publish paths ship the directory whole.
SURFACES := skill/scripts:caniemail.mjs mcp/src:server.mjs
VENDOR_DIRS := $(foreach surface,$(SURFACES),$(firstword $(subst :, ,$(surface))))

DATA_URL := https://www.caniemail.com/api/data.json

.PHONY: sync-core check-vendor lint format check-format test test-network goldens refresh-data smoke help

help:
	@echo "sync-core     copy the core modules and dataset into both surfaces"
	@echo "check-vendor  verify the vendored copies match"
	@echo "lint          run oxlint over the core and both adapters"
	@echo "format        run oxfmt over the same paths, then sync-core"
	@echo "check-format  fail if any of those paths is not formatted"
	@echo "test          run the core suite (no network)"
	@echo "test-network  run the core suite including live-fetch tests"
	@echo "goldens       regenerate fixtures/expected from current detection"
	@echo "refresh-data  refetch core/data/caniemail.json from caniemail.com"
	@echo "smoke         drive the MCP server over real stdio JSON-RPC"

sync-core:
	@for dir in $(VENDOR_DIRS); do \
		for file in $(CORE_FILES); do \
			mkdir -p "$$dir/$$(dirname $$file)"; \
			cp "core/$$file" "$$dir/$$file"; \
		done; \
		echo "wrote $$dir ($(words $(CORE_FILES)) files)"; \
	done

# Both surfaces are thin adapters over one implementation; if a vendored copy
# drifts from core/ they silently stop behaving the same way. The dataset
# snapshot rides the same check, so a surface cannot ship a stale fallback.
# The check runs both ways: a file that is neither a core copy nor the adapter
# is what a module dropped from CORE_FILES leaves behind, and it would ship.
check-vendor:
	@status=0; \
	for dir in $(VENDOR_DIRS); do \
		for file in $(CORE_FILES); do \
			cmp -s "core/$$file" "$$dir/$$file" || { \
				echo "DRIFT $$dir/$$file differs from core/$$file (run: make sync-core)"; \
				status=1; \
			}; \
		done; \
	done; \
	for surface in $(SURFACES); do \
		dir=$${surface%%:*}; \
		for file in $$(cd "$$dir" && find . -type f | sed 's|^\./||'); do \
			case " $(CORE_FILES) $${surface#*:} " in \
				*" $$file "*) ;; \
				*) echo "EXTRA $$dir/$$file is neither a core copy nor the adapter (run: git rm $$dir/$$file)"; \
					status=1 ;; \
			esac; \
		done; \
	done; \
	[ $$status -eq 0 ] && echo "ok   $(words $(CORE_FILES)) files in each of: $(VENDOR_DIRS)"; \
	exit $$status

# The core and each surface's own adapter, and not the vendored copies: a
# finding in one would be reported three times, and fixing it there is
# forbidden anyway. check-vendor is what vouches for the copies.
LINT_PATHS := core $(foreach surface,$(SURFACES),$(subst :,/,$(surface))) mcp/smoke.mjs .github/scripts

lint:
	pnpm exec oxlint --deny-warnings $(LINT_PATHS)

# Same paths as lint, for the same reason. The copies are kept formatted by
# sync-core rather than by oxfmt, which is why `format` ends with it: a format
# that left the copies behind would fail the very next check-vendor.
format:
	pnpm exec oxfmt $(LINT_PATHS)
	@$(MAKE) --no-print-directory sync-core

check-format:
	pnpm exec oxfmt --check $(LINT_PATHS)

test:
	node --test 'core/*.test.mjs'

# Hits www.caniemail.com, so it is excluded from the default target and from CI.
test-network:
	CANIEMAIL_TEST_NETWORK=1 node --test 'core/*.test.mjs'

# The golden files pin what detection currently finds, so a change to the
# scanners shows up as a reviewable diff rather than as silence.
goldens:
	UPDATE_GOLDENS=1 node --test 'core/differential.test.mjs'
	@echo "review the diff in core/fixtures/expected/ before committing"

# The snapshot is both the offline fallback and the dataset the tests run
# against, so refreshing it can move golden files and test expectations. That
# is the intended signal, not a problem to work around.
# The shape check is `isDatasetShaped` from the core, so "is this the dataset"
# has one definition rather than one here and one at load time. The `>= 250`
# floor stays local to this target: it asks whether this is the *whole* dataset,
# which is the right question for the committed snapshot and the wrong one for
# `loadDataset`, where `dataUrl` may point at a mirror serving a subset.
refresh-data:
	curl -fsSL --max-time 60 $(DATA_URL) -o core/data/caniemail.json
	@node --input-type=module -e "import d from './core/data/caniemail.json' with { type: 'json' }; \
		import { isDatasetShaped } from './core/caniemail-core.mjs'; \
		if (!isDatasetShaped(d)) throw new Error('refetched dataset is not shaped like the dataset'); \
		if (d.data.length < 250) throw new Error('refetched dataset has only ' + d.data.length + ' features'); \
		console.log('ok  ' + d.data.length + ' features, last update ' + d.last_update_date)"
	@echo "now run: make sync-core test goldens"

# Proves the MCP server answers a real stdio JSON-RPC session, which the unit
# tests do not cover — they exercise the core, not the transport.
smoke:
	node mcp/smoke.mjs
