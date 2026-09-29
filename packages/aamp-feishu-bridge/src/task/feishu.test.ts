import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { normalizeFeishuTaskEvent, OapiFeishuTaskClient } from './feishu.js'

const feedbackPaths = {
  commandResultPath: '/open-apis/task/v2/agent_task_execution/report_command_result',
  executionStatePath: '/open-apis/task/v2/agent_task_execution/report_execution_state',
}

test('Agent registration advertises controlled execution protocol v1', async () => {
  const requests: Array<{ method: string; url: string; data: Record<string, unknown> }> = []
  const client = new OapiFeishuTaskClient({ appId: 'cli_test', appSecret: 'secret', eventNames: [] }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    domain: 'https://open.feishu.cn',
    formatPayload: async (payload: { data: Record<string, unknown> }) => ({ params: {}, data: payload.data, headers: {} }),
    httpInstance: { request: async (request: { method: string; url: string; data: Record<string, unknown> }) => {
      requests.push(request)
      return { code: 0, msg: 'success' }
    } },
  }

  await client.registerAgent()

  assert.deepEqual(requests, [{
    method: 'POST',
    url: 'https://open.feishu.cn/open-apis/task/v2/agent/register_agent',
    params: {},
    headers: {},
    data: { controlled_execution_protocol_version: 1 },
  }])
})

test('controlled feedback uses the existing Feishu client identity, domain and environment headers', async () => {
  const requests: Array<{ method: string; url: string; headers: Record<string, string>; data: Record<string, unknown> }> = []
  const client = new OapiFeishuTaskClient({ appId: 'cli_test', appSecret: 'secret', domain: 'https://open.feishu-pre.cn', headers: { 'x-tt-env': 'ppe_test' }, eventNames: [] }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    domain: 'https://open.feishu-pre.cn',
    formatPayload: async (payload: { data: Record<string, unknown> }) => ({
      params: {},
      data: payload.data,
      headers: { Authorization: 'Bearer app-token', 'x-tt-env': 'ppe_test' },
    }),
    httpInstance: { request: async (request: { method: string; url: string; headers: Record<string, string>; data: Record<string, unknown> }) => {
      requests.push(request)
      return { code: 0, msg: 'success' }
    } },
  }

  const feedback = client.createControlledFeedbackTransport(feedbackPaths)
  await feedback.reportCommandResult({ task_guid: 'task_1', execution_id: 'run_1', action: 1, result: 1 })
  await feedback.reportExecutionState({ task_guid: 'task_1', execution_id: 'run_1', state: 3 })

  assert.deepEqual(requests, [
    { method: 'POST', url: `https://open.feishu-pre.cn${feedbackPaths.commandResultPath}`, params: {}, headers: { Authorization: 'Bearer app-token', 'x-tt-env': 'ppe_test' }, data: { task_guid: 'task_1', execution_id: 'run_1', action: 1, result: 1 } },
    { method: 'POST', url: `https://open.feishu-pre.cn${feedbackPaths.executionStatePath}`, params: {}, headers: { Authorization: 'Bearer app-token', 'x-tt-env': 'ppe_test' }, data: { task_guid: 'task_1', execution_id: 'run_1', state: 3 } },
  ])
})

test('controlled feedback retries HTTP 503 and rejects a nonzero or missing API code', async () => {
  const responses: Array<unknown> = [
    Object.assign(new Error('unavailable'), { response: { status: 503 } }),
    { code: 0, msg: 'success' },
    { code: 1254301, msg: 'forbidden' },
    { data: {} },
  ]
  let attempts = 0
  const client = new OapiFeishuTaskClient({ appId: 'cli_test', appSecret: 'secret', eventNames: [] }, {
    logger: { log: () => {}, error: () => {} }, retryBaseDelayMs: 0, retryMaxAttempts: 2,
  })
  ;(client as unknown as { client: unknown }).client = {
    domain: 'https://open.feishu.cn',
    formatPayload: async (payload: { data: Record<string, unknown> }) => ({ params: {}, data: payload.data, headers: {} }),
    httpInstance: { request: async () => {
      const response = responses[attempts++]
      if (response instanceof Error) throw response
      return response
    } },
  }
  const feedback = client.createControlledFeedbackTransport(feedbackPaths)
  const body = { task_guid: 'task_1', execution_id: 'run_1', action: 1 as const, result: 1 as const }

  await feedback.reportCommandResult(body)
  assert.equal(attempts, 2)
  await assert.rejects(feedback.reportCommandResult(body), /1254301/)
  assert.equal(attempts, 3)
  await assert.rejects(feedback.reportCommandResult(body), /missing.*code/i)
  assert.equal(attempts, 4)
})

