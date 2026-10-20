# Paid calls

Claude Code makes no paid call before a row exists for it in this table.

| Date | Service | Purpose | Max calls | Max cost (USD) | Approved by |
|---|---|---|---|---|---|

## Call logs

Each service has one log: `<service>-calls.csv`. The columns are:

`time_utc,call_id,purpose,model,request_id,status,latency_ms,input_tokens,output_tokens,cost_usd`

## Rule

Do not put a key, a token or an authorization header in any file in this folder.
