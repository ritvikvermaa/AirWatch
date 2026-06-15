/* global process */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleCpcbRecords } from './api/cpcb-records.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'airwatch-cpcb-dev-api',
        configureServer(server) {
          process.env.DATA_GOV_API_KEY ||= env.DATA_GOV_API_KEY || env.VITE_DATA_GOV_API_KEY
          server.middlewares.use('/api/cpcb-records', handleCpcbRecords)
        },
      },
    ],
  }
})
