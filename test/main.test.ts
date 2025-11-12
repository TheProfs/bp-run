import { test } from 'node:test'
import assert from 'node:assert'
import {
  User,
  stripeGenerator,
  getKeychain,
  setKeychain,
  ensureKeychain,
  createUsersGenerator,
  createQueryHelper
} from '../src/cli.ts'
import { mocks } from './utils/index.ts'

import type { Pool as PgPool } from 'pg'
import type Stripe from 'stripe'

test('User', async t => {
  await t.test('#set', async t => {
    await t.test('assigns properties', t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'new' })

      assert.strictEqual(user.field1, 'new')
    })

    await t.test('returns this for chaining', t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      const result = user.set({ field1: 'new' })

      assert.strictEqual(result, user)
    })

    await t.test('assigns multiple properties', t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'a', field2: 'b' })

      assert.strictEqual(user.field1, 'a')
      assert.strictEqual(user.field2, 'b')
    })
  })

  await t.test('#save', async t => {
    await t.test('returns this for chaining', async t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'new' })
      const result = await user.save()

      assert.strictEqual(result, user)
    })

    await t.test('updates changed fields', async t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'changed' })
      await user.save()

      const call = db.query.mock.calls[0]
      const [sql] = call.arguments

      assert.match(sql, /UPDATE users/)
      assert.match(sql, /"field1" = \$1/)
    })

    await t.test('skips save when no changes', async t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      await user.save()

      assert.strictEqual(db.query.mock.calls.length, 0)
    })

    await t.test('passes changed values', async t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'new' })
      await user.save()

      const call = db.query.mock.calls[0]
      const [, params] = call.arguments

      assert.strictEqual(params[0], 'new')
      assert.strictEqual(params[1], 1)
    })

    await t.test('updates multiple fields', async t => {
      const db = { query: t.mock.fn(async () => ({ rows: [] })) } as unknown as PgPool
      const user = new User({ id: 1, email: 'test@example.com', stripe_id: null, field1: 'value1' }, db)

      user.set({ field1: 'a', email: 'new@example.com' })
      await user.save()

      const call = db.query.mock.calls[0]
      const [sql] = call.arguments

      assert.match(sql, /"field1"/)
      assert.match(sql, /"email"/)
    })
  })
})

test('#stripeGenerator', async t => {
  await t.test('yields all items', async t => {
    const resource = {
      list: t.mock.fn(async () => ({
        data: [{ id: 'cus_1' }, { id: 'cus_2' }],
        has_more: false
      }))
    }

    const items = []
    for await (const item of stripeGenerator(resource, 'list', {}, 'customers'))
      items.push(item)

    assert.strictEqual(items.length, 2)
  })

  await t.test('passes filters', async t => {
    const resource = {
      list: t.mock.fn(async () => ({
        data: [{ id: 'cus_1' }],
        has_more: false
      }))
    }
    const filters = { status: 'active' }

    for await (const _ of stripeGenerator(resource, 'list', filters, 'customers')) {}

    const call = resource.list.mock.calls[0]
    assert.partialDeepStrictEqual(call.arguments[0], filters)
  })

  await t.test('handles pagination', async t => {
    let callCount = 0
    const resource = {
      list: t.mock.fn(async () => {
        callCount++
        return callCount === 1
          ? { data: [{ id: 'cus_1' }], has_more: true }
          : { data: [{ id: 'cus_2' }], has_more: false }
      })
    }

    const items = []
    for await (const item of stripeGenerator(resource, 'list', {}, 'customers'))
      items.push(item)

    assert.strictEqual(items.length, 2)
    assert.strictEqual(resource.list.mock.calls.length, 2)
  })

  await t.test('handles empty results', async t => {
    const resource = {
      list: t.mock.fn(async () => ({
        data: [],
        has_more: false
      }))
    }

    const items = []
    for await (const item of stripeGenerator(resource, 'list', {}, 'customers'))
      items.push(item)

    assert.strictEqual(items.length, 0)
  })

  await t.test('throws on API error', async t => {
    const resource = {
      list: t.mock.fn(async () => {
        throw new Error('Rate limit exceeded')
      })
    }

    await assert.rejects(
      async () => {
        for await (const _ of stripeGenerator(resource, 'list', {}, 'customers')) {}
      },
      { message: /Stripe.*failed/i }
    )
  })
})

