BEND ?= $(HOME)/.bend/bin/bend
CLANG ?= clang
CFLAGS ?= -O1
.NOTPARALLEL:

.PHONY: build check test clean
build: build/helpers.js build/json.js build/request.js build/request build/hello.js build/structured.js build/tools.js build/cancel.js

build/json.js: tests/json.bend json.bend
	mkdir -p build
	$(BEND) tests/json.bend -o $@

build/hello.js build/structured.js build/tools.js build/cancel.js: build/%.js: examples/%.bend examples/request.bend openai.bend json.bend transport.bend docs.bend
	mkdir -p build
	$(BEND) $< -o $@

build/request.js: examples/request.bend openai.bend transport.bend json.bend docs.bend
	mkdir -p build
	$(BEND) examples/request.bend -o $@

build/request.c: examples/request.bend openai.bend transport.bend json.bend docs.bend
	mkdir -p build
	$(BEND) examples/request.bend -o $@

build/request: build/request.c
	$(CLANG) -std=c11 $(CFLAGS) $< -lpthread -lm -o $@

check:
	bun run typecheck
	bun run format:check

package-check:
	BEND=$(BEND) bun scripts/check-package.ts

test: build check package-check
	bun test tests

clean:
	rm -rf build

build/helpers.js: tests/helpers.bend openai.bend json.bend transport.bend docs.bend
	mkdir -p build
	$(BEND) $< -o $@
