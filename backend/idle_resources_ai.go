package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	awsv2 "github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	bedrockclient "github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
)

// aiRankItem is the row shape we want back from the LLM. Persisted to
// idle_ai_rankings + applied onto idle_resources.
type aiRankItem struct {
	ID             int64   `json:"id"`
	Rank           int     `json:"rank"`
	Recommendation string  `json:"recommendation"`
	Confidence     float64 `json:"confidence"`
	RiskNotes      string  `json:"risk_notes,omitempty"`
}

// rankIdleResources picks the configured provider and sends a compact subset
// of resources to the model, asking it to rank by expected savings + low
// deletion risk. The function is forgiving: any failure falls back to a
// heuristic ranking by cost desc, so the UI always has *something* to show.
func rankIdleResources(ctx context.Context, scanID int, provider, model string, resources []IdleResource, actorID int) ([]aiRankItem, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		provider = "none"
	}
	if provider == "none" || len(resources) == 0 {
		return heuristicRanking(resources), nil
	}
	candidates := compactForAI(resources, 200)
	prompt := buildAIPrompt(candidates)
	hash := sha256.Sum256([]byte(prompt))
	hashHex := hex.EncodeToString(hash[:])

	rawResp, err := callAIProvider(ctx, provider, model, prompt)
	if err != nil {
		_ = saveAIRanking(ctx, scanID, provider, model, hashHex, prompt, "ERROR: "+err.Error(), 0, actorID)
		return heuristicRanking(resources), err
	}
	parsed, err := parseAIResponse(rawResp)
	if err != nil {
		_ = saveAIRanking(ctx, scanID, provider, model, hashHex, prompt, rawResp, 0, actorID)
		return heuristicRanking(resources), fmt.Errorf("ai response parse: %w", err)
	}
	if err := saveAIRanking(ctx, scanID, provider, model, hashHex, prompt, rawResp, len(parsed), actorID); err != nil {
		return parsed, err
	}
	return parsed, nil
}

func heuristicRanking(resources []IdleResource) []aiRankItem {
	out := make([]aiRankItem, 0, len(resources))
	for i, r := range resources {
		out = append(out, aiRankItem{
			ID:             r.ID,
			Rank:           i + 1,
			Recommendation: "Auto-ranked by waste $ desc",
			Confidence:     0.5,
		})
	}
	return out
}

type aiCandidate struct {
	ID         int64             `json:"id"`
	Cloud      string            `json:"cloud"`
	Service    string            `json:"service"`
	Region     string            `json:"region"`
	Name       string            `json:"name"`
	Tags       map[string]string `json:"tags,omitempty"`
	State      string            `json:"state"`
	MonthlyUSD float64           `json:"monthly_usd"`
	Reason     string            `json:"reason"`
}

func compactForAI(resources []IdleResource, max int) []aiCandidate {
	if max > len(resources) {
		max = len(resources)
	}
	out := make([]aiCandidate, 0, max)
	for i := 0; i < max; i++ {
		r := resources[i]
		out = append(out, aiCandidate{
			ID:         r.ID,
			Cloud:      r.Cloud,
			Service:    r.Service,
			Region:     r.Region,
			Name:       r.Name,
			Tags:       r.Tags,
			State:      r.State,
			MonthlyUSD: r.CostEstimateUSD,
			Reason:     r.Reason,
		})
	}
	return out
}

func buildAIPrompt(candidates []aiCandidate) string {
	body, _ := json.Marshal(candidates)
	return strings.Join([]string{
		"You are a senior FinOps reviewer auditing idle cloud resources.",
		"Return STRICT JSON of the form {\"ranked\":[{\"id\":<int>,\"rank\":<int>,\"recommendation\":<string>,\"confidence\":<0-1>,\"risk_notes\":<string>}]}.",
		"Rank highest expected monthly savings and lowest deletion risk first.",
		"Penalise anything tagged Env=prod, env=production, critical=true, or recently created.",
		"Do NOT add any text outside the JSON.",
		"Resources:",
		string(body),
	}, "\n")
}

