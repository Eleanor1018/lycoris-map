package com.lycoris.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.beans.factory.ObjectProvider;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Service
public class RegisterRateLimitService {
    private final int maxAttempts;
    private final long windowMillis;
    private final long windowSeconds;
    private final boolean redisEnabled;
    private final StringRedisTemplate redisTemplate;
    private final Map<String, Deque<Long>> attemptsByIp = new ConcurrentHashMap<>();

    public RegisterRateLimitService(
            ObjectProvider<StringRedisTemplate> redisTemplateProvider,
            @Value("${security.register-rate-limit.redis-enabled:true}") boolean redisEnabled,
            @Value("${security.register-rate-limit.max-attempts:5}") int maxAttempts,
            @Value("${security.register-rate-limit.window-seconds:600}") long windowSeconds
    ) {
        this.redisTemplate = redisTemplateProvider.getIfAvailable();
        this.redisEnabled = redisEnabled;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.windowSeconds = Math.max(1, windowSeconds);
        this.windowMillis = Math.max(1, windowSeconds) * 1000L;
    }

    public boolean tryAcquire(String ip) {
        String key = (ip == null || ip.isBlank()) ? "unknown" : ip.trim();
        if (redisEnabled && redisTemplate != null) {
            try {
                String redisKey = "rl:register:" + key;
                Long count = redisTemplate.opsForValue().increment(redisKey);
                if (count == null) return false;
                if (count == 1L) {
                    redisTemplate.expire(redisKey, windowSeconds, TimeUnit.SECONDS);
                }
                return count <= maxAttempts;
            } catch (Exception ignore) {
                // Fallback to local-memory limiter when Redis is unavailable.
            }
        }
        long now = System.currentTimeMillis();
        Deque<Long> deque = attemptsByIp.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (deque) {
            prune(deque, now);
            if (deque.size() >= maxAttempts) {
                return false;
            }
            deque.addLast(now);
            return true;
        }
    }

    private void prune(Deque<Long> deque, long now) {
        long threshold = now - windowMillis;
        while (!deque.isEmpty() && deque.peekFirst() < threshold) {
            deque.pollFirst();
        }
    }
}
