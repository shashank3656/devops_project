package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	defaultDBTimeout      = 5 * time.Second
	defaultCacheTTL       = 90 * time.Second
	defaultJobPollTimeout = 5 * time.Second
	defaultRedisDial      = 2 * time.Second
	defaultHTTPTimeout    = 10 * time.Second
	defaultSlowQuery      = 750 * time.Millisecond
	defaultQueueName      = "infra:jobs"
	requestIDHeader       = "X-Request-ID"
	maxHTTPLogBodyBytes   = 512
	cacheNamespaceAdmin   = "admin_dashboard"
	cacheNamespaceTeam    = "team_ownership"
	cacheNamespaceOnboard = "onboarding_progress"
	cacheNamespaceNotify  = "notifications"
)

var (
	redisClient       *RedisClient
	httpClient        = &http.Client{Timeout: defaultHTTPTimeout}
	reqCounter        uint64
	mvRefreshInFlight uint32
)

type RedisClient struct {
	addr        string
	password    string
	db          int
	enabled     bool
	cacheTTL    time.Duration
	jobQueue    string
	pollTimeout time.Duration
}

type NotificationEmailJob struct {
	UserID  int    `json:"user_id"`
	Kind    string `json:"kind"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

type WebhookJob struct {
	URL     string            `json:"url"`
	Event   string            `json:"event"`
	Secret  string            `json:"secret,omitempty"`
	Payload map[string]any    `json:"payload"`
	Headers map[string]string `json:"headers,omitempty"`
}

type QueueJob struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type healthDependency struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

func InitRuntimeResilience() {
	redisClient = NewRedisClient()
	if redisClient != nil && redisClient.enabled {
		if err := redisClient.Ping(context.Background()); err != nil {
			log.Printf("[Redis] disabled due to ping failure: %v", err)
			redisClient.enabled = false
		} else {
			log.Printf("[Redis] connected addr=%s db=%d", redisClient.addr, redisClient.db)
			go startRedisJobWorker(redisClient)
		}
	}
}

func NewRedisClient() *RedisClient {
	addr := strings.TrimSpace(RedisAddr)
	if addr == "" {
		return &RedisClient{enabled: false}
	}
	pollTimeout := RedisJobPollTimeout
	if pollTimeout <= 0 {
		pollTimeout = defaultJobPollTimeout
	}
	cacheTTL := RedisCacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultCacheTTL
	}
	queueName := strings.TrimSpace(RedisQueueName)
	if queueName == "" {
		queueName = defaultQueueName
	}
	return &RedisClient{
		addr:        addr,
		password:    RedisPassword,
		db:          RedisDB,
		enabled:     true,
		cacheTTL:    cacheTTL,
		jobQueue:    queueName,
		pollTimeout: pollTimeout,
	}
}

func (c *RedisClient) Ping(ctx context.Context) error {
	if c == nil || !c.enabled {
		return nil
	}
	_, err := c.command(ctx, "PING")
	return err
}

func (c *RedisClient) Get(ctx context.Context, key string) (string, error) {
	if c == nil || !c.enabled {
		return "", errRedisDisabled
	}
	reply, err := c.command(ctx, "GET", key)
	if err != nil {
		return "", err
	}
	if reply == nil {
		return "", sql.ErrNoRows
	}
	return string(reply), nil
}

func (c *RedisClient) SetEX(ctx context.Context, key string, ttl time.Duration, value string) error {
	if c == nil || !c.enabled {
		return errRedisDisabled
	}
	if ttl <= 0 {
		ttl = c.cacheTTL
	}
	_, err := c.command(ctx, "SETEX", key, strconv.Itoa(int(ttl.Seconds())), value)
	return err
}

func (c *RedisClient) Incr(ctx context.Context, key string) error {
	if c == nil || !c.enabled {
		return errRedisDisabled
	}
	_, err := c.command(ctx, "INCR", key)
	return err
}

func (c *RedisClient) LPush(ctx context.Context, queue, value string) error {
	if c == nil || !c.enabled {
		return errRedisDisabled
	}
	_, err := c.command(ctx, "LPUSH", queue, value)
	return err
}

func (c *RedisClient) BRPop(ctx context.Context, queue string, timeout time.Duration) (string, error) {
	if c == nil || !c.enabled {
		return "", errRedisDisabled
	}
	if timeout <= 0 {
		timeout = c.pollTimeout
	}
	reply, err := c.command(ctx, "BRPOP", queue, strconv.Itoa(int(timeout.Seconds())))
	if err != nil {
		return "", err
	}
	if reply == nil {
		return "", sql.ErrNoRows
	}
	parts := parseArrayItems(reply)
	if len(parts) < 2 {
		return "", sql.ErrNoRows
	}
	return parts[1], nil
}

func (c *RedisClient) command(ctx context.Context, args ...string) ([]byte, error) {
	if c == nil || !c.enabled {
		return nil, errRedisDisabled
	}
	if len(args) == 0 {
		return nil, errors.New("redis command required")
	}
	dialer := &net.Dialer{Timeout: defaultRedisDial}
	conn, err := dialer.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(defaultRedisDial + c.pollTimeout + defaultHTTPTimeout))
	}
	reader := bufio.NewReader(conn)
	if c.password != "" {
		if err := writeRedisCommand(conn, "AUTH", c.password); err != nil {
			return nil, err
		}
		if _, err := readRedisReply(reader); err != nil {
			return nil, err
		}
	}
	if c.db > 0 {
		if err := writeRedisCommand(conn, "SELECT", strconv.Itoa(c.db)); err != nil {
			return nil, err
		}
		if _, err := readRedisReply(reader); err != nil {
			return nil, err
		}
	}
	if err := writeRedisCommand(conn, args...); err != nil {
		return nil, err
	}
	return readRedisReply(reader)
}

func writeRedisCommand(w io.Writer, args ...string) error {
	var payload bytes.Buffer
	payload.WriteString(fmt.Sprintf("*%d\r\n", len(args)))
	for _, arg := range args {
		payload.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(arg), arg))
	}
	_, err := w.Write(payload.Bytes())
	return err
}

func readRedisReply(r *bufio.Reader) ([]byte, error) {
	prefix, err := r.ReadByte()
	if err != nil {
		return nil, err
	}
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
	switch prefix {
	case '+', ':':
		return []byte(line), nil
	case '-':
		return nil, errors.New(line)
	case '$':
		n, err := strconv.Atoi(line)
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, nil
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		return buf[:n], nil
	case '*':
		n, err := strconv.Atoi(line)
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, nil
		}
		var payload bytes.Buffer
		payload.WriteString(fmt.Sprintf("*%d\r\n", n))
		for i := 0; i < n; i++ {
			item, err := readRedisReply(r)
			if err != nil {
				return nil, err
			}
			if item == nil {
				payload.WriteString("$-1\r\n")
				continue
			}
			payload.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(item), item))
		}
		return payload.Bytes(), nil
	default:
		return nil, fmt.Errorf("unsupported redis reply prefix %q", prefix)
	}
}

func parseArrayItems(raw []byte) []string {
	reader := bufio.NewReader(bytes.NewReader(raw))
	prefix, err := reader.ReadByte()
	if err != nil || prefix != '*' {
		return nil
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil
	}
	count, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || count <= 0 {
		return nil
	}
	items := make([]string, 0, count)
	for i := 0; i < count; i++ {
		prefix, err := reader.ReadByte()
		if err != nil || prefix != '$' {
			return nil
		}
		lenLine, err := reader.ReadString('\n')
		if err != nil {
			return nil
		}
		n, err := strconv.Atoi(strings.TrimSpace(lenLine))
		if err != nil {
			return nil
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return nil
		}
		items = append(items, string(buf[:n]))
	}
	return items
}

var errRedisDisabled = errors.New("redis disabled")

func cacheNamespaceVersion(ctx context.Context, namespace string) string {
	if redisClient == nil || !redisClient.enabled {
		return "0"
	}
	key := "cache_ns:" + namespace
	value, err := redisClient.Get(ctx, key)
	if err == nil && value != "" {
		return value
	}
	if err := redisClient.SetEX(ctx, key, 24*time.Hour, "1"); err == nil {
		return "1"
	}
	return "0"
}

func cacheKey(namespace string, parts ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	all := append([]string{cacheNamespaceVersion(ctx, namespace)}, parts...)
	return "cache:" + namespace + ":" + strings.Join(all, ":")
}

func invalidateCacheNamespaces(namespaces ...string) {
	if redisClient == nil || !redisClient.enabled {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, namespace := range namespaces {
		if namespace == "" {
			continue
		}
		if err := redisClient.Incr(ctx, "cache_ns:"+namespace); err != nil {
			log.Printf("[Redis] invalidate %s failed: %v", namespace, err)
		}
	}
}

func cacheJSON[T any](namespace string, ttl time.Duration, keyParts []string, builder func() (T, error)) (T, error) {
	var zero T
	if redisClient == nil || !redisClient.enabled {
		return builder()
	}
	key := cacheKey(namespace, keyParts...)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	raw, err := redisClient.Get(ctx, key)
	if err == nil && raw != "" {
		var out T
		if unmarshalErr := json.Unmarshal([]byte(raw), &out); unmarshalErr == nil {
			return out, nil
		}
	}
	out, err := builder()
	if err != nil {
		return zero, err
	}
	encoded, err := json.Marshal(out)
	if err == nil {
		_ = redisClient.SetEX(ctx, key, ttl, string(encoded))
	}
	return out, nil
}

func enqueueJob(jobType string, payload any) {
	if redisClient == nil || !redisClient.enabled {
		processInlineJob(jobType, payload)
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Jobs] marshal %s failed: %v", jobType, err)
		return
	}
	jobBody, err := json.Marshal(QueueJob{Type: jobType, Data: body})
	if err != nil {
		log.Printf("[Jobs] queue %s failed: %v", jobType, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := redisClient.LPush(ctx, redisClient.jobQueue, string(jobBody)); err != nil {
		log.Printf("[Jobs] enqueue %s failed, running inline: %v", jobType, err)
		processInlineJob(jobType, payload)
	}
}

func startRedisJobWorker(client *RedisClient) {
	if client == nil || !client.enabled {
		return
	}
	for {
		ctx, cancel := context.WithTimeout(context.Background(), client.pollTimeout+2*time.Second)
		item, err := client.BRPop(ctx, client.jobQueue, client.pollTimeout)
		cancel()
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			log.Printf("[Jobs] dequeue failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		var job QueueJob
		if err := json.Unmarshal([]byte(item), &job); err != nil {
			log.Printf("[Jobs] decode failed: %v", err)
			continue
		}
		switch job.Type {
		case "notification_email":
			var payload NotificationEmailJob
			if err := json.Unmarshal(job.Data, &payload); err == nil {
				processInlineJob(job.Type, payload)
			}
		case "webhook":
			var payload WebhookJob
			if err := json.Unmarshal(job.Data, &payload); err == nil {
				processInlineJob(job.Type, payload)
			}
		default:
			log.Printf("[Jobs] unknown job type %s", job.Type)
		}
	}
}

func processInlineJob(jobType string, payload any) {
	switch jobType {
	case "notification_email":
		job, ok := payload.(NotificationEmailJob)
		if !ok {
			return
		}
		user, err := GetUserByID(job.UserID)
		if err != nil || user == nil || user.Email == "" {
			recordOpsDeliveryFailure("notification_email", "", job, fmt.Errorf("email recipient not available"))
			return
		}
		if err := SendEmail(user.Email, job.Subject, job.Body); err != nil {
			log.Printf("[Jobs] email failed: %v", err)
			recordOpsDeliveryFailure("notification_email", user.Email, job, err)
		}
	case "webhook":
		job, ok := payload.(WebhookJob)
		if !ok {
			return
		}
		if err := executeWebhookJob(job); err != nil {
			log.Printf("[Jobs] webhook failed: %v", err)
			recordOpsDeliveryFailure("webhook", job.URL, job, err)
		}
	}
}

func executeWebhookJob(job WebhookJob) error {
	body, err := json.Marshal(job.Payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", job.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if job.Event != "" {
		req.Header.Set("X-Webhook-Event", job.Event)
	}
	for k, v := range job.Headers {
		req.Header.Set(k, v)
	}
	if job.Secret != "" {
		signature := buildWebhookSignature(job.Secret, body)
		req.Header.Set("X-Webhook-Signature", signature)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

func buildWebhookSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + fmt.Sprintf("%x", mac.Sum(nil))
}

func withObservability(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := strings.TrimSpace(r.Header.Get(requestIDHeader))
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d-%d", time.Now().UnixNano(), atomic.AddUint64(&reqCounter, 1))
		}
		requestCtx := withRequestID(r.Context(), requestID)
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		recorder.Header().Set(requestIDHeader, requestID)
		instrumentedNext := wrapWithOTelHTTP(http.HandlerFunc(func(innerW http.ResponseWriter, innerR *http.Request) {
			requestCtx = innerR.Context()
			next.ServeHTTP(innerW, innerR)
		}))
		instrumentedNext.ServeHTTP(recorder, r.WithContext(requestCtx))
		elapsed := time.Since(start)

		path := r.URL.Path
		if strings.TrimSpace(path) == "" {
			path = "/"
		}
		recordHTTPRequestMetrics(requestCtx, r.Method, path, recorder.status, elapsed)

		severity := "info"
		if recorder.status >= http.StatusInternalServerError {
			severity = "error"
		} else if recorder.status >= http.StatusBadRequest || elapsed >= RequestLogSlowThreshold {
			severity = "warn"
		}
		traceID, spanID := traceAndSpanIDs(requestCtx)
		message := deriveHTTPLogMessage(recorder.status, recorder.bodySnippet())
		log.Printf(
			"[HTTP] severity=%s request_id=%s trace_id=%s span_id=%s method=%s path=%s status=%d duration_ms=%d message=%q",
			severity,
			requestIDFromContext(requestCtx),
			traceID,
			spanID,
			r.Method,
			path,
			recorder.status,
			elapsed.Milliseconds(),
			message,
		)
		recordMiddlewareLog(requestCtx, severity)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	bodyCapture bytes.Buffer
	truncated   bool
}

func (r *statusRecorder) WriteHeader(statusCode int) {
	r.status = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	if r.bodyCapture.Len() < maxHTTPLogBodyBytes {
		remaining := maxHTTPLogBodyBytes - r.bodyCapture.Len()
		if len(p) > remaining {
			_, _ = r.bodyCapture.Write(p[:remaining])
			r.truncated = true
		} else {
			_, _ = r.bodyCapture.Write(p)
		}
	} else if len(p) > 0 {
		r.truncated = true
	}
	return r.ResponseWriter.Write(p)
}

func (r *statusRecorder) bodySnippet() string {
	raw := strings.TrimSpace(r.bodyCapture.String())
	if raw == "" {
		return ""
	}
	if r.truncated {
		return raw + "..."
	}
	return raw
}

func deriveHTTPLogMessage(status int, snippet string) string {
	if snippet == "" {
		if text := strings.TrimSpace(http.StatusText(status)); text != "" {
			return text
		}
		return "no response message"
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(snippet), &payload); err == nil {
		for _, key := range []string{"error", "message", "status"} {
			if v, ok := payload[key]; ok {
				msg := strings.TrimSpace(fmt.Sprint(v))
				if msg != "" {
					return msg
				}
			}
		}
	}

	normalized := strings.Join(strings.Fields(snippet), " ")
	if len(normalized) > 240 {
		return normalized[:240] + "..."
	}
	return normalized
}

func dbTimeoutContext() (context.Context, context.CancelFunc) {
	timeout := DBQueryTimeout
	if timeout <= 0 {
		timeout = defaultDBTimeout
	}
	return context.WithTimeout(context.Background(), timeout)
}

func queryRowsWithTimeout(query string, args ...any) (*sql.Rows, context.CancelFunc, error) {
	ctx, cancel := dbTimeoutContext()
	start := time.Now()
	rows, err := DB.QueryContext(ctx, query, args...)
	logSlowQuery("query", query, time.Since(start), err)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return rows, cancel, nil
}

func queryRowContext(query string, args ...any) *sql.Row {
	ctx, _ := dbTimeoutContext()
	return DB.QueryRowContext(ctx, query, args...)
}

func execContext(query string, args ...any) (sql.Result, error) {
	ctx, cancel := dbTimeoutContext()
	defer cancel()
	start := time.Now()
	result, err := DB.ExecContext(ctx, query, args...)
	logSlowQuery("exec", query, time.Since(start), err)
	return result, err
}

func logSlowQuery(kind, query string, elapsed time.Duration, err error) {
	threshold := SlowQueryThreshold
	if threshold <= 0 {
		threshold = defaultSlowQuery
	}
	if elapsed < threshold {
		return
	}
	sanitized := strings.Join(strings.Fields(query), " ")
	if len(sanitized) > 180 {
		sanitized = sanitized[:180] + "..."
	}
	if err != nil {
		log.Printf("[DB] slow_%s duration_ms=%d err=%v query=%s", kind, elapsed.Milliseconds(), err, sanitized)
		return
	}
	log.Printf("[DB] slow_%s duration_ms=%d query=%s", kind, elapsed.Milliseconds(), sanitized)
}

func refreshRequestSummaryViewAsync() {
	if DB == nil {
		return
	}
	if !atomic.CompareAndSwapUint32(&mvRefreshInFlight, 0, 1) {
		return
	}
	go func() {
		defer atomic.StoreUint32(&mvRefreshInFlight, 0)
		_, err := execContext(`REFRESH MATERIALIZED VIEW mv_request_status_summary`)
		if err != nil {
			log.Printf("[DB] refresh mv_request_status_summary failed: %v", err)
		}
	}()
}