test('#keychain', async t => {
  await t.test('getKeychain', async t => {
    await t.test('retrieves existing credential', async t => {
      const run = t.mock.fn(async () => ({ stdout: 'sk_test_123', stderr: '' }))
      const key = await getKeychain('BP_STRIPE_KEY', run)

      assert.strictEqual(key, 'sk_test_123')
    })

    await t.test('returns null when not found', async t => {
      const err: any = new Error('not found')
      err.stderr = Buffer.from('could not be found')
      const run = t.mock.fn(async () => { throw err })
      const key = await getKeychain('BP_STRIPE_KEY', run)

      assert.strictEqual(key, null)
    })

    await t.test('throws on keychain locked', async t => {
      const err: any = new Error('auth error')
      err.stderr = Buffer.from('The user name or passphrase you entered is not correct')
      const run = t.mock.fn(async () => { throw err })

      await assert.rejects(
        () => getKeychain('BP_STRIPE_KEY', run),
        { message: /Keychain error/i }
      )
    })

    await t.test('throws on permission denied', async t => {
      const err: any = new Error('auth failed')
      err.stderr = Buffer.from('errSecAuthFailed')
      const run = t.mock.fn(async () => { throw err })

      await assert.rejects(
        () => getKeychain('BP_STRIPE_KEY', run),
        { message: /Keychain error/i }
      )
    })
  })

  await t.test('setKeychain', async t => {
    await t.test('stores credential', async t => {
      const run = t.mock.fn(async () => ({ stdout: '', stderr: '' }))
      await setKeychain('BP_STRIPE_KEY', 'sk_test_123', run)

      assert.strictEqual(run.mock.calls.length, 1)
    })

    await t.test('rejects empty value', async t => {
      const run = t.mock.fn()

      await assert.rejects(
        () => setKeychain('KEY', '', run),
        { name: 'TypeError', message: /non-empty/i }
      )
    })

    await t.test('rejects non-string', async t => {
      const run = t.mock.fn()

      await assert.rejects(
        () => setKeychain('KEY', 123 as any, run),
        { name: 'TypeError' }
      )
    })

    await t.test('rejects invalid key format', async t => {
      const run = t.mock.fn()

      await assert.rejects(
        () => setKeychain('invalid-key', 'value', run),
        { name: 'TypeError', message: /uppercase letters and underscores/i }
      )
    })
  })

  await t.test('getKeychain validates key format', async t => {
    await t.test('rejects invalid key format', async t => {
      const run = t.mock.fn()

      await assert.rejects(
        () => getKeychain('invalid-key', run),
        { name: 'TypeError', message: /uppercase letters and underscores/i }
      )
    })
  })

  await t.test('ensureKeychain', async t => {
    await t.test('returns existing credential', async t => {
      const run = t.mock.fn(async () => ({ stdout: 'sk_test_123', stderr: '' }))
      const prompt = t.mock.fn()

      const key = await ensureKeychain('KEY', run, prompt)

      assert.strictEqual(key, 'sk_test_123')
      assert.strictEqual(prompt.mock.calls.length, 0)
    })

    await t.test('prompts when missing', async t => {
      let callCount = 0
      const run = t.mock.fn(async () => {
        callCount++
        if (callCount === 1) {
          const err: any = new Error('not found')
          err.stderr = Buffer.from('could not be found')
          throw err
        }
        return { stdout: '', stderr: '' }
      })
      const prompt = t.mock.fn(async () => 'sk_test_new')

      const key = await ensureKeychain('KEY', run, prompt)

      assert.strictEqual(key, 'sk_test_new')
      assert.strictEqual(prompt.mock.calls.length, 1)
    })

    await t.test('rejects empty prompt input', async t => {
      const run = t.mock.fn(async () => { const e: any = new Error('nf'); e.stderr = Buffer.from('could not be found'); throw e })
      const prompt = t.mock.fn(async () => '   ')

      await assert.rejects(
        () => ensureKeychain('KEY', run, prompt),
        { message: /cannot be empty/i }
      )
    })
  })
})

