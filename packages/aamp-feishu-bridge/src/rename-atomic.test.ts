import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renameAtomic } from './rename-atomic.js'

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows atomic rename retries a transient ${code} without changing paths`, async () => {
    const calls: unknown[] = []
    const delays: number[] = []
    await renameAtomic('source.tmp', 'state.json', {
      platform: 'win32',
      rename: async (...paths) => {
        calls.push(paths)
        if (calls.length === 1) throw Object.assign(new Error('sharing violation'), { code })
      },
      delay: async (milliseconds) => { delays.push(milliseconds) },
    })
    assert.deepEqual(calls, [['source.tmp', 'state.json'], ['source.tmp', 'state.json']])
    assert.deepEqual(delays, [100])
  })
}

test('Windows atomic rename preserves the original error after bounded retries', async () => {
  const error = Object.assign(new Error('access remains denied'), { code: 'EPERM' })
  let attempts = 0
  const delays: number[] = []
  await assert.rejects(renameAtomic('source.tmp', 'state.json', {
    platform: 'win32',
    rename: async () => { attempts += 1; throw error },
    delay: async (milliseconds) => { delays.push(milliseconds) },
  }), (actual) => actual === error)
  assert.equal(attempts, 6)
  assert.deepEqual(delays, [100, 200, 400, 800, 1600])
})

for (const [platform, code] of [['darwin', 'EPERM'], ['linux', 'EACCES'], ['win32', 'ENOENT']] as const) {
  test(`atomic rename immediately preserves ${platform} ${code}`, async () => {
    const error = Object.assign(new Error('rename failed'), { code })
    let attempts = 0
    await assert.rejects(renameAtomic('source.tmp', 'state.json', {
      platform,
      rename: async () => { attempts += 1; throw error },
      delay: async () => { assert.fail('unexpected retry') },
    }), (actual) => actual === error)
    assert.equal(attempts, 1)
  })
}
