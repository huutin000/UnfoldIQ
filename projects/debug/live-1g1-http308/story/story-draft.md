# Story Draft (FACTUAL)

## hook — hook: surprising documented fact

A question worth asking: why does HTTP 308 preserve the request method when 301 does not. This story follows the evidence to an answer.

## q0 — answer viewer question: What is the documented timeline of "HTTP 308 Permanent Redirect semantics" (key dates, sequence, participants)?

HTTP 308 Permanent Redirect indicates the resource has permanently moved to the Location URI, and the request method and body must not be altered when following the redirect.

## q1 — answer viewer question: What primary evidence (records, artifacts, measurements, official sources) supports the core claims about "HTTP 308 Perm

HTTP 308 was originally defined by RFC 7538 and was later absorbed into RFC 9110 HTTP Semantics.

## q2 — answer viewer question: Which identities, dates, locations, and numbers in "HTTP 308 Permanent Redirect semantics" must be verified before scrip

Unlike 301, which may incorrectly change a POST request into a GET request, 308 never changes the request method.

## payoff — Use 308 whenever API methods and bodies must survive a permanent move.

Use 308 whenever API methods and bodies must survive a permanent move.
