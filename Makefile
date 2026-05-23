.PHONY: gen test build tidy

# Regenerate the protobuf contract (Go) and sqlc queries.
gen:
	cd schema && buf generate
	cd engine && sqlc generate

test:
	cd engine && go test ./...

build:
	cd engine && go build ./cmd/...

tidy:
	cd engine && go mod tidy
