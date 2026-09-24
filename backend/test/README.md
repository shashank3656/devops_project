# Backend tests

All `*_test.go` files live in this directory. Go requires tests to compile in the same package directory as production code (`package main`), so **`make test`** (or `make test` from CI) copies these files into the backend root, runs `go test`, then removes the copies.

Run from `backend/`:

```bash
make test
```

Do not add `*_test.go` files next to production `.go` sources; add them here instead.
