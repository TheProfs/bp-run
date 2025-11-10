# bp-sync

[![test][test-badge]][test-url]

safely run `database` <--> `stripe` operations.

## Install

```bash
npm install -g TheProfs/bp-sync
```

## Usage

This is a script runner that runs *mapping files*,
which contain some custom logic to sync data between
your database and Stripe.

It abstracts away authentication, pagination, error-handling,
and logging so you don't have to worry about that.

The first time you run it, you'll be prompted for:

- Stripe API Key
- Database URL

These are stored in your macOS keychain.

### Mapping

Then, to perform a mapping:

1. Run `bp-sync init`, which creates `mapping.js`
2. Replace the loop in `mapping.js` with your own custom logic.
 1. or use an LLM to generate it, see [LLM Prompt](#llm-prompt).
3. Run it using `bp-sync exec mapping.js`

### Example

#### 1. Generate mapping file with:

```sh
bp-sync init
```

which creates:

```js
// mapping.js
// this is a sample, edit me!

for await (const user of users()) {
  await user.set({
    stripe_subscription_id: user.subscription?.id || null
  }).save()
}
```

#### 2. Edit the above file to add your custom logic.

```js
// mapping.js

for await (const user of users()) {
  await user.set({
    stripe_subsription_status: user.subscription?.status || null
  }).save()
}
````

#### 3. run the mapping file:

```sh
bp-sync exec mapping.js
```

the end.

## CLI

```sh
Usage:
  bp-sync              Show this help
  bp-sync -h, --help   Show this help
  bp-sync init         Create mapping.js
  bp-sync exec <file>  Execute script

Examples:
  bp-sync init
  bp-sync exec mapping.js
```

## Examples

**Bulk update:**

Activate all inactive users and update timestamps

```js
for await (const user of users('active = false')) {
  await user.set({ active: true, updated_at: new Date() }).save()
}
```

**Backfill from Stripe:**

Copy customer email from Stripe to NULL database fields

```js
for await (const user of users('field1 IS NULL', [], { fetchCustomer: true })) {
  if (!user.customer) continue
  await user.set({ field1: user.customer.email }).save()
}
```

**Process subscriptions:**

Set DB plan_id from all Stripe active subscriptions

```js
for await (const sub of subscriptions({ status: 'active' })) {
  await query(
    'UPDATE users SET plan_id = $1 WHERE stripe_id = $2',
    [sub.items.data[0].price.id, sub.customer]
  )
}
```

**Iterate customers:**

Find and log customers by email

```js
for await (const customer of customers({ email: 'test@example.com' })) {
  log.info('Customer: $1', [customer.id])
}
```

**Cancel subscriptions:**

Cancel all active subscriptions for specific plan

```js
for await (const sub of subscriptions({
  status: 'active',
  price: 'price_premium_monthly'
})) {
  await stripe.subscriptions.cancel(sub.id)
  log.success('Cancelled subscription $1', [sub.id])
}
```

**Sync subscription status:**

Update database with current Stripe subscription status

```js
for await (const user of users('stripe_id IS NOT NULL')) {
  const subs = await stripe.subscriptions.list({ customer: user.stripe_id })
  const active = subs.data.find(s => s.status === 'active')

  await user.set({
    subscription_status: active?.status || 'none',
    plan_id: active?.items.data[0]?.price.id || null
  }).save()
}
```

### LLM Prompt

Instead of writing mapping.js scripts manually,
you can use an LLM to generate them from natural language.

Copy the following prompt and run it:

<details>
<summary>Code Generator Prompt</summary>

```markdown
# Generate bp-sync mapping.js

You are a code generator for bp-sync mapping scripts.
Generate valid JavaScript code for `mapping.js` based on the
user's query.

## User Query

The user wants to: **[YOUR QUERY HERE]**

## API Reference

<API>
**Database:**
- `users(where, params, options)` - Generator yielding User instances
  - `where`: SQL WHERE clause (without WHERE keyword)
  - `params`: Array of parameterized values for $1, $2, etc.
  - `options.fetchCustomer`: Boolean, auto-fetches Stripe customer if true
  - Returns User with `.set(data)` and `.save()` methods

- `query(sql, params)` - Execute raw SQL (INSERT/UPDATE/DELETE)
  - Returns query result directly

**Stripe:**
- `customers(filters)` - Generator for Stripe customers
- `subscriptions(filters)` - Generator for Stripe subscriptions
- `invoices(filters)` - Generator for Stripe invoices
- `charges(filters)` - Generator for Stripe charges
- All resources auto-discovered, accept Stripe API filter objects

**Logging:**
- `log.info(msg, args)` - General messages
- `log.warning(msg, args)` - Non-fatal issues
- `log.error(msg, args)` - Errors
- `log.success(msg, args)` - Success messages
- Placeholders: $1, $2, $3 replaced with args array values
</API>

## Code Patterns

<PATTERNS>
**User updates with Stripe data:**
```js
for await (const user of users('field IS NULL', [], { fetchCustomer: true })) {
  if (!user.customer) continue
  await user.set({ field: user.customer.email }).save()
}
```

**Bulk user updates:**
```js
for await (const user of users('active = false')) {
  await user.set({ active: true, updated_at: new Date() }).save()
}
```

**Stripe to DB sync:**
```js
for await (const sub of subscriptions({ status: 'active' })) {
  await query(
    'UPDATE users SET plan_id = $1 WHERE stripe_id = $2',
    [sub.items.data[0].price.id, sub.customer]
  )
}
```

**Iterate and log:**
```js
for await (const customer of customers({ email: 'test@example.com' })) {
  log.info('Customer: $1', [customer.id])
}
```
</PATTERNS>

## Rules

<RULES>
1. Output ONLY valid JavaScript code - no markdown, no explanations
2. Use guard clauses: `if (!condition) continue` instead of nested if blocks
3. Use async generators: `for await (const x of generator())`
4. Chain User methods: `user.set({...}).save()`
5. Use $1, $2 placeholders in log messages with args array
6. Always handle null/missing Stripe data with guard clauses
7. Use fetchCustomer option only when accessing user.customer
8. Prefer query() for complex multi-table operations
9. Use descriptive variable names matching the domain
10. Keep code concise - one clear operation per script
</RULES>

Generate the mapping.js code now:
```

**Usage with codex:**
```bash
cat prompt.md | codex exec
```

</details>

## Injected Globals

**Stripe:**
- `customers(filters)`, `subscriptions(filters)`, `invoices(filters)`, etc.
- `stripe` - raw client

**Database:**
- `users(where, params, options)` - generator with `.set()` and `.save()`
- `query(sql, params)` - direct queries
- `db` - raw pg client

**Logging:**
- `log.error()`, `log.success()`, `log.warning()`, `log.info()`

All output to stderr. Placeholders: `$1`, `$2`.

## Test

```bash
npm ci
npm test
```

> author: [TheProfs][author]

[test-badge]: https://github.com/TheProfs/bp-sync/actions/workflows/test.yml/badge.svg
[test-url]: https://github.com/TheProfs/bp-sync/actions/workflows/test.yml
[author]: https://github.com/TheProfs
