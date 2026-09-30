# Dev-machine tasks for darius. Hosts never need this file: they install
# releases with scripts/install.sh and move with `darius update`.
#
# Two web lanes (scripts/lane.sh): stable is the installed app on port 4747,
# next is this checkout on port 4748. Host-specific values (URLs, proxy,
# allowed devices) live in ~/.config/darius/web.env and next.env, never here.

.PHONY: help check build next down status logs wt release update
.DEFAULT_GOAL := help

VERSION := $(shell sed -n 's/^  "version": "\(.*\)",/\1/p' package.json)

help: ## Show this list
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-9s %s\n", $$1, $$2}'

check: ## The three gates: lint, typecheck, tests (both runtimes)
	bun run lint && bun x tsc --noEmit && bun run test

build: ## Build the web app into web/build (commit it with its source)
	bun run web:build

next: ## Start the next lane from this checkout (demo=1 for demo data, serve=1 for bin/darius serve)
	@scripts/lane.sh up $(if $(demo),--demo,$(if $(serve),--serve,))

down: ## Stop the next lane (never stable)
	@scripts/lane.sh down

status: ## Both lanes: state, version, URL, health
	@scripts/lane.sh status

logs: ## Follow a lane's log (lane=next|stable, default next)
	@scripts/lane.sh logs $(or $(lane),next)

wt: ## A worktree for a parallel session: make wt name=ui (../darius-ui on branch ui, deps installed)
	@test -n "$(name)" || { echo "usage: make wt name=<branch>"; exit 2; }
	git worktree add -b $(name) ../darius-$(name) main
	cd ../darius-$(name) && bun install --frozen-lockfile && cd web && bun install --frozen-lockfile
	@echo "worktree ready: ../darius-$(name) (remove: git worktree remove ../darius-$(name) && git branch -d $(name))"

release: ## Tag and push the version in package.json, after the version check, a fresh build and the gates
	@test "$$(git branch --show-current)" = main || { echo "release runs on main"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "the tree is not clean"; exit 1; }
	scripts/check-version.sh
	bun run web:build
	@git diff --quiet -- web/build || { echo "web/build was stale: commit the rebuilt web/build first"; exit 1; }
	$(MAKE) check
	git tag -a v$(VERSION) -m "darius $(VERSION)"
	git push --follow-tags

update: ## Move stable on this host to the newest release, then other hosts (hosts=a,b)
	darius update
	$(if $(hosts),darius update --hosts $(hosts),@echo "no hosts= given; this host only")
