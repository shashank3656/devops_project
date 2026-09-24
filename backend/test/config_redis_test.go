package main

import "testing"

func TestApplyRedisURLFromEnvOverridesAddr(t *testing.T) {
	t.Setenv("REDIS_ADDR", "redis:6379")
	t.Setenv("REDIS_PASSWORD", "")
	t.Setenv("REDIS_DB", "0")
	t.Setenv("REDIS_URL", "redis://default:s3cret@railway-redis:6379/2")
	t.Setenv("REDIS_PRIVATE_URL", "")

	reloadConfigFromEnv()

	if RedisAddr != "railway-redis:6379" {
		t.Fatalf("RedisAddr = %q, want railway-redis:6379", RedisAddr)
	}
	if RedisPassword != "s3cret" {
		t.Fatalf("RedisPassword = %q", RedisPassword)
	}
	if RedisDB != 2 {
		t.Fatalf("RedisDB = %d, want 2", RedisDB)
	}
}

func TestApplyRedisPrivateURLWhenRedisURLEmpty(t *testing.T) {
	t.Setenv("REDIS_ADDR", "redis:6379")
	t.Setenv("REDIS_PASSWORD", "")
	t.Setenv("REDIS_DB", "0")
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_PRIVATE_URL", "redis://default:inner@private.redis:6380")

	reloadConfigFromEnv()

	if RedisAddr != "private.redis:6380" {
		t.Fatalf("RedisAddr = %q, want private.redis:6380", RedisAddr)
	}
	if RedisPassword != "inner" {
		t.Fatalf("RedisPassword = %q", RedisPassword)
	}
}
