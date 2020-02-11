redturn.ts
=====

A typescript library for event-based queueing redis locks. Algorithm described below.

Build
-----

    $ npm build

Test
-----

    $ npm test

Algorithm
-----

#### Acquire Lock Script
```lua
local list = KEYS[1]
local channel = ARGV[1]
local value = ARGV[2]
local id = ARGV[3]

if redis.call("RPUSH", list, value) == 1 then
    redis.call("PUBLISH", channel, list .. ":" .. id)
end

return redis.call("LINDEX", list, 0)
```

The requester will push a request context, formatted as `<req_id>:<req_channel>:<req_timeout>`, onto the resource list. If our request is the first to enter
the resource lock queue, we notify the requester that they have the lock and can continue processing. Finally, we return the first element so that a requester
knows the head context of the resource lock queue (for monitoring that context's lock timeout).

#### Release Lock Script
```lua
local list = KEYS[1]
local id = ARGV[1]
local channel = ARGV[2]

local value = redis.call("LINDEX", list, 0)
local val_split = {}
for w in (value .. ":"):gmatch("([^:]*):") do
    table.insert(val_split, w)
end

local val_id = val_split[1]
local val_channel = val_split[2]
local called = false
if val_id == id and val_channel == channel then
    redis.call("LPOP", list)
    called = true
end

local next = redis.call("LINDEX", list, 0)
if next ~= false and called == true then
    local next_split = {}
    for w in (next .. ":"):gmatch("([^:]*):") do
        table.insert(next_split, w)
    end
    local next_id = next_split[1]
    local next_channel = next_split[2]
    redis.call("PUBLISH", next_channel, list .. ":" .. next_id)
end

return next
```

The signaler (lock releaser) will check if the head of the resource lock queue for `KEYS[1]` contains the same id to be removed as passed into
`ARGV[1]`. If not, we just return the head of the resource lock queue so the requester can monitor the head context's lock timeout. Otherwise,
we remove the head of the list, grab the next head of the resource lock queue, and notify the new context that it has acquired a lock.

Usage
-------

Start a redturn client:
```javascript
const redis = new Redis()
const sub = new Redis()
// start client
const client = new RedTurn(redis, sub)
await client.start()
```

Acquire and release lock:
```javascript
// acquire lock on resource_name, valid for 5000 milliseconds, returns context id to release lock with
const id = await client.wait("resource_name", 5000)

// do work while holding lock

// release lock
await client.signal("resource_name", id)
```

RedisClient/RedisSubClient interfaces
------
This library uses a generic interface for a backend store, with the testing implementation being the ioredis client. Different
implementations can be used for different redis clients, or on top of another backend store that fits the API usage of the behavior
(pubsub, script evaluation, command pipelining).
