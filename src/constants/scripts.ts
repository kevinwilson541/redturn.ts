
export const ADD_SCRIPT = `
local list = KEYS[1]
local channel = ARGV[1]
local value = ARGV[2]
local id = ARGV[3]

if redis.call(\"RPUSH\", list, value) == 1 then
    redis.call(\"PUBLISH\", channel, list .. \":\" .. id)
end

return redis.call(\"LINDEX\", list, 0)
`

export const REMOVE_SCRIPT = `
local list = KEYS[1]
local id = ARGV[1]

local value = redis.call("LINDEX", list, 0)
local val_split = {}
for w in (value .. ":"):gmatch("([^:]*):") do
    table.insert(val_split, w)
end

local val_id = val_split[1]
local called = false
if val_id == id then
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
`