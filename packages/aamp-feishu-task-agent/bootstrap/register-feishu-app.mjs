import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const splitList = value => Array.isArray(value) ? value : String(value || '').split(',').map(item => item.trim()).filter(Boolean)

export async function registerFeishuApp({ sdk, appName = '飞书 CLI', tenantScopes = [], userScopes = [], tenantEvents = [], userEvents = [], openUrl, log = console.log }) {
  let detectedTenantBrand = 'feishu'
  const addons = { scopes: { tenant: splitList(tenantScopes), user: splitList(userScopes) }, events: { items: { tenant: splitList(tenantEvents), user: splitList(userEvents) } } }
  const result = await sdk.registerApp({
    source: 'aamp-feishu-task-agent', appPreset: { name: appName, desc: 'AAMP Feishu bridge bot' }, addons,
    onQRCodeReady(info) {
      log(`请打开授权链接完成飞书 Bot 授权（${info.expireIn} 秒内有效）：${info.url}`)
      if (openUrl) {
        try { Promise.resolve(openUrl(info.url, info.expireIn)).catch(() => {}) } catch {}
      }
    },
    onStatusChange(info) { if (info.status === 'domain_switched') detectedTenantBrand = 'lark' },
  })
  const reported = result?.user_info?.tenant_brand
  const tenantBrand = reported === undefined || reported === null || reported === '' ? detectedTenantBrand : reported
  const tenantBrandIsSupported = ['feishu', 'lark'].includes(tenantBrand)
  let registeredName = ''
  try {
    if (!tenantBrandIsSupported) throw new Error(`unsupported tenant brand: ${tenantBrand}`)
    const client = new sdk.Client({ appId: result.client_id, appSecret: result.client_secret, domain: tenantBrand === 'lark' ? sdk.Domain.Lark : sdk.Domain.Feishu })
    const response = await client.application.application.get({ path: { app_id: result.client_id }, params: { lang: 'zh_cn', user_id_type: 'open_id' } })
    const app = response?.data?.app
    registeredName = app?.app_name || app?.i18n?.find?.(item => item?.i18n_key === 'zh_cn')?.name || ''
  } catch (error) { log(`failed to fetch registered app name; using preset name: ${error instanceof Error ? error.message : String(error)}`) }
  return { app_id: result.client_id, app_secret: result.client_secret, app_name: registeredName || appName, tenant_brand: tenantBrand }
}

export function defaultOpenUrl(url) {
  if (process.platform === 'darwin') execFile('open', [url], () => {})
  else if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:AAMP_AUTH_URL'], { env: { ...process.env, AAMP_AUTH_URL: url } }, () => {})
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))) {
  const sdk = await import('@larksuiteoapi/node-sdk')
  const result = await registerFeishuApp({
    sdk,
    appName: process.env.FEISHU_APP_PRESET_NAME,
    tenantScopes: process.env.FEISHU_APP_SCOPES_TENANT,
    userScopes: process.env.FEISHU_APP_SCOPES_USER,
    tenantEvents: process.env.FEISHU_APP_EVENTS_TENANT,
    userEvents: process.env.FEISHU_APP_EVENTS_USER,
    openUrl: defaultOpenUrl,
  })
  await writeFile(process.env.AAMP_REGISTER_APP_RESULT_FILE, JSON.stringify(result))
}
