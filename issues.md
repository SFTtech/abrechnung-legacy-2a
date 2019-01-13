# DOS

- login requests are not rate-limited -> bcrypt can run multiple times in parallel, gobbling up CPU cores
- all events are held in memory -> server can be DOSed by creating many large events through tiny gzipped websocket messages
- pending requests (e.g. because we're still awaiting auth) can pile up. each creats its own async task. what's the performance implications?
  - make sure to clean up pending requests when the connection is closed
  - prevent too may parallel requests from the same connection
  - rate-limit requests from the same connection
- JSONDIFFPATCH processes untrusted data on the server. can it be DOSed?

# Security

- login requests for the same user are not rate-limited (brute-force weakness?)
- the timing side-channel can be used to determine whether a user exists when a login request is rejected.
- JSONDIFFPATCH processes untrusted data on the server. can it be broken?
