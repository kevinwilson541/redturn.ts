
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

export const REFRESH_SCRIPT = `
local list = KEYS[1]
local channel = ARGV[1]
local old_id = ARGV[2]
local new_id = ARGV[3]
local new_value = ARGV[4]

local value = redis.call("LINDEX", list, 0)
local val_split = {}
for w in (value .. ":"):gmatch("([^:]*):") do
    table.insert(val_split, w)
end

local val_id = val_split[1]
local val_channel = val_split[2]

if val_id == old_id and val_channel == channel then
    redis.call("LSET", list, 0, new_value)
    return new_value
end

return nil
`

export const REMOVE_SCRIPT = `
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
`