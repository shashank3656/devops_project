.PHONY: deps build

deps:
	go mod download
	go mod tidy

build:
	go build -o backend .

test:
	go test ./...