test('#users', async t => {
  await t.test('yields User instances', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [
          { id: 1, email: 'a@test.com', stripe_id: 'cus_1' }
        ]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn(async (id: string) => ({ id, email: `${id}@stripe.com` }))
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    const items = []
    for await (const user of users())
      items.push(user)

    assert.ok(items[0] instanceof User)
  })

  await t.test('passes where clause', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [] }))
    } as unknown as PgPool
    const stripe = { customers: { retrieve: t.mock.fn() } } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    for await (const _ of users('field1 IS NULL', [])) {}

    const call = db.query.mock.calls[0]
    const [sql] = call.arguments

    assert.match(sql, /WHERE field1 IS NULL/)
  })

  await t.test('passes parameters', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [] }))
    } as unknown as PgPool
    const stripe = { customers: { retrieve: t.mock.fn() } } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    for await (const _ of users('id = $1', [123])) {}

    const call = db.query.mock.calls[0]
    const [, params] = call.arguments

    assert.strictEqual(params[0], 123)
  })

  await t.test('fetchCustomer: false (default)', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [{ id: 1, email: 'a@test.com', stripe_id: 'cus_1' }]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn()
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    for await (const _ of users()) {}

    assert.strictEqual(stripe.customers.retrieve.mock.calls.length, 0)
  })

  await t.test('fetchCustomer: true', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [
          { id: 1, email: 'a@test.com', stripe_id: 'cus_1' },
          { id: 2, email: 'b@test.com', stripe_id: 'cus_2' }
        ]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn(async (id: string) => ({ id }))
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    for await (const _ of users('', [], { fetchCustomer: true })) {}

    assert.strictEqual(stripe.customers.retrieve.mock.calls.length, 2)
  })

  await t.test('attaches customer to user', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [{ id: 1, email: 'a@test.com', stripe_id: 'cus_1' }]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn(mocks.stripe.customers.retrieve)
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    const items = []
    for await (const user of users('', [], { fetchCustomer: true }))
      items.push(user)

    assert.ok(items[0].customer)
    assert.strictEqual(items[0].customer.id, 'cus_1')
    assert.strictEqual(items[0].customer.email, 'cus_1@example.com')
  })

  await t.test('returns full customer data with mock utilities', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [{ id: 1, email: 'a@test.com', stripe_id: 'cus_test' }]
      }))
    } as unknown as PgPool

    t.mock.method(mocks.stripe.customers, 'retrieve')

    const users = createUsersGenerator(db, mocks.stripe as unknown as Stripe)

    const items = []
    for await (const user of users('', [], { fetchCustomer: true }))
      items.push(user)

    assert.ok(items[0].customer)
    assert.strictEqual(items[0].customer.id, 'cus_test')
    assert.strictEqual(items[0].customer.name, 'Test Customer')
    assert.strictEqual(items[0].customer.currency, 'usd')
    assert.strictEqual(mocks.stripe.customers.retrieve.mock.callCount(), 1)
  })

  await t.test('handles missing stripe_id', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [{ id: 1, email: 'test@example.com', stripe_id: null }]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn()
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    const items = []
    for await (const user of users('', [], { fetchCustomer: true }))
      items.push(user)

    assert.strictEqual(stripe.customers.retrieve.mock.calls.length, 0)
  })

  await t.test('handles Stripe error', async t => {
    const db = {
      query: t.mock.fn(async () => ({
        rows: [{ id: 1, email: 'test@example.com', stripe_id: 'cus_1' }]
      }))
    } as unknown as PgPool
    const stripe = {
      customers: {
        retrieve: t.mock.fn(async () => {
          throw new Error('Not found')
        })
      }
    } as unknown as Stripe
    const users = createUsersGenerator(db, stripe)

    const items = []
    for await (const user of users('', [], { fetchCustomer: true }))
      items.push(user)

    assert.strictEqual(items[0].customer, null)
  })
})

test('#query', async t => {
  await t.test('wraps db.query', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [{ id: 1 }] }))
    } as unknown as PgPool
    const query = createQueryHelper(db)

    await query('SELECT *', [])

    assert.strictEqual(db.query.mock.calls.length, 1)
  })

  await t.test('passes sql and params', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [{ id: 1 }] }))
    } as unknown as PgPool
    const query = createQueryHelper(db)

    await query('SELECT * WHERE id = $1', [123])

    const call = db.query.mock.calls[0]
    const [sql, params] = call.arguments

    assert.strictEqual(sql, 'SELECT * WHERE id = $1')
    assert.deepStrictEqual(params, [123])
  })

  await t.test('validates sql type', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [{ id: 1 }] }))
    } as unknown as PgPool
    const query = createQueryHelper(db)

    await assert.rejects(
      () => query(123 as any, []),
      { name: 'TypeError', message: /SQL must be string/i }
    )
  })

  await t.test('validates params type', async t => {
    const db = {
      query: t.mock.fn(async () => ({ rows: [{ id: 1 }] }))
    } as unknown as PgPool
    const query = createQueryHelper(db)

    await assert.rejects(
      () => query('SELECT *', 'not-array' as any),
      { name: 'TypeError', message: /array/i }
    )
  })
})
