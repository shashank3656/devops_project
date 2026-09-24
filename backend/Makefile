.PHONY: deps build test test-clean

deps:
	go mod download
	go mod tidy

build:
	go build -o backend .

# Go tests must compile in the same directory as package main. Sources live in test/;
# this target stages them into the backend root for the test run only.
TEST_SOURCES := $(wildcard test/*_test.go)

test: $(TEST_SOURCES)
	@cp test/*_test.go .
	@set -e; trap '$(MAKE) test-clean' EXIT; go test . -count=1

test-clean:
	@rm -f $(notdir $(TEST_SOURCES))
