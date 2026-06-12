import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const webPort = Number(process.env.STUDY_DRILLLY_WEB_PORT) || 5212
const apiPort = Number(process.env.STUDY_DRILLLY_API_PORT) || 5213

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: !!process.env.STUDY_DRILLLY_WEB_PORT,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