test('controlled Task event preserves command identity from the WebSocket payload', () => {
  assert.deepEqual(normalizeFeishuTaskEvent({
    event_id: 'evt_start_1',
    task_guid: 'task_1',
    event_types: ['task_agent_start'],
    execution_id: 'execution_1',
    action: 'START',
  }), {
    eventId: 'evt_start_1',
    taskGuid: 'task_1',
    eventTypes: ['task_agent_start'],
    executionId: 'execution_1',
    action: 'START',
    raw: {
      event_id: 'evt_start_1',
      task_guid: 'task_1',
      event_types: ['task_agent_start'],
      execution_id: 'execution_1',
      action: 'START',
    },
  })
})

test('controlled write context reaches patch, steps, comment and multipart upload; legacy requests omit it', async () => {
  const writes: Array<{ kind: string; data: Record<string, unknown> }> = []
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aamp-feishu-execution-context-'))
  const filePath = path.join(tempDir, 'result.md')
  const client = new OapiFeishuTaskClient({ appId: 'cli_xxx', appSecret: 'secret', eventNames: [] }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    domain: 'https://open.feishu.cn',
    formatPayload: async (payload: { params: unknown; data: Record<string, unknown> }) => ({ ...payload, headers: {} }),
    httpInstance: { request: async (payload: { data: Record<string, unknown> }) => {
      writes.push({ kind: 'steps', data: payload.data })
      return { data: {}, status: 200 }
    } },
    task: { v2: {
      task: { patch: async (payload: { data: Record<string, unknown> }) => { writes.push({ kind: 'patch', data: payload.data }) } },
      comment: { create: async (payload: { data: Record<string, unknown> }) => { writes.push({ kind: 'comment', data: payload.data }) } },
      attachment: { upload: async (payload: { data: Record<string, unknown> }) => { writes.push({ kind: 'upload', data: payload.data }) } },
    } },
  }

  try {
    await writeFile(filePath, '# Result\n')
    for (const context of [undefined, { executionId: 'run_1' }]) {
      await client.markTaskInProgress('task_1', context)
      await client.appendTextDeliveries('task_1', ['https://example.com/result'], context)
      await client.appendTaskSteps('task_1', ['分析完成'], context)
      await client.commentTask('task_1', '分析结果', context)
      await client.uploadTaskDelivery('task_1', filePath, context)
    }

    assert.deepEqual(writes.map((write) => write.kind), [
      'patch', 'patch', 'steps', 'comment', 'upload',
      'patch', 'patch', 'steps', 'comment', 'upload',
    ])
    for (const write of writes.slice(0, 5)) assert.equal('execution_id' in write.data, false)
    for (const write of writes.slice(5)) assert.equal(write.data.execution_id, 'run_1')
    assert.equal(writes[9]?.data.resource_id, 'task_1')
    assert.equal(typeof writes[9]?.data.file, 'object')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('OapiFeishuTaskClient maps source message content from v2 task origin refer resources', async () => {
  const client = new OapiFeishuTaskClient({
    appId: 'cli_xxx',
    appSecret: 'secret',
    userIdType: 'open_id',
    eventNames: ['task.task.update_user_access_v2'],
  }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    task: {
      v2: {
        task: {
          get: async () => ({
            data: {
              task: {
                guid: 'task_guid_origin',
                task_id: 't_origin',
                summary: '整理群聊需求',
                origin: {
                  refer_resources: [
                    {
                      resource_id: 'refer_resource_1',
                      type: 'message',
                      source_message: {
                        message_id: 'om_message_1',
                        content: '请基于这份文档推进：https://bytedance.larkoffice.com/docx/ABC123',
                      },
                    },
                    {
                      resource_id: 'refer_resource_2',
                      type: 'message',
                      source_message: {
                        message_id: 'om_message_2',
                        content: '第二条消息补充上线窗口。',
                      },
                      unavailable_reason: '',
                    },
                  ],
                },
              },
            },
          }),
        },
      },
    },
  }

  const task = await client.getTaskBase('task_guid_origin')

  assert.deepEqual((task as unknown as { origin?: unknown }).origin, {
    referResources: [
      {
        resourceId: 'refer_resource_1',
        type: 'message',
        sourceMessage: {
          messageId: 'om_message_1',
          content: '请基于这份文档推进：https://bytedance.larkoffice.com/docx/ABC123',
        },
      },
      {
        resourceId: 'refer_resource_2',
        type: 'message',
        sourceMessage: {
          messageId: 'om_message_2',
          content: '第二条消息补充上线窗口。',
        },
      },
    ],
  })
})

test('OapiFeishuTaskClient appends task steps with quote through raw REST endpoint', async () => {
  const rawRequests: Array<{
    method?: string
    url?: string
    params?: unknown
    data?: {
      task_guid?: string
      task_steps?: Array<{ quote?: string; content?: string; timestamp?: number }>
    }
    headers?: unknown
  }> = []
  const client = new OapiFeishuTaskClient({
    appId: 'cli_xxx',
    appSecret: 'secret',
    eventNames: ['task.task.update_user_access_v2'],
  }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    domain: 'https://open.feishu.cn',
    formatPayload: async (payload: {
      params?: unknown
      data?: {
        task_guid?: string
        task_steps?: Array<{ quote?: string; content?: string; timestamp?: number }>
      }
    }) => ({
      params: payload.params,
      data: payload.data,
      headers: { Authorization: 'Bearer token' },
    }),
    httpInstance: {
      request: async (options: {
        method?: string
        url?: string
        params?: unknown
        data?: {
          task_guid?: string
          task_steps?: Array<{ quote?: string; content?: string; timestamp?: number }>
        }
        headers?: unknown
      }) => {
        rawRequests.push(options)
        return { data: {}, status: 200 }
      },
    },
  }

  await client.appendTaskStep('task_guid_step', {
    content: '已完成工具调用：读取文件',
    quote: '输出：{"title":"Read file"}',
  })

  assert.equal(rawRequests.length, 1)
  assert.equal(rawRequests[0]?.method, 'POST')
  assert.equal(rawRequests[0]?.url, 'https://open.feishu.cn/open-apis/task/v2/agent_task_step_info/append_task_steps')
  assert.equal(rawRequests[0]?.data?.task_guid, 'task_guid_step')
  assert.equal(rawRequests[0]?.data?.task_steps?.[0]?.content, '已完成工具调用：读取文件')
  assert.equal(rawRequests[0]?.data?.task_steps?.[0]?.quote, '输出：{"title":"Read file"}')
  assert.equal(typeof rawRequests[0]?.data?.task_steps?.[0]?.timestamp, 'number')
})

test('OapiFeishuTaskClient loads the app owner as an open id', async () => {
  const calls: unknown[] = []
  const client = new OapiFeishuTaskClient({
    appId: 'cli_owner',
    appSecret: 'secret',
    userIdType: 'open_id',
    eventNames: ['task.task.update_user_access_v2'],
  }, {
    logger: { log: () => {}, error: () => {} },
  })
  ;(client as unknown as { client: unknown }).client = {
    application: {
      application: {
        get: async (payload: unknown) => {
          calls.push(payload)
          return {
            data: {
              app: {
                owner: { owner_id: 'ou_owner' },
              },
            },
          }
        },
      },
    },
  }

  const owner = await client.getAppOwner()

  assert.deepEqual(owner, { ownerId: 'ou_owner' })
  assert.deepEqual(calls, [{
    path: { app_id: 'cli_owner' },
    params: { lang: 'zh_cn', user_id_type: 'open_id' },
  }])
})
