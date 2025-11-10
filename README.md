# bp-sync

[![test][test-badge]][test-url]

safely run `database` <--> `stripe` operations.

## Install

```bash
npm install -g TheProfs/bp-sync
```

## Usage

The cli is a runner that runs mapping files,
without need to setup authentication,
pagination, or db connections.

The first time you run it, you'll be prompted for your
`Stripe Secret Key` and `Database URL`; these are stored
in your macOS keychain.

Performing a mapping:

1. Run `bp-sync init` to create a mapping file.
2. Edit mapping with your custom logic.
3. Run `bp-sync exec <file>`

### Example

#### 1. Generate mapping file with:

```sh
bp-sync init
```

which creates:

```js
// mapping.js

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

### More examples

First run prompts for Stripe key and database URL.
Stored in macOS keychain.
## Mapping File
## Examples

**Bulk update:**

```js
for await (const user of users('active = false')) {
  await user.set({ active: true, updated_at: new Date() }).save()
}
```

**Backfill from Stripe:**

```js
for await (const user of users('field1 IS NULL', [], { fetchCustomer: true })) {
  if (!user.customer) continue
  await user.set({ field1: user.customer.email }).save()
}
```

**Process subscriptions:**

```js
for await (const sub of subscriptions({ status: 'active' })) {
  await query(
    'UPDATE users SET plan_id = $1 WHERE stripe_id = $2',
    [sub.items.data[0].price.id, sub.customer]
  )
}
```

**Iterate customers:**

```js
for await (const customer of customers({ email: 'test@example.com' })) {
  log.info('Customer: $1', [customer.id])
}
```

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