func parseAIResponse(raw string) ([]aiRankItem, error) {
	raw = strings.TrimSpace(raw)
	if start := strings.Index(raw, "{"); start > 0 {
		raw = raw[start:]
	}
	if end := strings.LastIndex(raw, "}"); end > 0 && end < len(raw) {
		raw = raw[:end+1]
	}
	var wrapper struct {
		Ranked []aiRankItem `json:"ranked"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Ranked, nil
}

// ---------- provider routing ----------

func callAIProvider(ctx context.Context, provider, model, prompt string) (string, error) {
	switch provider {
	case "openai":
		return callOpenAI(ctx, model, prompt)
	case "anthropic":
		return callAnthropic(ctx, model, prompt)
	case "google":
		return callGoogleAI(ctx, model, prompt)
	case "ollama":
		return callOllama(ctx, model, prompt)
	case "bedrock":
		return callBedrock(ctx, model, prompt)
	default:
		return "", fmt.Errorf("unsupported provider: %s", provider)
	}
}

func callOpenAI(ctx context.Context, model, prompt string) (string, error) {
	if OpenAIAPIKey == "" {
		return "", errors.New("OPENAI_API_KEY not configured")
	}
	if model == "" {
		model = "gpt-4o-mini"
	}
	body := map[string]any{
		"model":          model,
		"temperature":    0.0,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []map[string]string{
			{"role": "system", "content": "You produce strict JSON FinOps rankings."},
			{"role": "user", "content": prompt},
		},
	}
	js, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(OpenAIBaseURL, "/")+"/chat/completions", bytes.NewReader(js))
	req.Header.Set("Authorization", "Bearer "+OpenAIAPIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpDo(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("openai %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("openai: no choices")
	}
	return parsed.Choices[0].Message.Content, nil
}

func callAnthropic(ctx context.Context, model, prompt string) (string, error) {
	if AnthropicAPIKey == "" {
		return "", errors.New("ANTHROPIC_API_KEY not configured")
	}
	if model == "" {
		model = "claude-3-5-haiku-20241022"
	}
	body := map[string]any{
		"model":       model,
		"max_tokens":  4096,
		"temperature": 0.0,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	}
	js, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(AnthropicBaseURL, "/")+"/messages", bytes.NewReader(js))
	req.Header.Set("x-api-key", AnthropicAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpDo(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("anthropic %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	var parsed struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	for _, c := range parsed.Content {
		if c.Type == "text" {
			return c.Text, nil
		}
	}
	return "", errors.New("anthropic: no text block")
}

func callGoogleAI(ctx context.Context, model, prompt string) (string, error) {
	if GoogleAIAPIKey == "" {
		return "", errors.New("GOOGLE_AI_API_KEY not configured")
	}
	if model == "" {
		model = "gemini-1.5-flash"
	}
	body := map[string]any{
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]any{
			"temperature":      0.0,
			"responseMimeType": "application/json",
		},
	}
	js, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", strings.TrimRight(GoogleAIBaseURL, "/"), model, GoogleAIAPIKey)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(js))
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpDo(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("google %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	for _, c := range parsed.Candidates {
		for _, p := range c.Content.Parts {
			if p.Text != "" {
				return p.Text, nil
			}
		}
	}
	return "", errors.New("google: no text part")
}

func callOllama(ctx context.Context, model, prompt string) (string, error) {
	if model == "" {
		model = "llama3.1"
	}
	body := map[string]any{
		"model":  model,
		"prompt": prompt,
		"stream": false,
		"format": "json",
	}
	js, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(OllamaBaseURL, "/")+"/api/generate", bytes.NewReader(js))
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpDo(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("ollama %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	var parsed struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	return parsed.Response, nil
}

var aiHTTPClient = &http.Client{Timeout: 60 * time.Second}

func httpDo(req *http.Request) (*http.Response, error) {
	return aiHTTPClient.Do(req)
}

// callBedrock uses the AWS default credential chain (env, profile, instance
// role) plus BEDROCK_REGION to talk to bedrock-runtime InvokeModel. The model
// id chooses the wire shape: Anthropic Claude on Bedrock vs Amazon Titan vs
// Meta Llama. We support the two most common Anthropic shapes plus a generic
// "amazon.titan-text" fallback so users can plug in any common model id.
func callBedrock(ctx context.Context, model, prompt string) (string, error) {
	if model == "" {
		model = "anthropic.claude-3-5-haiku-20241022-v1:0"
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(BedrockRegion))
	if err != nil {
		return "", fmt.Errorf("bedrock load config: %w", err)
	}
	client := bedrockclient.NewFromConfig(cfg)

	var bodyBytes []byte
	switch {
	case strings.HasPrefix(model, "anthropic."):
		body := map[string]any{
			"anthropic_version": "bedrock-2023-05-31",
			"max_tokens":        4096,
			"temperature":       0.0,
			"messages": []map[string]string{
				{"role": "user", "content": prompt},
			},
		}
		bodyBytes, _ = json.Marshal(body)
	case strings.HasPrefix(model, "amazon.titan"):
		body := map[string]any{
			"inputText": prompt,
			"textGenerationConfig": map[string]any{
				"maxTokenCount": 4096,
				"temperature":   0.0,
			},
		}
		bodyBytes, _ = json.Marshal(body)
	case strings.HasPrefix(model, "meta.llama"):
		body := map[string]any{
			"prompt":      prompt,
			"temperature": 0.0,
			"max_gen_len": 2048,
		}
		bodyBytes, _ = json.Marshal(body)
	default:
		return "", fmt.Errorf("bedrock model family unsupported by this client: %s", model)
	}

	out, err := client.InvokeModel(ctx, &bedrockclient.InvokeModelInput{
		ModelId:     awsv2.String(model),
		Body:        bodyBytes,
		ContentType: awsv2.String("application/json"),
		Accept:      awsv2.String("application/json"),
	})
	if err != nil {
		return "", fmt.Errorf("bedrock invoke: %w", err)
	}
	return parseBedrockResponse(model, out.Body)
}

func parseBedrockResponse(model string, raw []byte) (string, error) {
	switch {
	case strings.HasPrefix(model, "anthropic."):
		var parsed struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return "", err
		}
		for _, c := range parsed.Content {
			if c.Type == "text" {
				return c.Text, nil
			}
		}
		return "", errors.New("bedrock anthropic: empty content")
	case strings.HasPrefix(model, "amazon.titan"):
		var parsed struct {
			Results []struct {
				OutputText string `json:"outputText"`
			} `json:"results"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return "", err
		}
		if len(parsed.Results) == 0 {
			return "", errors.New("bedrock titan: empty results")
		}
		return parsed.Results[0].OutputText, nil
	case strings.HasPrefix(model, "meta.llama"):
		var parsed struct {
			Generation string `json:"generation"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return "", err
		}
		return parsed.Generation, nil
	default:
		return string(raw), nil
	}
}
