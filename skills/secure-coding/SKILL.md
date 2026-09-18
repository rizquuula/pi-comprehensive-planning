---
name: secure-coding
description: Apply when writing or reviewing Go backend code where security properties matter — input validation, authentication, authorization, secrets handling, injection prevention, sensitive data protection, crypto usage, error disclosure, dependency hygiene, or web hardening. Use when the user mentions secure coding, input validation, authentication, authorization, IDOR, secrets, injection, SQL injection, XSS, CSRF, SSRF, OWASP, sensitive data, PII, encryption, hashing, password storage, security hardening, rate limiting, supply chain, or is designing a new endpoint or adapter boundary. Skip for pure domain logic with no external-facing surface.
---

# Secure Coding

Never trust input; fail closed; least privilege by default; defense in depth at every layer.

---

## 1. Input Validation & Trust Boundaries

**Do**
- Validate at the inbound adapter boundary (hexagonal primary adapter) — domain should never receive unvalidated input
- Allowlist over denylist: define what is permitted, reject everything else
- Validate type, range, format, and length for every field
- Canonicalize before validating: normalize unicode, decode percent-encoding, resolve path separators before checks
- Treat all external input as hostile: HTTP bodies, headers, query params, path params, file uploads, upstream API responses, message queue payloads

**Don't**
- Assume a field is safe because it came from a "trusted" internal service — validate at every boundary crossing
- Validate only in the UI or front-end; server-side validation is non-negotiable
- Accept unbounded input sizes — always cap lengths and body sizes

```go
// Don't
func CreateUser(w http.ResponseWriter, r *http.Request) {
    name := r.FormValue("name") // unbounded, unvalidated
    // ...
}

// Do
func CreateUser(w http.ResponseWriter, r *http.Request) {
    name := r.FormValue("name")
    if len(name) == 0 || len(name) > 100 {
        http.Error(w, "invalid name", http.StatusBadRequest)
        return
    }
    if !namePattern.MatchString(name) { // allowlist pattern
        http.Error(w, "invalid name", http.StatusBadRequest)
        return
    }
}
```

---

## 2. Injection Prevention

**Do**
- Use parameterized queries / prepared statements — always, no exceptions
- Use ORM safe query builders; pass values as parameters, never interpolate
- Avoid `exec.Command` with shell strings; pass args as a slice to avoid shell interpretation
- For file paths: `filepath.Clean` then verify the result starts within the expected base directory
- Escape template output contextually (HTML, JS, URL) — use `html/template`, not `text/template`, for web output

**Don't**
- Concatenate user input into SQL strings
- Pass user input to `exec.Command("sh", "-c", userInput)`
- Accept a file path from a client and open it without cleaning and bounding it

```go
// Don't — SQL injection
query := "SELECT * FROM users WHERE email = '" + email + "'"
db.Query(query)

// Do — parameterized
db.QueryContext(ctx, "SELECT * FROM users WHERE email = $1", email)
```

```sql
-- Don't (illustrative)
SELECT * FROM orders WHERE id = '1' OR '1'='1'

-- Do — driver sends value separately, SQL structure is fixed
SELECT * FROM orders WHERE id = $1
```

```go
// Don't — command injection
exec.Command("sh", "-c", "convert "+userFile).Run()

// Do — args as slice, no shell
exec.Command("convert", userFile).Run()
```

```go
// Don't — path traversal
path := filepath.Join(baseDir, r.URL.Query().Get("file"))
os.Open(path) // ../../etc/passwd

// Do
clean := filepath.Clean(filepath.Join(baseDir, r.URL.Query().Get("file")))
if !strings.HasPrefix(clean, baseDir+string(os.PathSeparator)) {
    return errors.New("invalid path")
}
os.Open(clean)
```

---

## 3. Authentication & Authorization

