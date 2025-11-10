#!/usr/bin/env node

import util from 'node:util'
import { parseArgs } from 'node:util'
import { styleText as color } from 'node:util'
import vm from 'node:vm'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile as execFileCb } from 'node:child_process'
import { createInterface } from 'node:readline'
import Stripe from 'stripe'
import pkg from 'pg'

const { Pool } = pkg
const execFileDefault = util.promisify(execFileCb)

const format = (template, args = []) => {
  if (!args || args.length === 0) return template

  let result = template
  args.forEach((arg, i) => {
    const value = typeof arg === 'object'
      ? util.inspect(arg, { colors: true, depth: 2, breakLength: 60 })
      : String(arg)
    result = result.replace(`$${i + 1}`, value)
  })
  return result
}

const log = {
  error: (msg, args = []) =>
    console.error(`${color('red', 'error:')} ${format(msg, args)}`),
  success: (msg, args = []) =>
    console.error(`${color('green', '✓')} ${format(msg, args)}`),
  warning: (msg, args = []) =>
    console.error(`${color('yellow', 'warning:')} ${format(msg, args)}`),
  info: (msg, args = []) =>
    console.error(format(msg, args))
}

class User {
  constructor(row, db) {
    Object.assign(this, row)
    this._db = db
    this._original = { ...row }
  }

  set = data => {
    Object.assign(this, data)
    return this
  }

  save = async () => {
    const changed = Object.keys(this).filter(key =>
      !key.startsWith('_') &&
      key !== 'customer' &&
      typeof this[key] !== 'function' &&
      Object.prototype.hasOwnProperty.call(this._original, key) &&
      this[key] !== this._original[key]
    )

    if (!changed.length) return this

    log.info('Saving user $1 ($2)', [this.id, changed.join(', ')])

    const ident = s => `"${String(s).replace(/\"/g, '""')}"`
    const sets = changed.map((key, i) => `${ident(key)} = $${i + 1}`).join(', ')
    const values = changed.map(key => this[key])

    await this._db.query(
      `UPDATE users SET ${sets} WHERE id = $${changed.length + 1}`,
      [...values, this.id]
    )

    changed.forEach(key => {
      this._original[key] = this[key]
    })
    log.success('Saved user $1', [this.id])

    return this
  }
}

const getKeychain = async (key, run = execFileDefault) => {
  if (!/^[A-Z_]+$/.test(key))
    throw new TypeError('Key must be uppercase letters and underscores only')

  try {
    const { stdout } = await run(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'BP_CLI', '-a', key, '-w']
    )
    return stdout.trim()
  } catch (err) {
    const stderr = (err && err.stderr && err.stderr.toString()) || ''
    if (/could not be found/i.test(stderr)) return null
    throw new Error(`Keychain error for ${key}: ${stderr || err.message}`)
  }
}

const setKeychain = async (key, value, run = execFileDefault) => {
  if (!value || typeof value !== 'string')
    throw new TypeError('Credential must be non-empty string')

  if (!/^[A-Z_]+$/.test(key))
    throw new TypeError('Key must be uppercase letters and underscores only')

  try {
    await run(
      '/usr/bin/security',
      ['add-generic-password', '-s', 'BP_CLI', '-a', key, '-w', value]
    )
  } catch (err) {
    const stderr = (err && err.stderr && err.stderr.toString()) || ''
    throw new Error(`Failed to store ${key}: ${stderr || err.message}`)
  }
}

