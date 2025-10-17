FROM golang:1.25.3 AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o /out/action ./cmd/action

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/action /action

ENTRYPOINT ["/action"]
