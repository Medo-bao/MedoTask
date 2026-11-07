import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router.js'
import { open } from './db/database.js'
import { useSettingsStore } from './stores/settings.js'
import './styles/main.css'

/**
 * Boot sequence.
 *
 * The database has to be open before any store reads, so the settings store is
 * seeded here rather than in a component. Everything else loads lazily.
 */
async function boot() {
  await open()

  const app = createApp(App)
  app.use(createPinia())

  // settings drive the theme, so load them before the first paint
  const settings = useSettingsStore()
  await settings.load()

  app.use(router)
  await router.isReady()
  app.mount('#app')
}

boot().catch((err) => {
  console.error('[kite] boot failed', err)
  const el = document.getElementById('app')
  if (el) {
    el.textContent = `启动失败：${err?.stack ?? err}`
    el.style.cssText = 'padding:24px;font:13px ui-monospace;color:#b91c1c;white-space:pre-wrap'
  }
})
