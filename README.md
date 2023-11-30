# Pförtner

Pförtner is a modulable Nostr proxy library designed to make it simple to implement new logic for relay administrators.
This library makes it easy to rewrite, inhibit, or insert different data into the communication between the user and the relay.

# How to use

Sample script to prevent receiving DMs without authentication with NIP-42 is in `scripts/serve.ts`. And you can run with next command,

```
deno task serve
```

Before use, please change environment variables after copying `.env.sample` to `.env`.

# License

Pförtner is licensed under the MIT License.
