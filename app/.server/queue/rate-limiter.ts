import type { Redis } from "ioredis";

// Token bucket evaluated atomically in Redis, using the Redis clock so all
// workers agree on time. Returns 0 when the cost was granted, otherwise the
// milliseconds to wait before enough tokens are available.
const SCRIPT = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)
local wait = 0
if tokens >= cost then
  tokens = tokens - cost
else
  wait = math.ceil((cost - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate) + 1000)
return wait
`;

export interface BucketOptions {
  /** Maximum burst. */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
}

export class TokenBucket {
  constructor(
    private readonly redis: Redis,
    private readonly options: BucketOptions,
  ) {
    if (options.capacity <= 0 || options.refillPerSecond <= 0) {
      throw new Error("Bucket capacity and refill rate must be positive");
    }
  }

  /** Takes `cost` tokens if available; otherwise returns the wait in ms. */
  async take(key: string, cost: number): Promise<number> {
    if (cost > this.options.capacity) throw new Error("Cost exceeds bucket capacity");
    const wait = await this.redis.eval(
      SCRIPT,
      1,
      key,
      String(this.options.capacity),
      String(this.options.refillPerSecond / 1000),
      String(cost),
    );
    return Number(wait);
  }
}
