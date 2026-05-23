.PHONY: gen test build tidy

gen:
	cd schema && buf generate
	sqlc generate

test:
	go test ./...

build:
	go build ./cmd/...

tidy:
	go mod tidy