**Do**
- Authenticate then authorize on every request, in that order
- Enforce authorization at the resource level — verify the caller owns the object (IDOR: check `resource.OwnerID == callerID`, not just that they're logged in)
- Deny by default; require explicit grant
- Use short-lived tokens; rotate refresh tokens on use
- Set cookies with `HttpOnly`, `Secure`, and `SameSite=Lax` (or `Strict`) flags
- Validate all fields of a JWT server-side: signature, expiry, issuer, audience

**Don't**
- Trust a `user_id` or `role` from the request body or query string — derive identity from verified token only
- Skip object-level authorization because a route is "authenticated"
- Use `alg: none` or accept unsigned tokens
- Store session tokens in localStorage (XSS-readable); prefer HttpOnly cookies

```go
// Don't — IDOR: checks auth but not ownership
func GetOrder(ctx context.Context, orderID string) (*Order, error) {
    return repo.FindByID(ctx, orderID) // any logged-in user can fetch any order
}

// Do — verify ownership
func GetOrder(ctx context.Context, callerID, orderID string) (*Order, error) {
    order, err := repo.FindByID(ctx, orderID)
    if err != nil {
        return nil, err
    }
    if order.CustomerID != callerID {
        return nil, ErrForbidden
    }
    return order, nil
}
```

---

## 4. Secrets & Sensitive Data

**Do**
- Load secrets from environment variables or a secret manager (Vault, AWS Secrets Manager) at startup
- Encrypt sensitive data at rest; enforce TLS in transit; reject plain HTTP
- Hash passwords with `bcrypt` or `argon2id`; include a per-user salt (bcrypt does this automatically)
- Minimize data: collect only what is needed, retain only as long as required
- Redact sensitive fields (passwords, tokens, PII) at the logger boundary, not scattered per call site

**Don't**
- Hardcode secrets, API keys, or passwords in source code or config files committed to VCS
- Log sensitive fields: passwords, tokens, card numbers, SSNs, raw PII
- Return secrets or PII in API responses beyond what the caller strictly needs
- Use MD5, SHA-1, or unsalted hashes for passwords — they are trivially reversible

```go
// Don't
password := "super-secret-db-password" // hardcoded

// Do
password := os.Getenv("DB_PASSWORD") // or secret manager lookup

// Don't
log.Info("user login", "password", req.Password)

// Do — redact at the structured logger boundary
log.Info("user login", "email", req.Email) // never log the credential

// Don't
hash := md5.Sum([]byte(password)) // fast hash, trivially brute-forced

// Do
hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
```

---

## 5. Crypto Discipline

**Do**
- Use `crypto/rand` for all tokens, nonces, IDs that must be unpredictable
- Compare secrets and MACs with `hmac.Equal` or `subtle.ConstantTimeCompare` to prevent timing attacks
- Use authenticated encryption (AES-GCM, ChaCha20-Poly1305) — never bare AES-CBC without MAC
- Use stdlib crypto packages or well-audited libraries (`golang.org/x/crypto`); never implement primitives

**Don't**
- Use `math/rand` for anything security-relevant — it is deterministic and seeded predictably
- Use `==` to compare secrets or tokens — timing side-channel
- Use ECB mode, bare CBC without HMAC, or custom cipher constructions
- Reuse nonces with AEAD ciphers — catastrophic for GCM

```go
// Don't — predictable token
token := fmt.Sprintf("%d", rand.Int63())

// Do — cryptographically random
b := make([]byte, 32)
if _, err := rand.Read(b); err != nil { // crypto/rand
    return err
}
token := base64.URLEncoding.EncodeToString(b)

// Don't — timing attack
if token == storedToken { ... }

// Do
if subtle.ConstantTimeCompare([]byte(token), []byte(storedToken)) == 1 { ... }
```

---

## 6. Error Handling & Information Disclosure

**Do**
- Return generic error messages to clients; log detail server-side with trace/request IDs
- Map domain/infra errors to HTTP status codes at the adapter boundary — one translation layer, no raw DB or internal errors leaking over the wire
- Fail closed: on unexpected error, deny the operation, do not default to permit
- Use consistent timing for auth failures to prevent user enumeration (don't distinguish "user not found" from "wrong password" in response time)

**Don't**
- Return stack traces, SQL errors, file paths, or internal struct dumps in HTTP responses
- Log sensitive context in the error message that gets returned to the caller
- Swallow errors silently — every error either propagates or is logged; never both ignored and dropped

```go
// Don't — leaks internals
http.Error(w, err.Error(), http.StatusInternalServerError)
// "pq: duplicate key value violates unique constraint \"users_email_key\""

// Do — generic to client, detail in server log
log.Error("create user failed", "error", err, "trace_id", traceID)
http.Error(w, "internal server error", http.StatusInternalServerError)
```

---

## 7. Dependencies & Supply Chain

**Do**
- Pin module versions with `go.sum`; commit `go.sum` to VCS
- Run `govulncheck ./...` in CI to catch known CVEs in dependencies
- Keep dependencies updated; prioritize security patches
- Minimize the dependency surface — prefer stdlib when adequate

**Don't**
- Use `replace` directives pointing to unreviewed forks without sign-off
- Ignore `govulncheck` findings without a documented decision
- Pull in large frameworks for small problems — each dependency is an attack surface

```bash
# In CI
govulncheck ./...
```

---

## 8. Web Hardening

**Do**
- Encode output contextually for XSS: use `html/template` which auto-escapes by context
- Protect state-changing requests from CSRF with a synchronizer token or `SameSite=Strict` cookie + origin check
- Set security headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`
- Validate and allowlist outbound URLs for SSRF; block requests to private IP ranges (`169.254.x.x`, `10.x.x.x`, `172.16-31.x.x`, `127.x.x.x`, `::1`)
- Enforce request size limits (`http.MaxBytesReader`), timeouts (`http.Server.ReadTimeout/WriteTimeout/IdleTimeout`), and rate limits to resist DoS
- Bind struct fields explicitly on decode; never decode untrusted JSON directly into a struct that includes privileged fields (mass assignment)

**Don't**
- Use `text/template` for HTML output — it does not escape
- Skip CSRF protection because the endpoint is "API-only" when it's reachable from a browser session
- Reflect a caller-supplied URL directly into an outbound HTTP request
- Decode request bodies without a size cap

```go
// Don't — unbounded body
json.NewDecoder(r.Body).Decode(&input)

// Do — cap body size
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB
if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
    http.Error(w, "request too large or malformed", http.StatusBadRequest)
    return
}

// Don't — SSRF: open redirect / internal request
resp, err := http.Get(r.URL.Query().Get("webhook"))

// Do — validate against allowlist before making outbound call
if !isAllowedWebhookHost(webhookURL) {
    return ErrForbidden
}
resp, err := http.Get(webhookURL)
```
