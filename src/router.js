import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * Routes mirror the original app's window set. A window is a route, which is
 * how the original app mapped "one window per purpose".
 */
const routes = [
  { path: '/', name: 'main', component: () => import('@/views/MainView.vue'), meta: { title: 'MedoTask' } },
  { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue'), meta: { title: 'MedoTask 总览' } },
  { path: '/trash', alias: '/draft', name: 'trash', component: () => import('@/views/TrashView.vue'), meta: { title: 'MedoTask 垃圾箱' } },
  { path: '/setting', name: 'setting', component: () => import('@/views/SettingView.vue'), meta: { title: 'MedoTask 设置' } },
  { path: '/mini', name: 'mini', component: () => import('@/views/MiniView.vue'), meta: { title: 'MedoTask 浮窗' } },
  ...(__HAS_ASSISTANT__ ? [
    { path: '/ai', name: 'ai', component: () => import('@/views/AiView.vue'), meta: { title: 'MedoTask 助手' } },
  ] : []),
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  // Hash routes work on a static server without route rewrites.
  history: createWebHashHistory(),
  routes,
})

router.afterEach((to) => {
  document.title = to.meta?.title ?? 'MedoTask'
})
