<script setup>
/**
 * App shell.
 *
 * Owns the theme class and notifications.
 * Each view renders its own chrome, since the windows differ a lot.
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWindows } from '@/composables/useWindows.js'
import { useSettingsStore } from '@/stores/settings.js'
import ToastHost from '@/components/ToastHost.vue'

const settings = useSettingsStore()
const route = useRoute()
const windows = useWindows()
const transparentMini = computed(() => windows.isWindowsDesktop && route.name === 'mini')

// --- theme ---------------------------------------------------------
function applyTheme(mode) {
  const dark = mode === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

watch(() => settings.setting.mode, applyTheme, { immediate: true })
watch(transparentMini, (transparent) => {
  document.documentElement.classList.toggle('transparent-mini', transparent)
}, { immediate: true })

</script>

<template>
  <div class="kite-shell h-full w-full overflow-hidden text-foreground" :class="{ 'bg-background': !transparentMini }">
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
    <ToastHost />
  </div>
</template>
