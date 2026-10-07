# Research Pack

packId: pack-badb977fc948
contentClass: FACTUAL

## Research objective
Establish the documented timeline, primary evidence, major interpretations, and unresolved disputes about "HTTP 308 Permanent Redirect semantics" needed to support a developers youtube video (unspecified-mode), without stating unverified claims as fact.

## Audience / platform context
audience: developers | platform: youtube | promise: ?

## Verified facts
- HTTP 308 Permanent Redirect indicates the resource has permanently moved to the Location URI, and the request method and body must not be altered when following the redirect. [claim:clm-ede7c751ff68] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]
- HTTP 308 was originally defined by RFC 7538 and was later absorbed into RFC 9110 HTTP Semantics. [claim:clm-d03297df9a11] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]
- Unlike 301, which may incorrectly change a POST request into a GET request, 308 never changes the request method. [claim:clm-c59412e9d345] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]

## Primary-source facts
(none)

## Independently corroborated facts
- HTTP 308 Permanent Redirect indicates the resource has permanently moved to the Location URI, and the request method and body must not be altered when following the redirect. [claim:clm-ede7c751ff68] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]
- HTTP 308 was originally defined by RFC 7538 and was later absorbed into RFC 9110 HTTP Semantics. [claim:clm-d03297df9a11] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]
- Unlike 301, which may incorrectly change a POST request into a GET request, 308 never changes the request method. [claim:clm-c59412e9d345] [source:src-048e66b5112e] [source:src-9c7cc5db9f6d] [source:src-204d096ca9ed]

## Derived / secondary context
(none)

## Conflicting claims
(none)

## Unverified claims
(none)

## Timeline
not established

## People
not established

## Places
not established

## Useful context
- [claim:clm-d03297df9a11]

## Unknowns
(none)

## Source limitations
- src-048e66b5112e: fitMarkdown empty; analysis must fall back to rawMarkdown
- src-048e66b5112e: authority UNKNOWN — treat with care
- src-9c7cc5db9f6d: fitMarkdown empty; analysis must fall back to rawMarkdown
- src-9c7cc5db9f6d: authority UNKNOWN — treat with care
- src-204d096ca9ed: rawMarkdown truncated at acquisition limit; evidence may be incomplete
- src-204d096ca9ed: fitMarkdown empty; analysis must fall back to rawMarkdown
- src-204d096ca9ed: authority UNKNOWN — treat with care

## Sources
- 308 Permanent Redirect - HTTP | MDN [source:src-048e66b5112e] (UNKNOWN/INDEPENDENT)
- RFC 7538: The Hypertext Transfer Protocol Status Code 308 (Permanent Redirect) | RFC Editor [source:src-9c7cc5db9f6d] (UNKNOWN/INDEPENDENT)
- RFC 9110 - HTTP Semantics [source:src-204d096ca9ed] (UNKNOWN/INDEPENDENT)