const prompt = async msg => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr
  })

  return new Promise(resolve => {
    rl.question(msg, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

const ensureKeychain = async (
  key,
  run = execFileDefault,
  promptFn = prompt
) => {
  log.info('Checking keychain for $1...', [key])
  let value = await getKeychain(key, run)

  if (!value) {
    log.info('$1 not found', [key])
    value = await promptFn(`Enter ${key}: `)

    const trimmed = value.trim()
    if (!trimmed)
      throw new Error('Credential cannot be empty')

    await setKeychain(key, trimmed, run)
    log.success('Stored $1 in keychain', [key])
    return trimmed
  }

  log.success('Found $1', [key])
  return value
}

const stripeGenerator = async function* (
  resource,
  method,
  filters,
  name
) {
  log.info('Getting $1...', [name])

  let hasMore = true
  let startingAfter

  while (hasMore) {
    try {
      const result = await resource[method]({
        ...filters,
        ...(startingAfter && { starting_after: startingAfter })
      })

      for (const item of result.data) {
        log.info('Processed $1', [item.id])
        yield item
      }

      hasMore = result.has_more
      if (hasMore)
        startingAfter = result.data[result.data.length - 1].id
    } catch (err) {
      throw new Error(`Stripe ${name} failed: ${err.message}`)
    }
  }
}

const createUsersGenerator = (db, stripe) => {
  return async function* (
    where = '',
    params = [],
    { fetchCustomer = false } = {}
  ) {
    const sql = where
      ? `SELECT * FROM users WHERE ${where}`
      : `SELECT * FROM users`

    log.info('Querying users...')
    const result = await db.query(sql, params)

    for (const row of result.rows) {
      const user = new User(row, db)

      if (fetchCustomer && row.stripe_id) {
        try {
          log.info('Fetching customer $1', [row.stripe_id])
          user.customer = await stripe.customers.retrieve(row.stripe_id)
        } catch (err) {
          log.warning(
            'Failed to fetch customer $1: $2',
            [row.stripe_id, err.message]
          )
          user.customer = null
        }
      }

      log.info('Processed user $1', [user.id])
      yield user
    }
  }
}

const createQueryHelper = db => {
  return async (sql, params = []) => {
    if (typeof sql !== 'string')
      throw new TypeError('SQL must be string')

    if (!Array.isArray(params))
      throw new TypeError('Parameters must be array')

    try {
      return await db.query(sql, params)
    } catch (err) {
      throw new Error(`Query failed: ${err.message}`)
    }
  }
}

const discoverStripeResources = stripe => {
  const resources = {}

  for (const [name, value] of Object.entries(stripe)) {
    if (value && typeof value.list === 'function') {
      resources[name] = filters =>
        stripeGenerator(value, 'list', filters, name)
    }
  }

  log.info('Discovered $1 Stripe resources', [Object.keys(resources).length])
  return resources
}

const help = () => {
  console.error(`${color('bold', 'Usage:')}
  bp-sync              Show this help
  bp-sync -h, --help   Show this help
  bp-sync init         Create mapping.js
  bp-sync exec <file>  Execute script

${color('bold', 'Examples:')}
  bp-sync init
  bp-sync exec mapping.js`)
  process.exit(0)
}

const init = async () => {
  const example = `for await (const user of users('field1 IS NULL', [], { fetchCustomer: true })) {
  if (!user.customer) continue

  await user.set({
    field1: user.customer.email,
    field2: user.customer.name
  }).save()
}`

  await writeFile('mapping.js', example)
  log.success('Created mapping.js')
  process.exit(0)
}

const exec = async filepath => {
  try {
    await readFile(filepath)
  } catch {
    throw new Error(`Script not found: ${filepath}`)
  }

  const stripeKey = await ensureKeychain('BP_STRIPE_KEY')
  const dbUrl = await ensureKeychain('BP_DATABASE_URL')

  const stripe = new Stripe(stripeKey)
  log.info('Connecting to database...')
  const db = new Pool({ connectionString: dbUrl })
  log.success('Connected to database')

  const context = {
    ...discoverStripeResources(stripe),
    stripe,
    users: createUsersGenerator(db, stripe),
    db,
    query: createQueryHelper(db),
    log
  }

  const code = await readFile(filepath, 'utf8')

  try {
    const wrappedCode = `(async () => { ${code} })()`
    const script = new vm.Script(wrappedCode)
    await script.runInContext(
      vm.createContext(context),
      { microtaskMode: 'afterEvaluate' }
    )
  } catch (err) {
    throw new Error(`Script error in ${filepath}:\n${err.stack}`)
  } finally {
    await db.end()
  }
}

const main = async () => {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true,
    strict: false
  })

  if (values.help || positionals.length === 0)
    return help()

  const [command, ...args] = positionals

  if (command === 'init')
    return await init()

  if (command === 'exec') {
    if (!args[0]) {
      log.error('exec requires a file path')
      help()
    }
    return await exec(args[0])
  }

  log.error('Unknown command: $1', [command])
  help()
}

if (import.meta.url.startsWith('file://') && process.argv[1]) {
  const scriptPath = process.argv[1]
  const isRunningAsScript =
    import.meta.url === `file://${scriptPath}` ||
    (scriptPath.includes('/bin/') && import.meta.url.endsWith('/cli.js'))

  if (isRunningAsScript) {
    main().catch(err => {
      log.error(err.message)
      process.exit(1)
    })
  }
}

export {
  User,
  stripeGenerator,
  getKeychain,
  setKeychain,
  ensureKeychain,
  createUsersGenerator,
  createQueryHelper
}
