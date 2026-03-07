package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type requestIDContextKey struct{}

type otelRuntimeState struct {
	enabled         bool
	requestCounter  metric.Int64Counter
	requestDuration metric.Float64Histogram
	logCounter      metric.Int64Counter
}

var otelRuntime = otelRuntimeState{}

func initOpenTelemetry(ctx context.Context) (func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	if !OpenTelemetryEnabled {
		log.Printf("[OTEL] disabled by OTEL_ENABLED")
		return noop, nil
	}
	if strings.TrimSpace(OpenTelemetryEndpoint) == "" {
		log.Printf("[OTEL] OTEL_EXPORTER_OTLP_ENDPOINT not set, exporters disabled")
		return noop, nil
	}

	endpoint, insecure, err := normalizeOTLPEndpoint(OpenTelemetryEndpoint, OpenTelemetryInsecure)
	if err != nil {
		return noop, err
	}

	resource, err := sdkresource.Merge(
		sdkresource.Default(),
		sdkresource.NewWithAttributes(
			"",
			attribute.String("service.name", OpenTelemetryServiceName),
			attribute.String("deployment.environment", OpenTelemetryServiceEnv),
			attribute.String("service.version", OpenTelemetryServiceVer),
		),
	)
	if err != nil {
		return noop, fmt.Errorf("merge otel resources: %w", err)
	}

	traceOpts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(endpoint)}
	metricOpts := []otlpmetrichttp.Option{otlpmetrichttp.WithEndpoint(endpoint)}
	if insecure {
		traceOpts = append(traceOpts, otlptracehttp.WithInsecure())
		metricOpts = append(metricOpts, otlpmetrichttp.WithInsecure())
	}

	traceExporter, err := otlptracehttp.New(ctx, traceOpts...)
	if err != nil {
		return noop, fmt.Errorf("create otel trace exporter: %w", err)
	}
	metricExporter, err := otlpmetrichttp.New(ctx, metricOpts...)
	if err != nil {
		return noop, fmt.Errorf("create otel metric exporter: %w", err)
	}

	sampleRatio := OpenTelemetrySampleRatio
	if sampleRatio <= 0 || sampleRatio > 1 {
		sampleRatio = 1.0
	}
	traceProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(sampleRatio))),
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(resource),
	)
	metricReader := sdkmetric.NewPeriodicReader(metricExporter, sdkmetric.WithInterval(OpenTelemetryMetricSeconds))
	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(metricReader),
		sdkmetric.WithResource(resource),
	)

	otel.SetTracerProvider(traceProvider)
	otel.SetMeterProvider(meterProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	meter := meterProvider.Meter("infra-backend/http")
	requestCounter, err := meter.Int64Counter(
		"backend.http.server.requests_total",
		metric.WithDescription("Total inbound backend HTTP requests"),
	)
	if err != nil {
		return noop, fmt.Errorf("create request counter instrument: %w", err)
	}
	requestDuration, err := meter.Float64Histogram(
		"backend.http.server.request.duration_ms",
		metric.WithDescription("Backend inbound HTTP request duration in milliseconds"),
		metric.WithUnit("ms"),
	)
	if err != nil {
		return noop, fmt.Errorf("create request duration instrument: %w", err)
	}
	logCounter, err := meter.Int64Counter(
		"backend.logs.records_total",
		metric.WithDescription("Backend log records emitted from observability middleware"),
	)
	if err != nil {
		return noop, fmt.Errorf("create log counter instrument: %w", err)
	}

	otelRuntime = otelRuntimeState{
		enabled:         true,
		requestCounter:  requestCounter,
		requestDuration: requestDuration,
		logCounter:      logCounter,
	}

	// Instrument outbound HTTP calls that use the shared runtime client.
	httpClient = &http.Client{
		Timeout:   defaultHTTPTimeout,
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}

	log.Printf("[OTEL] enabled endpoint=%s service=%s env=%s sample_ratio=%.2f", endpoint, OpenTelemetryServiceName, OpenTelemetryServiceEnv, sampleRatio)

	return func(ctx context.Context) error {
		var shutdownErr error
		if err := meterProvider.Shutdown(ctx); err != nil {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("shutdown meter provider: %w", err))
		}
		if err := traceProvider.Shutdown(ctx); err != nil {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("shutdown trace provider: %w", err))
		}
		return shutdownErr
	}, nil
}

func normalizeOTLPEndpoint(raw string, defaultInsecure bool) (string, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false, errors.New("empty OTLP endpoint")
	}
	if !strings.Contains(trimmed, "://") {
		return trimmed, defaultInsecure, nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false, fmt.Errorf("parse OTLP endpoint: %w", err)
	}
	if parsed.Host == "" {
		return "", false, fmt.Errorf("OTLP endpoint host missing in %q", raw)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http":
		return parsed.Host, true, nil
	case "https":
		return parsed.Host, false, nil
	default:
		return "", false, fmt.Errorf("unsupported OTLP endpoint scheme %q", parsed.Scheme)
	}
}

func wrapWithOTelHTTP(next http.Handler) http.Handler {
	if !otelRuntime.enabled {
		return next
	}
	return otelhttp.NewHandler(next, "http.server")
}

func withRequestID(ctx context.Context, requestID string) context.Context {
	if requestID == "" {
		return ctx
	}
	return context.WithValue(ctx, requestIDContextKey{}, requestID)
}

func requestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if requestID, ok := ctx.Value(requestIDContextKey{}).(string); ok {
		return requestID
	}
	return ""
}

func recordHTTPRequestMetrics(ctx context.Context, method, path string, statusCode int, elapsed time.Duration) {
	if !otelRuntime.enabled {
		return
	}
	attrs := []attribute.KeyValue{
		attribute.String("http.request.method", method),
		attribute.String("url.path", path),
		attribute.Int("http.response.status_code", statusCode),
	}
	otelRuntime.requestCounter.Add(ctx, 1, metric.WithAttributes(attrs...))
	otelRuntime.requestDuration.Record(ctx, float64(elapsed.Milliseconds()), metric.WithAttributes(attrs...))
}

func recordMiddlewareLog(ctx context.Context, severity string) {
	if !otelRuntime.enabled {
		return
	}
	otelRuntime.logCounter.Add(ctx, 1, metric.WithAttributes(attribute.String("log.severity", severity)))
}

func traceAndSpanIDs(ctx context.Context) (string, string) {
	spanCtx := trace.SpanContextFromContext(ctx)
	if !spanCtx.IsValid() {
		return "", ""
	}
	return spanCtx.TraceID().String(), spanCtx.SpanID().String()
}
