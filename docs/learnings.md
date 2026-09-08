# Learning log

## A successful HTTP request can still contain a failed source read

Transport success proves bytes arrived, not that the source is complete or genuine.

**Why it came up:** RSSHub can return a successful feed response after upstream errors; reply timelines also contain old conversation roots.

**Takeaway:** validate domain evidence — author, full text, timestamps and the primary timeline checkpoint — before updating health.

## A timeout does not prove that a message was not sent

A provider may accept a request just before the client loses its response.

**Why it came up:** retrying a crashed worker’s sending job could notify the same person twice.

**Takeaway:** distinguish an unsent expired lease from an unknown send outcome; retry only when the outcome safely permits it.

## Timezones are rules, not fixed offsets

An IANA timezone includes daylight-saving changes and local calendar behavior.

**Why it came up:** a PT announcement and a Berlin recipient can fall on different dates, and some local clock times occur twice or not at all.

**Takeaway:** store the event instant plus the recipient’s timezone; preserve ambiguity instead of inventing a timestamp.

## Measure the complete initial dependency graph

A small application entry can still pull in a much larger framework or form-control dependency graph.

**Why it came up:** initial bundle measurements exceeded the150KB target until unused controls were removed, forms used native primitives and static page sections stayed server-rendered.

**Takeaway:** include shared chunks, preloads and hydration data, then enforce the budget against the production build.

## Pinning a commit also requires checking the working tree

HEAD identifies a revision, but local tracked files can differ from it.

**Why it came up:** the source reader’s original revision check would have accepted modified upstream helpers at the pinned HEAD.

**Takeaway:** verify both the revision and clean tracked content before calling a dependency an exact audited checkout.

## Bound both query count and notification expansion

One source batch can be cheap to parse but expensive to store or broadcast.

**Why it came up:** a 100-post scan made hundreds of SQL calls, and multiplying events by subscribers could create more rows than the free database allows. Bulk JSON statements keep database calls constant; a transaction also checks recipient expansion so a concurrent signup cannot bypass the cap.

**Takeaway:** count database calls and expanded work separately, and enforce shared limits inside the transaction.

## Verify persistence across replacement

A healthy server after restart does not prove its data survived.

**Why it came up:** repeating an empty-database health check could pass even if Docker discarded storage. CI now writes a unique timestamp, recreates the container, and checks the exact stored value.

**Takeaway:** write an observable marker before crossing a persistence boundary, then read the same marker afterward.
